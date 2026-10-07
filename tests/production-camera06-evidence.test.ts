import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { parseVerifiedDecision, testsSchema } from '../server/production/contracts.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Read-only replay of a real archived failure. These tests make no provider
// calls and are not a new execution, autonomous delivery or camera acceptance.
const runId = '255e66b8-8371-4194-ad21-b32ac8477d1f';
const frozenCommit = 'e91a029f6f6053ef1afe260ff6f4557075ada776';
const directory = new URL('../docs/production/experiments/CAMERA-06/', import.meta.url);
const fileHashes = {
  'run.json': '3c231fc1f30932899d93488948ed6d381d9bf10d4d02fbdd95d7b2b680960394',
  'evidence.json': 'd3218b84568d16e72176f14fd7376d43605daa4038eb44a7df5b6ca2ac11db4f',
  'delivery-manifest.json': '3171c89b86b5df6428261e77ae1bb155684f4203f8829e27b9d4094c5f071f07',
  'platform-metadata.json': '0e01b38a50c869d91c7d0c1645c3a15fe619c0e6aff9a2b0bdd361984d00d1f2',
};
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));

test('CAMERA-06 frozen bytes preserve its 47.5s failure without implementation, frozen Gate or camera claims', () => {
  for (const [name, expected] of Object.entries(fileHashes)) {
    assert.equal(createHash('sha256').update(read(name as keyof typeof fileHashes)).digest('hex'), expected, `${name} historical bytes must remain unchanged`);
  }
  const run = loadRun();
  const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 47500);
  assert.equal(run.input.mode, 'live'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.requirement.id, 'CAMERA-06'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.capability, 'camera-scene-v1');
  assert.equal(run.frozenContract, undefined); assert.equal(run.gate, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.deepEqual(run.outputs.map(output => output.phase), ['product', 'research', 'think-design']);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, frozenCommit);
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.durationMs, 47500);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.trustedPreviewSha256, null);
  assert.equal(manifest.frozenContract, undefined); assert.deepEqual(manifest.usage, run.usage);
  assert.deepEqual(manifest.cameraVerification, run.cameraVerification);
  for (const field of ['boundedScenePassed', 'visionModelVerified', 'physicalCameraVerified', 'fullRequirementVerified'] as const) {
    assert.equal(run.cameraVerification![field], false);
  }
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit);
  assert.equal(metadata.build.sourceClean, true);
  assert.equal(manifest.promptVersion, 'production-camera-scene-v6');
  assert.equal(run.validationContract!.harnessPromptTransportVersion, 'harness-literal-prompt-v1');
  assert.equal(run.validationContract!.semanticsVersion, 'production-acceptance-semantic-v2');
  assert.equal(run.validationContract!.jevRequestLayoutVersion, 'jev-request-layout-v2');
  assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.validationContractHash, '956047c810c1ad790dadfc373905416d5ed639d5b817c9d2caa47d83f44bf5ad');
  assert.equal(manifest.cameraRuntime.mandatoryChecksVersion, 'camera-scene-behavior-v2');
  assert.equal(manifest.cameraRuntime.gateSourceHash, '9d4826052d66afe5a3e8e4bbb2a0278520439ebd90b9c9b549103e09fd1e4345');
  assert.match(run.error!, /用量未知或非法/); assert.equal(manifest.failure, run.error);
});

