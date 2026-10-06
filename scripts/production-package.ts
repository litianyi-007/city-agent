import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { productionEnvironment } from '../config/production-environment.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionReport } from '../server/production/index.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';

// Trusted export/recording code, not generated application execution on the host.
// It never starts live runs, reads secret files, or publishes anything.
const environment = productionEnvironment();
const base = new URL(process.env.PRODUCTION_PACKAGE_URL ?? `http://127.0.0.1:${environment.apiPort}`);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('Package source must be a local production service.');
const record = process.argv.includes('--record');
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const platformCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: environment.root, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: environment.root, encoding: 'utf8' }).trim()) throw new Error('Freeze tracked and untracked implementation in a commit before producing an experiment package.');
const outputRoot = path.join(environment.root, 'output/pdf');
await mkdir(outputRoot, { recursive: true });
const directory = await mkdtemp(path.join(outputRoot, 'production-mock-materials-'));
const files: Array<{ path: string; sha256: string }> = [];
async function save(name: string, value: string | Buffer) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.includes('..') || name.startsWith('/')) throw new Error('Invalid package path.');
  const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value, { flag: 'wx' }); files.push({ path: name, sha256: sha(value) });
}
async function api<T>(endpoint: string): Promise<T> {
  const response = await fetch(new URL(`/api/production${endpoint}`, base), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
const provenance = await api<{ platformCommit: string; build: { platformCommit: string; sourceClean: boolean } | null }>('/metadata');
if (provenance.platformCommit !== platformCommit || provenance.build?.platformCommit !== platformCommit || !provenance.build.sourceClean) throw new Error('Restart and rebuild the frozen commit before exporting; service or browser build provenance differs.');
const jevBenchmarks = await api<JevBenchmarkRun[]>('/jev/benchmarks');
if (jevBenchmarks.some(item => ['queued', 'running'].includes(item.status))) throw new Error('Wait for the bounded Jev benchmark to finish before packaging.');
await save('jev-benchmarks.json', JSON.stringify(jevBenchmarks, null, 2));
const supplementalRuns = (await api<ProductionRun[]>('/runs')).filter(run => run.evidenceKind !== 'fixture');
if (supplementalRuns.some(run => ['queued', 'running'].includes(run.status))) throw new Error('Wait for paid/mixed runs to finish before packaging.');
await save('mixed-and-live-runs.json', JSON.stringify(supplementalRuns, null, 2));

const browser = await chromium.launch();
let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
const runs: ProductionRun[] = [];
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(record ? { recordVideo: { dir: path.join(directory, 'recording'), size: { width: 1440, height: 1000 } } } : {}) });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(new URL('/#production', base).href);
  await page.getByRole('button', { name: '运行 Mock 链路', exact: true }).waitFor();
  if (record) {
    await page.getByRole('button', { name: '研发团队', exact: true }).click();
    await page.waitForTimeout(7000);
    await page.locator('.prod-agent-card').first().getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForTimeout(8000);
    await page.getByRole('button', { name: '关闭 Agent 配置' }).click();
    await page.getByRole('button', { name: '决策设置', exact: true }).click();
    await page.getByRole('heading', { name: 'TypeSafe Jev 决策模型' }).waitFor();
    await page.waitForTimeout(12000);
    await page.getByRole('button', { name: '生产工作台', exact: true }).click();
  }
  await page.screenshot({ path: path.join(directory, 'workspace.png'), fullPage: true });
  files.push({ path: 'workspace.png', sha256: sha(await readFile(path.join(directory, 'workspace.png'))) });
  for (const item of PRODUCTION_DEMO_CASES) {
    await page.getByRole('button', { name: item.title, exact: true }).click();
    if (record) await page.waitForTimeout(6000);
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/production/runs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '运行 Mock 链路', exact: true }).click();
    const response = await submitted;
    if (response.status() !== 202) throw new Error(`Mock start failed: ${await response.text()}`);
    const queued = await response.json() as ProductionRun;
    const deadline = Date.now() + 90000;
    let latest: ProductionRun;
    do { latest = await api<ProductionRun>(`/runs/${queued.id}`); if (!['queued', 'running'].includes(latest.status)) break; await page.waitForTimeout(300); } while (Date.now() < deadline);
    if (!latest! || ['queued', 'running'].includes(latest.status)) throw new Error('Mock did not reach a terminal state.');
    if (latest.evidenceKind !== 'fixture' || latest.input.requirement.kind !== 'illustrative') throw new Error('Exporter accepts only explicit illustrative fixtures.');
    runs.push(latest);
    // Preserve failures too; no cherry-picking or silent rerun in this batch.
    await save(`${item.id}/input.json`, JSON.stringify(latest.input, null, 2));
    await save(`${item.id}/run.json`, JSON.stringify(latest, null, 2));
    await save(`${item.id}/intermediate.json`, JSON.stringify(latest.outputs, null, 2));
    await save(`${item.id}/frozen-contract.json`, JSON.stringify(latest.frozenContract ?? null, null, 2));
    await save(`${item.id}/gate.json`, JSON.stringify(latest.gateHistory, null, 2));
    await save(`${item.id}/events.ndjson`, latest.events.map(event => JSON.stringify(event)).join('\n') + '\n');
    for (const artifact of latest.artifacts) {
      if (!['index.html', 'delivery-manifest.json', 'evidence.json'].includes(artifact.name)) throw new Error('Unexpected artifact.');
      const downloaded = await fetch(new URL(`/api/production/runs/${latest.id}/artifacts/${artifact.name}`, base));
      if (!downloaded.ok) throw new Error(`Artifact unavailable: ${artifact.name}`);
      await save(`${item.id}/${artifact.name}`, Buffer.from(await downloaded.arrayBuffer()));
    }
    await page.getByRole('button', { name: /候选验证/ }).click();
    await page.locator('.prod-detail-tabs').scrollIntoViewIfNeeded();
    if (record) await page.waitForTimeout(12000);
    await page.getByRole('button', { name: /门禁与交付/ }).click();
    await page.locator('.prod-gate').scrollIntoViewIfNeeded();
    if (record) await page.waitForTimeout(12000);
    if (latest.status === 'completed') {
      await page.getByRole('button', { name: '打开运行预览' }).click();
      await page.locator('iframe').scrollIntoViewIfNeeded();
      const preview = page.frameLocator('iframe');
      await preview.locator('#task-input').fill('录屏验证实际交互');
      await preview.locator('#add-task').click();
      await preview.locator('#count').waitFor();
      if (await preview.locator('#tasks li').count() !== 1) throw new Error('Preview did not perform the expected interaction.');
      await page.screenshot({ path: path.join(directory, `${item.id}-preview.png`) });
      files.push({ path: `${item.id}-preview.png`, sha256: sha(await readFile(path.join(directory, `${item.id}-preview.png`))) });
      if (record) await page.waitForTimeout(13000);
      await page.getByRole('button', { name: '关闭预览' }).click();
    }
    await page.getByRole('button', { name: /原始调用/ }).click();
    await page.locator('.prod-detail-tabs').scrollIntoViewIfNeeded();
    if (record) await page.waitForTimeout(8000);
    await page.getByLabel('需求原话').scrollIntoViewIfNeeded();
  }
  await page.getByRole('button', { name: '证据与申报', exact: true }).click();
  await page.screenshot({ path: path.join(directory, 'metrics.png'), fullPage: true });
  files.push({ path: 'metrics.png', sha256: sha(await readFile(path.join(directory, 'metrics.png'))) });
  if (record) await page.waitForTimeout(12000);
  const recordedPage = page.video();
  await context.close(); context = undefined;
  if (recordedPage) { await recordedPage.saveAs(path.join(directory, 'demo.webm')); files.push({ path: 'demo.webm', sha256: sha(await readFile(path.join(directory, 'demo.webm'))) }); }

  const report = productionReport(runs);
  await save('submission-evidence.json', JSON.stringify(report, null, 2));
  await save('requirements.json', JSON.stringify(PRODUCTION_DEMO_CASES, null, 2));
  const passed = runs.filter(run => run.status === 'completed' && run.gate?.passed).length;
  const stages = [
    ['产品经理', '一句话扩展为可操作目标、范围和验收', '目标对应、结构有效、不虚构'],
    ['研究员', '分析约束与未知项', '无搜索工具就不声称联网研究'],
    ['项目经理', '拆任务，思考与设计，测试反馈后重规划', '有界轮次/费用/时间；无权绕过 Gate'],
    ['测试', '独立定义可执行检查', '合法 CSS、交互结果、研发前冻结 hash'],
    ['研发', '实现完整 HTML，按证据有限返修', '不修改冻结测试、不执行宿主脚本'],
    ['Verifier', '每次可替换输出的候选审查与选择', '无合格答案则弃权；评分不是概率'],
    ['Chromium Gate', '实际页面加载与交互验收', '精确结果与实际条目数；失败不能被评分覆盖'],
    ['交付', '源码、日志、契约、manifest 与指标', '必要证据完整才完成；unknown 不当零'],
  ];
  const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map(v => `<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const caseRows = PRODUCTION_DEMO_CASES.map((item, index) => [item.id, item.operation, item.background, item.inputMaterials.join('；'), item.acceptance, item.difficulty, runs[index].status]);
  const jevRows = jevBenchmarks.flatMap(batch => batch.cases.map(item => [batch.id.slice(0, 8), item.id, item.evaluation?.status ?? item.status, item.comparison.firstPassed === null ? 'unknown' : item.comparison.firstPassed ? '通过' : '失败', item.selectedCandidateId ?? '弃权', item.comparison.selectedPassed === null ? '未选择/unknown' : item.comparison.selectedPassed ? '通过' : '失败', item.evaluation?.usage.inputTokens ?? 'unknown', item.evaluation?.usage.estimatedCost ?? 'unknown']));
  const resultRows = runs.map(run => [run.input.requirement.id, run.status, run.gate?.passed ? '通过' : '未通过', `${run.durationMs ?? 'unknown'} ms`, run.calls.length, '0', '0 / 0', '0 USD', run.repairs, run.interventions.length]);
  const diagram = `<div class="flow"><span>用户目标与授权</span><b>→</b><span>产品＋研究</span><b>→</b><span>项目经理计划</span><b>→</b><span>测试契约冻结</span><b>→</b><span>研发候选</span><b>→</b><span>Verifier</span><b>→</b><span>Chromium Gate</span><b>→</b><span>交付</span></div><p class="caption">全部可替换角色输出都经过 Verifier；失败 → 项目经理反馈 → 研发，最多两次返修。控制面保管 Key，执行面只运行受限 HTML。</p>`;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>六角色自主软件生产模拟演练材料</title><style>@page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font:12px/1.6 "PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#172b4d;margin:0}h1{font-size:28px;line-height:1.3;margin:0 0 14px}h2{font-size:21px;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid #2563eb}h3{font-size:15px}section{break-before:page;padding:4mm 0}section:first-child{break-before:auto}.kicker{color:#1d4ed8;letter-spacing:2px;font-size:12px}.warning{padding:16px;border-left:4px solid #d97706;background:#fffbeb}.metrics{display:flex;gap:14px;margin:24px 0}.metric{padding:18px;background:#eff6ff;flex:1}.metric strong{display:block;font-size:30px}table{border-collapse:collapse;width:100%;font-size:11px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top;word-break:break-word}th{background:#edf2fb}.flow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:20px 0}.flow span{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px}.flow b{color:#64748b}a{color:#1d4ed8}code{font-size:10px;overflow-wrap:anywhere}.caption{color:#475569}.footer{font-size:10px;color:#64748b}li{margin:7px 0}</style></head><body>
  <section><p class="kicker">CITY AGENT · AUTONOMOUS PRODUCTION</p><h1>六角色自主软件生产模拟演练材料</h1><p><a href="${escape(new URL('/#production', base).href)}">本机体验入口：${escape(new URL('/#production', base).href)}</a> · 构建与启动见 RUNBOOK.md。旧 GitHub Pages 不运行本管线。</p><div class="warning"><b>申报状态：工程演练材料，不是 L4 已达标声明。</b><br>三个需求均由用户授权自拟，角色响应及源码为 Mock 夹具。实际 Chromium Gate 已执行；模型调用为零。本批不能满足“至少三项真实需求”，也不能证明内部 Agent 已自主编写交付。</div><div class="metrics"><div class="metric">Mock Gate 通过<strong>${passed} / ${runs.length}</strong></div><div class="metric">真实模型尝试<strong>0</strong></div><div class="metric">真实良品率<strong>unknown</strong></div><div class="metric">真实业务需求<strong>0</strong></div></div><h3>1 基本信息</h3><p>管线：Agent Delivery Studio，有界单 HTML 软件生产。团队：用户负责目标与授权，外层开发 Agent 建设平台，内部六角色负责执行；成员姓名与正式团队名单未填写。需求类型：新建应用、受控模板功能扩展、模拟缺陷修复。</p><p>平台 commit：<code>${escape(platformCommit)}</code><br>冻结申报基线：<code>b66122c21604fdb2ecdcbafb89c3d5ad8cde1466</code><br>生成时点：${escape(report.generatedAt)}。本材料文件 hash 可核对，不是防篡改签名或供应商账单。</p></section>
  <section><h2>2 管线设计与人工边界</h2>${diagram}${table(['环节', 'AI 职责', '门禁标准'], stages)}<p>人工初始职责：提供目标、范围、模型、权限、预算、验收，并决定是否采用产物。运行中的取消可被系统记录；外部人工改代码或验收需另行审计，空数组不是完全无人介入证明。当前项目经理是固定阶段的有限反馈闭环，不是任意任务 DAG 调度器。</p><p>可复用性：live 不使用需求关键词特判或演示产物回退；共享版本化契约、加密配置和浏览器执行器。受控仓库、Node 构建与依赖安装仍需安全容器验证，不在本批范围。</p></section>
  <section><h2>3 三项模拟需求与输入</h2>${table(['编号', '类型', '背景', '输入材料', '冻结业务验收', '难度', '结果'], caseRows)}<p>来源：用户于 2026-10-07 授权自拟，没有真实工单或需求方。三项共用受控待办应用，便于验证交互回归；不能据此声称跨产品泛化。完整原话、来源与限制在 requirements.json，各需求 input.json 为执行快照。</p><h3>4 执行记录与复现</h3><p>每案例目录保存 input.json、run.json、intermediate.json、frozen-contract.json、gate.json、events.ndjson、源码、manifest 和 evidence.json；失败也保留。本次批次不静默重跑或只收集成功结果。${record ? 'demo.webm 是实际浏览器操作录屏，无旁白；显示 Mock 标签和真实页面交互。' : '本次没有生成录屏。'}</p><p>复现：在本分支运行 build/start，再执行 <code>npm run production:package -- --record</code>。新批次会创建新目录，生成新的运行 ID，不覆盖旧记录；输出与响应由固定工程夹具提供，不是供应商模型。</p></section>
  <section><h2>5 指标统计与预测口径</h2>${table(['需求', '终态', '行为 Gate', '墙钟时间', '模拟环节记录', '实际模型调用', '模型 Token', '模型费用', '返修', '系统取消'], resultRows)}<p>Mock ${passed}/${runs.length} 通过属于夹具功能验证。真实模型良品率、自主环节占比与真实模型耗时尚未测量，均为 unknown。模拟环节记录不是 HTTP 请求，Mock 的 0 Token/0 模型费用因未发供应商请求；不含外层开发、机器和录屏成本。</p>${table(['需求', '人工人日预测', '依据与限制'], PRODUCTION_DEMO_CASES.map(item => [item.id, `${item.humanBaselinePredictionDays.low}–${item.humanBaselinePredictionDays.high}`, item.humanBaselinePredictionDays.basis]))}<p>增效：没有同目标、同范围、同验收的人工实测对照，不计算已实现增效倍数。实际运行费用采用用户声明单价估算，不是供应商发票；缺原始 usage 为 unknown 并停止后续付费调用。真实首批内部上限每次 5 USD、合计 15 USD。</p><h3>6 归因与改进</h3><p>本批 Mock 失败数 ${runs.length - passed}。工程审查已覆盖选择器非法、弱数值断言、Verifier 弃权、未知计量、取消审计、超预算与证据写入等反例；工程反例不混入真实模型业务良品率。旧六次真实交付失败属于旧工程配置，原始负结果不改写，也不与本批 Mock 合并。</p></section>
  <section><h2>7 L4 自评与复用推广计划</h2>${table(['项目', '本批结论'], [['有界自主控制', '六角色、冻结验收、候选验证、最多两次返修及取消；工程可验证'], ['实际模型自主交付', '未实测，本分支新 Key 未配置；不可称最小真实闭环已通过'], ['正式 L4 参考线', '用户没有提供；仅操作性自评，不是官方认证'], ['三项真实需求', '未满足，本批明确为模拟需求'], ['通用 L5', '不宣称；任意环境、仓库和无限权限不支持']])}<h3>参考项目与下一步</h3><p><a href="https://github.com/llm-as-a-verifier/llm-as-a-verifier">LLM-as-a-Verifier</a>：借鉴细粒度评价标准、候选选择与反馈；本批结构化序数评分没有复现 score-token logprob 期望/PPT，也不是校准通过概率。下一步在固定候选池比较首候选与选中结果，评价真实增益和费用。</p><p><a href="https://github.com/nokia-applied-research/AnyJev">AnyJev</a>：SDK 尚未接入；下一步研究低风险 proceed/revise/abstain/stop 类型决策，以及支持 logprobs 的模型和独立标注集。其 L0/L1/L2 是决策读出等级，与本项目研发 L4/L5 无关。</p><ol><li>在新页面配置六角色模型与 Key，运行三个模拟需求的真实模型实验，保留全部失败。</li><li>验证容器安全，扩展受控仓库的小应用、增量和 Bug 路径，交付 patch/lockfile/构建证据。</li><li>固定配置、预登记三类任务各三次；未见任务不得用于调优，按全部尝试统计。</li><li>补充真实业务需求与正式参考线后再形成正式达标结论；公开部署和推广另行授权。</li></ol><p class="footer">虚拟社会研发线保持独立；不修改原 worktree、main、冻结 Tag、Pages 或旧申报附件。</p></section></body></html>`;
  const jevSection = `<section><h2>核心能力：LLM-as-a-Verifier ＋真实 Jev 决策</h2><p>生成模型产物先过结构预检，再经覆盖性、一致性、受限范围三个独立 Score，范围 Noul 和含弃权的 Choice。Jev 批量并行回答；每维至少3/4、分布集中度至少0.5才快速接受；live 不确定时升级一次 LLM 深度复核。全部结果仍须实际行为 Gate，评分不能代替测试。</p>${table(['批次', '题目', 'Jev 状态', '首候选 Gate', '选中候选', '选中 Gate', '输入 Token', '估算 USD'], jevRows)}<p>全部 ${jevBenchmarks.length} 个启动批次保存在 jev-benchmarks.json，包括失败和弃权。每题两份人工构造候选，不是真实模型生成；候选源码、测试、配置与 hash 在外呼前冻结，Jev 看不到缺陷标签或 Gate 结果。三项小样本只检验这批选择，不证明普遍提升、概率校准或稳定 L5。</p><p>固定模型 jev-1.13.0，单次不重试、最多3请求、196608总Token、1 USD估算限额；未知usage停止后续。官方输入价0.042 USD/百万Token、输出免费，按配置快照估算，不是供应商账单。confidence 是分布集中程度，不是业务正确率。<a href="https://docs.typesafe.ai/api">官方 API</a> · <a href="https://docs.typesafe.ai/models">版本与价格</a> · <a href="https://docs.typesafe.ai/confidence">集中度</a></p><p>托管 TypeSafe Jev 已接入，AnyJev 本地 SDK 尚未接入，二者不混淆。前端“决策设置”支持启用、轮换、清除；只回显 Key 已配置，输入提交即清空。临时凭据曾在会话提供，需用户轮换；材料/录屏不包含密钥。</p></section>`;
  const packagedHtml = html.replace('模型调用为零。本批', '研发模型调用为零；真实 Jev 决策对照在附页单列。本批').replace('下一步在固定候选池比较首候选与选中结果，评价真实增益和费用。', '本批已在固定合成候选池比较首候选与选中结果；见 Jev 附页和完整原始记录。').replace('</body></html>', `${jevSection}</body></html>`);
  await save('submission.html', packagedHtml);
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(packagedHtml, { waitUntil: 'load' });
  const pdf = await pdfPage.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#64748b">City Agent · Mock 演练 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await save('production-mock-submission.pdf', pdf);
  await pdfPage.close();
  for (const name of ['README.md', 'RUNBOOK.md', 'DESIGN.md', 'EVALUATION.md', 'REQUIREMENTS.md']) await save(name, await readFile(path.join(environment.root, 'docs/production', name)));
  await save('package-manifest.json', JSON.stringify({ version: 'mock-package-v1', generatedAt: report.generatedAt, platformCommit, submissionBaseline: 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466', runIds: runs.map(run => run.id), cases: runs.map(run => ({ requirementId: run.input.requirement.id, status: run.status, evidenceKind: run.evidenceKind })), measured: { fixturePassed: passed, fixtureStarted: runs.length, providerCalls: 0 }, unknown: ['realModelGoodRate', 'realModelAutonomy', 'measuredHumanBaseline', 'measuredEfficiency'], files }, null, 2));
  console.log(JSON.stringify({ directory, platformCommit, passed, started: runs.length, runs: runs.map(run => ({ id: run.id, requirement: run.input.requirement.id, status: run.status, durationMs: run.durationMs })), pdf: path.join(directory, 'production-mock-submission.pdf'), recording: record ? path.join(directory, 'demo.webm') : null }));
} finally { await context?.close(); await browser.close(); }
