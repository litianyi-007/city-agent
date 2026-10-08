import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import { acceptanceSchema } from '../server/gate.js';
import { parseJson, testsSchema } from '../server/production/contracts.js';
import { ACCEPTANCE_DIAGNOSTICS_VERSION, ACCEPTANCE_DIAGNOSTIC_LIMITS, acceptanceCapacityFacts, diagnoseAcceptanceCapacity } from '../server/production/acceptance-diagnostics.js';

// Free static data/schema tests only. No SDK, provider, browser, generated
// product, automatic split/repair, new candidate or Gate execution occurs.
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function check(index = 0, count = 20) {
  return { name: `independent check ${index}`, steps: Array.from({ length: count }, (_, step) => step === 0 ? { action: 'fill', selector: '#input', value: 'input' } : step === 1 ? { action: 'assertTextExact', selector: '#output', text: 'business result' } : { action: 'click', selector: '#button' }) };
}
const source = (checks = 2, steps = 20) => JSON.stringify({ checks: Array.from({ length: checks }, (_, index) => check(index, steps)) });

test('capacity facts are immutable and derived from the exact Gate JSON schema, not a relaxed duplicated limit', () => {
  const facts = acceptanceCapacityFacts(); const schema = z.toJSONSchema(acceptanceSchema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'throw' });
  assert.equal(ACCEPTANCE_DIAGNOSTICS_VERSION, 'production-acceptance-diagnostics-v1');
  assert.deepEqual(facts, { version: ACCEPTANCE_DIAGNOSTICS_VERSION, maxChecks: 12, maxSteps: 20 });
  assert.equal(facts.maxChecks, schema.maxItems);
  assert.equal(facts.maxSteps, (schema.items as { properties: { steps: { maxItems: number } } }).properties.steps.maxItems);
  assert.equal(Object.isFrozen(facts), true); assert.equal(acceptanceCapacityFacts(), facts);
  assert.equal(Reflect.set(facts, 'maxSteps', 100), false); assert.equal(facts.maxSteps, 20);
  assert.equal(acceptanceSchema.safeParse(JSON.parse(source(12, 20)).checks).success, true);
  assert.equal(acceptanceSchema.safeParse(JSON.parse(source(13, 20)).checks).success, false);
  assert.equal(acceptanceSchema.safeParse(JSON.parse(source(12, 21)).checks).success, false);
});

test('zero/minimum, twelve/thirteen-check and twenty/twenty-one-step boundaries never certify acceptance', () => {
  for (const [checks, steps] of [[0, 20], [1, 20], [2, 0], [12, 20]]) assert.equal(diagnoseAcceptanceCapacity(source(checks, steps)), undefined);
  assert.equal(testsSchema.safeParse(JSON.parse(source(0, 20))).success, false, 'No diagnostic is not acceptance');
  const checksOnly = diagnoseAcceptanceCapacity(source(13, 20))!;
  assert.equal(checksOnly.checkCount, 13); assert.equal(checksOnly.checkCountExceedsLimit, true); assert.deepEqual(checksOnly.oversizedStepCheckIndices, []); assert.deepEqual(checksOnly.stepCounts, Array(13).fill(20));
  const stepsOnly = diagnoseAcceptanceCapacity(source(12, 21))!;
  assert.equal(stepsOnly.checkCountExceedsLimit, false); assert.deepEqual(stepsOnly.oversizedStepCheckIndices, Array.from({ length: 12 }, (_, index) => index));
  const both = diagnoseAcceptanceCapacity(source(13, 21))!;
  assert.equal(both.checkCountExceedsLimit, true); assert.equal(both.oversizedStepCheckIndices.length, 13);
  for (const raw of [source(13, 20), source(12, 21), source(13, 21)]) assert.equal(testsSchema.safeParse(parseJson(raw)).success, false, 'Numbers-only feedback never modifies a rejected source');
});

