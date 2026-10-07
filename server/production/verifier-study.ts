import { createHash, randomUUID } from 'node:crypto';
import type { JevCandidateContext, JevEvaluation } from '../../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS, VERIFIER_CHALLENGE_HTML_POOLS, VERIFIER_CHALLENGE_SCENE_POOLS, type VerifierChallengePoolId } from '../../shared/production-verifier-challenge-corpus.js';
import { runGate } from '../gate.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import { runVerifierSceneOracle } from './verifier-scene-oracle.js';
import { VerifierStudyLedger } from './verifier-study-ledger.js';
import { selectVerifierStudy, VERIFIER_STUDY_STRATEGY_VERSION, type VerifierStudyRequests, type VerifierStudySelection, type VerifierStudyStrategy } from './verifier-study-strategy.js';

export const VERIFIER_STUDY_VERSION = 'verifier-study-injected-v1' as const;
export interface StudyUsage {
  inputTokens: number | null; outputTokens: number | null;
  estimatedCost: number | null; currency: 'USD'; complete: boolean;
}
export interface StudyBudget {
  maxCalls: number; maxInputTokens: number; maxOutputTokens: number; maxEstimatedCost: number;
  currency: 'USD'; maxDurationMs: number; callTimeoutMs: number; oracleTimeoutMs: number;
  perCallInputTokens: number; perCallOutputTokens: number; perCallEstimatedCost: number;
}
export interface StudyOracleResult { passed: boolean; healthy: boolean; details: unknown; }
export interface InjectedStudyPorts {
  llm: (request: { systemPrompt: string; userPrompt: string }, signal: AbortSignal) => Promise<{ text: string; usage: StudyUsage }>;
  /** Must be a trusted Jev protocol adapter, not raw unvalidated vendor JSON. */
  jev: (request: JevCandidateContext, signal: AbortSignal) => Promise<JevEvaluation>;
  oracle: (request: VerifierStudyRequests, candidateId: string, signal: AbortSignal) => Promise<StudyOracleResult>;
}
export interface InjectedStudyOptions {
  directory: string;
  executionSource: 'injected-test';
  poolIds: VerifierChallengePoolId[];
  strategies: VerifierStudyStrategy[];
  budget: StudyBudget;
  ports: InjectedStudyPorts;
  signal?: AbortSignal;
  /** Trusted engineering fault injection only; never exposed by an API. */
  ledgerOptions?: Parameters<typeof VerifierStudyLedger.create>[2];
}
export interface StudySummary {
  version: typeof VERIFIER_STUDY_VERSION; runId: string;
  executionSource: 'injected-test'; cachePolicy: 'bypass';
  status: 'completed' | 'failed' | 'cancelled'; reason: string | null;
  startedAt: string; endedAt: string; durationMs: number;
  plannedDecisions: number; attemptedDecisions: number; notStartedDecisions: number;
  plannedOracles: number; attemptedOracles: number; completedOracles: number;
  callbackIntents: number; actualProviderHttpAttempts: null;
  usage: { complete: boolean; knownInputTokens: number; knownOutputTokens: number; knownEstimatedCost: number; currency: 'USD'; unknownCalls: number; scope: 'injected-fixture-accounting-not-model-measurement' };
  byStrategy: Array<{ strategy: VerifierStudyStrategy; planned: number; attempted: number; accepted: number; abstained: number; errors: number; notStarted: number; selectedOraclePass: number; selectedOracleFail: number; selectedOracleUnknown: number }>;
  ledgerTerminalPersisted: boolean;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const copy = <T>(value: T): T => freeze(structuredClone(value));
class StudyStop extends Error {}
class LateObservation extends StudyStop {
  constructor(readonly observation: unknown) { super('Injected callback returned after its monotonic timeout'); }
}
function validUsage(usage: StudyUsage | undefined): usage is StudyUsage & { inputTokens: number; outputTokens: number; estimatedCost: number } {
  return !!usage?.complete && usage.currency === 'USD' && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens! >= 0
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens! >= 0 && Number.isFinite(usage.estimatedCost) && usage.estimatedCost! >= 0;
}
function validateOptions(options: InjectedStudyOptions) {
  if (options.executionSource !== 'injected-test') throw new Error('Only injected engineering studies are implemented; no live model adapter or budget authorization');
  if (!options.poolIds.length || options.poolIds.length > 18 || new Set(options.poolIds).size !== options.poolIds.length || options.poolIds.some(id => !VERIFIER_CHALLENGE_IDS.includes(id))) throw new Error('Invalid fixed study pool schedule');
  if (!options.strategies.length || options.strategies.length > 3 || new Set(options.strategies).size !== options.strategies.length || options.strategies.some(strategy => !['baseline', 'llm', 'jev-cascade'].includes(strategy))) throw new Error('Invalid strategy schedule');
  const b = options.budget;
  for (const field of ['maxCalls', 'maxInputTokens', 'maxOutputTokens', 'perCallInputTokens', 'perCallOutputTokens'] as const) if (!Number.isSafeInteger(b[field]) || b[field] < 0) throw new Error('Invalid integer study budget');
  for (const field of ['maxEstimatedCost', 'perCallEstimatedCost'] as const) if (!Number.isFinite(b[field]) || b[field] < 0 || b[field] > 1000) throw new Error('Invalid cost study budget');
  for (const field of ['maxDurationMs', 'callTimeoutMs', 'oracleTimeoutMs'] as const) if (!Number.isSafeInteger(b[field]) || b[field] < 1 || b[field] > 3_600_000) throw new Error('Invalid timeout study budget');
  if (b.currency !== 'USD' || b.maxCalls > 54 || b.maxInputTokens > 10_000_000 || b.maxOutputTokens > 1_000_000) throw new Error('Study budget exceeds injection-only boundaries');
}

/** No default model transports, production store/config, credentials, answer cache,
 * paid API or resume. The persistent manifest and every intent precede callbacks.
 * An injected hook can ignore AbortSignal; racing it is NOT proof of HTTP cleanup. */
export async function runInjectedVerifierStudy(options: InjectedStudyOptions): Promise<StudySummary> {
  validateOptions(options);
  const startedAt = new Date().toISOString(); const started = performance.now(); const runId = randomUUID();
  const poolIds = copy(options.poolIds); const strategies = copy(options.strategies); const budget = copy(options.budget);
  const requests = poolIds.map(poolId => copy(verifierPreparationRequests(poolId)));
  const requestHash = hash(requests); const optionHash = hash({ poolIds: options.poolIds, strategies: options.strategies, budget: options.budget });
  const oracleSourcesHash = hash([...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS]);
  const plan = requests.flatMap(request => strategies.map(strategy => ({ decisionId: randomUUID(), poolId: request.metadata.poolId, strategy })));
  const ledger = VerifierStudyLedger.create(options.directory, { version: VERIFIER_STUDY_VERSION, strategyVersion: VERIFIER_STUDY_STRATEGY_VERSION,
    runId, status: 'running', executionSource: 'injected-test', startedAt, cachePolicy: 'bypass',
    ordering: 'declared-pool-order-interleaved-strategies-engineering-not-randomized',
    modelConfiguration: null, actualProviderHttpAttempts: null, inputSha256: requestHash, oracleSourcesSha256: oracleSourcesHash,
    inputSnapshots: requests, plannedDecisions: plan, budget }, options.ledgerOptions);
  const controller = new AbortController(); const cancel = () => controller.abort(options.signal?.reason ?? new DOMException('Study cancelled', 'AbortError'));
  options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) cancel();
  const overallTimer = setTimeout(() => controller.abort(new DOMException('Study duration limit', 'TimeoutError')), budget.maxDurationMs);
  let writeFailed = false; let reason: string | null = null; let status: StudySummary['status'] = 'completed';
  const append = (type: Parameters<VerifierStudyLedger['append']>[0], payload: Record<string, unknown>) => {
    if (writeFailed) throw new StudyStop('Ledger is unavailable; no further callbacks allowed');
    try { return ledger.append(type, { runId, ...payload }); }
    catch { writeFailed = true; throw new StudyStop('Durable ledger write failed; prior manifest/intents preserved and no subsequent callback allowed'); }
  };
  const assertIntegrity = () => {
    if (hash(requests) !== requestHash || hash({ poolIds: options.poolIds, strategies: options.strategies, budget: options.budget }) !== optionHash
      || hash([...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS]) !== oracleSourcesHash) throw new StudyStop('Frozen study input/config/Oracle source changed');
  };
  const assertActive = () => {
    // Timers alone are insufficient: immediate Promises and synchronous fsync
    // can starve the timer queue. Preparation and initial persistence count.
    if (!controller.signal.aborted && performance.now() - started >= budget.maxDurationMs) controller.abort(new DOMException('Study duration limit', 'TimeoutError'));
    controller.signal.throwIfAborted(); assertIntegrity(); if (writeFailed) throw new StudyStop('Ledger unavailable');
  };
  // All accounting derives from durable observations, not an uncommitted response.
  const accounting = () => {
    const calls = ledger.readEvents().filter(event => event.type === 'call-intent');
    const observations = ledger.readEvents().filter(event => event.type === 'call-result');
    let knownInputTokens = 0; let knownOutputTokens = 0; let knownEstimatedCost = 0; let unknownCalls = 0;
    for (const call of calls) {
      const observation = observations.find(event => event.payload.callId === call.payload.callId);
      const usage = observation?.payload.usage as StudyUsage | undefined;
      if (!validUsage(usage)) unknownCalls++;
      else { knownInputTokens += usage.inputTokens; knownOutputTokens += usage.outputTokens; knownEstimatedCost += usage.estimatedCost; }
    }
    return { complete: unknownCalls === 0, knownInputTokens, knownOutputTokens, knownEstimatedCost, currency: 'USD' as const, unknownCalls, scope: 'injected-fixture-accounting-not-model-measurement' as const };
  };
  const bounded = async <T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> => {
    assertActive(); const local = new AbortController(); const operationStarted = performance.now();
    const forward = () => local.abort(controller.signal.reason); controller.signal.addEventListener('abort', forward, { once: true });
    let stop!: () => void;
    const cancelled = new Promise<never>((_, reject) => { stop = () => reject(local.signal.reason ?? new DOMException('Study stopped', 'AbortError')); local.signal.addEventListener('abort', stop, { once: true }); });
    const timer = setTimeout(() => local.abort(new DOMException('Injected callback timed out', 'TimeoutError')), timeoutMs);
    try {
      if (controller.signal.aborted) forward();
      const observed = await Promise.race([Promise.resolve().then(() => { assertActive(); local.signal.throwIfAborted(); return operation(local.signal); }), cancelled]);
      if (performance.now() - operationStarted >= timeoutMs) { local.abort(new DOMException('Injected callback timed out', 'TimeoutError')); throw new LateObservation(observed); }
      return observed;
    }
    finally { clearTimeout(timer); local.signal.removeEventListener('abort', stop); controller.signal.removeEventListener('abort', forward); }
  };
  let stoppingCall: string | null = null;
  const call = async <T extends { usage: StudyUsage }>(decision: typeof plan[number], kind: 'llm' | 'jev', request: unknown, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    assertActive(); const usage = accounting(); const calls = ledger.readEvents().filter(event => event.type === 'call-intent').length;
    if (!usage.complete) { stoppingCall = 'Prior call usage is unknown; no retry/fallback/subsequent call'; throw new StudyStop(stoppingCall); }
    if (calls + 1 > budget.maxCalls || usage.knownInputTokens + budget.perCallInputTokens > budget.maxInputTokens
      || usage.knownOutputTokens + budget.perCallOutputTokens > budget.maxOutputTokens || usage.knownEstimatedCost + budget.perCallEstimatedCost > budget.maxEstimatedCost + 1e-12) {
      stoppingCall = 'Pre-dispatch reservation exceeds study budget'; throw new StudyStop(stoppingCall);
    }
    const callId = randomUUID(); const requestSnapshot = copy(request); const requestSha256 = hash(requestSnapshot);
    append('call-intent', { ...decision, callId, kind, status: 'pending', cachePolicy: 'bypass', requestSnapshot, requestSha256,
      usage: null, actualProviderHttpAttempts: null, reservation: { inputTokens: budget.perCallInputTokens, outputTokens: budget.perCallOutputTokens, estimatedCost: budget.perCallEstimatedCost, currency: 'USD' } });
    let response: T;
    try { response = await bounded(operation, budget.callTimeoutMs); }
    catch (error) {
      if (error instanceof LateObservation) {
        const observed = copy(error.observation) as T;
        append('call-result', { ...decision, callId, kind, status: 'completed', responseSnapshot: observed, usage: observed?.usage ?? null,
          actualProviderHttpAttempts: null, timeoutExceeded: true, reason: 'Synchronous/instant callback exceeded monotonic timeout; returned observation retained but not used for selection' });
        stoppingCall = 'Injected callback exceeded monotonic timeout; no subsequent call'; throw error;
      }
      append('call-result', { ...decision, callId, kind, status: 'unknown', usage: null, actualProviderHttpAttempts: null,
        reason: controller.signal.aborted ? 'Cancellation requested; injected transport cleanup/late response unknown' : error instanceof DOMException && error.name === 'TimeoutError' ? 'Timeout; injected transport cleanup/late response unknown' : 'Injected callback failed without complete usage' });
      stoppingCall = 'Injected callback did not return complete durable usage'; throw error;
    }
    // Bind persistence and parsing to the SAME deep frozen observation. A hook
    // retaining the original returned object cannot change the selected answer
    // between fsync and parsing or alter usage after it was recorded.
    try { response = copy(response); }
    catch {
      append('call-result', { ...decision, callId, kind, status: 'unknown', usage: null, actualProviderHttpAttempts: null, reason: 'Injected response is not cloneable JSON evidence' });
      stoppingCall = 'Injected response cannot be durably observed'; throw new StudyStop(stoppingCall);
    }
    // Preserve the actual response/usage BEFORE parsing or budget verdict. A bad
    // last response still fails, even when there would be no next call to stop.
    append('call-result', { ...decision, callId, kind, status: 'completed', responseSnapshot: response, usage: response?.usage ?? null, actualProviderHttpAttempts: null });
    if (!validUsage(response?.usage)) { stoppingCall = 'Observed usage is unknown/invalid; study stops'; throw new StudyStop(stoppingCall); }
    const actual = response.usage;
    if (actual.inputTokens > budget.perCallInputTokens || actual.outputTokens > budget.perCallOutputTokens || actual.estimatedCost > budget.perCallEstimatedCost + 1e-12) {
      stoppingCall = 'Observed usage exceeds per-call reservation; study fails'; throw new StudyStop(stoppingCall);
    }
    const total = accounting();
    if (total.knownInputTokens > budget.maxInputTokens || total.knownOutputTokens > budget.maxOutputTokens || total.knownEstimatedCost > budget.maxEstimatedCost + 1e-12) {
      stoppingCall = 'Observed usage exceeds whole-study budget; study fails'; throw new StudyStop(stoppingCall);
    }
    assertActive(); if (hash(requestSnapshot) !== requestSha256) throw new StudyStop('Request mutated during injected callback');
    return copy(response);
  };
  const decisions: Array<typeof plan[number] & { selection: VerifierStudySelection }> = [];
  try {
    for (const item of plan) {
      assertActive(); append('decision-start', { ...item, status: 'running' });
      const request = requests.find(value => value.metadata.poolId === item.poolId)!;
      const selection = await selectVerifierStudy(item.strategy, request, {
        llm: async (logical) => (await call(item, 'llm', logical, signal => options.ports.llm(copy(logical), signal))).text,
        jev: async (context) => call(item, 'jev', context, signal => options.ports.jev(copy(context), signal)),
      }, controller.signal);
      // Stop on any selection error. A protocol rejection is not an abstention,
      // and must not silently become a clean baseline or successful study.
      append('decision-result', { ...item, status: selection.decision === 'error' ? 'failed' : 'completed', decision: selection.decision, selection });
      decisions.push({ ...item, selection });
      if (selection.decision === 'error') throw new StudyStop(stoppingCall ?? selection.reason);
      assertActive();
    }
    // Strictly after ALL A/B/C blind decisions, not after each pool. No Oracle
    // labels/results or previous strategy decisions enter any review callback.
    for (const request of requests) for (const candidate of request.snapshot.candidates) {
      assertActive(); const oracleId = randomUUID();
      append('oracle-intent', { oracleId, poolId: request.metadata.poolId, candidateId: candidate.id, status: 'pending', inputSha256: hash(request) });
      let result: StudyOracleResult;
      try { result = copy(await bounded(signal => options.ports.oracle(copy(request), candidate.id, signal), budget.oracleTimeoutMs)); }
      catch (error) {
        append('oracle-result', { oracleId, poolId: request.metadata.poolId, candidateId: candidate.id, status: error instanceof LateObservation ? 'failed' : 'unknown', result: null,
          ...(error instanceof LateObservation ? { responseSnapshot: copy(error.observation), reason: 'Oracle returned after monotonic timeout; result not used for business verdict' } : {}) }); throw error;
      }
      append('oracle-result', { oracleId, poolId: request.metadata.poolId, candidateId: candidate.id, status: 'completed', result });
      if (typeof result?.passed !== 'boolean' || result.healthy !== true) throw new StudyStop('Oracle returned invalid or unhealthy execution; no business pass inferred');
      assertActive();
    }
  } catch (error) {
    status = controller.signal.aborted && !(controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') ? 'cancelled' : 'failed';
    reason = error instanceof StudyStop ? error.message : controller.signal.aborted ? 'Study cancelled or duration limit reached' : 'Injected operation failed; no implicit retry or resume';
    // A started decision lacking a result is retained as error, when storage is
    // available. On storage failure it remains unfinished for explicit recovery.
    if (!writeFailed) {
      const events = ledger.readEvents();
      for (const event of events.filter(value => value.type === 'decision-start' && !events.some(result => result.type === 'decision-result' && result.payload.decisionId === value.payload.decisionId))) {
        try { append('decision-result', { decisionId: event.payload.decisionId, poolId: event.payload.poolId, strategy: event.payload.strategy, status, decision: 'error', reason }); }
        catch { break; }
      }
    }
  } finally { clearTimeout(overallTimer); options.signal?.removeEventListener('abort', cancel); }
  const events = ledger.readEvents(); const oracleEvents = events.filter(event => event.type === 'oracle-result');
  const oracleFor = (poolId: string, candidateId: string | null) => oracleEvents.find(event => event.payload.poolId === poolId && event.payload.candidateId === candidateId)?.payload.result as StudyOracleResult | null | undefined;
  const summary: StudySummary = { version: VERIFIER_STUDY_VERSION, runId, executionSource: 'injected-test', cachePolicy: 'bypass', status, reason,
    startedAt, endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started),
    plannedDecisions: plan.length, attemptedDecisions: events.filter(event => event.type === 'decision-start').length,
    notStartedDecisions: plan.length - events.filter(event => event.type === 'decision-start').length,
    plannedOracles: requests.reduce((sum, request) => sum + request.snapshot.candidates.length, 0), attemptedOracles: events.filter(event => event.type === 'oracle-intent').length,
    completedOracles: oracleEvents.filter(event => event.payload.status === 'completed').length,
    callbackIntents: events.filter(event => event.type === 'call-intent').length, actualProviderHttpAttempts: null, usage: accounting(),
    byStrategy: strategies.map(strategy => {
      const completed = decisions.filter(item => item.strategy === strategy); const attempted = events.filter(event => event.type === 'decision-start' && event.payload.strategy === strategy).length;
      const accepted = completed.filter(item => item.selection.decision === 'accept');
      return { strategy, planned: requests.length, attempted, accepted: accepted.length, abstained: completed.filter(item => item.selection.decision === 'abstain').length,
        errors: events.filter(event => event.type === 'decision-result' && event.payload.strategy === strategy && event.payload.decision === 'error').length,
        notStarted: requests.length - attempted, selectedOraclePass: accepted.filter(item => oracleFor(item.poolId, item.selection.selectedCandidateId)?.healthy === true && oracleFor(item.poolId, item.selection.selectedCandidateId)?.passed === true).length,
        selectedOracleFail: accepted.filter(item => oracleFor(item.poolId, item.selection.selectedCandidateId)?.healthy === true && oracleFor(item.poolId, item.selection.selectedCandidateId)?.passed === false).length,
        selectedOracleUnknown: accepted.filter(item => { const actual = oracleFor(item.poolId, item.selection.selectedCandidateId); return actual?.healthy !== true || typeof actual.passed !== 'boolean'; }).length };
    }), ledgerTerminalPersisted: false };
  if (!writeFailed) {
    try { append('run-end', { status, summary: { ...summary, ledgerTerminalPersisted: true } }); summary.ledgerTerminalPersisted = true; }
    catch { summary.status = 'failed'; summary.reason = 'Terminal ledger write failed; initial manifest and prior observations retained for explicit recovery'; }
  } else { summary.status = 'failed'; summary.reason = reason ?? 'Ledger write failed'; }
  return summary;
}

