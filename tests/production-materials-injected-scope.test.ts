import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { materialAccounting, MATERIALS_VERSION } from '../scripts/production-materials.js';
import { createJevBenchmarkSnapshot } from '../server/production/jev-benchmark.js';
import { DEFAULT_JEV_CONFIG, type JevEvaluation } from '../shared/jev-schema.js';
import { productionRunInputSchema, type ProductionCall, type ProductionRun } from '../shared/production-schema.js';

// Pure presentation fixtures: no service, provider, Key read or browser.
function evaluation(): JevEvaluation {
  return { policyVersion: 'free-scope-fixture', status: 'uncertain', selectedCandidateId: null, reason: 'Injected dispatch, not physical HTTP', requestSnapshot: null, rawResponse: { fixture: true }, scores: [], choice: null, modelIdRequested: 'fixture', modelIdReturned: 'fixture', httpStatus: 200, providerRequests: 1, durationMs: 1, usage: { inputTokens: 200, outputTokens: 10, estimatedCost: 0.0000084, currency: 'USD', complete: true } };
}
function injectedRun(): ProductionRun {
  const call: ProductionCall = { id: randomUUID(), candidateId: randomUUID(), role: 'developer', phase: 'implement', executionSource: 'injected', startedAt: '2026-10-07T00:00:00Z', model: { id: randomUUID(), provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'fixture' }, promptVersion: 'fixture', promptHash: 'fixture', configHash: 'fixture', systemPrompt: 'fixture', userPrompt: 'fixture', rawOutput: 'fixture', usage: { inputTokens: 50, outputTokens: 10, estimatedCost: 0.01, currency: 'USD' } };
  return { id: randomUUID(), evidenceKind: 'injected-test', input: productionRunInputSchema.parse({ brief: 'Free scope presentation test', mode: 'live', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'injected-scope', source: 'Engineering fixture, not a real demand', acceptance: 'Accounting only', kind: 'illustrative' } }), status: 'failed', createdAt: '2026-10-07T00:00:00Z', agentSnapshot: [], events: [], calls: [call], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 250, outputTokens: 20, estimatedCost: 0.0100084, currency: 'USD', complete: true }, interventions: [], artifacts: [], jevCalls: [{ id: randomUUID(), phase: 'product', startedAt: '2026-10-07T00:00:00Z', configHash: 'fixture', evaluation: evaluation() }] };
}

test('v6 retains injected originals and dispatch observations but excludes every injected field from provider totals', () => {
  assert.equal(MATERIALS_VERSION, 'production-materials-v6');
  const run = injectedRun(); const before = JSON.stringify(run);
  const scope = materialAccounting([], [], [run]).measuredScope;
  assert.equal(scope.realGeneration.started, 0);
  assert.deepEqual(scope.jevDecisions.supplementalRunIds, []);
  assert.deepEqual(scope.jevDecisions.records, []);
  for (const field of ['providerRequests', 'inputTokens', 'outputTokens', 'estimatedCost'] as const) assert.equal(scope.jevDecisions[field], 0, 'No provider-scope record; not an assertion of zero injected HTTP');
  const engineering = scope.injectedEngineering;
  assert.deepEqual(engineering.runIds, [run.id]); assert.equal(engineering.countedAsRealGeneration, false); assert.equal(engineering.countedInJevDecisions, false);
  const record = engineering.records[0];
  assert.match(record.usageScope, /not verified real spending/);
  assert.equal(record.ledger.requests.actualProviderRequests, null);
  assert.equal(record.ledger.requests.knownProviderRequests, 0);
  assert.equal(record.ledger.requests.unknownRequestIntents, 1);
  assert.equal(record.ledger.requests.observedJevDispatches, 1);
  assert.equal(record.ledger.usage.inputTokens.knownSubtotal, 250);
  assert.equal(record.ledger.usage.outputTokens.knownSubtotal, 20);
  assert.ok(Math.abs(record.ledger.usage.estimatedCost.knownSubtotal! - 0.0100084) < 1e-12);
  assert.deepEqual(record.originalRun, run); assert.equal(JSON.stringify(run), before);
  record.originalRun.usage.inputTokens = 999;
  assert.equal(JSON.stringify(run), before, 'Returned presentation snapshot must not mutate the original run');
});

test('injected pending or invalid dispatch counters remain unknown without silently entering real Jev totals', () => {
  for (const kind of ['pending', 'negative', 'fractional'] as const) {
    const run = injectedRun();
    const current = run.jevCalls![0].evaluation;
    if (kind === 'pending') Object.assign(current, { status: 'error', providerRequests: 0, durationMs: 42, requestSnapshot: null, rawResponse: null, httpStatus: null, modelIdReturned: null, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } });
    else current.providerRequests = kind === 'negative' ? -1 : 0.5;
    const before = JSON.stringify(run);
    const scope = materialAccounting([], [], [run]).measuredScope;
    assert.equal(scope.jevDecisions.providerRequests, 0);
    const projection = scope.injectedEngineering.records[0].ledger;
    assert.equal(projection.requests.actualProviderRequests, null);
    assert.equal(projection.requests.observedJevDispatches, 0);
    assert.equal(projection.requests.unknownJevDispatchIntents, 1);
    assert.equal(projection.requests.unknownJevRequestIntents, 1);
    assert.deepEqual(scope.injectedEngineering.records[0].originalRun, run);
    assert.equal(JSON.stringify(run), before);
  }
});

