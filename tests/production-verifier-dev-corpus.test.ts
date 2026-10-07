import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runGate } from '../server/gate.ts';
import { buildJevCandidateRequest, JEV_REQUEST_LAYOUT_VERSION } from '../server/production/jev.ts';
import { codeSchema, contractProfile, outputContractSnapshot, testsSchema, verifierSchema } from '../server/production/contracts.ts';
import { ACCEPTANCE_SEMANTICS_VERSION } from '../server/production/acceptance-preflight.ts';
import { REVIEW_CONTEXT_PROJECTION_VERSION } from '../server/production/review-context.ts';
import { HARNESS_JSON_OUTPUT_VERSION, HARNESS_PROMPT_TRANSPORT_VERSION } from '../server/harness.ts';
import { PRODUCTION_PLANNING_LOOP_VERSION, PRODUCTION_REPAIR_POLICY_VERSION } from '../shared/production-schema.ts';
import { phaseVerifierSystemPrompt, productionPhaseRubric, VERIFIER_COMPACT_OUTPUT_POLICY } from '../shared/production-verifier-rubric.ts';
import { VERIFIER_DEV_CORPUS, VERIFIER_DEV_CORPUS_VERSION, VERIFIER_DEV_DOM_CONTRACT, VERIFIER_DEV_EXPECTATIONS, VERIFIER_DEV_ORACLE_VERSION, verifierDevReviewSnapshot } from '../shared/production-verifier-dev-corpus.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
function review(pool: (typeof VERIFIER_DEV_CORPUS)[number]) {
  return verifierDevReviewSnapshot(pool.id, { version: contractProfile('offline-single-html').acceptanceVersion, hash: hash({ version: VERIFIER_DEV_ORACLE_VERSION, goal: pool.goal, acceptance: pool.acceptance, checks: pool.checks }) });
}

test('three development-only pools contain six strict HTML candidates with a shared neutral DOM and immutable Oracle', () => {
  assert.deepEqual(VERIFIER_DEV_CORPUS.map(pool => pool.id), ['DEV-01', 'DEV-02', 'DEV-03']);
  assert.equal(VERIFIER_DEV_CORPUS.flatMap(pool => pool.candidates).length, 6);
  const ids = VERIFIER_DEV_CORPUS.flatMap(pool => pool.candidates.map(candidate => candidate.id));
  assert.equal(new Set(ids).size, 6);
  assert.equal(VERIFIER_DEV_EXPECTATIONS.length, 6);
  for (const pool of VERIFIER_DEV_CORPUS) {
    testsSchema.parse({ checks: pool.checks });
    assert.ok(Object.isFrozen(pool) && Object.isFrozen(pool.checks));
    for (const candidate of pool.candidates) {
      codeSchema.parse(candidate.value);
      assert.ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.value));
      assert.deepEqual(Object.keys(candidate.value), ['html']);
      for (const selector of Object.values(VERIFIER_DEV_DOM_CONTRACT)) assert.equal(candidate.value.html.match(new RegExp(`id="${selector.slice(1)}"`, 'g'))?.length, 1);
      assert.doesNotMatch(candidate.value.html, /https?:\/\/|fetch\s*\(|XMLHttpRequest|new\s+Worker|<iframe|<script[^>]+src=/i);
      assert.doesNotMatch(candidate.id, /good|bad|gold|correct|wrong/i);
      assert.doesNotMatch(candidate.value.html, /正确版|错误版|\b(?:good|bad|gold)\b/i);
      assert.equal(VERIFIER_DEV_EXPECTATIONS.filter(label => label.poolId === pool.id && label.candidateId === candidate.id).length, 1);
    }
    assert.throws(() => pool.candidates.push(pool.candidates[0]), TypeError);
  }
  assert.deepEqual(VERIFIER_DEV_CORPUS.map(pool => pool.candidates.map(candidate => VERIFIER_DEV_EXPECTATIONS.find(label => label.candidateId === candidate.id)!.expectedPass)), [[false, true], [false, false], [true, true]]);
});

test('blind implement review snapshots separate gold/defects/results from legitimate frozen acceptance', () => {
  const forbidden = new Set(['expectedPass', 'defect', 'gold', 'oracleResults', 'evaluation', 'jevOpinions', 'selectedCandidateId']);
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  }
  for (const pool of VERIFIER_DEV_CORPUS) {
    const snapshot = review(pool); inspect(snapshot);
    assert.equal(snapshot.phase, 'implement');
    assert.equal(snapshot.capability, 'offline-single-html');
    assert.deepEqual(snapshot.candidates, pool.candidates);
    assert.deepEqual(snapshot.reviewContext.frozenContract.checks, pool.checks);
    assert.equal(snapshot.reviewContext.feedback, null);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.reviewContext.frozenContract.checks));
    assert.throws(() => Object.assign(snapshot.reviewContext, { gold: true }), TypeError);
    assert.equal(snapshot.reviewContext.contextSource, 'Hand-authored development fixture, not prior autonomous role execution');
    for (const label of VERIFIER_DEV_EXPECTATIONS.filter(item => item.defect)) assert.equal(JSON.stringify(snapshot).includes(label.defect!), false);
  }
  assert.throws(() => verifierDevReviewSnapshot('DEV-01', { version: 'production-acceptance-v3', hash: 'not-a-hash' }));
  assert.throws(() => verifierDevReviewSnapshot('H01' as 'DEV-01', { version: 'production-acceptance-v3', hash: '0'.repeat(64) }));
});

