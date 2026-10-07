import { createHash, randomUUID } from 'node:crypto';
import { JEV_POLICY_VERSION, jevConfigSchema, type JevCandidateContext, type JevConfig, type JevEvaluation, type SecretJevConfig } from '../../shared/jev-schema.js';
import { PRODUCTION_DEMO_CASES } from '../../shared/production-benchmarks.js';
import { productionRunInputSchema } from '../../shared/production-schema.js';
import { runGate, type AcceptanceCheck } from '../gate.js';
import type { GateResult } from '../types.js';
import { demoChecks, demoHtml } from './fixtures.js';
import { evaluateJevCandidates } from './jev.js';

export const JEV_BENCHMARK_VERSION = 'jev-engineered-candidate-pool-v1';
export const JEV_BENCHMARK_DECLARATION = '用户授权自拟的三个 MOCK 需求；每题两个外层工程人工构造候选。候选不是模型生成；本实验只比较这三个冻结池，不能证明真实需求良品率、概率校准或泛化提升。';
export const JEV_BENCHMARK_LIMITS = Object.freeze({ maxProviderRequests: 3, maxInputTokensPerRequest: 65536, maxTotalTokens: 196608, maxCost: 1, currency: 'USD' as const });
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const usageReported = (usage: JevEvaluation['usage']) => usage.complete && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens! >= 0 && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens! >= 0 && typeof usage.estimatedCost === 'number' && Number.isFinite(usage.estimatedCost) && usage.estimatedCost >= 0;

export interface JevBenchmarkCandidate {
  id: string;
  html: string;
  sourceSha256: string;
  construction: 'reference-fixture' | 'deliberate-business-defect';
  defect: string | null;
  gate: GateResult | null;
  gateError: string | null;
  gateDurationMs: number | null;
}
export interface JevBenchmarkCase {
  id: string;
  title: string;
  goal: string;
  acceptance: string;
  source: string;
  requirementKind: 'illustrative';
  status: 'pending' | 'evaluating' | 'gating' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  attempted: boolean;
  evaluationInvoked: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  frozenChecks: AcceptanceCheck[];
  frozenChecksHash: string;
  candidatePoolHash: string;
  candidates: JevBenchmarkCandidate[];
  evaluation: JevEvaluation | null;
  evaluationError: string | null;
  selectedCandidateId: string | null;
  comparison: { firstCandidateId: string; firstPassed: boolean | null; selectedPassed: boolean | null; abstained: boolean; change: 'improved' | 'regressed' | 'unchanged' | 'abstained' | 'unknown' };
  skipReason: string | null;
}
export interface JevBenchmarkRun {
  id: string;
  version: string;
  policyVersion: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  declaration: string;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  config: JevConfig;
  configHash: string;
  poolHash: string;
  evidenceSource: 'live-jev-evaluation' | 'injected-test';
  gateSource: 'chromium' | 'injected-test';
  maxRequests: number;
  limits: typeof JEV_BENCHMARK_LIMITS;
  cases: JevBenchmarkCase[];
  usage: JevEvaluation['usage'] & { providerRequests: number | null; evaluationAttempts: number };
  metrics: { attemptedCases: number; gateCompleteCases: number; firstPassed: number; firstUnmeasured: number; selectedPassed: number; selectedGateUnmeasured: number; abstained: number; unselected: number; evaluationFailures: number; firstPassRate: number | null; selectedPassRate: number | null; selectionCoverage: number | null; selectivePassRate: number | null; denominator: string };
  error: string | null;
}
export interface JevBenchmarkOptions {
  id?: string;
  evaluate?: typeof evaluateJevCandidates;
  gate?: typeof runGate;
  /** Control-plane disk freshness, not an injected evaluator or model result. */
  assertExecutionFresh?: () => void;
  /** Awaited before any evaluation, then after every meaningful state change. */
  onSnapshot?: (run: JevBenchmarkRun) => void | Promise<void>;
}

