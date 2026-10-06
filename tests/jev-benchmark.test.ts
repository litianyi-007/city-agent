import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_JEV_CONFIG, JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation } from '../shared/jev-schema.js';
import { createJevBenchmarkSnapshot, JEV_BENCHMARK_LIMITS, runJevBenchmark, type JevBenchmarkRun } from '../server/production/jev-benchmark.js';

const fixtureKey = 'benchmark-fixture-secret-not-a-real-key';
const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: fixtureKey };
const defective = (html: string) => html.includes("span.textContent='任务';") || html.includes('tasks.splice(0,tasks.length,...tasks.filter') || html.includes("title:'默认任务'");
function evaluation(context: JevCandidateContext, selected = context.candidates.find(candidate => !defective((candidate.value as { html: string }).html))!.id): JevEvaluation {
  return { policyVersion: JEV_POLICY_VERSION, status: 'accepted', selectedCandidateId: selected, reason: 'Injected test only.', requestSnapshot: null, rawResponse: { fixture: true }, scores: [], choice: null, usage: { inputTokens: 1000, outputTokens: 40, estimatedCost: 0.000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: 200, providerRequests: 1, durationMs: 1 };
}
const injectedGate = async (html: string) => ({ passed: !defective(html), checks: [{ name: 'Injected oracle, not browser evidence', passed: !defective(html) }] });

test('benchmark freezes three disclosed illustrative candidate pools, hashes and exact thresholds without a Key', () => {
  const first = createJevBenchmarkSnapshot(config); const second = createJevBenchmarkSnapshot(config);
  assert.equal(first.cases.length, 3); assert.equal(first.poolHash, second.poolHash); assert.equal(first.configHash, second.configHash);
  assert.match(first.declaration, /MOCK/); assert.match(first.declaration, /不能证明/); assert.equal(first.maxRequests, 3);
  assert.deepEqual(first.limits, JEV_BENCHMARK_LIMITS);
  assert.equal(first.config.minConfidence, config.minConfidence); assert.equal(first.config.minScore, config.minScore);
  assert.notEqual(createJevBenchmarkSnapshot({ ...config, minConfidence: 0.75 }).configHash, first.configHash);
  assert.equal(JSON.stringify(first).includes(fixtureKey), false);
  assert.deepEqual(first.cases.map(item => item.candidates[0].construction), ['deliberate-business-defect', 'reference-fixture', 'deliberate-business-defect']);
  assert.ok(first.cases.every(item => item.candidates.length === 2 && item.candidates.every(candidate => candidate.sourceSha256.length === 64 && candidate.gate === null)));
});

test('blind evaluation is persisted before all independent candidate Gates; snapshot mutation cannot retune the pool', async () => {
  const order: string[] = []; const snapshots: JevBenchmarkRun[] = [];
  const result = await runJevBenchmark(config, new AbortController().signal, {
    onSnapshot: snapshot => { snapshots.push(structuredClone(snapshot)); order.push(`snapshot:${snapshot.cases.filter(item => item.attempted).length}`); snapshot.config.minScore = 0; snapshot.cases[0].candidates[0].html = 'tampered callback'; },
    evaluate: async (pinnedConfig, context) => {
      assert.equal(pinnedConfig.minScore, config.minScore); assert.equal(context.phase, 'developer');
      assert.equal(context.candidates.length, 2); assert.equal(Object.keys(context).some(key => /gate|oracle|defect|construction/i.test(key)), false);
      for (const candidate of context.candidates) assert.deepEqual(Object.keys(candidate.value as object), ['html']);
      assert.ok(snapshots.some(snapshot => snapshot.cases.some(item => item.status === 'evaluating' && item.evaluation === null)));
      assert.ok(snapshots.some(snapshot => snapshot.cases.some(item => item.status === 'evaluating' && item.evaluationInvoked === true && item.evaluation === null)));
      order.push('evaluate'); return evaluation(context);
    },
    gate: async html => { order.push('gate'); return injectedGate(html); },
  });
  assert.equal(result.status, 'completed'); assert.equal(result.evidenceSource, 'injected-test'); assert.equal(result.gateSource, 'injected-test');
  assert.equal(order.filter(item => item === 'evaluate').length, 3); assert.equal(order.filter(item => item === 'gate').length, 6);
  assert.deepEqual(order.filter(item => item === 'evaluate' || item === 'gate'), ['evaluate', 'gate', 'gate', 'evaluate', 'gate', 'gate', 'evaluate', 'gate', 'gate']);
  assert.equal(result.config.minScore, 3); assert.equal(result.metrics.firstPassed, 1); assert.equal(result.metrics.selectedPassed, 3);
  assert.equal(result.metrics.firstPassRate, 1 / 3); assert.equal(result.metrics.selectedPassRate, 1); assert.equal(result.metrics.selectionCoverage, 1);
  assert.equal(result.usage.providerRequests, 3); assert.equal(result.usage.inputTokens, 3000); assert.equal(result.usage.outputTokens, 120);
});

test('actual isolated Chromium verifies all three good and deliberate-defect fixtures independently', { timeout: 90000 }, async () => {
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => evaluation(context) });
  assert.equal(result.status, 'completed'); assert.equal(result.evidenceSource, 'injected-test'); assert.equal(result.gateSource, 'chromium');
  for (const item of result.cases) {
    assert.equal(item.candidates.find(candidate => candidate.construction === 'reference-fixture')?.gate?.passed, true, item.id);
    assert.equal(item.candidates.find(candidate => candidate.construction === 'deliberate-business-defect')?.gate?.passed, false, item.id);
    assert.equal(item.comparison.selectedPassed, true);
  }
  assert.equal(result.metrics.firstPassed, 1); assert.equal(result.metrics.selectedPassed, 3); assert.equal(result.metrics.gateCompleteCases, 3);
});

