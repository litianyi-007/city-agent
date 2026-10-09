import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AcceptanceCheck } from '../server/gate.js';
import { testsSchema } from '../server/production/contracts.js';
import { acceptanceCapacityFacts, diagnoseAcceptanceCapacity } from '../server/production/acceptance-diagnostics.js';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { acceptancePlanSchema, acceptancePlanHash, parseAcceptancePlan, composeAcceptanceGroups } from '../server/production/acceptance-plan.js';
import { buildAcceptanceStepAudit, type AcceptanceStepAuditInput } from '../server/production/acceptance-step-audit.js';
import { expenseChecks, expenseSource, expenseAuditInput } from './fixtures/production-expense-witness.js';

// Test-owned structural/capacity evidence ONLY. No provider, service, private
// configuration, generated project, browser or actual Gate is invoked here.
// A legitimate plan/hash/audit does not prove setup, coverage or autonomous
// delivery. Separate browser tests must execute the witness and its mutants.
const sourceUrl = new URL('../docs/production/experiments/HTML-08/input-snapshot.json', import.meta.url);
const originalFileSha256 = '41e97f5469241ad1e60e04af64e0425864c9466b0a133c5b200d90ab4ab7bb03';
const originalMaterialsSha256 = '73f5f08b0ea999fe52adfcc8d56b837026365d81c7e993be586a7c1cff56565f';
const actualStepCounts = [16, 16, 20, 20, 20, 12, 20, 20, 16, 19, 20, 20];
const shaBytes = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const shaValue = (value: unknown) => shaBytes(JSON.stringify(value));

/** Refresh only synthetic binding metadata after an intentional test change.
 * Never repair the supplied steps, plan budgets, group order or source quotes. */
function refreshBindings(input: AcceptanceStepAuditInput): void {
  input.planHash = acceptancePlanHash(input.plan);
  for (const source of input.groups) {
    source.value.planHash = input.planHash;
    source.valueSha256 = shaValue(source.value);
    source.rawOutputSha256 = shaValue(source.value);
  }
}

function rejectsWithoutMutation(input: AcceptanceStepAuditInput): void {
  const before = JSON.stringify(input);
  assert.throws(() => buildAcceptanceStepAudit(input), /Step audit (identity|source binding|checks binding) rejected/);
  assert.equal(JSON.stringify(input), before, 'Rejected data must not be clipped, reordered or repaired');
}

test('expense witness binds the exact archived HTML08 bytes and retains both complete original materials', () => {
  const bytes = readFileSync(sourceUrl); const original = JSON.parse(bytes.toString('utf8'));
  const source = expenseSource();
  assert.equal(shaBytes(bytes), originalFileSha256);
  assert.equal(source.sha256, originalFileSha256, 'Source hash covers original file bytes, not reserialized JSON');
  assert.equal(source.brief, original.brief);
  assert.equal(source.acceptance, original.requirement.acceptance);
  assert.equal(shaValue({ brief: source.brief, acceptance: source.acceptance }), originalMaterialsSha256);
  assert.equal(source.acceptance.split('\n').filter(line => /^[1-8]\. /.test(line)).length, 8);
  assert.ok(source.acceptance.includes('各独立check自行setup，不依赖前一个检查的页面状态；最多12项、每项20步。'));
});

test('twelve complete arrays fit the unchanged 12 by 20 capacity with exactly three groups of four', () => {
  const checks = expenseChecks(); const input = expenseAuditInput(checks); const before = JSON.stringify(input);
  assert.deepEqual([acceptanceCapacityFacts().maxChecks, acceptanceCapacityFacts().maxSteps], [12, 20]);
  assert.equal(testsSchema.safeParse({ checks }).success, true);
  assert.equal(preflightAcceptanceSemantics(checks, expenseSource()).valid, true, 'Pure preflight, not executed behavior');
  assert.deepEqual(checks.map(check => check.steps.length), actualStepCounts);
  assert.equal(actualStepCounts.reduce((sum, count) => sum + count, 0), 219);
  assert.deepEqual(input.plan.groups.map(group => group.checks.length), [4, 4, 4]);
  assert.deepEqual(input.groups.map(group => group.value.checks.length), [4, 4, 4]);
  assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ checks })), undefined, 'No capacity refusal; not a coverage certificate');
  const audit = buildAcceptanceStepAudit(input);
  assert.deepEqual(audit.slots.map(slot => slot.actualStepCount), actualStepCounts);
  assert.ok(audit.slots.every(slot => slot.stepBudget === 20));
  assert.equal(audit.checksSha256, shaValue(checks));
  assert.equal(JSON.stringify(input), before);
});

