import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareVerifierStudyProposal, verifierStudyPublicConfiguration, type VerifierWireCapture } from '../server/production/verifier-study-preflight.ts';
import { prepareVerifierWirePreflight } from '../server/production/verifier-wire-preflight.ts';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.ts';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.ts';
import { jevConfigSchema } from '../shared/jev-schema.ts';

const verifier = { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Verifier', role: 'verifier', enabled: true,
  provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
  pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } };
const jev = { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true };
const source = { commit: 'a'.repeat(40), clean: true, hashes: { 'server/harness.ts': 'b'.repeat(64) } };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
// Pure request-integrity fixtures, deliberately NOT real SDK/transport evidence.
// Separate wire-preflight tests exercise the actual pinned SDK and fake server.
const input = () => ({ verifier: structuredClone(verifier), jev: structuredClone(jev), source: structuredClone(source),
  captures: VERIFIER_CHALLENGE_IDS.map((poolId, index) => {
    const logical = verifierPreparationRequests(poolId).logicalLlm;
    const prepared = prepareVerifierWirePreflight(logical, { provider: 'deepseek', upstreamBaseUrl: verifier.baseUrl, modelId: verifier.modelId, maxOutputTokens: 4096, timeoutMs: 120000 });
    const bodyUtf8 = JSON.stringify(prepared.expectedBody);
    const result = { ...prepared, status: 'completed', scenario: 'success', invocationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      wire: { body: structuredClone(prepared.expectedBody), bodyUtf8, bodySha256: sha(bodyUtf8), bodyCanonicalSha256: prepared.expectedBodyCanonicalSha256,
        bodyBytes: Buffer.byteLength(bodyUtf8), validated: true, exactLiteralMessages: true },
      transport: { localProviderPosts: 1, externalProviderPosts: 0, fixtureServerClosed: true, providerResponseDestroyedAfterCleanup: true },
    } as unknown as VerifierWireCapture;
    return { poolId, result };
  }) });

test('complete proposal contains 18 unchanged full requests and 54 decisions but cannot authorize execution', () => {
  const value = prepareVerifierStudyProposal(input());
  assert.equal(value.pools.length, 18); assert.equal(value.ordering.schedule.length, 54);
  assert.equal(value.readyForPaidExecution, false); assert.equal(value.authorization, null);
  assert.equal(value.status, 'fee-unapproved-proposal'); assert.equal(value.proposedLimits.intentMax, 54);
  assert.equal(value.proposedLimits.llmIntentMax, 36); assert.equal(value.proposedLimits.jevIntentMax, 18);
  assert.equal(value.proposedLimits.retryMax, 0); assert.equal(value.proposedLimits.jevOutputTokenCeiling, null);
  assert.equal(value.proposedLimits.llmInputCeiling + value.proposedLimits.llmOutputTokens, 65536);
  assert.equal(value.proposedLimits.wholeBatchRequestedCostUsd, 1);
  assert.ok(Math.abs(value.proposedLimits.engineeringCeilingEstimateUsd - 0.890044416) < 1e-12);
  assert.ok(value.proposedLimits.wholeBatchByteSurrogateEstimateUsd < value.proposedLimits.engineeringCeilingEstimateUsd);
  assert.ok(value.proposedLimits.maxPoolByteSurrogateEstimateUsd < value.proposedLimits.wholeBatchByteSurrogateEstimateUsd);
  assert.equal(value.evidence.actualModelUsage, null); assert.equal(value.evidence.actualModelQualityEffect, null);
  assert.equal(value.evidence.actualProviderCost, 0); assert.equal(value.ordering.candidateRandomization, 'not-performed');
  assert.equal(value.models.verifier.modelId, 'deepseek-flash');
  const { proposalSha256, ...withoutHash } = value; assert.equal(proposalSha256, sha(JSON.stringify(withoutHash)));
  for (const pool of value.pools) { const original = verifierPreparationRequests(pool.poolId);
    assert.deepEqual(pool.requests, original); assert.equal(pool.wire.bodySha256, sha(pool.wire.bodyUtf8));
    assert.equal(pool.reservations.jevOutputTokens, null); }
});

test('public snapshots require explicit fields; creation defaults cannot silently freeze missing configuration', () => {
  for (const field of ['baseUrl', 'modelId', 'enabled', 'pricing', 'provider', 'hasApiKey']) {
    const value = input(); delete (value.verifier as Record<string, unknown>)[field];
    assert.throws(() => verifierStudyPublicConfiguration(value), /Incomplete/);
    (value.verifier as Record<string, unknown>)[field] = undefined;
    assert.throws(() => verifierStudyPublicConfiguration(value), /Incomplete/);
  }
  for (const field of ['modelId', 'minScore', 'minConfidence', 'inputPerMillion', 'outputPerMillion', 'timeoutMs', 'maxRequests', 'enabled', 'currency', 'hasApiKey']) {
    const value = input(); delete (value.jev as Record<string, unknown>)[field];
    assert.throws(() => verifierStudyPublicConfiguration(value), /Incomplete/);
    (value.jev as Record<string, unknown>)[field] = undefined;
    assert.throws(() => verifierStudyPublicConfiguration(value), /Incomplete/);
  }
});

