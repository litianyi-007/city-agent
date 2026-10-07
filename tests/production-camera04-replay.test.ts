import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contractProfile, outputContractSnapshot, parseJson, parseVerifiedDecision, planSchema, researchSchema, testsSchema, verifierSchema } from '../server/production/contracts.js';
import type { ProductionRun } from '../shared/production-schema.js';

test('CAMERA-04 preserves the real fatal Verifier violation, semantic test defects and all billed attempts without scene delivery', () => {
  const directory = new URL('../docs/production/experiments/CAMERA-04/', import.meta.url);
  const bytes = readFileSync(new URL('run.json', directory), 'utf8');
  const run: ProductionRun = JSON.parse(bytes);
  const evidence: ProductionRun = JSON.parse(readFileSync(new URL('evidence.json', directory), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('delivery-manifest.json', directory), 'utf8'));
  const metadata = JSON.parse(readFileSync(new URL('platform-metadata.json', directory), 'utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.status, 'failed'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.platformCommit, '96d5ca6f0d2e8dc1d49e548ed22125ba50caa16c');
  assert.equal(metadata.platformCommit, run.platformCommit); assert.equal(metadata.build.sourceClean, true);
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.source, null);
  assert.equal(manifest.outputContractVersion, 'production-output-contract-v1'); assert.equal(manifest.jevPolicyVersion, 'jev-candidate-v3');
  assert.equal(run.calls.length, 7); assert.equal(run.jevCalls!.length, 4);
  assert.equal(run.calls.reduce((sum, call) => sum + call.providerRequests!.requests, 0), 7);
  assert.equal(run.jevCalls!.reduce((sum, call) => sum + call.evaluation.providerRequests, 0), 4);
  assert.deepEqual(run.jevCalls!.map(call => call.evaluation.status), ['uncertain', 'accepted', 'uncertain', 'uncertain']);
  assert.equal(run.jevCalls!.some(call => call.evaluation.errorKind === 'arithmetic-drift'), false, 'New protocol fallback was not triggered in this real task');
  assert.deepEqual(run.outputs.map(output => output.role), ['product', 'researcher', 'project-manager']);
  assert.equal(run.calls.some(call => call.role === 'developer'), false); assert.equal(run.repairs, 0);
  assert.equal(run.frozenContract, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.artifacts.some(artifact => ['scene.json', 'index.html'].includes(artifact.name)), false);
  assert.equal(run.cameraVerification!.fullRequirementVerified, false);
  assert.equal(run.usage.inputTokens, 73875); assert.equal(run.usage.outputTokens, 6366); assert.equal(run.usage.complete, true);
  assert.ok(Math.abs(run.usage.estimatedCost! - 0.020100120) < 1e-12);

  const schemas = { product: contractProfile('camera-scene-v1').productSchema, researcher: researchSchema, 'project-manager': planSchema, tester: testsSchema, verifier: verifierSchema };
  for (const call of run.calls) {
    assert.equal(call.promptVersion, 'production-camera-scene-v5');
    assert.deepEqual(JSON.parse(call.userPrompt).outputContract, outputContractSnapshot(schemas[call.role as keyof typeof schemas]));
    if (call.role === 'verifier') {
      assert.equal(call.verificationEngine, 'jev-llm-fallback');
      assert.ok(run.jevCalls!.some(source => source.id === call.sourceJevCallId));
    }
  }
  const last = run.calls.at(-1)!; const raw = parseJson(last.rawOutput) as { decision: string; scores: Array<{ score: number; reason: string }> };
  assert.equal(raw.decision, 'abstain'); assert.equal(raw.scores[0].score, 2);
  assert.equal(raw.scores[0].reason.length, 1428);
  assert.equal(verifierSchema.safeParse(raw).success, false);
  assert.throws(() => parseVerifiedDecision(raw, [run.verifications.at(-1)!.candidateIds[0]]));
  assert.match(run.verifications.at(-1)!.reason, /Verifier 输出不合法/);
  const testerRaw = parseJson(run.calls.find(call => call.role === 'tester')!.rawOutput);
  const tester = testsSchema.parse(testerRaw);
  const contradictory = tester.checks.find(check => check.steps.some(step => step.action === 'assertChanged' && step.selector === '#particle-count'))!;
  assert.ok(contradictory.steps.some(step => step.action === 'assertTextExact' && step.text === '{{particleCount}}'), 'The semantic defect remains raw, not repaired by the host');
  assert.equal(readFileSync(new URL('run.json', directory), 'utf8'), bytes, 'Offline audit must never rewrite the original failed run');
});