test('a bad Jev choice is recorded as a Gate failure and never replaced by the known-good oracle answer', async () => {
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => evaluation(context, context.candidates.find(candidate => defective((candidate.value as { html: string }).html))!.id), gate: injectedGate });
  assert.equal(result.metrics.selectedPassed, 0); assert.equal(result.metrics.selectedPassRate, 0); assert.equal(result.metrics.firstPassed, 1);
  assert.deepEqual(result.cases.map(item => item.comparison.change), ['unchanged', 'regressed', 'unchanged']);
  assert.ok(result.cases.every(item => item.selectedCandidateId === item.candidates.find(candidate => candidate.construction === 'deliberate-business-defect')!.id));
});

test('abstention retains all cases in the selection denominator and does not become a default answer', async () => {
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => ({ ...evaluation(context), status: 'uncertain', selectedCandidateId: null, reason: 'Below unchanged concentration threshold.' }), gate: injectedGate });
  assert.equal(result.metrics.attemptedCases, 3); assert.equal(result.metrics.abstained, 3); assert.equal(result.metrics.selectedPassRate, 0);
  assert.equal(result.metrics.selectionCoverage, 0); assert.equal(result.metrics.selectivePassRate, null);
  assert.ok(result.cases.every(item => item.comparison.change === 'abstained'));
});

test('unknown usage stops subsequent requests, redacts raw evidence and still measures the first frozen pool', async () => {
  let calls = 0;
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return { ...evaluation(context), status: 'error', selectedCandidateId: null, rawResponse: { echo: fixtureKey, [fixtureKey]: 'bad' }, reason: fixtureKey, error: fixtureKey, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } }; }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.usage.providerRequests, 1);
  assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.estimatedCost, null); assert.equal(result.usage.complete, false);
  assert.equal(result.metrics.gateCompleteCases, 1); assert.equal(result.cases.filter(item => item.status === 'skipped').length, 2);
  assert.equal(JSON.stringify(result).includes(fixtureKey), false);
});

test('an accepted choice with unknown usage still fails the case and batch instead of returning completed', async () => {
  let calls = 0;
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return { ...evaluation(context), usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } }; }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.cases[0].status, 'failed'); assert.match(result.error!, /unknown/);
  assert.equal(result.usage.estimatedCost, null); assert.equal(result.metrics.gateCompleteCases, 1); assert.equal(result.cases.filter(item => item.status === 'skipped').length, 2);
});

test('a thrown evaluator is retained with unknown request/usage counts and no retry', async () => {
  let calls = 0;
  const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async () => { calls++; throw new Error(`Unexpected evaluator failure ${fixtureKey}`); }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(result.status, 'failed'); assert.equal(result.usage.providerRequests, null);
  assert.equal(result.usage.estimatedCost, null); assert.equal(result.cases[0].attempted, true); assert.equal(result.cases[0].candidates.filter(candidate => candidate.gate !== null).length, 2);
  assert.equal(JSON.stringify(result).includes(fixtureKey), false);
});

