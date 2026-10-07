import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { runRole } from '../server/harness.ts';
import { ProductionPipeline, type ProductionOptions } from '../server/production/pipeline.ts';
import { ProductionStore, hash } from '../server/production/store.ts';
import { evaluateJevCandidates } from '../server/production/jev.ts';
import { projectProductionReviewContext, REVIEW_CONTEXT_PROJECTION_VERSION, type GenerationFeedbackReference } from '../server/production/review-context.ts';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.ts';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.ts';
import type { CameraSceneConfig } from '../shared/camera-scene-schema.ts';
import type { JevCandidateContext } from '../shared/jev-schema.ts';

const historicalHashes = {
  'run.json': '3c231fc1f30932899d93488948ed6d381d9bf10d4d02fbdd95d7b2b680960394',
  'evidence.json': 'd3218b84568d16e72176f14fd7376d43605daa4038eb44a7df5b6ca2ac11db4f',
  'delivery-manifest.json': '3171c89b86b5df6428261e77ae1bb155684f4203f8829e27b9d4094c5f071f07',
  'platform-metadata.json': '0e01b38a50c869d91c7d0c1645c3a15fe619c0e6aff9a2b0bdd361984d00d1f2',
} as const;
const historical = () => Object.fromEntries(Object.entries(historicalHashes).map(([name, sha]) => {
  const bytes = readFileSync(new URL(`../docs/production/experiments/CAMERA-06/${name}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
  return [name, bytes];
})) as Record<keyof typeof historicalHashes, Buffer>;

async function fixture(t: TestContext, options: ProductionOptions, source: ProductionRun) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-review-integration-'));
  const store = new ProductionStore(directory);
  const pipeline = new ProductionPipeline(store, options);
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, apiKey: `review-context-free-role-token-${agent.role}`, baseUrl: 'https://example.invalid', pricing: { currency: 'USD', inputPerMillion: 0.3, outputPerMillion: 1.2 } });
  store.patchJevConfig({ enabled: true, apiKey: 'review-context-free-jev-token-not-real', minScore: 3, minConfidence: 0.5 });
  const input = productionRunInputSchema.parse({ ...source.input, agentIds: store.agents().map(agent => agent.id), limits: { ...source.input.limits, maxCalls: 30 }, requirement: { ...source.input.requirement, id: 'FREE-REVIEW-INTEGRATION', source: 'Injected engineering only; no model or browser delivery' } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), jevSnapshot: store.jevConfig(), calls: [], jevCalls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const execute = async () => { pipeline.start(store.run(run.id)!); const deadline = Date.now() + 10000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(pipeline.busy, false); return store.run(run.id)!; };
  return { store, run, execute };
}

test('full injected pipeline keeps original regeneration for its role, projects identical current-candidate context for Jev/LLM, and binds frozen manifest version', async t => {
  const bytes = historical(); const source = JSON.parse(bytes['run.json'].toString('utf8')) as ProductionRun;
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External HTTP forbidden in review projection integration'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const selectedRaw = (phase: string) => source.calls.find(call => call.phase === phase && call.selected)!.rawOutput;
  const tester = source.calls.filter(call => call.role === 'tester');
  assert.equal(tester.length, 2);
  const correctedRaw = tester[1].rawOutput;
  const checks = JSON.parse(correctedRaw).checks;
  assert.equal(preflightAcceptanceSemantics(checks, { capability: source.input.capability, cameraBusinessConstraints: source.input.cameraBusinessConstraints }).valid, true);
  const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Free integration fixture; not actual delivery', background: '#102030', palette: ['#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 2, 1], count: 1000, color: '#ffffff' }, { id: 'layer', primitive: 'ring', position: [0, 1, 0], scale: [1, 1, 1], count: 1000, color: '#ffffff' }, { id: 'top', primitive: 'star', position: [0, 3, 0], scale: [1, 1, 1], count: 300, color: '#ffffff' }], snowCount: 100, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };
  let testerCalls = 0; let gates = 0; let dispatches = 0;
  const jevContexts: JevCandidateContext[] = [];
  const verifierInputs: Array<Record<string, any>> = [];
  const roleCall: typeof runRole = async (agent, _system, prompt) => {
    const data = JSON.parse(prompt); let text: string;
    if (agent.modelId === 'verifier') { verifierInputs.push(data); text = JSON.stringify({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected oracle; no real quality evidence' })), reason: 'Free independent fixture only' }); }
    else if (agent.modelId === 'product') text = selectedRaw('product');
    else if (agent.modelId === 'researcher') text = selectedRaw('research');
    else if (agent.modelId === 'project-manager') text = data.context.gate ? JSON.stringify({ decision: data.context.gate.passed ? 'proceed' : 'revise', summary: 'Follow injected Gate while keeping frozen contract', tasks: [{ id: 'next', owner: 'developer', description: 'Respect immutable checks and global repair pool' }], risks: [] }) : selectedRaw('think-design');
    else if (agent.modelId === 'tester') text = ++testerCalls === 1 ? tester[0].rawOutput : correctedRaw;
    else if (agent.modelId === 'developer') text = JSON.stringify({ scene });
    else throw new Error('Unexpected injected role');
    return { text, inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected fixture, no Harness/provider HTTP' };
  };
  const { store, run, execute } = await fixture(t, {
    roleCall,
    acceptancePreflight: async () => ({ valid: true, errors: [] }),
    cameraGate: async (_scene, frozenChecks) => { assert.deepEqual(frozenChecks, checks); gates++; return { passed: gates === 2, checks: [{ name: 'Injected oracle, not browser/physical validation', passed: gates === 2 }], evidenceScope: 'scene-behavior-synthetic' }; },
    jevCall: async (config, context, signal) => {
      jevContexts.push(structuredClone(context));
      return evaluateJevCandidates(config, context, signal, { fetch: (async (_url, init) => {
        dispatches++; const request = JSON.parse(String(init!.body)); const levels: string[] = request.questions.c0_coverage.criteria;
        const answers: Record<string, unknown> = {};
        for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c0_${dimension}`] = { type: 'score', score: 4, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])), probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 }, confidence: 1 };
        // A legitimate low-concentration Choice causes the registered single
        // independent LLM path; no invalid numeric protocol is fabricated.
        answers.c0_safe = { type: 'noul', noul: 1 }; answers.best = { type: 'choice', choice: context.candidates[0].id, probabilities: { [context.candidates[0].id]: 0.55, abstain: 0.45 }, confidence: 0.1 };
        return new Response(JSON.stringify({ model: config.modelId, answers, usage: { input_tokens: 100, output_tokens: 0 } }));
      }) as typeof fetch });
    },
  }, source);
  const final = await execute();
  assert.equal(final.status, 'completed', final.error); assert.equal(final.evidenceKind, 'injected-test'); assert.equal(testerCalls, 2); assert.equal(gates, 2); assert.equal(final.repairs, 2); assert.equal(dispatches, 8); assert.equal(verifierInputs.length, 8);
  assert.deepEqual(final.repairHistory!.map(repair => repair.kind), ['stage-regeneration', 'gate-repair']);
  assert.equal(final.validationContract!.reviewContextVersion, REVIEW_CONTEXT_PROJECTION_VERSION);
  assert.equal(final.frozenContract!.validationContractHash, hash(final.validationContract));
  assert.deepEqual(final.frozenContract!.checks, checks);
  for (const context of jevContexts) {
    const review = context.reviewContext as Record<string, unknown>;
    assert.equal(review.reviewContextVersion, REVIEW_CONTEXT_PROJECTION_VERSION);
    assert.equal(Object.hasOwn(review, 'regeneration'), false);
    const llm = verifierInputs.find(input => input.criteria.phase === context.phase)!;
    assert.ok(llm); assert.deepEqual(llm.state.reviewContext, review); assert.deepEqual(llm.candidates, context.candidates);
    assert.equal(llm.criteria.goal, run.input.brief); assert.equal(llm.criteria.acceptance, run.input.requirement.acceptance);
    const reference = review.generationFeedbackReference as GenerationFeedbackReference | undefined;
    for (const candidate of context.candidates) {
      const call = final.calls.find(call => call.candidateId === candidate.id)!; assert.ok(call);
      assert.equal(JSON.stringify(candidate.value), JSON.stringify(JSON.parse(call.rawOutput)));
      const generation = JSON.parse(call.userPrompt).context;
      const expected = projectProductionReviewContext(generation, [call.id]);
      assert.deepEqual(review, { ...expected.reviewContext, reviewContextVersion: expected.version });
      for (const key of Object.keys(generation).filter(key => key !== 'regeneration')) assert.deepEqual((review as Record<string, unknown>)[key], generation[key]);
      if (reference) { assert.deepEqual(reference.sourceRoleCallIds, [call.id]); assert.equal(reference.sha256, hash(generation.regeneration)); assert.deepEqual(reference.rejectedCandidateIds, generation.regeneration.rejectedCandidateIds); assert.equal(reference.sourcePath, 'role-call.userPrompt.context.regeneration'); }
      if (generation.frozenContract) assert.equal(generation.frozenContract.hash, final.frozenContract!.hash);
    }
    if (context.phase === 'acceptance') assert.ok(reference, 'Corrected tester must have traceable prior generation feedback');
    if (context.phase === 'repair-1') { assert.deepEqual(review.feedback && (review.feedback as any).failedGate, final.gateHistory[0]); assert.deepEqual((review.feedback as any).previousScene, scene); }
    if (context.phase.startsWith('feedback-')) assert.deepEqual(review.gate, final.gateHistory[Number(context.phase.slice(-1))]);
  }
  const corrected = final.calls.filter(call => call.role === 'tester')[1]; assert.ok(JSON.parse(corrected.userPrompt).context.regeneration); assert.equal(corrected.rawOutput, correctedRaw); assert.equal(final.calls.filter(call => call.role === 'tester')[0].rawOutput, tester[0].rawOutput);
  const manifest = JSON.parse(store.readArtifact(final.id, 'delivery-manifest.json')); const evidence = JSON.parse(store.readArtifact(final.id, 'evidence.json'));
  assert.equal(manifest.validationContract.reviewContextVersion, REVIEW_CONTEXT_PROJECTION_VERSION); assert.equal(manifest.validationContractHash, hash(final.validationContract)); assert.equal(evidence.validationContract.reviewContextVersion, REVIEW_CONTEXT_PROJECTION_VERSION);
  assert.equal(final.cameraVerification!.physicalCameraVerified, false); assert.equal(final.cameraVerification!.fullRequirementVerified, false);
  assert.deepEqual(historical(), bytes);
  t.diagnostic('Free injected pipeline: actual adapter + eight in-memory fetch dispatches, zero HTTP/model/browser. Original CAMERA06 four JSON byte hashes unchanged; not autonomous or real-device delivery evidence.');
});

