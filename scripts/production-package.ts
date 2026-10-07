import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { productionEnvironment } from '../config/production-environment.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionReport } from '../server/production/index.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import { benchmarkMaterialRows, formatMaterialCost, immutableSourceLink, inheritedMaterialFile, MATERIALS_VERSION, materialAccounting, PACKAGE_DOCS, packageDocLinks, publicMaterialUrl, SUBMISSION_BASELINE } from './production-materials.js';
import { assertWorktreeDirectory, readCheckedPackage } from './production-public-safety.js';

// Trusted export/recording code, not generated application execution on the host.
// It never starts live runs, reads secret files, or publishes anything.
const environment = productionEnvironment();
const base = new URL(process.env.PRODUCTION_PACKAGE_URL ?? `http://127.0.0.1:${environment.apiPort}`);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash) throw new Error('Package source must be a local production service.');
const record = process.argv.includes('--record');
const argument = (name: string) => {
  const inline = process.argv.find(value => value.startsWith(`${name}=`)); const index = process.argv.indexOf(name);
  const value = inline ? inline.slice(name.length + 1) : index >= 0 ? process.argv[index + 1] : undefined;
  if ((inline || index >= 0) && (!value || value.startsWith('--'))) throw new Error(`${name} requires an explicit value; no fallback to starting new runs.`);
  return value;
};
const inheritedSource = argument('--from-package');
if (inheritedSource && record) throw new Error('Offline inheritance cannot record or start new runs. Keep historical video separate from a new experiment.');
const publicDemoUrl = publicMaterialUrl(argument('--public-demo-url') ?? process.env.PRODUCTION_PUBLIC_DEMO_URL);
const auditDoc = argument('--audit-doc') ?? 'JUDGE-AUDIT-2026-10-07.md';
if (!/^[a-zA-Z0-9._-]{1,150}\.md$/.test(auditDoc) || auditDoc.includes('..') || PACKAGE_DOCS.includes(auditDoc as typeof PACKAGE_DOCS[number])) throw new Error('Audit document must be a distinct Markdown filename in docs/production.');
const packageDocs: readonly string[] = PACKAGE_DOCS;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const publisherCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: environment.root, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain'], { cwd: environment.root, encoding: 'utf8' }).trim()) throw new Error('Freeze tracked and untracked implementation in a commit before producing an experiment package.');
const outputRoot = path.join(environment.root, 'output/pdf');
const sourceDirectory = inheritedSource ? path.resolve(environment.root, inheritedSource) : null;
type PackageManifest = { platformCommit: string; submissionBaseline: string; runIds: string[]; cases: Array<{ requirementId: string; status: string; evidenceKind: string }>; files: Array<{ path: string; sha256: string }> };
let inheritedManifest: PackageManifest | null = null; let inheritedManifestSha256: string | null = null;
let inheritedFiles: ReadonlyMap<string, Buffer> | null = null;
const readInherited = (name: string) => inheritedMaterialFile(inheritedFiles, name);
if (sourceDirectory) {
  await assertWorktreeDirectory(environment.root, sourceDirectory, 'output/pdf');
  // Ordinary files only; bounded count/bytes, allowlisted paths, secret checks,
  // every manifest hash and all mandatory evidence are checked before rendering.
  const checked = await readCheckedPackage(sourceDirectory);
  const archived = checked.manifest;
  if (!Array.isArray(archived.cases) || !Array.isArray(archived.runIds) || archived.cases.length !== PRODUCTION_DEMO_CASES.length || archived.runIds.length !== PRODUCTION_DEMO_CASES.length || new Set(archived.runIds).size !== archived.runIds.length || archived.runIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) || archived.cases.some(item => !item || typeof item !== 'object' || typeof item.requirementId !== 'string' || !PRODUCTION_DEMO_CASES.some(expected => expected.id === item.requirementId)) || new Set(archived.cases.map(item => item.requirementId)).size !== PRODUCTION_DEMO_CASES.length) throw new Error('Archived manifest must contain exactly the three distinct registered Mock cases and unique run UUIDs.');
  inheritedFiles = checked.files; inheritedManifest = archived as unknown as PackageManifest;
  inheritedManifestSha256 = sha(readInherited('package-manifest.json'));
  if (!/^[a-f0-9]{40}$/.test(inheritedManifest.platformCommit) || inheritedManifest.submissionBaseline !== SUBMISSION_BASELINE || !Array.isArray(inheritedManifest.files) || !Array.isArray(inheritedManifest.cases) || !Array.isArray(inheritedManifest.runIds)) throw new Error('Archived manifest is malformed or does not use the frozen submission baseline.');
  execFileSync('git', ['merge-base', '--is-ancestor', SUBMISSION_BASELINE, inheritedManifest.platformCommit], { cwd: environment.root });
}
const platformCommit = inheritedManifest?.platformCommit ?? publisherCommit;
await mkdir(outputRoot, { recursive: true });
if (await realpath(outputRoot) !== outputRoot) throw new Error('Package output directory cannot be a symbolic link or an aliased external path.');
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
if (!sourceDirectory) {
  const provenance = await api<{ platformCommit: string; build: { platformCommit: string; sourceClean: boolean } | null }>('/metadata');
  if (provenance.platformCommit !== platformCommit || provenance.build?.platformCommit !== platformCommit || !provenance.build.sourceClean) throw new Error('Restart and rebuild the frozen commit before exporting; service or browser build provenance differs.');
}
const jevBenchmarks = sourceDirectory ? JSON.parse(readInherited('jev-benchmarks.json').toString('utf8')) as JevBenchmarkRun[] : await api<JevBenchmarkRun[]>('/jev/benchmarks');
if (jevBenchmarks.some(item => ['queued', 'running'].includes(item.status))) throw new Error('Wait for the bounded Jev benchmark to finish before packaging.');
const supplementalRuns = sourceDirectory ? JSON.parse(readInherited('mixed-and-live-runs.json').toString('utf8')) as ProductionRun[] : (await api<ProductionRun[]>('/runs')).filter(run => run.evidenceKind !== 'fixture');
if (supplementalRuns.some(run => ['queued', 'running'].includes(run.status))) throw new Error('Wait for paid/mixed runs to finish before packaging.');