function poolMaterial(cases: JevBenchmarkCase[]) {
  return cases.map(item => ({ id: item.id, goal: item.goal, acceptance: item.acceptance, checks: item.frozenChecks, candidates: item.candidates.map(candidate => ({ id: candidate.id, sourceSha256: sha(candidate.html) })) }));
}

/** Fixture mutations exist only in this preregistered benchmark, never in live production. */
function defectiveHtml(operation: typeof PRODUCTION_DEMO_CASES[number]['operation'], html: string) {
  const mutations = {
    create: { from: 'span.textContent=task.title;', to: "span.textContent='任务';", description: '新增任务显示固定标题，不保留用户输入的任务名称。' },
    feature: { from: "filter='open';render()", to: "tasks.splice(0,tasks.length,...tasks.filter(task=>!task.done));filter='open';render()", description: '未完成筛选破坏源任务数组，切回全部无法恢复完成项。' },
    bugfix: { from: "if(!title){feedback.textContent='任务不能为空';return}", to: "if(!title){tasks.push({id:nextId++,title:'默认任务',done:false});feedback.textContent='已添加';render();return}", description: '空白输入新增默认任务而不是拒绝，破坏空任务验收。' },
  };
  const mutation = mutations[operation];
  if (html.split(mutation.from).length !== 2) throw new Error('Benchmark fixture changed; register a new pool version instead of guessing a mutation.');
  return { html: html.replace(mutation.from, mutation.to), defect: mutation.description };
}

export function createJevBenchmarkSnapshot(config: SecretJevConfig, options: { id?: string; now?: string } = {}): JevBenchmarkRun {
  const { apiKey: _key, ...publicConfig } = config;
  const frozenConfig = jevConfigSchema.parse(publicConfig);
  const cases: JevBenchmarkCase[] = PRODUCTION_DEMO_CASES.map((item, index) => {
    const input = productionRunInputSchema.parse({ brief: item.brief, mode: 'demo', demoCaseId: item.operation, agentIds: Array.from({ length: 6 }, () => '00000000-0000-4000-8000-000000000001'), requirement: { id: item.id, source: item.source, background: item.background, acceptance: item.acceptance, difficulty: item.difficulty, kind: item.kind } });
    const reference = demoHtml(input); const defective = defectiveHtml(item.operation, reference);
    // Preregistered alternating positions: not every first answer is artificially bad.
    const positions = index === 1 ? [{ html: reference, construction: 'reference-fixture' as const, defect: null }, { ...defective, construction: 'deliberate-business-defect' as const }] : [{ ...defective, construction: 'deliberate-business-defect' as const }, { html: reference, construction: 'reference-fixture' as const, defect: null }];
    const candidates = positions.map((candidate, position) => ({ id: `candidate-${position === 0 ? 'a' : 'b'}`, ...candidate, sourceSha256: sha(candidate.html), gate: null, gateError: null, gateDurationMs: null }));
    const checks = demoChecks(item.operation);
    return { id: item.id, title: item.title, goal: item.brief, acceptance: item.acceptance, source: item.source, requirementKind: 'illustrative', status: 'pending', attempted: false, evaluationInvoked: false, startedAt: null, finishedAt: null, frozenChecks: checks, frozenChecksHash: sha(checks), candidatePoolHash: sha(candidates.map(candidate => ({ id: candidate.id, sourceSha256: candidate.sourceSha256 }))), candidates, evaluation: null, evaluationError: null, selectedCandidateId: null, comparison: { firstCandidateId: candidates[0].id, firstPassed: null, selectedPassed: null, abstained: true, change: 'unknown' }, skipReason: null } satisfies JevBenchmarkCase;
  });
  return { id: options.id ?? randomUUID(), version: JEV_BENCHMARK_VERSION, policyVersion: JEV_POLICY_VERSION, status: 'queued', declaration: JEV_BENCHMARK_DECLARATION, createdAt: options.now ?? new Date().toISOString(), finishedAt: null, durationMs: null, config: frozenConfig, configHash: sha({ version: JEV_BENCHMARK_VERSION, policyVersion: JEV_POLICY_VERSION, config: frozenConfig, limits: JEV_BENCHMARK_LIMITS }), poolHash: sha(poolMaterial(cases)), evidenceSource: 'live-jev-evaluation', gateSource: 'chromium', maxRequests: Math.min(JEV_BENCHMARK_LIMITS.maxProviderRequests, frozenConfig.maxRequests), limits: copy(JEV_BENCHMARK_LIMITS), cases, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true, providerRequests: 0, evaluationAttempts: 0 }, metrics: { attemptedCases: 0, gateCompleteCases: 0, firstPassed: 0, firstUnmeasured: 0, selectedPassed: 0, selectedGateUnmeasured: 0, abstained: 0, unselected: 0, evaluationFailures: 0, firstPassRate: null, selectedPassRate: null, selectionCoverage: null, selectivePassRate: null, denominator: 'Selection success uses every attempted case: abstentions/errors/cancellations do not disappear. Unmeasured baseline Gates make its pass rate unknown. Selective rate uses only selected candidates with actual Gate results.' }, error: null };
}

