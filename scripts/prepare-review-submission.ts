import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, stat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import type { SurveyRun } from '../shared/survey-engine';
import { parseSurveyEvidenceWithVerification } from '../src/run-history';
import { auditBusinessDemoRun } from '../shared/research-demo';
import { fingerprint } from '../shared/evidence';
import { parseBusinessProofSnapshot } from '../src/business-proof-history';
import { z } from 'zod';
import { verifySubmissionArtifacts } from '../shared/submission-artifacts';

// Creates a NEW candidate only. Never reads the private store, dispatches a model, or writes public/submission.
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => !/^--proof=[a-f0-9-]{36}$/.test(arg) && !/^--verification=output\/[a-zA-Z0-9._-]+\.json$/.test(arg) && !/^--video=output\/review-video\/[a-zA-Z0-9._-]+\.mp4$/.test(arg))) throw new Error('仅接受登记proof UUID、output内核验JSON及review-video MP4；不接受Key/live/任意输出路径。');
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const proofId = option('proof');
if (!proofId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(proofId)) throw new Error('需--proof=已生成业务自证UUID。');
const directory = path.join(root, 'public/submission-next');
const json = async (name: string) => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const proof = await json(`output/business-proof/${proofId}/business-proof.json`);
const proofManifest = await json(`output/business-proof/${proofId}/manifest.json`);
const proofDirectory = path.join(root, 'output/business-proof', proofId);
const expectedAttachments = ['business-proof.json', 'proof-report.md', ...['child-snacks', 'pet-snacks'].flatMap(id =>
  ['questionnaire.json', 'presets.json', 'survey-run.json', 'logic-audit.json', 'raw-responses.json', 'statistics.json', 'prompts.txt'].map(name => `${id}/${name}`))];
if (proofManifest.id !== proofId || proofManifest.modelCalls !== 0 || !Array.isArray(proofManifest.files) || proofManifest.files.length !== expectedAttachments.length
  || new Set(proofManifest.files.map((file: { name: string }) => file.name)).size !== expectedAttachments.length
  || proofManifest.files.some((file: { name: string }) => !expectedAttachments.includes(file.name))) throw new Error('业务附件集合/重复/运行身份不匹配。');