test('plan quotes preserve all eight original clauses and compose exactly the original arrays in registered order', () => {
  const checks = expenseChecks(); const source = expenseSource(); const input = expenseAuditInput(checks);
  const before = JSON.stringify({ checks, input });
  const plan = parseAcceptancePlan(input.plan, source);
  assert.equal(plan.obligations.length, 9);
  assert.deepEqual(plan.obligations.map(obligation => obligation.quote), [source.brief, ...source.acceptance.split('\n').slice(0, 8)]);
  assert.deepEqual(plan.obligations.map(obligation => obligation.source), ['brief', ...Array.from({ length: 8 }, () => 'acceptance')]);
  assert.equal(input.planHash, acceptancePlanHash(plan));
  assert.equal(new Set(plan.groups.flatMap(group => group.checks.map(slot => slot.id))).size, 12);
  assert.deepEqual(composeAcceptanceGroups(plan, input.planHash, input.groups.map(group => group.value), input.attemptId), checks);
  const audit = buildAcceptanceStepAudit(input);
  assert.deepEqual(audit.sourceGroups, input.groups.map(({ value: _value, ...source }) => source));
  for (const sourceGroup of input.groups) assert.equal(sourceGroup.valueSha256, shaValue(sourceGroup.value));
  assert.equal(JSON.stringify({ checks, input }), before);
  assert.equal(shaBytes(readFileSync(sourceUrl)), originalFileSha256);
});

test('fixture calls return independent values rather than sharing a mutable future source or expected result', () => {
  const first = expenseChecks(); const second = expenseChecks();
  const input = expenseAuditInput(first); const before = JSON.stringify(input);
  first[0]!.steps[0] = { action: 'click', selector: '#test-owned-mutation' };
  assert.notDeepEqual(first, second);
  assert.deepEqual(expenseChecks(), second);
  assert.equal(JSON.stringify(input), before, 'Audit input retains independent original checks and group copies');
  input.checks[0]!.steps[0] = { action: 'click', selector: '#different-test-mutation' };
  assert.deepEqual(input.groups[0]!.value.checks[0]!.check, second[0]);
  assert.equal(shaBytes(readFileSync(sourceUrl)), originalFileSha256);
});

test('a fabricated original-source quote is rejected rather than becoming authority through valid IDs', () => {
  const input = expenseAuditInput(); const plan = structuredClone(input.plan);
  plan.obligations[1]!.quote = 'A fabricated easier business requirement.';
  assert.equal(acceptancePlanSchema.safeParse(plan).success, true, 'Structure alone cannot authenticate a quote');
  assert.throws(() => parseAcceptancePlan(plan, expenseSource()), /plan-source-quote/);
  assert.equal(expenseSource().sha256, originalFileSha256);
});

for (const kind of ['plan-hash', 'value-hash', 'malformed-raw-hash', 'round', 'duplicate-call', 'duplicate-candidate'] as const) {
  test(`expense audit rejects ${kind} source tampering without rewriting the original`, () => {
    const input = expenseAuditInput();
    if (kind === 'plan-hash') input.planHash = '0'.repeat(64);
    else if (kind === 'value-hash') input.groups[0]!.valueSha256 = '0'.repeat(64);
    else if (kind === 'malformed-raw-hash') input.groups[0]!.rawOutputSha256 += '\n';
    else if (kind === 'round') input.groups[0]!.value.attemptId = '00000000-0000-4000-8000-000000000099';
    else if (kind === 'duplicate-call') input.groups[1]!.sourceCallId = input.groups[0]!.sourceCallId;
    else input.groups[1]!.sourceCandidateId = input.groups[0]!.sourceCandidateId;
    rejectsWithoutMutation(input);
  });
}

