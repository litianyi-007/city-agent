import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import { planSchema, productSchema, researchSchema, testsSchema, verifierSchema, parseVerifiedDecision } from '../server/production/contracts.js';
import { cameraSceneCodeSchema, cameraSceneSchema } from '../shared/camera-scene-schema.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Pure, free replay of archived real-model bounded scene delivery. This test
// performs no browser/model/camera execution and does not certify full delivery.
const runId = '789e1e5f-a16d-41de-828f-55d089ce2660';
const frozenCommit = '24256f96165f0be3156be037a2fea42492e31117';
const directory = new URL('../docs/production/experiments/CAMERA-09/', import.meta.url);
const fileHashes = {
  'run.json': '2aa51535623e6b9e5458b8e737a3ee4848db1930fd887ee15bf9c5b83da291c7',
  'evidence.json': '51076309392aa83cc2963c53cadc710f8b9459395c661c9fd8a3b39b8ac8e667',
  'delivery-manifest.json': '4a4f1bc4d619bf8df231a455db53ad2a72921401df6f1fe53d01881b20bbcac3',
  'platform-metadata.json': 'b8ffb1e26eefe2070f23bc5664356dab62bcf1b18b941ccb22912a1e1d99c25f',
  'scene.json': 'a439568ad8d89e3e19bf790e0939b05e636d72e8cf1b497db014710fec6abba6',
  'camera-runtime-manifest.json': 'c96184d7de26924d2d13ca3e71c1a77da268c14d104f05297d63eae948017e10',
  'index.html.txt': 'a1c0899d948022c9a416402f772f47082823f766fd42961262553b7e0f575a24',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => digest(JSON.stringify(value));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test('CAMERA-09 retains seven original SHA receipts, clean source and unchanged CAMERA08 input except its ID', () => {
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(digest(read(name as keyof typeof fileHashes)), expected, `${name}: immutable archived bytes`);
  const run = loadRun(); const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  const previous: ProductionRun = JSON.parse(readFileSync(new URL('../docs/production/experiments/CAMERA-08/run.json', import.meta.url), 'utf8'));
  assert.deepEqual(evidence, run, 'Pretty evidence and API run are the same recorded data, not rewritten execution');
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.status, 'completed'); assert.equal(run.durationMs, 76602);
  assert.equal(run.input.mode, 'live'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.requirement.kind, 'illustrative'); assert.equal(run.input.requirement.id, 'CAMERA-09');
  assert.equal(run.input.capability, 'camera-scene-v1'); assert.equal(run.input.candidateCount, 1);
  assert.deepEqual(run.input, { ...previous.input, requirement: { ...previous.input.requirement, id: 'CAMERA-09' } });
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit);
  assert.equal(metadata.build.sourceClean, true); assert.ok(Date.parse(metadata.build.builtAt) < Date.parse(run.createdAt));
  assert.equal(metadata.capabilities.find((item: { id: string }) => item.id === 'camera-scene-v1').assets.ready, true);
  assert.equal(run.error, undefined);
});

