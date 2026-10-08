import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createProductionService } from '../server/production/index.js';
import { hash } from '../server/production/store.js';
import { OUTPUT_DIAGNOSTICS_VERSION } from '../server/production/output-diagnostics.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { runRole, RoleResult } from '../server/harness.js';
import { preflightAcceptanceChecks, runGate, type AcceptanceCheck } from '../server/gate.js';
import { ACCEPTANCE_GROUP_INSTRUCTIONS } from '../server/production/contracts.js';
import { ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_CONSTRUCTION_VERSION, ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS, acceptancePlanHash, type AcceptanceGroup, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, productionApiKeySchema, productionRunInputSchema, type ProductionRun, type ProductionRunInput } from '../shared/production-schema.js';

// All role responses are explicit injected engineering fixtures, never SDK or
// provider calls. Preflight/Gate are stubs except in the named real Chromium
// case, which executes only test-authored inline HTML and frozen fixture checks.
// Fabricated usage and accepted fixture verdicts are not model-quality data.
const brief = 'Build an offline list with exact item addition.';
const acceptance = 'Adding an item shows its exact text and count. Empty input must not add a record.';
function planFixture(groupCount = 2): AcceptancePlan {
  return {
    version: ACCEPTANCE_PLAN_VERSION,
    obligations: [
      { id: 'o-brief', source: 'brief', quote: 'offline list', scenario: 'Each check starts on a new page.', expected: 'Add an item with an exact result.' },
      { id: 'o-acceptance', source: 'acceptance', quote: 'Empty input must not add a record.', scenario: 'Independent empty-input state.', expected: 'No new record.' },
    ],
    groups: Array.from({ length: groupCount }, (_, i) => ({ id: `g${i + 1}`, checks: [{ id: `c${i + 1}`, obligationIds: i === 1 ? ['o-acceptance'] : ['o-brief'], setup: 'Independent new page and explicit valid other inputs.', exercise: 'Fill the input and click the registered button.', assertions: 'Check the actual business text and item count.', stepBudget: 5 }] })),
  };
}
function checkFixture(id: string): AcceptanceCheck {
  return { name: `Injected check ${id}`, steps: [
    { action: 'fill', selector: '#input', value: id },
    { action: 'click', selector: '#add' },
    { action: 'assertCount', selector: '.item', count: 1 },
    { action: 'assertTextExact', selector: '#result', text: id },
    { action: 'assertTextExact', selector: '.item .label', text: id },
  ] };
}
const result = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected grouped-construction fixture; no provider request' });
type Capture = { phase: string; data: any; signal: AbortSignal; result: RoleResult };
type Hook = (capture: Capture) => RoleResult | undefined | Promise<RoleResult | undefined>;
interface FixtureOptions { groups?: number; hook?: Hook; preflight?: ProductionOptions['acceptancePreflight']; gate?: ProductionOptions['gate']; input?: Partial<ProductionRunInput>; }
function fixture(t: TestContext, options: FixtureOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-groups-test-'));
  const captures: Capture[] = []; let preflights = 0; let gates = 0;
  const roleCall: typeof runRole = async (_agent, _system, prompt, signal) => {
    const data = JSON.parse(prompt); const fields = data.outputContract.jsonSchema.properties;
    let phase: string; let value: unknown;
    if (data.candidates) {
      phase = `${data.criteria.phase}:verify`;
      value = { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected verdict, not a real semantic Oracle' })), reason: 'Free fixture verdict only' };
    } else if (data.context?.plannedGroup) {
      const group = data.context.plannedGroup; phase = `acceptance-group-${group.id}`;
      value = { version: ACCEPTANCE_GROUP_VERSION, planHash: data.context.acceptancePlanHash, attemptId: data.context.constructionAttemptId, groupId: group.id, checks: group.checks.map((slot: { id: string }) => ({ checkId: slot.id, check: checkFixture(slot.id) })) };
    } else if (fields.obligations && fields.groups) { phase = 'acceptance-plan'; value = planFixture(options.groups); }
    else if (fields.goal) { phase = 'product'; value = { goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] }; }
    else if (fields.observations) { phase = 'research'; value = { observations: ['Independent setup with exact business assertions.'], constraints: ['Offline single HTML and an unchanged final Gate.'], unknowns: [] }; }
    else if (fields.decision) { phase = data.context?.gate ? 'feedback' : 'think-design'; value = { decision: 'proceed', summary: 'Injected engineering plan only.', tasks: [{ id: 'test', owner: 'tester', description: 'Define independent checks and keep all original requirements.' }], risks: [] }; }
    else if (fields.checks) { phase = 'acceptance'; value = { checks: [checkFixture('c1'), checkFixture('c2')] }; }
    else { phase = 'implement'; value = { html: '<!doctype html><html><head><title>Injected fixture</title></head><body><p>Engineering control-flow fixture only; this code is never executed.</p></body></html>' }; }
    const capture = { phase, data, signal, result: result(value) }; captures.push(capture);
    return await options.hook?.(capture) ?? capture.result;
  };
  const service = createProductionService(directory, { roleCall, acceptancePreflight: async (checks, signal) => { preflights++; return options.preflight ? options.preflight(checks, signal) : { valid: true, errors: [] }; }, gate: async (html, checks, signal) => { gates++; return options.gate ? options.gate(html, checks, signal) : { passed: true, checks: [{ name: 'Injected Gate only; no browser evidence', passed: true }] }; } });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `group-fixture-${agent.role}-never-a-real-key`, pricing: { inputPerMillion: .30, outputPerMillion: 1.20, currency: 'USD' } });
  const input = productionRunInputSchema.parse({ brief, capability: 'offline-single-html', mode: 'live', verifierEngine: 'llm-rubric', implementationEvidencePolicy: 'legacy', acceptanceStrategy: 'planned-groups-v1', candidateCount: 1, budgetAuthorized: true, agentIds: service.store.agents().map(agent => agent.id), requirement: { id: 'GROUPS-FREE-FIXTURE', source: 'Synthetic engineering requirement, not real business evidence', acceptance, kind: 'illustrative' }, limits: { maxCalls: 80, maxTokens: 5_000_000, maxCost: 10 }, ...options.input });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: service.store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  service.store.addRun(run, input.agentIds);
  const begin = () => service.pipeline.start(run);
  const wait = async () => {
    const deadline = Date.now() + 15000;
    while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(service.pipeline.busy, false, 'Injected construction must reach a bounded terminal state');
    const saved = service.store.run(run.id)!;
    assert.equal(saved.evidenceKind, 'injected-test');
    assert.ok(saved.calls.every(call => call.executionSource === 'injected' && !call.providerRequests));
    return saved;
  };
  return { service, run, captures, begin, wait, start: async () => { begin(); return wait(); }, counts: () => ({ preflights, gates }) };
}
const phaseCalls = (run: ProductionRun, phase: string) => run.calls.filter(call => call.phase === phase);
const groupCalls = (run: ProductionRun) => run.calls.filter(call => call.phase.startsWith('acceptance-group-'));
function noDelivery(run: ProductionRun) {
  assert.notEqual(run.status, 'completed'); assert.equal(run.frozenContract, undefined);
  assert.equal(run.calls.some(call => call.role === 'developer'), false); assert.equal(run.gateHistory.length, 0);
  assert.equal(run.artifacts.some(item => item.name === 'index.html'), false);
  assert.ok(groupCalls(run).every(call => call.selected !== true));
}
function abstain(capture: Capture): RoleResult {
  return result({ decision: 'abstain', selectedCandidateId: null, scores: capture.data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 2, reason: 'Deliberate incomplete-coverage fixture verdict' })), reason: 'Injected rejection, not model quality evidence' });
}

