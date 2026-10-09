import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { acceptancePlanSchema } from '../server/production/acceptance-plan.ts';
import { outputContractSnapshot, planSchema, researchSchema } from '../server/production/contracts.ts';
import { OUTPUT_ENVELOPE_INSTRUCTIONS, OUTPUT_ENVELOPE_LIMITS, OUTPUT_ENVELOPE_VERSION, outputEnvelopePolicy, type OutputEnvelopeRole } from '../server/production/output-envelope.ts';

const researchContract = outputContractSnapshot(researchSchema);
const planContract = outputContractSnapshot(planSchema);
const acceptanceContract = outputContractSnapshot(acceptancePlanSchema);
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const rejected = (contract: unknown, role: OutputEnvelopeRole = 'researcher', phase = 'research') => assert.throws(() => outputEnvelopePolicy(role, phase, contract as typeof researchContract), /^Error: Output envelope unavailable$/);

test('real research schema yields exactly three required string arrays and no answers', () => {
  const before = JSON.stringify(researchContract);
  const facts = outputEnvelopePolicy('researcher', 'research', researchContract);
  assert.equal(facts.version, 'production-output-envelope-v1'); assert.equal(facts.version, OUTPUT_ENVELOPE_VERSION);
  assert.equal(facts.role, 'researcher'); assert.equal(facts.phase, 'research');
  assert.equal(facts.outputContractHash, sha(before));
  assert.deepEqual(facts.root, { allowedFields: ['observations', 'constraints', 'unknowns'], requiredFields: ['observations', 'constraints', 'unknowns'], additionalProperties: false });
  assert.deepEqual(facts.arrays, ['observations', 'constraints', 'unknowns'].map(path => ({ path, itemType: 'string' })));
  assert.equal(JSON.stringify(researchContract), before);
  assert.deepEqual(Object.keys(facts), ['version', 'role', 'phase', 'outputContractHash', 'root', 'arrays']);
});

test('real ordinary PM schema exposes task item fields and remains distinct from acceptance-plan', () => {
  const facts = outputEnvelopePolicy('project-manager', 'think-design', planContract);
  assert.deepEqual(facts.root.allowedFields, ['decision', 'summary', 'tasks', 'risks']);
  assert.deepEqual(facts.arrays, [
    { path: 'tasks', itemType: 'object', itemObject: { allowedFields: ['id', 'owner', 'description'], requiredFields: ['id', 'owner', 'description'], additionalProperties: false } },
    { path: 'risks', itemType: 'string' },
  ]);
  for (const phase of ['feedback-0', 'feedback-1', 'feedback-999999']) {
    const feedback = outputEnvelopePolicy('project-manager', phase, planContract);
    assert.deepEqual(feedback.root, facts.root); assert.deepEqual(feedback.arrays, facts.arrays);
    assert.equal(feedback.phase, phase); assert.equal(feedback.outputContractHash, facts.outputContractHash);
  }
  assert.equal(JSON.stringify(facts).includes('proceed'), false, 'Enum values are not candidate/default answers');
});

test('actual acceptance-plan maps strict root, object items and nested check/obligation arrays without values', () => {
  const facts = outputEnvelopePolicy('project-manager', 'acceptance-plan', acceptanceContract);
  assert.deepEqual(facts.root, { allowedFields: ['version', 'obligations', 'groups'], requiredFields: ['version', 'obligations', 'groups'], additionalProperties: false });
  assert.deepEqual(facts.arrays, [
    { path: 'obligations', itemType: 'object', itemObject: { allowedFields: ['id', 'source', 'quote', 'scenario', 'expected'], requiredFields: ['id', 'source', 'quote', 'scenario', 'expected'], additionalProperties: false } },
    { path: 'groups', itemType: 'object', itemObject: { allowedFields: ['id', 'checks'], requiredFields: ['id', 'checks'], additionalProperties: false } },
    { path: 'groups[].checks', itemType: 'object', itemObject: { allowedFields: ['id', 'obligationIds', 'setup', 'exercise', 'assertions', 'stepBudget'], requiredFields: ['id', 'obligationIds', 'setup', 'exercise', 'assertions', 'stepBudget'], additionalProperties: false } },
    { path: 'groups[].checks[].obligationIds', itemType: 'string' },
  ]);
  const serialized = JSON.stringify(facts);
  for (const unwanted of ['production-acceptance-plan-v1', 'brief', 'acceptance', 'minItems', 'maxItems', 'maximum', 'const', 'pattern']) assert.equal(serialized.includes(`"${unwanted}"`), false);
  assert.equal(facts.outputContractHash, sha(JSON.stringify(acceptanceContract)));
});

