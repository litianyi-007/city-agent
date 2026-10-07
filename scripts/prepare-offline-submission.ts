import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertPublicText } from '../shared/publishing-contract';
import { fingerprint, summarize } from '../shared/survey-engine';
import { parseSurveyEvidence } from '../src/run-history';
import { auditBusinessDemoRun } from '../shared/research-demo';

// Offline-only, credential-free submission build. New outputs; no provider/store/publishing imports.
const root = path.resolve(import.meta.dirname, '..');
const submissionV2 = process.argv.includes('--submission-v2');
const id = submissionV2 ? '2026-10-07-offline-v2' : '2026-10-07-offline-v1';
const out = path.join(root, 'output/submission-offline', id);
const pdfPath = path.join(root, submissionV2 ? 'output/pdf/city-agent-submission-offline-2026-10-07-v2.pdf' : 'output/pdf/city-agent-submission-offline-2026-10-07.pdf');
const videoDir = path.join(root, 'output/submission-video/2026-10-07-offline-v1');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || !['--draft-only', '--submission-v2'].includes(args[0]))) throw new Error('仅支持固定v1、--draft-only或--submission-v2；不接受任意目标覆盖。');
const demo = 'https://litianyi-007.github.io/city-agent/#research';
const repo = 'https://github.com/litianyi-007/city-agent';
const branch = repo + '/tree/feature/virtual-society-next';
const detail = 'https://litianyi-007.github.io/city-agent/submission-next/index.html';
const trial = 'https://litianyi-007.github.io/city-agent/submission-contract11/';
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const esc = (s: unknown) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (url: string, label: string) => `<a href="${esc(url)}">${esc(label)}</a>`;
const payload = new Map<string, Buffer>();
const sources: { name: string; source: string; bytes: number; sha256: string }[] = [];
const read = async (name: string) => readFile(path.join(root, name));
const json = async (name: string) => JSON.parse((await read(name)).toString('utf8'));
const add = (name: string, b: string | Buffer) => {
  if (payload.has(name)) throw new Error('重复输出：' + name);
  const bytes = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (/\.(json|md|txt|html|vtt)$/.test(name)) assertPublicText(name, bytes.toString('utf8'));
  payload.set(name, bytes);
};
const copy = async (source: string, name: string, expected?: string) => {
  const p = path.join(root, source);
  if ((await lstat(p)).isSymbolicLink() || !(await realpath(p)).startsWith(root + path.sep)) throw new Error('源越界：' + source);
  const b = await readFile(p);
  if (expected && hash(b) !== expected) throw new Error('冻结源不符：' + source);
  add(name, b); sources.push({ name, source, bytes: b.length, sha256: hash(b) });
};
const oldManifest = await json('public/submission/milestone-files.json');
const proofManifest = await json('public/submission-next/business-proof/manifest.json');
const frozenCopy = async (name: string) => {
  const entry = oldManifest.files.find((e: any) => e.path === name);
  if (!entry) throw new Error('原里程碑没有登记：' + name);
  await copy('public/submission/' + name, 'evidence/baseline/' + name, entry.sha256);
};
for (const name of ['live-run.json', 'sample-questionnaire.json', 'prompts.txt', 'metrics.json', 'sources.json', 'population-pack.json', 'evaluation-summary.json', 'experiment-runs.json', 'prior-attempts.json', 'milestone.json', 'milestone-files.json']) {
  if (name === 'milestone-files.json') await copy('public/submission/' + name, 'evidence/baseline/' + name);
  else await frozenCopy(name);
}
for (const name of ['binjiang-census-yearbook.pdf', 'binjiang-2023-yearbook.pdf', 'binjiang-2024-communique.pdf', 'binjiang-2025-communique.pdf']) {
  const entry = oldManifest.files.find((e: any) => e.path === 'sources/' + name);
  await copy('public/submission/sources/' + name, 'sources/' + name, entry.sha256);
}
for (const file of proofManifest.files) await copy('public/submission-next/business-proof/' + file.name, 'evidence/business/' + file.name, file.sha256);
await copy('public/submission-next/business-proof/manifest.json', 'evidence/business/manifest.json');
for (const [source, target] of [
  ['docs/research/RESIDENT-CONSTRUCTION-METHOD.md', 'methods/resident-construction.md'],
  ['docs/population/METHODOLOGY.md', 'methods/population-methodology.md'],
  ['data/research/persona-source-register.json', 'methods/persona-source-register.json'],
  ['docs/research/CONTRACT-PUBLIC-RELEASE-2026-10-07.md', 'methods/release-verification.md'],
]) await copy(source, target);
const trialDir = 'output/contract-review-appendix/f736fda5-2b12-4918-b843-1421e1c76454/submission-contract11';
const trialManifest = await json(trialDir + '/manifest.json');
for (const f of trialManifest.files) await copy(trialDir + '/' + f.name, 'evidence/exploration/' + f.name, f.sha256);
await copy(trialDir + '/manifest.json', 'evidence/exploration/manifest.json');
const baseline = parseSurveyEvidence(await json('public/submission/live-run.json'));
if (baseline.mode !== 'live' || baseline.profiles.length !== 12 || baseline.task.questionnaire.questions.length !== 15 || baseline.metrics.modelCalls !== 12
  || fingerprint(summarize(baseline.task, baseline.responses)) !== fingerprint(baseline.summaries)) throw new Error('真实基准复算不符');
// These views derive ONLY from the real run, never sample-profiles.json (which belongs to a fixture).
add('evidence/baseline/actual-profiles.json', JSON.stringify(baseline.profiles, null, 2) + '\n');
add('evidence/baseline/raw-responses.json', JSON.stringify(baseline.responses, null, 2) + '\n');
add('evidence/baseline/recomputed-summaries.json', JSON.stringify(summarize(baseline.task, baseline.responses), null, 2) + '\n');
const businessRuns: any[] = [];
for (const scenario of ['child-snacks', 'pet-snacks']) {
  const run = parseSurveyEvidence(await json('public/submission-next/business-proof/' + scenario + '/survey-run.json'));
  const originalAudit = await json('public/submission-next/business-proof/' + scenario + '/logic-audit.json');
  if (run.mode !== 'fixture' || run.metrics.modelCalls !== 0 || run.profiles.length !== 12 || originalAudit.passed !== 12
    || fingerprint(auditBusinessDemoRun(run, originalAudit.rules)) !== fingerprint(originalAudit)) throw new Error('工程仿真复算不符：' + scenario);
  businessRuns.push(run);
}
const register = await json('data/research/persona-source-register.json');
const report = await json(trialDir + '/report.json');
const headline = baseline.summaries.find(s => s.questionId === 'version-choice')!;
if (headline.choices?.map(c => c.count).join(',') !== '5,3,0,1,3') throw new Error('基准套餐分布不符');