for (const strategy of [undefined, 'planned-groups-v1'] as const) for (const collision of [OUTPUT_DIAGNOSTICS_VERSION, OUTPUT_DIAGNOSTICS_VERSION.slice(-16)]) {
  test(`retained synthetic v2 diagnostic credential (${collision.length} chars, ${strategy ?? 'legacy path'}) fails before any request`, async t => {
    assert.equal(productionApiKeySchema.safeParse(collision).success, false);
    const f = fixture(t, { input: { acceptanceStrategy: strategy } });
    // Test-owned legacy encrypted state, not a caller credential or migration.
    const legacy = f.service.store as unknown as { encrypt(secret: string): string; state: { agents: Array<{ secret?: string }>; snapshots: Record<string, Array<{ secret?: string }>> } };
    const encrypted = legacy.encrypt(collision);
    legacy.state.agents[0].secret = encrypted; legacy.state.snapshots[f.run.id][0].secret = encrypted;
    const run = await f.start();
    assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 0); assert.equal(run.repairs, 0);
    assert.equal(f.captures.length, 0); assert.deepEqual(f.counts(), { preflights: 0, gates: 0 });
    assert.match(run.error!, /凭据与评估公开契约冲突/);
    noDelivery(run);
  });
}

test('two groups compose one independently reviewed candidate with exact sources, no fabricated call, then freeze once', async t => {
  const f = fixture(t); const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 15); assert.equal(run.repairs, 0); assert.deepEqual(f.counts(), { preflights: 1, gates: 1 });
  const construction = run.acceptanceConstruction!; assert.equal(construction.version, ACCEPTANCE_CONSTRUCTION_VERSION);
  const sourcePlan = run.calls.find(call => call.id === construction.plan.sourceCallId)!;
  assert.equal(sourcePlan.phase, 'acceptance-plan'); assert.equal(sourcePlan.role, 'project-manager');
  assert.equal(sourcePlan.candidateId, construction.plan.sourceCandidateId);
  assert.equal(hash(sourcePlan.rawOutput), construction.plan.rawOutputSha256); assert.equal(hash(construction.plan.value), construction.plan.valueSha256);
  assert.deepEqual(JSON.parse(sourcePlan.rawOutput), construction.plan.value); assert.equal(construction.attempts.length, 1);
  const attempt = construction.attempts[0]; assert.equal(attempt.decision, 'accepted'); assert.ok(attempt.finishedAt);
  assert.match(attempt.id, /^[a-f0-9-]{36}$/); assert.equal(attempt.groups.length, 2);
  assert.deepEqual(attempt.generationCallIds, attempt.groups.map(group => group.sourceCallId));
  const expectedChecks: AcceptanceCheck[] = [];
  for (const group of attempt.groups) {
    const call = run.calls.find(item => item.id === group.sourceCallId)!; const raw = JSON.parse(call.rawOutput) as AcceptanceGroup;
    assert.equal(call.candidateId, group.sourceCandidateId); assert.equal(call.selected, true);
    assert.equal(hash(call.rawOutput), group.rawOutputSha256); assert.equal(hash(raw), group.valueSha256); assert.deepEqual(raw, group.value);
    assert.equal(raw.planHash, acceptancePlanHash(construction.plan.value)); assert.equal(raw.attemptId, attempt.id);
    const context = JSON.parse(call.userPrompt).context;
    assert.equal(context.constructionAttemptId, attempt.id); assert.equal(context.acceptancePlanHash, raw.planHash);
    assert.equal(context.plannedGroup.id, group.groupId); expectedChecks.push(...raw.checks.map(slot => slot.check));
  }
  assert.equal(JSON.stringify(attempt.checks), JSON.stringify(expectedChecks)); assert.equal(attempt.checksSha256, hash(expectedChecks));
  assert.deepEqual(run.frozenContract!.checks, expectedChecks);
  assert.ok(run.calls.every(call => call.id !== attempt.compositeCandidateId && call.candidateId !== attempt.compositeCandidateId), 'Assembly is not falsely attributed to one provider request');
  const whole = run.calls.find(call => call.id === attempt.reviewCallId)!; assert.equal(whole.phase, 'acceptance:verify');
  const review = JSON.parse(whole.userPrompt); assert.deepEqual(review.candidates, [{ id: attempt.compositeCandidateId, value: { checks: expectedChecks } }]);
  assert.equal(review.criteria.goal, brief); assert.equal(review.criteria.acceptance, acceptance);
  assert.ok(review.state.reviewContext.acceptanceConstruction); assert.equal(review.state.reviewContext.regeneration, undefined);
  assert.equal(run.verifications.find(item => item.phase === 'acceptance')!.selectedCandidateId, attempt.compositeCandidateId);
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1);
  assert.deepEqual(JSON.parse(f.service.store.readArtifact(run.id, 'evidence.json')).acceptanceConstruction, construction);
  assert.equal(run.usage.inputTokens, 1500); assert.equal(run.usage.outputTokens, 1500);
});

