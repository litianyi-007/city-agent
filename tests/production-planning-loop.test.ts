import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { CAMERA_GESTURE_DOM_CONTRACT, ProductionPipeline } from '../server/production/pipeline.ts';
import { ProductionStore, hash } from '../server/production/store.ts';
import { demoChecks, demoHtml } from '../server/production/fixtures.ts';
import { buildJevCandidateRequest } from '../server/production/jev.ts';
import { projectProductionReviewContext } from '../server/production/review-context.ts';
import { contractProfile, PROMPT_VERSION, CAMERA_PROMPT_VERSION } from '../server/production/contracts.ts';
import { productionApiKeySchema, productionRunInputSchema, PRODUCTION_PLANNING_LOOP_VERSION, type ProductionRun } from '../shared/production-schema.ts';
import { CAMERA_DEBOUNCE_FRAMES, CAMERA_RUNTIME_SOURCE, renderCameraSceneHtml } from '../shared/camera-scene-runtime.ts';
import { cameraSceneSchema } from '../shared/camera-scene-schema.ts';

interface FixtureOptions { plans?: Array<'proceed' | 'revise' | 'stop'>; malformedReplan?: boolean; unknownReplan?: boolean; cancelReplan?: boolean; authorityRemoval?: boolean; gatePassed?: boolean; maxCalls?: number; }
async function fixture(t: TestContext, options: FixtureOptions = {}) {
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('No HTTP in planning-loop fixture'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-planning-loop-'));
  const store = new ProductionStore(directory);
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://example.invalid', apiKey: `planning-free-fixture-token-${agent.role}`, pricing: { currency: 'USD', inputPerMillion: 0.3, outputPerMillion: 1.2 } });
  const input = productionRunInputSchema.parse({ brief: 'Create a local task list with independently verified add and completion behavior', mode: 'live', budgetAuthorized: true, verifierEngine: 'llm-rubric', agentIds: store.agents().map(agent => agent.id), limits: { maxCalls: options.maxCalls ?? 30 }, requirement: { id: 'FREE-PLANNING', source: 'Injected engineering fixture; not a business or real-model success', background: 'Test bounded planning handoff', acceptance: 'Keep every task and verify add/completion business results', difficulty: 'low', kind: 'illustrative' } });
  const originalInput = JSON.stringify(input);
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), calls: [], jevCalls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const captures: Array<{ role: string; data: any; value?: unknown }> = [];
  let productCalls = 0; let researchCalls = 0; let planCalls = 0; let gateCalls = 0; let entered!: () => void;
  const pendingReplan = new Promise<void>(resolve => { entered = resolve; });
  const pipeline = new ProductionPipeline(store, {
    roleCall: async (agent, _system, prompt, signal) => {
      const role = agent.modelId; const data = JSON.parse(prompt); const capture: { role: string; data: any; value?: unknown } = { role, data }; captures.push(capture);
      assert.equal(JSON.stringify(data.input ?? input), originalInput, 'Original requirement/permission/budget cannot be rewritten during replanning');
      let value: unknown;
      if (role === 'verifier') {
        const facts = data.state.reviewContext.planningReviewContext;
        const rejectInventedResolution = options.authorityRemoval && data.criteria.phase === 'research' && facts;
        if (rejectInventedResolution) { assert.deepEqual(facts.priorResearch, { observations: ['The necessary external source has not been supplied'], constraints: ['Missing required permission cannot be guessed'], unknowns: ['blocking: obtain the real external source and permission'] }); assert.equal(facts.priorPlan.decision, 'revise'); }
        value = { decision: rejectInventedResolution ? 'abstain' : 'accept', selectedCandidateId: rejectInventedResolution ? null : data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: rejectInventedResolution ? 1 : 4, reason: rejectInventedResolution ? 'Injected oracle rejects invented resolution using the entire original research and PM evidence' : 'Free injected oracle; no actual quality proof' })), reason: 'Independent fixture only' };
      }
      else if (role === 'product') {
        productCalls++;
        if (productCalls === 2 && options.cancelReplan) { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled injected replanning')), { once: true })); }
        if (productCalls === 2 && options.malformedReplan) return { text: '{ malformed', inputTokens: 1, outputTokens: 1, usageReported: true, harness: 'Injected malformed fixture' };
        value = { goal: input.brief, scope: 'offline-single-html', acceptance: [input.requirement.acceptance, productCalls === 1 ? 'Authorized layout details remain to be specified' : 'Concrete default title: Task list; retain all business constraints'], exclusions: ['No external network or host execution'] };
      } else if (role === 'researcher') { researchCalls++; value = options.authorityRemoval ? researchCalls === 1 ? { observations: ['The necessary external source has not been supplied'], constraints: ['Missing required permission cannot be guessed'], unknowns: ['blocking: obtain the real external source and permission'] } : { observations: ['Claimed external conditions solved without evidence'], constraints: ['Only offline HTML'], unknowns: [] } : { observations: ['Use the complete supplied product goals'], constraints: ['Only offline HTML; concrete default title Task list'], unknowns: ['deferred: real-model reliability unverified'] }; }
      else if (role === 'project-manager') { const decision = data.context.gate ? data.context.gate.passed ? 'proceed' : 'revise' : (options.plans ?? ['revise', 'proceed'])[Math.min(planCalls++, (options.plans ?? ['revise', 'proceed']).length - 1)]; value = { decision, summary: decision === 'revise' ? 'Product must specify authorized design defaults, not ask for unnecessary user input' : decision === 'stop' ? 'Required external authority is absent; stop' : 'Current plan is actionable; final Gate still required', tasks: [{ id: 'design', owner: 'product', description: 'Choose exact permitted defaults without changing user requirements' }], risks: ['Physical or outside-scope evidence cannot be invented'] }; }
      else if (role === 'tester') { assert.equal(store.run(run.id)!.outputs.filter(output => output.phase === 'think-design').at(-1)?.value && (store.run(run.id)!.outputs.filter(output => output.phase === 'think-design').at(-1)!.value as any).decision, 'proceed'); value = { checks: demoChecks('create') }; }
      else if (role === 'developer') { assert.ok(store.run(run.id)!.frozenContract, 'No development before approval and freeze'); value = { html: demoHtml(input) }; }
      else throw new Error('Unexpected role');
      capture.value = value;
      return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: !(role === 'product' && productCalls === 2 && options.unknownReplan), harness: 'Injected planning fixture, zero model HTTP' };
    },
    acceptancePreflight: async () => ({ valid: true, errors: [] }),
    gate: async (_html, checks) => { gateCalls++; assert.deepEqual(checks, demoChecks('create')); return { passed: options.gatePassed !== false, checks: [{ name: 'Injected Gate; not browser evidence', passed: options.gatePassed !== false }] }; },
  });
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  const start = () => pipeline.start(store.run(run.id)!);
  const wait = async () => { const deadline = Date.now() + 10000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(pipeline.busy, false); const final = store.run(run.id)!; assert.equal(JSON.stringify(final.input), originalInput); return final; };
  return { store, run, captures, pipeline, start, wait, pendingReplan, counts: () => ({ productCalls, planCalls, gateCalls }) };
}

