import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { chromium } from 'playwright';
import { productionPhaseRubric, phaseVerifierSystemPrompt, PRODUCTION_VERIFIER_VERSION } from '../shared/production-verifier-rubric.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { JEV_POLICY_VERSION, JEV_MODEL_ID, jevConfigSchema, type JevEvaluation, type JevCandidateContext, type SecretJevConfig } from '../shared/jev-schema.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';
import { createProductionService } from '../server/production/index.js';
import { PROMPT_VERSION, CAMERA_PROMPT_VERSION, CRITERIA_VERSION, researchSchema, testsSchema, parseVerifiedDecision } from '../server/production/contracts.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { runRole } from '../server/harness.js';
import { renderCameraSceneHtml } from '../shared/camera-scene-runtime.js';
import type { CameraSceneConfig } from '../shared/camera-scene-schema.js';

const groundedResearch = { observations: ['Use the supplied offline HTML scope: keep task state in memory, update the task list and exact count after an add, and test blank input separately.'], constraints: ['No external packages, network or host execution; freeze independent result assertions before development.'], unknowns: ['deferred: actual model reliability across unseen requirements is not measured.'] };
const emptyResearch = { observations: ['The user wants an app.'], constraints: ['Implementation unknown.'], unknowns: ['Everything is unknown.'] };
const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Free context fixture', background: '#102030', palette: ['#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 2, 1], count: 20, color: '#ffffff' }], snowCount: 0, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };

function jevFixture(config: SecretJevConfig, context: JevCandidateContext, status: 'accepted' | 'uncertain' = 'accepted'): JevEvaluation {
  return { policyVersion: JEV_POLICY_VERSION, status, selectedCandidateId: status === 'accepted' ? context.candidates[0].id : null, reason: 'Injected phase oracle, no provider request or correctness claim', requestSnapshot: buildJevCandidateRequest(config.modelId, context), rawResponse: { source: 'injected-engineering' }, scores: [], choice: null, usage: { inputTokens: 100, outputTokens: 0, estimatedCost: 0.0000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1 };
}

function roleFixture(options: { research?: typeof groundedResearch; rejectEmpty?: boolean; invalidCameraProduct?: boolean; feedbackProceedOnFailure?: boolean } = {}): typeof runRole {
  return async (_agent, system, prompt) => {
    const data = JSON.parse(prompt); let value: unknown;
    if (system.startsWith('你是独立质量Verifier')) {
      assert.equal(data.criteria.version, PRODUCTION_VERIFIER_VERSION);
      const rubric = productionPhaseRubric(data.criteria.phase, data.criteria.capability)!;
      assert.ok(system.includes(rubric.dimensions.coverage));
      assert.ok(data.state.reviewContext.knownPlatform);
      const rejected = options.rejectEmpty && data.criteria.phase === 'research';
      if (data.criteria.phase === 'research') {
        assert.equal(data.state.reviewContext.product.goal, 'Build a small task list');
        assert.equal(data.state.reviewContext.knownPlatform.output, 'complete inline HTML5 with no external resources');
        assert.equal('scene' in data.candidates[0].value, false);
        assert.equal('checks' in data.candidates[0].value, false);
      }
      value = { decision: rejected ? 'abstain' : 'accept', selectedCandidateId: rejected ? null : data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: rejected ? 1 : 4, reason: rejected ? 'Injected negative oracle: only paraphrase and all unknown; not a true model judgment.' : 'Injected positive oracle: current-stage fixture, not a true model judgment.' })), reason: 'Free explicit oracle, does not establish LLM semantic accuracy' };
    } else if (system.includes('"goal"')) value = options.invalidCameraProduct ? { invalid: true } : { goal: data.input.brief, scope: data.input.capability, acceptance: [data.input.requirement.acceptance], exclusions: ['Actual reliability and physical devices are unverified'] };
    else if (system.includes('"observations"')) value = options.research ?? groundedResearch;
    else if (system.includes('"decision"')) value = { decision: data.context.gate?.passed === false && !options.feedbackProceedOnFailure ? 'revise' : 'proceed', summary: 'Bounded injected engineering plan', tasks: [{ id: 'build', owner: 'developer', description: 'Implement the frozen interaction contract' }], risks: [] };
    else if (system.includes('"checks"')) value = { checks: demoChecks('create') };
    else value = { html: demoHtml(data.input) };
    return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'injected-free-engineering-test' };
  };
}