test('well-formed raw hashes remain metadata until the real pipeline authenticates actual call bytes', () => {
  const input = expenseAuditInput(); input.groups[0]!.rawOutputSha256 = 'a'.repeat(64);
  const audit = buildAcceptanceStepAudit(input);
  assert.equal(audit.sourceGroups[0]!.rawOutputSha256, 'a'.repeat(64));
  assert.notEqual(input.groups[0]!.rawOutputSha256, shaValue(input.groups[0]!.value));
  for (const key of ['authenticated', 'covered', 'passed', 'executed']) assert.equal(Object.hasOwn(audit, key), false);
});

test('group order, check order and exact steps cannot be changed while retaining the same registered evidence', () => {
  const groups = expenseAuditInput(); groups.groups.reverse(); rejectsWithoutMutation(groups);
  const checks = expenseAuditInput(); checks.checks.reverse(); rejectsWithoutMutation(checks);
  const changed = expenseAuditInput(); changed.checks[0]!.steps[0] = { action: 'fill', selector: '#description', value: 'Changed after composition' };
  rejectsWithoutMutation(changed);
});

test('an actually smaller slot budget rejects the unchanged legal arrays despite refreshed valid source hashes', () => {
  const input = expenseAuditInput(); input.plan.groups[0]!.checks[0]!.stepBudget = 15;
  refreshBindings(input);
  assert.equal(testsSchema.safeParse({ checks: input.checks }).success, true);
  assert.equal(input.checks[0]!.steps.length, 16);
  rejectsWithoutMutation(input);
});

test('twenty-one actual steps are refused without clipping even when the original other eleven checks fit', () => {
  const checks = expenseChecks(); checks[3]!.steps.push(structuredClone(checks[3]!.steps[0]!));
  const input = expenseAuditInput(checks);
  assert.equal(testsSchema.safeParse({ checks }).success, false);
  const diagnostic = diagnoseAcceptanceCapacity(JSON.stringify({ checks })); assert.ok(diagnostic);
  assert.deepEqual(diagnostic.oversizedStepCheckIndices, [3]);
  assert.equal(diagnostic.stepCounts[3], 21);
  assert.equal(diagnostic.checkCountExceedsLimit, false);
  rejectsWithoutMutation(input);
});

test('a thirteenth supplied check cannot be silently dropped to the twelve registered slots', () => {
  const checks = [...expenseChecks(), { name: 'Extra thirteenth check', steps: [{ action: 'assertCount' as const, selector: '#ledger .record', count: 0 }] }];
  const input = expenseAuditInput(checks);
  assert.equal(input.checks.length, 13);
  assert.equal(testsSchema.safeParse({ checks }).success, false);
  const diagnostic = diagnoseAcceptanceCapacity(JSON.stringify({ checks })); assert.ok(diagnostic);
  assert.equal(diagnostic.checkCount, 13); assert.equal(diagnostic.checkCountExceedsLimit, true);
  assert.deepEqual(diagnostic.oversizedStepCheckIndices, []);
  rejectsWithoutMutation(input);
});

test('a fourth group is rejected rather than expanding the original three-group plan limit', () => {
  const input = expenseAuditInput(); const extra = structuredClone(input.plan.groups[0]!);
  extra.id = 'g4'; extra.checks.forEach((slot, index) => { slot.id = `extra-${index}`; });
  input.plan.groups.push(extra);
  assert.equal(acceptancePlanSchema.safeParse(input.plan).success, false);
  assert.throws(() => acceptancePlanHash(input.plan), /plan-structure/);
  rejectsWithoutMutation(input);
});