test('PM revise runs the same product/research/PM again before freeze, retaining raw provenance and planning version', async t => {
  const f = await fixture(t); f.start(); const run = await f.wait();
  assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.repairs, 1); assert.equal(run.repairHistory![0].kind, 'stage-regeneration'); assert.equal(run.repairHistory![0].role, 'project-manager'); assert.equal(run.repairHistory![0].frozenHash, null);
  assert.deepEqual(f.captures.filter(capture => capture.role !== 'verifier').slice(0, 6).map(capture => capture.role), ['product', 'researcher', 'project-manager', 'product', 'researcher', 'project-manager']);
  const originalPlan = run.outputs.filter(output => output.phase === 'think-design')[0]; const planCall = run.calls.find(call => call.candidateId === originalPlan.selectedCandidateId)!;
  for (const capture of f.captures.filter(capture => capture.role !== 'verifier').slice(3, 6)) {
    const feedback = capture.data.context.regeneration.planningFeedback;
    assert.equal(feedback.version, PRODUCTION_PLANNING_LOOP_VERSION); assert.equal(feedback.sourceRoleCallId, planCall.id); assert.equal(feedback.sourceCandidateId, planCall.candidateId);
    assert.deepEqual(feedback.previous.product, f.captures[0].value); assert.deepEqual(feedback.previous.research, f.captures.find(capture => capture.role === 'researcher')!.value); assert.deepEqual(feedback.previous.plan, originalPlan.value);
    assert.deepEqual(capture.data.context.planningReviewContext, { version: PRODUCTION_PLANNING_LOOP_VERSION, sourceRoleCallId: planCall.id, sourceCandidateId: planCall.candidateId, priorResearch: JSON.parse(planCall.userPrompt).context.research, priorPlan: JSON.parse(planCall.rawOutput) });
    assert.equal(capture.data.context.remainingRepairs, 1);
  }
  for (const verifier of f.captures.filter(capture => capture.role === 'verifier' && capture.data.state.reviewContext.generationFeedbackReference)) {
    const review = verifier.data.state.reviewContext; assert.equal(Object.hasOwn(review, 'regeneration'), false);
    const call = run.calls.find(call => call.candidateId === verifier.data.candidates[0].id)!;
    assert.equal(review.generationFeedbackReference.sha256, hash(JSON.parse(call.userPrompt).context.regeneration)); assert.deepEqual(review.generationFeedbackReference.sourceRoleCallIds, [call.id]);
    assert.deepEqual(review.planningReviewContext.priorResearch, JSON.parse(planCall.userPrompt).context.research); assert.deepEqual(review.planningReviewContext.priorPlan, JSON.parse(planCall.rawOutput));
  }
  assert.deepEqual(run.frozenContract!.checks, demoChecks('create')); assert.equal(run.validationContract!.planningLoopVersion, PRODUCTION_PLANNING_LOOP_VERSION);
  assert.equal(JSON.parse(f.store.readArtifact(run.id, 'delivery-manifest.json')).validationContract.planningLoopVersion, PRODUCTION_PLANNING_LOOP_VERSION);
  assert.equal(run.frozenContract!.validationContractHash, hash(run.validationContract));
});

