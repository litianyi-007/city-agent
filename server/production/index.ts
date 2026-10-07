import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PRODUCTION_CAPABILITIES, PRODUCTION_REPAIR_POLICY_VERSION, PRODUCTION_ROLES, productionRunInputSchema, type ProductionRun } from '../../shared/production-schema.js';
import { PROMPT_VERSION, CRITERIA_VERSION, OUTPUT_CONTRACT_VERSION, contractProfile } from './contracts.js';
import { cameraSceneSchema } from '../../shared/camera-scene-schema.js';
import { CAMERA_RUNTIME_CSP_HASH, CAMERA_STYLE_CSP_HASH, renderCameraSceneHtml } from '../../shared/camera-scene-runtime.js';
import { renderCameraHandWorkerSource } from '../../shared/camera-hand-worker.js';
import { CAMERA_ASSET_MANIFEST } from '../../shared/camera-asset-manifest.js';
import { cameraRuntimeMetadata } from './camera-gate.js';
import { ProductionPipeline, type ProductionOptions } from './pipeline.js';
import { hash, ProductionStore } from './store.js';
import { platformCommit, captureProductionExecutionIdentity } from './provenance.js';
import { runJevBenchmark } from './jev-benchmark.js';
import { PRODUCTION_DEMO_CASES } from '../../shared/production-benchmarks.js';
import { ProductionPreview } from './preview.js';
import { JEV_POLICY_VERSION } from '../../shared/jev-schema.js';
import { productionRequestCounts } from '../../shared/production-ledger.js';
import { VerifierStudyController } from './verifier-study-control.js';
export { isUnresolvedJevIntent, productionRequestCounts } from '../../shared/production-ledger.js';

// Source is a download, never an execution-capable document in the UI browser.
export const PRODUCTION_ARTIFACT_CSP = "default-src 'none'; connect-src 'none'; frame-ancestors 'none'; sandbox";