function updateSummary(run: JevBenchmarkRun) {
  const attempted = run.cases.filter(item => item.attempted);
  const evaluations = attempted.flatMap(item => item.evaluation ? [item.evaluation] : []);
  const paid = evaluations.filter(item => item.providerRequests > 0);
  const unknownRequests = attempted.some(item => item.evaluationInvoked && !item.evaluation) || evaluations.some(item => !Number.isSafeInteger(item.providerRequests) || item.providerRequests < 0);
  const unknown = unknownRequests || paid.some(item => !usageReported(item.usage));
  run.usage = { inputTokens: unknown ? null : paid.reduce((sum, item) => sum + item.usage.inputTokens!, 0), outputTokens: unknown ? null : paid.reduce((sum, item) => sum + item.usage.outputTokens!, 0), estimatedCost: unknown ? null : paid.reduce((sum, item) => sum + item.usage.estimatedCost!, 0), currency: 'USD', complete: !unknown, providerRequests: unknownRequests ? null : evaluations.reduce((sum, item) => sum + item.providerRequests, 0), evaluationAttempts: attempted.length };
  const firstPassed = attempted.filter(item => item.comparison.firstPassed === true).length;
  const selectedPassed = attempted.filter(item => item.comparison.selectedPassed === true).length;
  const selected = attempted.filter(item => item.selectedCandidateId !== null);
  const selectedKnown = selected.filter(item => item.comparison.selectedPassed !== null);
  const firstUnmeasured = attempted.filter(item => item.comparison.firstPassed === null).length;
  run.metrics = { ...run.metrics, attemptedCases: attempted.length, gateCompleteCases: attempted.filter(item => item.candidates.every(candidate => candidate.gate !== null)).length, firstPassed, firstUnmeasured, selectedPassed, selectedGateUnmeasured: selected.length - selectedKnown.length, abstained: attempted.filter(item => item.evaluation?.status === 'uncertain' || item.evaluation?.status === 'rejected').length, unselected: attempted.length - selected.length, evaluationFailures: attempted.filter(item => item.evaluationError !== null).length, firstPassRate: attempted.length && !firstUnmeasured ? firstPassed / attempted.length : null, selectedPassRate: attempted.length ? selectedPassed / attempted.length : null, selectionCoverage: attempted.length ? selected.length / attempted.length : null, selectivePassRate: selectedKnown.length ? selectedPassed / selectedKnown.length : null };
}

function compare(item: JevBenchmarkCase) {
  const baseline = item.candidates[0]; const selected = item.candidates.find(candidate => candidate.id === item.selectedCandidateId);
  const firstPassed = baseline.gate?.passed ?? null; const selectedPassed = selected?.gate?.passed ?? null;
  const change = !selected ? 'abstained' : firstPassed === null || selectedPassed === null ? 'unknown' : firstPassed === selectedPassed ? 'unchanged' : selectedPassed ? 'improved' : 'regressed';
  item.comparison = { firstCandidateId: baseline.id, firstPassed, selectedPassed, abstained: !selected, change };
}