test('CAMERA-09 preserves twelve legal original role JSON responses and twelve native Harness plus six Jev HTTP observations', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  const schemas = { product: productSchema.extend({ scope: z.literal('camera-scene-v1') }), researcher: researchSchema, 'project-manager': planSchema, tester: testsSchema, developer: cameraSceneCodeSchema, verifier: verifierSchema };
  assert.equal(run.calls.length, 12); assert.equal(new Set(run.calls.map(call => call.role)).size, 6);
  assert.deepEqual(run.calls.map(call => call.phase), ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design:verify', 'acceptance', 'acceptance:verify', 'implement', 'implement:verify', 'feedback-0', 'feedback-0:verify']);
  for (const call of run.calls) {
    assert.equal(call.executionSource, 'harness'); assert.equal(call.model.provider, 'deepseek'); assert.equal(call.model.modelId, 'deepseek-flash');
    assert.equal(call.promptVersion, 'production-camera-scene-v7'); assert.equal(call.error, undefined);
    assert.ok(call.rawOutput.trim().startsWith('{') && call.rawOutput.trim().endsWith('}'));
    schemas[call.role].parse(JSON.parse(call.rawOutput));
    assert.equal(JSON.parse(call.userPrompt).outputContract.version, 'production-output-contract-v1');
    assert.deepEqual(call.responseFormat, { version: 'harness-json-output-v1', mode: 'json-object', evidence: 'wire-observed' });
    assert.deepEqual(call.providerRequests!.responseFormat, call.responseFormat);
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200); assert.equal(call.providerRequests!.deniedRequests, 0);
    assert.equal(call.providerRequests!.transportComplete, true); assert.equal(call.providerRequests!.protocolComplete, true);
    assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true); assert.equal(call.providerRequests!.complete, true);
  }
  assert.equal(run.jevCalls!.length, 6);
  for (const call of run.jevCalls!) { assert.equal(call.evaluation.providerRequests, 1); assert.equal(call.evaluation.httpStatus, 200); assert.equal(call.evaluation.usage.complete, true); }
  const counts = projectProductionLedger(run).requests;
  assert.equal(counts.callRecords, 12); assert.equal(counts.harnessInvocations, 12); assert.equal(counts.budgetRecords, 18);
  assert.equal(counts.knownHarnessProviderRequests, 12); assert.equal(counts.jevProviderRequests, 6);
  assert.equal(counts.actualProviderRequests, 18); assert.equal(counts.knownProviderRequests, 18); assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(JSON.stringify(run), before, 'History projection cannot mutate an archived run');
});

test('CAMERA-09 tester acceptance is frozen before development and its exact checks and versioned payload retain their lineage', () => {
  const run = loadRun(); const frozen = run.frozenContract!;
  const tester = run.calls.find(call => call.role === 'tester')!; const developer = run.calls.find(call => call.role === 'developer')!;
  const testerValue = testsSchema.parse(JSON.parse(tester.rawOutput));
  assert.equal(tester.selected, true); assert.equal(developer.selected, true); assert.equal(frozen.checks.length, 6);
  assert.deepEqual(frozen.checks, testerValue.checks);
  assert.equal(frozen.hash, 'ab03140589b8e71cd30783b51e2d25823855a36891f6cb00376f5d651656e77a');
  assert.equal(frozen.validationContractHash, 'f63a9e23226f6858806a4cc8dda2d06dac65b1244e13cca3e1887bfcd0629036');
  assert.equal(frozen.validationContractHash, jsonHash(run.validationContract));
  assert.equal(frozen.requirementHash, jsonHash({ requirement: run.input.requirement, brief: run.input.brief, cameraBusinessConstraints: run.input.cameraBusinessConstraints }));
  assert.equal(frozen.hash, jsonHash({ validationContract: run.validationContract, requirement: run.input.requirement, brief: run.input.brief, cameraBusinessConstraints: run.input.cameraBusinessConstraints, checks: frozen.checks, capability: run.input.capability, runtimeVersion: frozen.runtimeVersion, runtimeHash: frozen.runtimeHash, mandatoryChecksVersion: frozen.mandatoryChecksVersion }));
  assert.ok(Date.parse(tester.finishedAt!) < Date.parse(frozen.frozenAt));
  const acceptanceReview = run.calls.find(call => call.phase === 'acceptance:verify')!;
  assert.ok(Date.parse(acceptanceReview.finishedAt!) < Date.parse(frozen.frozenAt));
  assert.ok(Date.parse(frozen.frozenAt) < Date.parse(developer.startedAt));
  const freeze = run.events.filter(event => event.phase === 'freeze'); assert.equal(freeze.length, 1); assert.equal(freeze[0].time, frozen.frozenAt);
  assert.deepEqual(JSON.parse(developer.userPrompt).context.frozenContract, frozen);
  assert.deepEqual(run.outputs.find(output => output.role === 'tester')!.value, testerValue);
  assert.deepEqual(JSON.parse(run.calls.find(call => call.phase === 'feedback-0')!.userPrompt).context.frozenContract, frozen);
  assert.equal(run.validationContract!.harnessJsonOutputVersion, 'harness-json-output-v1');
  assert.equal(run.validationContract!.responseFormatPolicy, 'deepseek-json-object-other-prompt-only');
});

