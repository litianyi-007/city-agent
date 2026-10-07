import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.ts';
import { DEFAULT_JEV_CONFIG, JEV_MODEL_ID, type JevCandidateContext } from '../shared/jev-schema.ts';
import { productionRequestCounts } from '../shared/production-ledger.ts';
import type { ProductionRun } from '../shared/production-schema.ts';

const historicalPath = new URL('../docs/production/experiments/CAMERA-05/run.json', import.meta.url);
const historicalSha256 = '61cb1e48477e0bbf4bc28e7e53cf5e55bce01c5a0b70e258f3796c9dc91e0d8f';
function historicalRun() {
  const bytes = readFileSync(historicalPath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), historicalSha256);
  return { bytes, run: JSON.parse(bytes.toString('utf8')) as ProductionRun };
}

test('actual Jev evaluator with one in-memory dispatch is not physical HTTP evidence, including mixed recorded Harness observations', async t => {
  // Real evaluator + fake fetch does NOT become a real provider request.
  // Existing recorded Harness observations remain separately traceable.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No global/external HTTP allowed in injected ledger regression'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const context: JevCandidateContext = { phase: 'product', goal: 'Free ledger regression', acceptance: 'Do not count in-memory dispatches as observed provider HTTP.', frozenHash: null, candidates: [{ id: 'free-candidate', value: { goal: 'Accounting fixture only, not actual model judgment' } }] };
  const request = buildJevCandidateRequest(JEV_MODEL_ID, context);
  const levels = request.questions.c0_coverage.criteria as string[];
  const answers: Record<string, unknown> = {};
  for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c0_${dimension}`] = { type: 'score', score: 4, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])), probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 }, confidence: 1 };
  answers.c0_safe = { type: 'noul', noul: 1 };
  answers.best = { type: 'choice', choice: 'free-candidate', probabilities: { 'free-candidate': 1, abstain: 0 }, confidence: 1 };
  let inMemoryDispatches = 0;
  const evaluation = await evaluateJevCandidates({ ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'synthetic-free-injected-ledger-token' }, context, new AbortController().signal, { fetch: (async (_url, init) => {
    inMemoryDispatches++;
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return new Response(JSON.stringify({ model: JEV_MODEL_ID, answers, usage: { input_tokens: 12, output_tokens: 0 } }));
  }) as typeof fetch });
  assert.equal(inMemoryDispatches, 1);
  assert.equal(evaluation.status, 'accepted', evaluation.reason);
  assert.equal(evaluation.providerRequests, 1, 'Evaluator reports a fetch dispatch, not transport provenance');
  const injected = { evidenceKind: 'injected-test' as const, calls: [], jevCalls: [{ id: randomUUID(), phase: 'product', startedAt: new Date().toISOString(), configHash: 'free-injected-ledger', evaluation }] };
  const before = JSON.stringify(injected);
  const counts = productionRequestCounts(injected);
  assert.equal(counts.actualProviderRequests, null);
  assert.equal(counts.jevProviderRequests, null);
  assert.equal(counts.knownProviderRequests, 0);
  assert.equal(counts.unknownRequestIntents, 1);
  assert.equal(counts.observedJevDispatches, 1);
  assert.equal(counts.unverifiedJevDispatches, 1);
  assert.equal(counts.unknownJevDispatchIntents, 0);
  assert.equal(counts.budgetRecords, 1);
  assert.equal(JSON.stringify(injected), before, 'Projection must not alter evaluator or historical evidence');

  const historical = historicalRun();
  const realObserved = historical.run.calls.filter(call => call.executionSource === 'harness' && call.providerRequests?.requests === 1).slice(0, 2);
  assert.equal(realObserved.length, 2);
  const mixed = productionRequestCounts({ ...injected, calls: realObserved });
  assert.equal(mixed.actualProviderRequests, null, 'Unverified Jev dispatch cannot be silently added to real HTTP');
  assert.equal(mixed.knownProviderRequests, 2);
  assert.equal(mixed.knownHarnessProviderRequests, 2);
  assert.equal(mixed.harnessInvocations, 2);
  assert.equal(mixed.unknownRequestIntents, 1);
  assert.equal(mixed.observedJevDispatches, 1);
  assert.equal(mixed.unverifiedJevDispatches, 1);
  assert.equal(mixed.budgetRecords, 3);
  assert.deepEqual(readFileSync(historicalPath), historical.bytes);
  t.diagnostic('One explicit in-memory fetch dispatch; zero HTTP, models, browser, real Key reads or new billing. Two Harness observations are read-only historical evidence.');
});

test('original CAMERA05 retains ten observed HTTP requests without rewriting its bytes or zero-POST Harness attempt', () => {
  const historical = historicalRun();
  const before = JSON.stringify(historical.run);
  const counts = productionRequestCounts(historical.run);
  assert.equal(counts.actualProviderRequests, 10);
  assert.equal(counts.knownProviderRequests, 10);
  assert.equal(counts.knownHarnessProviderRequests, 7);
  assert.equal(counts.knownJevProviderRequests, 3);
  assert.equal(counts.observedJevDispatches, 3);
  assert.equal(counts.unverifiedJevDispatches, 0);
  assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(historical.run.calls.find(call => call.phase === 'acceptance')!.providerRequests!.requests, 0);
  assert.equal(JSON.stringify(historical.run), before);
  assert.deepEqual(readFileSync(historicalPath), historical.bytes);
});