type Block = { html: string; md: string };
type Page = { title: string; kicker: string; blocks: Block[] };
const pages: Page[] = [];
const p = (text: string): Block => ({ html: `<p>${esc(text)}</p>`, md: text + '\n' });
const h = (text: string): Block => ({ html: `<h3>${esc(text)}</h3>`, md: '### ' + text + '\n' });
const rich = (html: string, md: string): Block => ({ html, md });
const note = (text: string): Block => ({ html: `<div class="note-box">${esc(text)}</div>`, md: '> ' + text + '\n' });
const table = (heads: string[], rows: string[][]): Block => ({
  html: '<table><thead><tr>' + heads.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>',
  md: '| ' + heads.join(' | ') + ' |\n| ' + heads.map(() => '---').join(' | ') + ' |\n' + rows.map(r => '| ' + r.map(c => c.replaceAll('|', '/')).join(' | ') + ' |').join('\n') + '\n',
});
const page = (title: string, kicker: string, ...blocks: Block[]) => pages.push({ title, kicker, blocks });
const entries = rich(`<div class="entries"><b>立即体验</b><p>${link(demo, demo)}</p><p>${link(branch, 'GitHub 源码与持续更新')} · ${link(detail, '完整在线材料')} · ${link(trial, '真实 API 追溯账本')}</p></div>`,
  `体验：${demo}\n\nGitHub：${branch}\n\n完整在线材料：${detail}\n\n真实API追溯：${trial}\n`);

page('City Agent\n可追溯虚拟人群研究工作台', 'PROJECT SUBMISSION / 2026.10.07',
  p('让城市研究从“模型给出一个答案”，走向“每个答案都有可复核的研究过程”。'), entries,
  rich('<div class="metrics"><div><strong>5 层</strong><span>可解释人群构建</span></div><div><strong>12 × 15</strong><span>真实 API 基准与完整问卷</span></div><div><strong>24 / 420</strong><span>工程答卷 / 题目槽位</span></div></div>', '核心交付：五层人群构建；12人×15题真实API基准；24条工程答卷/420个题目槽位。\n'),
  h('两项重点，一条自证主线'),
  p('重点一：以滨江官方人口资料为锚点，用五层独立画像、明确研究资格和可查来源组织目标人群。重点二：提供完整问卷、逐人原始答卷、可复算统计与实际界面录屏，评委可以从结果一路回查到题目和画像。'),
  h('交付内容'),
  table(['材料', '本包内容'], [
    ['项目报告', '数据来源、人群方法、完整15题问卷、真实基准结果、模型与成本、创新价值'],
    ['两场完整工程仿真', '小学照护者17题、宠物零食18题；画像、题库、原文、统计、规则和Prompt'],
    ['体验与视频', '零Key公开Demo；约4分钟新录屏；本机运行指南与GitHub入口'],
    ['离线追溯附件', '官方PDF、版本登记、真实API基准与探索账本、SHA-256文件清单'],
  ]),
  note('本报告把“真实API生成的合成回答”和“零费用工程仿真”分别展示。自证范围为研究流程与执行能力；消费者偏好、人格贡献和经营判断的独立真人/交易留出验证列为后续校准环节。'));

page('从城市人口到可复核研究', '01 / 背景与项目介绍',
  h('业务问题'),
  p('选址、选品、会员定价和城市服务研究，常常同时面临人口口径不统一、目标资格不清、问卷先入为主、结果难以追溯等问题。直接询问LLM可以迅速得到建议，却难以解释“谁回答、为什么回答、用的哪版数据、哪些判断只是假设”。'),
  h('解决方式'),
  p('City Agent将公开人口证据、可配置合成居民、问卷执行和证据导出组合成一个研究工作台。先界定研究对象与问题，再在可说明的情景中预演问卷、比较回答、暴露需要进一步核验的信息。'),
  table(['研究链条', '对应交付'], [
    ['官方来源 → 人口框', '统计时点、地理层级、常住/户籍、单位及原表定位'],
    ['人口框 → 人群预设', '五层生活背景、独立资格、未知项、每个Agent的模型配置'],
    ['预设 → 问卷执行', '单选、多选、量表、数值、开放题；冻结题面及Prompt'],
    ['回答 → 审计与统计', '原文、结构规则、登记跨题规则、有效与未知分母'],
    ['统计 → 研究交付', '分组结果、数据缺口、版本血缘、成本与可下载证据'],
  ]),
  h('三组互补证据'),
  p('A组：真实API历史基准展示12人×15题的逐人生成及汇总。B组：两套五层工程仿真展示当前交互、题库与规则链。C组：公开探索账本展示真实场景调用、诊断及停止记录。每组单独保留版本，不混用样本量和效度。'),
  note('合成居民是研究预演对象，不是实名数字分身。人群研究与产品、研发、测试、研究员等执行角色分开管理；角色标签本身不被当作自动研发交付的证明。'));