test('real CAMERA05 and fixture-with-real-jev retain their original provider scope despite additional injected evidence', () => {
  const file = new URL('../docs/production/experiments/CAMERA-05/run.json', import.meta.url);
  const bytes = readFileSync(file); const real = JSON.parse(bytes.toString('utf8')) as ProductionRun;
  const hybrid = { ...injectedRun(), evidenceKind: 'fixture-with-real-jev' as const };
  hybrid.calls[0].executionSource = 'mock';
  const before = JSON.stringify([real, hybrid]);
  const original = materialAccounting([], [], [real, hybrid]).measuredScope;
  const actual = materialAccounting([], [], [real, hybrid, injectedRun()]).measuredScope;
  assert.deepEqual(actual.realGeneration, original.realGeneration);
  assert.deepEqual(actual.jevDecisions, original.jevDecisions);
  assert.equal(actual.jevDecisions.providerRequests, 4);
  assert.deepEqual(actual.jevDecisions.supplementalRunIds, [real.id, hybrid.id]);
  assert.equal(actual.jevDecisions.records.filter(record => record.runId === real.id).length, 3);
  const realScope = materialAccounting([], [], [real]).measuredScope.jevDecisions;
  assert.equal(realScope.providerRequests, 3);
  assert.equal(realScope.inputTokens, real.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.inputTokens!, 0));
  assert.equal(realScope.outputTokens, real.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.outputTokens!, 0));
  assert.equal(realScope.estimatedCost, real.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.estimatedCost!, 0));
  assert.equal(JSON.stringify([real, hybrid]), before);
  assert.deepEqual(readFileSync(file), bytes);
});

test('injected scope retains genuine historical Harness observations without relabelling them zero or certifying mixed costs', () => {
  const real = JSON.parse(readFileSync(new URL('../docs/production/experiments/CAMERA-05/run.json', import.meta.url), 'utf8')) as ProductionRun;
  const injected = injectedRun();
  injected.calls = real.calls.filter(call => call.executionSource === 'harness' && call.providerRequests?.requests === 1).slice(0, 2);
  const before = JSON.stringify(injected);
  const scope = materialAccounting([], [], [injected]).measuredScope;
  const ledger = scope.injectedEngineering.records[0].ledger;
  assert.equal(ledger.requests.actualProviderRequests, null);
  assert.equal(ledger.requests.knownProviderRequests, 2);
  assert.equal(ledger.requests.knownHarnessProviderRequests, 2);
  assert.equal(ledger.requests.observedJevDispatches, 1);
  assert.equal(ledger.requests.unknownJevRequestIntents, 1);
  assert.equal(scope.jevDecisions.providerRequests, 0);
  assert.match(scope.injectedEngineering.scope, /Any explicit Harness HTTP observations remain/);
  assert.equal(JSON.stringify(injected), before);
});

test('explicit injected benchmark responses and unresolved intents stay in engineering scope with original skipped records', () => {
  const batch = createJevBenchmarkSnapshot({ ...DEFAULT_JEV_CONFIG, enabled: true });
  batch.evidenceSource = 'injected-test'; batch.status = 'failed';
  batch.cases[0].evaluationInvoked = true; batch.cases[0].evaluation = evaluation();
  batch.cases[1].evaluationInvoked = true; batch.cases[1].evaluation = null;
  batch.cases[2].status = 'skipped';
  const before = JSON.stringify(batch);
  const scope = materialAccounting([], [batch], []).measuredScope;
  assert.deepEqual(scope.jevDecisions.benchmarkIds, []);
  assert.deepEqual(scope.jevDecisions.records, []);
  assert.equal(scope.jevDecisions.providerRequests, 0);
  assert.equal(scope.jevDecisions.inputTokens, 0); assert.equal(scope.jevDecisions.outputTokens, 0); assert.equal(scope.jevDecisions.estimatedCost, 0);
  assert.deepEqual(scope.injectedEngineering.benchmarkIds, [batch.id]);
  const record = scope.injectedEngineering.benchmarkRecords[0];
  assert.deepEqual(record.originalBenchmark, batch); assert.equal(record.cases.length, 2);
  assert.equal(record.cases[0].ledger!.requests.actualProviderRequests, null);
  assert.equal(record.cases[0].ledger!.requests.observedJevDispatches, 1);
  assert.equal(record.cases[1].ledger, null);
  assert.equal(record.cases[1].unresolvedEvaluationIntent, true);
  assert.equal(record.originalBenchmark.cases[2].status, 'skipped');
  assert.equal(JSON.stringify(batch), before);
});

test('live and legacy benchmark classification remains unchanged alongside an explicitly injected benchmark', () => {
  const live = createJevBenchmarkSnapshot({ ...DEFAULT_JEV_CONFIG, enabled: true });
  live.cases[0].evaluationInvoked = true; live.cases[0].evaluation = evaluation();
  const { evidenceSource: _source, ...legacy } = structuredClone(live); legacy.id = randomUUID();
  const injected = structuredClone(live); injected.id = randomUUID(); injected.evidenceSource = 'injected-test';
  const before = JSON.stringify([live, legacy, injected]);
  const original = materialAccounting([], [live, legacy], []).measuredScope.jevDecisions;
  const actual = materialAccounting([], [live, legacy, injected], []).measuredScope;
  assert.deepEqual(actual.jevDecisions, original);
  assert.equal(actual.jevDecisions.providerRequests, 2);
  assert.deepEqual(actual.jevDecisions.benchmarkIds, [live.id, legacy.id]);
  assert.deepEqual(actual.injectedEngineering.benchmarkIds, [injected.id]);
  assert.equal(JSON.stringify([live, legacy, injected]), before);
});