test('CAMERA-06 preserves 12 intents versus 11 observed POSTs including one zero-POST fatal Jev preflight', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.equal(run.calls.length, 8); assert.equal(run.calls.every(call => call.executionSource === 'harness'), true);
  for (const call of run.calls) {
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.transportComplete, true); assert.equal(call.providerRequests!.protocolComplete, true);
    assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true);
    assert.equal(call.providerRequests!.complete, true); assert.ok(call.rawOutput.length > 0);
    assert.equal(call.promptVersion, 'production-camera-scene-v6');
  }
  assert.equal(run.jevCalls!.length, 4);
  assert.deepEqual(run.jevCalls!.map(call => call.evaluation.providerRequests), [1, 1, 1, 0]);
  const preflight = run.jevCalls!.at(-1)!;
  assert.equal(preflight.phase, 'acceptance'); assert.equal(preflight.evaluation.status, 'error');
  assert.equal(preflight.evaluation.errorKind, 'fatal'); assert.equal(preflight.evaluation.selectedCandidateId, null);
  assert.equal(preflight.evaluation.httpStatus, null); assert.equal(preflight.evaluation.rawResponse, null);
  assert.match(preflight.evaluation.error!, /context byte limits; evidence was not truncated/);
  assert.deepEqual(preflight.evaluation.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  const counts = projectProductionLedger(run).requests;
  assert.equal(counts.callRecords, 8); assert.equal(counts.budgetRecords, 12); assert.equal(counts.harnessInvocations, 8);
  assert.equal(counts.knownHarnessProviderRequests, 8); assert.equal(counts.jevProviderRequests, 3);
  assert.equal(counts.actualProviderRequests, 11); assert.equal(counts.knownProviderRequests, 11);
  assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(run.calls.some(call => call.sourceJevCallId === preflight.id), false, 'Fatal preflight cannot be silently downgraded to a model fallback');
  assert.equal(JSON.stringify(run), before, 'Projection must not rewrite historic evidence or replace unknown usage with zero');
});

test('CAMERA-06 literal prompt transport reaches both tester POSTs while semantic rejection triggers only one regeneration', () => {
  const run = loadRun(); const testers = run.calls.filter(call => call.role === 'tester');
  assert.equal(testers.length, 2);
  const first = testsSchema.parse(JSON.parse(testers[0].rawOutput));
  const second = testsSchema.parse(JSON.parse(testers[1].rawOutput));
  assert.equal(first.checks.length, 10); assert.equal(second.checks.length, 8);
  // The first raw JSON is structurally legal, but semantically impossible. Do
  // not rewrite the historical root cause as malformed JSON or loosen Gate.
  const context = { capability: run.input.capability, brief: run.input.brief, acceptance: run.input.requirement.acceptance, cameraBusinessConstraints: run.input.cameraBusinessConstraints };
  const rejected = preflightAcceptanceSemantics(first.checks, context);
  assert.equal(rejected.version, 'production-acceptance-semantic-v2'); assert.equal(rejected.valid, false);
  assert.deepEqual(rejected.issues.map(issue => issue.code), ['camera-impossible-change', 'camera-synthetic-predicate', 'camera-fixed-text-mismatch']);
  assert.match(testers[0].error!, /验收语义拒绝/);
  assert.equal(preflightAcceptanceSemantics(second.checks, context).valid, true);
  assert.equal(testers[1].error, undefined);
  for (const tester of testers) {
    assert.equal(tester.systemPrompt.includes('{{particleCount}}'), true, 'Literal template text was actually transported, not hand-edited away');
    assert.equal(tester.providerRequests!.requests, 1); assert.equal(tester.providerRequests!.status, 200);
    assert.notEqual(tester.selected, true);
  }
  assert.equal(run.repairPolicyVersion, 'production-global-repair-v1'); assert.equal(run.repairs, 1);
  assert.equal(run.repairHistory!.length, 1);
  const repair = run.repairHistory![0];
  assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.role, 'tester'); assert.equal(repair.phase, 'acceptance');
  assert.equal(repair.attempt, 1); assert.equal(repair.frozenHash, null);
  assert.deepEqual(repair.rejectedCandidateIds, [testers[0].candidateId]);
  const regeneration = JSON.parse(testers[1].userPrompt).context.regeneration;
  assert.equal(regeneration.attempt, 1); assert.equal(regeneration.frozenHash, null);
  assert.deepEqual(regeneration.rejectedCandidateIds, repair.rejectedCandidateIds);
  const preflightState = run.jevCalls!.at(-1)!.evaluation.requestSnapshot!.state;
  assert.equal(preflightState.requestLayoutVersion, 'jev-request-layout-v2');
  assert.deepEqual(preflightState.candidates, [{ id: testers[1].candidateId, value: second }], 'Capacity failure preserves the whole legal candidate instead of truncating it');
  assert.equal(run.outputs.some(output => testers.some(tester => tester.candidateId === output.selectedCandidateId)), false);
});