test('policy preserves schema order and required optional distinction, hashes full annotations but never copies them', () => {
  const marker = 'UNTRUSTED_ANNOTATION_AND_DEFAULT_NOT_AN_ANSWER';
  const contract = { version: 'test-host-v1', jsonSchema: { type: 'object', properties: { second: { type: 'string', default: marker }, first: { type: 'array', items: { type: 'string', description: marker } } }, required: ['first'], additionalProperties: false, description: marker } };
  const before = JSON.stringify(contract); const facts = outputEnvelopePolicy('researcher', 'research', contract);
  assert.deepEqual(facts.root.allowedFields, ['second', 'first']); assert.deepEqual(facts.root.requiredFields, ['first']);
  assert.equal(facts.outputContractHash, sha(before)); assert.equal(JSON.stringify(facts).includes(marker), false);
  assert.equal(JSON.stringify(contract), before); assert.deepEqual(outputEnvelopePolicy('researcher', 'research', structuredClone(contract)), facts);
  const changed = structuredClone(contract); changed.jsonSchema.description += '!';
  assert.notEqual(outputEnvelopePolicy('researcher', 'research', changed).outputContractHash, facts.outputContractHash);
});

test('returned metadata is recursively frozen and detached from unchanged input', () => {
  const contract = structuredClone(planContract); const before = JSON.stringify(contract);
  const facts = outputEnvelopePolicy('project-manager', 'think-design', contract);
  const visit = (value: unknown) => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) visit(child); } };
  visit(facts); assert.equal(JSON.stringify(contract), before); assert.equal(Object.isFrozen(contract), false);
  assert.throws(() => (facts.root.allowedFields as string[]).push('extra'));
  (contract.jsonSchema.properties as Record<string, unknown>).extra = { type: 'string' };
  assert.deepEqual(facts.root.allowedFields, ['decision', 'summary', 'tasks', 'risks']);
  assert.doesNotThrow(() => JSON.stringify(facts));
});

test('only permitted role-phase pairs pass, including exact end-of-string and bounded feedback suffix', () => {
  for (const [role, phase] of [['researcher', 'think-design'], ['researcher', 'acceptance-plan'], ['project-manager', 'research'], ['tester', 'research'], ['verifier', 'think-design'], ['project-manager', 'feedback-01'], ['project-manager', 'feedback--1'], ['project-manager', 'feedback-1000000'], ['project-manager', 'feedback-0\n'], ['researcher', 'research\n'], ['project-manager', 'think-design\n']]) rejected(researchContract, role as OutputEnvelopeRole, phase);
});

