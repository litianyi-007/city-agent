import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { PRODUCTION_ROLES, productionRunInputSchema, type ProductionRun } from '../../shared/production-schema.js';
import { PROMPT_VERSION, CRITERIA_VERSION } from './contracts.js';
import { ProductionPipeline, type ProductionOptions } from './pipeline.js';
import { ProductionStore } from './store.js';
import { platformCommit, buildProvenance } from './provenance.js';
import { runJevBenchmark } from './jev-benchmark.js';
import { PRODUCTION_DEMO_CASES } from '../../shared/production-benchmarks.js';
import { ProductionPreview } from './preview.js';
import type { JevEvaluation } from '../../shared/jev-schema.js';

// Source is a download, never an execution-capable document in the UI browser.
export const PRODUCTION_ARTIFACT_CSP = "default-src 'none'; connect-src 'none'; frame-ancestors 'none'; sandbox";

/** The persisted intent is not evidence that its HTTP request never occurred. */
export function isUnresolvedJevIntent(evaluation: JevEvaluation): boolean {
  return evaluation.providerRequests === 0 && evaluation.durationMs === 0 && evaluation.requestSnapshot === null && evaluation.rawResponse === null && evaluation.httpStatus === null && evaluation.modelIdReturned === null && !evaluation.error && !evaluation.usage.complete;
}
export function productionRequestCounts(run: ProductionRun) {
  const harness = run.calls.filter(call => call.executionSource === 'harness');
  const known = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  const harnessCounts = harness.map(call => known(call.providerRequests?.requests) ? call.providerRequests!.requests : null);
  const jevCounts = (run.jevCalls ?? []).map(call => !isUnresolvedJevIntent(call.evaluation) && known(call.evaluation.providerRequests) ? call.evaluation.providerRequests : null);
  const unknownHarnessRequestIntents = harnessCounts.filter(value => value === null).length;
  const unknownJevRequestIntents = jevCounts.filter(value => value === null).length;
  const safeSum = (values: Array<number | null>) => { const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0); return known(sum) ? sum : null; };
  const knownHarnessProviderRequests = safeSum(harnessCounts); const knownJevProviderRequests = safeSum(jevCounts);
  const knownProviderRequests = safeSum([...harnessCounts, ...jevCounts]);
  return { harnessInvocations: harness.length, actualProviderRequests: unknownHarnessRequestIntents + unknownJevRequestIntents ? null : knownProviderRequests, knownProviderRequests, unknownRequestIntents: unknownHarnessRequestIntents + unknownJevRequestIntents, knownHarnessProviderRequests, unknownHarnessRequestIntents, jevProviderRequests: unknownJevRequestIntents ? null : knownJevProviderRequests, knownJevProviderRequests, unknownJevRequestIntents, actualProviderRequestsDefinition: 'Observed HTTP attempts, not an invoice; unresolved intents are unknown, known subtotal retained', actualModelCalls: harness.length, actualModelCallsDefinition: 'Deprecated alias of Harness invocations; use actualProviderRequests for HTTP attempts' };
}

