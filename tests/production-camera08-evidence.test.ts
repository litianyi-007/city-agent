import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { parseJson, parseVerifiedDecision, researchSchema, testsSchema } from '../server/production/contracts.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Free, read-only replay of a real archived failure, not a new model request,
// successful autonomous delivery, planning-loop execution or camera acceptance.
const runId = '1a6231d6-9ebb-466a-879c-6381b6adffcf';
const frozenCommit = '0d62ff08b870627872f851ef5153e527e410eea8';
const directory = new URL('../docs/production/experiments/CAMERA-08/', import.meta.url);
const fileHashes = {
  'run.json': 'bf1c660970d3fb83f3f093365161f2524b2a63ab7749c9b2021bd193b2cbafb2',
  'evidence.json': '0f68761b2ab307258755ceb7f350c564c61afa48ca1af6f674fca7d3aaa1c70e',
  'delivery-manifest.json': 'd53939e81473471a4ea1a1158bef58fb6a0c513253ec797f4a64415b22962be8',
  'platform-metadata.json': 'e32d306cc839351cdc014a73a77c8798356206c15e94ee44733d38650e7aea2b',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));

test('CAMERA-08 immutable receipt retains the 57.688s failure with no frozen contract, implementation or Gate', () => {
  for (const [name, expected] of Object.entries(fileHashes)) {
    assert.equal(createHash('sha256').update(read(name as keyof typeof fileHashes)).digest('hex'), expected, `${name} historical bytes must remain unchanged`);
  }
  const run = loadRun();
  const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 57688);
  assert.equal(run.input.mode, 'live'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.requirement.id, 'CAMERA-08'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.capability, 'camera-scene-v1');
  assert.equal(run.frozenContract, undefined); assert.equal(run.gate, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.deepEqual(run.outputs.map(output => output.phase), ['product', 'research', 'think-design']);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.deepEqual(run.interventions, []);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, frozenCommit);
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.durationMs, 57688);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.trustedPreviewSha256, null);
  assert.deepEqual(manifest.usage, run.usage); assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.validationContractHash, 'cd423b34ddaa2658807a86c22715c47163f27a0144ff69c502ea31cce8f389a0');
  assert.equal(run.validationContract!.planningLoopVersion, 'production-planning-loop-v1');
  assert.equal(run.validationContract!.reviewContextVersion, 'production-review-context-v1');
  assert.equal(run.validationContract!.harnessPromptTransportVersion, 'harness-literal-prompt-v1');
  assert.equal(run.validationContract!.semanticsVersion, 'production-acceptance-semantic-v2');
  assert.equal(manifest.promptVersion, 'production-camera-scene-v7'); assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v4');
  assert.equal(manifest.cameraRuntime.gateSourceHash, '9d4826052d66afe5a3e8e4bbb2a0278520439ebd90b9c9b549103e09fd1e4345');
  assert.deepEqual(manifest.cameraVerification, run.cameraVerification);
  for (const field of ['boundedScenePassed', 'visionModelVerified', 'physicalCameraVerified', 'fullRequirementVerified'] as const) assert.equal(run.cameraVerification![field], false);
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit); assert.equal(metadata.build.sourceClean, true);
  assert.equal(run.error, 'acceptance Verifier 校验失败，未默认为通过'); assert.equal(manifest.failure, run.error);
});

test('CAMERA-08 observes all fourteen HTTP attempts and complete usage despite unsuccessful delivery', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.calls.length, 10); assert.equal(run.calls.every(call => call.executionSource === 'harness'), true);
  for (const call of run.calls) {
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.transportComplete, true); assert.equal(call.providerRequests!.protocolComplete, true);
    assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true);
    assert.equal(call.providerRequests!.complete, true); assert.ok(call.rawOutput.length > 0);
    assert.equal(call.promptVersion, 'production-camera-scene-v7');
  }
  assert.equal(run.jevCalls!.length, 4);
  assert.deepEqual(run.jevCalls!.map(call => call.phase), ['product', 'research', 'think-design', 'acceptance']);
  for (const call of run.jevCalls!) {
    assert.equal(call.evaluation.providerRequests, 1); assert.equal(call.evaluation.usage.complete, true);
  }
  const counts = projectProductionLedger(run).requests;
  assert.equal(counts.callRecords, 10); assert.equal(counts.budgetRecords, 14); assert.equal(counts.harnessInvocations, 10);
  assert.equal(counts.knownHarnessProviderRequests, 10); assert.equal(counts.jevProviderRequests, 4);
  assert.equal(counts.actualProviderRequests, 14); assert.equal(counts.knownProviderRequests, 14); assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(JSON.stringify(run), before, 'Read-only accounting cannot rewrite the failure as a successful delivery');
});