test('open roots/items, missing/invalid required fields and unsafe field names fail closed', () => {
  const edits = [
    (s: Record<string, unknown>) => { s.additionalProperties = true; },
    (s: Record<string, unknown>) => { delete s.additionalProperties; },
    (s: Record<string, unknown>) => { delete s.required; },
    (s: Record<string, unknown>) => { s.required = ['missing']; },
    (s: Record<string, unknown>) => { s.required = ['observations', 'observations']; },
    (s: Record<string, unknown>) => { s.required = [123]; },
    (s: Record<string, unknown>) => { s.properties = { ['x'.repeat(65)]: { type: 'string' } }; s.required = []; },
    (s: Record<string, unknown>) => { s.properties = { ['field\n']: { type: 'string' } }; s.required = []; },
    (s: Record<string, unknown>) => { s.properties = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`f${i}`, { type: 'string' }])); s.required = []; },
  ];
  for (const edit of edits) { const contract = structuredClone(researchContract); edit(contract.jsonSchema); rejected(contract); }
  const contract = structuredClone(planContract);
  ((contract.jsonSchema.properties as Record<string, { items: Record<string, unknown> }>).tasks.items).additionalProperties = true;
  rejected(contract, 'project-manager', 'think-design');
});

test('unsupported refs/unions/tuple/open-record/mixed or nonstring scalar-array shapes are rejected, not summarized', () => {
  for (const node of [{ type: ['string', 'null'] }, { type: 'array', items: { type: 'number' } }, { type: 'array', items: true }, { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'string' } }, { anyOf: [{ type: 'string' }, { type: 'object' }] }, { type: 'string', $ref: '#/$defs/f' }, { type: 'object', properties: {}, required: [], additionalProperties: { type: 'string' } }]) {
    const contract = { version: 'test-host-v1', jsonSchema: { type: 'object', properties: { field: node }, required: ['field'], additionalProperties: false } };
    rejected(contract);
  }
  for (const contract of [null, {}, { version: '', jsonSchema: researchContract.jsonSchema }, { ...researchContract, extra: 'not the host wrapper' }, { version: 'v', jsonSchema: false }]) rejected(contract);
});

test('plain JSON validation never invokes getters, Proxy traps, toJSON, custom prototypes or cycles', () => {
  let invoked = 0;
  const getter = structuredClone(researchContract); Object.defineProperty(getter.jsonSchema, 'description', { enumerable: true, get() { invoked++; return 'unsafe'; } });
  const nested = structuredClone(researchContract); Object.defineProperty((nested.jsonSchema.properties as Record<string, unknown>).observations as object, 'items', { enumerable: true, get() { invoked++; return { type: 'string' }; } });
  const proxy = new Proxy(researchContract, { get() { invoked++; throw new Error('unsafe'); }, ownKeys() { invoked++; throw new Error('unsafe'); } });
  const nestedProxy = structuredClone(researchContract); (nestedProxy.jsonSchema.properties as Record<string, unknown>).observations = new Proxy({}, { ownKeys() { invoked++; throw new Error('unsafe'); } });
  const method = { ...researchContract, toJSON() { invoked++; return researchContract; } };
  const prototype = Object.assign(Object.create({ get toJSON() { invoked++; throw new Error('unsafe'); } }), researchContract);
  const cycle = structuredClone(researchContract) as typeof researchContract & { cycle?: unknown }; cycle.cycle = cycle;
  for (const contract of [getter, nested, proxy, nestedProxy, method, prototype, cycle]) rejected(contract);
  assert.equal(invoked, 0);
});

test('only actual root non-enumerable data ~standard exporter annotation is ignored without observing its value', () => {
  const original = outputEnvelopePolicy('researcher', 'research', researchContract);
  assert.deepEqual(original, outputEnvelopePolicy('researcher', 'research', structuredClone(researchContract)));
  let invoked = 0;
  const inert = structuredClone(researchContract);
  Object.defineProperty(inert.jsonSchema, '~standard', { enumerable: false, value: new Proxy({}, { get() { invoked++; throw new Error('must not observe adapter'); }, ownKeys() { invoked++; throw new Error('must not observe adapter'); } }) });
  assert.deepEqual(outputEnvelopePolicy('researcher', 'research', inert), original);
  const accessor = structuredClone(researchContract);
  Object.defineProperty(accessor.jsonSchema, '~standard', { enumerable: false, get() { invoked++; throw new Error('must not call adapter getter'); } });
  rejected(accessor);
  const hidden = structuredClone(researchContract); Object.defineProperty(hidden.jsonSchema, 'other', { enumerable: false, value: {} }); rejected(hidden);
  const nested = structuredClone(researchContract); Object.defineProperty((nested.jsonSchema.properties as Record<string, unknown>).observations as object, '~standard', { enumerable: false, value: {} }); rejected(nested);
  const wrapper = structuredClone(researchContract); Object.defineProperty(wrapper, '~standard', { enumerable: false, value: {} }); rejected(wrapper);
  assert.equal(invoked, 0);
});

