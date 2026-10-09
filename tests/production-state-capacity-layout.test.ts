import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { AcceptanceCheck } from '../server/gate.js';
import { testsSchema } from '../server/production/contracts.js';
import { acceptanceCapacityFacts, diagnoseAcceptanceCapacity } from '../server/production/acceptance-diagnostics.js';
import { ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_PLAN_VERSION, acceptancePlanHash, composeAcceptanceGroups, type AcceptanceGroup, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { buildAcceptanceStepAudit, type AcceptanceStepAuditInput } from '../server/production/acceptance-step-audit.js';

// Pure, test-owned counting layouts, not model output or a business solution.
// Nothing renders a page, calls a provider/store, executes Gate/SDK code, or
// certifies selectors, independent setup, semantic coverage or the eight-clause
// requirement. Splitting this example only demonstrates legal capacity shapes.
type Step = AcceptanceCheck['steps'][number];
type State = 'empty' | 'existing';
const states: State[] = ['empty', 'existing'];
const invalidAmounts = ['-1', '0', '', '1.234', '10000.00'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function unchangedStatistics(state: State): Step[] {
  return [
    { action: 'assertCount', selector: '.record', count: state === 'empty' ? 0 : 1 },
    { action: 'assertTextExact', selector: '#total', text: state === 'empty' ? '0.00' : '10.10' },
    { action: 'assertTextExact', selector: '#subtotal', text: state === 'empty' ? '0.00' : '10.10' },
  ];
}

function unchangedContent(state: State): Step {
  return state === 'empty'
    ? { action: 'assertCount', selector: '.record-description', count: 0 }
    : { action: 'assertTextExact', selector: '.record-description', text: 'Seed fixture row' };
}

// Lower-bound example only: description/category/setup/content are deliberately
// excluded here, so even its thirty entries cannot prove a valid business test.
function sixStepNegative(amount: string, state: State): Step[] {
  return [
    { action: 'fill', selector: '#amount', value: amount },
    { action: 'click', selector: '#add' },
    { action: 'assertTextExact', selector: '#validation-hint', text: 'Amount rejected' },
    ...unchangedStatistics(state),
  ];
}

function validOtherFields(description: string): Step[] {
  return [
    { action: 'fill', selector: '#description', value: description },
    { action: 'click', selector: '#category-office' },
  ];
}

function initialState(state: State): Step[] {
  const setup: Step[] = state === 'existing' ? [
    ...validOtherFields('Seed fixture row'),
    { action: 'fill', selector: '#amount', value: '10.10' },
    { action: 'click', selector: '#add' },
  ] : [];
  return [...setup, ...unchangedStatistics(state), unchangedContent(state)];
}

function completeNegative(amount: string, state: State, index: number): Step[] {
  // Refill every other field for EVERY attempted amount, not just the first
  // case, and check the pre-existing content/statistics after EVERY rejection.
  return [...validOtherFields(`Valid fixture attempt ${index}`), ...sixStepNegative(amount, state), unchangedContent(state)];
}

function splitLayouts(): AcceptanceCheck[] {
  return states.flatMap(state => invalidAmounts.map((amount, index) => ({
    name: `Independent ${state} negative ${index}`,
    steps: [...initialState(state), ...completeNegative(amount, state, index)],
  })));
}

function auditInput(checks: AcceptanceCheck[], stepBudget = 20): AcceptanceStepAuditInput {
  const plan: AcceptancePlan = {
    version: ACCEPTANCE_PLAN_VERSION,
    obligations: [
      { id: 'brief-fixture', source: 'brief', quote: 'Test-owned capacity fixture.', scenario: 'Declared independent starting states.', expected: 'Capacity facts only, no business certificate.' },
      { id: 'acceptance-fixture', source: 'acceptance', quote: 'Observe unchanged fixture rows.', scenario: 'Each negative has its own declared setup.', expected: 'Literal fixture assertions, not executed results.' },
    ],
    groups: Array.from({ length: Math.ceil(checks.length / 4) }, (_, group) => ({
      id: `g-${group}`,
      checks: checks.slice(group * 4, group * 4 + 4).map((_check, index) => ({
        id: `c-${group * 4 + index}`, obligationIds: ['brief-fixture', 'acceptance-fixture'],
        setup: 'PM text claims 14 or 20 steps; not a measurement or setup proof.',
        exercise: 'Read the actual complete step array.', assertions: 'Count only, never infer semantic coverage.', stepBudget,
      })),
    })),
  };
  const planHash = acceptancePlanHash(plan); const attemptId = uuid(1);
  const groups = plan.groups.map((group, groupIndex) => {
    const value: AcceptanceGroup = {
      version: ACCEPTANCE_GROUP_VERSION, planHash, attemptId, groupId: group.id,
      checks: group.checks.map((slot, index) => ({ checkId: slot.id, check: structuredClone(checks[groupIndex * 4 + index]!) })),
    };
    // Synthetic identities and JSON hashes are test bindings, not real call
    // lineage. The actual pipeline, not this pure fixture, authenticates calls.
    return { groupId: group.id, sourceCallId: uuid(10 + groupIndex), sourceCandidateId: uuid(20 + groupIndex), rawOutputSha256: hash(value), valueSha256: hash(value), value };
  });
  // Do not compose/clip invalid layouts here: the audit must reject the supplied
  // original arrays itself, including cases exceeding the Gate/slot budgets.
  return { plan, planHash, attemptId, compositeCandidateId: uuid(2), groups, checks: structuredClone(checks) };
}

function assertCapacityRefusal(checks: AcceptanceCheck[], stepCounts: number[]): void {
  const before = JSON.stringify(checks); const raw = JSON.stringify({ checks });
  assert.equal(testsSchema.safeParse({ checks }).success, false);
  const diagnostic = diagnoseAcceptanceCapacity(raw); assert.ok(diagnostic);
  assert.equal(diagnostic.sourceSha256, hashRaw(raw));
  assert.deepEqual(diagnostic.stepCounts, stepCounts);
  assert.deepEqual(diagnostic.oversizedStepCheckIndices, stepCounts.flatMap((count, index) => count > 20 ? [index] : []));
  assert.equal(diagnostic.checkCountExceedsLimit, checks.length > 12);
  assert.equal(JSON.stringify(checks), before, 'Diagnosis/schema checks never repair or clip the layout');
}
const hashRaw = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');

test('state-layout examples retain the original immutable twelve-check/twenty-step capacity facts', () => {
  const facts = acceptanceCapacityFacts();
  assert.deepEqual([facts.maxChecks, facts.maxSteps], [12, 20]); assert.equal(Object.isFrozen(facts), true);
  assert.equal(acceptanceCapacityFacts(), facts);
});

test('five six-entry negative cases consume thirty steps per state regardless of PM fourteen/twenty-step claims', () => {
  const checks = states.map(state => ({ name: `Lower-bound ${state} layout`, steps: invalidAmounts.flatMap(amount => sixStepNegative(amount, state)) }));
  assert.ok(states.every(state => invalidAmounts.every(amount => sixStepNegative(amount, state).length === 6)));
  assertCapacityRefusal(checks, [30, 30]);
  for (const budget of [14, 20]) {
    const input = auditInput(checks, budget); const before = JSON.stringify(input);
    assert.throws(() => buildAcceptanceStepAudit(input), { message: 'Step audit checks binding rejected' });
    assert.equal(JSON.stringify(input), before);
  }
});

test('independent setup, refilled legal other fields and per-negative content/statistics require more than the thirty-step lower bound', () => {
  const checks = states.map(state => ({ name: `Full counting example ${state}`, steps: [...initialState(state), ...invalidAmounts.flatMap((amount, index) => completeNegative(amount, state, index))] }));
  assertCapacityRefusal(checks, [49, 53]);
  for (const [stateIndex, state] of states.entries()) {
    const steps = checks[stateIndex]!.steps; const prefix = initialState(state);
    assert.deepEqual(steps.slice(0, prefix.length), prefix);
    invalidAmounts.forEach((amount, index) => {
      const start = prefix.length + index * 9;
      assert.deepEqual(steps.slice(start, start + 9), completeNegative(amount, state, index));
      assert.deepEqual(steps.slice(start + 5, start + 8), unchangedStatistics(state));
      assert.deepEqual(steps[start + 8], unchangedContent(state));
    });
  }
  const input = auditInput(checks); const before = JSON.stringify(input);
  assert.throws(() => buildAcceptanceStepAudit(input), { message: 'Step audit checks binding rejected' });
  assert.equal(JSON.stringify(input), before);
});

test('ten independently initialized split slots fit thirteen/seventeen actual steps but prove only capacity, not the full requirement', () => {
  const checks = splitLayouts(); const before = JSON.stringify(checks);
  assert.equal(checks.length, 10); assert.equal(testsSchema.safeParse({ checks }).success, true);
  assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ checks })), undefined);
  checks.forEach((check, index) => {
    const state = states[Math.floor(index / invalidAmounts.length)]!;
    assert.deepEqual(check.steps.slice(0, initialState(state).length), initialState(state));
    assert.deepEqual(check.steps.slice(initialState(state).length), completeNegative(invalidAmounts[index % invalidAmounts.length]!, state, index % invalidAmounts.length));
    assert.equal(check.steps.length, state === 'empty' ? 13 : 17);
  });
  const input = auditInput(checks); const audit = buildAcceptanceStepAudit(input);
  assert.deepEqual(composeAcceptanceGroups(input.plan, input.planHash, input.groups.map(group => group.value), input.attemptId), checks);
  assert.deepEqual(audit.slots.map(slot => slot.actualStepCount), [13, 13, 13, 13, 13, 17, 17, 17, 17, 17]);
  assert.ok(audit.slots.every(slot => slot.stepBudget === 20 && slot.actualStepCount <= 20));
  for (const key of ['covered', 'businessProven', 'setupProven', 'passed', 'executed']) assert.equal(Object.hasOwn(audit, key), false);
  assert.equal(JSON.stringify(checks), before);
});