/** Real request-denying Chromium Oracle on fixed repository-authored fixtures.
 * It is engineering behavior evidence, not real model selection or camera proof. */
export async function runStudyChromiumOracle(request: VerifierStudyRequests, candidateId: string, signal: AbortSignal): Promise<StudyOracleResult> {
  const expected = verifierPreparationRequests(request.metadata.poolId);
  if (hash(expected) !== hash(request)) throw new Error('Oracle request differs from fixed study input');
  const pool = [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS].find(item => item.id === request.metadata.poolId)!;
  const before = hash(pool); const candidate = pool.candidates.find(item => item.id === candidateId);
  if (!candidate) throw new Error('Unknown Oracle candidate');
  let result: StudyOracleResult;
  if ('scene' in candidate.value && 'required' in pool) {
    const details = await runVerifierSceneOracle(structuredClone(pool), structuredClone(candidate.value.scene), signal);
    const checks = [...details.gate.checks, ...(details.componentDiagnostics ?? []).flatMap(item => item.gate.checks)];
    const healthy = !details.failureKind && !details.gate.failureKind && details.gate.checks[0]?.passed === true
      && checks.every(check => !/timed?\s*out|超时|超过.*秒|JavaScript错误|JavaScript 错误|未授权网络|连接失败|Chromium 运行环境/i.test(check.detail ?? ''));
    result = { passed: details.passed, healthy, details };
  } else if ('html' in candidate.value) {
    const details = await runGate(candidate.value.html, structuredClone(pool.checks), signal);
    const healthy = !details.failureKind && details.checks[0]?.passed === true && details.checks.length === pool.checks.length + 1
      && details.checks.filter(check => !check.passed).every(check => /文本不精确等于|元素数量不等于|的值不是/.test(check.detail ?? '') && !/JavaScript|页面错误|网络|跳转|超时|超过|Timeout|Chromium/i.test(check.detail ?? ''));
    result = { passed: details.passed, healthy, details };
  } else throw new Error('Oracle capability mismatch');
  signal.throwIfAborted(); if (hash(pool) !== before) throw new Error('Oracle source changed during execution'); return result;
}