function setup(t: TestContext, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-phase-unit-'));
  const service = createProductionService(directory, { roleCall: roleFixture(), gate: async () => ({ passed: true, checks: [{ name: 'Injected Gate, not real browser proof', passed: true }] }), ...options });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `phase-unit-token-${agent.role}-not-real`, pricing: { currency: 'USD', inputPerMillion: 1, outputPerMillion: 1 } });
  service.store.patchJevConfig({ enabled: true, apiKey: 'phase-jev-unit-token-not-real', minScore: 3, minConfidence: 0.5 });
  const start = async (overrides: Record<string, unknown> = {}) => {
    const input = productionRunInputSchema.parse({ mode: 'live', brief: 'Build a small task list', agentIds: service.store.agents().map(agent => agent.id), budgetAuthorized: true, requirement: { id: 'phase-fixture', source: 'Free injected phase-contract test', acceptance: 'Add tasks; reject blank input; show exact counts', kind: 'illustrative' }, ...overrides });
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: service.store.agents(), jevSnapshot: service.store.jevConfig(), calls: [], jevCalls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
    service.store.addRun(run, input.agentIds); service.pipeline.start(run);
    const deadline = Date.now() + 20000;
    while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(service.pipeline.busy, false, 'Free phase fixture did not finish'); return service.store.run(run.id)!;
  };
  return { service, start };
}

test('six production stages and bounded repair phases have a versioned rubric; independent benchmark remains whole-answer', () => {
  assert.equal(PROMPT_VERSION, 'production-html-v7'); assert.equal(CAMERA_PROMPT_VERSION, 'production-camera-scene-v6'); assert.equal(CRITERIA_VERSION, 'verifier-phase-ordinal-v4');
  for (const [phase, stage] of [['product', 'product'], ['research', 'research'], ['think-design', 'plan'], ['acceptance', 'acceptance'], ['implement', 'implementation'], ['repair-2', 'implementation'], ['feedback-2', 'feedback']]) {
    const rubric = productionPhaseRubric(phase)!; assert.equal(rubric.stage, stage); assert.equal(rubric.minimumOrdinalScore, 3); assert.equal(rubric.version, PRODUCTION_VERIFIER_VERSION);
  }
  for (const phase of ['developer', 'whole-answer', 'repair-3', 'feedback-3']) assert.equal(productionPhaseRubric(phase), null);
  const legacy = buildJevCandidateRequest(JEV_MODEL_ID, { phase: 'developer', goal: 'benchmark', acceptance: 'complete answer', frozenHash: null, candidates: [{ id: 'a', value: 'answer' }] });
  assert.equal(legacy.state.phaseReview, undefined); assert.doesNotMatch(JSON.stringify(legacy), /verifier-phase-ordinal-v4/);
});

test('Jev and LLM share exact stage dimensions and context path, without asking research for future artifacts', () => {
  for (const phase of ['product', 'research', 'think-design', 'acceptance', 'implement', 'feedback-0']) {
    const rubric = productionPhaseRubric(phase, 'camera-scene-v1')!;
    const context = { phase, goal: 'scene', acceptance: 'camera still pending', frozenHash: null, capability: 'camera-scene-v1' as const, reviewContext: { product: { goal: 'scene' }, knownPlatform: { fullRequirementVerified: false } }, candidates: [{ id: 'a', value: phase === 'research' ? groundedResearch : {} }] };
    const request = buildJevCandidateRequest(JEV_MODEL_ID, context); assert.deepEqual(request.state.phaseReview, rubric); assert.deepEqual(request.state.reviewContext, context.reviewContext);
    for (const dimension of ['coverage', 'consistency', 'scope'] as const) {
      assert.ok(request.questions[`c0_${dimension}`].instructions.includes(`state.phaseReview.dimensions.${dimension}`)); assert.equal(request.state.phaseReview!.dimensions[dimension], rubric.dimensions[dimension]); assert.ok(phaseVerifierSystemPrompt(rubric).includes(rubric.dimensions[dimension]));
    }
  }
  const research = productionPhaseRubric('research', 'camera-scene-v1')!;
  assert.match(research.dimensions.coverage, /Do not require scene config, application implementation, frozen tests or physical-device evidence/);
  assert.match(research.dimensions.coverage, /Reject an empty all-unknown response/); assert.match(research.dimensions.coverage, /actionable advice/);
  assert.equal(researchSchema.safeParse(groundedResearch).success, true); assert.equal(researchSchema.safeParse(emptyResearch).success, true, 'Schema checks structure, not semantic quality; verifier remains necessary');
});