test('a legal seventeen-step array still exceeds a fourteen-step planned slot and is rejected without trusting its text', () => {
  const layouts = splitLayouts(); const checks = [layouts[0]!, layouts[5]!];
  assert.equal(testsSchema.safeParse({ checks }).success, true, 'The original twenty-step Gate capacity is not the narrower planned budget');
  assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ checks })), undefined);
  const input = auditInput(checks, 14); const before = JSON.stringify(input);
  assert.deepEqual(input.checks.map(check => check.steps.length), [13, 17]);
  assert.throws(() => buildAcceptanceStepAudit(input), { message: 'Step audit checks binding rejected' });
  assert.equal(JSON.stringify(input), before);
});

test('splitting may reach twelve checks but a thirteenth remains rejected by the original total capacity and exact audit composition', () => {
  const initialOnly = (index: number): AcceptanceCheck => ({ name: `Independent initial-only fixture ${index}`, steps: initialState('empty') });
  const checks = [...splitLayouts(), initialOnly(0), initialOnly(1)];
  assert.equal(checks.length, 12); assert.equal(testsSchema.safeParse({ checks }).success, true);
  const input = auditInput(checks); assert.equal(buildAcceptanceStepAudit(input).slots.length, 12);
  const tooMany = [...checks, initialOnly(2)]; assertCapacityRefusal(tooMany, tooMany.map(check => check.steps.length));
  // The original twelve registered source slots do not permit a thirteenth
  // supplied check. No synthetic invalid thirteen-slot plan is normalized.
  const extended = structuredClone(input); extended.checks = structuredClone(tooMany); const before = JSON.stringify(extended);
  assert.throws(() => buildAcceptanceStepAudit(extended), { message: 'Step audit checks binding rejected' });
  assert.equal(JSON.stringify(extended), before);
});