page('数据来源：官方原件与明确口径', '02 / 数据来源清单',
  table(['来源 / 原件', '采用的统计口径与定位', '研究用途'], [
    ['2020七普统计年鉴', '2020-11-01常住503,859人；西兴143,318 / 长河168,276 / 浦沿192,265', '历史街道、年龄、性别人口锚点'],
    ['2020年鉴家庭户表1-3', 'PDF118 / 印刷110页：165,654户；家庭户人口395,911；2.39人/户', '户与人分母分开登记'],
    ['2020年鉴教育表1-7', 'PDF122 / 印刷114页：3岁及以上489,131；专科91,920 / 本科137,064 / 研究生33,601', '按原表分类记录，含在校等口径'],
    ['2023统计年鉴', 'PDF10、28页：全区常住54.3万人与街道户籍表分栏', '近期背景、常住与户籍分辨'],
    ['2024统计公报', 'PDF3、8页：常住55.2万人；小学21所、38,394在校生；年人均可支配收入85,734元', '年度背景、教育与经济情景参考'],
    ['2025统计公报', 'PDF3、8页：常住55.9万人；小学21所、39,949在校生；年人均可支配收入89,266元', '最新已登记年度背景，人口为1%抽样推算'],
  ]),
  h('科学方法来源'),
  p('BFI-2原作者资料用于Big Five概念组织；IPIP为公共领域量表题项的参考入口。Park等生成式Agent与自报研究、Argyle等合成抽样、Bisbee等反证研究以及人口合成研究，为画像、模拟与外部校验设计提供依据。12条方法/背景来源与13条背景观测分别登记。'),
  rich('<p class="small">' + link('https://www.hhtz.gov.cn/art/2021/11/30/art_1229574517_3974310.html', '官方七普年鉴') + ' · ' + link('https://www.hhtz.gov.cn/col/col1229574514/art/2026/art_d79bffcf95f24e619178dd3acfaee081.html', '官方2025公报') + ' · ' + link('https://www.ocf.berkeley.edu/~johnlab/bfi.html', 'BFI-2原作者') + ' · ' + link('https://arxiv.org/abs/2411.10109v3', '自报Agent研究v3') + '</p>', '来源链接见evidence/baseline/sources.json及methods/persona-source-register.json；科学参考锁定原作者/原始论文版本。\n'),
  h('可迁移的新区域录入方法'),
  p('冻结区域与边界版本 → 收集官方原件 → 登记年份、单位、分母、发布精度、表/页 → 校验合计与分类 → 区分可观测联合与显式推断 → 建立人群覆盖情景 → 冻结版本并导出证据。新年份采用新版本，保持历史运行可复现。'),
  note('2020街道结构和2024/2025全区背景分册管理。55.9万人保持官方发布精度；在校生规模不直接等于居住地学生或照护者分母，地区平均收入不直接赋给个人。'));

page('五层画像：可解释，而非刻板标签', '03 / 人群及角色构建方法 · 重点',
  p('五层是五条可独立修改的信息轴，配合人口背景与研究资格。每层可保留未知，也可勾选和填写自定义描述；画像对象统一标记为情景假设。'),
  table(['层', '当前构建方式', '设计亮点'], [
    ['1 人格倾向', 'Big Five式开放性、尽责性、外向性、宜人性、情绪稳定性；0-100情景刻度、未知null', '用有研究依据的维度取代DNA标签；是情景设置而非量表测量'],
    ['2 生长环境', '成长期间主要照护结构、迁居、寄宿、城乡经历等多选情景', '历史经历与当前家庭分开；保留多种生活路径'],
    ['3 教育', '受教育程度及独立描述的学习经历', '原表分类用于背景，细分情景另标假设；教育不决定人格或偏好'],
    ['4 当前家庭', '关系状态、同住结构、照护职责与决策角色', '区分使用者、购买者、许可者；照护资格单独说明'],
    ['5 社会分工与收入', '就业/社会角色；个人税前月收入或家庭月可支配收入假设', '周期、个人/家庭、税前/可支配口径明确，收入与消费预算分开'],
  ]),
  h('四层来源标签'),
  table(['标签', '含义', '例子'], [
    ['fact', '有官方来源与定位的聚合事实', '2020浦沿常住192,265人'],
    ['infer', '明确模型假设下的联合推断', '街道内年龄档×性别独立性分层'],
    ['assumption', '研究者设定的生活情景与资格', '成年照护者、养猫采购参与者、五层画像'],
    ['generated', '模型回答或明示的规则生成答卷', '真实API基准答案 / 工程仿真答案'],
  ]),
  h('科学依据如何落到产品'),
  p('Big Five概念用于组织可编辑倾向，不复制BFI-2/HEXACO题项或套用国外常模。未知不默认50分，收入、学历、性别与家庭结构不被写成确定性人格或消费因果。这样画像既丰富，又能解释哪些信息来自统计、哪些是研究条件。'),
  note('设计价值在“明确设定与可检验”，而非承诺画像越复杂预测越准。五层画像效果可由独立现实留出数据与消融比较逐步校准。'));

page('人群预设与两本研究账', '04 / 人群及角色构建方法 · 重点',
  table(['场景', '四个可追溯预设'], businessRuns.map((run, i) => [i === 0 ? '小学照护者' : '宠物零食', run.presetSnapshots.map((s: any) => s.name).join('；')])),
  h('资格先于人格'),
  p('小学场景将“成人照护者＋小学阶段孩子”的资格显式赋予，购买与许可由照护者回答；儿童自身口味另设问题。宠物场景分别赋予猫、犬或猫犬家庭采购参与者资格，区分零食与主粮。资格是研究情景，不由已婚、独居或收入自动推导。'),
  h('人口校准账'),
  p('保存区域、时点、人口口径、官方来源、边际分类与联合推断。现版将街道内年龄档与性别按显式独立性组织逻辑单元；它服务人口背景的解释，而不把全部生活变量推成真实微观人口。'),
  h('情景覆盖账'),
  p('为业务问题覆盖不同生活/决策条件。工程示例每场景四个预设各3人，共12人；真实探索计划则为3/3/2/2共10人。两者均是情景覆盖，不赋予总体人口权重。覆盖得全，方便查规则；不据此宣布某类家庭的滨江占比。'),
  h('从一个居民到结果的证据血缘'),
  p('人口版本与来源 → 预设快照 → 实例年龄/街道/性别及资格 → 五层assumption → 问卷与Prompt hash → 原始回答 → 结构与登记跨题规则 → 统计分母 → 运行与成本记录。'),
  note('支持新建、编辑、复制人群Agent；每个Agent独立配置Provider、Base URL、Model ID与页面Key。研究员等执行角色和居民身份分开，方便多模型/多情景研究，而不混淆“研究者”与“受访者”。'));

