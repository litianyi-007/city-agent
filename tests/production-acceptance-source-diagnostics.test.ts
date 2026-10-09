import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { acceptancePlanSchema, ACCEPTANCE_PLAN_VERSION, parseAcceptancePlan } from '../server/production/acceptance-plan.js';
import { ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, ACCEPTANCE_SOURCE_DIAGNOSTIC_LITERALS,
  ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS, diagnoseAcceptanceSource } from '../server/production/acceptance-source-diagnostics.js';

// Pure, free diagnostics over synthetic JSON. No provider, private settings,
// browser, API, model retry, quote repair or real-delivery result is produced.
const source = { brief: 'Build an offline expense page.', acceptance: 'Reject invalid amounts. Preserve existing records.' };
const binding = { callId: '00000000-0000-4000-8000-000000000001', candidateId: '00000000-0000-4000-8000-000000000002', outputContractHash: 'a'.repeat(64) };
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
type Obligation = { id: string; source: 'brief' | 'acceptance'; quote: string; scenario: string; expected: string };
function plan(obligations: Obligation[] = [
  { id: 'brief', source: 'brief', quote: source.brief, scenario: 'Open a fresh page.', expected: 'A working offline page.' },
  { id: 'acceptance', source: 'acceptance', quote: 'Reject invalid amounts!', scenario: 'Enter an invalid amount.', expected: 'A visible refusal.' },
]) {
  return { version: ACCEPTANCE_PLAN_VERSION, obligations, groups: [{ id: 'g1', checks: ['c1', 'c2'].map(id => ({
    id, obligationIds: obligations.map(item => item.id), setup: 'Independent fresh page.', exercise: 'Perform an actual operation.',
    assertions: 'Verify actual business output.', stepBudget: 20,
  })) }] };
}
const raw = () => JSON.stringify(plan());

test('only a structurally valid plan with a strict source mismatch gets bound positions and hashes', () => {
  const text = raw(); const before = JSON.stringify({ source, binding, plan: JSON.parse(text) });
  assert.equal(acceptancePlanSchema.safeParse(JSON.parse(text)).success, true);
  assert.throws(() => parseAcceptancePlan(JSON.parse(text), source), /plan-source-quote/);
  assert.deepEqual(diagnoseAcceptanceSource(text, source, binding), {
    version: ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, phase: 'acceptance-plan', kind: 'source-quote-mismatch', ...binding,
    sourceSha256: hash(text), materials: { briefSha256: hash(source.brief), acceptanceSha256: hash(source.acceptance) },
    mismatchCount: 1, mismatches: [{ obligationIndex: 1, source: 'acceptance' }],
  });
  assert.equal(JSON.stringify({ source, binding, plan: JSON.parse(text) }), before);
  assert.throws(() => parseAcceptancePlan(JSON.parse(text), source), /plan-source-quote/, 'Diagnosis never repairs the rejected quote');
});

test('an exactly source-bound plan returns undefined, not a diagnostic or a coverage certificate', () => {
  const value = plan(); value.obligations[1]!.quote = 'Reject invalid amounts.';
  assert.doesNotThrow(() => parseAcceptancePlan(value, source));
  assert.equal(diagnoseAcceptanceSource(JSON.stringify(value), source, binding), undefined);
  // Quotes can be exact substrings yet omit other business requirements.
  value.obligations[1]!.quote = 'amounts';
  assert.doesNotThrow(() => parseAcceptancePlan(value, source));
  assert.equal(diagnoseAcceptanceSource(JSON.stringify(value), source, binding), undefined);
});

test('both source fields and every zero-based obligation index are checked, without returning quote or id', () => {
  const value = plan();
  value.obligations.unshift({ id: 'extra-private-id', source: 'brief', quote: 'synthetic-private-quote', scenario: 'Synthetic setup.', expected: 'Synthetic expectation.' });
  for (const check of value.groups[0]!.checks) check.obligationIds = value.obligations.map(item => item.id);
  const text = JSON.stringify(value); const result = diagnoseAcceptanceSource(text, source, binding)!;
  assert.deepEqual(result.mismatches, [{ obligationIndex: 0, source: 'brief' }, { obligationIndex: 2, source: 'acceptance' }]);
  assert.equal(result.mismatchCount, 2);
  const serialized = JSON.stringify(result);
  for (const secret of ['extra-private-id', 'synthetic-private-quote', source.brief, source.acceptance, 'scenario', 'expected', 'quote', 'obligationId', 'excerpt']) {
    // The fixed kind contains "quote"; arbitrary source text and field names do not.
    if (secret === 'quote') continue;
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(result).sort(), ['callId', 'candidateId', 'kind', 'materials', 'mismatchCount', 'mismatches', 'outputContractHash', 'phase', 'sourceSha256', 'version']);
  assert.deepEqual(Object.keys(result.mismatches[0]!).sort(), ['obligationIndex', 'source']);
});

