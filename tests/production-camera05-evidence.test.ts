import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productionReport, productionRequestCounts } from '../server/production/index.js';
import { researchSchema, parseVerifiedDecision } from '../server/production/contracts.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Read-only replay of an archived real failed attempt, not a new execution,
// provider request, delivery success or physical-camera verification.
const runId = 'b1a44700-26a2-4479-9aad-69891bfdf568';
const frozenCommit = '6c7fa4df9c9defd0f8f5bc7bbc39c556a5e12c93';
const directory = new URL('../docs/production/experiments/CAMERA-05/', import.meta.url);
const fileHashes = {
  'run.json': '61cb1e48477e0bbf4bc28e7e53cf5e55bce01c5a0b70e258f3796c9dc91e0d8f',
  'evidence.json': 'c8c7c2f78ce5354e8dd7544fe1489344adea40f454ed59b13e360515589bf5d2',
  'delivery-manifest.json': '958b3af5c977c91018e31000901595a4b95fff0b66f243b5ac930bf4b95a269f',
  'platform-metadata.json': '928e1e97361750456e0abe106e1b11c04a19ed73e11fa580e7efa8efaea7224d',
};
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));

test('CAMERA-05 frozen bytes preserve the failed attempt and never invent a freeze, implementation, Gate or scene', () => {
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(createHash('sha256').update(read(name as keyof typeof fileHashes)).digest('hex'), expected, `${name} historical bytes must remain unchanged`);
  const run = loadRun(); const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.input.requirement.id, 'CAMERA-05'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.mode, 'live'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 39567);
  assert.equal(run.frozenContract, undefined); assert.equal(run.gate, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.equal(run.outputs.some(output => output.role === 'tester' || output.role === 'developer'), false);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, frozenCommit); assert.equal(manifest.status, 'failed');
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.trustedPreviewSha256, null);
  assert.equal(manifest.frozenContract, undefined); assert.deepEqual(manifest.usage, run.usage);
  assert.deepEqual(manifest.cameraVerification, run.cameraVerification);
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit); assert.equal(metadata.build.sourceClean, true);
  for (const field of ['boundedScenePassed', 'visionModelVerified', 'physicalCameraVerified', 'fullRequirementVerified'] as const) assert.equal(run.cameraVerification![field], false);
  assert.match(run.error!, /malformed prompt variable reference/); assert.match(run.error!, /\{\{particleCount\}\}/);
});

test('CAMERA-05 distinguishes eight Harness intents from seven Harness POSTs plus three uncertain Jev POSTs', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.calls.length, 8); assert.equal(run.calls.every(call => call.executionSource === 'harness'), true);
  assert.deepEqual(run.calls.map(call => call.providerRequests!.requests), [1, 1, 1, 1, 1, 1, 1, 0]);
  const tester = run.calls.at(-1)!;
  assert.equal(tester.role, 'tester'); assert.equal(tester.phase, 'acceptance'); assert.equal(tester.rawOutput, '');
  assert.equal(tester.providerRequests!.requests, 0); assert.equal(tester.providerRequests!.status, null);
  assert.equal(tester.providerRequests!.complete, false); assert.equal(tester.usage.inputTokens, null); assert.equal(tester.usage.estimatedCost, null);
  assert.equal(run.jevCalls!.length, 3);
  assert.deepEqual(run.jevCalls!.map(call => call.phase), ['product', 'research', 'think-design']);
  for (const call of run.jevCalls!) {
    assert.equal(call.evaluation.status, 'uncertain'); assert.equal(call.evaluation.providerRequests, 1);
    assert.equal(call.evaluation.selectedCandidateId, null); assert.equal(call.evaluation.usage.complete, true);
  }
  const counts = productionRequestCounts(run);
  assert.equal(counts.harnessInvocations, 8); assert.equal(counts.knownHarnessProviderRequests, 7);
  assert.equal(counts.jevProviderRequests, 3); assert.equal(counts.actualProviderRequests, 10);
  assert.equal(counts.knownProviderRequests, 10); assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(JSON.stringify(run), before, 'Accounting is read-only and cannot backfill unknown usage to zero');
});