test('all three immutable HTML03 raw Tester failures receive exact bounded counts and SHA while staying rejected', () => {
  const file = new URL('../docs/production/experiments/HTML-03/run.json', import.meta.url); const bytes = readFileSync(file);
  assert.equal(sha(bytes), '6d655a48107a0f0837c4f38809c391f61f8e43c09817d154a0f4b97795f507dc');
  const run = JSON.parse(bytes.toString('utf8')); const before = JSON.stringify(run); const candidates = run.calls.filter((call: { role: string }) => call.role === 'tester');
  const pins = [
    { sha256: 'c4d31c61c23a9fdb234f1a8b7d1679bc1658ec50f582aeefdde8e4ac67a0ba8b', steps: [14, 20, 21, 17, 14, 21, 19, 19, 21], bad: [2, 5, 8] },
    { sha256: 'e0b00b69586a5170978745c8b31297169acef7d38a1e563b19310cba4ab5ac87', steps: [17, 20, 21, 18, 21, 21, 20, 18, 23, 23], bad: [2, 4, 5, 8, 9] },
    { sha256: 'de7f589400cb51518d0dc758c0021edc5116cac2780f13cdc4a03a768b3cad01', steps: [17, 20, 20, 17, 15, 24, 19, 19, 22], bad: [5, 8] },
  ];
  assert.equal(candidates.length, 3);
  for (const [index, call] of candidates.entries()) {
    const pin = pins[index]!; const result = diagnoseAcceptanceCapacity(call.rawOutput);
    assert.deepEqual(result, { version: ACCEPTANCE_DIAGNOSTICS_VERSION, maxChecks: 12, maxSteps: 20, sourceSha256: pin.sha256, checkCount: pin.steps.length, stepCounts: pin.steps, oversizedStepCheckIndices: pin.bad, checkCountExceedsLimit: false });
    assert.equal(sha(call.rawOutput), pin.sha256); assert.equal(testsSchema.safeParse(parseJson(call.rawOutput)).success, false); assert.notEqual(call.selected, true);
    const serialized = JSON.stringify(result); for (const item of JSON.parse(call.rawOutput).checks) assert.equal(serialized.includes(item.name), false);
  }
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(Object.hasOwn(run, 'frozenContract'), false); assert.deepEqual(run.gateHistory, []);
  assert.equal(JSON.stringify(run), before); assert.ok(readFileSync(file).equals(bytes), 'Archived failed evidence is never rewritten');
});

test('strict syntax, types, unsupported fields and non-capacity failures return undefined without raw errors or path leakage', () => {
  const valid = JSON.parse(source(2, 21));
  for (const raw of ['', '{"checks":[', 'before ' + source(2, 21), source(2, 21) + ' trailing', '```javascript\n' + source(2, 21) + '\n```', '```json\n' + source(2, 21), 'null', '[]', '{"checks":null}', '{"checks":"secret-array"}', '{"checks":[null,null]}', '{"checks":[,,]}']) assert.equal(diagnoseAcceptanceCapacity(raw), undefined);
  const cases = [
    { ...valid, secretUnknownKey: 'private-field' },
    { renamedChecks: valid.checks },
    { checks: [{ ...check(0, 21), secretUnknownKey: 'private-field' }, check(1)] },
    { checks: [{ name: 'bad steps type', steps: 'private-selector' }, check(1)] },
    { checks: [{ ...check(0, 21), name: 'x'.repeat(121) }, check(1)] },
    { checks: [{ name: 'bad action', steps: [{ action: 'private-operation', selector: '#x' }] }, check(1, 21)] },
    { checks: [{ name: 'bad field', steps: [{ action: 'click', selector: '#x', secretUnknownKey: 'private-field' }] }, check(1, 21)] },
    { checks: [{ name: 'visible-only', steps: Array.from({ length: 21 }, () => ({ action: 'assertVisible', selector: '#x' })) }, { name: 'visible-only too', steps: [{ action: 'assertVisible', selector: '#x' }] }] },
  ];
  for (const value of cases) { const raw = JSON.stringify(value); assert.equal(diagnoseAcceptanceCapacity(raw), undefined); assert.equal(testsSchema.safeParse(JSON.parse(raw)).success, false); }
});