test('acceptance expects only legal checks; deferred hardware scope lives in supplied context, not forbidden new fields', () => {
  const rubric = productionPhaseRubric('acceptance', 'camera-scene-v1')!; assert.match(rubric.expectedArtifact, /Strict \{checks\}/); assert.match(rubric.expectedArtifact, /not extra candidate fields/);
  const candidate = { checks: demoChecks('create') }; assert.equal(testsSchema.safeParse(candidate).success, true); assert.equal(testsSchema.safeParse({ ...candidate, deferredCoverage: ['hardware'] }).success, false);
  assert.match(rubric.dimensions.coverage, /rather than demanding camera permissions in the synthetic Gate/);
});

test('free positive research oracle completes injected pipeline with identical context and versioned review ledger', async t => {
  const { start } = setup(t); const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test');
  const reviewCall = run.calls.find(call => call.phase === 'research:verify')!; const payload = JSON.parse(reviewCall.userPrompt);
  assert.equal(payload.state.reviewContext.product.goal, run.input.brief); assert.equal(payload.criteria.phaseReview.stage, 'research'); assert.equal(payload.criteria.version, CRITERIA_VERSION); assert.equal(payload.criteria.reviewContext, undefined);
  assert.equal(run.calls.every(call => call.promptVersion === PROMPT_VERSION), true); assert.equal(run.verifications.every(review => /^[a-f0-9]{64}$/.test(review.criteriaHash)), true);
  assert.equal(run.verifications.find(review => review.phase === 'research')!.decision, 'accept');
});

test('structurally legal all-unknown research can abstain without template fallback or advancing to development', async t => {
  const { start } = setup(t, { roleCall: roleFixture({ research: emptyResearch, rejectEmpty: true }) }); const run = await start();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /research Verifier 弃权/); assert.equal(run.verifications.at(-1)!.scores[0].score, 1); assert.equal(run.calls.some(call => call.role === 'developer' || call.role === 'tester'), false); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

test('uncertain research Jev falls back once using the same product/platform context and no future-code requirement', async t => {
  const contexts: JevCandidateContext[] = []; const { start } = setup(t, { jevCall: async (config, context) => { contexts.push(context); return jevFixture(config, context, context.phase === 'research' ? 'uncertain' : 'accepted'); } });
  const run = await start({ verifierEngine: 'jev-cascade' }); assert.equal(run.status, 'completed', run.error); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 1); assert.equal(run.verifications.find(review => review.engine === 'jev-llm-fallback')!.phase, 'research');
  const context = contexts.find(context => context.phase === 'research')!; const payload = JSON.parse(run.calls.find(call => call.phase === 'research:verify')!.userPrompt); assert.deepEqual(payload.state.reviewContext, context.reviewContext);
  assert.equal(run.jevCalls!.find(call => call.phase === 'research')!.evaluation.requestSnapshot!.state.phaseReview!.version, PRODUCTION_VERIFIER_VERSION); assert.equal(run.evidenceKind, 'injected-test');
});

test('registered production rejects lowered Jev thresholds before any role or evaluator invocation, without clamping', async t => {
  for (const patch of [{ minScore: 2.9 }, { minConfidence: 0.49 }]) {
    let calls = 0; const { service, start } = setup(t, { roleCall: async (...args) => { calls++; return roleFixture()(...args); }, jevCall: async (config, context) => { calls++; return jevFixture(config, context); } });
    service.store.patchJevConfig(patch); const run = await start({ verifierEngine: 'jev-cascade' }); assert.equal(run.status, 'failed'); assert.match(run.error!, /最低评分门限/); assert.equal(calls, 0); assert.equal(run.calls.length, 0); assert.equal(run.jevCalls!.length, 0);
    for (const [field, value] of Object.entries(patch)) assert.equal((service.store.jevConfig() as unknown as Record<string, unknown>)[field], value);
  }
  assert.equal(jevConfigSchema.parse({ minScore: 2, minConfidence: 0.2 }).minScore, 2, 'Independent benchmark configuration remains configurable; no global numerical policy clamp');
});