test('three groups use at most sixteen initial logical calls without independently evaluating a partial group', async t => {
  const f = fixture(t, { groups: 3 }); const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 16); assert.equal(groupCalls(run).length, 3); assert.equal(phaseCalls(run, 'acceptance-plan:verify').length, 1); assert.equal(phaseCalls(run, 'acceptance:verify').length, 1);
  assert.equal(run.calls.some(call => /^acceptance-group-.*:verify$/.test(call.phase)), false); assert.equal(run.frozenContract!.checks.length, 3);
});

test('a malformed current group alone regenerates in the same attempt and preserves the preceding group source', async t => {
  let second = 0;
  const f = fixture(t, { hook: capture => capture.phase === 'acceptance-group-g2' && ++second === 1 ? result('{ malformed') : undefined });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 1);
  assert.equal(phaseCalls(run, 'acceptance-group-g1').length, 1); assert.equal(phaseCalls(run, 'acceptance-group-g2').length, 2);
  const attempt = run.acceptanceConstruction!.attempts[0]; assert.equal(run.acceptanceConstruction!.attempts.length, 1);
  assert.equal(attempt.generationCallIds.length, 3); assert.equal(attempt.groups.length, 2);
  const [bad, good] = phaseCalls(run, 'acceptance-group-g2'); assert.notEqual(bad.selected, true); assert.equal(good.selected, true);
  assert.equal(JSON.parse(good.userPrompt).context.constructionAttemptId, attempt.id);
  const feedback = JSON.parse(good.userPrompt).context.regeneration;
  assert.ok(JSON.stringify(feedback).includes(bad.id)); assert.ok(JSON.stringify(feedback).includes(bad.candidateId)); assert.ok(JSON.stringify(feedback).includes(hash(bad.rawOutput)));
  assert.equal(attempt.groups[1].sourceCallId, good.id); assert.equal(run.calls.length, 16);
});