test('credentials, fee authorization, unsupported provider, currency and threshold changes are rejected, not ignored', () => {
  const key = 'synthetic-private-value-not-a-real-key';
  for (const location of ['verifier', 'jev'] as const) { const value = input(); Object.assign(value[location], { apiKey: key }); assert.throws(() => prepareVerifierStudyProposal(value)); }
  assert.throws(() => prepareVerifierStudyProposal({ ...input(), budgetAuthorized: true } as ReturnType<typeof input>), /Unknown proposal fields/);
  for (const change of [{ provider: 'anthropic' }, { pricing: { ...verifier.pricing, currency: 'CNY' } }, { pricing: null }]) {
    const value = input(); Object.assign(value.verifier, change); assert.throws(() => prepareVerifierStudyProposal(value));
  }
  for (const change of [{ outputPerMillion: 1 }, { minScore: 2 }, { minConfidence: 0.7 }]) {
    const value = input(); Object.assign(value.jev, change); assert.throws(() => prepareVerifierStudyProposal(value));
  }
});

test('incomplete or dirty configuration stays blocked and presence never establishes authentication', () => {
  const value = input(); value.verifier.hasApiKey = false; value.jev.hasApiKey = false; value.jev.enabled = false; value.jev.maxRequests = 1; value.source.clean = false;
  const proposal = prepareVerifierStudyProposal(value);
  for (const reason of ['page-configuration-incomplete', 'source-worktree-dirty', 'jev-configured-request-limit-below-18', 'paid-study-consent-not-granted', 'real-study-adapter-not-implemented']) assert.ok(proposal.blockers.includes(reason));
  assert.equal(proposal.readyForPaidExecution, false); assert.match(proposal.models.credentialEvidence, /not authenticated/);
});

test('strict schedule and fresh capture identity prevent omissions, duplicate pools and cached invocation reuse', () => {
  for (const mode of ['missing', 'duplicate-pool', 'duplicate-session'] as const) {
    const value = input();
    if (mode === 'missing') value.captures.pop();
    if (mode === 'duplicate-pool') value.captures[1].poolId = value.captures[0].poolId;
    if (mode === 'duplicate-session') value.captures[1].result.invocationId = value.captures[0].result.invocationId;
    assert.throws(() => prepareVerifierStudyProposal(value));
  }
});

test('transport/source/configuration tampering and truncated or rehashed body fail closed', () => {
  for (const change of [
    (capture: VerifierWireCapture) => { capture.status = 'cancelled'; },
    (capture: VerifierWireCapture) => { capture.transport.externalProviderPosts = 1; },
    (capture: VerifierWireCapture) => { capture.transport.localProviderPosts = 2; },
    (capture: VerifierWireCapture) => { capture.transport.fixtureServerClosed = false; },
    (capture: VerifierWireCapture) => { capture.configuration.modelId = 'other'; },
    (capture: VerifierWireCapture) => { capture.wire!.bodyBytes++; },
    (capture: VerifierWireCapture) => { Object.assign(capture.wire!, { authorization: 'synthetic-extra-metadata-not-a-real-secret' }); },
    (capture: VerifierWireCapture) => { Object.assign(capture.wire!, { validated: { authorization: 'synthetic-extra-metadata-not-a-real-secret' } }); },
    (capture: VerifierWireCapture) => { Object.assign(capture.wire!, { exactLiteralMessages: 'true' }); },
    (capture: VerifierWireCapture) => { Object.assign(capture.transport, { fixtureServerClosed: 'true' }); },
    (capture: VerifierWireCapture) => { capture.wire!.bodyUtf8 += ' '.repeat(1024); capture.wire!.bodyBytes = Buffer.byteLength(capture.wire!.bodyUtf8); capture.wire!.bodySha256 = sha(capture.wire!.bodyUtf8); },
    (capture: VerifierWireCapture) => { capture.wire!.bodyUtf8 = capture.wire!.bodyUtf8.replace('{', '{"model":"duplicate-key-value",'); capture.wire!.bodyBytes = Buffer.byteLength(capture.wire!.bodyUtf8); capture.wire!.bodySha256 = sha(capture.wire!.bodyUtf8); },
    (capture: VerifierWireCapture) => { capture.wire!.bodyUtf8 = capture.wire!.bodyUtf8.slice(0, -1); },
    (capture: VerifierWireCapture) => { capture.wire!.body = { ...capture.wire!.body, temperature: 1 }; capture.wire!.bodyUtf8 = JSON.stringify(capture.wire!.body); capture.wire!.bodySha256 = sha(capture.wire!.bodyUtf8); },
  ]) { const value = input(); change(value.captures[0].result); assert.throws(() => prepareVerifierStudyProposal(value)); }
  const value = input(); value.verifier.modelId = 'changed-after-capture'; assert.throws(() => prepareVerifierStudyProposal(value));
});

test('immutable proposal cannot be changed through retained captures, config, source or returned nested references', () => {
  const value = input(); const proposal = prepareVerifierStudyProposal(value); const before = JSON.stringify(proposal);
  value.captures[0].result.wire!.body.model = 'mutated'; value.captures[0].result.wire!.bodyUtf8 = 'changed'; value.verifier.modelId = 'changed'; value.source.hashes['server/harness.ts'] = 'c'.repeat(64);
  assert.equal(JSON.stringify(proposal), before);
  assert.throws(() => { proposal.pools[0].wire.body.model = 'mutated'; }, TypeError);
  assert.throws(() => { proposal.blockers.pop(); }, TypeError);
});