test('PM stop never retries, freezes or develops', async t => {
  const f = await fixture(t, { plans: ['stop'] }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /项目经理stop/); assert.equal(run.repairs, 0); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0); assert.equal(run.calls.some(call => ['tester', 'developer'].includes(call.role)), false);
});

test('repeated valid PM revise consumes exactly two global repairs and preserves all three negative plans', async t => {
  const f = await fixture(t, { plans: ['revise'] }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.repairs, 2); assert.equal(f.counts().planCalls, 3); assert.equal(run.outputs.filter(output => output.phase === 'think-design').length, 3); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
});

test('replanned-role schema rejection retains original PM feedback and shares the two-attempt pool with Gate repair', async t => {
  const f = await fixture(t, { malformedReplan: true, gatePassed: false }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.repairs, 2); assert.deepEqual(run.repairHistory!.map(repair => repair.role), ['project-manager', 'product']); assert.equal(f.counts().productCalls, 3); assert.equal(f.counts().gateCalls, 1); assert.equal(run.calls.filter(call => call.role === 'developer').length, 1);
  const productPrompts = f.captures.filter(capture => capture.role === 'product').map(capture => capture.data.context);
  assert.deepEqual(productPrompts[2].regeneration.planningFeedback, productPrompts[1].regeneration.planningFeedback); assert.equal(productPrompts[2].remainingRepairs, 0);
  assert.deepEqual(run.frozenContract!.checks, demoChecks('create')); assert.equal(run.gateHistory[0].passed, false);
});

test('unknown usage during replanning stops immediately without guessing free use or spending another repair', async t => {
  const f = await fixture(t, { unknownReplan: true }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /usage.*unknown/); assert.equal(run.repairs, 1); assert.equal(f.counts().productCalls, 2); assert.equal(f.counts().planCalls, 1); assert.equal(run.calls.filter(call => call.role === 'researcher').length, 1); assert.equal(run.frozenContract, undefined); assert.equal(run.usage.estimatedCost, null);
});