test('CAMERA-09 delivers exact pretty scene bytes and eleven recorded synthetic checks without repairs or full camera certification', () => {
  const run = loadRun(); const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  const runtime = JSON.parse(read('camera-runtime-manifest.json').toString('utf8'));
  const scene = cameraSceneSchema.parse(JSON.parse(read('scene.json').toString('utf8')));
  assert.equal(read('scene.json').toString('utf8'), JSON.stringify(scene, null, 2));
  assert.deepEqual(scene, JSON.parse(run.calls.find(call => call.role === 'developer')!.rawOutput).scene);
  assert.equal(manifest.source, 'scene.json'); assert.equal(manifest.sourceSha256, digest(read('scene.json')));
  assert.equal(runtime.sceneSha256, jsonHash(scene), 'Compact logical scene hash is distinct from pretty source bytes');
  assert.notEqual(runtime.sceneSha256, manifest.sourceSha256);
  assert.equal(manifest.trustedPreviewSha256, digest(read('index.html.txt')));
  assert.deepEqual(manifest.frozenContract, run.frozenContract); assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.platformCommit, frozenCommit); assert.equal(manifest.status, 'completed'); assert.equal(manifest.failure, null);
  assert.equal(manifest.promptVersion, 'production-camera-scene-v7'); assert.equal(manifest.harnessJsonOutputVersion, 'harness-json-output-v1');
  assert.deepEqual(manifest.responseFormats, run.calls.map(call => ({ callId: call.id, executionSource: call.executionSource, ...call.responseFormat })));
  assert.equal(run.gateHistory.length, 1); assert.deepEqual(run.gateHistory[0], run.gate); assert.equal(run.gate!.passed, true);
  assert.equal(run.gate!.checks.length, 11); assert.equal(run.gate!.checks.every(check => check.passed), true);
  assert.equal(run.gate!.evidenceScope, 'scene-behavior-synthetic');
  assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []); assert.deepEqual(run.interventions, []);
  assert.equal(JSON.parse(run.calls.find(call => call.phase === 'feedback-0')!.rawOutput).decision, 'proceed');
  assert.equal(run.cameraVerification!.boundedScenePassed, true);
  for (const field of ['visionModelVerified', 'physicalCameraVerified', 'fullRequirementVerified'] as const) assert.equal(run.cameraVerification![field], false);
  assert.deepEqual(runtime.cameraVerification, run.cameraVerification); assert.deepEqual(manifest.cameraVerification, run.cameraVerification);
  // Compare only archived versions/receipt, never require historical Gate hash
  // to equal the source at current tip after later legitimate executor upgrades.
  assert.equal(runtime.gateSourceHash, '9d4826052d66afe5a3e8e4bbb2a0278520439ebd90b9c9b549103e09fd1e4345');
  assert.equal(runtime.gateSourceHash, manifest.cameraRuntime.gateSourceHash);
  assert.equal(runtime.hash, run.frozenContract!.runtimeHash); assert.equal(runtime.mandatoryChecksVersion, 'camera-scene-behavior-v2');
  assert.equal(scene.objects.reduce((sum, object) => sum + object.count, scene.snowCount), 1420);
  assert.deepEqual(scene.mappings, { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' });
  const terminal = [run].filter(item => item.evidenceKind === 'real-model' && !['queued', 'running'].includes(item.status));
  const fullGood = terminal.filter(item => item.status === 'completed' && item.gate?.passed && (item.input.capability !== 'camera-scene-v1' || Boolean(item.cameraVerification?.fullRequirementVerified)));
  assert.equal(terminal.length, 1); assert.equal(fullGood.length, 0, 'Bounded scene delivery does not satisfy the complete camera requirement');
});

