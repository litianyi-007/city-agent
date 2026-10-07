import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Pure replay of a preserved real failure, not a new execution, model-quality
// experiment, autonomous delivery or physical-camera acceptance.
const runId = '858c71f1-0a30-4943-ae4b-8067c77d9d8f';
const frozenCommit = 'f30336381ed219b7738a5891e911da565aa1aaab';
const directory = new URL('../docs/production/experiments/CAMERA-07/', import.meta.url);
const fileHashes = {
  'run.json': 'bb2cb22cad787d1fedc332b690983730733317c09d30bef93d931f7fb3609f55',
  'evidence.json': '954f411217e0050f07eba66ba908570121c257b300f75949a43856bd234a8139',
  'delivery-manifest.json': '0a570c6aaebc4f71af97358401098d13a75cc369f23a272444a6ad6cace46018',
  'platform-metadata.json': '4bf9cf11bd189c664c4325fb70a9139e702eb20b0e7d2f496c6c36a3548ec139',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));

test('CAMERA-07 immutable receipt preserves its pre-test planning failure and original configuration', () => {
  for (const [name, expected] of Object.entries(fileHashes)) {
    assert.equal(createHash('sha256').update(read(name as keyof typeof fileHashes)).digest('hex'), expected, `${name} historical bytes must remain unchanged`);
  }
  const run = loadRun();
  const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 30299);
  assert.equal(run.input.mode, 'live'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.requirement.id, 'CAMERA-07'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.capability, 'camera-scene-v1');
  assert.equal(run.frozenContract, undefined); assert.equal(run.gate, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.calls.some(call => call.role === 'tester' || call.role === 'developer'), false);
  assert.deepEqual(run.outputs.map(output => output.phase), ['product', 'research', 'think-design']);
  assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []); assert.deepEqual(run.interventions, []);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, frozenCommit);
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.durationMs, 30299);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.trustedPreviewSha256, null);
  assert.equal(manifest.frozenContract, undefined); assert.deepEqual(manifest.usage, run.usage);
  assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.validationContractHash, '4efd1094f95d470a19c418e0433e3cfcdab4ecf747e9e39ddb8e47edd0488201');
  assert.equal(run.validationContract!.reviewContextVersion, 'production-review-context-v1');
  assert.equal(run.validationContract!.harnessPromptTransportVersion, 'harness-literal-prompt-v1');
  assert.equal(manifest.promptVersion, 'production-camera-scene-v6');
  assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v4');
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit);
  assert.equal(metadata.build.sourceClean, true);
  assert.equal(manifest.cameraRuntime.gateSourceHash, '9d4826052d66afe5a3e8e4bbb2a0278520439ebd90b9c9b549103e09fd1e4345');
  assert.deepEqual(manifest.cameraVerification, run.cameraVerification);
  for (const field of ['boundedScenePassed', 'visionModelVerified', 'physicalCameraVerified', 'fullRequirementVerified'] as const) assert.equal(run.cameraVerification![field], false);
  assert.match(run.error!, /^初始计划尚未批准，项目经理revise：/); assert.equal(manifest.failure, run.error);
});

test('CAMERA-07 keeps nine observed HTTP attempts distinct from later unexecuted pipeline stages', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.calls.length, 6); assert.equal(run.calls.every(call => call.executionSource === 'harness'), true);
  assert.deepEqual(run.calls.map(call => call.role), ['product', 'verifier', 'researcher', 'verifier', 'project-manager', 'verifier']);
  for (const call of run.calls) {
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.transportComplete, true); assert.equal(call.providerRequests!.protocolComplete, true);
    assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true);
    assert.equal(call.providerRequests!.complete, true); assert.ok(call.rawOutput.length > 0);
  }
  assert.equal(run.jevCalls!.length, 3);
  assert.deepEqual(run.jevCalls!.map(call => call.evaluation.providerRequests), [1, 1, 1]);
  const counts = projectProductionLedger(run).requests;
  assert.equal(counts.callRecords, 6); assert.equal(counts.budgetRecords, 9); assert.equal(counts.harnessInvocations, 6);
  assert.equal(counts.knownHarnessProviderRequests, 6); assert.equal(counts.jevProviderRequests, 3);
  assert.equal(counts.actualProviderRequests, 9); assert.equal(counts.knownProviderRequests, 9);
  assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(JSON.stringify(run), before);
});

