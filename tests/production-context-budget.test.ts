import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ProductionPipeline } from '../server/production/pipeline.js';
import { ProductionStore } from '../server/production/store.js';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { buildJevCandidateRequest, JEV_REQUEST_LAYOUT_VERSION } from '../server/production/jev.js';
import type { AcceptanceCheck } from '../server/gate.js';
import type { runRole } from '../server/harness.js';
import { JEV_POLICY_VERSION, type JevEvaluation } from '../shared/jev-schema.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { CAMERA_GESTURE_LABELS } from '../shared/camera-test-semantics.js';
import type { CameraSceneConfig } from '../shared/camera-scene-schema.js';

test('nine-check counterfactual fits actual request byte caps across stage regeneration, development, feedback and shared Gate repair', async t => {
  // This is a free, injected engineering oracle, NOT a successful real-model
  // experiment or repaired real delivery. The historical run remains untouched.
  const historicalPath = new URL('../docs/production/experiments/CAMERA-04/run.json', import.meta.url);
  const historicalBytes = readFileSync(historicalPath);
  const historical = JSON.parse(historicalBytes.toString('utf8')) as ProductionRun;
  const oldCall = (phase: string) => { const call = historical.calls.find(call => call.phase === phase); assert.ok(call); return call; };
  const rejectedTesterRaw = oldCall('acceptance').rawOutput;
  const checks = structuredClone(JSON.parse(rejectedTesterRaw).checks) as AcceptanceCheck[];
  checks[4].steps = checks[4].steps.map(step => step.action === 'assertChanged' ? { action: 'click', selector: '#scatter' } : step);
  for (const step of checks[4].steps) if ('text' in step && step.text === '{{particleCount}}') step.text = '120';
  checks.push({ name: 'Explicit generic mapping contract', steps: [{ action: 'assertTextExact', selector: '#gesture-map', text: CAMERA_GESTURE_LABELS[0] }] });
  const constraints = { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } as const;
  assert.equal(checks.length, 9);
  assert.equal(preflightAcceptanceSemantics(checks, { capability: 'camera-scene-v1', cameraBusinessConstraints: constraints }).valid, true);
  assert.equal(preflightAcceptanceSemantics(JSON.parse(rejectedTesterRaw).checks, { capability: 'camera-scene-v1', cameraBusinessConstraints: constraints }).valid, false);

  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = mkdtempSync(path.join(root, '.city-agent-context-unit-'));
  const store = new ProductionStore(directory);
  let pipeline: ProductionPipeline | undefined;
  t.after(async () => { await pipeline?.stop(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://example.invalid', apiKey: `context-budget-fixture-token-${agent.role}-not-real`, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } });
  store.patchJevConfig({ enabled: true, apiKey: 'context-budget-jev-fixture-token-not-real', minScore: 3, minConfidence: 0.5 });
  const input = productionRunInputSchema.parse({ ...historical.input, agentIds: store.agents().map(agent => agent.id), cameraBusinessConstraints: constraints, limits: { ...historical.input.limits, maxCalls: 30 }, requirement: { ...historical.input.requirement, id: 'FREE-CONTEXT-COUNTERFACTUAL', source: 'Free injected engineering regression; not a real business delivery' } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), jevSnapshot: store.jevConfig(), calls: [], jevCalls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Generic free context fixture', background: '#102030', palette: ['#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 2, 1], count: 120, color: '#ffffff' }], snowCount: 0, mappings: constraints };
  let testerCalls = 0; let gateCalls = 0;
  const roleMeasurements: Array<{ phase: string; bytes: number }> = [];
  const jevMeasurements: Array<{ phase: string; totalBytes: number; perQuestionBytes: number }> = [];
  const frozenHashes: string[] = [];
  const roleCall: typeof runRole = async (agent, system, prompt) => {
    const data = JSON.parse(prompt);
    const role = agent.modelId;
    const phase = data.criteria?.phase ?? (role === 'developer' ? data.context.cycle ? `repair-${data.context.cycle}` : 'implement' : role === 'project-manager' ? data.context.gate ? `feedback-${data.context.cycle}` : 'think-design' : role === 'researcher' ? 'research' : role === 'tester' ? 'acceptance' : role);
    const bytes = Buffer.byteLength(`${system}\n${prompt}`, 'utf8');
    roleMeasurements.push({ phase: `${phase}${role === 'verifier' ? ':verify' : ''}`, bytes });
    assert.ok(bytes <= 60000, `${phase}: role system+user request exceeds 60KB (${bytes})`);
    const context = data.context ?? data.state.reviewContext;
    assert.equal(context.remainingRepairs, input.limits.maxRepairCycles - store.run(run.id)!.repairs);
    if (context.frozenContract) frozenHashes.push(context.frozenContract.hash);
    let text: string;
    if (role === 'verifier') text = JSON.stringify({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Free explicit oracle; no actual model judgment or business-quality proof.' })), reason: 'Injected engineering fixture only.' });
    else if (role === 'product') text = oldCall('product').rawOutput;
    else if (role === 'researcher') text = oldCall('research').rawOutput;
    else if (role === 'project-manager') text = data.context.gate ? JSON.stringify({ decision: data.context.gate.passed ? 'proceed' : 'revise', summary: 'Decide from the actual injected Gate without changing frozen tests.', tasks: [{ id: 'next', owner: 'developer', description: 'Respect frozen acceptance and the shared repair budget.' }], risks: [] }) : oldCall('think-design').rawOutput;
    else if (role === 'tester') text = ++testerCalls === 1 ? rejectedTesterRaw : JSON.stringify({ checks });
    else if (role === 'developer') text = JSON.stringify({ scene });
    else throw new Error('Unexpected injected role');
    return { text, inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected engineering response; no Harness/provider invocation' };
  };
  pipeline = new ProductionPipeline(store, {
    roleCall,
    acceptancePreflight: async () => ({ valid: true, errors: [] }), // Explicit fixture, never actual CSS/browser proof.
    cameraGate: async (_scene, suppliedChecks) => {
      assert.deepEqual(suppliedChecks, checks);
      assert.equal(store.run(run.id)!.repairs, gateCalls === 0 ? 1 : 2);
      gateCalls++;
      return { passed: gateCalls > 1, checks: [{ name: 'Injected engineering Gate, not a real Canvas/device validation', passed: gateCalls > 1 }], evidenceScope: 'scene-behavior-synthetic' };
    },
    jevCall: async (config, context) => {
      // Use the real request constructor and precisely the adapter's byte
      // predicates, but never fetch, contact Jev, or claim a paid result.
      const request = buildJevCandidateRequest(config.modelId, context);
      assert.equal(request.state.requestLayoutVersion, JEV_REQUEST_LAYOUT_VERSION);
      const totalBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
      const stateBytes = Buffer.byteLength(JSON.stringify(request.state), 'utf8');
      const perQuestionBytes = stateBytes + Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question), 'utf8')));
      jevMeasurements.push({ phase: context.phase, totalBytes, perQuestionBytes });
      assert.ok(totalBytes <= 64000, `${context.phase}: Jev request exceeds 64KB (${totalBytes})`);
      assert.ok(perQuestionBytes <= 32000, `${context.phase}: Jev state+question exceeds 32KB (${perQuestionBytes})`);
      const result: JevEvaluation = { policyVersion: JEV_POLICY_VERSION, status: 'uncertain', selectedCandidateId: null, reason: 'Free uncertain oracle forces the independent injected Verifier path.', requestSnapshot: request, rawResponse: { source: 'injected-engineering-no-http' }, scores: [], choice: null, usage: { inputTokens: 100, outputTokens: 0, estimatedCost: 0.0000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 0 };
      return result;
    },
  });
  pipeline.start(store.run(run.id)!);
  const deadline = Date.now() + 10000;
  while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pipeline.busy, false, 'Free injected pipeline must terminate');
  const final = store.run(run.id)!;
  assert.equal(final.status, 'completed', final.error);
  assert.equal(final.evidenceKind, 'injected-test', 'Never count this fixture as autonomous generation success');
  assert.equal(testerCalls, 2);
  assert.equal(gateCalls, 2);
  assert.equal(final.repairs, 2);
  assert.deepEqual(final.repairHistory?.map(repair => repair.kind), ['stage-regeneration', 'gate-repair']);
  assert.equal(final.repairHistory?.[0].frozenHash, null);
  assert.equal(final.repairHistory?.[1].frozenHash, final.frozenContract?.hash);
  assert.equal(jevMeasurements.filter(measurement => measurement.phase === 'acceptance').length, 1, 'Rejected tester response cannot cause a Jev review');
  assert.deepEqual(new Set(jevMeasurements.map(measurement => measurement.phase)), new Set(['product', 'research', 'think-design', 'acceptance', 'implement', 'feedback-0', 'repair-1', 'feedback-1']));
  assert.equal(final.calls.length + final.jevCalls!.length, 25);
  assert.ok(final.calls.every(call => call.executionSource === 'injected'));
  assert.ok(final.jevCalls!.every(call => call.evaluation.providerRequests === 0));
  assert.equal(final.calls.find(call => call.phase === 'acceptance')!.rawOutput, rejectedTesterRaw, 'Preserve the rejected response, not a normalized replacement');
  assert.deepEqual(final.frozenContract?.checks, checks);
  assert.ok(frozenHashes.length && frozenHashes.every(hash => hash === final.frozenContract?.hash));
  assert.equal(final.cameraVerification?.physicalCameraVerified, false);
  assert.equal(final.cameraVerification?.fullRequirementVerified, false);
  assert.deepEqual(readFileSync(historicalPath), historicalBytes, 'Never rewrite historical raw experiment evidence');
  t.diagnostic(JSON.stringify({ source: 'free injected test, no HTTP/model/browser', maxRoleBytes: Math.max(...roleMeasurements.map(item => item.bytes)), maxJevTotalBytes: Math.max(...jevMeasurements.map(item => item.totalBytes)), maxJevPerQuestionBytes: Math.max(...jevMeasurements.map(item => item.perQuestionBytes)), jevStages: jevMeasurements }));
});