test('predeclared budget rejects before spending; actual oversize usage is preserved and stops the next request', async () => {
  let calls = 0;
  const expensive = await runJevBenchmark({ ...config, inputPerMillion: 10 }, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate });
  assert.equal(calls, 0); assert.equal(expensive.status, 'failed'); assert.match(expensive.error!, /1 USD/); assert.equal(expensive.usage.providerRequests, 0);
  const tooLarge = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return { ...evaluation(context), usage: { inputTokens: 70000, outputTokens: 40, estimatedCost: 0.00294, currency: 'USD', complete: true } }; }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(tooLarge.status, 'failed'); assert.equal(tooLarge.usage.inputTokens, 70000); assert.match(tooLarge.cases[0].evaluationError!, /usage exceeds/); assert.equal(tooLarge.cases.filter(item => item.attempted).length, 1);
});

test('nonzero output price is rejected before spending, while actual total-token and cost overruns stop after one request', async () => {
  let calls = 0;
  const unsupported = await runJevBenchmark({ ...config, outputPerMillion: 0.1 }, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate });
  assert.equal(calls, 0); assert.equal(unsupported.status, 'failed'); assert.match(unsupported.error!, /zero output fee/);
  for (const usage of [{ inputTokens: 1000, outputTokens: 200000, estimatedCost: 0.000042, currency: 'USD' as const, complete: true }, { inputTokens: 1000, outputTokens: 40, estimatedCost: 1.1, currency: 'USD' as const, complete: true }]) {
    const result = await runJevBenchmark(config, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return { ...evaluation(context), usage }; }, gate: injectedGate });
    assert.equal(result.status, 'failed'); assert.equal(result.metrics.attemptedCases, 1); assert.equal(result.usage.inputTokens, usage.inputTokens); assert.equal(result.usage.outputTokens, usage.outputTokens); assert.equal(result.usage.estimatedCost, usage.estimatedCost);
    assert.match(result.error!, /usage exceeds/); assert.equal(result.cases.filter(item => item.status === 'skipped').length, 2);
  }
  assert.equal(calls, 2);
});

test('cancel retains the attempted snapshot and partial Gate evidence, and stops the remaining evaluations', async () => {
  const controller = new AbortController(); const snapshots: JevBenchmarkRun[] = []; let calls = 0; let gates = 0;
  const result = await runJevBenchmark(config, controller.signal, { onSnapshot: snapshot => { snapshots.push(snapshot); }, evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: async (html, _checks, signal) => { gates++; assert.equal(signal, controller.signal); controller.abort(); throw new DOMException('Cancelled Gate', 'AbortError'); } });
  assert.equal(result.status, 'cancelled'); assert.equal(calls, 1); assert.equal(gates, 1); assert.equal(result.cases[0].status, 'cancelled');
  assert.equal(result.cases[0].candidates[0].gateError, 'Cancelled Gate'); assert.equal(result.cases[0].candidates[1].gate, null);
  assert.equal(result.metrics.firstUnmeasured, 1); assert.equal(result.metrics.firstPassRate, null); assert.equal(result.metrics.selectedGateUnmeasured, 1);
  assert.ok(snapshots.some(snapshot => snapshot.cases[0].status === 'evaluating' && snapshot.cases[0].evaluation === null)); assert.equal(snapshots.at(-1)?.status, 'cancelled');
});

test('start-snapshot persistence failure prevents every potentially paid evaluation', async () => {
  let calls = 0;
  await assert.rejects(runJevBenchmark(config, new AbortController().signal, { onSnapshot: () => { throw new Error('Ledger unavailable'); }, evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate }), /Ledger unavailable/);
  assert.equal(calls, 0);
});

test('a failed durable request-intent snapshot also prevents the provider evaluation', async () => {
  let calls = 0;
  await assert.rejects(runJevBenchmark(config, new AbortController().signal, { onSnapshot: snapshot => { if (snapshot.cases[0].evaluationInvoked) throw new Error('Intent ledger unavailable'); }, evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate }), /Intent ledger unavailable/);
  assert.equal(calls, 0);
});

test('maxRequests and cancellation before evaluate cannot produce extra provider calls', async () => {
  let calls = 0;
  const capped = await runJevBenchmark({ ...config, maxRequests: 1 }, new AbortController().signal, { evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(capped.metrics.attemptedCases, 1); assert.equal(capped.cases.filter(item => item.status === 'skipped').length, 2);
  const controller = new AbortController();
  const stopped = await runJevBenchmark(config, controller.signal, { onSnapshot: snapshot => { if (snapshot.cases[0].status === 'evaluating') controller.abort(); }, evaluate: async (_config, context) => { calls++; return evaluation(context); }, gate: injectedGate });
  assert.equal(calls, 1); assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.usage.providerRequests, 0); assert.equal(stopped.cases[0].evaluationInvoked, false);
});