test('CAMERA-06 keeps one uncertain and two arithmetic-error Jev decisions alongside their independent compact LLM review lineage', () => {
  const run = loadRun(); const sources = run.jevCalls!.slice(0, 3);
  assert.deepEqual(sources.map(call => call.phase), ['product', 'research', 'think-design']);
  assert.deepEqual(sources.map(call => call.evaluation.status), ['uncertain', 'error', 'error']);
  assert.deepEqual(sources.map(call => call.evaluation.errorKind), [undefined, 'arithmetic-drift', 'arithmetic-drift']);
  const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.equal(verifiers.length, 3);
  assert.deepEqual(verifiers.map(call => call.verificationEngine), ['jev-llm-fallback', 'jev-llm-protocol-fallback', 'jev-llm-protocol-fallback']);
  for (const [index, call] of verifiers.entries()) {
    const source = sources[index];
    assert.equal(call.sourceJevCallId, source.id); assert.equal(source.evaluation.providerRequests, 1);
    assert.equal(source.evaluation.selectedCandidateId, null); assert.equal(source.evaluation.usage.complete, true);
    const raw = JSON.parse(call.rawOutput);
    assert.ok(raw.reason.length < 1000); assert.equal(raw.scores.every((score: { reason: string }) => score.reason.length < 1000), true);
    const decision = parseVerifiedDecision(raw, source.evaluation.requestSnapshot!.state.candidates.map(candidate => candidate.id));
    assert.equal(decision.decision, 'accept');
    const review = run.verifications.find(value => value.sourceJevCallId === source.id && value.engine === call.verificationEngine)!;
    assert.ok(review); assert.equal(review.decision, 'accept'); assert.equal(review.selectedCandidateId, decision.selectedCandidateId);
    const original = run.verifications.find(value => value.phase === source.phase && value.engine === 'jev')!;
    assert.equal(original.decision, 'abstain'); assert.equal(original.selectedCandidateId, null);
    if (source.evaluation.errorKind === 'arithmetic-drift') {
      assert.equal(source.evaluation.scores.length, 0); assert.equal(source.evaluation.choice, null);
      assert.equal(source.evaluation.diagnostics![0].code, 'score-concentration-drift');
    }
  }
  assert.equal(run.status, 'failed'); assert.equal(run.cameraVerification!.fullRequirementVerified, false);
});

test('CAMERA-06 retains unknown aggregate usage while reproducing 74868/6645 tokens and $0.023804532 known subtotal', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.deepEqual(run.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  const usage = projectProductionLedger(run).usage;
  assert.equal(usage.entries, 12); assert.equal(usage.unknownUsageEntries, 1); assert.equal(usage.currency, 'USD');
  assert.equal(usage.currencyMismatchEntries, 0);
  assert.deepEqual(usage.inputTokens, { knownSubtotal: 74868, reportedEntries: 11, unknownEntries: 1, overflow: false });
  assert.deepEqual(usage.outputTokens, { knownSubtotal: 6645, reportedEntries: 11, unknownEntries: 1, overflow: false });
  assert.equal(usage.estimatedCost.reportedEntries, 11); assert.equal(usage.estimatedCost.unknownEntries, 1);
  assert.equal(usage.estimatedCost.overflow, false);
  assert.ok(Math.abs(usage.estimatedCost.knownSubtotal! - 0.023804532) < 1e-12);
  assert.equal(JSON.stringify(run), before, 'Known subtotals do not establish a complete total or mutate archive records');
});