test('assertChanged.after retains one outer array step: twenty embedded operations fit, the twenty-first does not', () => {
  const embedded: AcceptanceCheck = { name: 'Embedded-operation counting fixture', steps: Array.from({ length: 20 }, (_, index): Step => ({
    action: 'assertChanged', selector: index % 2 ? '#description' : '#observable-result',
    after: index % 2 ? { action: 'fill', selector: '#description', value: 'Auxiliary fixture only' } : { action: 'click', selector: '#add' },
  })) };
  const checks = [embedded, splitLayouts()[0]!]; const input = auditInput(checks); const audit = buildAcceptanceStepAudit(input); const slot = audit.slots[0]!;
  assert.equal(testsSchema.safeParse({ checks }).success, true); assert.equal(slot.actualStepCount, 20);
  assert.equal(slot.operations.length, 20); assert.ok(slot.operations.every(operation => operation.embedded));
  assert.deepEqual(slot.operations.map(operation => operation.stepIndex), Array.from({ length: 20 }, (_, index) => index));
  assert.equal(slot.actualStepCount + slot.operations.length, 40, 'Flattening embedded operations would incorrectly double the existing Gate count');
  const oversized = structuredClone(checks); oversized[0]!.steps.push(structuredClone(embedded.steps[0]!));
  assertCapacityRefusal(oversized, [21, 13]);
  assert.throws(() => buildAcceptanceStepAudit(auditInput(oversized)), { message: 'Step audit checks binding rejected' });
});

test('short schema-valid unrelated assertions demonstrate that capacity and audit indices do not certify meaningful setup or coverage', () => {
  const weak: AcceptanceCheck[] = [
    { name: 'Weak interaction fixture', steps: [{ action: 'fill', selector: '#description', value: 'Input only' }, { action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#unrelated-banner', text: 'Fixture banner' }] },
    { name: 'Weak empty-state fixture', steps: [{ action: 'assertCount', selector: '.record', count: 0 }] },
  ];
  assert.equal(testsSchema.safeParse({ checks: weak }).success, true);
  assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ checks: weak })), undefined);
  const audit = buildAcceptanceStepAudit(auditInput(weak)); assert.deepEqual(audit.slots.map(slot => slot.actualStepCount), [3, 1]);
  assert.deepEqual(audit.slots[0]!.exactAssertionIndices, [2]);
  assert.equal(audit.slots.flatMap(slot => slot.actionKinds).includes('assertTextExact'), true);
  for (const key of ['covered', 'businessProven', 'setupProven', 'passed', 'executed']) assert.equal(Object.hasOwn(audit, key), false);
  // No actual page or requirement Oracle ran. These passed structural checks
  // deliberately cannot establish the omitted five negatives or either state.
});