export function productionReport(runs: ProductionRun[]) {
  const live = runs.filter(run => run.evidenceKind === 'real-model'); const terminal = live.filter(run => !['queued', 'running'].includes(run.status));
  const passed = terminal.filter(run => run.status === 'completed' && run.gate?.passed);
  const fixture = runs.filter(run => run.evidenceKind === 'fixture');
  const aiStages = ['product', 'research', 'think-design', 'acceptance', 'implement', 'feedback-0'];
  const requestCounts = productionRequestCounts;
  return {
    version: 'production-submission-v1', generatedAt: new Date().toISOString(),
    basicInfo: { pipelineName: 'Agent Delivery Studio — 有界 HTML 软件生产', team: '用户定义目标/权限/预算，平台内六角色执行；外层开发 Agent 建设平台不计为内部交付', requirementType: '离线单HTML小应用，演示可含新建/增量/缺陷场景，不是任意仓库自动生产' },
    pipelineDesign: { stages: ['产品扩展', '研究约束', '项目经理思考与设计', '测试契约冻结', '研发', '独立Chromium硬Gate', '项目经理反馈→有限返修', '交付'], roles: PRODUCTION_ROLES, verifier: '每个可替换角色输出的全部合法候选经过独立序数审查；单候选也验证；错误或弃权失败关闭；不覆盖硬Gate', humanBoundary: '初始需求、权限、预算及缺信息/高风险决策属于人；不得手改生成产物或临时放宽门禁后计成功', scope: '无容器安全执行环境，禁止宿主生成Node/shell执行', reusable: '真实运行根据需求和冻结契约生成；Mock通过显式case配置，不用于真实题关键词特判', references: [{ name: 'LLM-as-a-Verifier', url: 'https://github.com/llm-as-a-verifier/llm-as-a-verifier', relationship: '概念借鉴；JSON ordinal审查未复现原score-token logprobs算法' }, { name: 'AnyJev', url: 'https://github.com/nokia-applied-research/AnyJev', relationship: '仅调研与后续 typed proceed/revise/abstain/stop 与标注校准计划；本项目未实现原prefill/readout/head' }] },
    requirements: runs.map(run => ({ runId: run.id, ...run.input.requirement, brief: run.input.brief, evidenceKind: run.evidenceKind })),
    executionRecords: runs.map(run => ({ id: run.id, inputSnapshot: run.input, agentSnapshot: run.agentSnapshot, platformCommit: run.platformCommit ?? null, jevSnapshot: run.jevSnapshot ?? null, jevCalls: run.jevCalls ?? [], status: run.status, evidenceKind: run.evidenceKind, ...requestCounts(run), simulatedStageRecords: run.calls.filter(call => call.executionSource === 'mock').length, injectedTestRecords: run.calls.filter(call => call.executionSource === 'injected').length, frozenContract: run.frozenContract, outputs: run.outputs, gateHistory: run.gateHistory, logs: run.artifacts.some(artifact => artifact.name === 'evidence.json') ? `/api/production/runs/${run.id}/artifacts/evidence.json` : null, artifacts: run.artifacts, durationMs: run.durationMs ?? null, video: null })),
    requestLedger: runs.map(run => ({ id: run.id, ...requestCounts(run) })),
    metrics: { realModelStarted: live.length, realModelTerminal: terminal.length, realModelPassed: passed.length, goodProductRate: terminal.length ? passed.length / terminal.length : null, rateDenominator: '全部终态真实模型启动尝试（含失败、取消、中断）；非同冻结配置的统计不得称稳定性实验', fixtureStarted: fixture.length, fixturePassed: fixture.filter(run => run.status === 'completed' && run.gate?.passed).length, fixtureExcludedFromAutonomousSuccess: true, stageDefinition: { plannedAiStages: aiStages, deterministicStages: ['Chromium gate', 'evidence packaging'], plannedAiFraction: 6 / 8, note: '设计占比不是实测无人干预率；返修新增阶段单列调用记录' }, perRun: runs.map(run => { const completedAiStages = aiStages.filter(phase => run.outputs.some(output => output.phase === phase) && run.verifications.some(review => review.phase === phase && review.decision === 'accept')); return { id: run.id, evidenceKind: run.evidenceKind, callRecords: run.calls.length, ...requestCounts(run), simulatedStageRecords: run.calls.filter(call => call.executionSource === 'mock').length, injectedTestRecords: run.calls.filter(call => call.executionSource === 'injected').length, durationMs: run.durationMs ?? null, usage: run.usage, interventions: run.interventions, aiAutonomousStageRatio: run.evidenceKind === 'real-model' ? completedAiStages.length / 8 : null, aiStageCompletionRatio: run.evidenceKind === 'real-model' ? completedAiStages.length / aiStages.length : null, aiStageEvidence: { denominatorStages: [...aiStages, 'Chromium gate', 'evidence packaging'], completedStages: completedAiStages, evidenceSource: 'selected structured outputs + accepted verification records', excludes: 'outside developer activity; not proof of no external intervention' } }; }), humanEfficiencyComparison: { status: 'not-measured', predictionAllowed: '人工基线预测仅在材料中单列范围与依据；没有同范围对照不能宣称实测增效' } },
    attributionAndImprovements: { failures: runs.filter(run => ['failed', 'cancelled', 'interrupted'].includes(run.status)).map(run => ({ id: run.id, evidenceKind: run.evidenceKind, cause: run.error ?? 'unknown', gate: run.gate ?? null })), next: ['验证容器资源/秘密/网络隔离后扩展受控仓库', '固定配置预登记、预算确认后执行三类九次实验', 'AnyJev式typed decision与标注集校准；等级与L4/L5无关', '补实际业务需求、正式L4参考线、3–5分钟完整录屏'] },
    selfEvaluation: { conclusion: live.length ? '仅依据真实记录评估最小闭环；不宣称稳定通用L5' : '工程/Mock可用，真实自主交付未实测，L4未认证', officialL4Reference: '尚未提供', mockIsNotRealRequirement: true, promptVersion: PROMPT_VERSION, verifierVersion: CRITERIA_VERSION, reusePlan: '保留虚拟社会入口；生产模块独立，后续受控模板/仓库和跨任务基准分阶段验证' },
  };
}