test('prior external blockers in observations, constraints and unknowns remain visible to independent review when a new candidate removes them', async t => {
  const f = await fixture(t, { authorityRemoval: true }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.repairs, 2); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
  assert.equal(run.calls.some(call => ['tester', 'developer'].includes(call.role)), false);
  const reviews = f.captures.filter(capture => capture.role === 'verifier' && capture.data.criteria.phase === 'research' && capture.data.state.reviewContext.planningReviewContext);
  assert.equal(reviews.length, 2); assert.ok(reviews.every(review => (review.value as any).decision === 'abstain'));
  t.diagnostic('Fixture oracle only: proves intact prior evidence is delivered to the reviewer, not real LLM semantic classification or an automatic host text classifier.');
});

test('cancel during replanning aborts the current role and never proceeds to research/freeze/development', async t => {
  const f = await fixture(t, { cancelReplan: true }); f.start(); await f.pendingReplan; f.pipeline.cancel(f.run.id); const run = await f.wait();
  assert.equal(run.status, 'cancelled'); assert.equal(run.repairs, 1); assert.equal(run.interventions.length, 1); assert.equal(f.counts().planCalls, 1); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
});

test('planning uses the original request budget and the generic prompts distinguish free design choices from missing authority', async t => {
  const f = await fixture(t, { maxCalls: 12 }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /请求次数预算耗尽/); assert.equal(run.calls.length, 12); assert.equal(run.repairs, 1); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
  assert.equal(PROMPT_VERSION, 'production-html-v9'); assert.equal(CAMERA_PROMPT_VERSION, 'production-camera-scene-v7');
  for (const capability of ['offline-single-html', 'camera-scene-v1'] as const) { const profile = contractProfile(capability); assert.match(profile.instructions.product, /自主选择具体默认值/); assert.match(profile.instructions['project-manager'], /真正超出能力、缺权限或外部必需输入时stop/); }
  for (const value of ['planningLoopVersion', PRODUCTION_PLANNING_LOOP_VERSION, 'planningFeedback', 'planningReviewContext', 'sourceRoleCallId', 'sourceCandidateId']) assert.equal(productionApiKeySchema.safeParse(value).success, false);
});