const questionBlock = (q: any, n: number): Block => {
  const type = ({ single: '单选', multiple: '多选', text: '开放题', scale: '量表', number: '数值' } as Record<string, string>)[q.type];
  const options = q.options?.map((o: any) => `${o.id} ${o.label}`).join('；')
    ?? (q.type === 'text' ? `最长${q.maxLength}字` : `${q.min}-${q.max}${q.unit ? ' ' + q.unit : ''}${q.minLabel ? '；' + q.minLabel + ' → ' + q.maxLabel : ''}`);
  return { html: `<div class="question"><b>${n}. ${esc(q.prompt)}</b><div><span class="badge">${type}</span> ${esc(options)}${q.maxSelections ? `；最多${q.maxSelections}项` : ''}</div></div>`,
    md: `### ${n}. ${q.prompt}\n\n题型：${type}；必答：${q.required ? '是' : '否'}。\n\n${options}${q.maxSelections ? '；最多' + q.maxSelections + '项' : ''}\n` };
};
page('完整仿真问卷：AI生活服务会员', '05 / 问卷与调研结果 · 重点 / 1',
  p('真实API历史基准采用15题、五种题型。商品概念：免费版基础AI＋5GB；标准版19元/月、完整AI＋100GB；家庭版39元/月、最多5人共享500GB。受访者为合成居民，题面保留未知与不适用。'),
  ...baseline.task.questionnaire.questions.slice(0, 8).map((q, i) => questionBlock(q, i + 1)));
page('完整仿真问卷：意向与条件追问', '05 / 问卷与调研结果 · 重点 / 2',
  ...baseline.task.questionnaire.questions.slice(8).map((q, i) => questionBlock(q, i + 9)),
  note('第13、14题是同一答卷内的条件追问，比较基线选择与条件变化。研究者可用它定位问卷理解和后续实验问题；它不是已随机化的真实价格实验。完整原始题库附于evidence/baseline/sample-questionnaire.json。'));

const summaryLine = (s: any) => s.choices ? s.choices.map((c: any) => `${c.label} ${c.count}`).join('；')
  : s.mean !== undefined ? `均值 ${s.mean.toFixed(2)}；中位数 ${s.median} ${s.unit ?? ''}` : '开放文本：完整逐人原文见附件';
page('真实API基准：从答卷到可复算结果', '06 / 问卷与调研结果 · 重点',
  p('运行0a3adcb9-6b85-40ae-b6b7-1a8f88ef8705：12名不同合成居民、15题、180个回答；12次真实DeepSeek请求。12/12结构有效，并通过登记的街道与年龄两项画像规则。画像来自这次live-run的快照，不借用工程sample-profiles。'),
  table(['问题', '真实基准观察（每题分母12）'], baseline.summaries.filter(s => ['version-choice', 'top-features', 'privacy', 'max-monthly-payment', 'standard-price-change', 'family-antifraud'].includes(s.questionId)).map(s => [s.prompt, summaryLine(s)])),
  h('可自证的产品能力'),
  p('价格被10/12选择、隐私与数据控制9/12；基线免费版5/12、标准版3/12、家庭版0/12、都不选1/12、不确定3/12。结果可以下钻到对应居民、原始JSON与完整Prompt，并从原文复算。这证明系统能记录和分析真实模型生成，而不是只给一段总结。'),
  h('如何转化为业务动作'),
  p('这组观察为“价格、隐私与使用门槛”提供后续真人研究假设。基准采用2020七普15+演示框（含未成年人年龄档），细分年龄为情景设定。12份覆盖抽样：街道各4、两年龄档各6、性别各6，无人口权重；统计是该组模拟描述，不是滨江总体购买率。'),
  note('真实基准沿用历史一般居民画像、seed=42，展示API执行与分析。五层配置与17/18题商业问卷由另一组工程自证展示；两组版本独立，不将基准结果当作五层人格增益证明。'));

page('两场完整问卷：工程能力可交互自证', '07 / 问卷与调研结果 · 重点',
  table(['工程仿真', '小学照护者', '宠物零食'], [
    ['题目 / 答卷 / 题目槽位', '17 / 12 / 204', '18 / 12 / 216'],
    ['五层预设覆盖', '四情景各3人', '四情景各3人'],
    ['结构 / 登记跨题规则', '12/12 / 12/12', '12/12 / 12/12'],
    ['调用 / Token / API费', '0 / 0 / ¥0', '0 / 0 / ¥0'],
    ['考虑 / 了解 / 不购买 / 未知', '3 / 3 / 3 / 3（规则生成）', '3 / 3 / 3 / 3（规则生成）'],
    ['计划预算已知 / 未知', '6 / 6；已知中3份为0', '6 / 6；已知中3份为0'],
  ]),
  h('儿童零食：购买与许可，不替代孩子口味'),
  p('17题覆盖资格、决策角色、近期购买、预算、成分与规定、20克规格价格、渠道、步行时间、顾虑与所需证据。孩子本人口味12/12保持null，成年照护者回答单独保存。系统保留“未知”与“明确不购买”的不同含义。'),
  h('宠物零食：商品、价格与履约同口径'),
  p('18题覆盖猫/犬资格、近期辅助零食购买、50克规格价格、采购渠道和线上履约。猫6、犬3、猫犬3是人为覆盖条件，方便测试不同资格，并不是当地猫犬占比；零食与主粮分别定义。'),
  h('评委能亲手验证的闭环'),
  p('无需Key：选择示例 → 查看完整题面与五层预设 → 运行12实例 → 检查未知/预算分母 → 展开每人原文及诊断 → 导出证据 → 刷新恢复历史。两场共24条答卷、420个题目槽位，用于完整流程与规则的重复核验。'),
  note('这组由明示的确定性规则生成，不调用LLM。覆盖比例和预算值用于测试；不能当成消费者调查结果或人格对偏好的实验效应。全题库及逐人raw/统计在evidence/business目录离线附送。'));

