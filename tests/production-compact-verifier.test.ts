import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVerifiedDecision, verifierSchema } from '../server/production/contracts.js';
import { phaseVerifierSystemPrompt, productionPhaseRubric, VERIFIER_COMPACT_OUTPUT_POLICY } from '../shared/production-verifier-rubric.js';
import { productionCoverageContract } from '../shared/production-coverage.js';

test('compact prompt asks for short evidence without relaxing strict host lengths, candidate IDs or scores', () => {
  const prompt = phaseVerifierSystemPrompt(productionPhaseRubric('acceptance', 'camera-scene-v1')!);
  assert.match(prompt, /每候选reason目标≤300字符/);
  assert.match(prompt, /总reason目标≤400字符/);
  assert.match(prompt, /不会截断或修复非法输出/);
  assert.match(prompt, /"decision":"abstain","selectedCandidateId":null/);
  assert.equal(VERIFIER_COMPACT_OUTPUT_POLICY.hostCandidateReasonMaximum, 1000);
  const decision = { decision: 'accept', selectedCandidateId: 'a', scores: [{ candidateId: 'a', score: 3, reason: 'a'.repeat(1000) }], reason: 'a'.repeat(1500) };
  assert.equal(parseVerifiedDecision(decision, ['a']).decision, 'accept');
  assert.equal(verifierSchema.safeParse({ ...decision, scores: [{ ...decision.scores[0], reason: 'a'.repeat(1001) }] }).success, false);
  assert.equal(verifierSchema.safeParse({ ...decision, reason: 'a'.repeat(1501) }).success, false);
  assert.throws(() => parseVerifiedDecision({ ...decision, scores: [{ ...decision.scores[0], score: 2 }] }, ['a']));
  assert.throws(() => parseVerifiedDecision(decision, ['old-id']));
  assert.throws(() => parseVerifiedDecision({ ...decision, scores: [decision.scores[0], { candidateId: 'b', score: 4, reason: 'better' }] }, ['a', 'b']));
  assert.equal(parseVerifiedDecision({ ...decision, decision: 'abstain', selectedCandidateId: null }, ['a']).decision, 'abstain');
});

test('coverage map is an obligation, not a fake success; physical acceptance and mapping self-consistency remain separate', () => {
  const camera = productionCoverageContract('camera-scene-v1');
  assert.equal(camera.owners.roleCss.required, true);
  assert.match(camera.owners.roleCss.scope, /#gesture-map/);
  assert.match(camera.owners.hostSchema.scope, /does NOT prove/);
  assert.match(camera.owners.platformMandatoryGate.scope, /Must execute AND pass/);
  assert.match(camera.owners.platformEngineering!.scope, /Not executed by per-run/);
  assert.match(camera.owners.physicalAcceptance!.scope, /full requirement stays false/);
  assert.equal(JSON.stringify(camera).includes('"passed":true'), false);
  const offline = productionCoverageContract('offline-single-html');
  assert.match(offline.owners.roleCss.scope, /All in-scope business behavior/);
});
