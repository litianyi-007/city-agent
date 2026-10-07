import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { assertPublicText } from '../shared/publishing-contract';
import { fingerprint } from '../shared/evidence';
import { parseSurveyEvidence } from '../src/run-history';
import { auditBusinessDemoRun } from '../shared/research-demo';
import { checkLiveQualification } from '../shared/live-business-protocol';

// Independently-addressed public negative-result supplement. No model/store/Key access or publication.
// The main agent already marked this one-PDF operation; do not run the artifact marker again here.
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--revise-display')) throw new Error('本补充包仅对应已完成的固定1.1试验；仅允许显式修订本补充展示，不接受任意源、ID或输出覆盖。');
const reviseDisplay = args.includes('--revise-display');
let displayRevision = 1;
const root = path.resolve(import.meta.dirname, '..');
const experimentId = 'f736fda5-2b12-4918-b843-1421e1c76454';
const sourceDirectory = path.join(root, 'output/live-proof', experimentId);
const directory = path.join(root, 'output/contract-review-appendix', experimentId, 'submission-contract11');
const pdfPath = path.join(root, 'output/pdf/city-agent-contract11-review-f736fda5.pdf');
const demoUrl = 'https://litianyi-007.github.io/city-agent/#research';
const originalUrl = 'https://litianyi-007.github.io/city-agent/submission-next/index.html';
const supplementUrl = 'https://litianyi-007.github.io/city-agent/submission-contract11/';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const same = (actual: unknown, expected: unknown, label: string) => { if (fingerprint(actual) !== fingerprint(expected)) throw new Error('补充证据不一致：' + label); };
const globals = ['report.md', 'report.json', 'plan.json', 'pricing-source.json', 'budget-ledger.json', 'planning-child.json', 'planning-pet.json', 'cors-checks.json'];
const caseFiles = ['questionnaire.json', 'presets.json', 'survey-run.json', 'raw-responses.json', 'statistics.json', 'logic-audit.json', 'qualification-audit.json', 'prompts.txt'];
const names = [...globals, ...['child-snacks', 'pet-snacks'].flatMap(id => caseFiles.map(name => id + '/' + name))];
const files: Record<string, Buffer> = {};
for (const name of names) {
  const source = path.join(sourceDirectory, name);
  if ((await lstat(source)).isSymbolicLink() || !(await realpath(source)).startsWith(sourceDirectory + path.sep)) throw new Error('原件路径越界或符号链接：' + name);
  const bytes = await readFile(source); assertPublicText('' + name, bytes.toString('utf8'));
  files['' + name] = bytes; // Byte-exact originals, never normalized, repaired or written back.
}
const json = (name: string) => JSON.parse(files['' + name].toString('utf8'));
const report = json('report.json'); const plan = json('plan.json'); const ledger = json('budget-ledger.json');
if (report.schemaVersion !== 'live-business-report-1.1' || report.id !== experimentId || report.protocolVersion !== 'live-business-smoke-1.1'
  || report.mockUsed !== false || report.execution !== 'real-api-synthetic-residents' || report.marketResearchValidated !== false
  || report.personaContributionValidated !== false || report.providerBillingIndependentlyVerified !== false || report.thirtyResidentGate !== 'not-run') throw new Error('本补充只公开登记1.1真实API负结果，不能升级效度。');
