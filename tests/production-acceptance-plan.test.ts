import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { acceptanceCheckSchema, acceptanceSchema, type AcceptanceCheck } from '../server/gate.js';
import {
  ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_CONSTRUCTION_VERSION,
  ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS, AcceptancePlanError, acceptancePlanSchema,
  parseAcceptancePlan, acceptancePlanHash, acceptanceGroupSchema, parseAcceptanceGroup, composeAcceptanceGroups,
  type AcceptancePlan, type AcceptanceGroup,
} from '../server/production/acceptance-plan.js';

// Pure contract fixtures only. No SDK, model, transport, browser, generated
// HTML, execution claim, automatic repair or real business answer is involved.
const source = { brief: 'Build an offline list with exact addition.', acceptance: 'New items are displayed. Empty input is rejected.' };
const attemptId = '11111111-1111-4111-8111-111111111111';
const nextAttemptId = '22222222-2222-4222-8222-222222222222';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function plan(): AcceptancePlan {
  return {
    version: ACCEPTANCE_PLAN_VERSION,
    obligations: [
      { id: 'o-brief', source: 'brief', quote: 'offline list', scenario: 'Independent new page.', expected: 'Add an item.' },
      { id: 'o-acceptance', source: 'acceptance', quote: 'Empty input is rejected.', scenario: 'Independent empty list.', expected: 'No new item.' },
    ],
    groups: [
      { id: 'g-first', checks: [{ id: 'c-first', obligationIds: ['o-brief'], setup: 'New page, valid input.', exercise: 'Click add.', assertions: 'Assert exact item.', stepBudget: 3 }] },
      { id: 'g-second', checks: [{ id: 'c-second', obligationIds: ['o-acceptance'], setup: 'New page, empty input.', exercise: 'Click add.', assertions: 'Assert count and prompt.', stepBudget: 3 }] },
    ],
  };
}
function check(id: string, steps = 3): AcceptanceCheck {
  return { name: `Check ${id}`, steps: Array.from({ length: steps }, (_, index): AcceptanceCheck['steps'][number] => index === 0
    ? { action: 'fill', selector: '#input', value: `Item ${id} " \\ \n` }
    : index === 1 ? { action: 'assertTextExact', selector: '#output', text: `Exact ${id}` } : { action: 'click', selector: '#button' }) };
}
function groups(value = plan(), round = attemptId): AcceptanceGroup[] {
  const planHash = acceptancePlanHash(value);
  return value.groups.map(group => ({ version: ACCEPTANCE_GROUP_VERSION, planHash, groupId: group.id, attemptId: round, checks: group.checks.map(slot => ({ checkId: slot.id, check: check(slot.id, slot.stepBudget) })) }));
}
function rejected(operation: () => unknown, code?: string): AcceptancePlanError {
  let observed: unknown;
  try { operation(); } catch (error) { observed = error; }
  assert.ok(observed instanceof AcceptancePlanError, 'Runtime helper refuses with fixed error, not arbitrary Zod/V8 input text');
  if (code) assert.equal(observed.code, code);
  assert.equal(observed.message, `Acceptance construction rejected: ${observed.code}`);
  assert.equal(observed.name, 'AcceptancePlanError'); assert.equal(Object.hasOwn(observed, 'cause'), false);
  return observed;
}

test('versioned plan is strict, exact-source-bound and independently copied without normalization or key sorting', () => {
  assert.equal(ACCEPTANCE_PLAN_VERSION, 'production-acceptance-plan-v1');
  assert.equal(ACCEPTANCE_GROUP_VERSION, 'production-acceptance-group-v1');
  assert.equal(ACCEPTANCE_CONSTRUCTION_VERSION, 'production-acceptance-construction-v1');
  const original = plan();
  const reordered = { groups: original.groups, obligations: original.obligations, version: original.version };
  reordered.groups[0].checks[0].setup = '  Preserve whitespace, "quotes" and \\ exactly.  ';
  const before = JSON.stringify(reordered); const parsed = parseAcceptancePlan(reordered, source);
  assert.equal(JSON.stringify(parsed), before); assert.equal(JSON.stringify(reordered), before);
  assert.equal(acceptancePlanHash(parsed), sha(before)); assert.equal(acceptancePlanHash(reordered), sha(before));
  parsed.groups[0].checks[0].setup = 'copy only'; assert.equal(JSON.stringify(reordered), before);
  assert.notEqual(acceptancePlanHash(parsed), sha(before));
  assert.equal(Object.isFrozen(ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS), true);
});