test('whole coverage abstention consumes one shared repair and regenerates every group under a new assembly round', async t => {
  let reviews = 0;
  const f = fixture(t, { hook: capture => capture.phase === 'acceptance:verify' && ++reviews === 1 ? abstain(capture) : undefined });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 1);
  const [first, second] = run.acceptanceConstruction!.attempts; assert.equal(first.decision, 'rejected'); assert.equal(second.decision, 'accepted');
  assert.notEqual(first.id, second.id); assert.notEqual(first.compositeCandidateId, second.compositeCandidateId);
  assert.equal(first.groups.length, 2); assert.equal(second.groups.length, 2);
  assert.ok(first.groups.every(group => !second.generationCallIds.includes(group.sourceCallId)));
  assert.ok(first.groups.every(group => run.calls.find(call => call.id === group.sourceCallId)!.selected !== true));
  assert.ok(second.groups.every(group => run.calls.find(call => call.id === group.sourceCallId)!.selected === true));
  assert.equal(phaseCalls(run, 'acceptance-group-g1').length, 2); assert.equal(phaseCalls(run, 'acceptance-group-g2').length, 2);
  assert.equal(phaseCalls(run, 'acceptance-plan').length, 1); assert.equal(run.calls.length, 18);
});

test('repeated whole-candidate abstention preserves all three rounds and stops at two repairs without freezing', async t => {
  const f = fixture(t, { hook: capture => capture.phase === 'acceptance:verify' ? abstain(capture) : undefined });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  assert.equal(run.acceptanceConstruction!.attempts.length, 3); assert.ok(run.acceptanceConstruction!.attempts.every(attempt => attempt.decision === 'rejected'));
  assert.equal(groupCalls(run).length, 6); assert.equal(phaseCalls(run, 'acceptance:verify').length, 3); assert.equal(run.calls.length, 17); assert.equal(f.counts().gates, 0);
});