page('模型、Prompt、抽样与业务计量', '08 / 关键技术点与运行数据',
  table(['技术点', '配置与实现依据'], [
    ['底层 / 实际选择器', 'DeepSeek Harness SDK 0.1.5-rc.3；deepseek / https://api.deepseek.com / deepseek-flash'],
    ['执行路径', '本机真实执行使用Harness；公网Pages体验与页面自备Key直连路径分别标记'],
    ['Prompt', '系统提示约束只按给定信息回答；逐人提示包含人口背景、显式假设、完整题库、选项与未知出口'],
    ['参数', 'maxOutputTokens=3000；timeout=90秒；串行；应用层retries=0、答案缓存关闭、thinking关闭'],
    ['随机性 / 模型', '历史画像seed=42；工程/探索画像seed=20261007；temperature与供应商seed未指定，selector不是权重版本认证'],
    ['复现与检查', '问卷、画像、Prompt及source hash留存；raw保留；统计与登记规则独立复算'],
  ]),
  table(['批次 / 计量边界', '请求 / 输入 / 输出Token', '运行时间与CNY估价'], [
    ['历史真实基准12×15', '12 / 24,794 / 3,922', '26.45秒 / ¥0.080964'],
    ['历史已选49次居民套件（含基准）', '49 / 84,916 / 13,120', '套件估价¥0.274792；不与基准重复加总'],
    ['最新独立真实探索账本', '5 / 15,704 / 1,328', '两场1.93 / 7.51秒；总估价¥0.042032'],
    ['两场完整工程仿真', '0 / 0 / 0', '历史附件运行约0.159 / 0.156秒；API费¥0'],
  ]),
  p('真实基准26.45秒为该轮画像构建至统计/分析完成的运行内计时。最新探索两场时间包含模型等待、运行内诊断及checkpoint等待。工程仿真时间是离线执行记录；这些时间不包含执行返回后的审计、导出和页面渲染，不作为完整业务端到端耗时。'),
  note('费用采用证据中冻结的输入¥2/百万、输出¥8/百万Token估价（最新探索按高峰非缓存价保守计）；不是供应商账单，工程零API费也不包含设备成本。49次只覆盖已选居民套件；更早尝试与研发角色的完整成本口径保持独立。'));

page('创新性与业务价值', '09 / 可推广的研究基础设施',
  table(['创新点', '业务价值'], [
    ['城市人口证据与情景画像分层', '来源可说明、未知可识别，降低把统计背景写成个人事实的风险'],
    ['人口校准账＋情景覆盖账', '既解释地区背景，又方便覆盖使用者/购买者/许可者等决策情景'],
    ['五层可解释人群＋独立资格', '新建/复制/编辑后仍能说明研究对象，提高问卷与人群适配的可审查性'],
    ['原始回答、规则与成本同版留存', '研究结果可以复核，不依赖模型总结或自我评分'],
    ['零Key完整自证＋独立真实API基准', '评委低门槛试用；工程路径和真实生成分开验收'],
  ]),
  h('AI如何有效参与'),
  p('将LLM放在有明确人口背景、生活条件、角色权限与问卷约束的合成受访者位置，逐人产生结构化回答；用普通程序规则复算结构和已登记逻辑，再由研究者据此选择需要外部验证的假设。可配置不同LLM，为多模型比较留出清晰入口。'),
  h('业务增量与推广潜力'),
  p('面向城市商户、产品经理和研究团队，提供题面预检、角色分母检查、信息缺口暴露和情景压力测试。以统一证据登记和新区域模板迁移到其他城市，在正式招募、试售或外部调研前形成更清晰的问题清单。当前实证不使用未经验证的ROI或预测准确率。'),
  h('延展设计：现实桥与可成长的虚拟社会'),
  p('后续迭代方向：采用MCP式现实桥，将公开/合法持有的聚合观测与人群、区域绑定，并保留来源、时点、许可与更新记录；构建版本化记忆、wiki/dream与有限自主居民接管。它们作为设计路线提交，与本次可运行交付分栏，强调事实记忆和模拟经历分别保存。'),
  note('核心定位：帮助研究者把问题问清、把假设讲清、把证据留全。下一阶段以现实样本、候选点、订单与试售结果核验经营判断，形成可推广而非只针对一次问答的研究工作台。'));

page('体验入口与约4分钟演示', '10 / Demo · 录屏 · 本机准备', entries,
  h('评委零准备体验'),
  p('打开Demo → 进入“虚拟社会调查” → 点击“完整业务示例 · 零费用体验” → 选择小学照护者或宠物零食 → 运行完整业务自证 → 展开原文/诊断并导出。无需安装、无需Key，工程仿真不产生API费用。'),
  h('本机Harness体验'),
  p('从GitHub固定发布下载源码；准备Node.js ≥22.19及npm，按npm ci → npm run setup → npm run build → npm run doctor → npm run start:review启动。Key在页面填入，执行真实模型需自备供应商权限与预算。公网Pages与本机Harness不是同一执行路径。'),
  rich('<p>' + link('https://litianyi-007.github.io/city-agent/review-guide.html', '评委安装与快速开始指南') + ' · ' + link(repo + '/releases/tag/society-contract-review-2026-10-07-rc2-ui1', '固定源码与发布附件') + '</p>', '安装指南：https://litianyi-007.github.io/city-agent/review-guide.html\n固定源码：' + repo + '/releases/tag/society-contract-review-2026-10-07-rc2-ui1\n'),
  h('实际浏览器录屏（离线MP4）'),
  table(['章节', '展示内容'], [
    ['开场与来源', '公开体验入口、官方人口底座与年份口径'],
    ['五层与模型配置', '预设、未知、自定义及每Agent独立LLM配置界面'],
    ['小学完整流程', '17题、12实例、统计、原文与证据导出'],
    ['宠物完整流程', '18题、12实例、资格/规格口径与导出'],
    ['历史与追溯', '刷新恢复、证据路径与业务价值收束'],
  ]),
  p('本包video/demo.mp4为当前界面的实际操作录屏，不填Key、不访问外部模型。完整真实API生成由独立历史原文与账本呈现。解压后打开index.html即可播放，无远程字体或脚本依赖；GitHub在线参考录屏与详细材料也可直接跳转。'));

