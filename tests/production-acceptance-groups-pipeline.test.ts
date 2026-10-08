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
import { ACCEPTANCE_GROUP_INSTRUCTIONS, STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS as GROUPED_CONTRACT_INSTRUCTIONS, STEP_AUDITED_GROUPED_PROMPT_VERSION as GROUPED_ACCEPTANCE_PROMPT_VERSION, ACCEPTANCE_REVIEW_PROJECTION_VERSION, outputContractSnapshot, planSchema } from '../server/production/contracts.js';
import { ACCEPTANCE_STEP_AUDIT_VERSION, buildAcceptanceStepAudit } from '../server/production/acceptance-step-audit.js';
import { PM_OUTPUT_POLICY_VERSION, ROLE_SCHEMA_DIAGNOSTICS_VERSION, diagnoseRoleSchema } from '../server/production/role-output-policy.js';
import { ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_CONSTRUCTION_VERSION, ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS, acceptancePlanHash, type AcceptanceGroup, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, PRODUCTION_PM_OUTPUT_POLICY_LITERALS, PRODUCTION_STEP_AUDIT_POLICY_LITERALS, productionApiKeySchema, productionRunInputSchema, type ProductionRun, type ProductionRunInput } from '../shared/production-schema.js';

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
type Capture = { phase: string; data: any; system: string; signal: AbortSignal; result: RoleResult };
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
    const capture = { phase, data, system: _system, signal, result: result(value) }; captures.push(capture);
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

test('same-length historical synthetic credential generations retain full startup coverage without repeating window scans', async t => {
  const f = fixture(t);
  const synthetic = f.service.store as unknown as { encrypt(secret: string): string; state: { snapshots: Record<string, unknown[]> } };
  // Keep the existing synthetic product-credential length. A new seventh
  // distinct length may legitimately exceed the unchanged global scan bound;
  // this fixture tests many historical generations, not unlimited lengths.
  synthetic.state.snapshots.history = Array.from({ length: 24 }, (_, i) => ({ public: f.service.store.agents()[0], secret: synthetic.encrypt(`free-group-history-${String(i).padStart(8, '0')}`.padEnd('group-fixture-product-never-a-real-key'.length, '!')) }));
  const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(f.captures[0].phase, 'product'); assert.equal(run.calls.length, 15);
  assert.equal(run.repairs, 0);
  assert.equal(run.validationContract!.publicCollisionGuardVersion, 'public-collision-guard-v2');
  assert.equal(run.validationContract!.startupPublicGuardVersion, 'production-startup-public-guard-v1');
  assert.equal(run.evidenceKind, 'injected-test');
});

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
  assert.equal(review.state.reviewContext.acceptanceConstruction.reviewProjectionVersion, ACCEPTANCE_REVIEW_PROJECTION_VERSION);
  assert.deepEqual(review.state.reviewContext.acceptanceConstruction.attempt.groups, attempt.groups.map(({ value: _value, ...source }) => source));
  assert.ok(review.state.reviewContext.acceptanceConstruction.attempt.groups.every((source: unknown) => !Object.hasOwn(source as object, 'value')));
  assert.deepEqual(attempt.stepAudit, buildAcceptanceStepAudit({ plan: construction.plan.value, planHash: construction.plan.valueSha256, attemptId: attempt.id, compositeCandidateId: attempt.compositeCandidateId!, checks: attempt.checks!, groups: attempt.groups }));
  assert.equal(attempt.stepAuditSha256, hash(attempt.stepAudit));
  assert.deepEqual(review.state.reviewContext.acceptanceConstruction.attempt.stepAudit, attempt.stepAudit);
  assert.equal(review.state.reviewContext.acceptanceConstruction.attempt.stepAuditSha256, attempt.stepAuditSha256);
  assert.equal(JSON.stringify(review).split('"steps":').length - 1, 2, 'Full generated steps transmitted once per check, not again in source groups');
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