test('plan strictness and all field limits reject unsupported versions, extra keys, unsafe IDs and coercion', () => {
  const invalid: unknown[] = [null, [], {}, { ...plan(), version: 'production-acceptance-plan-v0' }, { ...plan(), extra: 'private' }];
  for (const id of ['', 'x'.repeat(41), 'two words', 'é', 'a/b', 'a.b', 'a\n', 'a"', 'a\\']) { const value = plan(); value.obligations[0].id = id; invalid.push(value); }
  for (const target of ['obligation', 'group', 'slot'] as const) { const value = plan(); if (target === 'obligation') Object.assign(value.obligations[0], { extra: 'private' }); else if (target === 'group') Object.assign(value.groups[0], { extra: 'private' }); else Object.assign(value.groups[0].checks[0], { extra: 'private' }); invalid.push(value); }
  for (const field of ['quote', 'scenario', 'expected'] as const) for (const text of ['', 'x'.repeat(241)]) { const value = plan(); value.obligations[0][field] = text; invalid.push(value); }
  for (const field of ['setup', 'exercise', 'assertions'] as const) for (const text of ['', 'x'.repeat(241)]) { const value = plan(); value.groups[0].checks[0][field] = text; invalid.push(value); }
  for (const budget of [0, 21, 1.5, '3', NaN, Infinity]) { const value = plan(); (value.groups[0].checks[0] as unknown as { stepBudget: unknown }).stepBudget = budget; invalid.push(value); }
  for (const value of invalid) rejected(() => parseAcceptancePlan(value, source));
  const atLimits = plan(); atLimits.obligations[0].id = 'a'.repeat(40); atLimits.groups[0].checks[0].obligationIds = ['a'.repeat(40)]; atLimits.obligations[0].quote = 'q'.repeat(240); atLimits.obligations[0].scenario = 's'.repeat(240); atLimits.obligations[0].expected = 'e'.repeat(240); atLimits.groups[0].checks[0].stepBudget = 20;
  assert.deepEqual(parseAcceptancePlan(atLimits, { ...source, brief: 'q'.repeat(240) }), atLimits);
});

test('all IDs are unique in their own namespaces; unknown, duplicate and unreferenced obligations fail closed', () => {
  const duplicateObligation = plan(); duplicateObligation.obligations[1].id = duplicateObligation.obligations[0].id;
  const duplicateGroup = plan(); duplicateGroup.groups[1].id = duplicateGroup.groups[0].id;
  const duplicateCheck = plan(); duplicateCheck.groups[1].checks[0].id = duplicateCheck.groups[0].checks[0].id;
  const duplicateReference = plan(); duplicateReference.groups[0].checks[0].obligationIds.push('o-brief');
  const unknownReference = plan(); unknownReference.groups[0].checks[0].obligationIds.push('o-unknown');
  const unused = plan(); unused.obligations.push({ ...unused.obligations[0], id: 'o-unused' });
  for (const value of [duplicateObligation, duplicateGroup, duplicateCheck, duplicateReference, unknownReference, unused]) rejected(() => parseAcceptancePlan(value, source), 'plan-structure');
  const separateNamespaces = plan(); separateNamespaces.groups[0].id = 'o-brief'; separateNamespaces.groups[0].checks[0].id = 'o-brief';
  assert.deepEqual(parseAcceptancePlan(separateNamespaces, source), separateNamespaces);
  const sharedReference = plan(); sharedReference.groups[1].checks[0].obligationIds.push('o-brief'); assert.deepEqual(parseAcceptancePlan(sharedReference, source), sharedReference);
});

test('quotes must be exact substrings of their designated original source, not normalized or copied from another source', () => {
  for (const quote of ['OFFLINE LIST', 'offline  list', 'offline list.', 'Empty input is rejected.']) { const value = plan(); value.obligations[0].quote = quote; rejected(() => parseAcceptancePlan(value, source), 'plan-source-quote'); }
  const onlyBrief = plan(); onlyBrief.obligations[1].source = 'brief'; rejected(() => parseAcceptancePlan(onlyBrief, source), 'plan-structure');
  const onlyAcceptance = plan(); onlyAcceptance.obligations[0].source = 'acceptance'; rejected(() => parseAcceptancePlan(onlyAcceptance, source), 'plan-structure');
  const unicode = plan(); unicode.obligations[0].quote = 'e\u0301'; rejected(() => parseAcceptancePlan(unicode, { ...source, brief: 'é' }), 'plan-source-quote');
  const atHostBriefLimit = { ...source, brief: 'offline list' + '.'.repeat(5988) }; assert.equal(atHostBriefLimit.brief.length, 6000); assert.ok(parseAcceptancePlan(plan(), atHostBriefLimit));
  rejected(() => parseAcceptancePlan(plan(), { brief: undefined, acceptance: source.acceptance } as never), 'non-json-input');
});