type WeakKind = 'missing-valid-other-field' | 'missing-content-and-statistics' | 'cross-check-state' | 'only-last-negative-results' | 'missing-per-attempt-prompt';
function weakChecks(kind: WeakKind): AcceptanceCheck[] {
  const seed: AcceptanceCheck['steps'] = [
    { action: 'fill', selector: '#description', value: 'Seed' }, { action: 'fill', selector: '#amount', value: '10.10' }, { action: 'click', selector: '#add' },
  ];
  const steps: AcceptanceCheck['steps'] = [...seed,
    { action: 'fill', selector: '#description', value: 'Valid' }, { action: 'fill', selector: '#amount', value: '-1' }, { action: 'click', selector: '#add' },
    { action: 'assertTextExact', selector: '#hint', text: 'Rejected' }, { action: 'assertCount', selector: '.record', count: 1 },
    { action: 'assertTextExact', selector: '.record-description', text: 'Seed' },
    { action: 'assertTextExact', selector: '#total', text: '10.10' }, { action: 'assertTextExact', selector: '#subtotal', text: '10.10' },
  ];
  if (kind === 'missing-valid-other-field') steps.splice(3, 1);
  else if (kind === 'missing-content-and-statistics') steps.splice(8);
  else if (kind === 'cross-check-state') steps.splice(0, seed.length);
  else if (kind === 'only-last-negative-results') steps.splice(6, 0, { action: 'fill', selector: '#amount', value: '0' }, { action: 'click', selector: '#add' });
  else steps.splice(6, 1);
  // The first check creates a record, but Gate opens a NEW page for every later
  // check. It cannot supply the missing seed in the cross-check-state variant.
  const positive: AcceptanceCheck = { name: 'Independent seed, not reusable check state', steps: [...seed,
    { action: 'assertCount', selector: '.record', count: 1 }, { action: 'assertTextExact', selector: '.record-description', text: 'Seed' },
  ] };
  // Exact twelve-slot bindings do not magically add missing semantic coverage.
  return [positive, ...Array.from({ length: 11 }, (_, index) => ({ name: `Deliberately weak ${kind} ${index}`, steps: structuredClone(steps) }))];
}

for (const kind of ['missing-valid-other-field', 'missing-content-and-statistics', 'cross-check-state', 'only-last-negative-results', 'missing-per-attempt-prompt'] as const) {
  test(`schema and step-audit acceptance do not certify the deliberate ${kind} coverage defect`, () => {
    const checks = weakChecks(kind); const before = JSON.stringify(checks);
    assert.equal(testsSchema.safeParse({ checks }).success, true);
    assert.equal(preflightAcceptanceSemantics(checks, expenseSource()).valid, true);
    assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ checks })), undefined);
    const input = expenseAuditInput(checks); const audit = buildAcceptanceStepAudit(input);
    assert.equal(audit.slots.length, 12);
    assert.deepEqual(audit.slots.map(slot => slot.actualStepCount), checks.map(check => check.steps.length));
    assert.ok(audit.slots.every(slot => slot.exactAssertionIndices.length > 0));
    const negative = checks[1]!;
    if (kind === 'missing-valid-other-field') assert.equal(negative.steps.some(step => step.action === 'fill' && step.value === 'Valid'), false);
    else if (kind === 'missing-content-and-statistics') assert.equal(negative.steps.some(step => ['.record-description', '#total', '#subtotal'].includes(step.selector)), false);
    else if (kind === 'cross-check-state') {
      assert.ok(checks[0]!.steps.some(step => step.action === 'fill' && step.value === 'Seed'));
      assert.equal(negative.steps.some(step => step.action === 'fill' && step.value === 'Seed'), false);
    } else if (kind === 'only-last-negative-results') assert.ok(negative.steps.slice(6, 8).every(step => step.action === 'fill' || step.action === 'click'));
    else assert.equal(negative.steps.some(step => step.selector === '#hint'), false);
    for (const key of ['covered', 'businessProven', 'setupProven', 'passed', 'executed']) assert.equal(Object.hasOwn(audit, key), false);
    assert.equal(JSON.stringify(checks), before);
  });
}