test('local-group and whole-coverage rejection share one repair pool, never a fresh pool per group', async t => {
  let failures = 0;
  const f = fixture(t, { hook: capture => capture.phase === 'acceptance-group-g2' && failures++ < 2 ? result('{ malformed') : capture.phase === 'acceptance:verify' ? abstain(capture) : undefined });
  const run = await f.start(); noDelivery(run); assert.equal(run.repairs, 2); assert.equal(run.calls.length, 13);
  assert.equal(phaseCalls(run, 'acceptance-group-g1').length, 1); assert.equal(phaseCalls(run, 'acceptance-group-g2').length, 3); assert.equal(phaseCalls(run, 'acceptance:verify').length, 1);
  assert.equal(run.acceptanceConstruction!.attempts.length, 1);
});

for (const mutation of ['plan-hash', 'attempt-id', 'group-id', 'unknown-slot', 'duplicate-slot', 'missing-slot', 'over-steps'] as const) test(`forged ${mutation} never composes or dispatches a whole evaluator`, async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase !== 'acceptance-group-g1') return;
    const group = JSON.parse(capture.result.text) as AcceptanceGroup;
    if (mutation === 'plan-hash') group.planHash = 'f'.repeat(64);
    else if (mutation === 'attempt-id') group.attemptId = randomUUID();
    else if (mutation === 'group-id') group.groupId = 'g2';
    else if (mutation === 'unknown-slot') group.checks[0].checkId = 'not-planned';
    else if (mutation === 'duplicate-slot') group.checks.push(structuredClone(group.checks[0]));
    else if (mutation === 'missing-slot') group.checks = [];
    else group.checks[0].check.steps = Array.from({ length: 21 }, () => ({ action: 'click', selector: '#add' }));
    return result(group);
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.repairs, 2); assert.equal(phaseCalls(run, 'acceptance-group-g1').length, 3);
  assert.equal(phaseCalls(run, 'acceptance-group-g2').length, 0); assert.equal(phaseCalls(run, 'acceptance:verify').length, 0); assert.equal(f.counts().preflights, 0);
});

test('a group replayed from a rejected prior round is rejected rather than used in the next assembly', async t => {
  let prior: string | undefined; let reviews = 0; let replayed = false;
  const f = fixture(t, { hook: capture => {
    if (capture.phase === 'acceptance:verify' && ++reviews === 1) return abstain(capture);
    if (capture.phase !== 'acceptance-group-g1') return;
    if (!prior) { prior = capture.result.text; return; }
    if (!replayed) { replayed = true; return result(prior); }
  } });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 2);
  const [old, current] = run.acceptanceConstruction!.attempts; assert.notEqual(old.id, current.id); assert.equal(current.generationCallIds.length, 3);
  const stale = groupCalls(run).find(call => call.rawOutput === prior && current.generationCallIds.includes(call.id))!;
  assert.ok(stale); assert.notEqual(stale.selected, true); assert.ok(current.groups.every(group => group.sourceCallId !== stale.id && group.value.attemptId === current.id));
});