test('oversized phase review context is rejected before HTTP and is never silently truncated', async () => {
  let requests = 0; const config = { ...jevConfigSchema.parse({ enabled: true }), apiKey: 'phase-overflow-fixture-token-not-real', hasApiKey: true };
  const marker = 'context-is-untrusted-'.repeat(4000); const result = await evaluateJevCandidates(config, { phase: 'research', goal: 'scene', acceptance: 'input preserved', frozenHash: null, reviewContext: { product: { goal: marker } }, candidates: [{ id: 'a', value: groundedResearch }] }, new AbortController().signal, { fetch: async () => { requests++; throw new Error('Must not reach HTTP'); } });
  assert.equal(result.status, 'error'); assert.equal(requests, 0); assert.equal(result.providerRequests, 0); assert.match(result.error!, /evidence was not truncated/); assert.equal((result.requestSnapshot!.state.reviewContext as { product: { goal: string } }).product.goal, marker);
});

test('camera review context describes fixed Gate-mode DOM exactly and never requests real media permission', async t => {
  let known: Record<string, any> | undefined; const { start } = setup(t, { roleCall: async (...args) => { known = JSON.parse(args[2]).context.knownPlatform; return roleFixture({ invalidCameraProduct: true })(...args); } });
  const run = await start({ capability: 'camera-scene-v1' }); assert.equal(run.status, 'failed'); assert.ok(known);
  assert.equal(known.fixedDom.rotation.initialText, '0.0000'); assert.equal(known.fixedDom.rotation.afterOneRightFromZero, '0.3927'); assert.equal(known.fixedDom.cameraStart.gateDisabled, true); assert.equal(known.verificationBoundary.physicalCameraVerified, false); assert.equal(known.verificationBoundary.fullRequirementVerified, false);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' }); await context.route('**/*', route => route.abort()); const page = await context.newPage(); await page.setContent(renderCameraSceneHtml(scene, { mode: 'gate' }), { timeout: 10000 });
    assert.equal(await page.locator(known.fixedDom.cameraStatus.gateInitialSelector).textContent(), known.fixedDom.cameraStatus.gateInitialText); assert.equal(await page.locator(known.fixedDom.interactionSource.selector).textContent(), known.fixedDom.interactionSource.initialText); assert.equal(await page.locator(known.fixedDom.rotation.selector).textContent(), known.fixedDom.rotation.initialText); assert.equal(await page.locator(known.fixedDom.cameraStart.selector).isDisabled(), true);
    await page.locator('#rotate-right').click(); assert.equal(await page.locator(known.fixedDom.rotation.selector).textContent(), known.fixedDom.rotation.afterOneRightFromZero);
  } finally { await browser.close(); }
  assert.equal(run.calls[0].promptVersion, CAMERA_PROMPT_VERSION); assert.equal(run.cameraVerification!.physicalCameraVerified, false);
});

test('stage-aware feedback cannot overturn a failed hard Gate, and ordinal minimum/highest/abstain rules remain unchanged', async t => {
  const rubric = productionPhaseRubric('feedback-0')!; assert.match(rubric.dimensions.coverage, /Failed Gate permits revise or stop, never proceed/);
  const { start } = setup(t, { roleCall: roleFixture({ feedbackProceedOnFailure: true }), gate: async () => ({ passed: false, checks: [{ name: 'actual controlled failure', passed: false }] }) }); const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /Gate失败时交付/); assert.equal(run.repairs, 0); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
  const decision = { decision: 'accept', selectedCandidateId: 'a', scores: [{ candidateId: 'a', score: 2, reason: 'weak' }], reason: 'test' }; assert.throws(() => parseVerifiedDecision(decision, ['a'])); assert.throws(() => parseVerifiedDecision({ ...decision, scores: [{ candidateId: 'a', score: 3, reason: 'partial' }, { candidateId: 'b', score: 4, reason: 'higher' }] }, ['a', 'b'])); assert.equal(parseVerifiedDecision({ ...decision, decision: 'abstain', selectedCandidateId: null }, ['a']).decision, 'abstain');
});