export function createProductionService(dataDir: string, options: ProductionOptions = {}) {
  const store = new ProductionStore(dataDir); const pipeline = new ProductionPipeline(store, options); const preview = new ProductionPreview(store); const router = Router(); const commit = platformCommit(); const build = buildProvenance();
  let benchmark: { controller: AbortController; completion: Promise<unknown> } | undefined;
  const action = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => { try { handler(req, res); } catch (error) { const message = store.redact(error instanceof Error ? error.message : String(error)); res.status(error instanceof z.ZodError ? 400 : /不存在/.test(message) ? 404 : /运行中/.test(message) ? 409 : 400).json({ error: message }); } };
  router.get('/agents', action((_req, res) => res.json(store.agents())));
  router.get('/metadata', action((_req, res) => res.json({ platformCommit: commit, build, frozenBaseline: 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466' })));
  router.get('/jev/config', action((_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(store.jevConfig()); }));
  router.patch('/jev/config', action((req, res) => { if (pipeline.busy || benchmark) throw new Error('已有运行中的任务，配置修改暂时禁止'); res.setHeader('Cache-Control', 'no-store'); res.json(store.patchJevConfig(req.body)); }));
  router.get('/jev/benchmarks', action((_req, res) => res.json(store.jevBenchmarks())));
  router.post('/jev/benchmarks', action((req, res) => {
    z.object({ budgetAuthorized: z.literal(true) }).strict().parse(req.body);
    if (pipeline.busy || benchmark) throw new Error('已有运行中的任务');
    const config = store.secretJevConfig(); if (!config.enabled || !config.apiKey) throw new Error('请先在页面配置并启用 Jev');
    const id = randomUUID(); const controller = new AbortController();
    const completion = runJevBenchmark(config, controller.signal, { id, onSnapshot: value => { store.saveJevBenchmark({ ...value, platformCommit: commit }); } }).catch(error => { const previous = (store.jevBenchmarks() as Array<{ id: string; status: string }>).find(item => item.id === id); try { store.saveJevBenchmark({ ...previous, id, platformCommit: commit, status: 'failed', error: store.redact(error instanceof Error ? error.message : String(error)), note: '基准或证据写入失败；保留已记录原始证据，没有隐式重试' }); } catch { /* Do not erase previous evidence or falsely claim successful persistence. */ } }).finally(() => { benchmark = undefined; });
    benchmark = { controller, completion }; res.status(202).json({ id });
  }));
  router.post('/jev/benchmarks/cancel', action((_req, res) => { if (!benchmark) throw new Error('没有运行中的基准'); benchmark.controller.abort(); res.status(202).json({ cancelling: true }); }));
  router.post('/agents', action((req, res) => res.status(201).json(store.addAgent(req.body))));
  router.patch('/agents/:id', action((req, res) => res.json(store.patchAgent(String(req.params.id), req.body))));
  router.post('/agents/:id/clone', action((req, res) => res.status(201).json(store.cloneAgent(String(req.params.id)))));
  router.delete('/agents/:id', action((req, res) => { store.deleteAgent(String(req.params.id)); res.status(204).end(); }));
  router.get('/runs', action((_req, res) => res.json(store.runs())));
  router.get('/runs/:id', action((req, res) => { const run = store.run(String(req.params.id)); if (!run) throw new Error('运行不存在'); res.json(run); }));
  router.post('/runs', action((req, res) => {
    if (pipeline.busy || benchmark) throw new Error('已有运行中的生产任务');
    const input = productionRunInputSchema.parse(req.body); const agents = store.secretAgents(input.agentIds);
    if (input.mode !== 'live') { const fixture = PRODUCTION_DEMO_CASES.find(item => item.operation === input.demoCaseId); if (!fixture || fixture.brief !== input.brief || fixture.acceptance !== input.requirement.acceptance || input.requirement.kind !== 'illustrative') throw new Error('Mock 只允许明确登记的模拟需求；任意业务需求必须选择真实模式，不能套用固定夹具'); }
    if (new Set(input.agentIds).size !== 6 || PRODUCTION_ROLES.some(role => agents.filter(agent => agent.role === role).length !== 1) || agents.some(agent => !agent.enabled)) throw new Error('必须选择启用的六角色 Agent，每个角色恰好一个');
    if (input.mode === 'live') {
      if (!input.budgetAuthorized) throw new Error('真实运行需要本分支明确预算授权');
      if (agents.some(agent => !agent.apiKey)) throw new Error('请在本分支页面为每个角色配置 API Key');
      if (agents.some(agent => !agent.pricing || agent.pricing.currency !== input.limits.currency)) throw new Error('每个角色需配置与预算同币种的用户声明费率；费用未知时不启动');
    }
    const usesJev = input.mode === 'mock-jev' || input.mode === 'live' && input.verifierEngine === 'jev-cascade';
    if (usesJev) { const config = store.jevConfig(); if (!config.enabled || !config.hasApiKey) throw new Error('请在本分支页面启用并配置 Jev'); if (!input.budgetAuthorized || input.limits.currency !== 'USD') throw new Error('Jev 需要明确授权的 USD 预算'); if (config.outputPerMillion !== 0) throw new Error('本版 Jev 预留策略仅支持官方当前免费输出；非零输出费用需要另行验证上界'); input.verifierEngine = 'jev-cascade'; }
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), platformCommit: commit, ...(usesJev ? { jevSnapshot: store.jevConfig(), jevCalls: [] } : {}), evidenceKind: input.mode === 'demo' ? 'fixture' : options.roleCall || options.gate || options.jevCall ? 'injected-test' : input.mode === 'mock-jev' ? 'fixture-with-real-jev' : 'real-model', agentSnapshot: agents.map(({ apiKey: _, ...agent }) => agent), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: input.mode === 'demo' ? 0 : null, outputTokens: input.mode === 'demo' ? 0 : null, estimatedCost: input.mode === 'demo' ? 0 : null, currency: input.limits.currency, complete: input.mode === 'demo' }, interventions: [], artifacts: [] };
    store.addRun(run, input.agentIds); pipeline.start(store.run(run.id)!); res.status(202).json(store.run(run.id));
  }));
  router.post('/runs/:id/cancel', action((req, res) => { const id = String(req.params.id); const run = store.run(id); if (!run) throw new Error('运行不存在'); if (!['queued', 'running'].includes(run.status)) throw new Error('任务不在运行中，不能再次取消'); pipeline.cancel(id); res.json(store.run(id)); }));
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
  return { router, store, pipeline, preview, close: async () => { benchmark?.controller.abort(); await Promise.all([pipeline.stop(), benchmark?.completion, preview.close()]); } };
}