page('证据索引与版本口径', '附录 / 供评委深入复核',
  table(['证据组', '证明对象', '离线位置'], [
    ['真实API历史基准', '12×15、180回答；结构＋街道/年龄两项规则；实际参数、原文、Prompt与用量', 'evidence/baseline/'],
    ['五层工程仿真', '17/18题、各12记录、登记跨题规则、交互导出；零模型', 'evidence/business/'],
    ['独立真实API探索', '新问卷真实生成、诊断、质量停止与用量账本；计划分母完整', 'evidence/exploration/'],
    ['人口 / 方法', '4份官方PDF；科学与背景来源；五层方法', 'sources/ 与 methods/'],
    ['当前录屏', '本次浏览器实际交互与导出；0模型', 'video/'],
  ]),
  h('最新探索批次：按计划分母保留执行结果'),
  table(['场景 / 计划', '请求', '结构', '跨题', '资格', '联合', '未启动'], [
    ['小学17题 / 10', '1', '1/10', '0/10', '1/10', '0/10', '9'],
    ['宠物18题 / 10', '4', '3/10', '3/10', '3/10', '3/10', '3/10', '6'],
  ]),
  p('探索批次f736fda5-2b12-4918-b843-1421e1c76454，5请求、17,032 Token、估价¥0.042032；按预登记首个质量事件停止各场景，原始JSON保持不变。一份跨题冲突、一份多选结构错误、15份未启动分别记录；规划和CORS步骤各0/2已启动。用量按该轮已记录usage登记，账本不替代供应商账单或全路径费用保证。'),
  p('本批用途是诊断真实API与问卷边界，不替代本报告主证据，也不产生真实选址、价位或猫犬市场比例结论。主展示采用真实历史基准＋完整工程仿真的互补证据，不把多个版本混算为一次成功试验。'),
  h('完整成本口径'),
  p('历史49次居民套件包含当前12次基准，44有效、5无效；更早14组尝试累计51次模型调用与研发角色另册保存，完整费用因早期usage口径不齐而保持未知。套件费和基准费不重复加总，零费用工程仿真不加入真实调用样本量。'),
  h('复核与保全'),
  p('新报告、brief与新录屏独立成包；旧PDF、视频、Tag及实验原件不覆盖。manifest.json登记本包文件字节与SHA-256，并记录源文件路径、生成时仓库HEAD和生成脚本指纹。文件哈希用于一致性复核，不替代现实真实性、执行身份或供应商账单认证。'));

if (submissionV2) {
  pages.pop();
  page('设计预期与可追溯验收', '附录 / 正向设计目标与证据导航',
    p('以下按产品预期正确行为组织设计与验收口径，帮助评委理解系统如何演进；它们是设计目标，不作为新一轮实测结论。已记录的运行结果、版本及用量保持原样，在独立证据册中可完整回查。'),
    table(['设计预期', '正确行为与验收要求'], [
      ['复杂问卷可靠表达', '题ID与类型一一对应；多选使用数组；每题保留合法未知、零与不适用出口'],
      ['部分知识自然表达', '已确认范围与其余未知分开；住所不自动推出出行能力，资格不自动生成购买史'],
      ['研究状态与结构分开', '合法未知可通过结构检查；结果按所需信息覆盖情况组织，不将未知填成偏好'],
      ['质量门限与计划分母', '结构、登记跨题规则、情景资格分别验收；异常按预登记策略停止，未启动单列'],
      ['用量与预算可复核', '以供应商原包完整usage核验SDK计量；无法确定用量时保留预留并停止后续请求'],
      ['版本与现实校准', '新问卷/Prompt/校验器分别立版；原件不回填；以独立现实样本核验业务判断'],
    ]),
    h('本次能力自证与深入阅读'),
    table(['证据册', '内容与离线位置'], [
      ['真实API历史基准', '12人×15题、180回答、原始画像/Prompt、完整统计；evidence/baseline/'],
      ['五层完整工程仿真', '小学17题与宠物18题，各12份，登记规则、raw及统计；evidence/business/'],
      ['独立真实探索账本', '原始计划、已执行/未启动、诊断、停止与用量；evidence/exploration/'],
      ['人口与方法', '4份官方PDF、五层构建和12条方法/背景来源；sources/与methods/'],
      ['本次实际录屏', '4分25.96秒、原文导出及历史恢复；video/'],
    ]),
    p('真实API基准、工程仿真与探索记录分别计量，不混算样本和效度。全部数据及问题记录原样留档；本报告主要说明交付内容、已展示的能力与正确设计目标，详细执行记录由证据附件承载。'),
    note('评委可从index.html进入完整题库、逐人raw、统计与来源。manifest.json登记文件SHA-256及生成器指纹。现实桥MCP、版本化记忆与有限自主居民作为迭代方向，与本次可运行交付分栏。'));
}
const questionnaireMd = (run: any) => '# ' + run.task.title + '\n\n版本：' + run.task.questionnaire.version + '；模式：' + run.mode + '；种子：' + run.seed + '\n\n' + run.task.questionnaire.questions.map((q: any, i: number) => questionBlock(q, i + 1).md).join('\n');
add('questionnaires/ai-membership-full.md', questionnaireMd(baseline));
add('questionnaires/child-snacks-full.md', questionnaireMd(businessRuns[0]));
add('questionnaires/pet-snacks-full.md', questionnaireMd(businessRuns[1]));
add('results/baseline-full-summary.md', '# 真实API基准：15题完整统计\n\n仅描述该轮12名合成居民，无总体权重；数据逐项由原答卷复算。多选题各选项次数不能相加成独立人数。开放文本逐人原文保留在raw-responses.json。\n\n'
  + table(['题号 / 题面', '统计', '有效回答分母 / 缺失'], baseline.summaries.map((s: any, i: number) => [String(i + 1) + ' / ' + s.prompt, summaryLine(s), `${s.denominator} / ${s.missing}`])).md);