test('empty corrected candidate pools stay host-rejected, consume exactly the shared two repair attempts, and never dispatch Jev or LLM review', async t => {
  const bytes = historical(); const source = JSON.parse(bytes['run.json'].toString('utf8')) as ProductionRun;
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External HTTP forbidden in empty-candidate regression'); }; t.after(() => { globalThis.fetch = originalFetch; });
  let roleCalls = 0;
  const { execute } = await fixture(t, {
    roleCall: async () => { roleCalls++; return { text: '{ invalid JSON', inputTokens: 1, outputTokens: 1, usageReported: true, harness: 'Injected malformed candidate only' }; },
    jevCall: async () => { throw new Error('Empty candidate pool must not reach Jev'); },
    cameraGate: async () => { throw new Error('Empty candidate pool must not reach Gate'); },
    acceptancePreflight: async () => { throw new Error('Product rejection must not reach browser preflight'); },
  }, source);
  const final = await execute();
  assert.equal(final.status, 'failed'); assert.match(final.error!, /全局自动返修次数耗尽/); assert.equal(roleCalls, 3); assert.equal(final.repairs, 2); assert.equal(final.repairHistory!.length, 2); assert.equal(final.jevCalls!.length, 0); assert.equal(final.calls.some(call => call.role === 'verifier'), false); assert.equal(final.gateHistory.length, 0); assert.equal(final.verifications.length, 3);
  assert.ok(final.calls.slice(1).every(call => JSON.parse(call.userPrompt).context.regeneration));
  assert.deepEqual(historical(), bytes);
});