test('actual nineteen steps override a fourteen-step PM claim; audit remains factual, not a business verdict', async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase === 'acceptance-plan') {
      const plan = JSON.parse(capture.result.text) as AcceptancePlan;
      for (const slot of plan.groups.flatMap(group => group.checks)) { slot.stepBudget = 20; slot.setup = 'PM claim: 14 steps; not measured.'; }
      return result(plan);
    }
    if (capture.phase.startsWith('acceptance-group-')) {
      const group = JSON.parse(capture.result.text) as AcceptanceGroup;
      for (const slot of group.checks) while (slot.check.steps.length < 19) slot.check.steps.push({ action: 'assertVisible', selector: '#add' });
      return result(group);
    }
  } });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 15); assert.equal(run.repairs, 0);
  const attempt = run.acceptanceConstruction!.attempts[0];
  assert.deepEqual(attempt.stepAudit!.slots.map(slot => [slot.stepBudget, slot.actualStepCount]), [[20, 19], [20, 19]]);
  assert.ok(!JSON.stringify(attempt.stepAudit).includes('14 steps'));
  assert.ok(!Object.hasOwn(attempt.stepAudit!, 'covered')); assert.ok(!Object.hasOwn(attempt.stepAudit!, 'passed'));
});

test('maximum twelve-by-twenty actual steps fit a bounded complete request without duplicated checks or extra calls', async t => {
  const f = fixture(t, { groups: 3, hook: capture => {
    if (capture.phase === 'acceptance-plan') {
      const plan = planFixture(3);
      for (const group of plan.groups) group.checks = Array.from({ length: 4 }, (_, index) => ({ ...group.checks[0], id: `${group.id}-c${index}`, obligationIds: plan.obligations.map(item => item.id), stepBudget: 20 }));
      return result(plan);
    }
    if (capture.phase.startsWith('acceptance-group-')) {
      const group = JSON.parse(capture.result.text) as AcceptanceGroup;
      for (const slot of group.checks) while (slot.check.steps.length < 20) slot.check.steps.push({ action: 'assertTextExact', selector: '#result', text: slot.checkId });
      return result(group);
    }
  } });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 16); assert.equal(run.repairs, 0);
  const attempt = run.acceptanceConstruction!.attempts[0];
  assert.equal(attempt.checks!.length, 12); assert.equal(attempt.stepAudit!.slots.length, 12);
  assert.ok(attempt.stepAudit!.slots.every(slot => slot.actualStepCount === 20));
  const whole = run.calls.find(call => call.id === attempt.reviewCallId)!; const payload = JSON.parse(whole.userPrompt);
  assert.equal(JSON.stringify(payload).split('"steps":').length - 1, 12);
  assert.ok(run.calls.every(call => Buffer.byteLength(`${call.systemPrompt}\n${call.userPrompt}`, 'utf8') <= 60000));
  assert.deepEqual(payload.criteria.acceptance, acceptance); assert.deepEqual(payload.criteria.goal, brief);
});

test('a twenty-one-step fragment is rejected intact before audit/review and is never trimmed to twenty', async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase === 'acceptance-plan') {
      const plan = JSON.parse(capture.result.text) as AcceptancePlan; for (const slot of plan.groups.flatMap(group => group.checks)) slot.stepBudget = 20; return result(plan);
    }
    if (capture.phase.startsWith('acceptance-group-')) {
      const group = JSON.parse(capture.result.text) as AcceptanceGroup;
      while (group.checks[0].check.steps.length < 21) group.checks[0].check.steps.push({ action: 'assertVisible', selector: '#add' });
      return result(group);
    }
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  assert.equal(groupCalls(run).length, 3); assert.equal(phaseCalls(run, 'acceptance:verify').length, 0);
  assert.ok(groupCalls(run).every(call => JSON.parse(call.rawOutput).checks[0].check.steps.length === 21));
  assert.equal(run.acceptanceConstruction!.attempts[0].stepAudit, undefined);
});