test('CAMERA-09 retains four uncertain and two arithmetic Jev results, six independent upgrades and complete declared-price accounting', () => {
  const run = loadRun(); const before = JSON.stringify(run); const sources = run.jevCalls!; const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.deepEqual(sources.map(call => call.evaluation.status), ['uncertain', 'uncertain', 'error', 'uncertain', 'uncertain', 'error']);
  assert.deepEqual(sources.map(call => call.evaluation.errorKind), [undefined, undefined, 'arithmetic-drift', undefined, undefined, 'arithmetic-drift']);
  assert.equal(verifiers.length, 6);
  for (const source of sources) {
    assert.equal(source.evaluation.policyVersion, 'jev-candidate-v3'); assert.equal(source.evaluation.selectedCandidateId, null);
    assert.equal(source.evaluation.modelIdRequested, 'jev-1.13.0'); assert.equal(source.evaluation.modelIdReturned, 'jev-1.13.0');
    const calls = verifiers.filter(call => call.sourceJevCallId === source.id); assert.equal(calls.length, 1);
    const verifier = calls[0]; const expectedEngine = source.evaluation.status === 'uncertain' ? 'jev-llm-fallback' : 'jev-llm-protocol-fallback';
    assert.equal(verifier.verificationEngine, expectedEngine);
    const decision = parseVerifiedDecision(JSON.parse(verifier.rawOutput), source.evaluation.requestSnapshot!.state.candidates.map(candidate => candidate.id));
    assert.equal(decision.decision, 'accept'); assert.equal(decision.scores.length, 1);
    const review = run.verifications.find(item => item.sourceJevCallId === source.id)!;
    assert.equal(review.engine, expectedEngine); assert.deepEqual(review.scores, decision.scores); assert.equal(review.selectedCandidateId, decision.selectedCandidateId);
    assert.equal(run.verifications.find(item => item.phase === source.phase && item.engine === 'jev')!.decision, 'abstain');
    if (source.evaluation.status === 'error') { assert.deepEqual(source.evaluation.scores, []); assert.equal(source.evaluation.choice, null); }
  }
  assert.deepEqual(run.usage, { inputTokens: 143680, outputTokens: 8715, estimatedCost: 0.037964111999999994, currency: 'USD', complete: true });
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.inputTokens!, 0), 87544);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.outputTokens!, 0), 7786);
  near(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0), 0.0356064);
  assert.equal(sources.reduce((sum, call) => sum + call.evaluation.usage.inputTokens!, 0), 56136);
  assert.equal(sources.reduce((sum, call) => sum + call.evaluation.usage.outputTokens!, 0), 929);
  near(sources.reduce((sum, call) => sum + call.evaluation.usage.estimatedCost!, 0), 0.002357712);
  for (const call of run.calls) near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.30 + call.usage.outputTokens! * 1.20) / 1e6);
  for (const call of sources) near(call.evaluation.usage.estimatedCost!, call.evaluation.usage.inputTokens! * 0.042 / 1e6);
  const usage = projectProductionLedger(run).usage;
  assert.equal(usage.entries, 18); assert.equal(usage.unknownUsageEntries, 0);
  assert.equal(usage.inputTokens.knownSubtotal, 143680); assert.equal(usage.outputTokens.knownSubtotal, 8715);
  near(usage.estimatedCost.knownSubtotal!, 0.037964112);
  assert.equal(run.input.limits.maxCost, 1); assert.equal(run.input.limits.maxRepairCycles, 2);
  assert.equal(JSON.stringify(run), before, 'Read-only historical checks cannot create new model outcomes or reprice the archived run');
});