test('actual CAMERA07 full outputs plus a counterfactual planning handoff fit current Jev review caps without rewriting historical bytes', t => {
  const file = new URL('../docs/production/experiments/CAMERA-07/run.json', import.meta.url); const bytes = readFileSync(file); assert.equal(createHash('sha256').update(bytes).digest('hex'), 'bb2cb22cad787d1fedc332b690983730733317c09d30bef93d931f7fb3609f55');
  const run = JSON.parse(bytes.toString('utf8')) as ProductionRun;
  const actual = Object.fromEntries(run.outputs.map(output => [output.phase, output.value]));
  const planOutput = run.outputs.find(output => output.phase === 'think-design')!; const planCall = run.calls.find(call => call.candidateId === planOutput.selectedCandidateId)!;
  const feedback = { attempt: 1, rejectedCandidateIds: [planOutput.selectedCandidateId], frozenHash: null, policyVersion: 'production-global-repair-v1', planningFeedback: { version: PRODUCTION_PLANNING_LOOP_VERSION, sourceRoleCallId: planCall.id, sourceCandidateId: planOutput.selectedCandidateId, previous: { product: actual.product, research: actual.research, plan: actual['think-design'] } } };
  const measurements: Array<{ phase: string; generationContextBytes: number; totalBytes: number; maxPerQuestionBytes: number }> = [];
  for (const phase of ['product', 'research', 'think-design']) {
    const oldRequest = run.jevCalls!.find(call => call.phase === phase)!.evaluation.requestSnapshot!;
    // Keep every actual current/upstream value. Only inject the new prior-plan
    // handoff as a free counterfactual; no real answer is rewritten to proceed.
    const originalReview = structuredClone(oldRequest.state.reviewContext) as Record<string, any>;
    originalReview.knownPlatform.fixedDom.gestureMap = CAMERA_GESTURE_DOM_CONTRACT;
    const generationContext = { ...originalReview, regeneration: feedback, planningReviewContext: { version: PRODUCTION_PLANNING_LOOP_VERSION, sourceRoleCallId: planCall.id, sourceCandidateId: planOutput.selectedCandidateId, priorResearch: actual.research, priorPlan: actual['think-design'] } };
    const projection = projectProductionReviewContext(generationContext, ['free-current-role-call']);
    const context = { ...oldRequest.state, reviewContext: { ...projection.reviewContext, reviewContextVersion: projection.version } };
    const request = buildJevCandidateRequest(oldRequest.model, context);
    const totalBytes = Buffer.byteLength(JSON.stringify(request)); const stateBytes = Buffer.byteLength(JSON.stringify(request.state)); const maxPerQuestionBytes = stateBytes + Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question))));
    assert.ok(totalBytes <= 64000); assert.ok(maxPerQuestionBytes <= 32000); assert.equal(JSON.stringify(request.state.candidates), JSON.stringify(oldRequest.state.candidates));
    for (const [key, value] of Object.entries(originalReview).filter(([key]) => key !== 'reviewContextVersion')) assert.deepEqual((request.state.reviewContext as Record<string, unknown>)[key], value);
    assert.equal((request.state.reviewContext as Record<string, unknown>).reviewContextVersion, projection.version, 'Counterfactual uses the new projection version; archived review bytes remain unchanged');
    measurements.push({ phase, generationContextBytes: Buffer.byteLength(JSON.stringify(generationContext)), totalBytes, maxPerQuestionBytes });
  }
  assert.deepEqual(readFileSync(file), bytes);
  t.diagnostic(JSON.stringify({ source: 'Free counterfactual using actual full CAMERA07 outputs, not a successful replanning experiment', measurements }));
});

test('fixed gesture text contract matches the actual trusted renderer formula and its runtime debounce, not a user-required design decision', () => {
  assert.equal(CAMERA_GESTURE_DOM_CONTRACT.debounceFrames, CAMERA_DEBOUNCE_FRAMES);
  // No browser or generated code execution: bind the documented labels to the
  // literal trusted source expression, then verify all four legal configurations.
  // tsx/esbuild may emit equivalent Unicode escapes and quote/spacing styles.
  // Decode only those literal characters, never evaluate the source.
  const unicodeSource = CAMERA_RUNTIME_SOURCE.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  assert.match(unicodeSource, /`张掌 → \$\{scene\.mappings\.openPalm\}；握拳 → \$\{scene\.mappings\.closedFist\}；手掌横移 → \$\{scene\.mappings\.palmX\s*===\s*['"]rotate['"]\s*\?\s*['"]旋转['"]\s*:\s*['"]不启用旋转['"]\}。连续 \$\{config\.debounceFrames\} 帧确认，几何门限未进行人群准确率校准。`/);
  const labels: string[] = [];
  for (const openPalm of ['scatter', 'gather'] as const) for (const palmX of ['rotate', 'none'] as const) {
    const closedFist = openPalm === 'scatter' ? 'gather' : 'scatter';
    labels.push(`张掌 → ${openPalm}；握拳 → ${closedFist}；手掌横移 → ${palmX === 'rotate' ? '旋转' : '不启用旋转'}。连续 ${CAMERA_DEBOUNCE_FRAMES} 帧确认，几何门限未进行人群准确率校准。`);
    const scene = cameraSceneSchema.parse({ version: 'camera-scene-v1', title: 'Fixture only', background: '#102030', palette: ['#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 1, 1], count: 20, color: '#ffffff' }], snowCount: 0, mappings: { openPalm, closedFist, palmX } });
    assert.ok(renderCameraSceneHtml(scene).includes(`"debounceFrames":${CAMERA_DEBOUNCE_FRAMES}`));
  }
  assert.deepEqual(CAMERA_GESTURE_DOM_CONTRACT.labels, labels);
});