test('provider names, secret selectors/text and escaped key-like strings cannot appear in serialized diagnostics', () => {
  const secret = 'synthetic-private-provider-token'; const value = { checks: [check(0, 21), check(1, 21)] };
  for (const item of value.checks) {
    item.name = secret;
    item.steps[0] = { action: 'fill', selector: `#${secret}`, value: `quoted \\" ${secret}` };
    item.steps[1] = { action: 'assertTextExact', selector: `#${secret}-result`, text: secret };
  }
  const raw = JSON.stringify(value); const result = diagnoseAcceptanceCapacity(raw)!; const serialized = JSON.stringify(result);
  assert.equal(result.sourceSha256, sha(raw)); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes('selector'), false); assert.equal(serialized.includes('excerpt'), false); assert.equal(serialized.includes('error'), false);
  assert.deepEqual(Object.keys(result).sort(), ['checkCount', 'checkCountExceedsLimit', 'maxChecks', 'maxSteps', 'oversizedStepCheckIndices', 'sourceSha256', 'stepCounts', 'version']);
  assert.equal(diagnoseAcceptanceCapacity(JSON.stringify({ ...value, [secret]: secret })), undefined);
  assert.equal(diagnoseAcceptanceCapacity('{"checks":' + JSON.stringify(value.checks) + ',"__proto__":{"polluted":true}}'), undefined);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('optional Gate capacity facts cannot erase additional production semantic rejection', () => {
  const value = JSON.parse(source(2, 21)); value.checks[0].steps[0].selector = 'xpath=//unsupported';
  const raw = JSON.stringify(value); const before = JSON.stringify(value); const result = diagnoseAcceptanceCapacity(raw)!;
  assert.deepEqual(result.oversizedStepCheckIndices, [0, 1]);
  const production = testsSchema.safeParse(parseJson(raw)); assert.equal(production.success, false);
  if (production.success) throw new Error('Capacity explanation must not certify production acceptance');
  assert.ok(production.error.issues.some(issue => issue.code === 'too_big'));
  assert.ok(production.error.issues.some(issue => issue.code === 'custom'));
  assert.equal(JSON.stringify(value), before); assert.equal(result.sourceSha256, sha(raw));
});

test('exact original whitespace and complete fences are hashed without extraction, normalization or mutation', () => {
  const body = source(2, 21);
  for (const raw of [body, ` \r\n${body}\t `, ` \n\x60\x60\x60json\n${body}\n\x60\x60\x60\n `]) {
    const before = raw; const result = diagnoseAcceptanceCapacity(raw)!;
    assert.equal(result.sourceSha256, sha(raw)); assert.equal(raw, before); assert.deepEqual(result.stepCounts, [21, 21]);
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.stepCounts), true); assert.equal(Object.isFrozen(result.oversizedStepCheckIndices), true);
    assert.throws(() => { (result.stepCounts as number[]).push(0); }); assert.throws(() => { (result.oversizedStepCheckIndices as number[]).push(99); });
    assert.equal(testsSchema.safeParse(parseJson(raw)).success, false);
  }
});

test('diagnostic resource bounds fail closed while the original Gate rejects oversized malicious arrays', () => {
  const limits = ACCEPTANCE_DIAGNOSTIC_LIMITS;
  const atChecks = source(limits.checks, 2); const atSteps = source(2, limits.stepsPerCheck);
  assert.equal(diagnoseAcceptanceCapacity(atChecks)!.checkCount, limits.checks); assert.deepEqual(diagnoseAcceptanceCapacity(atSteps)!.stepCounts, [limits.stepsPerCheck, limits.stepsPerCheck]);
  for (const raw of [source(limits.checks + 1, 2), source(2, limits.stepsPerCheck + 1)]) {
    assert.equal(diagnoseAcceptanceCapacity(raw), undefined); assert.equal(testsSchema.safeParse(JSON.parse(raw)).success, false);
  }
  const body = source(2, 21); const asciiAt = ' '.repeat(limits.rawBytes - Buffer.byteLength(body)) + body;
  assert.equal(Buffer.byteLength(asciiAt), limits.rawBytes); assert.ok(diagnoseAcceptanceCapacity(asciiAt)); assert.equal(diagnoseAcceptanceCapacity(' ' + asciiAt), undefined);
  const unicodeUnits = Math.floor((limits.rawBytes - Buffer.byteLength(body)) / 3);
  const unicodeAt = '\u3000'.repeat(unicodeUnits) + ' '.repeat(limits.rawBytes - Buffer.byteLength(body) - unicodeUnits * 3) + body;
  assert.ok(unicodeAt.length < limits.rawBytes); assert.equal(Buffer.byteLength(unicodeAt), limits.rawBytes); assert.ok(diagnoseAcceptanceCapacity(unicodeAt));
  assert.equal(diagnoseAcceptanceCapacity('\u3000' + unicodeAt), undefined, 'UTF-8 byte ceiling applies even below the UTF-16 unit ceiling');
  assert.equal(acceptanceCapacityFacts().maxChecks, 12); assert.equal(acceptanceCapacityFacts().maxSteps, 20);
});

test('non-string accessors/proxies and deeply malformed but bounded JSON never execute caller properties or expose failure details', () => {
  let touched = 0; const accessor = Object.defineProperty({}, 'toString', { get() { touched++; throw new Error('synthetic-private-accessor'); } });
  const proxy = new Proxy({}, { get() { touched++; throw new Error('synthetic-private-proxy'); }, ownKeys() { touched++; throw new Error('synthetic-private-keys'); } });
  for (const value of [accessor, proxy, new String(source(2, 21)), undefined, null, true, 42, ['untrusted']]) assert.equal(diagnoseAcceptanceCapacity(value), undefined);
  assert.equal(touched, 0);
  const deep = '{"checks":[{"name":' + '['.repeat(20000) + '0' + ']'.repeat(20000) + ',"steps":[]},{"name":"other","steps":[]}]}';
  assert.ok(Buffer.byteLength(deep) <= ACCEPTANCE_DIAGNOSTIC_LIMITS.rawBytes); assert.doesNotThrow(() => diagnoseAcceptanceCapacity(deep)); assert.equal(diagnoseAcceptanceCapacity(deep), undefined);
});