const CAMERA_ASSET_DIRECTORY = fileURLToPath(new URL('../../public/camera-assets/', import.meta.url));
export function readPinnedCameraAsset(filename: string, directory = CAMERA_ASSET_DIRECTORY) {
  const pin = CAMERA_ASSET_MANIFEST.assets.find(asset => asset.filename === filename);
  if (!pin) throw new Error('摄像头资产不在固定白名单内');
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('摄像头资产目录不合法');
  const root = realpathSync(directory); if (root !== path.resolve(directory)) throw new Error('摄像头资产目录祖先不得为符号链接'); const file = path.join(directory, pin.filename); const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(realpathSync(file)) !== root || stat.size !== pin.bytes) throw new Error('摄像头资产必须是大小符合固定清单的普通文件');
  const value = readFileSync(file);
  if (value.byteLength !== pin.bytes || createHash('sha256').update(value).digest('hex') !== pin.sha256) throw new Error('摄像头资产Hash不匹配，拒绝执行');
  return { pin, value };
}
export function verifyCameraAssets() { for (const asset of CAMERA_ASSET_MANIFEST.assets) readPinnedCameraAsset(asset.filename); return { ready: true, version: CAMERA_ASSET_MANIFEST.version, packageVersion: CAMERA_ASSET_MANIFEST.packageVersion, sourceCommit: CAMERA_ASSET_MANIFEST.sourceCommit }; }
function cameraOrigin(req: Request) { const origin = new URL(`${req.protocol}://${req.get('host')}`).origin; if (!/^https?:\/\//.test(origin)) throw new Error('摄像头服务Origin不合法'); return origin; }
function cameraPreviewCsp(origin: string) { return `default-src 'none'; script-src '${CAMERA_RUNTIME_CSP_HASH}' ${origin}/api/production/camera-assets/ 'wasm-unsafe-eval'; style-src '${CAMERA_STYLE_CSP_HASH}'; connect-src ${origin}/api/production/camera-assets/; worker-src ${origin}/api/production/camera-runtime/worker.js; media-src blob:; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'`; }

export function productionReport(runs: ProductionRun[]) {
  const live = runs.filter(run => run.evidenceKind === 'real-model'); const terminal = live.filter(run => !['queued', 'running'].includes(run.status));
  const passed = terminal.filter(run => run.status === 'completed' && run.gate?.passed && (run.input.capability !== 'camera-scene-v1' || Boolean(run.cameraVerification?.fullRequirementVerified)));
  const cameraRuns = live.filter(run => run.input.capability === 'camera-scene-v1');
  const fixture = runs.filter(run => run.evidenceKind === 'fixture');
  const aiStages = ['product', 'research', 'think-design', 'acceptance', 'implement', 'feedback-0'];
  const requestCounts = productionRequestCounts;
  return {
    version: 'production-submission-v1', generatedAt: new Date().toISOString(),
    basicInfo: { pipelineName: 'Agent Delivery Studio — 有界 HTML/受控摄像头场景生产', team: '用户定义目标/权限/预算，平台内六角色执行；外层开发 Agent 建设平台不计为内部交付', requirementType: '离线单HTML或严格JSON受控摄像头场景；不是任意仓库/摄像头代码自动生产' },
    pipelineDesign: { stages: ['产品扩展', '研究约束', '项目经理思考与设计', '测试契约冻结', '研发', '独立Chromium硬Gate', '项目经理反馈→有限返修', '交付'], roles: PRODUCTION_ROLES, verifier: '每个可替换角色输出的全部合法候选经过独立序数审查；单候选也验证；错误或弃权失败关闭；不覆盖硬Gate', humanBoundary: '初始需求、权限、预算及缺信息/高风险决策属于人；不得手改生成产物或临时放宽门禁后计成功', scope: '无容器安全执行环境，禁止宿主生成Node/shell执行', reusable: '真实运行根据需求和冻结契约生成；Mock通过显式case配置，不用于真实题关键词特判', references: [{ name: 'LLM-as-a-Verifier', url: 'https://github.com/llm-as-a-verifier/llm-as-a-verifier', relationship: '概念借鉴；JSON ordinal审查未复现原score-token logprobs算法' }, { name: 'AnyJev', url: 'https://github.com/nokia-applied-research/AnyJev', relationship: '仅调研与后续 typed proceed/revise/abstain/stop 与标注校准计划；本项目未实现原prefill/readout/head' }] },
    requirements: runs.map(run => ({ runId: run.id, ...run.input.requirement, brief: run.input.brief, evidenceKind: run.evidenceKind })),
    executionRecords: runs.map(run => ({ id: run.id, inputSnapshot: run.input, agentSnapshot: run.agentSnapshot, platformCommit: run.platformCommit ?? null, cameraVerification: run.cameraVerification ?? null, repairCount: run.repairs, repairPolicyVersion: run.repairPolicyVersion ?? null, repairHistory: run.repairHistory ?? null, jevSnapshot: run.jevSnapshot ?? null, jevCalls: run.jevCalls ?? [], verifications: run.verifications, verifierAttempts: run.calls.filter(call => call.role === 'verifier').map(call => ({ callId: call.id, phase: call.phase, engine: call.verificationEngine ?? null, sourceJevCallId: call.sourceJevCallId ?? null, error: call.error ?? null, usage: call.usage })), status: run.status, evidenceKind: run.evidenceKind, ...requestCounts(run), simulatedStageRecords: run.calls.filter(call => call.executionSource === 'mock').length, injectedTestRecords: run.calls.filter(call => call.executionSource === 'injected').length, frozenContract: run.frozenContract, outputs: run.outputs, gateHistory: run.gateHistory, logs: run.artifacts.some(artifact => artifact.name === 'evidence.json') ? `/api/production/runs/${run.id}/artifacts/evidence.json` : null, artifacts: run.artifacts, durationMs: run.durationMs ?? null, video: null })),
    requestLedger: runs.map(run => ({ id: run.id, ...requestCounts(run) })),
    cameraAcceptanceMetrics: { realModelStarted: cameraRuns.length, boundedScenePassed: cameraRuns.filter(run => run.status === 'completed' && run.cameraVerification?.boundedScenePassed).length, actualVisionVerified: 0, physicalCameraVerified: 0, fullRequirementVerified: 0, scope: 'scene-behavior-synthetic', excludedFromFullRequirementSuccessNumerator: true, includedInTerminalDenominator: true, note: '场景行为完成≠真实识别/设备/完整需求完成；终态计入完整需求分母但未验证不计成功；不得用模型判断或合成输入填充物理验收' },
    metrics: { realModelStarted: live.length, realModelTerminal: terminal.length, realModelPassed: passed.length, goodProductRate: terminal.length ? passed.length / terminal.length : null, rateDenominator: '全部终态真实模型启动尝试（含失败、取消、中断）；非同冻结配置的统计不得称稳定性实验', fixtureStarted: fixture.length, fixturePassed: fixture.filter(run => run.status === 'completed' && run.gate?.passed).length, fixtureExcludedFromAutonomousSuccess: true, stageDefinition: { plannedAiStages: aiStages, deterministicStages: ['Chromium gate', 'evidence packaging'], plannedAiFraction: 6 / 8, note: '设计占比不是实测无人干预率；返修新增阶段单列调用记录' }, perRun: runs.map(run => { const completedAiStages = aiStages.filter(phase => run.outputs.some(output => output.phase === phase) && run.verifications.some(review => review.phase === phase && review.decision === 'accept')); return { id: run.id, evidenceKind: run.evidenceKind, ...requestCounts(run), simulatedStageRecords: run.calls.filter(call => call.executionSource === 'mock').length, injectedTestRecords: run.calls.filter(call => call.executionSource === 'injected').length, durationMs: run.durationMs ?? null, usage: run.usage, interventions: run.interventions, aiAutonomousStageRatio: run.evidenceKind === 'real-model' ? completedAiStages.length / 8 : null, aiStageCompletionRatio: run.evidenceKind === 'real-model' ? completedAiStages.length / aiStages.length : null, aiStageEvidence: { denominatorStages: [...aiStages, 'Chromium gate', 'evidence packaging'], completedStages: completedAiStages, evidenceSource: 'selected structured outputs + accepted verification records', excludes: 'outside developer activity; not proof of no external intervention' } }; }), humanEfficiencyComparison: { status: 'not-measured', predictionAllowed: '人工基线预测仅在材料中单列范围与依据；没有同范围对照不能宣称实测增效' } },
    attributionAndImprovements: { failures: runs.filter(run => ['failed', 'cancelled', 'interrupted'].includes(run.status)).map(run => ({ id: run.id, evidenceKind: run.evidenceKind, cause: run.error ?? 'unknown', gate: run.gate ?? null })), next: ['验证容器资源/秘密/网络隔离后扩展受控仓库', '固定配置预登记、预算确认后执行三类九次实验', 'AnyJev式typed decision与标注集校准；等级与L4/L5无关', '补实际业务需求、正式L4参考线、3–5分钟完整录屏'] },
    selfEvaluation: { conclusion: live.length ? '仅依据真实记录评估最小闭环；不宣称稳定通用L5' : '工程/Mock可用，真实自主交付未实测，L4未认证', officialL4Reference: '尚未提供', mockIsNotRealRequirement: true, promptVersion: PROMPT_VERSION, verifierVersion: CRITERIA_VERSION, reusePlan: '保留虚拟社会入口；生产模块独立，后续受控模板/仓库和跨任务基准分阶段验证' },
  };
}

function validatedProductionDataDirectory(dataDir: string) {
  if (dataDir.includes('\0') || !path.isAbsolute(dataDir) || path.normalize(dataDir) !== dataDir) throw new Error('生产数据目录必须为规范绝对路径');
  let directory = dataDir;
  // macOS exposes these exact OS aliases. Do not canonicalize arbitrary paths
  // or TMPDIR: doing so would silently approve caller-created symlink escapes.
  if (process.platform === 'darwin') {
    for (const alias of ['/var', '/tmp']) {
      if (directory === alias || directory.startsWith(`${alias}/`)) {
        const physical = `/private${alias}`;
        if (!lstatSync(alias).isSymbolicLink() || realpathSync(alias) !== physical) throw new Error('生产数据系统目录别名不合法');
        directory = `${physical}${directory.slice(alias.length)}`;
        break;
      }
    }
  }
  if (directory === path.parse(directory).root) throw new Error('生产数据目录不得为根目录');
  // Check before ProductionStore can create state or read its encryption key.
  const studyDirectory = path.join(directory, 'production', 'studies');
  let ancestor = path.parse(studyDirectory).root;
  for (const segment of studyDirectory.slice(ancestor.length).split(path.sep)) {
    ancestor = path.join(ancestor, segment);
    if (!existsSync(ancestor)) {
      try { lstatSync(ancestor); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    const stat = lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(ancestor) !== ancestor) throw new Error('生产数据目录不得包含符号链接');
  }
  return directory;
}

export function createProductionService(dataDir: string, options: ProductionOptions = {}) {
  const directory = validatedProductionDataDirectory(dataDir);
  const captured = captureProductionExecutionIdentity();
  const injected = Boolean(options.roleCall || options.jevCall || options.gate || options.cameraGate || options.acceptancePreflight);
  const executionIdentity = options.executionIdentity ?? captured.bootIdentity;
  const assertExecutionFresh = options.assertExecutionFresh ?? (injected ? undefined : captured.assertFresh);
  const store = new ProductionStore(directory); const pipeline = new ProductionPipeline(store, { ...options, executionIdentity, assertExecutionFresh }); const preview = new ProductionPreview(store); const router = Router(); const commit = executionIdentity.commit ?? platformCommit(); const build = executionIdentity.buildSnapshot;
  let benchmark: { controller: AbortController; completion: Promise<unknown> } | undefined;
  const studies = new VerifierStudyController({ directory: path.join(store.directory, 'studies'), bootId: executionIdentity.bootId,
    assertExecutionFresh: assertExecutionFresh ?? captured.assertFresh, isOtherBusy: () => pipeline.busy || Boolean(benchmark), store });
  const action = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => { try { handler(req, res); } catch (error) { const message = store.redact(error instanceof Error ? error.message : String(error)); res.status(error instanceof z.ZodError ? 400 : /不存在/.test(message) ? 404 : /运行中/.test(message) ? 409 : 400).json({ error: message }); } };
  router.get('/agents', action((_req, res) => res.json(store.agents())));
  router.get('/metadata', action((_req, res) => { let assets: { ready: boolean; version: string }; try { assets = verifyCameraAssets(); } catch { assets = { ready: false, version: CAMERA_ASSET_MANIFEST.version }; } res.json({ platformCommit: commit, build, executionIdentity, repairPolicyVersion: PRODUCTION_REPAIR_POLICY_VERSION, jevPolicyVersion: JEV_POLICY_VERSION, verifierVersion: CRITERIA_VERSION, outputContractVersion: OUTPUT_CONTRACT_VERSION, frozenBaseline: 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466', capabilities: PRODUCTION_CAPABILITIES.map(capability => ({ id: capability, promptVersion: contractProfile(capability).promptVersion, acceptanceVersion: contractProfile(capability).acceptanceVersion, ...(capability === 'camera-scene-v1' ? { runtime: cameraRuntimeMetadata(), assets, evidenceScope: 'scene-behavior-synthetic', physicalCameraVerified: false } : {}) })) }); }));
  router.get('/camera-assets/:filename', action((req, res) => { const { pin, value } = readPinnedCameraAsset(String(req.params.filename)); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Asset-SHA256', pin.sha256); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.type(pin.contentType).send(value); }));
  router.get('/camera-runtime/worker.js', action((req, res) => { const origin = cameraOrigin(req); res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${origin}/api/production/camera-assets/ 'wasm-unsafe-eval'; connect-src ${origin}/api/production/camera-assets/; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.type('text/javascript').send(renderCameraHandWorkerSource()); }));
  router.get('/jev/config', action((_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(store.jevConfig()); }));
  router.patch('/jev/config', action((req, res) => { if (pipeline.busy || benchmark || studies.busy) throw new Error('已有运行中的任务，配置修改暂时禁止'); res.setHeader('Cache-Control', 'no-store'); res.json(store.patchJevConfig(req.body)); }));
  router.get('/jev/benchmarks', action((_req, res) => res.json(store.jevBenchmarks())));
  router.post('/jev/benchmarks', action((req, res) => {
    z.object({ budgetAuthorized: z.literal(true) }).strict().parse(req.body);
    if (pipeline.busy || benchmark || studies.busy) throw new Error('已有运行中的任务');
    const config = store.secretJevConfig(); if (!config.enabled || !config.apiKey) throw new Error('请先在页面配置并启用 Jev');
    assertExecutionFresh?.();
    const id = randomUUID(); const controller = new AbortController();
    const completion = runJevBenchmark(config, controller.signal, { id, assertExecutionFresh, onSnapshot: value => { store.saveJevBenchmark({ ...value, platformCommit: commit, executionIdentity }); } }).catch(error => { const previous = (store.jevBenchmarks() as Array<{ id: string; status: string }>).find(item => item.id === id); try { store.saveJevBenchmark({ ...previous, id, platformCommit: commit, executionIdentity, status: 'failed', error: store.redact(error instanceof Error ? error.message : String(error)), note: '基准或证据写入失败；保留已记录原始证据，没有隐式重试' }); } catch { /* Do not erase previous evidence or falsely claim successful persistence. */ } }).finally(() => { benchmark = undefined; });
    benchmark = { controller, completion }; res.status(202).json({ id });
  }));
  router.post('/jev/benchmarks/cancel', action((_req, res) => { if (!benchmark) throw new Error('没有运行中的基准'); benchmark.controller.abort(); res.status(202).json({ cancelling: true }); }));
  const assertStudyIdle = () => { if (studies.busy) throw new Error('已有运行中的评估，配置修改暂时禁止'); };
  router.post('/agents', action((req, res) => { assertStudyIdle(); res.status(201).json(store.addAgent(req.body)); }));
  router.patch('/agents/:id', action((req, res) => { assertStudyIdle(); res.json(store.patchAgent(String(req.params.id), req.body)); }));
  router.post('/agents/:id/clone', action((req, res) => { assertStudyIdle(); res.status(201).json(store.cloneAgent(String(req.params.id))); }));
  router.delete('/agents/:id', action((req, res) => { assertStudyIdle(); store.deleteAgent(String(req.params.id)); res.status(204).end(); }));
  // These routes must not decrypt configured Keys just to sanitize an error in
  // a free/rejected preparation. Public errors are fixed, not untrusted text.
  const studyAction = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { handler(req, res); }
    catch { res.status(400).json({ error: '评估请求被拒绝：请检查运行互斥、配置、凭据公开契约冲突、源码/构建新鲜度或重新准备；不会自动重试。' }); }
  };
  const studyJson = (res: Response, value: unknown, status = 200) => { store.assertStudyPublicSafe(value); res.status(status).json(value); };
  router.get('/verifier-studies', studyAction((_req, res) => studyJson(res, studies.list())));
  router.get('/verifier-studies/:id', studyAction((req, res) => { const run = studies.get(String(req.params.id)); if (!run) throw new Error('评估不存在'); studyJson(res, run); }));
  router.post('/verifier-studies/prepare', studyAction((req, res) => studyJson(res, studies.prepare(req.body), 201)));
  router.post('/verifier-studies/start', studyAction((req, res) => studyJson(res, studies.start(req.body), 202)));
  router.post('/verifier-studies/:id/cancel', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { z.object({}).strict().parse(req.body); const run = await studies.cancel(String(req.params.id)); if (!run) throw new Error('评估不存在'); studyJson(res, run); }
    catch { res.status(400).json({ error: '取消请求未确认；请读取最新状态。不会自动恢复或重复调用。' }); }
  });
  router.get('/runs', action((_req, res) => res.json(store.runs())));
  router.get('/runs/:id', action((req, res) => { const run = store.run(String(req.params.id)); if (!run) throw new Error('运行不存在'); res.json(run); }));
  router.post('/runs', action((req, res) => {
    if (pipeline.busy || benchmark || studies.busy) throw new Error('已有运行中的生产任务');
    const input = productionRunInputSchema.parse(req.body); const agents = store.secretAgents(input.agentIds);
    if (input.mode !== 'live') { const fixture = PRODUCTION_DEMO_CASES.find(item => item.operation === input.demoCaseId); if (!fixture || fixture.brief !== input.brief || fixture.acceptance !== input.requirement.acceptance || input.requirement.kind !== 'illustrative') throw new Error('Mock 只允许明确登记的模拟需求；任意业务需求必须选择真实模式，不能套用固定夹具'); }
    if (new Set(input.agentIds).size !== 6 || PRODUCTION_ROLES.some(role => agents.filter(agent => agent.role === role).length !== 1) || agents.some(agent => !agent.enabled)) throw new Error('必须选择启用的六角色 Agent，每个角色恰好一个');
    if (input.mode === 'live') {
      if (!input.budgetAuthorized) throw new Error('真实运行需要本分支明确预算授权');
      if (agents.some(agent => !agent.apiKey)) throw new Error('请在本分支页面为每个角色配置 API Key');
      if (agents.some(agent => !agent.pricing || agent.pricing.currency !== input.limits.currency)) throw new Error('每个角色需配置与预算同币种的用户声明费率；费用未知时不启动');
      // Only explicit control-side injected-role engineering tests can exercise
      // scene contracts without prepared vision assets. Network API callers
      // cannot enable this; ordinary live calls fail before any paid request.
      if (input.capability === 'camera-scene-v1' && !options.roleCall) verifyCameraAssets();
    }
    const usesJev = input.mode === 'mock-jev' || input.mode === 'live' && input.verifierEngine === 'jev-cascade';
    if (usesJev) { const config = store.jevConfig(); if (!config.enabled || !config.hasApiKey) throw new Error('请在本分支页面启用并配置 Jev'); if (!input.budgetAuthorized || input.limits.currency !== 'USD') throw new Error('Jev 需要明确授权的 USD 预算'); if (config.outputPerMillion !== 0) throw new Error('本版 Jev 预留策略仅支持官方当前免费输出；非零输出费用需要另行验证上界'); input.verifierEngine = 'jev-cascade'; }
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), platformCommit: commit, ...(usesJev ? { jevSnapshot: store.jevConfig(), jevCalls: [] } : {}), evidenceKind: options.acceptancePreflight ? 'injected-test' : input.mode === 'demo' ? 'fixture' : options.roleCall || options.gate || options.cameraGate || options.jevCall ? 'injected-test' : input.mode === 'mock-jev' ? 'fixture-with-real-jev' : 'real-model', agentSnapshot: agents.map(({ apiKey: _, ...agent }) => agent), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, repairPolicyVersion: PRODUCTION_REPAIR_POLICY_VERSION, repairHistory: [], usage: { inputTokens: input.mode === 'demo' ? 0 : null, outputTokens: input.mode === 'demo' ? 0 : null, estimatedCost: input.mode === 'demo' ? 0 : null, currency: input.limits.currency, complete: input.mode === 'demo' }, interventions: [], artifacts: [] };
    if (input.mode !== 'demo') assertExecutionFresh?.();
    run.executionIdentity = structuredClone(executionIdentity);
    store.addRun(run, input.agentIds); pipeline.start(store.run(run.id)!); res.status(202).json(store.run(run.id));
  }));
  router.post('/runs/:id/cancel', action((req, res) => { const id = String(req.params.id); const run = store.run(id); if (!run) throw new Error('运行不存在'); if (!['queued', 'running'].includes(run.status)) throw new Error('任务不在运行中，不能再次取消'); pipeline.cancel(id); res.json(store.run(id)); }));
  router.get('/runs/:id/scene-preview', action((req, res) => {
    const id = String(req.params.id); const run = store.run(id);
    if (!run || run.input.capability !== 'camera-scene-v1' || run.status !== 'completed' || !run.cameraVerification?.boundedScenePassed) throw new Error('受控场景尚未通过行为Gate或不存在');
    const scene = cameraSceneSchema.parse(JSON.parse(store.readArtifact(id, 'scene.json')));
    const manifest = JSON.parse(store.readArtifact(id, 'camera-runtime-manifest.json')); const runtime = cameraRuntimeMetadata();
    if (manifest.hash !== runtime.hash || manifest.version !== runtime.version || manifest.sceneSha256 !== hash(JSON.stringify(scene)) || run.frozenContract?.runtimeHash !== runtime.hash) throw new Error('场景或可信运行时与冻结证据不一致，请开启新版本实验重新验收');
    res.setHeader('Content-Security-Policy', cameraPreviewCsp(cameraOrigin(req))); res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), display-capture=()'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('X-Preview-Mode', 'trusted-declarative-camera-scene'); res.type('html').send(renderCameraSceneHtml(scene, { mode: 'camera' }));
  }));
  router.get('/runs/:id/preview', async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const disconnect = () => { if (!res.writableEnded) abort(); };
    req.once('aborted', abort); res.once('close', disconnect);
    try {
      const png = await preview.capture(String(req.params.id), controller.signal);
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline; filename="preview.png"');
      res.setHeader('X-Preview-Mode', 'static-image-bounded-capture');
      res.type('png').send(png);
    } catch (error) {
      if (!res.destroyed && !res.headersSent) { const message = store.redact(error instanceof Error ? error.message : String(error)); res.status(/运行中/.test(message) ? 409 : /不存在/.test(message) ? 404 : /时间|超时/.test(message) ? 504 : 400).json({ error: message }); }
    } finally { req.off('aborted', abort); res.off('close', disconnect); }
  });
  router.get('/runs/:id/artifacts/:name', action((req, res) => { const id = String(req.params.id); const name = String(req.params.name); const value = store.readArtifact(id, name); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); if (name === 'index.html') { res.setHeader('Content-Security-Policy', PRODUCTION_ARTIFACT_CSP); res.setHeader('Content-Disposition', 'attachment; filename="index.html"'); res.type('text/plain').send(value); } else { res.type('json').send(value); } }));
  router.get('/report', action((_req, res) => res.json({ ...productionReport(store.runs()), jevBenchmarks: store.jevBenchmarks() })));
  return { router, store, pipeline, preview, studies, close: async () => { benchmark?.controller.abort(); await Promise.all([pipeline.stop(), benchmark?.completion, preview.close(), studies.close()]); } };
}
