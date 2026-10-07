import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';
import { inspectVerifierStudyArchive } from '../server/production/verifier-study-archive.js';
import type { StudyUsage } from '../server/production/verifier-study.js';
import type { VerifierStudyRequests, VerifierStudySelection } from '../server/production/verifier-study-strategy.js';
import { JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation, type JevPublicConfig, type JevRequestSnapshot, type JevScoreAnswer } from '../shared/jev-schema.js';
import { readVerifierReal01Evidence, VERIFIER_REAL01_ARCHIVE_SHA256 as ARCHIVE_SHA256, VERIFIER_REAL01_ARCHIVE_URL as ARCHIVE_URL } from './fixtures/verifier-real01.js';

const FIXTURE_KEY = 'real01-offline-replay-fixture-not-an-api-key';
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byteHash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
type CompleteUsage = StudyUsage & { inputTokens: number; outputTokens: number; estimatedCost: number };
type RecordedEvaluation = JevEvaluation & { observation: {
  requestSha256: string; engine: string; poolId: string; executionSource: string;
  actualProviderHttpAttempts: number; cleanupAwaited: boolean;
} };
interface RecordedEvent {
  sequence: number; type: string;
  payload: {
    poolId?: string; strategy?: string; kind?: string; callId?: string; cachePolicy?: string;
    requestSnapshot?: unknown; requestSha256?: string; expectedWireSnapshot?: unknown;
    responseSnapshot?: RecordedEvaluation; usage?: CompleteUsage; actualProviderHttpAttempts?: number;
    selection?: VerifierStudySelection;
  };
}
interface RecordedManifest {
  manifest: { inputSnapshots: VerifierStudyRequests[]; observedPlan: { configuration: { jev: JevPublicConfig } } };
}

const publicEvidence = readVerifierReal01Evidence();
const evidence = { ...publicEvidence, manifest: publicEvidence.manifest as RecordedManifest, events: publicEvidence.events as RecordedEvent[] };
const EXPECTED = [
  { poolId: 'H01', sequence: 10, status: 'error', rawSha256: 'b13c3a8adc16274a02e9becd183d39cff7129da41ecc922b40846e9a4279df25',
    contextSha256: '4edd350efc1942ad2e25dc207ae457ad8fb0630ee29c3f61b8beb97d5906a5b2', requestSha256: '63389783192a90fe72a8771c43df9513935a2eaec17e2f308dabf96e311a6562',
    diagnostics: [{ code: 'score-concentration-drift', answerId: 'c0_coverage' }, { code: 'score-concentration-drift', answerId: 'c0_consistency' }] },
  { poolId: 'H02', sequence: 22, status: 'error', rawSha256: '17d8da2251efd0e11ce5a8c6e69ad69c88bf09511bcc9b7f652651be5a3d3288',
    contextSha256: '7c60132e2af6e5c5b2d7122fffdc894559a5c1dae7a3b790dc8946a2ff2d60ed', requestSha256: 'a980aad69cf7279a4b16febe4af9ff59d3a7d0fa77058eb219ba78c1599068f2',
    diagnostics: [{ code: 'score-concentration-drift', answerId: 'c0_coverage' }, { code: 'score-concentration-drift', answerId: 'c1_consistency' }] },
  { poolId: 'H03', sequence: 34, status: 'uncertain', rawSha256: '340e6a81105f7b984b29bfc47df7a4a6ff1456e36fb224664123d8fd29e1bd47',
    contextSha256: 'b01e7b27c1cd31089616646317421048582d180a2d4d24f48215f1971e363e9c', requestSha256: '9db94c076d7544e83cb4f23d841836942201ef29bba9c8c9ede5f9fa65380327', diagnostics: undefined },
] as const;
function recorded(poolId: string) {
  const result = evidence.events.filter(event => event.type === 'call-result' && event.payload.kind === 'jev' && event.payload.poolId === poolId);
  assert.equal(result.length, 1);
  const response = result[0].payload.responseSnapshot;
  assert.ok(response);
  const intents = evidence.events.filter(event => event.type === 'call-intent' && event.payload.callId === result[0].payload.callId);
  assert.equal(intents.length, 1);
  const request = evidence.manifest.manifest.inputSnapshots.find(input => input.metadata.poolId === poolId);
  assert.ok(request);
  return { event: result[0], intent: intents[0], response, request };
}