test('a plan with a forged original-source quote cannot reach any group or complete-plan evaluator', async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase !== 'acceptance-plan') return;
    const value = JSON.parse(capture.result.text) as AcceptancePlan; value.obligations[0].quote = 'A requirement never authorized by this input'; return result(value);
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.repairs, 2); assert.equal(phaseCalls(run, 'acceptance-plan').length, 3);
  assert.equal(phaseCalls(run, 'acceptance-plan:verify').length, 0); assert.equal(groupCalls(run).length, 0);
});

for (const failure of ['unknown-usage', 'transport', 'plan-protocol', 'whole-protocol', 'css-infrastructure'] as const) test(`${failure} is fatal, not a reason to regenerate groups or consume repair`, async t => {
  const f = fixture(t, { hook: capture => {
    if (failure === 'unknown-usage' && capture.phase === 'acceptance-group-g1') return { ...capture.result, usageReported: false };
    if (failure === 'transport' && capture.phase === 'acceptance-group-g1') throw new Error('Injected transport failure');
    if (failure === 'plan-protocol' && capture.phase === 'acceptance-plan:verify' || failure === 'whole-protocol' && capture.phase === 'acceptance:verify') return result('{ invalid verifier protocol');
  }, ...(failure === 'css-infrastructure' ? { preflight: async () => { throw new Error('Injected CSS infrastructure failure'); } } : {}) });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.equal(phaseCalls(run, 'acceptance-group-g1').length, failure === 'plan-protocol' ? 0 : 1);
  assert.equal(phaseCalls(run, 'acceptance-group-g2').length, failure === 'plan-protocol' || failure === 'unknown-usage' || failure === 'transport' ? 0 : 1);
  if (failure === 'unknown-usage') assert.equal(run.usage.estimatedCost, null);
  if (failure === 'css-infrastructure') assert.equal(phaseCalls(run, 'acceptance:verify').length, 0);
  assert.equal(f.counts().gates, 0);
});

for (const pausedPhase of ['acceptance-plan', 'acceptance-group-g2', 'acceptance:verify']) test(`cancellation during ${pausedPhase} rejects a late successful response and never freezes or proceeds`, async t => {
  let entered = false;
  let release!: () => void; const delayed = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(t, { hook: async capture => { if (capture.phase === pausedPhase) { entered = true; await delayed; return capture.result; } } });
  f.begin();
  try {
    const deadline = Date.now() + 15000;
    while (!entered && f.service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(entered, true, `The injected run must reach ${pausedPhase} before cancellation: ${f.service.store.run(f.run.id)?.error ?? 'pending'}`);
    f.service.pipeline.cancel(f.run.id);
  } finally { release(); }
  const run = await f.wait(); noDelivery(run); assert.equal(run.status, 'cancelled'); assert.equal(run.repairs, 0); assert.equal(run.interventions.length, 1);
  assert.equal(f.counts().gates, 0); assert.ok(!run.acceptanceConstruction?.attempts.some(attempt => attempt.decision === 'accepted'));
});

test('a mutating preflight adapter cannot replace composed source checks before the complete review or freeze', async t => {
  const f = fixture(t, { preflight: async checks => { checks[0].steps[0].selector = '#rewritten-by-adapter'; return { valid: true, errors: [] }; } });
  const run = await f.start(); noDelivery(run); assert.equal(run.repairs, 0); assert.equal(phaseCalls(run, 'acceptance:verify').length, 0);
  assert.ok(groupCalls(run).every(call => !call.rawOutput.includes('rewritten-by-adapter')));
});

for (const tamper of ['source-call-reference', 'composite-checks'] as const) test(`forged ${tamper} during the whole review is fatal even with an accepting injected verdict`, async t => {
  let active: ProductionRun | undefined;
  const f = fixture(t, { hook: capture => {
    if (capture.phase !== 'acceptance:verify') return;
    const attempt = active!.acceptanceConstruction!.attempts.at(-1)!;
    if (tamper === 'source-call-reference') attempt.groups[0].sourceCallId = randomUUID();
    else attempt.checks![0].steps[0].selector = '#not-in-any-source-group';
    return capture.result;
  } });
  const save = f.service.store.save.bind(f.service.store);
  // Capture the pipeline-owned object at its actual persistence boundary;
  // mutating a publicCopy returned by store.run would be an ineffective test.
  t.mock.method(f.service.store, 'save', (run: ProductionRun) => { active = run; save(run); });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.equal(phaseCalls(run, 'acceptance:verify').length, 1); assert.equal(run.acceptanceConstruction!.attempts[0].decision, 'rejected');
  assert.equal(run.verifications.some(review => review.phase === 'acceptance' && review.decision === 'accept'), false);
  assert.equal(f.counts().gates, 0);
});

test('the actual hard call budget is not raised to the grouped worst-case envelope', async t => {
  const f = fixture(t, { groups: 3, input: { limits: { maxCalls: 12, maxTokens: 5_000_000, maxCost: 10, currency: 'USD', maxRepairCycles: 2, maxOutputTokens: 6000, maxDurationMs: 600000 } } });
  const run = await f.start(); assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 12); assert.equal(run.input.limits.maxCalls, 12); assert.equal(run.repairs, 0);
  assert.ok(run.frozenContract, 'Complete acceptance passed before the development budget refusal');
  assert.equal(run.calls.some(call => call.role === 'developer'), false); assert.equal(run.gateHistory.length, 0); assert.equal(run.artifacts.some(item => item.name === 'index.html'), false);
});