test('CAMERA-08 spends its two shared repairs on researcher structure and tester semantics, not planning revisions', () => {
  const run = loadRun();
  assert.equal(run.repairPolicyVersion, 'production-global-repair-v1'); assert.equal(run.repairs, 2);
  assert.equal(run.input.limits.maxRepairCycles, 2);
  assert.deepEqual(run.repairHistory!.map(repair => ({ role: repair.role, phase: repair.phase, kind: repair.kind, attempt: repair.attempt, frozenHash: repair.frozenHash })), [
    { role: 'researcher', phase: 'research', kind: 'stage-regeneration', attempt: 1, frozenHash: null },
    { role: 'tester', phase: 'acceptance', kind: 'stage-regeneration', attempt: 2, frozenHash: null },
  ]);
  const researchers = run.calls.filter(call => call.role === 'researcher');
  assert.equal(researchers.length, 2);
  const incompleteResearch = parseJson(researchers[0].rawOutput);
  assert.equal(researchSchema.safeParse(incompleteResearch).success, false);
  assert.deepEqual(Object.keys(incompleteResearch as object), ['observations']);
  assert.match(researchers[0].error!, /constraints/); assert.match(researchers[0].error!, /unknowns/);
  assert.notEqual(researchers[0].selected, true);
  assert.equal(researchSchema.safeParse(parseJson(researchers[1].rawOutput)).success, true); assert.equal(researchers[1].selected, true);
  const testers = run.calls.filter(call => call.role === 'tester');
  assert.equal(testers.length, 2);
  const first = testsSchema.parse(parseJson(testers[0].rawOutput)); const second = testsSchema.parse(parseJson(testers[1].rawOutput));
  assert.equal(first.checks.length, 9); assert.equal(second.checks.length, 8);
  const context = { capability: run.input.capability, brief: run.input.brief, acceptance: run.input.requirement.acceptance, cameraBusinessConstraints: run.input.cameraBusinessConstraints };
  const rejected = preflightAcceptanceSemantics(first.checks, context);
  assert.equal(rejected.valid, false);
  assert.deepEqual(rejected.issues.map(issue => issue.code), ['camera-fixed-text-mismatch', 'camera-synthetic-predicate']);
  assert.equal(preflightAcceptanceSemantics(second.checks, context).valid, true);
  assert.equal(testers[1].error, undefined); assert.notEqual(testers[1].selected, true);
  for (const [index, pair] of [researchers, testers].entries()) {
    const repair = run.repairHistory![index]; const context = JSON.parse(pair[1].userPrompt).context;
    assert.deepEqual(repair.rejectedCandidateIds, [pair[0].candidateId]);
    assert.equal(context.regeneration.attempt, index + 1); assert.equal(context.regeneration.frozenHash, null);
    assert.deepEqual(context.regeneration.rejectedCandidateIds, repair.rejectedCandidateIds);
    const evaluation = run.jevCalls!.find(call => call.phase === repair.phase)!.evaluation;
    const reviewContext = evaluation.requestSnapshot!.state.reviewContext as { regeneration?: unknown; generationFeedbackReference: { version: string; sourceRoleCallIds: string[]; sourcePath: string; sha256: string; rejectedCandidateIds: string[] } };
    const reference = reviewContext.generationFeedbackReference;
    assert.equal(reviewContext.regeneration, undefined);
    assert.equal(reference.version, 'production-review-context-v1');
    assert.deepEqual(reference.sourceRoleCallIds, [pair[1].id]); assert.equal(reference.sourcePath, 'role-call.userPrompt.context.regeneration');
    assert.deepEqual(reference.rejectedCandidateIds, repair.rejectedCandidateIds);
    assert.equal(reference.sha256, createHash('sha256').update(JSON.stringify(context.regeneration)).digest('hex'));
  }
  const plans = run.calls.filter(call => call.role === 'project-manager');
  assert.equal(plans.length, 1); assert.equal(plans[0].phase, 'think-design'); assert.equal(plans[0].selected, true);
  assert.equal((parseJson(plans[0].rawOutput) as { decision: string }).decision, 'proceed');
  assert.equal(run.repairHistory!.some(repair => repair.role === 'project-manager'), false, 'Version registration is not evidence that a planning repair ran');
});