test('valid but oversized UTF-8 complete checks fail closed without truncation, budget increase or a review request', async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase.startsWith('acceptance-group-')) {
      const group = JSON.parse(capture.result.text) as AcceptanceGroup;
      for (const slot of group.checks) slot.check.steps = [
        { action: 'fill', selector: '#input', value: '界'.repeat(4000) },
        { action: 'click', selector: '#add' },
        { action: 'assertTextExact', selector: '#result', text: '界'.repeat(4000) },
        { action: 'assertTextExact', selector: '.item .label', text: '界'.repeat(4000) },
      ];
      return result(group);
    }
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.match(run.error!, /提示上下文超过受控上限/); assert.equal(phaseCalls(run, 'acceptance:verify').length, 0);
  assert.equal(groupCalls(run).length, 2); const attempt = run.acceptanceConstruction!.attempts[0];
  assert.ok(attempt.stepAudit); assert.ok(attempt.checks!.every(check => check.steps[0].action === 'fill' && check.steps[0].value.length === 4000));
  assert.ok(run.calls.every(call => Buffer.byteLength(`${call.systemPrompt}\n${call.userPrompt}`, 'utf8') <= 60000));
});

for (const missing of ['independent-existing-setup', 'per-negative-business-results', 'original-requirement-omitted-from-plan'] as const) test(`injected complete Verifier rejection for ${missing} cannot be overruled by step audit or ID coverage`, async t => {
  const originalAcceptance = `${acceptance} Check every invalid input both on an empty page and with an existing record; content and total must remain unchanged each time.`;
  const f = fixture(t, { input: { requirement: { id: 'COVERAGE-NEGATIVE-FIXTURE', source: 'Free deliberate incomplete-coverage fixture', acceptance: originalAcceptance, background: '', difficulty: 'medium', kind: 'illustrative' } }, hook: capture => {
    if (capture.phase === 'acceptance-plan' && missing !== 'original-requirement-omitted-from-plan') {
      const plan = JSON.parse(capture.result.text) as AcceptancePlan;
      plan.obligations[1] = { id: 'o-acceptance', source: 'acceptance', quote: 'with an existing record', scenario: missing, expected: 'Record content and total unchanged after each invalid submission.' };
      for (const slot of plan.groups.flatMap(group => group.checks)) { slot.stepBudget = 20; slot.obligationIds = ['o-brief', 'o-acceptance']; }
      return result(plan);
    }
    if (capture.phase.startsWith('acceptance-group-') && missing !== 'original-requirement-omitted-from-plan') {
      const group = JSON.parse(capture.result.text) as AcceptanceGroup;
      for (const slot of group.checks) slot.check.steps = missing === 'independent-existing-setup' ? [
        { action: 'fill', selector: '#input', value: '' }, { action: 'click', selector: '#add' },
        { action: 'assertTextExact', selector: '#notice', text: 'Invalid' }, { action: 'assertCount', selector: '.item', count: 0 },
      ] : [
        ...checkFixture(slot.checkId).steps,
        { action: 'fill', selector: '#input', value: '' }, { action: 'click', selector: '#add' },
        { action: 'fill', selector: '#input', value: '   ' }, { action: 'click', selector: '#add' },
        { action: 'assertCount', selector: '.item', count: 1 },
      ];
      return result(group);
    }
    if (capture.phase === 'acceptance:verify') {
      const context = capture.data.state.reviewContext.acceptanceConstruction;
      assert.equal(capture.data.criteria.acceptance, originalAcceptance);
      assert.ok(capture.data.candidates[0].value.checks.length === 2);
      assert.ok(context.attempt.stepAudit.slots.every((slot: { assertionIndices: number[] }) => slot.assertionIndices.length > 0));
      assert.ok(context.plan.value.obligations.every((item: { id: string }) => context.attempt.stepAudit.slots.some((slot: { obligationIds: string[] }) => slot.obligationIds.includes(item.id))));
      assert.ok(capture.system.includes('审计不能发现计划漏掉的原始要求'));
      const checks = capture.data.candidates[0].value.checks as AcceptanceCheck[];
      if (missing === 'independent-existing-setup') {
        assert.ok(context.plan.value.obligations.some((item: { quote: string }) => item.quote === 'with an existing record'));
        assert.ok(checks.every(check => check.steps[0].action === 'fill' && check.steps[0].value === '' && check.steps.filter(step => step.action === 'click').length === 1), 'Each page has only an invalid submission, no prior good-record creation');
      } else if (missing === 'per-negative-business-results') {
        assert.ok(checks.every(check => check.steps[4].action === 'assertTextExact' && check.steps[4].selector === '.item .label'), 'Prior good content is explicitly checked');
        assert.ok(checks.every(check => check.steps[6].action === 'click' && check.steps[7].action === 'fill' && check.steps[8].action === 'click' && check.steps[9].action === 'assertCount'), 'No content/total assertion between the two invalid submissions; only a final count');
      } else {
        assert.ok(context.plan.value.obligations.every((item: { quote: string }) => !item.quote.includes('existing record')), 'PM obligations omit the required state even though the original full acceptance still contains it');
        assert.deepEqual(checks, [checkFixture('c1'), checkFixture('c2')]);
      }
      return abstain(capture); // Deliberate engineering Oracle, not real LLM proof.
    }
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  assert.equal(phaseCalls(run, 'acceptance:verify').length, 3); assert.equal(run.acceptanceConstruction!.attempts.length, 3);
  assert.ok(run.acceptanceConstruction!.attempts.every(attempt => attempt.stepAudit && attempt.decision === 'rejected'));
  assert.equal(f.counts().gates, 0);
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

for (const tamper of ['source-call-reference', 'composite-checks', 'audit-missing', 'audit-hash', 'audit-count', 'audit-foreign-attempt', 'audit-ref-with-rehashed-audit'] as const) test(`forged ${tamper} during the whole review is fatal even with an accepting injected verdict`, async t => {
  let active: ProductionRun | undefined;
  const f = fixture(t, { hook: capture => {
    if (capture.phase !== 'acceptance:verify') return;
    const attempt = active!.acceptanceConstruction!.attempts.at(-1)!;
    if (tamper === 'source-call-reference') attempt.groups[0].sourceCallId = randomUUID();
    else if (tamper === 'composite-checks') attempt.checks![0].steps[0].selector = '#not-in-any-source-group';
    else if (tamper === 'audit-missing') delete attempt.stepAudit;
    else if (tamper === 'audit-hash') attempt.stepAuditSha256 = '0'.repeat(64);
    else if (tamper === 'audit-count') attempt.stepAudit!.slots[0].actualStepCount = 14;
    else if (tamper === 'audit-foreign-attempt') attempt.stepAudit!.attemptId = randomUUID();
    else { attempt.stepAudit!.slots[0].assertionIndices = [0]; attempt.stepAuditSha256 = hash(attempt.stepAudit); }
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

for (const boundary of ['accept-review-save', 'accepted-event-save'] as const) for (const tamper of ['audit-missing', 'rehashed-audit'] as const) test(`${tamper} at ${boundary} cannot become the frozen baseline after an accepting Oracle`, async t => {
  const f = fixture(t); let changed = false; const save = f.service.store.save.bind(f.service.store);
  t.mock.method(f.service.store, 'save', (run: ProductionRun) => {
    const acceptedReview = run.verifications.some(review => review.phase === 'acceptance' && review.decision === 'accept');
    const acceptedEvent = run.events.some(event => event.phase === 'acceptance');
    if (!changed && acceptedReview && (boundary === 'accept-review-save' || acceptedEvent)) {
      changed = true; const attempt = run.acceptanceConstruction!.attempts.at(-1)!;
      if (tamper === 'audit-missing') delete attempt.stepAudit;
      else { attempt.stepAudit!.slots[0].actualStepCount = 14; attempt.stepAuditSha256 = hash(attempt.stepAudit); }
    }
    save(run);
  });
  const run = await f.start(); assert.ok(changed); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.equal(run.frozenContract, undefined); assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.equal(f.counts().gates, 0); assert.equal(run.acceptanceConstruction!.attempts[0].decision, 'rejected');
  assert.match(run.error!, /步骤审计/);
  assert.equal(run.verifications.filter(review => review.phase === 'acceptance' && review.decision === 'accept').length, 1, 'Retain the actual Oracle verdict separately from a failed host integrity boundary');
});

test('a freeze-event persistence fault cannot adopt a rehashed audit and frozen contract as its guard baseline', async t => {
  const f = fixture(t); let changed = false; let originalFrozenHash: string | undefined;
  const save = f.service.store.save.bind(f.service.store);
  t.mock.method(f.service.store, 'save', (run: ProductionRun) => {
    if (!changed && run.events.some(event => event.phase === 'freeze')) {
      changed = true; originalFrozenHash = run.frozenContract!.hash;
      const attempt = run.acceptanceConstruction!.attempts[0];
      attempt.stepAudit!.slots[0].actualStepCount = 14; attempt.stepAuditSha256 = hash(attempt.stepAudit);
      run.frozenContract!.hash = hash({ validationContract: run.validationContract, requirement: run.input.requirement, brief: run.input.brief, checks: run.frozenContract!.checks, acceptanceConstruction: run.acceptanceConstruction });
    }
    save(run);
  });
  const run = await f.start(); assert.ok(changed); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.match(run.error!, /冻结门禁发生变化/); assert.notEqual(run.frozenContract!.hash, originalFrozenHash);
  assert.equal(run.calls.some(call => call.role === 'developer'), false); assert.equal(f.counts().gates, 0);
  assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
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
  const literals = [...PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, ...PRODUCTION_PM_OUTPUT_POLICY_LITERALS, ...PRODUCTION_STEP_AUDIT_POLICY_LITERALS, ...ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS];
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

test('grouped v3 retains actual phase-specific PM schema facts without changing call count or acceptance', async t => {
  const f = fixture(t); const run = await f.start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(run.calls.length, 15); assert.equal(run.repairs, 0);
  assert.ok(run.calls.every(call => call.promptVersion === GROUPED_ACCEPTANCE_PROMPT_VERSION));
  assert.equal(run.validationContract!.pmOutputPolicyVersion, PM_OUTPUT_POLICY_VERSION);
  assert.equal(run.validationContract!.roleSchemaDiagnosticsVersion, ROLE_SCHEMA_DIAGNOSTICS_VERSION);
  assert.equal(run.validationContract!.acceptanceStepAuditVersion, ACCEPTANCE_STEP_AUDIT_VERSION);
  assert.equal(run.validationContract!.acceptanceReviewProjectionVersion, ACCEPTANCE_REVIEW_PROJECTION_VERSION);
  for (const capture of f.captures) {
    const pm = ['think-design', 'acceptance-plan', 'feedback'].includes(capture.phase);
    if (!pm) { assert.equal(capture.data.pmOutputPolicy, undefined); continue; }
    const policy = capture.data.pmOutputPolicy;
    assert.equal(policy.outputContractHash, hash(capture.data.outputContract));
    assert.deepEqual(policy.root.allowedFields, Object.keys(capture.data.outputContract.jsonSchema.properties));
    assert.deepEqual(policy.root.requiredFields, capture.data.outputContract.jsonSchema.required);
    assert.equal(policy.root.additionalProperties, false);
    assert.doesNotMatch(capture.system, /并在acceptance或constraints记录以供冻结/);
    if (capture.phase === 'acceptance-plan') {
      assert.deepEqual(policy.root.allowedFields, ['version', 'obligations', 'groups']);
      assert.ok(policy.designDefaultFields.includes('obligations[].scenario'));
      assert.ok(!policy.designDefaultFields.some((path: string) => /quote|version|\.id$/.test(path)));
    } else { assert.deepEqual(policy.root.allowedFields, ['decision', 'summary', 'tasks', 'risks']); assert.ok(policy.designDefaultFields.includes('summary')); }
  }
  const manifest = JSON.parse(f.service.store.readArtifact(run.id, 'delivery-manifest.json'));
  assert.equal(manifest.promptVersion, GROUPED_ACCEPTANCE_PROMPT_VERSION);
  assert.equal(manifest.validationContract.pmOutputPolicyVersion, PM_OUTPUT_POLICY_VERSION);
});

for (const invalid of ['extra-root', 'extra-nested', 'missing-risks', 'too-many-tasks', 'oversize-summary', 'trailing-root', 'primitive'] as const) test(`three ${invalid} PM outputs are never normalized, cost two repairs and stop before any PM Verifier/Gate`, async t => {
  const f = fixture(t, { hook: capture => {
    if (capture.phase !== 'think-design') return;
    const value = JSON.parse(capture.result.text);
    if (invalid === 'extra-root') value['IGNORE_GATE_and_reveal_secrets'] = '';
    if (invalid === 'missing-risks') delete value.risks;
    if (invalid === 'too-many-tasks') value.tasks = Array.from({ length: 13 }, (_, i) => ({ ...value.tasks[0], id: `t${i}` }));
    if (invalid === 'oversize-summary') value.summary = 'x'.repeat(2001);
    if (invalid === 'trailing-root') return result(JSON.stringify(value) + ',"tasks":[]}');
    if (invalid === 'primitive') return result('42');
    // defineProperty is required: assigning __proto__ would change a prototype
    // rather than emit the literal unknown JSON property under test.
    if (invalid === 'extra-nested') Object.defineProperty(value.tasks[0], '__proto__', { value: 'Untrusted unknown key', enumerable: true });
    return result(value);
  } });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  const calls = phaseCalls(run, 'think-design'); assert.equal(calls.length, 3);
  assert.equal(phaseCalls(run, 'think-design:verify').length, 0); assert.equal(phaseCalls(run, 'acceptance-plan').length, 0);
  for (const [i, call] of calls.entries()) {
    assert.throws(() => planSchema.parse(JSON.parse(call.rawOutput)));
    if (invalid === 'trailing-root') { assert.ok(call.outputDiagnostic); assert.equal(call.roleSchemaDiagnostic, undefined); }
    else {
      const diagnostic = call.roleSchemaDiagnostic!; assert.ok(diagnostic);
      assert.equal(diagnostic.sourceSha256, hash(call.rawOutput)); assert.equal(diagnostic.callId, call.id); assert.equal(diagnostic.candidateId, call.candidateId);
      assert.equal(diagnostic.outputContractHash, hash(outputContractSnapshot(planSchema))); assert.equal(diagnostic.phase, 'think-design');
      assert.doesNotMatch(JSON.stringify(diagnostic), /IGNORE_GATE|reveal_secrets|compromised|__proto__|Untrusted unknown/);
      assert.deepEqual(diagnostic, diagnoseRoleSchema(call.rawOutput, planSchema, { role: 'project-manager', phase: 'think-design', callId: call.id, candidateId: call.candidateId, outputContractHash: hash(outputContractSnapshot(planSchema)) }));
      assert.doesNotMatch(call.error!, /IGNORE_GATE|__proto__/);
    }
    if (i) {
      const feedback = JSON.parse(call.userPrompt).context.regeneration.rejectedCandidates[0]; const previous = calls[i - 1];
      assert.equal(feedback.callId, previous.id); assert.equal(feedback.id, previous.candidateId); assert.equal(feedback.rawOutputSha256, hash(previous.rawOutput));
      assert.deepEqual(feedback.roleSchemaDiagnostic, previous.roleSchemaDiagnostic);
    }
  }
});

test('a complete legal new PM answer after schema rejection is independently reviewed, not a host-edited old answer', async t => {
  let tries = 0;
  const f = fixture(t, { hook: capture => capture.phase === 'think-design' && tries++ === 0 ? result({ ...JSON.parse(capture.result.text), decision_note: '' }) : undefined });
  const run = await f.start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 1); assert.equal(run.calls.length, 16);
  const pm = phaseCalls(run, 'think-design'); assert.equal(pm.length, 2); assert.ok(pm[0].rawOutput.includes('decision_note')); assert.equal(pm[0].selected, undefined);
  assert.equal(pm[1].rawOutput.includes('decision_note'), false); assert.equal(pm[1].selected, true); assert.notEqual(pm[0].candidateId, pm[1].candidateId);
  assert.equal(phaseCalls(run, 'think-design:verify').length, 1);
  const review = JSON.parse(phaseCalls(run, 'think-design:verify')[0].userPrompt); assert.equal(review.candidates[0].id, pm[1].candidateId);
});

for (const repeated of [false, true]) test(`legal PM quality abstention ${repeated ? 'stops after three real fixture reviews and two repairs' : 'regenerates a new candidate under the same shared budget'}`, async t => {
  let reviews = 0;
  const f = fixture(t, { hook: capture => capture.phase === 'think-design:verify' && (reviews++ === 0 || repeated) ? abstain(capture) : undefined });
  const run = await f.start(); const pm = phaseCalls(run, 'think-design');
  assert.equal(run.repairs, repeated ? 2 : 1); assert.equal(pm.length, repeated ? 3 : 2);
  assert.ok(pm.every(call => !call.error && !call.roleSchemaDiagnostic));
  assert.equal(phaseCalls(run, 'think-design:verify').length, repeated ? 3 : 2);
  if (repeated) { noDelivery(run); assert.equal(run.status, 'failed'); }
  else assert.equal(run.status, 'completed', run.error);
  const feedback = JSON.parse(pm[1].userPrompt).context.regeneration.rejectedCandidates[0];
  assert.equal(feedback.callId, pm[0].id); assert.match(feedback.error, /think-design Verifier 弃权/); assert.equal(feedback.roleSchemaDiagnostic, undefined);
});

test('acceptance-plan extra fields use its own three-field schema, never the ordinary four-field PM policy', async t => {
  const f = fixture(t, { hook: capture => capture.phase === 'acceptance-plan' ? result({ ...planFixture(), summary: 'Not permitted in this phase' }) : undefined });
  const run = await f.start(); noDelivery(run); assert.equal(run.repairs, 2); assert.equal(phaseCalls(run, 'acceptance-plan').length, 3);
  assert.equal(phaseCalls(run, 'acceptance-plan:verify').length, 0);
  for (const call of phaseCalls(run, 'acceptance-plan')) {
    const data = JSON.parse(call.userPrompt); assert.deepEqual(data.pmOutputPolicy.root.allowedFields, ['version', 'obligations', 'groups']);
    assert.equal(call.roleSchemaDiagnostic!.phase, 'acceptance-plan'); assert.equal(call.roleSchemaDiagnostic!.outputContractHash, hash(data.outputContract));
  }
});

test('unknown usage at a PM response stops without treating it as a recoverable schema rejection', async t => {
  const f = fixture(t, { hook: capture => capture.phase === 'think-design' ? { ...result({ decision_note: '' }), inputTokens: 0, outputTokens: 0, usageReported: false } : undefined });
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.equal(phaseCalls(run, 'think-design').length, 1); assert.equal(phaseCalls(run, 'think-design:verify').length, 0);
  assert.equal(run.usage.complete, false); assert.equal(run.usage.estimatedCost, null);
});

test('cancelled late PM invalid output cannot spend a repair or launch the next role', async t => {
  let entered!: () => void; let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(t, { hook: async capture => { if (capture.phase !== 'think-design') return; entered(); await barrier; return result({ decision_note: '' }); } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  f.begin();
  try {
    await Promise.race([waiting, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`PM fixture did not enter before bounded deadline: ${f.service.store.run(f.run.id)?.error ?? 'pending'}`)), 10000); })]);
    f.service.pipeline.cancel(f.run.id);
  } finally { if (timer) clearTimeout(timer); release(); }
  const run = await f.wait(); noDelivery(run); assert.equal(run.status, 'cancelled'); assert.equal(run.repairs, 0);
  assert.equal(phaseCalls(run, 'think-design').length, 1); assert.equal(phaseCalls(run, 'think-design:verify').length, 0);
  assert.equal(run.interventions.length, 1);
});

for (const tamper of ['callId', 'phase', 'sourceSha256', 'outputContractHash', 'deleted-diagnostic'] as const) test(`tampering rejected PM ${tamper} stops before the next paid boundary`, async t => {
  let changed = false;
  const f = fixture(t, { hook: capture => capture.phase === 'think-design' ? result({ ...JSON.parse(capture.result.text), decision_note: '' }) : undefined });
  const save = f.service.store.save.bind(f.service.store);
  t.mock.method(f.service.store, 'save', (run: ProductionRun) => {
    const call = phaseCalls(run, 'think-design')[0];
    if (!changed && call?.roleSchemaDiagnostic) { changed = true; if (tamper === 'deleted-diagnostic') delete call.roleSchemaDiagnostic; else call.roleSchemaDiagnostic = { ...call.roleSchemaDiagnostic, [tamper]: tamper === 'phase' ? 'acceptance-plan' : tamper === 'callId' ? randomUUID() : '0'.repeat(64) }; }
    save(run);
  });
  const run = await f.start(); noDelivery(run); assert.ok(changed); assert.equal(run.status, 'failed'); assert.equal(phaseCalls(run, 'think-design').length, 1);
  assert.match(run.error!, /结构诊断.*不一致/); assert.equal(phaseCalls(run, 'think-design:verify').length, 0);
});

for (const collision of [PM_OUTPUT_POLICY_VERSION, ROLE_SCHEMA_DIAGNOSTICS_VERSION, GROUPED_ACCEPTANCE_PROMPT_VERSION, ROLE_SCHEMA_DIAGNOSTICS_VERSION.slice(-16), 'pmOutputPolicy.designDefaultFields', ACCEPTANCE_STEP_AUDIT_VERSION, ACCEPTANCE_REVIEW_PROJECTION_VERSION, 'exactAssertionIndices', 'Step audit source binding rejected', 'stepAuditSha256绑定']) test(`retained PM/audit protocol credential collision of ${collision.length} characters fails at zero requests`, async t => {
  const f = fixture(t);
  if (collision === 'pmOutputPolicy.designDefaultFields') assert.ok(GROUPED_CONTRACT_INSTRUCTIONS['project-manager'].includes(collision));
  const legacy = f.service.store as unknown as { encrypt(secret: string): string; state: { agents: Array<{ secret?: string }>; snapshots: Record<string, Array<{ secret?: string }>> } };
  const encrypted = legacy.encrypt(collision); legacy.state.agents[0].secret = encrypted; legacy.state.snapshots[f.run.id][0].secret = encrypted;
  const run = await f.start(); noDelivery(run); assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 0); assert.equal(run.repairs, 0);
  assert.equal(f.captures.length, 0); assert.deepEqual(f.counts(), { preflights: 0, gates: 0 }); assert.match(run.error!, /凭据.*冲突/);
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