const browser = await chromium.launch();
let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
const runs: ProductionRun[] = [];
let inheritedReport: ReturnType<typeof productionReport> | null = null;
let demoCases: typeof PRODUCTION_DEMO_CASES = PRODUCTION_DEMO_CASES;
try {
  if (sourceDirectory && inheritedManifest) {
    const presentation = new Set<string>([...packageDocs, 'submission.html', 'production-mock-submission.pdf', 'PACKAGE-NOTES.md', 'materials-summary.json']);
    for (const file of inheritedManifest.files) if (!presentation.has(file.path)) await save(file.path, readInherited(file.path));
    const inheritedRunIds = new Set<string>();
    for (const item of inheritedManifest.cases) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.requirementId)) throw new Error('Archived case ID is unsafe.');
      const run = JSON.parse(readInherited(`${item.requirementId}/run.json`).toString('utf8')) as ProductionRun;
      if (!inheritedManifest.runIds.includes(run.id) || inheritedRunIds.has(run.id) || run.input.requirement.id !== item.requirementId || run.platformCommit !== platformCommit || run.evidenceKind !== 'fixture' || run.status !== item.status || run.evidenceKind !== item.evidenceKind || ['queued', 'running'].includes(run.status)) throw new Error('Archived run provenance does not match its original terminal manifest.');
      inheritedRunIds.add(run.id);
      runs.push(run);
    }
    inheritedReport = JSON.parse(readInherited('submission-evidence.json').toString('utf8')) as ReturnType<typeof productionReport>;
    demoCases = JSON.parse(readInherited('requirements.json').toString('utf8')) as typeof PRODUCTION_DEMO_CASES;
  } else {
  await save('jev-benchmarks.json', JSON.stringify(jevBenchmarks, null, 2));
  await save('mixed-and-live-runs.json', JSON.stringify(supplementalRuns, null, 2));
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
      // A model artifact is never mounted in this application's browser origin.
      // Actual behavior evidence already came from the independently restricted Gate.
      const preview = page.locator('.prod-preview img');
      await preview.waitFor();
      await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('.prod-preview img'); return image?.complete && image.naturalWidth > 0; });
      await preview.scrollIntoViewIfNeeded();
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
  }
  const report = inheritedReport ?? productionReport(runs);
  if (!inheritedReport) {
    await save('submission-evidence.json', JSON.stringify(report, null, 2));
    await save('requirements.json', JSON.stringify(demoCases, null, 2));
  }
  const accounting = materialAccounting(runs, jevBenchmarks, supplementalRuns);
  const renderedAt = new Date().toISOString();
  const historicalVideo = Boolean(sourceDirectory && inheritedManifest?.files.some(file => file.path === 'demo.webm'));
  await save('materials-summary.json', JSON.stringify({ ...accounting, originalRunPlatformCommit: platformCommit, publisherCommit, auditCommit: publisherCommit, auditDocument: 'REVIEW.md', auditSourceDocument: auditDoc, runtimeDocumentationScope: 'Current publisher snapshot; does not retroactively describe historical run configuration', renderedAt, inheritedFrom: sourceDirectory ? { package: path.basename(sourceDirectory), manifestSha256: inheritedManifestSha256 } : null, historicalVideo, publicDemoUrl, publicDemoScope: publicDemoUrl ? 'Trusted fixed Mock/static materials only; no backend, live model calls, or untrusted artifact execution' : null }, null, 2));
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
  const table = (headers: string[], rows: unknown[][], className = '', widths: number[] = []) => `<table class="${className}">${widths.length ? `<colgroup>${widths.map(width => `<col style="width:${width}%">`).join('')}</colgroup>` : ''}<thead><tr>${headers.map(v => `<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const operationLabel = { create: '新建\nCreate', feature: '增量\nFeature', bugfix: '修复\nBugfix' };
  const difficultyLabel = { low: '低 Low', medium: '中 Med', high: '高 High' };
  const statusLabel: Record<string, string> = { completed: '完成\nCompleted', failed: '失败\nFailed', cancelled: '取消\nCancelled', interrupted: '中断\nInterrupted' };
  const caseRows = demoCases.map(item => [item.id, operationLabel[item.operation], item.background, item.inputMaterials.join('；'), item.acceptance, difficultyLabel[item.difficulty], statusLabel[runs.find(run => run.input.requirement.id === item.id)?.status ?? ''] ?? 'unknown']);
  const jevRows = benchmarkMaterialRows(jevBenchmarks);
  const resultRows = runs.map(run => [run.input.requirement.id, statusLabel[run.status] ?? run.status, run.gate?.passed ? '通过' : '未通过', `${run.durationMs ?? 'unknown'} ms`, run.calls.filter(call => call.executionSource === 'mock').length, '0', '0 / 0', '0 USD', run.repairs, run.interventions.filter(item => item.type === 'cancel').length]);
  const realGeneration = accounting.measuredScope.realGeneration;
  const jevTotal = accounting.measuredScope.jevDecisions;
  const mixedFailures = supplementalRuns.filter(run => run.evidenceKind === 'fixture-with-real-jev');
  const decisionRates = jevBenchmarks.map(batch => `<p>批次 ${escape(batch.id.slice(0, 8))} / ${escape(batch.policyVersion)}：总体选中且通过 ${batch.metrics.selectedPassRate === null ? 'unknown' : `${batch.metrics.selectedPassed}/${batch.metrics.attemptedCases}`}，选择覆盖 ${batch.metrics.selectionCoverage === null ? 'unknown' : `${batch.metrics.attemptedCases - batch.metrics.unselected}/${batch.metrics.attemptedCases}`}；已选中条件通过 ${batch.metrics.selectivePassRate === null ? 'unknown' : `${batch.metrics.selectedPassed}/${batch.metrics.attemptedCases - batch.metrics.unselected - batch.metrics.selectedGateUnmeasured}`}。配置不同不合并成功率。</p>`).join('');
  const videoDescription = historicalVideo ? `历史录屏（平台 ${platformCommit.slice(0, 7)}）：继承原 demo.webm；当时 iframe 预览边界已发现自导航外联风险，现已关闭，不能作为现版本安全证据。原视频没有重录或改写。` : record ? 'demo.webm 为本次实际操作录屏；模型生成产物只显示受控 Chromium 截图，不在应用 iframe 内执行。实际行为验证见 Gate 证据。' : '本次没有生成录屏。';
  const auditLink = publicDemoUrl ? new URL('submission/REVIEW.md', publicDemoUrl).href : immutableSourceLink(publisherCommit, `docs/production/${auditDoc}`);
  const entryLinks = `${publicDemoUrl ? `<a href="${escape(publicDemoUrl)}">公开静态体验（可信固定 Mock 与材料；无后端、无实时模型调用）</a><br>` : ''}<a href="${escape(new URL('/#production', base).href)}">本机管线入口：${escape(new URL('/#production', base).href)}</a> · 构建与启动见 RUNBOOK.md。静态入口不能配置 Key 或执行 live。<br><a href="${escape(auditLink)}">当前审查结论与未达标项（REVIEW.md）</a>；主阅读文档描述当前 publisher 版本，历史运行配置只以原始 JSON 为准。`;
  const diagram = `<div class="flow"><span>用户目标与授权</span><b>→</b><span>产品＋研究</span><b>→</b><span>项目经理计划</span><b>→</b><span>测试契约冻结</span><b>→</b><span>研发候选</span><b>→</b><span>Verifier</span><b>→</b><span>Chromium Gate</span><b>→</b><span>交付</span></div><p class="caption">全部可替换角色输出都经过 Verifier；失败 → 项目经理反馈 → 研发，最多两次返修。控制面保管 Key，执行面只运行受限 HTML。</p>`;
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>六角色自主软件生产模拟演练材料</title><style>@page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font:12px/1.6 "PingFang SC","Microsoft YaHei",Arial,sans-serif;color:#172b4d;margin:0}h1{font-size:28px;line-height:1.3;margin:0 0 14px}h2{font-size:21px;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid #2563eb}h3{font-size:15px}section{break-before:page;padding:4mm 0}section:first-child{break-before:auto}.kicker{color:#1d4ed8;letter-spacing:2px;font-size:12px}.warning{padding:12px;border-left:4px solid #d97706;background:#fffbeb}.metrics{display:flex;gap:14px;margin:18px 0}.metric{padding:14px;background:#eff6ff;flex:1}.metric strong{display:block;font-size:30px}table{border-collapse:collapse;width:100%;font-size:11px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;vertical-align:top;word-break:normal;overflow-wrap:anywhere}th{background:#edf2fb}.case-table{table-layout:fixed;font-size:10px}.case-table td:first-child,.case-table th:first-child{white-space:nowrap}.case-table td:nth-child(2),.case-table td:nth-child(6),.case-table td:nth-child(7){white-space:pre-line;word-break:keep-all;overflow-wrap:normal}.flow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:20px 0}.flow span{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px}.flow b{color:#64748b}a{color:#1d4ed8}code{font-size:10px;overflow-wrap:anywhere}.caption{color:#475569}.footer{font-size:10px;color:#64748b}li{margin:7px 0}</style></head><body>
  <section><p class="kicker">CITY AGENT · AUTONOMOUS PRODUCTION</p><h1>六角色自主软件生产模拟演练材料</h1><p>${entryLinks}</p><div class="warning"><b>申报状态：工程演练材料，不是 L4 已达标声明。</b><br>三个需求均由用户授权自拟，角色响应及源码为 Mock 夹具。实际 Chromium Gate 已执行；这三项生成模型请求为零，真实 Jev 决策在附页分列。本批不能满足“至少三项真实需求”，也不能证明内部 Agent 已自主编写交付。${historicalVideo ? `<br><b>${escape(videoDescription)}</b>` : ''}</div><div class="metrics"><div class="metric">Mock Gate 通过<strong>${passed} / ${runs.length}</strong></div><div class="metric">真实生成任务<strong>${realGeneration.started}</strong></div><div class="metric">真实生成记录通过率<strong>${realGeneration.recordedGatePassRate === null ? 'unknown' : escape(realGeneration.recordedGatePassRate)}</strong></div><div class="metric">真实业务需求<strong>0</strong></div></div><h3>1 基本信息</h3><p>管线：Agent Delivery Studio，有界单 HTML 软件生产。团队：用户负责目标与授权，外层开发 Agent 建设平台，内部六角色负责执行；成员姓名与正式团队名单未填写。需求类型：新建应用、受控模板功能扩展、模拟缺陷修复。</p><p>原 Mock 运行平台 commit：<code>${escape(platformCommit)}</code><br>材料导出与审查工具 commit：<code>${escape(publisherCommit)}</code><br>冻结申报基线：<code>${SUBMISSION_BASELINE}</code><br>原记录生成时点：${escape(report.generatedAt)}；本报告渲染时点：${escape(renderedAt)}。保留原运行版本，展示修订不重跑模型、不改变实验。文件 hash 可核对，不是防篡改签名或供应商账单。</p></section>
  <section><h2>2 管线设计与人工边界</h2>${diagram}${table(['环节', 'AI 职责', '门禁标准'], stages)}<p>人工初始职责：提供目标、范围、模型、权限、预算、验收，并决定是否采用产物。运行中的取消可被系统记录；外部人工改代码或验收需另行审计，空数组不是完全无人介入证明。当前项目经理是固定阶段的有限反馈闭环，不是任意任务 DAG 调度器。</p><p>可复用性：live 不使用需求关键词特判或演示产物回退；共享版本化契约、加密配置和浏览器执行器。受控仓库、Node 构建与依赖安装仍需安全容器验证，不在本批范围。</p></section>
  <section><h2>3 三项模拟需求与输入</h2>${table(['编号', '类型', '背景', '输入材料', '冻结业务验收', '难度', '结果'], caseRows, 'case-table', [9, 8, 17, 16, 35, 6, 9])}<p>来源：用户于 2026-10-07 授权自拟，没有真实工单或需求方。三项共用受控待办应用，便于验证交互回归；不能据此声称跨产品泛化。完整原话、来源与限制在 requirements.json，各需求 input.json 为执行快照。</p><h3>4 执行记录与复现</h3><p>每案例目录保存 input.json、run.json、intermediate.json、frozen-contract.json、gate.json、events.ndjson、源码、manifest 和 evidence.json；失败也保留。${escape(videoDescription)}</p><p>离线重渲：<code>npm run production:package -- --from-package output/pdf/原材料目录</code>，先校验旧包 hash，新目录逐字继承原证据，不访问服务、不产生模型请求。新的免费 Mock 运行另用 <code>npm run production:package -- --record</code>，产生独立运行 ID，不能与历史记录合并成同一冻结实验。</p></section>
  <section><h2>5 指标统计与预测口径</h2>${table(['需求', '终态', '行为 Gate', '墙钟时间', '模拟环节记录', '生成请求', '生成 Token', '生成费用', '返修', '系统取消'], resultRows)}<p>Mock ${passed}/${runs.length} 通过属于夹具功能验证。真实自主环节占比与实测增效为 unknown，不认证自主交付。模拟环节记录不是 HTTP 请求；表中 0 Token/0 模型费用只属于这三项 Mock 生成，不是全包没有供应商请求。独立 Jev 总账在附页与 materials-summary.json 明确列出；外层开发、机器和录屏成本未统计。</p>${table(['需求', '人工人日预测', '依据与限制'], demoCases.map(item => [item.id, `${item.humanBaselinePredictionDays.low}–${item.humanBaselinePredictionDays.high}`, item.humanBaselinePredictionDays.basis]))}<p>增效：没有同目标、同范围、同验收的人工实测对照，不计算已实现增效倍数。实际运行费用采用声明单价估算，不是供应商发票；缺原始 usage 为 unknown。真实生成首批内部上限每次 5 USD、合计 15 USD；决策对照独立批次限额 1 USD。</p><h3>6 归因与改进</h3><p>本批 Mock 失败数 ${runs.length - passed}。旧六次真实交付失败属于旧工程配置，原始负结果不改写，也不与本批 Mock 合并。本次审查发现旧 iframe 可自行导航外联，已从应用撤下；模型生成 HTML 仅下载为附件，预览改受控 Chromium 截图。浏览器截图仍非任意代码安全容器，恶意代码隔离与资源限额继续受实际测试约束。</p></section>
  <section><h2>7 L4 自评与复用推广计划</h2>${table(['项目', '本批结论'], [['有界自主控制', '固定阶段六角色、冻结验收、候选验证、最多两次返修及取消；不是任意DAG或无限成长'], ['实际模型自主交付', realGeneration.started === 0 ? '真实生成任务未实测；不可称最小真实闭环已通过，Jev决策不能替代研发' : '真实生成记录单列 mixed-and-live-runs.json；仅原记录终态，不自动认证自主性或稳定性'], ['正式 L4 参考线', '用户没有提供；仅操作性自评，不是官方认证'], ['三项真实需求', '未满足，本包主案例明确为模拟需求'], ['通用 L5', '不宣称；任意环境、仓库和无限权限不支持']])}<h3>参考项目与下一步</h3><p><a href="https://github.com/llm-as-a-verifier/llm-as-a-verifier">LLM-as-a-Verifier</a>：借鉴细粒度评价标准、候选选择与反馈；本批结构化序数评分没有复现 score-token logprob 期望/PPT，也不是校准通过概率。固定人工构造池的首候选与选中结果见 Jev 附页，不证明泛化或最佳答案。</p><p><a href="https://github.com/nokia-applied-research/AnyJev">AnyJev</a>：SDK 尚未接入；下一步研究低风险 proceed/revise/abstain/stop 类型决策，以及支持 logprobs 的模型和独立标注集。其 L0/L1/L2 是决策读出等级，与本项目研发 L4/L5 无关。</p><ol><li>在新页面配置六角色模型与 Key，运行三个模拟需求的真实模型实验，保留全部失败。</li><li>验证容器安全，扩展受控仓库的小应用、增量和 Bug 路径，交付 patch/lockfile/构建证据。</li><li>固定配置、预登记三类任务各三次；未见任务不得用于调优，按全部尝试统计。</li><li>补充真实业务需求与正式参考线、同范围人工/无Verifier成本对照后，才形成达标、增效或推广结论。</li></ol><p class="footer">虚拟社会研发线保持独立；不修改原 worktree、main、冻结 Tag 或旧申报附件。公开静态入口不运行本机 Harness 后端。</p></section></body></html>`;
  const jevSection = `<section><h2>核心能力：LLM-as-a-Verifier ＋真实 Jev 决策</h2><p>生成模型产物先过结构预检，再经覆盖性、一致性、受限范围三个 Score，范围 Noul 和含弃权的 Choice。问题在一请求批量回答，不证明三个评估彼此统计独立；每维至少3/4、分布集中度至少0.5才快速接受；live 不确定时至多一次 LLM 深度复核。全部结果仍须实际行为 Gate。</p>${table(['批次', '题目', 'Jev 状态', '首候选 Gate', '选中候选', '选中 Gate', '输入 Token', '估算 USD'], jevRows)}<p>全部 ${jevBenchmarks.length} 个启动批次保存在 jev-benchmarks.json，包括失败；error 是协议失败、skipped 没有执行，不是模型弃权。每题两份人工构造候选，不是真实生成；池、测试与阈值外呼前冻结，Jev 看不到缺陷标签或 Gate 结果。小样本不证明泛化、校准、最佳答案或稳定 L5。</p>${decisionRates}<p>混合/真实链路另存 mixed-and-live-runs.json：${mixedFailures.length ? mixedFailures.map(run => `${escape(run.id.slice(0, 8))} 终态 ${escape(run.status)}，${run.gate ? `最终Gate ${run.gate.passed ? '通过' : '失败'}` : '未到最终Gate'}`).join('；') : '无混合尝试'}。全包 Jev 共 ${jevTotal.providerRequests ?? 'unknown'} 请求，输入 ${jevTotal.inputTokens ?? 'unknown'} / 输出 ${jevTotal.outputTokens ?? 'unknown'} Token，估算 ${formatMaterialCost(jevTotal.estimatedCost)} USD，包含旧失败、弃权和混合失败，不与 Mock 零生成费用混淆。完整 scope、unknown 与逐请求统计见 materials-summary.json。</p><p>固定 jev-1.13.0，单次不重试；每对照批次最多3请求、196608总Token、1 USD估算限额，非整个材料包总请求上限。按保存费率快照估算，不是供应商账单；缺usage为unknown。confidence 是分布集中程度，不是业务正确率。<a href="https://docs.typesafe.ai/api">官方 API</a> · <a href="https://docs.typesafe.ai/models">版本与价格</a> · <a href="https://docs.typesafe.ai/confidence">集中度</a></p><p>托管 TypeSafe Jev 已接入，AnyJev 本地 SDK 尚未接入。临时凭据曾在会话提供，需用户轮换；材料与录屏不包含密钥。当前可信固定静态 Mock、历史录屏、本机不可信产物截图三者分开，不将 iframe 旧视频当作安全证明。</p></section>`;
  const packagedHtml = html.replace('</body></html>', `${jevSection}</body></html>`);
  await save('submission.html', packagedHtml);
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(packagedHtml, { waitUntil: 'load' });
  const pdf = await pdfPage.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#64748b">City Agent · Mock 演练 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await save('production-mock-submission.pdf', pdf);
  await pdfPage.close();
  const documentOrigins: Array<{ path: string; sourcePath: string; origin: string; commit: string }> = [];
  for (const name of packageDocs) {
    const sourceName = name === 'REVIEW.md' ? auditDoc : name;
    const content = await readFile(path.join(environment.root, 'docs/production', sourceName), 'utf8');
    await save(name, packageDocLinks(content, publisherCommit, packageDocs));
    documentOrigins.push({ path: name, sourcePath: `docs/production/${sourceName}`, origin: 'current publisher repository snapshot; not historical run configuration', commit: publisherCommit });
  }
  const notes = `# 材料包阅读说明\n\n原 Mock 运行平台 commit：${platformCommit}。材料导出与审查工具 commit：${publisherCommit}。原始运行、候选、Gate、输入、Prompt/config与所有失败保持原版本；重新渲染不重新实验。\n\n## 体验入口\n\n${publicDemoUrl ? `公开静态入口：${publicDemoUrl}，只运行可信固定 Mock 和材料浏览，不运行 Harness 后端、不收集 Key、不执行模型生成产物。\n\n` : ''}本机管线：${new URL('/#production', base).href}，需按 RUNBOOK 启动服务并配置。\n\n## 三种证据与费用\n\n三条 Mock 仅工程夹具，行为 Gate ${passed}/${runs.length}；零生成请求不表示全包零付费请求。六角色真实生成任务记录 ${realGeneration.started}；不认证无人干预、L4达标或稳定L5。全包真实 Jev ${jevTotal.providerRequests ?? 'unknown'} 请求，输入 ${jevTotal.inputTokens ?? 'unknown'} / 输出 ${jevTotal.outputTokens ?? 'unknown'} Token，估算 ${formatMaterialCost(jevTotal.estimatedCost)} USD（非供应商账单，不含外层开发/设备/录屏）。v1/v2不同配置分别统计；protocol error、skipped、uncertain与混合失败均保留。详见 materials-summary.json、jev-benchmarks.json、mixed-and-live-runs.json。\n\n## 录屏与安全审查\n\n${videoDescription}\n\n旧iframe预览可自导航外联，已撤下；不可信HTML只下载为附件，本机预览为受控Chromium截图。公开门户只用固定可信Mock。截图和worktree不是任意代码安全容器；容器/受控仓库/Node与shell仍不支持。临时Jev凭据须用户轮换，材料不包含密钥。\n\n## 申报硬缺口\n\n≥3真实业务需求当前未满足；正式团队姓名、官方L4参考线、六角色真实自主交付、代表性稳定实验、校准集、同范围人工与无Verifier对照未完成。人口与虚拟社会线独立，不把它们的结果挪作本线证据。AnyJev SDK未接入，L0/L1/L2不等于研发L4/L5。\n\n## 复现与血缘\n\n离线使用 --from-package 先验证原manifest并复制原证据到新目录；不访问API、不重发供应商请求。新Mock录制另起任务，不能静默重跑并覆盖失败。原始包SHA256：${inheritedManifestSha256 ?? 'not inherited'}。文件hash只用于一致性检查，不是防篡改签名。文档来源见manifest.documentOrigins；运行JSON中的platformCommit不改写成publisherCommit。\n`;
  await save('PACKAGE-NOTES.md', notes);
  await save('package-manifest.json', JSON.stringify({ version: 'mock-package-v2', materialsVersion: MATERIALS_VERSION, generatedAt: report.generatedAt, renderedAt, platformCommit, publisherCommit, auditCommit: publisherCommit, auditDocument: 'REVIEW.md', auditSourceDocument: auditDoc, runtimeDocumentationScope: 'Current publisher snapshot; does not retroactively describe historical run configuration', submissionBaseline: SUBMISSION_BASELINE, inheritedFrom: sourceDirectory ? { package: path.basename(sourceDirectory), manifestSha256: inheritedManifestSha256 } : null, historicalVideo, publicDemoUrl, documentOrigins, runIds: runs.map(run => run.id), cases: runs.map(run => ({ requirementId: run.input.requirement.id, status: run.status, evidenceKind: run.evidenceKind })), measured: { fixturePassed: passed, fixtureStarted: runs.length, providerCalls: 0 }, measuredScope: accounting.measuredScope, unknown: ['realModelAutonomy', 'measuredHumanBaseline', 'measuredEfficiency', ...(realGeneration.started === 0 ? ['realModelGoodRate'] : [])], files }, null, 2));
  console.log(JSON.stringify({ directory, platformCommit, publisherCommit, inherited: Boolean(sourceDirectory), passed, started: runs.length, runs: runs.map(run => ({ id: run.id, requirement: run.input.requirement.id, status: run.status, durationMs: run.durationMs })), pdf: path.join(directory, 'production-mock-submission.pdf'), recording: record || historicalVideo ? path.join(directory, 'demo.webm') : null }));
} finally { await context?.close(); await browser.close(); }
