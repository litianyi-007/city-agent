import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERIFIER_CHALLENGE_CORPUS_VERSION, VERIFIER_CHALLENGE_IDS, VERIFIER_CHALLENGE_EXPECTATIONS, VERIFIER_CHALLENGE_HTML_POOLS, VERIFIER_CHALLENGE_SCENE_POOLS } from '../shared/production-verifier-challenge-corpus.js';
import { verifierPreparationManifest, verifierPreparationRequests, verifierPreparationProgress } from '../server/production/verifier-corpus-preparation.js';

test('preparation has eighteen distinct pools, balanced eight mixed, six double-bad, four double-good; not a model study result', () => {
  assert.equal(VERIFIER_CHALLENGE_IDS.length, 18);
  assert.equal(new Set(VERIFIER_CHALLENGE_IDS).size, 18);
  assert.equal(VERIFIER_CHALLENGE_EXPECTATIONS.length, 36);
  const pools = [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS];
  const ids = pools.flatMap(pool => pool.candidates.map(candidate => candidate.id));
  assert.equal(new Set(ids).size, 36);
  const classifications = pools.map(pool => pool.candidates.map(candidate => VERIFIER_CHALLENGE_EXPECTATIONS.find(label => label.poolId === pool.id && label.candidateId === candidate.id)!.expectedPass));
  assert.equal(classifications.filter(labels => labels.filter(Boolean).length === 1).length, 8);
  assert.equal(classifications.filter(labels => labels.every(Boolean)).length, 4);
  assert.equal(classifications.filter(labels => labels.every(label => !label)).length, 6);
  const mixed = classifications.filter(labels => labels.filter(Boolean).length === 1);
  assert.equal(mixed.filter(labels => labels[0]).length, 4);
  assert.equal(mixed.filter(labels => !labels[0]).length, 4);
  const manifest = verifierPreparationManifest();
  assert.equal(manifest.version, VERIFIER_CHALLENGE_CORPUS_VERSION);
  assert.equal(manifest.status, 'corpus-only-not-a-funded-frozen-model-study');
  assert.equal(manifest.modelRequests, 0);
  assert.equal(manifest.actualModelEffect, null);
  assert.equal(manifest.actualModelCost, null, 'no model request is not a measured zero-cost model result');
});

test('all actual Jev JSON and logical LLM prompts stay within existing limits without truncation or label leakage', t => {
  const forbidden = new Set(['expectedPass', 'defect', 'gold', 'stratum', 'oracleResults', 'componentPixels', 'actual', 'evaluation', 'selectedCandidateId']);
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  };
  const manifest = verifierPreparationManifest();
  assert.equal(manifest.bytePreflight.valid, true, JSON.stringify(manifest.bytePreflight));
  for (const id of VERIFIER_CHALLENGE_IDS) {
    const request = verifierPreparationRequests(id);
    inspect(request.jev);
    const logical = JSON.parse(request.logicalLlm.userPrompt);
    // The response schema legitimately defines selectedCandidateId; only a
    // supplied prior selection in review inputs would be answer leakage.
    inspect({ criteria: logical.criteria, state: logical.state, candidates: logical.candidates });
    const all = `${JSON.stringify(request.jev)}\n${request.logicalLlm.systemPrompt}\n${request.logicalLlm.userPrompt}`;
    for (const label of VERIFIER_CHALLENGE_EXPECTATIONS) if (label.defect) assert.equal(all.includes(label.defect), false);
    assert.equal(request.jev.state.phase, 'implement');
    assert.deepEqual(request.jev.state.candidates, request.snapshot.candidates);
    assert.deepEqual(JSON.parse(request.logicalLlm.userPrompt).candidates, request.snapshot.candidates);
    assert.equal(request.snapshot.reviewContext.feedback, null);
    t.diagnostic(JSON.stringify(request.metadata));
  }
  assert.throws(() => verifierPreparationRequests('DEV-01' as 'H01'));
});

test('preparation manifests are deterministic snapshots, not provider configuration or outcome ledgers', () => {
  const first = verifierPreparationManifest(); const second = verifierPreparationManifest();
  assert.deepEqual(first, second);
  const json = JSON.stringify(first);
  assert.doesNotMatch(json, /apiKey|api_key|Bearer |expectedPass|defect|selectedCandidateId/);
  assert.equal(first.ordering, 'preparation-source-order-not-final-randomization');
  assert.ok(first.pools.every(pool => /^[a-f0-9]{64}$/.test(pool.frozenHash) && pool.requestEvidence === 'offline-serialized-never-dispatched'));
  assert.ok(first.pools.every(pool => pool.llmTransportBoundary.includes('not frozen or measured')));
});

test('started cancelled/error preparation intents cannot disappear into not-started or a complete result count', () => {
  const scheduled = [{ poolId: 'H01', candidateId: 'a' }, { poolId: 'H01', candidateId: 'b' }, { poolId: 'H02', candidateId: 'c' }];
  const result = verifierPreparationProgress(scheduled, [{ ...scheduled[0], status: 'completed' }, { ...scheduled[1], status: 'cancelled' }]);
  assert.deepEqual(result, { scheduled: 3, attempted: 2, completed: 1, failed: 0, cancelled: 1, inProgress: 0, notStarted: [scheduled[2]] });
  assert.equal(verifierPreparationProgress(scheduled, [{ ...scheduled[0], status: 'failed' }]).failed, 1);
  assert.equal(verifierPreparationProgress(scheduled, [{ ...scheduled[0], status: 'started' }]).inProgress, 1);
  assert.throws(() => verifierPreparationProgress(scheduled, [{ ...scheduled[0], status: 'completed' }, { ...scheduled[0], status: 'failed' }]));
  assert.throws(() => verifierPreparationProgress(scheduled, [{ poolId: 'unknown', candidateId: 'a', status: 'started' }]));
});
