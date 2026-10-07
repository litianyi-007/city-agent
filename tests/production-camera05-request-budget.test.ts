import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ProductionPipeline } from '../server/production/pipeline.ts';
import { ProductionStore } from '../server/production/store.ts';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.ts';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.ts';
import type { AcceptanceCheck } from '../server/gate.ts';
import type { runRole } from '../server/harness.ts';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.ts';
import { CAMERA_GESTURE_LABELS } from '../shared/camera-test-semantics.ts';
import type { CameraSceneConfig } from '../shared/camera-scene-schema.ts';

test('CAMERA05 selected outputs and nine checks fit actual Jev/role byte guards through an injected Gate repair', { timeout: 45_000 }, async t => {
  // This free counterfactual proves request transport capacity, NOT real-model
  // judgment, actual Canvas/vision, autonomous generation or business delivery.
  const historicalPath = new URL('../docs/production/experiments/CAMERA-05/run.json', import.meta.url);
  const historicalBytes = readFileSync(historicalPath);
  const historicalSha256 = '61cb1e48477e0bbf4bc28e7e53cf5e55bce01c5a0b70e258f3796c9dc91e0d8f';
  assert.equal(createHash('sha256').update(historicalBytes).digest('hex'), historicalSha256);
  const historical = JSON.parse(historicalBytes.toString('utf8')) as ProductionRun;
  const selectedRaw = (phase: string) => {
    const output = historical.outputs.find(item => item.phase === phase);
    assert.ok(output);
    const call = historical.calls.find(item => item.candidateId === output.selectedCandidateId);
    assert.ok(call?.selected);
    assert.deepEqual(JSON.parse(call.rawOutput), output.value);
    return call.rawOutput;
  };
  const upstream = Object.fromEntries(['product', 'research', 'think-design'].map(phase => [phase, selectedRaw(phase)]));
  const constraints = { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } as const;
  const checks: AcceptanceCheck[] = [
    { name: 'Actual fixed canvas and concrete total', steps: [{ action: 'assertVisible', selector: '#scene-canvas' }, { action: 'assertTextExact', selector: '#particle-count', text: '160' }] },
    { name: 'Fresh gathered state', steps: [{ action: 'assertTextExact', selector: '#scene-state', text: 'gather' }, { action: 'assertTextExact', selector: '#rotation', text: '0.0000' }] },
    { name: 'Scatter preserves count', steps: [{ action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }, { action: 'assertTextExact', selector: '#particle-count', text: '160' }] },
    { name: 'Gather after scatter', steps: [{ action: 'click', selector: '#scatter' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }] },
    { name: 'Right manual increment', steps: [{ action: 'click', selector: '#rotate-right' }, { action: 'assertTextExact', selector: '#rotation', text: '0.3927' }] },
    { name: 'Left manual increment', steps: [{ action: 'click', selector: '#rotate-left' }, { action: 'assertTextExact', selector: '#rotation', text: '-0.3927' }] },
    { name: 'Reset and explicit three mappings', steps: [{ action: 'click', selector: '#scatter' }, { action: 'click', selector: '#rotate-right' }, { action: 'click', selector: '#reset-btn' }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }, { action: 'assertTextExact', selector: '#rotation', text: '0.0000' }, { action: 'assertTextExact', selector: '#gesture-map', text: CAMERA_GESTURE_LABELS[0] }] },
    { name: 'Synthetic Gate never proves permission or real vision', steps: [{ action: 'assertTextExact', selector: '#camera-status', text: '场景 Gate 使用合成输入；摄像头、视觉模型与完整需求未验收。' }, { action: 'assertVisible', selector: '#camera-start:disabled' }] },
    { name: 'Concrete title and fixed manual labels', steps: [{ action: 'assertTextExact', selector: '#scene-title', text: 'Free counterfactual fixture' }, { action: 'assertTextExact', selector: '#scatter', text: '散开' }, { action: 'assertTextExact', selector: '#gather', text: '聚合' }] },
  ];
  assert.equal(preflightAcceptanceSemantics(checks, { capability: 'camera-scene-v1', cameraBusinessConstraints: constraints }).valid, true);
  const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Free counterfactual fixture', background: '#102030', palette: ['#00ffaa', '#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 2, 1], count: 120, color: '#00ffaa' }, { id: 'top', primitive: 'star', position: [0, 2.5, 0], scale: [0.3, 0.3, 0.3], count: 20, color: '#ffffff' }], snowCount: 20, mappings: constraints };
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = mkdtempSync(path.join(root, '.city-agent-cam05-request-unit-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Global/external fetch forbidden in free request-capacity test'); };
  let pipeline: ProductionPipeline | undefined;
  t.after(async () => { try { await pipeline?.stop(); } finally { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); } });
  const store = new ProductionStore(directory);
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://example.invalid', apiKey: `synthetic-free-cam05-budget-token-${agent.role}`, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } });
  store.patchJevConfig({ enabled: true, apiKey: 'synthetic-free-cam05-jev-budget-token', minScore: 3, minConfidence: 0.5 });
  const input = productionRunInputSchema.parse({ ...historical.input, agentIds: store.agents().map(agent => agent.id) });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), jevSnapshot: store.jevConfig(), calls: [], jevCalls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  let gateCalls = 0; let inMemoryFetchDispatches = 0;
  const roles: Array<{ phase: string; bytes: number }> = [];
  const jevs: Array<{ phase: string; totalBytes: number; perQuestionBytes: number }> = [];
  const frozenHashes: string[] = [];
  const roleCall: typeof runRole = async (agent, system, prompt) => {
    const data = JSON.parse(prompt); const role = agent.modelId;
    const phase = data.criteria?.phase ?? (role === 'developer' ? data.context.cycle ? `repair-${data.context.cycle}` : 'implement' : role === 'project-manager' ? data.context.gate ? `feedback-${data.context.cycle}` : 'think-design' : role === 'researcher' ? 'research' : role === 'tester' ? 'acceptance' : role);
    const bytes = Buffer.byteLength(`${system}\n${prompt}`, 'utf8');
    roles.push({ phase: `${phase}${role === 'verifier' ? ':verify' : ''}`, bytes });
    assert.ok(bytes <= 60000, `${phase}: actual role request exceeds 60,000 B (${bytes})`);
    const context = data.context ?? data.state.reviewContext;
    if (context.frozenContract) frozenHashes.push(context.frozenContract.hash);
    assert.equal(context.remainingRepairs, input.limits.maxRepairCycles - store.run(run.id)!.repairs);
    let text: string;
    if (role === 'verifier') text = JSON.stringify({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Free injected oracle, no actual model judgment.' })), reason: 'Free context probe only.' });
    else if (role === 'product' || role === 'researcher') text = upstream[role === 'researcher' ? 'research' : 'product']!;
    else if (role === 'project-manager') text = data.context.gate ? JSON.stringify({ decision: data.context.gate.passed ? 'proceed' : 'revise', summary: 'Free oracle obeys injected Gate and frozen contract.', tasks: [{ id: 'next', owner: 'developer', description: 'No actual deliverable or autonomous proof.' }], risks: [] }) : upstream['think-design']!;
    else if (role === 'tester') text = JSON.stringify({ checks });
    else if (role === 'developer') text = JSON.stringify({ scene });
    else throw new Error('Unexpected injected role');
    return { text, inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injection only' };
  };
  pipeline = new ProductionPipeline(store, {
    roleCall,
    acceptancePreflight: async () => ({ valid: true, errors: [] }), // No browser or CSS parser is executed by this fixture.
    cameraGate: async (_scene, suppliedChecks) => { assert.deepEqual(suppliedChecks, checks); return { passed: ++gateCalls > 1, checks: [{ name: 'Injected Gate only, not actual browser/camera proof', passed: gateCalls > 1 }], evidenceScope: 'scene-behavior-synthetic' }; },
    jevCall: async (config, context, signal) => {
      const request = buildJevCandidateRequest(config.modelId, context);
      const totalBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
      const perQuestionBytes = Buffer.byteLength(JSON.stringify(request.state), 'utf8') + Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question), 'utf8')));
      jevs.push({ phase: context.phase, totalBytes, perQuestionBytes });
      assert.ok(totalBytes <= 64000, `${context.phase}: actual Jev request exceeds 64,000 B (${totalBytes})`);
      assert.ok(perQuestionBytes <= 32000, `${context.phase}: actual Jev state+question exceeds 32,000 B (${perQuestionBytes})`);
      // Execute the actual evaluator, including its byte guard and response
      // validator. Only its fetch is replaced by an in-memory Response; its
      // providerRequests dispatch accounting is NOT a physical HTTP request.
      const result = await evaluateJevCandidates(config, context, signal, { fetch: (async (_url, init) => {
        inMemoryFetchDispatches++;
        assert.deepEqual(JSON.parse(String(init?.body)), request);
        const answers: Record<string, unknown> = {};
        for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c0_${dimension}`] = { type: 'score', score: 2, confidence: 0, probabilities: { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 }, legend: Object.fromEntries((request.questions.c0_coverage.criteria as string[]).map((label, index) => [String(index), label])) };
        answers.c0_safe = { type: 'noul', noul: 0.5 }; answers.best = { type: 'choice', choice: context.candidates[0].id, probabilities: { [context.candidates[0].id]: 0.5, abstain: 0.5 }, confidence: 0 };
        return new Response(JSON.stringify({ model: config.modelId, answers, usage: { input_tokens: 100, output_tokens: 0 } }));
      }) as typeof fetch });
      assert.equal(result.status, 'uncertain', result.reason);
      return result;
    },
  });
  pipeline.start(store.run(run.id)!);
  const deadline = Date.now() + 30000;
  while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pipeline.busy, false, 'Free injected pipeline must terminate');
  const final = store.run(run.id)!;
  assert.equal(final.status, 'completed', final.error);
  assert.equal(final.evidenceKind, 'injected-test');
  assert.equal(final.repairs, 1);
  assert.equal(final.repairHistory?.[0].kind, 'gate-repair');
  assert.equal(final.repairHistory?.[0].frozenHash, final.frozenContract?.hash);
  assert.equal(gateCalls, 2);
  assert.equal(inMemoryFetchDispatches, 8);
  assert.equal(final.calls.length, 16);
  assert.ok(final.calls.every(call => call.executionSource === 'injected'));
  assert.deepEqual(new Set(jevs.map(item => item.phase)), new Set(['product', 'research', 'think-design', 'acceptance', 'implement', 'feedback-0', 'repair-1', 'feedback-1']));
  for (const [phase, raw] of Object.entries(upstream)) assert.equal(final.calls.find(call => call.phase === phase && call.selected)!.rawOutput, raw);
  assert.deepEqual(final.frozenContract?.checks, checks);
  assert.ok(frozenHashes.length && frozenHashes.every(hash => hash === final.frozenContract?.hash));
  assert.equal(final.cameraVerification?.physicalCameraVerified, false);
  assert.equal(final.cameraVerification?.fullRequirementVerified, false);
  assert.deepEqual(readFileSync(historicalPath), historicalBytes);
  assert.equal(createHash('sha256').update(readFileSync(historicalPath)).digest('hex'), historicalSha256);
  t.diagnostic(JSON.stringify({ source: 'free injected request-capacity test, not actual model/Canvas/device proof', actualHttpRequests: 0, inMemoryFetchDispatches, maxRoleBytes: Math.max(...roles.map(item => item.bytes)), maxJevPerQuestionBytes: Math.max(...jevs.map(item => item.perQuestionBytes)), maxJevTotalBytes: Math.max(...jevs.map(item => item.totalBytes)), jevStages: jevs }));
});