test('current implement rubric and exact Jev request serialization remain within unchanged context byte ceilings', t => {
  for (const pool of VERIFIER_DEV_CORPUS) {
    const snapshot = review(pool); const before = JSON.stringify(snapshot);
    const rubric = productionPhaseRubric(snapshot.phase, snapshot.capability)!;
    assert.equal(rubric.stage, 'implementation');
    const jev = buildJevCandidateRequest('jev-1.13.0', snapshot);
    assert.deepEqual(jev.state.candidates, snapshot.candidates);
    assert.equal(jev.state.phaseReview?.version, rubric.version);
    assert.equal(jev.state.phaseReview?.phase, 'implement');
    const stateBytes = bytes(jev.state);
    const maxQuestionBytes = Math.max(...Object.values(jev.questions).map(question => bytes(question)));
    const totalBytes = bytes(jev);
    assert.ok(stateBytes + maxQuestionBytes <= 32000, `${pool.id} Jev per-question limit`);
    assert.ok(totalBytes <= 64000, `${pool.id} Jev overall limit`);
    const system = phaseVerifierSystemPrompt(rubric);
    const validationContract = { planningLoopVersion: PRODUCTION_PLANNING_LOOP_VERSION, reviewContextVersion: REVIEW_CONTEXT_PROJECTION_VERSION, harnessPromptTransportVersion: HARNESS_PROMPT_TRANSPORT_VERSION, harnessJsonOutputVersion: HARNESS_JSON_OUTPUT_VERSION, responseFormatPolicy: 'deepseek-json-object-other-prompt-only', semanticsVersion: ACCEPTANCE_SEMANTICS_VERSION, jevRequestLayoutVersion: JEV_REQUEST_LAYOUT_VERSION, coverage: snapshot.reviewContext.coverageContract };
    const criteria = { version: rubric.version, validationContract, compactOutputPolicy: VERIFIER_COMPACT_OUTPUT_POLICY, repairPolicyVersion: PRODUCTION_REPAIR_POLICY_VERSION, phase: snapshot.phase, phaseReview: rubric, acceptance: snapshot.acceptance, goal: snapshot.goal, frozenHash: snapshot.frozenHash, dimensions: rubric.dimensions, minimumOrdinalScore: 3, scale: '0..5 ordinal, not calibrated probability', candidateIds: snapshot.candidates.map(candidate => candidate.id) };
    const prompt = JSON.stringify({ criteria, state: { reviewContext: snapshot.reviewContext }, candidates: snapshot.candidates, outputContract: outputContractSnapshot(verifierSchema) });
    assert.ok(bytes(`${system}\n${prompt}`) <= 60000, `${pool.id} logical LLM system/user limit`);
    assert.equal(JSON.stringify(snapshot), before);
    assert.equal(JSON.stringify(jev).includes('expectedPass'), false);
    t.diagnostic(JSON.stringify({ poolId: pool.id, requestKind: 'offline-serialized-not-dispatched', stateBytes, maxQuestionBytes, perQuestionBytes: stateBytes + maxQuestionBytes, totalBytes, logicalLlmPromptBytes: bytes(`${system}\n${prompt}`), phase: snapshot.phase, rubricVersion: rubric.version }));
  }
});

test('request-denying Chromium independently validates all six development labels through real interactions', { timeout: 180000 }, async t => {
  // Outer-authored fixture Oracle only: no model invocation or autonomous delivery.
  for (const pool of VERIFIER_DEV_CORPUS) for (const candidate of pool.candidates) {
    const expectation = VERIFIER_DEV_EXPECTATIONS.find(item => item.poolId === pool.id && item.candidateId === candidate.id)!;
    const checksHash = hash(pool.checks); const sourceHash = createHash('sha256').update(candidate.value.html, 'utf8').digest('hex');
    const actual = await runGate(candidate.value.html, structuredClone(pool.checks));
    t.diagnostic(JSON.stringify({ corpusVersion: VERIFIER_DEV_CORPUS_VERSION, oracleVersion: VERIFIER_DEV_ORACLE_VERSION, poolId: pool.id, candidateId: candidate.id, evidenceKind: 'outer-authored-development-oracle', expectedPass: expectation.expectedPass, actual, checksHash, sourceHash, modelRequests: 0 }));
    assert.equal(actual.failureKind, undefined, `${pool.id}/${candidate.id}: infrastructure failure is not a bad label`);
    assert.equal(actual.passed, expectation.expectedPass, `${pool.id}/${candidate.id}: actual Oracle disagrees with construction label`);
    assert.equal(hash(pool.checks), checksHash);
    assert.equal(createHash('sha256').update(candidate.value.html, 'utf8').digest('hex'), sourceHash);
  }
});
