import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { AcceptanceCheck } from '../server/gate.js';
import { ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_GROUP_VERSION, acceptancePlanHash, composeAcceptanceGroups, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { ACCEPTANCE_STEP_AUDIT_VERSION, buildAcceptanceStepAudit, type AcceptanceStepAuditInput } from '../server/production/acceptance-step-audit.js';

// Pure test-owned plan/check fixtures only. No provider, service, browser,
// credentials, generated-code execution, repair or business-success inference.
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
function check(id: string, count: number): AcceptanceCheck {
  return { name: `Independent fixture ${id}`, steps: Array.from({ length: count }, (_, index): AcceptanceCheck['steps'][number] => index === 0
    ? { action: 'fill', selector: '#input', value: 'Fixture only' }
    : index === 1 ? { action: 'click', selector: '#button' }
      : index % 2 ? { action: 'assertCount', selector: '#items', count: 1 } : { action: 'assertTextExact', selector: '#result', text: 'Exact fixture output' }) };
}
function fixture(counts = [19, 20]): AcceptanceStepAuditInput {
  const plan: AcceptancePlan = { version: ACCEPTANCE_PLAN_VERSION, obligations: [
    { id: 'o-brief', source: 'brief', quote: 'Original fixture brief', scenario: 'Independent new page.', expected: 'Required fixture result.' },
    { id: 'o-acceptance', source: 'acceptance', quote: 'Original fixture acceptance', scenario: 'Independent existing state.', expected: 'Unchanged fixture records.' },
  ], groups: counts.map((_count, index) => ({ id: `g-${index}`, checks: [{ id: `c-${index}`, obligationIds: [index ? 'o-acceptance' : 'o-brief'], setup: 'PM text claims 14 steps; this is not a measurement.', exercise: 'Perform required operations.', assertions: 'Assert required states.', stepBudget: 20 }] })) };
  const planHash = acceptancePlanHash(plan); const attemptId = uuid(1);
  const groups = plan.groups.map((group, index) => {
    const value = { version: ACCEPTANCE_GROUP_VERSION, planHash, attemptId, groupId: group.id, checks: group.checks.map(slot => ({ checkId: slot.id, check: check(slot.id, counts[index]!) })) };
    return { groupId: group.id, sourceCallId: uuid(index + 10), sourceCandidateId: uuid(index + 20), rawOutputSha256: hash(value), valueSha256: hash(value), value };
  });
  return { plan, planHash, attemptId, compositeCandidateId: uuid(2), groups, checks: composeAcceptanceGroups(plan, planHash, groups.map(group => group.value), attemptId) };
}
function refresh(input: AcceptanceStepAuditInput): void {
  input.planHash = acceptancePlanHash(input.plan);
  input.groups.forEach(source => { source.value.planHash = input.planHash; source.rawOutputSha256 = hash(source.value); source.valueSha256 = hash(source.value); });
  input.checks = input.groups.flatMap(source => source.value.checks.map(item => structuredClone(item.check)));
}
function rejected(operation: () => unknown, message?: string): void {
  let seen: unknown; try { operation(); } catch (error) { seen = error; }
  assert.ok(seen instanceof Error); assert.equal(seen.name, 'Error'); assert.equal(Object.hasOwn(seen, 'cause'), false);
  assert.ok(['Step audit identity rejected', 'Step audit source binding rejected', 'Step audit checks binding rejected'].includes(seen.message));
  if (message) assert.equal(seen.message, message);
  assert.equal(JSON.stringify(seen).includes('SECRET'), false);
}

test('audit measures actual nineteen/twenty steps instead of PM fourteen-step text and binds the exact successful source metadata', () => {
  const input = fixture(); const before = JSON.stringify(input); const audit = buildAcceptanceStepAudit(input);
  assert.equal(ACCEPTANCE_STEP_AUDIT_VERSION, 'production-acceptance-step-audit-v1'); assert.equal(audit.version, ACCEPTANCE_STEP_AUDIT_VERSION);
  assert.equal(audit.planHash, input.planHash); assert.equal(audit.attemptId, input.attemptId); assert.equal(audit.compositeCandidateId, input.compositeCandidateId); assert.equal(audit.checksSha256, hash(input.checks));
  assert.deepEqual(audit.slots.map(slot => [slot.checkIndex, slot.stepBudget, slot.actualStepCount]), [[0, 20, 19], [1, 20, 20]]);
  assert.deepEqual(audit.sourceGroups, input.groups.map(({ value: _value, ...source }) => source));
  audit.slots.forEach((slot, index) => {
    assert.equal(slot.groupId, input.plan.groups[index]!.id); assert.equal(slot.checkId, input.plan.groups[index]!.checks[0]!.id);
    assert.deepEqual(slot.obligationIds, input.plan.groups[index]!.checks[0]!.obligationIds);
    assert.deepEqual(slot.actionKinds, input.checks[index]!.steps.map(step => step.action));
    assert.deepEqual(slot.assertionIndices, Array.from({ length: slot.actualStepCount - 2 }, (_, i) => i + 2));
    assert.deepEqual(slot.exactAssertionIndices, slot.assertionIndices);
    assert.deepEqual(slot.operations, [{ stepIndex: 0, action: 'fill', embedded: false }, { stepIndex: 1, action: 'click', embedded: false }]);
  });
  assert.equal(JSON.stringify(input), before); assert.ok(!JSON.stringify(audit).includes('14 steps'));
});

test('embedded assertChanged operations retain their original array index and count as one outer step each', () => {
  const input = fixture([3, 3]);
  input.groups[0]!.value.checks[0]!.check.steps = [
    { action: 'assertChanged', selector: '#result', after: { action: 'click', selector: '#button' } },
    { action: 'assertChanged', selector: '#input', after: { action: 'fill', selector: '#input', value: 'Auxiliary only' } },
  ]; refresh(input);
  const slot = buildAcceptanceStepAudit(input).slots[0]!;
  assert.equal(slot.actualStepCount, 2); assert.deepEqual(slot.actionKinds, ['assertChanged', 'assertChanged']);
  assert.deepEqual(slot.operations, [{ stepIndex: 0, action: 'click', embedded: true }, { stepIndex: 1, action: 'fill', embedded: true }]);
  assert.deepEqual(slot.assertionIndices, [0, 1]); assert.deepEqual(slot.exactAssertionIndices, []);
});

test('actual twenty-one steps and a smaller registered slot budget are rejected, never clipped to fit the audit', () => {
  const input = fixture(); input.groups[0]!.value.checks[0]!.check.steps.push(...check('extra', 2).steps); refresh(input);
  const before = JSON.stringify(input); rejected(() => buildAcceptanceStepAudit(input), 'Step audit checks binding rejected'); assert.equal(JSON.stringify(input), before);
  const small = fixture(); small.plan.groups[0]!.checks[0]!.stepBudget = 14; refresh(small);
  rejected(() => buildAcceptanceStepAudit(small), 'Step audit checks binding rejected');
});

test('group/slot order and exact assembled checks are mandatory; no sorting, whitespace trimming or repaired copies', () => {
  const swapped = fixture(); swapped.groups.reverse(); rejected(() => buildAcceptanceStepAudit(swapped), 'Step audit source binding rejected');
  const checks = fixture(); checks.checks.reverse(); rejected(() => buildAcceptanceStepAudit(checks), 'Step audit checks binding rejected');
  const slot = fixture(); slot.groups[0]!.value.checks[0]!.checkId = 'c-other'; refresh(slot); rejected(() => buildAcceptanceStepAudit(slot));
  const changed = fixture(); changed.checks[0]!.steps[2] = { action: 'assertCount', selector: '#items', count: 99 }; rejected(() => buildAcceptanceStepAudit(changed), 'Step audit checks binding rejected');
  const normalized = fixture(); normalized.groups[0]!.value.checks[0]!.check.name = '  Keep illegal surrounding spaces  '; refresh(normalized); rejected(() => buildAcceptanceStepAudit(normalized));
});

test('UUID/plan/round/value hashes and unique source identities/raw hashes must match, without exposing hostile input errors', () => {
  for (const change of [
    (v: AcceptanceStepAuditInput) => { v.attemptId = 'SECRET-not-UUID'; },
    (v: AcceptanceStepAuditInput) => { v.compositeCandidateId = 'invalid'; },
    (v: AcceptanceStepAuditInput) => { v.planHash = '0'.repeat(64); },
    (v: AcceptanceStepAuditInput) => { v.groups[0]!.rawOutputSha256 = 'A'.repeat(64); },
    (v: AcceptanceStepAuditInput) => { v.groups[0]!.valueSha256 = '0'.repeat(64); },
    (v: AcceptanceStepAuditInput) => { v.groups[0]!.value.attemptId = uuid(99); },
    (v: AcceptanceStepAuditInput) => { v.groups[1]!.sourceCallId = v.groups[0]!.sourceCallId; },
    (v: AcceptanceStepAuditInput) => { v.groups[1]!.sourceCandidateId = v.groups[0]!.sourceCandidateId; },
    (v: AcceptanceStepAuditInput) => { v.groups[1]!.rawOutputSha256 = v.groups[0]!.rawOutputSha256; },
    (v: AcceptanceStepAuditInput) => { v.compositeCandidateId = v.groups[0]!.sourceCandidateId; },
  ]) { const input = fixture(); change(input); const before = JSON.stringify(input); rejected(() => buildAcceptanceStepAudit(input)); assert.equal(JSON.stringify(input), before); }
});

test('a raw source SHA with a trailing LF is rejected without changing the source record', () => {
  const input = fixture(); input.groups[0]!.rawOutputSha256 = `${'a'.repeat(64)}\n`;
  const before = JSON.stringify(input);
  rejected(() => buildAcceptanceStepAudit(input), 'Step audit identity rejected');
  assert.equal(JSON.stringify(input), before);
});

test('hashes preserve original property order, while metadata alone is explicitly not a proof of the original raw response bytes', () => {
  const input = fixture(); const value = input.groups[0]!.value;
  input.groups[0]!.value = { checks: value.checks, groupId: value.groupId, attemptId: value.attemptId, planHash: value.planHash, version: value.version };
  input.groups[0]!.valueSha256 = hash(input.groups[0]!.value); input.groups[0]!.rawOutputSha256 = 'a'.repeat(64);
  const before = JSON.stringify(input); const audit = buildAcceptanceStepAudit(input);
  assert.equal(audit.sourceGroups[0]!.valueSha256, hash(input.groups[0]!.value)); assert.notEqual(hash(input.groups[0]!.value), hash(value));
  assert.equal(audit.sourceGroups[0]!.rawOutputSha256, 'a'.repeat(64), 'Only the pipeline can compare supplied raw SHA to the real role call');
  assert.equal(JSON.stringify(input), before);
});

test('audit records action kinds only: initial-state checks need no click, and indices cannot certify setup, hint meaning or business coverage', () => {
  const input = fixture([3, 3]); input.groups[0]!.value.checks[0]!.check.steps = [{ action: 'assertCount', selector: '#items', count: 0 }]; refresh(input);
  const initial = buildAcceptanceStepAudit(input).slots[0]!; assert.equal(initial.actualStepCount, 1); assert.deepEqual(initial.operations, []); assert.deepEqual(initial.exactAssertionIndices, [0]);
  const weak = fixture([3, 3]); weak.groups[0]!.value.checks[0]!.check.steps = [
    { action: 'assertVisible', selector: '#irrelevant' }, { action: 'assertValue', selector: '#input', value: 'echo' }, { action: 'assertTextExact', selector: '#unrelated-hint', text: 'Not evidence of the planned state' },
  ]; refresh(weak);
  const audit = buildAcceptanceStepAudit(weak); assert.deepEqual(audit.slots[0]!.assertionIndices, [0, 1, 2]); assert.deepEqual(audit.slots[0]!.exactAssertionIndices, [2]);
  assert.equal(JSON.stringify(audit).includes('covered'), false); assert.equal(JSON.stringify(audit).includes('businessProven'), false); assert.equal(JSON.stringify(audit).includes('pass'), false);
});

test('audit exposes no source text/selectors/values and its detached arrays never change original plan or checks', () => {
  const input = fixture(); const marker = 'SECRET-FIXTURE-DO-NOT-COPY';
  input.plan.obligations[0]!.scenario = marker; input.groups[0]!.value.checks[0]!.check.steps[0] = { action: 'fill', selector: '#private-fixture', value: marker }; refresh(input);
  const before = JSON.stringify(input); const audit = buildAcceptanceStepAudit(input); const output = JSON.stringify(audit);
  for (const word of [marker, '#private-fixture', '"selector"', '"value"', '"rawOutput"', '"scenario"', '"expected"']) assert.equal(output.includes(word), false);
  audit.slots[0]!.obligationIds[0] = 'detached'; audit.slots[0]!.actionKinds[0] = 'click'; audit.sourceGroups[0]!.groupId = 'detached';
  assert.equal(JSON.stringify(input), before);
});

test('full twelve-check/twenty-step capacity is audited losslessly, including every twenty-four-obligation reference', () => {
  const input = fixture(); input.plan.obligations = Array.from({ length: 24 }, (_, i) => ({ id: `o-${i}`, source: i ? 'acceptance' as const : 'brief' as const, quote: 'Original source fixture', scenario: 'Independent fixture state.', expected: 'Required fixture assertion.' }));
  input.plan.groups = Array.from({ length: 3 }, (_, g) => ({ id: `g-${g}`, checks: Array.from({ length: 4 }, (_, c) => ({ id: `c-${g}-${c}`, obligationIds: input.plan.obligations.map(item => item.id), setup: 'Independent setup.', exercise: 'Required actions.', assertions: 'All required results.', stepBudget: 20 })) }));
  input.planHash = acceptancePlanHash(input.plan);
  input.groups = input.plan.groups.map((group, i) => {
    const value = { version: ACCEPTANCE_GROUP_VERSION, planHash: input.planHash, attemptId: input.attemptId, groupId: group.id, checks: group.checks.map(slot => ({ checkId: slot.id, check: check(slot.id, 20) })) };
    return { groupId: group.id, sourceCallId: uuid(i + 10), sourceCandidateId: uuid(i + 20), rawOutputSha256: hash(value), valueSha256: hash(value), value };
  }); refresh(input);
  const before = JSON.stringify(input); const audit = buildAcceptanceStepAudit(input);
  assert.equal(audit.slots.length, 12); assert.equal(audit.sourceGroups.length, 3);
  assert.ok(audit.slots.every(slot => slot.actualStepCount === 20 && slot.actionKinds.length === 20 && slot.obligationIds.length === 24));
  assert.deepEqual(audit.slots.map(slot => slot.checkIndex), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(audit.checksSha256, hash(input.checks)); assert.equal(JSON.stringify(input), before);
});

test('non-JSON input/accessors/proxies/cycles, huge/deep trees and extra source fields fail with fixed errors before coercion', () => {
  let touched = 0; const getter = fixture(); Object.defineProperty(getter.groups[0], 'value', { get() { touched++; throw new Error('SECRET'); }, enumerable: true });
  rejected(() => buildAcceptanceStepAudit(getter)); assert.equal(touched, 0);
  const proxy = new Proxy(fixture(), { get() { touched++; throw new Error('SECRET'); } }); rejected(() => buildAcceptanceStepAudit(proxy)); assert.equal(touched, 0);
  const cycle = fixture() as AcceptanceStepAuditInput & { cycle?: unknown }; cycle.cycle = cycle; rejected(() => buildAcceptanceStepAudit(cycle));
  for (const extra of [undefined, NaN, BigInt(1), () => 'SECRET']) { const value = fixture() as unknown as Record<string, unknown>; value.extra = extra; rejected(() => buildAcceptanceStepAudit(value as unknown as AcceptanceStepAuditInput)); }
  const many = fixture() as unknown as Record<string, unknown>; many.extra = Array.from({ length: 10000 }, () => 0); rejected(() => buildAcceptanceStepAudit(many as unknown as AcceptanceStepAuditInput));
  const deep = fixture() as unknown as Record<string, unknown>; let nested: unknown = 0; for (let i = 0; i < 17; i++) nested = [nested]; deep.extra = nested; rejected(() => buildAcceptanceStepAudit(deep as unknown as AcceptanceStepAuditInput));
  const source = fixture(); Object.assign(source.groups[0]!, { rawOutput: 'SECRET' }); rejected(() => buildAcceptanceStepAudit(source));
});