test('omitting the opt-in keeps the existing twelve-call HTML path and no construction evidence', async t => {
  const f = fixture(t, { input: { acceptanceStrategy: undefined } }); const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 12); assert.equal(run.acceptanceConstruction, undefined); assert.equal(run.validationContract!.acceptanceStrategy, undefined);
  assert.equal(phaseCalls(run, 'acceptance-plan').length, 0); assert.equal(groupCalls(run).length, 0); assert.equal(phaseCalls(run, 'acceptance').length, 1);
});

test('new grouped protocol literals and every credential-length substring are reserved for Agent and Jev settings', async t => {
  const literals = [...PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, ...ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS];
  for (const literal of literals) for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false, `Protocol substring in ${literal}`);
  const f = fixture(t); const agent = f.service.store.agents()[0];
  for (const literal of literals.filter(value => value.length >= 16)) {
    assert.throws(() => f.service.store.patchAgent(agent.id, { apiKey: literal }));
    assert.throws(() => f.service.store.patchJevConfig({ apiKey: literal }));
  }
  assert.equal(f.captures.length, 0);
});

for (const collision of ['AcceptancePlanError', 'context.plannedGroup']) test(`a retained synthetic credential colliding with ${collision === 'AcceptancePlanError' ? 'a new fixed diagnostic' : 'the complete group instruction'} stops before the first role call`, async t => {
  const f = fixture(t);
  if (collision === 'context.plannedGroup') {
    assert.ok(ACCEPTANCE_GROUP_INSTRUCTIONS.includes(collision));
    assert.equal(productionApiKeySchema.safeParse(collision).success, true, 'The runtime guard covers complete instruction text beyond registered protocol literals');
  }
  // Simulate test-owned authenticated legacy state only. No real private store,
  // encryption Key, migration or caller credential is opened or copied.
  const legacy = f.service.store as unknown as { encrypt(secret: string): string; state: { agents: Array<{ secret?: string }>; snapshots: Record<string, Array<{ secret?: string }>> } };
  const encrypted = legacy.encrypt(collision); legacy.state.agents[0].secret = encrypted; legacy.state.snapshots[f.run.id][0].secret = encrypted;
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.match(run.error!, /凭据.*冲突/); assert.equal(run.calls.length, 0); assert.equal(f.captures.length, 0);
  assert.equal(f.counts().preflights, 0); assert.equal(f.counts().gates, 0);
  assert.equal(f.service.store.readArtifact(run.id, 'evidence.json').includes(collision), false);
});