test('VERIFIER-REAL-01 public archive retains pinned integrity, failed terminal and complete recorded accounting', () => {
  const { inspection } = evidence;
  assert.equal(inspection.archiveVerified, true);
  assert.equal(inspection.recordedExecutionSource, 'real-provider');
  assert.equal(inspection.sourceCommit, 'aaaac613cea5c15b3ba0a546457a7eb96e3fd936');
  assert.equal(inspection.terminalStatus, 'failed');
  assert.equal(inspection.eventCount, 44); assert.equal(inspection.decisionCount, 11);
  assert.equal(inspection.callbackIntents, 10); assert.equal(inspection.oracleCount, 0);
  assert.deepEqual(inspection.inventory, { physicalEntries: 180, ledgerJsonFiles: 89, directories: 1, paxHeaders: 90, appleDoubleFiles: 0 });
  assert.deepEqual(inspection.usage, { complete: true, knownInputTokens: 73632, knownOutputTokens: 2505,
    knownEstimatedCost: 0.017598132, currency: 'USD', unknownCalls: 0, boundary: 'recorded-declared-rate-estimate-not-provider-bill' });
  assert.throws(() => inspectVerifierStudyArchive(evidence.archiveBytes, '0'.repeat(64)), /archive-sha256-mismatch/);
});