test('32KiB/depth/node bounds and non-JSON values fail closed before any navigation or output', () => {
  assert.deepEqual(OUTPUT_ENVELOPE_LIMITS, { contractBytes: 32768, nodes: 10000, depth: 16, fields: 64, fieldNameCharacters: 64 });
  const large = structuredClone(researchContract) as typeof researchContract & { annotation?: unknown }; large.annotation = '界'.repeat(11000); rejected(large);
  const many = structuredClone(researchContract); many.jsonSchema.annotation = Array.from({ length: 10000 }, () => 0); rejected(many);
  const deep = structuredClone(researchContract); let nested: unknown = 0; for (let i = 0; i < 17; i++) nested = [nested]; deep.jsonSchema.annotation = nested; rejected(deep);
  for (const value of [undefined, () => 1, Symbol('unsafe'), 1n, NaN, Infinity]) { const contract = structuredClone(researchContract); contract.jsonSchema.annotation = value; rejected(contract); }
  const hidden = structuredClone(researchContract); Object.defineProperty(hidden.jsonSchema, 'hidden', { value: 'not JSON', enumerable: false }); rejected(hidden);
  const sparse = structuredClone(researchContract); sparse.jsonSchema.annotation = new Array(1); rejected(sparse);
  const symbol = structuredClone(researchContract); Object.defineProperty(symbol.jsonSchema, Symbol('not JSON'), { value: 'not JSON', enumerable: true }); rejected(symbol);
});

test('serialized UTF8 contract accepts exact 32KiB and rejects the next byte without truncation', () => {
  const contract = structuredClone(researchContract); contract.jsonSchema.description = '';
  const initialBytes = Buffer.byteLength(JSON.stringify(contract), 'utf8');
  contract.jsonSchema.description = 'x'.repeat(OUTPUT_ENVELOPE_LIMITS.contractBytes - initialBytes);
  const before = JSON.stringify(contract); assert.equal(Buffer.byteLength(before, 'utf8'), 32768);
  assert.equal(outputEnvelopePolicy('researcher', 'research', contract).outputContractHash, sha(before));
  contract.jsonSchema.description += 'x'; rejected(contract);
  assert.equal(Buffer.byteLength(JSON.stringify(contract), 'utf8'), 32769);
});

test('self-check guidance is syntax-only, preserves full requirements and cannot become an answer/repair/Gate bypass', () => {
  for (const phrase of ['一个完整JSON根对象', '逐项双引号成对', '控制字符正确转义', '全部required后才闭根', '无metadata/note/自检/额外字段', '合法空必需数组保留', '不删原需求/事实/约束/unknowns', '不解析/修JSON/删字段/预填答案/加调用/放宽预算', '导航非合法/覆盖证明', '实际schema及冻结Gate']) assert.ok(OUTPUT_ENVELOPE_INSTRUCTIONS.includes(phrase), phrase);
  assert.equal(OUTPUT_ENVELOPE_INSTRUCTIONS.includes('{'), false, 'No response template or prefilled answer');
  for (const businessKeyword of ['打印纸', '车票', '9999.99', 'HTML07', 'risksNote']) assert.equal(OUTPUT_ENVELOPE_INSTRUCTIONS.includes(businessKeyword), false);
});