test('CAMERA-08 preserves uncertain/error Jev lineage and rejects the short unescaped final Verifier JSON', () => {
  const run = loadRun(); const sources = run.jevCalls!;
  assert.deepEqual(sources.map(call => call.evaluation.status), ['uncertain', 'error', 'error', 'uncertain']);
  assert.deepEqual(sources.map(call => call.evaluation.errorKind), [undefined, 'arithmetic-drift', 'arithmetic-drift', undefined]);
  const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.equal(verifiers.length, 4);
  assert.deepEqual(verifiers.map(call => call.verificationEngine), ['jev-llm-fallback', 'jev-llm-protocol-fallback', 'jev-llm-protocol-fallback', 'jev-llm-fallback']);
  for (const [index, source] of sources.entries()) {
    assert.equal(source.evaluation.selectedCandidateId, null); assert.equal(verifiers[index].sourceJevCallId, source.id);
    assert.equal(run.calls.filter(call => call.sourceJevCallId === source.id).length, 1);
    if (index < 3) {
      const decision = parseVerifiedDecision(parseJson(verifiers[index].rawOutput), source.evaluation.requestSnapshot!.state.candidates.map(candidate => candidate.id));
      assert.equal(decision.decision, 'accept');
      assert.equal(run.verifications.find(review => review.sourceJevCallId === source.id)!.selectedCandidateId, decision.selectedCandidateId);
    }
  }
  const final = verifiers[3]; const source = sources[3];
  assert.equal(run.calls.at(-1)!.id, final.id); assert.equal(final.phase, 'acceptance:verify');
  assert.equal(final.usage.outputTokens, 226); assert.equal(final.providerRequests!.complete, true);
  assert.ok(final.rawOutput.includes('分列，"当前阶段可推进不代表完整摄像头交付。"}'));
  assert.throws(() => JSON.parse(final.rawOutput), SyntaxError);
  assert.throws(() => parseJson(final.rawOutput), SyntaxError, 'Short output and provider completion do not make malformed JSON acceptable');
  const failedReview = run.verifications.find(review => review.sourceJevCallId === source.id)!;
  assert.equal(failedReview.decision, 'abstain'); assert.equal(failedReview.selectedCandidateId, null); assert.deepEqual(failedReview.scores, []);
  assert.match(failedReview.reason, /^Verifier 输出不合法：/);
  assert.equal(run.outputs.some(output => output.phase === 'acceptance'), false);
  assert.equal(run.frozenContract, undefined); assert.equal(run.status, 'failed');
});

test('CAMERA-08 reproduces complete 106043/7768 tokens and 0.030952776 USD estimated cost without implying an invoice or success', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.usage.complete, true); assert.equal(run.usage.currency, 'USD');
  assert.equal(run.usage.inputTokens, 106043); assert.equal(run.usage.outputTokens, 7768);
  assert.ok(Math.abs(run.usage.estimatedCost! - 0.030952776) < 1e-12);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.inputTokens!, 0), 69565);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.outputTokens!, 0), 7126);
  assert.ok(Math.abs(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0) - 0.0294207) < 1e-12);
  assert.equal(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.inputTokens!, 0), 36478);
  assert.equal(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.outputTokens!, 0), 642);
  assert.ok(Math.abs(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.usage.estimatedCost!, 0) - 0.001532076) < 1e-12);
  const usage = projectProductionLedger(run).usage;
  assert.equal(usage.entries, 14); assert.equal(usage.unknownUsageEntries, 0); assert.equal(usage.currencyMismatchEntries, 0);
  assert.deepEqual(usage.inputTokens, { knownSubtotal: 106043, reportedEntries: 14, unknownEntries: 0, overflow: false });
  assert.deepEqual(usage.outputTokens, { knownSubtotal: 7768, reportedEntries: 14, unknownEntries: 0, overflow: false });
  assert.equal(usage.estimatedCost.reportedEntries, 14); assert.equal(usage.estimatedCost.unknownEntries, 0);
  assert.ok(Math.abs(usage.estimatedCost.knownSubtotal! - run.usage.estimatedCost!) < 1e-12);
  assert.equal(JSON.stringify(run), before);
});