test('obligation, group and slot count limits enforce two through twelve aggregate checks without clipping', () => {
  const emptyObligations = plan(); emptyObligations.obligations = [];
  const emptyGroups = plan(); emptyGroups.groups = [];
  const emptySlots = plan(); emptySlots.groups[0].checks = [];
  const oneSlot = plan(); oneSlot.groups = [oneSlot.groups[0]]; oneSlot.groups[0].checks[0].obligationIds = ['o-brief', 'o-acceptance'];
  const fourthGroup = plan(); fourthGroup.groups.push({ ...structuredClone(fourthGroup.groups[0]), id: 'g-third', checks: [{ ...structuredClone(fourthGroup.groups[0].checks[0]), id: 'c-third' }] }, { ...structuredClone(fourthGroup.groups[0]), id: 'g-fourth', checks: [{ ...structuredClone(fourthGroup.groups[0].checks[0]), id: 'c-fourth' }] });
  const fifthSlot = plan(); fifthSlot.groups[0].checks = Array.from({ length: 5 }, (_, index) => ({ ...structuredClone(fifthSlot.groups[0].checks[0]), id: `c-${index}` }));
  const tooManyObligations = plan(); tooManyObligations.obligations = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(tooManyObligations.obligations[index % 2]), id: `o-${index}` })); tooManyObligations.groups[0].checks[0].obligationIds = tooManyObligations.obligations.map(item => item.id);
  for (const value of [emptyObligations, emptyGroups, emptySlots, oneSlot, fourthGroup, fifthSlot, tooManyObligations]) rejected(() => parseAcceptancePlan(value, source), 'plan-structure');
  const max = plan(); max.obligations = Array.from({ length: 24 }, (_, index) => ({ ...structuredClone(max.obligations[index % 2]), id: `o-${index}` }));
  const slot = max.groups[0].checks[0]; max.groups = Array.from({ length: 3 }, (_, group) => ({ id: `g-${group}`, checks: Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(slot), id: `c-${group}-${index}`, obligationIds: max.obligations.map(item => item.id), stepBudget: 20 })) }));
  assert.equal(parseAcceptancePlan(max, source).groups.flatMap(group => group.checks).length, 12);
  assert.equal(composeAcceptanceGroups(max, acceptancePlanHash(max), groups(max), attemptId).length, 12);
});

test('source quotes and setup declarations are not semantic coverage, cross-group state or Gate certification', () => {
  const value = plan(); value.obligations[1].quote = 'New items';
  value.obligations[1].scenario = 'This declaration omits the empty-input requirement.';
  value.groups[1].checks[0].setup = 'Reuse state from the earlier check (unverified declaration).';
  const parsed = parseAcceptancePlan(value, source); assert.ok(parsed);
  const aggregate = composeAcceptanceGroups(parsed, acceptancePlanHash(parsed), groups(parsed), attemptId);
  assert.equal(aggregate.length, 2); assert.deepEqual(Object.keys(aggregate[0]).sort(), ['name', 'steps']);
  assert.equal(Object.hasOwn(parsed, 'coveragePassed'), false); assert.equal(Object.hasOwn(aggregate, 'gatePassed'), false);
  // The pure helper validates shape/binding, deliberately not this semantic
  // flaw. Independent complete-candidate review and actual Gate remain required.
});

test('dynamic output schema freezes UUID, hash, group and each ordered slot ID with its own budget', () => {
  const value = plan(); value.groups[0].checks.push({ ...structuredClone(value.groups[0].checks[0]), id: 'c-another', stepBudget: 2 });
  const hash = acceptancePlanHash(value); const schema = acceptanceGroupSchema(value, hash, value.groups[0].id, attemptId);
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'throw' });
  type SlotJson = { properties: { checkId: { const: string }; check: { additionalProperties: boolean; properties: { steps: { maxItems: number } } } }; additionalProperties: boolean };
  const properties = json.properties as { planHash: { const: string }; groupId: { const: string }; attemptId: { const: string }; checks: { prefixItems: SlotJson[] } };
  assert.equal(json.additionalProperties, false); assert.equal(properties.planHash.const, hash); assert.equal(properties.groupId.const, 'g-first'); assert.equal(properties.attemptId.const, attemptId);
  const slots = properties.checks.prefixItems;
  assert.equal(slots.length, 2); assert.deepEqual(slots.map(slot => slot.properties.checkId.const), ['c-first', 'c-another']); assert.deepEqual(slots.map(slot => slot.properties.check.properties.steps.maxItems), [3, 2]);
  assert.ok(slots.every(slot => slot.additionalProperties === false && slot.properties.check.additionalProperties === false));
  assert.deepEqual(parseAcceptanceGroup(groups(value)[0], value, hash, 'g-first', attemptId), groups(value)[0]);
});