test('real Chromium grouped integration freezes source-bound checks and delivers test-owned inline HTML without a model request', async t => {
  // This verifies the real CSS-parser/behavior-Gate connection, not semantic
  // coverage quality of the injected plan or independent Verifier verdicts.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Test-owned offline list</title></head><body>
<h1>Offline list engineering fixture</h1><label>Item <input id="input"></label><button type="button" id="add">Add</button><output id="result"></output><ul id="items"></ul>
<script>document.querySelector('#add').addEventListener('click', () => {
  const input = document.querySelector('#input'); const value = input.value.trim(); if (!value) return;
  const item = document.createElement('li'); item.className = 'item';
  const label = document.createElement('span'); label.className = 'label'; label.textContent = value;
  item.append(label); document.querySelector('#items').append(item); document.querySelector('#result').textContent = value; input.value = '';
});</script></body></html>`;
  const f = fixture(t, { preflight: preflightAcceptanceChecks, gate: runGate, hook: capture => capture.phase === 'implement' ? result({ html }) : undefined });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test');
  assert.equal(run.calls.length, 15); assert.equal(run.repairs, 0); assert.deepEqual(f.counts(), { preflights: 1, gates: 1 });
  assert.ok(run.calls.every(call => call.executionSource === 'injected' && !call.providerRequests));
  assert.equal(run.gateHistory.length, 1); assert.equal(run.gate!.passed, true); assert.equal(run.gate!.failureKind, undefined);
  assert.deepEqual(run.gate!.checks.map(check => [check.name, check.passed]), [
    ['页面加载、可见内容与 JavaScript', true], ['Injected check c1', true], ['Injected check c2', true],
  ]);
  assert.equal(run.gate!.summary, '独立 Chromium 验收通过，交互与输出已验证。');
  assert.ok(run.events.findIndex(event => event.phase === 'freeze') < run.events.findIndex(event => event.phase === 'implement'));
  const construction = run.acceptanceConstruction!; const attempt = construction.attempts[0];
  assert.equal(attempt.decision, 'accepted'); assert.equal(attempt.groups.length, 2); assert.equal(attempt.checksSha256, hash(run.frozenContract!.checks));
  assert.deepEqual(run.frozenContract!.checks, [checkFixture('c1'), checkFixture('c2')]);
  assert.equal(run.frozenContract!.hash, hash({ validationContract: run.validationContract, requirement: run.input.requirement, brief: run.input.brief, checks: run.frozenContract!.checks, acceptanceConstruction: construction }));
  for (const source of [construction.plan, ...attempt.groups]) {
    const call = run.calls.find(candidate => candidate.id === source.sourceCallId && candidate.candidateId === source.sourceCandidateId)!;
    assert.ok(call); assert.equal(call.selected, true); assert.equal(source.rawOutputSha256, hash(call.rawOutput)); assert.equal(source.valueSha256, hash(source.value));
  }
  const artifact = f.service.store.readArtifact(run.id, 'index.html'); assert.equal(artifact, html);
  const manifest = JSON.parse(f.service.store.readArtifact(run.id, 'delivery-manifest.json'));
  const evidence = JSON.parse(f.service.store.readArtifact(run.id, 'evidence.json'));
  assert.equal(manifest.status, 'completed'); assert.equal(manifest.evidenceKind, 'injected-test'); assert.equal(manifest.source, 'index.html'); assert.equal(manifest.sourceSha256, hash(html));
  assert.equal(manifest.acceptanceConstructionHash, hash(construction)); assert.deepEqual(manifest.acceptanceConstruction, construction); assert.deepEqual(manifest.frozenContract, run.frozenContract);
  assert.equal(evidence.evidenceKind, 'injected-test'); assert.deepEqual(evidence.acceptanceConstruction, construction); assert.deepEqual(evidence.gate, run.gate);
});