test('all twenty-four legal mismatches remain bounded and are not clipped into acceptance', () => {
  const obligations = Array.from({ length: 24 }, (_, index): Obligation => ({ id: `o${index}`, source: index % 2 ? 'acceptance' : 'brief',
    quote: `Missing source quotation ${index}`, scenario: 'Synthetic scenario.', expected: 'Synthetic expectation.' }));
  const value = plan(obligations); const text = JSON.stringify(value); const result = diagnoseAcceptanceSource(text, source, binding)!;
  assert.equal(result.mismatchCount, 24); assert.equal(result.mismatches.length, 24);
  assert.deepEqual(result.mismatches.map(item => item.obligationIndex), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(result.sourceSha256, hash(text));
  value.obligations.push({ ...obligations[0]!, id: 'o24' });
  assert.equal(diagnoseAcceptanceSource(JSON.stringify(value), source, binding), undefined, 'Invalid schema is not relabelled as only a source mismatch');
});

test('the full raw answer and both exact original materials are hashed, including whitespace and complete fences', () => {
  for (const text of [raw(), ` \r\n${raw()}\t `, ` \n\x60\x60\x60json\n${raw()}\n\x60\x60\x60\n `]) {
    const before = text; const result = diagnoseAcceptanceSource(text, source, binding)!;
    assert.equal(result.sourceSha256, hash(text)); assert.equal(text, before);
    assert.deepEqual(result.materials, { briefSha256: hash(source.brief), acceptanceSha256: hash(source.acceptance) });
  }
});

for (const [name, brief, quote] of [
  ['punctuation', 'Build a page.', 'Build a page!'], ['case', 'Build a page.', 'build a page.'],
  ['whitespace', 'Build  a page.', 'Build a page.'], ['unicode', 'Caf\u00e9', 'Cafe\u0301'],
  ['newlines', 'Build\na page.', 'Build a page.'],
] as const) {
  test(`strict source binding never normalizes ${name}`, () => {
    const value = plan(); value.obligations[0]!.quote = quote; value.obligations[1]!.quote = 'Reject invalid amounts.';
    const materials = { ...source, brief }; const text = JSON.stringify(value);
    assert.deepEqual(diagnoseAcceptanceSource(text, materials, binding)!.mismatches, [{ obligationIndex: 0, source: 'brief' }]);
    assert.throws(() => parseAcceptancePlan(JSON.parse(text), materials), /plan-source-quote/);
  });
}

test('a quote in the other source is still rejected rather than rebound to it', () => {
  const value = plan(); value.obligations[1]!.quote = source.brief;
  const result = diagnoseAcceptanceSource(JSON.stringify(value), source, binding)!;
  assert.deepEqual(result.mismatches, [{ obligationIndex: 1, source: 'acceptance' }]);
});

test('syntax and schema failures do not become source-only feedback or leak arbitrary error details', () => {
  for (const text of ['', '{"obligations":[', 'before ' + raw(), raw() + ' trailing', '```javascript\n' + raw() + '\n```', '```json\n' + raw(), 'null', '[]', '{}']) {
    assert.equal(diagnoseAcceptanceSource(text, source, binding), undefined);
  }
  const value = plan();
  const cases = [
    { ...value, syntheticPrivateKey: 'not feedback' }, { ...value, version: 'private-invalid-version' },
    { ...value, obligations: [{ ...value.obligations[0], source: 'private-source' }, value.obligations[1]] },
    { ...value, obligations: [{ ...value.obligations[0], quote: '' }, value.obligations[1]] },
    { ...value, obligations: [{ ...value.obligations[0], quote: 'x'.repeat(241) }, value.obligations[1]] },
    { ...value, groups: [] }, { ...value, obligations: [value.obligations[0], { ...value.obligations[1], id: 'brief' }] },
    { ...value, groups: [{ ...value.groups[0], checks: value.groups[0]!.checks.slice(0, 1) }] },
  ];
  for (const invalid of cases) assert.equal(diagnoseAcceptanceSource(JSON.stringify(invalid), source, binding), undefined);
  const deep = '{"obligations":' + '['.repeat(20000) + '0' + ']'.repeat(20000) + '}';
  assert.doesNotThrow(() => diagnoseAcceptanceSource(deep, source, binding));
  assert.equal(diagnoseAcceptanceSource(deep, source, binding), undefined);
});

test('raw UTF-8 bounds are exact, inclusive and independent of UTF-16 length', () => {
  const limit = ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.rawBytes; const text = raw();
  const padded = ' '.repeat(limit - Buffer.byteLength(text)) + text;
  assert.equal(Buffer.byteLength(padded), limit); assert.ok(diagnoseAcceptanceSource(padded, source, binding));
  assert.equal(diagnoseAcceptanceSource(' ' + padded, source, binding), undefined);
  const spaces = Math.floor((limit - Buffer.byteLength(text)) / 3);
  const unicode = '\u3000'.repeat(spaces) + ' '.repeat(limit - Buffer.byteLength(text) - spaces * 3) + text;
  assert.ok(unicode.length < limit); assert.equal(Buffer.byteLength(unicode), limit);
  assert.ok(diagnoseAcceptanceSource(unicode, source, binding));
  assert.equal(diagnoseAcceptanceSource('\u3000' + unicode, source, binding), undefined);
});

test('source material bounds fail closed, and all supplied bytes still determine the hashes at the ceiling', () => {
  const limits = ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS;
  const materials = { brief: '界'.repeat(limits.briefCharacters), acceptance: '界'.repeat(limits.acceptanceCharacters) };
  const result = diagnoseAcceptanceSource(raw(), materials, binding)!;
  assert.equal(result.materials.briefSha256, hash(materials.brief));
  assert.equal(result.materials.acceptanceSha256, hash(materials.acceptance));
  for (const key of ['brief', 'acceptance'] as const) assert.equal(diagnoseAcceptanceSource(raw(), { ...materials, [key]: materials[key] + '界' }, binding), undefined);
});

test('binding identities are strict primitive UUID/hash values and cannot leak arbitrary metadata', () => {
  for (const invalid of [
    { ...binding, callId: 'private-call' }, { ...binding, callId: binding.callId + '\n' },
    { ...binding, candidateId: 'private-candidate' }, { ...binding, candidateId: 1 },
    { ...binding, outputContractHash: 'A'.repeat(64) }, { ...binding, outputContractHash: 'a'.repeat(63) },
    { ...binding, outputContractHash: binding.outputContractHash + '\n' }, { ...binding, privateKey: 'not feedback' },
    Object.assign(Object.create({ callId: binding.callId }), { candidateId: binding.candidateId, outputContractHash: binding.outputContractHash }),
    [], null, undefined, new String('private-binding'),
  ]) assert.equal(diagnoseAcceptanceSource(raw(), source, invalid as typeof binding), undefined);
  const plainNull = Object.assign(Object.create(null), binding);
  assert.deepEqual(diagnoseAcceptanceSource(raw(), Object.assign(Object.create(null), source), plainNull), diagnoseAcceptanceSource(raw(), source, binding));
});

test('input getters, Proxy traps, inherited accessors and coercions never execute, even for revoked proxies', () => {
  let touched = 0;
  const hostile = () => { touched++; throw new Error('synthetic-private-accessor'); };
  const accessorSource = Object.defineProperty({ acceptance: source.acceptance }, 'brief', { enumerable: true, get: hostile });
  const accessorBinding = Object.defineProperty({ ...binding }, 'callId', { enumerable: true, get: hostile });
  const proxy = new Proxy({}, { get: hostile, ownKeys: hostile, getOwnPropertyDescriptor: hostile, getPrototypeOf: hostile });
  const inherited = Object.assign(Object.create(Object.defineProperty({}, 'brief', { get: hostile })), { acceptance: source.acceptance });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const fakeString = Object.defineProperty({}, 'toString', { get: hostile });
  for (const bad of [accessorSource, proxy, revoked.proxy, inherited, fakeString, null, undefined, [], new Date()]) {
    assert.equal(diagnoseAcceptanceSource(raw(), bad as typeof source, binding), undefined);
    assert.equal(diagnoseAcceptanceSource(raw(), source, bad as typeof binding), undefined);
  }
  assert.equal(diagnoseAcceptanceSource(raw(), source, accessorBinding as typeof binding), undefined);
  for (const bad of [proxy, revoked.proxy, fakeString, new String(raw()), null, undefined, 42]) {
    assert.equal(diagnoseAcceptanceSource(bad as string, source, binding), undefined);
  }
  const symbolic = { ...source, [Symbol('private-key')]: 'private-value' };
  assert.equal(diagnoseAcceptanceSource(raw(), symbolic, binding), undefined);
  const hidden = Object.defineProperty({ ...binding }, 'callId', { value: binding.callId, enumerable: false });
  assert.equal(diagnoseAcceptanceSource(raw(), source, hidden), undefined);
  const proxyPrototype = Object.create(proxy, { brief: { value: source.brief, enumerable: true }, acceptance: { value: source.acceptance, enumerable: true } });
  assert.equal(diagnoseAcceptanceSource(raw(), proxyPrototype, binding), undefined);
  assert.equal(touched, 0);
});

test('diagnostics are deeply immutable, deterministic and do not share mutable mismatch state', () => {
  const first = diagnoseAcceptanceSource(raw(), source, binding)!; const second = diagnoseAcceptanceSource(raw(), source, binding)!;
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.notEqual(first.mismatches, second.mismatches);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.materials), true);
  assert.equal(Object.isFrozen(first.mismatches), true); assert.equal(Object.isFrozen(first.mismatches[0]), true);
  assert.equal(Reflect.set(first.mismatches[0]!, 'obligationIndex', 99), false);
  assert.throws(() => { (first.mismatches as unknown[]).push({}); });
  assert.deepEqual(diagnoseAcceptanceSource(raw(), source, binding), second);
  assert.equal(Object.isFrozen(ACCEPTANCE_SOURCE_DIAGNOSTIC_LITERALS), true);
  assert.deepEqual(ACCEPTANCE_SOURCE_DIAGNOSTIC_LITERALS, [ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, 'acceptance-plan', 'source-quote-mismatch', 'brief', 'acceptance']);
  for (const key of ['passed', 'covered', 'accepted', 'authenticated', 'executed', 'repaired', 'quote', 'obligationId']) assert.equal(Object.hasOwn(first, key), false);
});