test('CAMERA-05 retains the rejected researcher JSON and one internal regeneration before selecting its valid replacement', () => {
  const run = loadRun(); const researchers = run.calls.filter(call => call.role === 'researcher');
  assert.equal(researchers.length, 2); assert.throws(() => JSON.parse(researchers[0].rawOutput), SyntaxError);
  assert.match(researchers[0].error!, /候选契约拒绝/); assert.notEqual(researchers[0].selected, true);
  assert.equal(researchers[1].selected, true); assert.equal(researchSchema.safeParse(JSON.parse(researchers[1].rawOutput)).success, true);
  assert.equal(run.repairPolicyVersion, 'production-global-repair-v1'); assert.equal(run.repairs, 1); assert.equal(run.repairHistory!.length, 1);
  const repair = run.repairHistory![0];
  assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.role, 'researcher'); assert.equal(repair.phase, 'research'); assert.equal(repair.attempt, 1);
  assert.equal(repair.frozenHash, null); assert.deepEqual(repair.rejectedCandidateIds, [researchers[0].candidateId]);
  const regeneration = JSON.parse(researchers[1].userPrompt).context.regeneration;
  assert.equal(regeneration.attempt, 1); assert.equal(regeneration.frozenHash, null);
  assert.deepEqual(regeneration.rejectedCandidateIds, repair.rejectedCandidateIds);
  assert.equal(run.outputs.find(output => output.role === 'researcher')!.selectedCandidateId, researchers[1].candidateId);
  assert.equal(run.outputs.some(output => output.selectedCandidateId === researchers[0].candidateId), false);
});

test('CAMERA-05 has three compact legal uncertain-fallback reviews, not a passed delivery or a rewritten Jev decision', () => {
  const run = loadRun(); const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.equal(verifiers.length, 3);
  assert.deepEqual(verifiers.map(call => call.phase), ['product:verify', 'research:verify', 'think-design:verify']);
  for (const call of verifiers) {
    const source = run.jevCalls!.find(jev => jev.id === call.sourceJevCallId)!;
    assert.ok(source); assert.equal(source.evaluation.status, 'uncertain');
    assert.equal(call.verificationEngine, 'jev-llm-fallback');
    const raw = JSON.parse(call.rawOutput);
    assert.equal(raw.reason.length < 1000, true);
    assert.equal(raw.scores.every((score: { reason: string }) => score.reason.length < 1000), true);
    assert.equal(parseVerifiedDecision(raw, source.evaluation.requestSnapshot!.state.candidates.map(candidate => candidate.id)).decision, 'accept');
    const review = run.verifications.find(value => value.sourceJevCallId === source.id && value.engine === 'jev-llm-fallback')!;
    assert.equal(review.decision, 'accept');
  }
  const report = productionReport([run]);
  assert.equal(report.metrics.realModelPassed, 0); assert.equal(report.metrics.goodProductRate, 0);
  assert.equal(report.cameraAcceptanceMetrics.boundedScenePassed, 0); assert.equal(report.cameraAcceptanceMetrics.physicalCameraVerified, 0); assert.equal(report.cameraAcceptanceMetrics.fullRequirementVerified, 0);
});

test('CAMERA-05 keeps aggregate usage unknown while separately reproducing the observed nonzero subtotal', () => {
  const run = loadRun();
  assert.deepEqual(run.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  const usages = [...run.calls.map(call => call.usage), ...run.jevCalls!.map(call => call.evaluation.usage)];
  assert.equal(usages.filter(usage => usage.inputTokens === null || usage.outputTokens === null || usage.estimatedCost === null).length, 1);
  const known = usages.filter(usage => usage.inputTokens !== null && usage.outputTokens !== null && usage.estimatedCost !== null);
  assert.equal(known.length, 10);
  assert.equal(known.reduce((sum, usage) => sum + usage.inputTokens!, 0), 61317);
  assert.equal(known.reduce((sum, usage) => sum + usage.outputTokens!, 0), 4842);
  assert.ok(Math.abs(known.reduce((sum, usage) => sum + usage.estimatedCost!, 0) - 0.01776294) < 1e-12);
  const reported = productionReport([run]).metrics.perRun[0];
  assert.deepEqual(reported.usage, run.usage); assert.equal(reported.actualProviderRequests, 10);
});