test('group and composition binding reject another plan/hash/group/round rather than reusing old raw groups', () => {
  const value = plan(); const hash = acceptancePlanHash(value); const originals = groups(value);
  for (const changed of [
    { ...originals[0], version: 'production-acceptance-group-v0' }, { ...originals[0], planHash: '0'.repeat(64) },
    { ...originals[0], groupId: 'g-second' }, { ...originals[0], attemptId: nextAttemptId }, { ...originals[0], attemptId: 'not-a-uuid' },
    { ...originals[0], extra: 'private' },
  ]) rejected(() => parseAcceptanceGroup(changed, value, hash, 'g-first', attemptId), 'group-structure');
  for (const badHash of ['', 'A'.repeat(64), 'a'.repeat(63), '0'.repeat(64)]) rejected(() => acceptanceGroupSchema(value, badHash, 'g-first', attemptId), 'plan-binding');
  rejected(() => acceptanceGroupSchema(value, hash, 'missing-group', attemptId), 'plan-binding');
  rejected(() => acceptanceGroupSchema(value, hash, 'g-first', 'not-a-uuid'), 'plan-binding');
  const changedPlan = plan(); changedPlan.groups[0].checks[0].assertions += ' Changed declaration.';
  rejected(() => composeAcceptanceGroups(changedPlan, hash, originals, attemptId), 'plan-binding');
  rejected(() => composeAcceptanceGroups(value, hash, originals, nextAttemptId), 'group-structure');
  assert.ok(composeAcceptanceGroups(value, hash, groups(value, nextAttemptId), nextAttemptId));
});

test('slot quantities, order and IDs are exact; composition rejects missing, repeated and reversed groups', () => {
  const value = plan(); value.groups[0].checks.push({ ...structuredClone(value.groups[0].checks[0]), id: 'c-other' });
  const hash = acceptancePlanHash(value); const originals = groups(value);
  const invalid = [
    { ...originals[0], checks: originals[0].checks.slice(0, 1) },
    { ...originals[0], checks: [...originals[0].checks, originals[0].checks[0]] },
    { ...originals[0], checks: originals[0].checks.slice().reverse() },
    { ...originals[0], checks: originals[0].checks.map(item => ({ ...item, checkId: 'c-first' })) },
    { ...originals[0], checks: originals[0].checks.map(item => ({ ...item, checkId: 'unknown' })) },
    { ...originals[0], checks: [{ ...originals[0].checks[0], extra: 'private' }, originals[0].checks[1]] },
  ];
  for (const group of invalid) rejected(() => parseAcceptanceGroup(group, value, hash, 'g-first', attemptId), 'group-structure');
  for (const candidate of [[], originals.slice(0, 1), [...originals, originals[0]], originals.slice().reverse(), [originals[0], originals[0]], { groups: originals }]) rejected(() => composeAcceptanceGroups(value, hash, candidate, attemptId));
});

test('own step budgets and original Gate step/name/action limits remain inclusive and strict', () => {
  const value = plan(); const hash = acceptancePlanHash(value); const valid = groups(value)[0];
  assert.equal(acceptanceCheckSchema.safeParse(valid.checks[0].check).success, true);
  const overBudget = structuredClone(valid); overBudget.checks[0].check.steps.push({ action: 'click', selector: '#extra' });
  assert.equal(acceptanceCheckSchema.safeParse(overBudget.checks[0].check).success, true, 'Gate twenty-step cap does not replace the tighter planned three-step budget');
  rejected(() => parseAcceptanceGroup(overBudget, value, hash, 'g-first', attemptId), 'group-structure');
  const emptySteps = structuredClone(valid); emptySteps.checks[0].check.steps = [];
  const longName = structuredClone(valid); longName.checks[0].check.name = 'n'.repeat(121);
  const extraCheck = structuredClone(valid); Object.assign(extraCheck.checks[0].check, { passed: true });
  const extraStep = structuredClone(valid); Object.assign(extraStep.checks[0].check.steps[0], { executed: true });
  const unknownAction = structuredClone(valid); Object.assign(unknownAction.checks[0].check.steps[0], { action: 'runShell' });
  for (const group of [emptySteps, longName, extraCheck, extraStep, unknownAction]) rejected(() => parseAcceptanceGroup(group, value, hash, 'g-first', attemptId), 'group-structure');
  const max = plan(); max.groups[0].checks[0].stepBudget = 20; const atMax = groups(max)[0]; assert.ok(parseAcceptanceGroup(atMax, max, acceptancePlanHash(max), 'g-first', attemptId));
  atMax.checks[0].check.steps.push({ action: 'click', selector: '#extra' }); rejected(() => parseAcceptanceGroup(atMax, max, acceptancePlanHash(max), 'g-first', attemptId), 'group-structure');
  const min = plan(); min.groups[0].checks[0].stepBudget = 1; assert.ok(parseAcceptanceGroup(groups(min)[0], min, acceptancePlanHash(min), 'g-first', attemptId));
});