test('CAMERA-07 accepted a legal revise plan but did not execute its product-owned design tasks', () => {
  const run = loadRun();
  const research = run.outputs.find(output => output.role === 'researcher')!.value as { unknowns: string[] };
  const blocking = research.unknowns.filter(value => value.startsWith('blocking:'));
  assert.equal(blocking.length, 2);
  assert.match(blocking[0], /title.*countPerObject\/snowCount/);
  assert.match(blocking[1], /#gesture-map/);
  const pmCall = run.calls.find(call => call.role === 'project-manager')!;
  const plan = JSON.parse(pmCall.rawOutput) as { decision: string; summary: string; tasks: Array<{ owner: string; description: string }> };
  assert.equal(plan.decision, 'revise'); assert.match(plan.summary, /用户\/产品未指定的自由细节/);
  assert.equal(plan.tasks.filter(task => task.owner === 'product').length, 3);
  assert.match(plan.tasks[0].description, /title/); assert.match(plan.tasks[1].description, /count/); assert.match(plan.tasks[2].description, /#gesture-map/);
  assert.equal(pmCall.selected, true);
  const selectedPlan = run.outputs.find(output => output.phase === 'think-design')!;
  assert.deepEqual(selectedPlan.value, plan);
  const review = run.verifications.find(value => value.phase === 'think-design' && value.engine === 'jev-llm-protocol-fallback')!;
  assert.equal(review.decision, 'accept'); assert.equal(review.selectedCandidateId, pmCall.candidateId);
  assert.match(review.reason, /产品先定稿方可冻结/);
  assert.equal(run.calls.filter(call => call.role === 'product').length, 1, 'The historical controller did not perform the requested product handoff');
  assert.equal(run.repairs, 0, 'The failed attempt cannot be rewritten as a planning-loop repair or successful handoff');
});

test('CAMERA-07 retains one uncertain and two arithmetic-error Jev sources, each followed by only one independent LLM review', () => {
  const run = loadRun(); const sources = run.jevCalls!;
  assert.deepEqual(sources.map(call => call.phase), ['product', 'research', 'think-design']);
  assert.deepEqual(sources.map(call => call.evaluation.status), ['uncertain', 'error', 'error']);
  assert.deepEqual(sources.map(call => call.evaluation.errorKind), [undefined, 'arithmetic-drift', 'arithmetic-drift']);
  const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.deepEqual(verifiers.map(call => call.verificationEngine), ['jev-llm-fallback', 'jev-llm-protocol-fallback', 'jev-llm-protocol-fallback']);
  for (const [index, source] of sources.entries()) {
    assert.equal(source.evaluation.usage.complete, true); assert.equal(source.evaluation.selectedCandidateId, null);
    assert.equal(verifiers[index].sourceJevCallId, source.id);
    assert.equal(run.calls.filter(call => call.sourceJevCallId === source.id).length, 1);
    if (source.evaluation.errorKind === 'arithmetic-drift') {
      assert.deepEqual(source.evaluation.scores, []); assert.equal(source.evaluation.choice, null);
      assert.deepEqual(source.evaluation.diagnostics, [{ code: 'score-concentration-drift', answerId: 'c0_consistency' }, { code: 'score-concentration-drift', answerId: 'c0_scope' }]);
    }
  }
  assert.equal(run.status, 'failed');
});

test('CAMERA-07 complete declared-price usage is 53513 input, 3844 output and 0.014684256 USD, not a provider invoice', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.usage.complete, true); assert.equal(run.usage.currency, 'USD');
  assert.equal(run.usage.inputTokens, 53513); assert.equal(run.usage.outputTokens, 3844);
  assert.ok(Math.abs(run.usage.estimatedCost! - 0.014684256) < 1e-12);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.inputTokens!, 0), 32595);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.outputTokens!, 0), 3356);
  assert.ok(Math.abs(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0) - 0.0138057) < 1e-12);
  assert.equal(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.inputTokens!, 0), 20918);
  assert.equal(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.outputTokens!, 0), 488);
  assert.ok(Math.abs(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.estimatedCost!, 0) - 0.000878556) < 1e-12);
  const usage = projectProductionLedger(run).usage;
  assert.equal(usage.entries, 9); assert.equal(usage.unknownUsageEntries, 0); assert.equal(usage.currencyMismatchEntries, 0);
  assert.deepEqual(usage.inputTokens, { knownSubtotal: 53513, reportedEntries: 9, unknownEntries: 0, overflow: false });
  assert.deepEqual(usage.outputTokens, { knownSubtotal: 3844, reportedEntries: 9, unknownEntries: 0, overflow: false });
  assert.ok(Math.abs(usage.estimatedCost.knownSubtotal! - run.usage.estimatedCost!) < 1e-12);
  assert.equal(JSON.stringify(run), before);
});