for (const file of proofManifest.files) {
  const target = path.resolve(proofDirectory, file.name);
  if (!target.startsWith(proofDirectory + path.sep) || !(await realpath(target)).startsWith(proofDirectory + path.sep)) throw new Error('业务附件manifest路径越界。');
  const bytes = await readFile(target);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`业务附件字节未通过：${file.name}`);
}
const businessFiles = Object.fromEntries(await Promise.all(expectedAttachments.map(async name => [name, await readFile(path.join(proofDirectory, name))] as const)));
const verifiedBundle = verifySubmissionArtifacts({ proofId, proof, manifest: proofManifest, files: businessFiles });
const metrics = await json('public/submission/metrics.json');
const realBaseline = parseSurveyEvidenceWithVerification(await json('public/submission/live-run.json')).run;
const sources = await json('public/submission/sources.json');
const science = await json('data/research/persona-source-register.json');
const verificationSchema = z.object({ schemaVersion: z.literal('1.0'), kind: z.literal('city-agent-engineering-verification'),
  checkedAt: z.string().datetime(), status: z.literal('engineering-passed-quality-not-tested'), realModelCalls: z.literal(0),
  unit: z.object({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), failed: z.literal(0), durationMs: z.number().nonnegative(), log: z.literal('output/review-next-final-unit.tap') }).strict(),
  browser: z.object({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), failed: z.literal(0), durationSeconds: z.number().nonnegative(), log: z.literal('output/review-next-final-browser.log') }).strict(),
  builds: z.object({ localExitCode: z.literal(0), pagesExitCode: z.literal(0) }).strict(),
  doctor: z.object({ ready: z.literal(true), log: z.literal('output/review-next-doctor.json') }).strict(),
  pagesSmoke: z.object({ passed: z.literal(true), freshModelCalls: z.literal(0), forbiddenRequests: z.literal(0), pageErrors: z.literal(0), log: z.literal('output/review-next-final-pages-smoke.log') }).strict(),
  realModelQuality: z.literal('not-tested'), externalValidity: z.literal('not-validated'), publishing: z.literal('not-performed'),
}).strict().refine(report => report.unit.total === report.unit.passed && report.browser.total === report.browser.passed, '通过数必须等于本批测试分母');
const verification = option('verification') ? verificationSchema.parse(await json(option('verification')!)) : { status: 'pending-final-verification', checks: [] };
const cases: { id: string; run: SurveyRun; audit: ReturnType<typeof auditBusinessDemoRun> }[] = [];
for (const id of ['child-snacks', 'pet-snacks']) {
  const input = await json(`output/business-proof/${proofId}/${id}/survey-run.json`);
  const { run } = parseSurveyEvidenceWithVerification(input);
  const audit = await json(`output/business-proof/${proofId}/${id}/logic-audit.json`);
  parseBusinessProofSnapshot({ schemaVersion: '1.0', kind: 'business-demo-proof', execution: 'fixture-only', realModelCalls: 0, run, logicAudit: audit });
  if (run.task.id !== `business-${id}` || run.experiment?.arm !== id || run.experiment.id !== proof.proofVersion) throw new Error('业务目录场景、冻结任务与实验臂不一致。');
  const recomputed = auditBusinessDemoRun(run, audit.rules);
  if (fingerprint(recomputed) !== fingerprint(audit) || audit.passed !== 12 || audit.failed !== 0 || run.mode !== 'fixture' || run.metrics.modelCalls !== 0) throw new Error('业务证据复算失败；不生成通过申报。');
  const prefix = `output/business-proof/${proofId}/${id}`;
  for (const [file, expected] of [['questionnaire.json', run.task], ['presets.json', run.presetSnapshots], ['raw-responses.json', run.responses],
    ['statistics.json', { summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }]] as const) {
    if (fingerprint(await json(`${prefix}/${file}`)) !== fingerprint(expected)) throw new Error(`业务附件与冻结run不一致：${id}/${file}`);
  }
  const prompts = `SYSTEM\n${run.prompt.system}\n\n${run.prompt.users.map(user => `RESIDENT ${user.residentId} SHA256 ${user.hash}\n${user.text}`).join('\n\n')}`;
  if (await readFile(path.join(root, prefix, 'prompts.txt'), 'utf8') !== prompts) throw new Error('可读Prompt附件与冻结run不一致。');
  const report = proof.cases?.find((item: { demoId: string }) => item.demoId === id);
  if (!report || report.questions !== run.task.questionnaire.questions.length || report.planned !== run.profiles.length || fingerprint(report.metrics) !== fingerprint(run.metrics)
    || report.independentLogicPassed !== audit.passed || report.realModelQuality !== 'not-tested' || report.personaBehaviorValidated !== false || report.businessRecommendation !== 'not-supported') throw new Error('业务总账与冻结证据或效度边界不一致。');
  cases.push({ id, run, audit });
}
if (proof.id !== proofId || proof.mode !== 'fixture' || proof.modelCalls !== 0 || proof.apiCostCny !== 0 || proof.personaBehaviorValidated !== false || proof.businessRecommendation !== 'not-supported') throw new Error('业务总账边界不合法。');
await mkdir(directory); // exclusive: intentionally fails rather than overwriting any existing candidate
for (const name of [...expectedAttachments, 'manifest.json']) {
  const destination = path.join(directory, 'business-proof', name); await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(proofDirectory, name), destination, { errorOnExist: true });
}
await mkdir(path.join(directory, 'methods'));
for (const [source, target] of [
  ['docs/research/RESIDENT-CONSTRUCTION-METHOD.md', 'resident-construction.md'], ['docs/population/METHODOLOGY.md', 'population-methodology.md'],
  ['docs/research/BUSINESS-PROOF.md', 'business-proof.md'], ['docs/research/EVALUATION-NEXT.md', 'evaluation-next.md'], ['docs/guides/JUDGE-QUICKSTART.md', 'judge-quickstart.md'],
] as const) await cp(path.join(root, source), path.join(directory, 'methods', target));
await cp(path.join(root, 'data/research/persona-source-register.json'), path.join(directory, 'persona-source-register.json'));
await cp(path.join(root, 'public/submission/sources.json'), path.join(directory, 'population-sources.json'));
await cp(path.join(root, 'public/submission/population-pack.json'), path.join(directory, 'population-pack.json'));
await cp(path.join(root, 'public/submission/sources'), path.join(directory, 'sources'), { recursive: true, errorOnExist: true });
await mkdir(path.join(directory, 'historical'));
for (const name of ['live-run.json', 'metrics.json', 'evaluation-summary.json', 'experiment-runs.json', 'prior-attempts.json', 'delivery-attempts.json', 'milestone.json']) await cp(path.join(root, 'public/submission', name), path.join(directory, 'historical', name));
const oldPersona = path.join(root, 'output/persona-proof/abfe1fd7-e1aa-4aba-a7ea-207088e9f14d');
await mkdir(path.join(directory, 'historical/persona-proof'));
for (const name of ['survey-run.json', 'questionnaire.json', 'manifest.json', 'persona-proof.json', 'proof-report.md', 'presets.json']) {
  await cp(path.join(oldPersona, name), path.join(directory, 'historical/persona-proof', name), { errorOnExist: true });
}
await cp(path.join(root, 'docs/research/PERSONA-PROOF.md'), path.join(directory, 'methods/old-persona-proof.md'));
if (option('video')) {
  await cp(path.join(root, option('video')!), path.join(directory, 'demo-next.mp4'));
  const recorderFolder = path.basename(option('video')!, '.mp4').replace(/^demo-next-/, '');
  for (const name of ['captions.json', 'demo-next.vtt', 'recorded-child-proof.json', 'recorded-pet-proof.json']) await cp(path.join(root, 'output/review-video', recorderFolder, name), path.join(directory, name));
}
await writeFile(path.join(directory, 'verification.json'), JSON.stringify(verification, null, 2), { flag: 'wx' });
const generatedAt = new Date().toISOString();
const demoUrl = 'https://litianyi-007.github.io/city-agent/';
const esc = (input: unknown) => String(input ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (href: string, label: string) => `<a href="${esc(href)}">${esc(label)}</a>`;
const table = (headers: string[], rows: unknown[][], small = false) => `<table${small ? ' class="small"' : ''}><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const page = (number: string, title: string, content: string) => `<section class="sheet"><div class="eyebrow">CITY AGENT / 候选申报补充版 · ${number}</div><h2>${esc(title)}</h2>${content}</section>`;
const note = (text: string) => `<aside>${esc(text)}</aside>`;
const baseline = metrics.baseline;
const content: string[] = [];
content.push(page('01', 'City Agent：可追溯的虚拟社会调查', `
  <div class="hero">滨江人口证据 × 五层情景居民<br/>冻结问卷 → 独立答卷 → 可回放结果</div>
  <div class="entrance"><strong>项目体验入口</strong><p>${link(demoUrl, demoUrl)}</p><p>公开入口无需安装和Key，可查看旧里程碑实测与规则演示。</p><p><strong>本候选新增功能：</strong>本机 http://127.0.0.1:4320/#research<br/>评审后发布；当前公网仍是冻结旧版，不伪称新增功能已上线。</p></div>
  <p>定位：企业研究前测工具，而非真人市场调查替代品。面向问卷设计、生活情景覆盖、矛盾定位与补采规划，避免将合成答案当作真实消费者发现。</p>
  ${table(['申报要求', '本材料与附件'], [['数据来源、人群及角色构建', '第2–4节；来源清单、官方原件、五层方法、每人画像'], ['仿真问卷与结果（重点）', '两套17/18题完整问卷；各12份raw、Prompt、分组与跨题复核'], ['技术与运行数据', 'Harness SDK版本、参数与成本口径；历史真实实验与新fixture分列'], ['体验、演示、创新与价值', '显眼入口、实际浏览器录屏、安装步骤、限制与路线图']])}
  ${note('本候选材料生成时间：' + generatedAt + '。正式申报回执未取得；本文件不是提交成功凭证。旧Tag submission-milestone-2026-10-07 与原8页PDF保留，不回填旧截止时间。')}`));
content.push(page('02', '人口来源与跨区域录入方法', `
  ${table(['观测', '统计时点 / 分母 / 原表定位', '可用范围'], [['503,859常住人口；西兴143,318 / 长河168,276 / 浦沿192,265', '2020-11-01七普；年鉴街道人口、年龄与性别表', '历史街道框；不是2026实时坐标'], ['55.2 / 55.9万人', '2024 / 2025年末公报第3页；2025为1%抽样推算', '发布精度0.1万人；不能无条件外推旧街道结构'], ['家庭户165,654户；家庭户人口395,911；均值2.39', '年鉴PDF118 / 印刷110，表1-3', '不能推出三口之家、有小学子女或养宠'], ['3岁及以上教育表489,131人', '年鉴PDF122 / 印刷114，表1-7，含在校口径', '不能等同已获学位或当前小学生'], ['小学21所；38,394 / 39,949在校生', '2024 / 2025公报第8页；分母在校生', '不是居民儿童/家长数、招生片区或客流'], ['年人均可支配收入85,734 / 89,266元', '2024 / 2025公报第8页；元/(人·年)', '不是个体税前工资/家庭收入/商品预算']])}
  <h3>新区域也可复用的两本账</h3><ol><li>人口校准账：固定行政边界、年份、常住/户籍、单位与年龄范围；官方原件留底并记录URL、SHA-256、页表行列。</li><li>核对总数、单位、分母、重复来源与分类crosswalk；保留未知项，不拿转载作第二独立调查。</li><li>已有联合表优先；本版街道内年龄×性别仅独立性推断 infer，24个逻辑单元。未实施IPF或五层联合拟合。</li><li>情景覆盖账：选不同决策/生活情景，记录纳入理由、资格假设、模型和seed。目标分母缺失时不赋总体权重。</li><li>发布新版本前人工核验原件、差异及敏感性；记录撤销/失效，不静默更新历史画像与运行。</li></ol>
  <p>${link('population-sources.json', '人口来源清单')} · ${link('population-pack.json', '当前冻结人口包')} · ${link('methods/population-methodology.md', '完整跨区方法论')}。</p><p>官方原件：${link('sources/binjiang-census-yearbook.pdf', '2020七普年鉴')} · ${link('sources/binjiang-2024-communique.pdf', '2024公报')} · ${link('sources/binjiang-2025-communique.pdf', '2025公报')}。</p>
  ${note('fact=原表/算术事实；infer=明确联合推断；assumption=情景资格与五层设定；generated=模型回答。来源可信、统计转录正确和偏好外部效度是三个不同问题。哈希不认证现实真实性。')}`));
content.push(page('03', '人群构建：五层独立轴，不作DNA因果推断', `
  ${table(['层', '可配置与未知', '禁止自动推断'], [['1 基础人格倾向', 'Big Five：开放性、尽责性、外向性、宜人性、情绪稳定性；null为未知；0–100仅情景刻度；支持自定义描述', '不是DNA、百分位、诊断或量表实测'], ['2 生长环境', '主要照护结构；单亲/双亲/祖辈、迁居、寄宿等多选；可说明不同时间段', '家庭标签不推出人格或商品喜好'], ['3 教育', '已完成教育、在读与补充经历分别说明', '学历不等于智力、工资或购买能力'], ['4 当前家庭', '关系状态、同住组成、照护与购买/许可职责多选', '单身≠独居；已婚≠有小学生；独居≠养猫'], ['5 社会分工与收入', '就业/学习状态、职业、社会角色；收入区间附币种、周期与个人税前/家庭可支配口径', '地区产业比例≠职业比例；收入≠零食预算']])}
  <h3>科学依据与适用边界</h3><p>${link('https://www.ocf.berkeley.edu/~johnlab/bfi.html', 'BFI-2原作者')}提供五维与15细分面向，商业使用需授权；本项目不复制其量表题项。${link('https://www.ipip.ori.org/', 'IPIP公共领域')}是未来题项备选，不证明中文/儿童/滨江适用性。</p>
  <p>${link('https://pubmed.ncbi.nlm.nih.gov/25961374/', '人格遗传元分析')}约0.40是研究人群差异的估计，不是个体40%DNA，更不能变成agent混合系数。${link('https://hexaco.org/hexaco-inventory', 'HEXACO')}为另一六维组织，不与Big Five简单拼分。</p>
  <p>整个五层对象在当前schema中固定 provenance=assumption。人口背景事实在独立登记中，不会因为选择预设而成为该居民真实经历。所有未知默认留空，不填“平均人格50”。</p>
  <h3>来源不能代替本地验证</h3><p>${link('https://arxiv.org/abs/2411.10109v3', 'Park等自报agents研究，v3')}使用1,052名美国参与者的访谈/结构自报；其相对人类重测基准不是本项目准确率。${link('https://doi.org/10.1017/pan.2023.2', 'Argyle条件仿真')}与${link('https://doi.org/10.1017/pan.2024.5', 'Bisbee反证')}共同提示：均值相似不保证差异、相关结构或跨文化效度。当前没有滨江真人留出集。</p>
  <p>${link('persona-source-register.json', '12项原始来源与13项背景观测登记')} · ${link('methods/resident-construction.md', '完整五层构建方法、许可与反证')}。</p>`));
content.push(page('04', '人群Agent与研发角色：构建、抽样、冻结', `
  <p>两种角色分开管理：调查居民具有目标资格、五层情景与独立模型配置；产品/研发/测试/研究员用于本机任务编排。复制预设会生成新ID，不创造真实居民或真实人口份额。</p>
  ${table(['步骤', '当前实现', '证据边界'], [['新增/勾选/自定义', '五层表单、探索组合、模型Provider/Base URL/Model ID、页面输入Key、编辑/复制', '均为情景假设，资格单独设置'], ['业务场景四份预设', '每份3画像；本次小学照护者及猫/犬/共同采购者分别冻结', '无真实养宠率/照护者总体分母'], ['人口与资格相交', '18+及task/preset filters按AND校验；单元/街道/年龄/性别及资格镜像复核', '2020宽年龄档不能识别精确18+分母'], ['覆盖抽样', `seed=${proof.seed}，12个画像，预设轮转；不按真实总体加权`, '样本只用于工程情景覆盖，不计算真人置信区间'], ['画像到Prompt', '冻结persona→profile→user prompt→raw；任务、人口、画像与规则hash可复算', '哈希不是实际真人或供应商调用身份认证'], ['逐答卷独立执行', '本机真实居民任务经Harness SDK；公网真实模式浏览器直连', '共享模型可能相关，独立请求不等于独立真人']])}
  <h3>本次五层预设摘要</h3>${table(['预设', '五层情景（完整JSON随附件）'], cases[0].run.presetSnapshots!.map(preset => [preset.name, preset.description]), true)}
  <p>所有预设不预写低糖偏好、猫狗主营、价格预算、品牌或铺位。五层在fixture中进入冻结Prompt，但夹具作答不读取其人格/收入等值，因此本次不能证明人格对真实作答的贡献。</p>
  ${note('完整业务一键自证不读当前草稿/Key、不用后端SQLite、不请求供应商。可应用问卷与四份无Key预设为新草稿，但不会自动保存或启动调查；更改问卷后不可沿用原自证结论。')}`));
for (const item of cases) {
  const questions = item.run.task.questionnaire.questions;
  for (let offset = 0; offset < questions.length; offset += 9) {
    const rows = questions.slice(offset, offset + 9).map(question => {
      const options = 'options' in question ? question.options.map(option => `${option.id}: ${option.label}`).join('；') :
        question.type === 'text' ? `文本最多${question.maxLength ?? '默认'}字；可选题允许null` : `${question.min}–${question.max}${'unit' in question ? ' / ' + question.unit : ''}；可选题允许null`;
      return [question.id, `${question.type} / ${question.required ? '必答' : '可选'}`, question.prompt, options];
    });
    content.push(page(item.id === 'child-snacks' ? `05.${offset / 9 + 1}` : `06.${offset / 9 + 1}`, `${item.id === 'child-snacks' ? '小学生照护者' : '宠物零食'}完整问卷 · ${offset + 1}–${Math.min(offset + 9, questions.length)}题`, `
      <p>${esc(item.run.task.decisionContext.offering)}</p>${table(['稳定ID', '题型', '完整问题', '选项 / 单位 / 边界'], rows, true)}
      <p>${link(`business-proof/${item.id}/questionnaire.json`, '冻结原始完整问卷JSON')} · ${link(`business-proof/${item.id}/presets.json`, '无Key五层预设')}。</p>
      ${note(item.id === 'child-snacks' ? '本轮受访者为假设成年照护者，不直接调查儿童。许可、购买与儿童本人口味分开，未采集的儿童原文用null。' : '对象是宠物辅助零食，不是猫粮/狗粮主粮。规格统一为50克再比较价格；物种、采购角色和网上履约分别测量。')}`));
  }
}
for (const item of cases) {
  content.push(page(item.id === 'child-snacks' ? '07' : '08', `${item.id === 'child-snacks' ? '小学照护者' : '宠物零食'}结果 · synthetic工程数表`, `
    <p>run ID：<code>${esc(item.run.id)}</code><br/>${item.run.task.questionnaire.questions.length}题×12画像；结构有效12/12，登记跨题规则通过${item.audit.passed}/12。模型调用0；input/output Token各0；API费用¥0（不含本机计算）。执行耗时${item.run.durationMs.toFixed(3)}ms，不含文件写入、页面渲染和录屏。</p>
    ${table(['题ID', '非null分母 / 12；缺失', '确定性结果（非市场偏好）'], item.run.summaries.map(summary => [summary.questionId, `${summary.denominator}/12；${summary.missing}`, summary.choices ? summary.choices.map(choice => `${choice.label}=${choice.count}`).join('；') : summary.mean !== undefined ? `均值${summary.mean.toFixed(2)}；中位数${summary.median?.toFixed(2)}；${summary.unit ?? ''}` : '逐份原文或null见附件']), true)}
    <p>每场景不购买3份、未知意向3份；预算明确0有3份、未知/未定null有6份。“不知道”选项计入非null答卷但在数表中单列；多选总数可以大于分母。数值统计不把null填0。</p>
    <p>${link(`business-proof/${item.id}/survey-run.json`, '画像、Prompt与完整raw')} · ${link(`business-proof/${item.id}/logic-audit.json`, '独立跨题审计')} · ${link(`business-proof/${item.id}/statistics.json`, '完整街道/预设分组统计')}。</p>
    ${note(item.id === 'child-snacks' ? '儿童本人口味12/12为null；不能把家长许可当作“滨江孩子爱吃谷物/水果”的结论。' : '本轮猫/犬情景数量为人为覆盖，不是猫狗真实占比；10/20元追问不是随机价格试验，不能确定现实主营品类与价位。')}`));
}
content.push(page('09', '历史真实模型实验：独立口径与负结果', `
  <p>旧里程碑真实实验用于证明模型问卷链路曾经运行，不证明这两套新业务问卷或五层人格有效。旧15题AI会员案例、原始参数、失败与SDK记账勘误保持原样。</p>
  <p>冻结模型：${esc(realBaseline.models.map(model => `${model.provider} / ${model.modelId} / ${model.baseUrl}`).join('；'))}。maxOutputTokens=${realBaseline.parameters?.maxOutputTokens}；timeoutMs=${realBaseline.parameters?.timeoutMs}；concurrency=1；retries=0；answerCache=false；temperature/providerSeed未设置；thinking disabled。参数声明不是独立底层权重认证。</p>
  ${table(['实验', '记录', '解释'], [['真实基准12×15', `${baseline.valid}/${baseline.planned}有效；${baseline.modelCalls}调用；${(baseline.durationMs / 1000).toFixed(2)}秒`, '合成一般成年居民；不是家长/宠物新问卷'], ['真实基准usage与费用', `${baseline.inputTokens}输入 + ${baseline.outputTokens}输出 = ${baseline.inputTokens + baseline.outputTokens}Token；估算¥${baseline.apiCostCny}`, '历史用户单价CNY2/8每百万Token；非当前价格或账单'], ['当前49次居民实验', '44有效、5无效；84,916输入 / 13,120输出；估算¥0.274792', '不含早期尝试/研发角色；不可与新fixture合并算通过率'], ['重复五次的3画像', '有效率5/5、1/5、3/5；仅1/3达到4/5诊断', '不稳定性保留，不能宣称普遍一致'], ['独立19→29元价格条件', '3人条件：1/3→2/3', '小样本负向/反直觉结果；不是涨价促进真实销量'], ['早期14批 / 51调用', 'SDK缓存输入与中断usage存在缺失；全量成本未知', '保留原文与勘误，不回填0'], ['四角色自动开发', '历史6次真实最终Gate均失败', 'L4/L5仍另一分支推进，不冒充本题已成功交付']])}
  <p>旧五层16题夹具存在两份“选择不购买却有正预算”反例（resident-005 / 009）。${link('historical/persona-proof/survey-run.json', '旧16题完整raw与统计')}与${link('methods/old-persona-proof.md', '原自证说明')}随包保留。本次以新policy/问卷/UUID建立新工程样例，未篡改或删除旧反例。本次工程规则通过不能覆盖历史模型无效答卷。</p>
  <p>${link('historical/live-run.json', '旧真实12人证据')} · ${link('historical/experiment-runs.json', '全部当前实验')} · ${link('historical/prior-attempts.json', '早期尝试与记账勘误')} · ${link('historical/metrics.json', '历史成本范围')}。</p>
  ${note('当前没有新增付费模型调用，也没有30人真实完整率实验、异构稳健性、五层消融或真人/交易留出结果。尚未验证的不能以工程12/12代替。')}`));
content.push(page('10', '技术点、参数与安全边界', `
  ${table(['项', '实现 / 本轮关键参数'], [['执行底座', '本机DeepSeek Harness SDK 0.1.5-rc.3，锁文件安装，无全局dsh/GPU要求；公网浏览器直连不是Harness'], ['模型身份', '每人Provider/Base URL/Model ID独立；selector记录非权重指纹。新fixture modelId=fixture-no-model，无实际请求'], ['本次工程参数', `固定count=12；seed=${proof.seed}；四情景轮转；无答案缓存/重试；显式fixturePolicyId；0付费调用`], ['Prompt', 'system与逐人user原文/hash随附件冻结；人口、资格、五层假设与问卷各有血缘'], ['回答校验', '五题型、题目/选项ID、必答、数值边界、空白文本、资格AND；raw到answers/summary重算'], ['独立业务逻辑', '互斥选项；不购买→预算0/无渠道；未知→null；无儿童直接证据→口味null；猫犬品类约束；只检查登记规则'], ['安全修复', 'Provider/Base URL变化清旧Key；规划入/出Unicode脱敏；已知凭据不能写公开元数据；严格预设导入'], ['导入与评分', '校验sampling/structural/coherence/populationAudit不信任展示字段；独立verification版本，不改原raw/version'], ['预算与成本', '真实任务显式确认并设调用/Token预算；usage/单价缺失为null。工程API费用0不等于本机计算免费']])}
  <p>Key仅在页面模型配置栏输入；本机加密存储仍需保护同机密钥文件。Pages Key仅当前内存会话，刷新清除；公开元数据不保存Key。跨域供应商可能拒绝浏览器调用，此时改走本机Harness，不关浏览器安全。</p>
  <p>复算器拒绝空审计假通过、缺失/重复答卷或伪造结构标志。规则合法不等于全面语义认证，prompt/raw一致也不认证真人身份。新业务完整proof另存IndexedDB，刷新后使用原规则复核，而非套用当前规则。</p>`));
content.push(page('11', '验收门限、现实缺口与后续能力', `
  ${table(['层次', '门限', '状态'], [['工程业务自证', '两场景各12/12结构和显式逻辑；0请求；raw/统计/hash可复算；未知与不购买保留', '本轮满足；只证明工程'], ['真实模型完整率', '预登记10人冒烟→单批30人≥29有效，所有计划居民为分母且遵守预登记阈值', '未执行新付费批次；live API当前最多12'], ['内部语义与稳健性', '盲评、措辞/题序/seed/重复/异构模型与简单基线，报告差异和失败', '预登记工具完成；新五层贡献未验'], ['儿童口味与选址', '独立儿童合意/監护授权、资格分母、候选点/客流/规则/预算试售', 'needs-data；只做成年人情景'], ['宠物网点与价位', '养宠及零食购买者分母、匿名订单密度、统一SKU规格、租金/履约/毛利/试售', 'needs-data；不输出主粮比例'], ['现实外部效度', '合法独立真人/交易留出；总体与分组误差及相对简单基线', '未获得本地验证资料'], ['发布与申报', '候选端到端验收后发布固定ref；正式入口与回执留档', '待用户确认；不移动旧Tag']])}
  <h3>明确作为规划提交的能力</h3><p>仿Chainlink的“现实桥”思路采用MCP数据适配，不要求使用区块链：来源/地区/时点绑定、候选版本、人工核验、失效/撤销与历史重放。只将可追溯外部观测映射到群体，不把生成答案回流成事实。</p>
  <p>居民/城市/项目记忆隔离，kata wiki/dream用于摘要和重估；dream不得改写事实或制造真实经历。有限自主接管需轮次/Token/工具权限与串话边界。家庭社交演化、IPF联合拟合均未实施，列为下一阶段。</p>
  <p>L4/L5自动开发与虚拟社会分别在独立worktree/branch推进；共享契约是冻结研究证据manifest，不让另一目标的失败或承诺混入本题成功指标。</p>`));
content.push(page('12', '评委操作、安装与创新 / 业务价值', `
  <h3>三分钟可完成的零费用操作</h3><ol><li>本候选打开调查页→“完整业务示例 · 零费用体验”。选择小学或宠物17/18题问卷。</li><li>点“运行完整业务自证 · 0 API费用”；回查12人、未知、分母、原始答卷与逻辑规则。</li><li>导出完整自证并刷新，通过历史恢复原规则与答卷。应用示例到草稿只创建无Key预设，不自动调用。</li><li>查看人口来源与旧真实实验；配置真实Key后另行显式预算确认。无Key也能完成上述流程。</li></ol>
  <h3>本机Harness准备</h3><p>Git、Node22.22.3（项目实测；最低22.19.0）、npm下载网络。无需本地GPU、模型权重或全局dsh。随报告另交city-agent-review-source.zip：解压到新目录并检查SOURCE-SNAPSHOT.json字节清单，再执行下列命令。该ZIP是未公开候选快照，不把本地分支当成已发布GitHub版本；正式发布后补固定ref。</p><pre>npm ci\nnpm run setup\nnpm run build\nnpm run doctor\nnpm run start:review\n# http://127.0.0.1:4320/#research</pre>
  <p>macOS本机已工程实测，Windows/Linux干净机器未验；网络/Chromium/共享库/端口异常详见${link('methods/judge-quickstart.md', '安装与故障指南')}。旧公开Tag只有npm start与4310，不具新增doctor/start:review。</p>
  <h3>创新点与业务价值</h3><p>① 把人口校准与情景覆盖分账，展示事实、推断、假设及生成结果的不同可信边界。② 将五层配置、资格、Prompt、raw与成本连接成可回查链。③ 让未知/不购买/矛盾/失败成为可见结果，而非补成成功。④ 将自然语言候选、业务证据缺口与跨题规则接入同一前测流程。</p><p>业务价值是减少遗漏资格/口径、改善问卷与补采优先级，支持可重复的假设压力测试。尚无真人准确率、ROI或销量增益证据，不承诺替代现实调研、直接推荐铺位或无人研发成功。</p>
  ${option('video') ? `<p>${link('demo-next.mp4', '新版实际浏览器录屏（约4分钟，画面字幕）')}；录屏不输入Key、不假演实时模型调用。</p>` : '<p>新录屏待补；旧254秒实际录屏仍保留，未将其当作五层新功能展示。</p>'}`));
const scientificRows = science.sources.map((source: { id: string; title: string; url: string; version: string }) => `<li>${esc(source.id)} · ${link(source.url, source.title)}<br/><small>${esc(source.version)}</small></li>`).join('');
content.push(page('13', '来源、附件与评审复算入口', `
  <p>官方统计源见${link('population-sources.json', '人口来源清单')}；2020年鉴、2024/2025公报原PDF保留于旧公开材料。2024发布日期未核齐，维持未知。科学来源登记含访问范围、许可和不支持的推断：</p><ol class="references">${scientificRows}</ol>
  <h3>附件索引</h3><p>${link('business-proof/business-proof.json', '本轮自证总账')} · ${link('business-proof/manifest.json', '业务附件16项字节哈希')} · ${link('verification.json', '本轮工程核验日志')} · ${link('manifest.json', '申报候选全包manifest')}。</p><p>各场景含questionnaire、presets、survey-run、raw-responses、statistics、logic-audit与prompts；历史目录保留旧真实实验、usage与勘误。录屏仅展示实际UI操作，字幕是说明叠加，不是系统返回。</p>
  ${note('材料生成不代表正式提交。PDF附件链接指向未发布的候选/submission-next，当前公网不能据此打开新附件；请用随附ZIP中的index.html相对打开，或待发布后统一复验。旧公开入口和本地候选有明确版本差异；正式现场审查应选择同一固定版本的源码、Demo、材料与录屏，不混用新材料和旧功能。')}`));
const css = `@page{size:A4;margin:15mm 14mm 18mm}*{box-sizing:border-box}body{margin:0;color:#17343d;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:11px;line-height:1.65;background:#edf3f3}.sheet{background:white;max-width:770px;margin:20px auto;padding:35px 38px;break-after:page}.sheet:last-child{break-after:auto}h2{font-size:22px;margin:9px 0 17px;line-height:1.4}h3{font-size:14px;margin:15px 0 7px}.eyebrow{font-size:10px;color:#427b77;letter-spacing:1px}.hero{font-size:29px;font-weight:650;line-height:1.6;margin:27px 0}.entrance{background:#e6f2ee;border-left:5px solid #24785f;padding:15px 20px;margin:18px 0}p{margin:9px 0}aside{padding:11px 14px;background:#fff5e1;border-left:3px solid #bc9138;font-size:10px;margin:14px 0}table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:fixed;font-size:10px;line-height:1.6}table.small{font-size:9px;line-height:1.6}th{text-align:left;background:#edf4f3;color:#285950}td,th{padding:7px 8px;border:1px solid #d5e2de;vertical-align:top;overflow-wrap:anywhere}table.small td,table.small th{padding:5px 7px}tr{break-inside:avoid}a{color:#126c59;overflow-wrap:anywhere}code,pre{font-family:Menlo,monospace;font-size:9px;overflow-wrap:anywhere}pre{background:#f0f4f5;padding:12px;white-space:pre-wrap}ol{padding-left:19px}li{margin:8px 0}.references li{font-size:9px;margin:7px 0}.references small{font-size:8px;color:#56716e}@media print{body{background:white}.sheet{margin:0;max-width:none;padding:0}a{text-decoration:none}}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Agent · 新版候选申报材料</title><style>${css}</style></head><body>${content.join('\n')}</body></html>`;
await writeFile(path.join(directory, 'index.html'), html, { flag: 'wx' });
const toMarkdown = (section: string) => section.replace(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/g, (_match, header: string) => {
  const count = (header.match(/<th>/g) ?? []).length;
  return `<tr>${header}</tr>\n| ${Array(count).fill('---').join(' | ')} |\n`;
}).replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)')
  .replace(/<h2>/g, '\n\n## ').replace(/<h3>/g, '\n\n### ').replace(/<li>/g, '\n- ').replace(/<\/p>|<\/aside>|<\/table>/g, '\n\n')
  .replace(/<br\/?\s*>/g, '\n').replace(/<tr>/g, '\n| ').replace(/<\/t[hd]>/g, ' | ').replace(/<[^>]*>/g, '')
  .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const md = ['# City Agent：新版候选申报材料', '', `体验入口：${demoUrl}`, `候选生成：${generatedAt}；新能力仅本机，未声称公网已更新或正式提交。`, '', ...content.map(toMarkdown)].join('\n\n');
await writeFile(path.join(directory, 'project-materials.md'), md, { flag: 'wx' });
await writeFile(path.join(directory, 'README.md'), `# 候选申报包（非提交回执）\n\n首先打开 project-materials.pdf 或 index.html。\n\n公开入口：${demoUrl}（旧冻结里程碑）；新增功能为本地候选，尚未发布。\n本包不含程序安装源代码、Key或私有数据库；新工具需待交付固定源码ref再按methods/judge-quickstart.md复现。\n\n重点附件：business-proof/*/questionnaire.json、presets.json、survey-run.json、raw-responses.json、statistics.json、logic-audit.json、prompts.txt。historical保留旧真实批次与勘误。sources为官方PDF原件。\n\nmethods/*.md从源码留底，内部相对文档链接以源码树为准；主PDF及HTML已包含必要独立说明。manifest记录字节一致性，不认证现实真值。\n\n本批真实模型调用0，不含任何新增市场/人格效度证据。\n`, { flag: 'wx' });
const browser = await chromium.launch(); const tab = await browser.newPage();
await tab.setContent(html, { waitUntil: 'load' });
await tab.evaluate(() => { const base = document.createElement('base'); base.href = 'https://litianyi-007.github.io/city-agent/submission-next/'; document.head.prepend(base); });
const pdfDirectory = path.join(root, 'output/pdf'); await mkdir(pdfDirectory, { recursive: true });
const pdfPath = path.join(pdfDirectory, `city-agent-review-${proofId}.pdf`);
await tab.pdf({ path: pdfPath, format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font:8px Arial;width:100%;text-align:center;color:#637888">CITY AGENT · REVIEW CANDIDATE · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
await browser.close(); await cp(pdfPath, path.join(directory, 'project-materials.pdf'));
const files: { name: string; bytes: number; sha256: string }[] = [];
async function scan(dir: string) {
  for (const name of (await readdir(dir)).sort()) {
    const file = path.join(dir, name); if ((await stat(file)).isDirectory()) await scan(file);
    else { const bytes = await readFile(file); files.push({ name: path.relative(directory, file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
}
await scan(directory);
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: '1.0', kind: 'city-agent-review-candidate', generatedAt, proofId,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: true, branch: 'feature/virtual-society-next',
  releaseStatus: 'local-candidate-not-published', formalSubmission: 'not-confirmed', realModelCallsThisBatch: 0,
  publishedDemo: demoUrl, localDemo: 'http://127.0.0.1:4320/#research', frozenTag: 'submission-milestone-2026-10-07',
  historicalArtifactsModified: false, businessArtifactsVerification: verifiedBundle.verification, checksumMeaning: 'byte-integrity-not-source-or-execution-attestation', files }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ directory, pdfPath, generatedAt, files: files.length, modelCalls: 0, published: false }, null, 2));