/** One blind evaluation per case, followed by the independent oracle; no retries or fallback. */
export async function runJevBenchmark(config: SecretJevConfig, signal: AbortSignal, options: JevBenchmarkOptions = {}): Promise<JevBenchmarkRun> {
  const started = Date.now(); const run = createJevBenchmarkSnapshot(config, { id: options.id });
  run.evidenceSource = options.evaluate ? 'injected-test' : 'live-jev-evaluation'; run.gateSource = options.gate ? 'injected-test' : 'chromium';
  const frozenSecretConfig = { ...copy(run.config), ...(config.apiKey ? { apiKey: config.apiKey } : {}) };
  const redact = (value: string) => frozenSecretConfig.apiKey ? value.split(frozenSecretConfig.apiKey).join('[REDACTED]') : value;
  const sanitized = <T>(value: T): T => { if (typeof value === 'string') return redact(value) as T; if (Array.isArray(value)) return value.map(item => sanitized(item)) as T; if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitized(item)])) as T; return value; };
  const snapshot = async () => { updateSummary(run); await options.onSnapshot?.(copy(run)); };
  const assertFrozen = () => { if (sha(poolMaterial(run.cases)) !== run.poolHash || sha({ version: JEV_BENCHMARK_VERSION, policyVersion: JEV_POLICY_VERSION, config: run.config, limits: run.limits }) !== run.configHash) throw new Error('Frozen benchmark pool or configuration changed. Register a new experiment.'); };
  // Failure to persist the start snapshot propagates before a potentially paid call.
  await snapshot();
  let stopReason: string | null = null;
  try {
    signal.throwIfAborted();
    if (!options.evaluate && !options.assertExecutionFresh) throw new Error('缺少生产启动身份门禁，拒绝真实Jev基准请求');
    if (run.limits.maxProviderRequests * run.limits.maxInputTokensPerRequest * run.config.inputPerMillion / 1e6 > run.limits.maxCost) throw new Error('The preregistered three-request conservative input reserve exceeds the 1 USD batch cap.');
    if (run.config.outputPerMillion !== 0) throw new Error('This bounded Jev benchmark requires the documented zero output fee; a nonzero fee needs a validated provider output bound.');
    Object.freeze(frozenSecretConfig); run.status = 'running'; await snapshot();
    for (const item of run.cases) {
      signal.throwIfAborted();
      if (run.usage.evaluationAttempts >= run.maxRequests || stopReason) { item.status = 'skipped'; item.skipReason = stopReason ?? 'Predeclared request cap reached; no automatic retry.'; continue; }
      if (!run.usage.complete || (run.usage.inputTokens! + run.usage.outputTokens! + run.limits.maxInputTokensPerRequest) > run.limits.maxTotalTokens || run.usage.estimatedCost! + run.limits.maxInputTokensPerRequest * run.config.inputPerMillion / 1e6 > run.limits.maxCost) { stopReason = 'Conservative token/cost reserve is exhausted; no further evaluation request.'; item.status = 'skipped'; item.skipReason = stopReason; continue; }
      assertFrozen(); item.status = 'evaluating'; item.attempted = true; item.startedAt = new Date().toISOString(); await snapshot();
      const context: JevCandidateContext = { phase: 'developer', goal: item.goal, acceptance: item.acceptance, frozenHash: item.frozenChecksHash, candidates: item.candidates.map(candidate => ({ id: candidate.id, value: { html: candidate.html } })) };
      try {
        options.assertExecutionFresh?.();
        signal.throwIfAborted(); item.evaluationInvoked = true; await snapshot(); signal.throwIfAborted();
        // Persistence may yield. A second refusal is still a local preflight,
        // not an invoked evaluator or unknown provider request.
        try { options.assertExecutionFresh?.(); } catch (error) { item.evaluationInvoked = false; throw error; }
        item.evaluation = sanitized(copy(await (options.evaluate ?? evaluateJevCandidates)(frozenSecretConfig, context, signal)));
        if (item.evaluation.status === 'accepted') {
          if (!item.candidates.some(candidate => candidate.id === item.evaluation!.selectedCandidateId)) throw new Error('Jev selected a candidate outside the frozen pool.');
          item.selectedCandidateId = item.evaluation.selectedCandidateId;
        }
        if (!Number.isSafeInteger(item.evaluation.providerRequests) || item.evaluation.providerRequests < 0 || item.evaluation.providerRequests > 1) throw new Error('One provider attempt per case is the frozen limit.');
        if (item.evaluation.status === 'error') item.evaluationError = item.evaluation.error ?? item.evaluation.reason;
        if (item.evaluation.providerRequests > 0 && !usageReported(item.evaluation.usage)) throw new Error(`${item.evaluationError ? `${item.evaluationError}; ` : ''}Jev usage or estimated cost is unknown; mark this case failed and stop further requests.`);
        updateSummary(run);
        if (item.evaluation.providerRequests > 0 && item.evaluation.usage.complete && ((item.evaluation.usage.inputTokens ?? 0) > run.limits.maxInputTokensPerRequest || run.usage.inputTokens! + run.usage.outputTokens! > run.limits.maxTotalTokens || run.usage.estimatedCost! > run.limits.maxCost)) throw new Error('Actual reported usage exceeds a preregistered input/token/cost limit; no further evaluation.');
      } catch (error) { item.evaluationError = redact(error instanceof Error ? error.message : String(error)); }
      assertFrozen(); await snapshot(); signal.throwIfAborted();
      // Oracle, defect labels and expected results never enter the evaluator context.
      item.status = 'gating'; await snapshot();
      for (const candidate of item.candidates) {
        signal.throwIfAborted(); const gateStarted = Date.now();
        try { candidate.gate = await (options.gate ?? runGate)(candidate.html, copy(item.frozenChecks), signal); }
        catch (error) { candidate.gateError = redact(error instanceof Error ? error.message : String(error)); }
        finally { candidate.gateDurationMs = Date.now() - gateStarted; compare(item); await snapshot(); }
        assertFrozen(); signal.throwIfAborted();
      }
      item.status = item.evaluationError || item.candidates.some(candidate => candidate.gateError) ? 'failed' : 'completed'; item.finishedAt = new Date().toISOString(); compare(item); await snapshot();
      if (!item.evaluation || item.evaluationError || item.evaluation.providerRequests > 1 || item.evaluation.providerRequests > 0 && !item.evaluation.usage.complete || item.evaluation.providerRequests === 0 && item.evaluation.status === 'error') stopReason = 'Evaluation failed or usage is unknown; subsequent paid requests are stopped, not retried.';
    }
    run.status = run.cases.some(item => item.status === 'failed') ? 'failed' : 'completed';
    if (run.status === 'failed') run.error = run.cases.filter(item => item.status === 'failed').map(item => `${item.id}: ${item.evaluationError ?? item.candidates.find(candidate => candidate.gateError)?.gateError ?? 'Benchmark phase failed.'}`).join('; ');
  } catch (error) {
    run.status = signal.aborted ? 'cancelled' : 'failed'; run.error = redact(error instanceof Error ? error.message : String(error));
    for (const item of run.cases) {
      if (item.status === 'evaluating' || item.status === 'gating') { item.status = signal.aborted ? 'cancelled' : 'failed'; item.finishedAt = new Date().toISOString(); }
      if (item.status === 'pending') { item.status = 'skipped'; item.skipReason = run.error; }
    }
  } finally { run.finishedAt = new Date().toISOString(); run.durationMs = Date.now() - started; await snapshot(); }
  return copy(run);
}