test('Gate normalization is refused instead of silently trimming names, selectors or nested interactions', () => {
  const value = plan(); const hash = acceptancePlanHash(value);
  for (const kind of ['name', 'selector', 'after'] as const) {
    const candidate = groups(value)[0];
    if (kind === 'name') candidate.checks[0].check.name = ' leading/trailing ';
    else if (kind === 'selector') candidate.checks[0].check.steps[0].selector = ' #input ';
    else candidate.checks[0].check.steps[1] = { action: 'assertChanged', selector: '#output', after: { action: 'click', selector: ' #button ' } };
    const before = JSON.stringify(candidate); assert.equal(acceptanceCheckSchema.safeParse(candidate.checks[0].check).success, true);
    rejected(() => parseAcceptanceGroup(candidate, value, hash, 'g-first', attemptId), 'group-structure'); assert.equal(JSON.stringify(candidate), before);
  }
});

test('composition strips only wrappers and preserves original values, key order, slot order and input bytes', () => {
  const value = plan(); const hash = acceptancePlanHash(value); const raw = groups(value);
  raw[0].checks[0].check = { steps: raw[0].checks[0].check.steps, name: raw[0].checks[0].check.name };
  const before = JSON.stringify({ value, raw }); const expected = raw.flatMap(group => group.checks.map(item => item.check));
  const composed = composeAcceptanceGroups(value, hash, raw, attemptId);
  assert.equal(JSON.stringify(composed), JSON.stringify(expected)); assert.deepEqual(composed, expected);
  assert.equal(JSON.stringify({ value, raw }), before); assert.equal(acceptanceSchema.safeParse(composed).success, true, 'Only schema legality, not a Gate execution');
  composed[0].steps[0].selector = '#copy-only'; composed[1].name = 'copy-only'; assert.equal(JSON.stringify({ value, raw }), before);
  assert.equal(acceptancePlanHash(value), hash);
});

test('unsafe object inputs and arbitrary field names fail with fixed diagnostics without getter/Proxy execution or source leakage', () => {
  let touched = 0;
  const accessor = Object.defineProperty({}, 'version', { enumerable: true, get() { touched++; throw new Error('private-accessor-text'); } });
  const proxy = new Proxy({}, { get() { touched++; throw new Error('private-proxy-text'); }, ownKeys() { touched++; throw new Error('private-ownKeys-text'); } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = Array(2); sparse[1] = groups()[1];
  for (const candidate of [accessor, proxy, cycle, new String('private-string'), { ...plan(), missing: undefined }, { ...plan(), number: Infinity }]) {
    const error = rejected(() => parseAcceptancePlan(candidate, source), 'non-json-input'); assert.equal(JSON.stringify(error).includes('private'), false);
  }
  for (const candidate of [accessor, proxy, cycle, sparse]) rejected(() => composeAcceptanceGroups(plan(), acceptancePlanHash(plan()), candidate, attemptId), 'non-json-input');
  assert.equal(touched, 0);
  const malicious = JSON.parse(JSON.stringify(plan()).slice(0, -1) + ',"__proto__":{"polluted":"private-unknown-key"}}');
  const error = rejected(() => parseAcceptancePlan(malicious, source), 'plan-structure'); assert.equal(error.message.includes('private'), false); assert.equal(error.message.includes('__proto__'), false); assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  let deep: unknown = null; for (let index = 0; index < 20; index++) deep = [deep]; rejected(() => parseAcceptancePlan(deep, source), 'non-json-input');
  rejected(() => parseAcceptancePlan({ ...plan(), extra: 'x'.repeat(6001) }, source), 'non-json-input');
});