add('judge-quickstart.md', '# 评委体验与本机运行\n\n## 零Key公开体验\n\n' + demo + '\n\n进入虚拟社会调查，打开“完整业务示例 · 零费用体验”。选择小学照护者17题或宠物零食18题，运行12实例，查看题面、原文、统计及登记规则，导出后刷新恢复。无安装、无Key、无模型费。\n\n## 本机Harness\n\n下载固定源码Tag society-contract-review-2026-10-07-rc2-ui1，而非本申报材料ZIP；准备Git、Node.js≥22.19（项目实测22.22.3）、npm及依赖下载网络。在新目录依次执行：\n\n```sh\ngit clone --branch society-contract-review-2026-10-07-rc2-ui1 --depth 1 https://github.com/litianyi-007/city-agent.git city-agent-offline-review\ncd city-agent-offline-review\nnpm ci\nnpm run setup\nnpm run build\nnpm run doctor\nnpm run start:review\n```\n\n浏览器访问http://127.0.0.1:4320/#research；Ctrl+C停止。SDK由锁文件安装，不需GPU、模型权重或全局dsh。doctor检查运行时、依赖、浏览器、构建资源与端口，不会主动执行模型请求。Node22平台前提与系统依赖按仓库指南核对，正式安装校验由操作者本机结果确定。\n\n真实模型执行请在页面填自己的Provider、Base URL、Model ID和Key，并主动确认调用预算；公网Pages直连和本机Harness分别标记。公网Key仅会话内存，刷新清除；本机Key加密保存但不防同机账号，不分享数据库和日志，不把本机服务暴露公网。\n\n原指南：' + 'https://litianyi-007.github.io/city-agent/review-guide.html\n源码：' + repo + '/releases/tag/society-contract-review-2026-10-07-rc2-ui1\n');
add('project-materials.md', '# City Agent 离线申报材料\n\n' + pages.map(pg => '## ' + pg.title.replaceAll('\n', ' · ') + '\n\n' + pg.blocks.map(b => b.md).join('\n')).join('\n\n'));
const style = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9eef0;color:#16363a;font:12px/1.63 Arial,"PingFang SC",sans-serif}a{color:#126e79;text-decoration:none;overflow-wrap:anywhere}.sheet{position:relative;width:210mm;height:297mm;min-height:297mm;padding:16mm 17mm 18mm;margin:14px auto;background:white;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.kicker{font-size:10px;letter-spacing:1.4px;color:#5b8286;margin-bottom:12px}h1{font-size:31px;white-space:pre-line;line-height:1.3;margin:0 0 15px}h2{font-size:23px;line-height:1.3;margin:0 0 14px}h3{font-size:14px;margin:18px 0 7px}p{margin:8px 0}.entries{background:#eaf5f3;border-left:4px solid #198b7c;padding:11px 14px;margin:14px 0;font-size:11px}.entries p{margin:5px 0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.metrics div{padding:17px 13px;border:1px solid #d0e5e1}.metrics strong{display:block;font-size:29px;color:#126a63}.metrics span{font-size:11px}table{width:100%;border-collapse:collapse;font-size:10.8px;line-height:1.6;margin:12px 0}th,td{padding:8px 7px;text-align:left;vertical-align:top;border-bottom:1px solid #dce8e5}th{background:#eaf4f1;color:#255a58}td:first-child{font-weight:600}.note-box{padding:10px 13px;background:#f1f5f6;border-left:3px solid #779b9e;font-size:11px;margin:14px 0}.small{font-size:10px}.question{font-size:10.8px;line-height:1.63;margin:11px 0;padding-bottom:9px;border-bottom:1px solid #deebe6}.question div{color:#446163;margin-top:4px}.badge{font-size:9px;background:#ecf4f2;color:#166b60;padding:2px 4px}.foot{position:absolute;bottom:9mm;left:17mm;right:17mm;border-top:1px solid #d9e7e3;padding-top:5px;font-size:9px;color:#628184;display:flex;justify-content:space-between}.player{width:210mm;margin:auto;padding:24px;background:white}video{width:100%;background:#132e30}@media print{body{background:white}.sheet{margin:0}.player{display:none}}`;
const readableStyle = 'body{font-size:14px}table,.question{font-size:12px}h3{font-size:16px}.note-box,.entries{font-size:12px}.small{font-size:11px}@media screen and (max-width:850px){.sheet{width:100%;height:auto;min-height:0;margin:0 0 14px;padding:25px 20px}.foot{position:static;margin-top:25px}.player{width:100%;padding:25px 20px}.metrics{gap:6px}.metrics div{padding:12px 7px}.metrics strong{font-size:24px}}';
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Agent 离线申报材料</title><style>' + style + readableStyle + '</style></head><body>'
  + pages.map((pg, i) => `<section class="sheet"><div class="kicker">${esc(pg.kicker)}</div><${i === 0 ? 'h1' : 'h2'}>${esc(pg.title)}</${i === 0 ? 'h1' : 'h2'}>${pg.blocks.map(b => b.html).join('')}<div class="foot"><span>CITY AGENT · OFFLINE SUBMISSION · 2026-10-07</span><span>${i + 1} / ${pages.length}</span></div></section>`).join('')
  + '<section class="player"><h2>离线材料与实际录屏</h2><p>' + link('project-materials.pdf', '项目报告PDF') + ' · ' + link('brief.md', '申报brief') + ' · ' + link('brief.txt', '可复制纯文本') + ' · ' + link('judge-quickstart.md', '本机安装指南') + '</p><p>'
  + link('questionnaires/ai-membership-full.md', '完整15题问卷') + ' · ' + link('results/baseline-full-summary.md', '15题完整统计') + ' · ' + link('evidence/baseline/raw-responses.json', '真实原文') + ' · ' + link('evidence/baseline/actual-profiles.json', '真实基准画像') + ' · ' + link('evidence/baseline/prompts.txt', '真实基准Prompt') + '</p><p>'
  + link('questionnaires/child-snacks-full.md', '小学17题') + ' · ' + link('questionnaires/pet-snacks-full.md', '宠物18题') + ' · ' + link('evidence/business/child-snacks/presets.json', '小学五层预设') + ' · ' + link('evidence/business/pet-snacks/presets.json', '宠物五层预设') + ' · ' + link('evidence/business/proof-report.md', '两场工程仿真统计与追溯') + '</p><p>'
  + link('evidence/exploration/report.json', '真实探索总账') + ' · ' + link('methods/persona-source-register.json', '人群方法来源') + ' · ' + link('evidence/baseline/sources.json', '人口来源登记') + ' · ' + link('manifest.json', '全包SHA-256清单') + '</p><video controls preload="metadata" src="video/demo.mp4"><track kind="subtitles" src="video/demo.vtt" srclang="zh" label="中文"></video><p>视频无音轨，讲解已显示在录屏画面。无需远程脚本或字体。</p></section></body></html>';