test('all three immutable real HTML09 plans diagnose only obligation six while remaining rejected', () => {
  const file = new URL('../docs/production/experiments/HTML-09/run.json', import.meta.url);
  const bytes = readFileSync(file); const run = JSON.parse(bytes.toString('utf8')); const before = JSON.stringify(run);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '1d4ecaea9d474679ac14c92aa00f668677cfa1901c9f23e9d6a0c1b30742853f');
  const calls = run.calls.filter((call: { phase: string }) => call.phase === 'acceptance-plan');
  const pins = [
    { rawSha256: '7479fa61304f249334bcf1a046a2a1628f95373785f2f53308f8349c6fd69c5b', obligations: 19 },
    { rawSha256: 'c6ba526401443343c56cd3498ca90eb6aebaae59f17678bb3e99a4408dcabd71', obligations: 18 },
    { rawSha256: '61f60ef36d5a04ff03a6fb73533ded85445817b77b6a3e8263314320c458527e', obligations: 17 },
  ];
  const materials = { brief: run.input.brief, acceptance: run.input.requirement.acceptance };
  assert.equal(calls.length, 3);
  for (const [index, call] of calls.entries()) {
    const pin = pins[index]!; const value = JSON.parse(call.rawOutput);
    const outputContractHash = hash(JSON.stringify(JSON.parse(call.userPrompt).outputContract));
    assert.equal(outputContractHash, '383c43fc99a2d3c63772578fa1f7e7185c06d94c80c37a5a5681128453e8bd35');
    assert.equal(hash(call.rawOutput), pin.rawSha256);
    assert.equal(acceptancePlanSchema.safeParse(value).success, true); assert.equal(value.obligations.length, pin.obligations);
    assert.throws(() => parseAcceptancePlan(value, materials), /plan-source-quote/);
    const result = diagnoseAcceptanceSource(call.rawOutput, materials, { callId: call.id, candidateId: call.candidateId, outputContractHash })!;
    assert.deepEqual(result, { version: ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, phase: 'acceptance-plan', kind: 'source-quote-mismatch',
      callId: call.id, candidateId: call.candidateId, sourceSha256: pin.rawSha256, outputContractHash,
      materials: { briefSha256: hash(materials.brief), acceptanceSha256: hash(materials.acceptance) },
      mismatchCount: 1, mismatches: [{ obligationIndex: 6, source: 'acceptance' }],
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(value.obligations[6].quote), false);
    assert.equal(serialized.includes(materials.brief), false); assert.equal(serialized.includes(materials.acceptance), false);
    assert.notEqual(call.selected, true); assert.match(call.error, /plan-source-quote/);
    assert.throws(() => parseAcceptancePlan(JSON.parse(call.rawOutput), materials), /plan-source-quote/);
  }
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  assert.equal(Object.hasOwn(run, 'frozenContract'), false); assert.deepEqual(run.gateHistory, []);
  assert.equal(JSON.stringify(run), before); assert.ok(readFileSync(file).equals(bytes), 'Original negative evidence is not changed by replay');
});