same(report.planHash, fingerprint(plan), 'planHash'); same(report.authorizationId, ledger.experimentId, '授权账本身份');
same(report.model, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' }, '模型selector');
same([report.realModelCalls, report.authorizedRequestAttempts, report.providerRequestsConfirmed, report.modelResponsesWithKnownUsage], [5, 5, 5, 5], '五次请求及已知用量');
same([report.knownInputTokens, report.knownOutputTokens, report.conservativeCostCny, report.budgetCny, report.maximumCalls], [15704, 1328, 0.042032, 5, 24], '用量和费用');
same([ledger.state, ledger.requestCount, ledger.usageStatus, ledger.knownUsageCostCny, ledger.committedCny], ['closed', 5, 'reported', 0.042032, 0.042032], '关闭的预算账本');
if (plan.sourceFiles.length !== 23 || new Set(plan.sourceFiles.map((entry: { path: string }) => entry.path)).size !== 23) throw new Error('须保留已冻结的23关键源文件hash。');
same(ledger.reservations.reduce((sum: number, entry: any) => sum + entry.usage.inputTokens, 0), report.knownInputTokens, '逐次输入Token');
same(ledger.reservations.reduce((sum: number, entry: any) => sum + entry.usage.outputTokens, 0), report.knownOutputTokens, '逐次输出Token');
const expected = {
  'child-snacks': { started: 1, structurallyValid: 1, logicPassed: 0, qualificationPassed: 1, completeValid: 0, notStarted: 9 },
  'pet-snacks': { started: 4, structurallyValid: 3, logicPassed: 3, qualificationPassed: 3, completeValid: 3, notStarted: 6 },
};
for (const id of ['child-snacks', 'pet-snacks'] as const) {
  const run = parseSurveyEvidence(json(id + '/survey-run.json'));
  const frozen = plan.cases.find((item: any) => item.id === id); const item = report.cases.find((item: any) => item.id === id);
  if (!frozen || !item || run.mode !== 'live' || run.profiles.length !== 10 || run.state !== 'stopped' || run.parameters?.fixturePolicyId) throw new Error('合成居民计划、执行或停止状态不符：' + id);
  same(run.task, frozen.task, id + '冻结问卷'); same(run.profiles, frozen.profiles, id + '冻结画像');
  same(run.prompt.system, frozen.systemPrompt, id + '系统Prompt'); same(run.prompt.users.map(user => user.text), frozen.userPrompts, id + '用户Prompt');
  same(run.profiles.map(profile => profile.presetId).reduce((counts: Record<string, number>, presetId) => ({ ...counts, [presetId]: (counts[presetId] ?? 0) + 1 }), {}),
    Object.fromEntries(frozen.presets.map((preset: any, index: number) => [preset.id, [3, 3, 2, 2][index]])), id + '覆盖3/3/2/2');
  const audit = auditBusinessDemoRun(run, frozen.rules); same(json(id + '/logic-audit.json'), audit, id + '独立跨题审计');
  const rows = run.profiles.map(profile => checkLiveQualification(id, profile, run.responses.find(response => response.residentId === profile.id)!));
  const qualification = { protocol: frozen.qualificationProtocol, planned: 10, checked: rows.filter(row => row.status === 'checked').length, rows };
  same(json(id + '/qualification-audit.json'), qualification, id + '资格审计');
  const combined = run.responses.filter(response => response.status === 'valid' && rows.find(row => row.residentId === response.residentId)?.status === 'checked'
    && audit.records.find(row => row.residentId === response.residentId)?.passed).length;
  for (const [key, value] of Object.entries(expected[id])) same(item[key], value, id + '/' + key);
  same([item.logicPassed, item.qualificationPassed, item.completeValid, item.qualityTargetMet], [audit.passed, qualification.checked, combined, false], id + '联合门限');
  same(json(id + '/raw-responses.json'), run.responses, id + 'raw镜像'); same(json(id + '/questionnaire.json'), run.task, id + '问卷镜像');
  same(json(id + '/presets.json'), run.presetSnapshots, id + '预设镜像');
  const prompts = 'SYSTEM\n' + run.prompt.system + '\n\n' + run.prompt.users.map(user => 'RESIDENT ' + user.residentId + ' SHA256 ' + user.hash + '\n' + user.text).join('\n\n');
  same(files['' + id + '/prompts.txt'].toString('utf8'), prompts, id + '可读Prompt');
}
for (const name of ['planning-child.json', 'planning-pet.json']) same(json(name), { state: 'not-run', reason: 'scenario-quality-stopped', modelCalls: 0 }, name + '未启动');
same(json('cors-checks.json').checks.map((item: any) => ({ state: item.state, modelCalls: item.modelCalls })), [{ state: 'not-run', modelCalls: 0 }, { state: 'not-run', modelCalls: 0 }], 'CORS未启动');
const esc = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (url: string, text: string) => '<a href="' + esc(url) + '">' + esc(text) + '</a>';
const globalLinks = globals.map(name => link('' + name, name)).join(' · ');
const perCaseLinks = ['child-snacks', 'pet-snacks'].map(id => '<p><strong>' + (id === 'child-snacks' ? '小学照护者' : '宠物零食') + '：</strong>'
  + caseFiles.map(name => link('' + id + '/' + name, name)).join(' · ') + '</p>').join('');
const style = `@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9eef2;color:#1f3446;font-family:Arial,"PingFang SC","Noto Sans CJK SC",sans-serif;font-size:12px;line-height:1.52}a{color:#1260a2;text-decoration:none;overflow-wrap:anywhere}.sheet{position:relative;width:210mm;min-height:297mm;height:297mm;margin:12px auto;padding:15mm 17mm 17mm;background:#fff;break-after:page;page-break-after:always}.sheet:last-of-type{break-after:auto;page-break-after:auto}.eyebrow{font-size:10px;letter-spacing:1.2px;color:#627b90;margin-bottom:10px}h1{font-size:26px;line-height:1.25;margin:0 0 10px}h2{font-size:19px;line-height:1.3;margin:0 0 10px}h3{font-size:13px;margin:15px 0 6px}p{margin:7px 0}.lead{font-size:13px}.warning{background:#fff0ec;border-left:4px solid #b45135;padding:9px 12px;margin:12px 0;color:#742f1e}.entry{background:#edf5fb;padding:9px 12px;margin:11px 0;font-size:11px}.entry p{margin:4px 0}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:12px 0}.metric{border:1px solid #d8e2ea;padding:8px 10px;font-size:11px}.metric strong{display:block;font-size:18px;color:#183e5c}table{width:100%;border-collapse:collapse;font-size:11px;margin:9px 0}th{background:#eaf0f5;text-align:left;color:#284f6a}td,th{padding:7px 6px;border-bottom:1px solid #d9e1e8;vertical-align:top}.note{font-size:10.5px;color:#516879}.divider{border-top:1px solid #d5e0e8;margin-top:11px;padding-top:9px}.code{font-family:Menlo,monospace;font-size:9px;overflow-wrap:anywhere}.foot{position:absolute;left:17mm;right:17mm;bottom:9mm;border-top:1px solid #d9e3eb;padding-top:5px;color:#607689;font-size:9px;display:flex;justify-content:space-between}.attachments{width:210mm;margin:12px auto;padding:15px 17mm;background:white;font-size:11px}@media print{body{background:white}.sheet{margin:0}.attachments{display:none}}`;
const pageOne = `<section class="sheet"><div class="eyebrow">CITY AGENT / CONTRACT 1.1 / NEGATIVE RESULT SUPPLEMENT</div>
  <h1>真实调查续测：质量门限仍未通过</h1>
  <p class="lead">2026-10-07，独立授权的新版 Prompt 测试轮已执行。真实 API 产生合成居民答卷，不使用 mock；<strong>不是真人调研，不代表滨江真实市场偏好。</strong></p>
  <div class="entry"><p><strong>体验 Demo：</strong>${link(demoUrl, demoUrl)}</p><p><strong>本轮独立材料：</strong>${link(supplementUrl, supplementUrl)}</p><p><strong>原 RC1 完整申报材料：</strong>${link(originalUrl, originalUrl)}</p></div>
  <div class="warning"><strong>结论：两个10人计划均失败，停止而非补样。</strong><br>儿童场景首份答卷发生跨题互斥冲突；宠物场景第4份违反多选题结构。全部原文、失败及15份未启动均保留，未重试或换模型。</div>
  <div class="metrics"><div class="metric"><strong>5 / 24</strong>真实授权请求 / 批准上限</div><div class="metric"><strong>3 / 20</strong>结构＋跨题＋资格联合通过 / 计划</div><div class="metric"><strong>15 / 20</strong>未启动 / 全部计划居民</div><div class="metric"><strong>17,032</strong>15,704 input + 1,328 output Token</div><div class="metric"><strong>¥0.042032</strong>保守估价；授权上限¥5，非账单</div><div class="metric"><strong>0 / 2 · 0 / 2</strong>规划 / CORS：已启动/各计划（均未启动）</div></div>
  <h3>预登记质量门限：每场景10/10联合通过</h3>
  <table><thead><tr><th>场景 / 题数</th><th>已启动</th><th>结构</th><th>跨题</th><th>资格</th><th>联合</th><th>未启动</th></tr></thead><tbody>
  <tr><td>小学照护者 / 17</td><td>1/10</td><td>1/10</td><td>0/10</td><td>1/10</td><td>0/10</td><td>9/10</td></tr>
  <tr><td>宠物零食 / 18</td><td>4/10</td><td>3/10</td><td>3/10</td><td>3/10</td><td>3/10</td><td>6/10</td></tr></tbody></table>
  <p class="note">分母固定为计划10人，不用“已启动”或“默认valid”替代联合门限。本轮实际跨题错误1、结构错误1、未启动15；原审计failed/conflict包含未启动或结构阻断，并非20人的逻辑或身份矛盾。</p>
  <h3>原文失败点与业务含义</h3>
  <p><strong>照护者：</strong><code>reachable-streets=["puyan","unknown"]</code>，违反题面明确的未知排他及冻结规则；判错可解释。问卷无法表达“知道浦沿、其他未知”的部分知识，是需改进的设计缺陷；原答卷不回填。</p>
  <p><strong>宠物：</strong>前3份联合通过；第4份 <code>past-snack-categories="unknown"</code> 不是数组，未事后转成 <code>["unknown"]</code>。其raw猫/采购资格符合画像，但结构失败使parsed answers为空、资格核对被阻断，不是已证明身份冲突。</p>
  <p class="divider note">因此不能据此推荐店址、主营价位、猫犬比例或经营收益。请求成功/HTTP200不是问卷或市场验收成功。预算账本已关闭；余量不是继续调用授权。</p>
  <div class="foot"><span>独立补充件，不覆盖RC1、旧1.0原文或正式申报状态</span><span>1 / 2</span></div></section>`;
const pageTwo = `<section class="sheet"><div class="eyebrow">CITY AGENT / TRACEABLE METHODS & BOUNDARIES</div><h2>方法、版本与追溯：保留负结果</h2>
  <h3>人群构建：5个独立情景层，不把情景伪装成人口事实</h3>
  <table><thead><tr><th style="width:24%">层</th><th>构建方法与边界</th></tr></thead><tbody>
  <tr><td>1 人格倾向</td><td>Big Five式倾向作为显式假设；不是DNA标签、遗传推断或真实测量。</td></tr>
  <tr><td>2 生长环境</td><td>家庭结构、迁居等可多选情景；不由街道、性别或年龄自动推断。</td></tr>
  <tr><td>3 教育</td><td>独立设定教育经历；不据学历自动推断购买意愿或人格。</td></tr>
  <tr><td>4 当前家庭</td><td>当前关系/家庭阶段与成长环境分开；照护资格必须明确赋予。</td></tr>
  <tr><td>5 工作及收入</td><td>社会分工、收入作为情景变量；区年均收入不能直接变成个人工资或消费预算。</td></tr></tbody></table>
  <p>人口背景冻结为滨江<strong>2020-11-01个人框</strong>；街道×年龄档×性别联合由独立性假设推断，并非已观测的联合或真实居民记录。具体年龄、照护/养宠/采购资格和五层设定都是假设。</p>
  <p>每场景4个人群预设，10计划画像覆盖<strong>3/3/2/2</strong>；seed <code>20261007</code>。这是工程覆盖抽样，无总体人口权重，不证明真实小学照护者或养宠人群占比。详见原RC1的方法、来源和问卷附件。</p>
  <h3>模型、Prompt、参数与本轮执行</h3>
  <p><code>deepseek / https://api.deepseek.com / deepseek-flash</code>；${esc(report.harness)}。selector未独立认证模型权重。居民输出上限3000 Token、90秒、并发1、重试0、无答案缓存；thinking disabled，temperature/providerSeed未设置。</p>
  <p>协议 <code>live-business-smoke-1.1</code>；居民 <code>resident-json-contract-1.1</code>；规划 <code>candidate-planner-1.1</code>。多选未知数组说明及平铺规划格式仅有离线协议回归；<strong>本轮规划和CORS因质量停止未启动</strong>。旧1.0规划0/2失败不改写为成功。</p>
  <p class="note">照护者运行约1.927秒，宠物约7.514秒（各run.durationMs；含画像/模型/诊断，不含全部持久化/渲染）。估价采用官方高峰非缓存输入¥2/百万、输出¥8/百万；不认证供应商账单。</p>
  <h3>追溯登记与公开原件</h3>
  <p>独立试验 <span class="code">${experimentId}</span>；源计划登记<strong>23个关键文件SHA-256</strong>。原23源/旧Tag/旧PDF/旧1.0 raw均未覆盖；canonical JSON planHash：</p>
  <p class="code">${esc(report.planHash)}</p>
  <p class="note">本补充白名单复制24项真实轮附件，逐字节不改；加index、README和本2页PDF共27 payload，manifest登记每项bytes/SHA-256。SHA仅证明一致性，不认证用户身份、现实真值或账单。后续verifier须区分not-evaluated，不回写本轮审计。</p>
  <p class="note">${link(supplementUrl + 'report.json', '本轮总账')} · ${link(supplementUrl + 'plan.json', '冻结计划与23源hash')} · ${link(supplementUrl + 'budget-ledger.json', '预算账本')} · ${link('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', '官方计价来源')}<br>${link('https://litianyi-007.github.io/city-agent/submission-next/methods/resident-construction.md', '完整五层构建方法')} · ${link('https://litianyi-007.github.io/city-agent/submission-next/methods/population-methodology.md', '人口建模方法')} · ${link('https://litianyi-007.github.io/city-agent/submission-next/population-sources.json', '人口来源清单')}</p>
  <div class="warning"><strong>仍未验证：</strong>五层贡献、异构稳健性、30人门限、真人校准、真实订单/客流/租金、盈利店址；没有新的真实测试录屏，旧4分33秒录像仍为工程夹具。正式比赛提交状态不因此改变。</div>
  <div class="foot"><span>申报自证应呈现工程能力、失败边界和补采路径</span><span>2 / 2</span></div></section>`;
const attachments = `<section class="attachments"><h2>本轮24项原始附件</h2><p>${globalLinks}</p>${perCaseLinks}<p>${link('appendix.pdf', '下载2页补充PDF')} · ${link('manifest.json', '逐文件完整性manifest')} · ${link('README.md', '版本与范围说明')}</p></section>`;
const responsiveStyle = '@media screen and (max-width:850px){body{font-size:13px;overflow-wrap:anywhere}.sheet,.attachments{width:100%;min-height:0;height:auto;margin:0 auto 12px;padding:24px 18px 28px}.sheet h1{font-size:24px}.sheet h2,.attachments h2{font-size:19px}.foot{position:static;left:auto;right:auto;bottom:auto;margin-top:24px;gap:12px;flex-wrap:wrap}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{min-width:0}.metric strong{font-size:18px}table{table-layout:fixed;font-size:11px}th:first-child{width:22%}td,th{padding:6px 3px;overflow-wrap:anywhere}code,.code{overflow-wrap:anywhere;white-space:normal}.entry{font-size:12px}}';
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Agent 1.1真实续测负结果补充</title><style>' + style + responsiveStyle + '</style></head><body>' + pageOne + pageTwo + attachments + '</body></html>';
assertPublicText('index.html', html);
const browser = await chromium.launch(); let pdf: Buffer;
try {
  const tab = await browser.newPage(); await tab.route('**/*', route => route.abort()); await tab.setContent(html, { waitUntil: 'load' });
  await tab.emulateMedia({ media: 'print' });
  await tab.evaluate(() => { const base = document.createElement('base'); base.href = 'https://litianyi-007.github.io/city-agent/submission-contract11/'; document.head.prepend(base); });
  pdf = await tab.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
} finally { await browser.close(); }
files['index.html'] = Buffer.from(html); files['appendix.pdf'] = pdf;
const readme = '# City Agent 1.1真实调查续测：负结果补充\n\n体验入口：' + demoUrl + '\n\n本补充入口：' + supplementUrl + '；正式公开状态以部署验收记录为准。原RC1完整材料：' + originalUrl + '\n\n'
  + '独立真实API试验' + experimentId + '，5请求，15,704输入/1,328输出Token；按高峰非缓存价保守估价¥0.042032，授权¥5/最多24请求，不是供应商账单。受访者为合成居民，不是mock也不是真人。\n\n'
  + '| 场景 | 题数 | 启动/计划 | 结构/计划 | 跨题/计划 | 资格/计划 | 联合/计划 | 未启动 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'
  + '| 小学照护者 | 17 | 1/10 | 1/10 | 0/10 | 1/10 | 0/10 | 9 |\n| 宠物零食 | 18 | 4/10 | 3/10 | 3/10 | 3/10 | 3/10 | 6 |\n\n'
  + '两个10/10联合门限均失败；儿童跨题互斥失败，宠物第4份多选标量结构失败。未修改原文、重试、换模型、补样或扩到30人。规划/CORS均因质量停止未启动；旧1.0规划0/2失败仍保留。本次不验证五层贡献、真人市场、主营价位、猫犬占比或盈利店址。没有新真实试验录屏；旧视频是工程夹具。\n\n'
  + '解释边界：本轮实际跨题错误1、结构错误1、未启动15。原logic-audit.failed包括未启动；qualification.conflict也包含结构invalid和未启动的未评估，不是20人的身份/逻辑矛盾。小学["puyan","unknown"]违反题面明确的未知排他及冻结规则，但问卷无法表达部分知识（知道浦沿、其他未知），需另版改进。宠物第4份raw的猫/采购资格符合画像；结构失败导致parsedanswers为空、资格核对被阻断。未来verifier应区分not-evaluated；本轮raw和审计JSON不修改。\n\n'
  + '包根目录含24项固定白名单原件，逐字节复制。本包共27 payload加1 manifest；appendix.pdf为独立2页补充，原RC1/旧1.0/旧Tag/旧PDF不覆盖，不代表正式参赛提交。\n\n'
  + 'planHash（canonical JSON）：' + report.planHash + '\n源plan.json SHA-256：' + hash(files['plan.json']) + '\n源report.json SHA-256：' + hash(files['report.json']) + '\n\n'
  + '原计划记录23关键源文件hash；冻结问卷、画像、预设、Prompt、统计、跨题、资格及预算分别可复核。Hash是内容一致性检查，不认证现实真值、用户身份或账单。批准receipt/binding原件、私Key、本机数据库与运行私日志不公开。\n';
assertPublicText('README.md', readme); files['README.md'] = Buffer.from(readme);
const manifest = { schemaVersion: 'contract-review-appendix-1.0', experimentId, protocolVersion: 'live-business-smoke-1.1', planHash: report.planHash,
  realModelCalls: report.realModelCalls, conservativeCostCny: report.conservativeCostCny, publicationKind: 'negative-result-supplement',
  payloadCount: Object.keys(files).length, liveEvidenceFileCount: names.length, reportSha256: hash(files['report.json']), planSha256: hash(files['plan.json']),
  sourceCriticalFileCount: plan.sourceFiles.length, rawEvidenceModified: false, mockUsed: false, marketResearchValidated: false, personaContributionValidated: false,
  formalSubmission: 'not-confirmed', generatedAt: new Date().toISOString(),
  displayRevision,
  files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
};
assertPublicText('manifest.json', JSON.stringify(manifest));
await mkdir(path.dirname(directory), { recursive: true });
if (reviseDisplay) {
  // A requested presentation-only correction. Validate and preserve this new supplement's first draft.
  // The byte-exact 24 evidence originals are checked and never written again.
  const previousBytes = await readFile(path.join(directory, 'manifest.json')); const previous = JSON.parse(previousBytes.toString('utf8'));
  same(previous.experimentId, experimentId, '展示修订范围');
  same(previous.files.map((entry: any) => entry.name).sort(), Object.keys(files).sort(), '展示修订白名单');
  for (const entry of previous.files) {
    const filename = path.join(directory, entry.name);
    if ((await lstat(filename)).isSymbolicLink() || !(await realpath(filename)).startsWith(directory + path.sep)) throw new Error('展示修订路径越界：' + entry.name);
    const bytes = await readFile(filename); same(hash(bytes), entry.sha256, '修订前字节/' + entry.name); same(bytes.length, entry.bytes, '修订前长度/' + entry.name);
    if (names.includes(entry.name)) same(hash(bytes), hash(files[entry.name]), '禁止改raw/' + entry.name);
  }
  same(hash(await readFile(pdfPath)), previous.files.find((entry: any) => entry.name === 'appendix.pdf').sha256, '双份PDF修订前一致');
  displayRevision = 2;
  let backup: string;
  while (true) {
    backup = path.join(root, 'output/contract-review-appendix', experimentId, 'display-revision-' + (displayRevision - 1) + '-original');
    try { await lstat(backup); displayRevision++; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; break; }
  }
  manifest.displayRevision = displayRevision;
  await mkdir(backup, { recursive: false });
  for (const name of ['index.html', 'README.md', 'appendix.pdf', 'manifest.json']) await writeFile(path.join(backup, name), await readFile(path.join(directory, name)), { flag: 'wx' });
} else await mkdir(directory, { recursive: false });
for (const [name, bytes] of Object.entries(files)) {
  if (reviseDisplay && names.includes(name)) continue;
  const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: reviseDisplay ? 'w' : 'wx' });
}
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: reviseDisplay ? 'w' : 'wx' });
await mkdir(path.dirname(pdfPath), { recursive: true }); await writeFile(pdfPath, pdf, { flag: reviseDisplay ? 'w' : 'wx' });
const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
if (!/^Pages:\s+2\s*$/m.test(info)) throw new Error('补充PDF必须恰为2页；保持产物待检查，不替换旧版。');
const extracted = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }); assertPublicText('appendix-pdf-extracted.txt', extracted);
const renderDirectory = path.join(root, 'output/pdf/contract11-render-' + experimentId + (reviseDisplay ? '-display-v' + displayRevision : '')); await mkdir(renderDirectory, { recursive: false });
execFileSync('pdftoppm', ['-png', '-r', '110', pdfPath, path.join(renderDirectory, 'page')]);
console.log(JSON.stringify({ directory: path.relative(root, directory), pdfPath: path.relative(root, pdfPath), pdfSha256: hash(pdf), pages: 2,
  payloadCount: manifest.payloadCount, manifestCount: 1, liveEvidenceFileCount: names.length, realModelCalls: 5, renderDirectory: path.relative(root, renderDirectory),
  visualReview: 'pending-root-inspection', published: false, privateCredentialAccess: false, originalArtifactsModified: false }, null, 2));