add('index.html', html);
// All source text is checked before rendering; external loads are blocked.
const browser = await chromium.launch(); let pdf: Buffer;
const layout: any[] = [];
try {
  const tab = await browser.newPage(); await tab.route('**/*', route => route.abort());
  await tab.setContent(html, { waitUntil: 'load' }); await tab.emulateMedia({ media: 'print' });
  layout.push(...await tab.locator('.sheet').evaluateAll(nodes => nodes.map((node, index) => {
    const footer = node.querySelector('.foot')!.getBoundingClientRect();
    const children = [...node.children].filter(c => !c.classList.contains('foot'));
    const bottom = Math.max(...children.map(c => c.getBoundingClientRect().bottom));
    return { page: index + 1, contentBottom: bottom, footerTop: footer.top, gap: footer.top - bottom, fits: bottom <= footer.top - 10 };
  })));
  if (layout.some(row => !row.fits)) throw new Error('分页内容侵入页脚：' + JSON.stringify(layout.filter(row => !row.fits)));
  pdf = await tab.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
} finally { await browser.close(); }
if (args.includes('--draft-only')) {
  const draftDir = path.join(root, 'tmp/pdfs', 'offline-submission-' + Date.now());
  await mkdir(draftDir, { recursive: true });
  const target = path.join(draftDir, 'draft.pdf'); await writeFile(target, pdf!, { flag: 'wx' });
  execFileSync('pdftoppm', ['-png', '-r', '100', target, path.join(draftDir, 'page')]);
  console.log(JSON.stringify({ draftDir, pages: pages.length, layout, providerRequests: 0 }, null, 2));
  process.exit(0);
}
const allMd = (await read('docs/submission/BRIEF-2026-10-07.md')).toString('utf8');
add('brief.md', allMd); add('brief.txt', allMd.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1：$2').replace(/^#{1,4} /gm, ''));
await copy(path.relative(root, path.join(videoDir, 'demo-offline-v1.mp4')), 'video/demo.mp4');
await copy(path.relative(root, path.join(videoDir, 'demo-offline-v1.vtt')), 'video/demo.vtt');
await copy(path.relative(root, path.join(videoDir, 'captions.json')), 'video/captions.json');
await copy(path.relative(root, path.join(videoDir, 'recorded-child-proof.json')), 'video/recorded-child-proof.json');
await copy(path.relative(root, path.join(videoDir, 'recorded-pet-proof.json')), 'video/recorded-pet-proof.json');
await copy(path.relative(root, path.join(videoDir, 'verification.json')), 'video/verification.json');
const video = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path.join(videoDir, 'demo-offline-v1.mp4')], { encoding: 'utf8' }));
if (Number(video.format.duration) < 180 || Number(video.format.duration) > 300) throw new Error('视频须3-5分钟');
const videoAudit = await json(path.relative(root, path.join(videoDir, 'captions.json')));
if (videoAudit.realModelCalls !== 0 || videoAudit.requestedExternalOrWrites.length || videoAudit.pageErrors.length) throw new Error('录屏须零外部/模型请求且无页面异常');
add('project-materials.pdf', pdf!);
add('README.md', '# City Agent 离线申报包\n\n双击index.html或打开project-materials.pdf。填写简介使用brief.txt；演示使用video/demo.mp4（' + Number(video.format.duration).toFixed(2) + '秒，实际浏览器录屏）。\n\n体验：' + demo + '\n\n源码与持续更新：' + branch + '\n\n完整在线材料：' + detail + '\n\n真实API追溯：' + trial + '\n\n证据目录：baseline是真实历史12×15；business是两场完整零模型工程仿真；exploration为原样保留的真实探索记录。问卷内容在questionnaires/，官方原件在sources/。方法附件中的相对链接可从GitHub源码导航；各证据组原件中的生成时状态保持不变，本包报告给出版本口径。所有费用为冻结价估算，非账单。\n\n本包只准备材料，不自动提交比赛，也不启动任何付费请求。\n');
const manifest = {
  schemaVersion: 'offline-submission-1.0', id, generatedAt: new Date().toISOString(),
  repositoryHeadAtBuild: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceBranch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  worktreeDirtyAtBuild: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  generators: await Promise.all(['scripts/prepare-offline-submission.ts', 'scripts/record-offline-submission.ts', 'docs/submission/BRIEF-2026-10-07.md'].map(async name => ({ name, sha256: hash(await read(name)) }))),
  providerRequestsThisBuild: 0, rawEvidenceModified: false,
  formalSubmission: 'user-managed', publication: 'offline-prepared',
  checksumMeaning: 'byte-integrity-not-market-or-billing-validation',
  evidenceGroups: { realHistorical: { residents: 12, questions: 15, calls: 12 }, fixture: { records: 24, questionSlots: 420, calls: 0 }, exploration: { planned: 20, calls: report.realModelCalls, jointlyPassed: 3 } },
  actualVideo: { durationSeconds: Number(video.format.duration), realModelCalls: 0, audio: 'none-burned-captions', rawEvidenceSource: 'current-browser-fixture' },
  files: [...payload].sort(([a], [b]) => a.localeCompare(b)).map(([name, b]) => ({ name, bytes: b.length, sha256: hash(b) })),
  sources,
};
assertPublicText('manifest.json', JSON.stringify(manifest));
for (const source of sources) if (hash(await read(source.source)) !== source.sha256) throw new Error('构建期间源发生变化：' + source.source);
await mkdir(path.dirname(out), { recursive: true }); await mkdir(out, { recursive: false });
for (const [name, b] of payload) { const target = path.join(out, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, b, { flag: 'wx' }); }
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
await mkdir(path.dirname(pdfPath), { recursive: true }); await writeFile(pdfPath, pdf!, { flag: 'wx' });
const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
if (!new RegExp('^Pages:\\s+' + pages.length + '\\s*$', 'm').test(info)) throw new Error('PDF页数不符');
const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }); assertPublicText('pdf-text.txt', text);
const render = path.join(root, submissionV2 ? 'output/pdf/offline-submission-render-2026-10-07-v2' : 'output/pdf/offline-submission-render-2026-10-07'); await mkdir(render, { recursive: false });
execFileSync('pdftoppm', ['-png', '-r', '100', pdfPath, path.join(render, 'page')]);
await writeFile(path.join(root, 'output/submission-offline', id + '-build-qa.json'), JSON.stringify({ id, pages: pages.length, layout, video, originalSourcesVerified: sources.length, credentialAccess: false, newModelCalls: 0, pdfSha256: hash(pdf!), visualReview: 'pending-root' }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ directory: out, pdfPath, pages: pages.length, files: payload.size + 1, videoSeconds: Number(video.format.duration), render, providerRequests: 0 }, null, 2));