for (const expected of EXPECTED) test(`VERIFIER-REAL-01 ${expected.poolId} original Jev response replays with original business binding, explicit current rubric and no real fetch, retry or cache`, async t => {
  // If evaluateJevCandidates ever ignores the injected transport, fail before network access.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Real network fetch is forbidden in this replay'); });
  const { event, intent, response, request } = recorded(expected.poolId);
  assert.equal(response.policyVersion, 'jev-candidate-v3', 'the historical evaluation retains its original policy');
  assert.equal(event.sequence, expected.sequence);
  assert.equal(jsonHash(response.rawResponse), expected.rawSha256);
  assert.equal(jsonHash(intent.payload.requestSnapshot), expected.contextSha256);
  assert.equal(intent.payload.requestSha256, expected.contextSha256);
  assert.equal(jsonHash(response.requestSnapshot), expected.requestSha256);
  assert.deepEqual(intent.payload.expectedWireSnapshot, response.requestSnapshot);
  assert.deepEqual(request.jev, response.requestSnapshot);
  assert.deepEqual(request.snapshot, intent.payload.requestSnapshot);
  assert.equal(request.metadata.jevRequestSha256, expected.requestSha256);
  assert.equal(response.observation.requestSha256, expected.contextSha256);
  assert.equal(response.observation.poolId, expected.poolId);
  assert.equal(response.observation.cleanupAwaited, true);
  assert.equal(response.observation.actualProviderHttpAttempts, 1, 'historical recorded attempt, not replay traffic');
  const unchanged = JSON.stringify(response);
  const config = { ...evidence.manifest.manifest.observedPlan.configuration.jev, apiKey: FIXTURE_KEY };
  assert.equal(config.minScore, 3); assert.equal(config.minConfidence, 0.5);
  assert.equal(config.modelId, 'jev-1.13.0');
  const currentRequest = buildJevCandidateRequest(config.modelId, request.snapshot);
  assert.equal(response.requestSnapshot!.state.phaseReview?.version, 'verifier-phase-ordinal-v4');
  assert.equal(currentRequest.state.phaseReview?.version, 'verifier-phase-ordinal-v5');
  // Current prompt improvements version the shared rubric. This is a replay of
  // the unchanged numerical validator, not a claim that the new prompt was
  // actually sent to Jev during the old run or would elicit the same response.
  const withoutRubric = (value: JevRequestSnapshot) => {
    const { phaseReview: _rubric, ...state } = value.state;
    return { ...value, state };
  };
  assert.deepEqual(withoutRubric(currentRequest), withoutRubric(response.requestSnapshot!), 'only the explicitly versioned phase rubric changes; all business evidence and questions remain bound');
  assert.notEqual(jsonHash(currentRequest), expected.requestSha256, 'current v5 wire is explicitly distinguished from archived v4 wire');
  let injectedCalls = 0;
  // Two evaluations of the same sample must each reach the local transport once.
  // These are repeated engineering checks, not two new provider observations.
  for (let repetition = 0; repetition < 2; repetition++) {
    const context = structuredClone(intent.payload.requestSnapshot) as JevCandidateContext;
    const result = await evaluateJevCandidates(config, context, new AbortController().signal, {
      fetch: (async (url, init) => {
        injectedCalls++;
        assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${FIXTURE_KEY}`);
        const wire = JSON.parse(String(init?.body)) as JevRequestSnapshot;
        assert.deepEqual(wire, currentRequest, 'same current request snapshot, with full original goal, acceptance and candidate bytes');
        assert.equal(jsonHash(wire), jsonHash(currentRequest));
        return new Response(JSON.stringify(response.rawResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    assert.equal(injectedCalls, repetition + 1, 'one local dispatch per invocation; no retry or result cache');
    assert.equal(result.policyVersion, JEV_POLICY_VERSION, 'current policy replay does not rewrite the archived policy');
    assert.deepEqual(result.requestSnapshot, currentRequest);
    assert.equal(result.status, expected.status, result.reason);
    assert.equal(result.errorKind, expected.status === 'error' ? 'arithmetic-drift' : undefined, result.reason);
    assert.deepEqual(result.diagnostics, expected.diagnostics);
    assert.equal(result.selectedCandidateId, null);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.providerRequests, 1, 'adapter counter is simulated by the injected Response');
    assert.deepEqual(result.usage, response.usage);
    assert.equal(result.modelIdRequested, 'jev-1.13.0'); assert.equal(result.modelIdReturned, 'jev-1.13.0');
    assert.deepEqual(result.rawResponse, response.rawResponse);
    assert.equal(jsonHash(result.rawResponse), expected.rawSha256);
    if (expected.status === 'error') { assert.deepEqual(result.scores, []); assert.equal(result.choice, null); }
    else {
      assert.deepEqual(result.scores, response.scores); assert.deepEqual(result.choice, response.choice);
      assert.ok(result.scores.every(score => !score.qualified && !score.stronglyRejected));
    }
    assert.equal(JSON.stringify(response), unchanged, 'no normalization or repair of archived response');
  }
  assert.equal(byteHash(readFileSync(ARCHIVE_URL)), ARCHIVE_SHA256, 'original failed ledger archive remains untouched');
});

test('VERIFIER-REAL-01 four concentration diagnostics have independent positive gaps under the frozen ±0.005 joint assumption', () => {
  const halfQuantum = 0.005;
  const cases = [
    { poolId: 'H01', answerId: 'c0_coverage', mode: 4, gap: 0.013 },
    { poolId: 'H01', answerId: 'c0_consistency', mode: 4, gap: 0.021 },
    { poolId: 'H02', answerId: 'c0_coverage', mode: 4, gap: 0.007 },
    { poolId: 'H02', answerId: 'c1_consistency', mode: 1, gap: 0.015 },
  ];
  for (const item of cases) {
    const raw = recorded(item.poolId).response.rawResponse as { answers: Record<string, JevScoreAnswer> };
    const answer = raw.answers[item.answerId];
    const p = answer.probabilities;
    assert.ok(Object.entries(p).every(([level, probability]) => Number(level) === item.mode || p[String(item.mode)] - halfQuantum > probability + halfQuantum), 'unique mode cannot change within fixed rounding intervals');
    const scoreInterval = [answer.score - halfQuantum, answer.score + halfQuantum];
    // With sum(p)=1 and positive confidence, the documented five-level modal
    // MAD formula gives μ=2.8+1.2C at mode 4; at mode 1 it gives
    // μ=2.2−1.2C−2p0. These necessary identities avoid the production LP solver.
    const center = item.mode === 4 ? 2.8 + 1.2 * answer.confidence : 2.2 - 1.2 * answer.confidence - 2 * p['0'];
    const uncertainty = item.mode === 4 ? 1.2 * halfQuantum : 1.2 * halfQuantum + 2 * halfQuantum;
    const impliedMeanInterval = [center - uncertainty, center + uncertainty];
    const gap = Math.max(impliedMeanInterval[0] - scoreInterval[1], scoreInterval[0] - impliedMeanInterval[1]);
    assert.ok(gap > 0, 'no one distribution can support both returned fields at the frozen precision');
    assert.ok(Math.abs(gap - item.gap) < 1e-12, `${item.poolId}/${item.answerId} gap remains ${item.gap}`);
  }
});

test('VERIFIER-REAL-01 original cascade accounts for all three independent fallback calls and costs without replaying an LLM or Oracle', () => {
  const totals = { jev: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }, llm: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 } };
  for (const expected of EXPECTED) {
    const { response, request } = recorded(expected.poolId);
    const decision = evidence.events.filter(event => event.type === 'decision-result' && event.payload.poolId === expected.poolId && event.payload.strategy === 'jev-cascade');
    assert.equal(decision.length, 1);
    const selection = decision[0].payload.selection!;
    assert.deepEqual(selection.callbackCounts, { llm: 1, jev: 1 });
    assert.equal(selection.fallbackKind, expected.status === 'error' ? 'arithmetic-drift' : 'uncertain');
    assert.equal(selection.engine, expected.status === 'error' ? 'jev-llm-protocol-fallback' : 'jev-llm-fallback');
    assert.equal(selection.requestBinding?.jevRequestSha256, expected.requestSha256);
    assert.equal(selection.requestBinding?.inputSha256, jsonHash(request));
    assert.deepEqual(selection.requestBinding?.candidates, request.snapshot.candidates.map(candidate => ({ id: candidate.id, candidateValueJsonSha256: jsonHash(candidate.value) })));
    assert.deepEqual(selection.jevSummary?.usage, response.usage);
    const intents = evidence.events.filter(event => event.type === 'call-intent' && event.payload.poolId === expected.poolId && event.payload.strategy === 'jev-cascade');
    assert.deepEqual(intents.map(intent => intent.payload.kind), ['jev', 'llm'], 'exactly one Jev and one independent fallback in the recorded ledger');
    const baselineLlm = evidence.events.find(event => event.type === 'call-intent' && event.payload.poolId === expected.poolId && event.payload.strategy === 'llm');
    assert.ok(baselineLlm);
    assert.deepEqual(intents[1].payload.requestSnapshot, baselineLlm.payload.requestSnapshot, 'fallback used the same blind B request without adding Jev opinion');
    assert.equal(jsonHash(intents[1].payload.requestSnapshot), selection.requestBinding?.logicalLlmSha256);
    for (const intent of intents) {
      assert.equal(intent.payload.cachePolicy, 'bypass');
      const results = evidence.events.filter(event => event.type === 'call-result' && event.payload.callId === intent.payload.callId);
      assert.equal(results.length, 1); assert.equal(results[0].payload.actualProviderHttpAttempts, 1);
      const usage = results[0].payload.usage!;
      assert.equal(usage.complete, true); assert.equal(usage.currency, 'USD');
      const total = totals[intent.payload.kind as keyof typeof totals];
      total.calls++; total.inputTokens += usage.inputTokens; total.outputTokens += usage.outputTokens; total.cost += usage.estimatedCost;
    }
  }
  assert.deepEqual({ ...totals.jev, cost: Number(totals.jev.cost.toFixed(9)) }, { calls: 3, inputTokens: 26446, outputTokens: 562, cost: 0.001110732 });
  assert.deepEqual({ ...totals.llm, cost: Number(totals.llm.cost.toFixed(9)) }, { calls: 3, inputTokens: 20270, outputTokens: 806, cost: 0.0070482 });
  assert.equal(Number((totals.jev.cost + totals.llm.cost).toFixed(9)), 0.008158932);
  assert.equal(evidence.events.filter(event => event.type === 'oracle-result').length, 0, 'behavior correctness remains unknown');
});
