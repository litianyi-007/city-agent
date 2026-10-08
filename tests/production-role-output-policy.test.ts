import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { z } from 'zod';
import { ACCEPTANCE_GROUP_INSTRUCTIONS, ACCEPTANCE_PLAN_INSTRUCTIONS, ACCEPTANCE_CONSTRUCTION_REVIEW_INSTRUCTIONS, CONTRACT_INSTRUCTIONS, GROUPED_ACCEPTANCE_GROUP_INSTRUCTIONS, GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS, GROUPED_ACCEPTANCE_PROMPT_VERSION, GROUPED_CONTRACT_INSTRUCTIONS, LEGACY_GROUPED_ACCEPTANCE_PROMPT_VERSION, STEP_AUDITED_GROUPED_PROMPT_VERSION, STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS, STEP_AUDITED_ACCEPTANCE_PLAN_INSTRUCTIONS, STEP_AUDITED_ACCEPTANCE_GROUP_INSTRUCTIONS, STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS, STEP_AUDIT_PLANNING_INSTRUCTIONS, contractProfile, outputContractSnapshot, parseJson, planSchema, verifierSchema } from '../server/production/contracts.ts';
import { acceptancePlanSchema } from '../server/production/acceptance-plan.ts';
import { PM_OUTPUT_POLICY_VERSION, ROLE_SCHEMA_DIAGNOSTICS_VERSION, ROLE_SCHEMA_DIAGNOSTIC_LIMITS, diagnoseRoleSchema, pmOutputPolicy, type RoleSchemaBinding } from '../server/production/role-output-policy.ts';

// Pure fixtures and immutable public archive replay only: no model, service,
// generated-code execution, credentials, migration or edits to archived bytes.
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const contract = outputContractSnapshot(planSchema);
const binding: RoleSchemaBinding = { role: 'project-manager', phase: 'think-design', callId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', outputContractHash: sha(JSON.stringify(contract)) };
const valid = { decision: 'proceed', summary: 'Choose authorized defaults, not new user facts.', tasks: [{ id: 'build', owner: 'developer', description: 'Implement the original goal.' }], risks: [] };
const inspect = (value: unknown, schema: z.ZodType = planSchema) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value); const before = raw;
  const result = diagnoseRoleSchema(raw, schema, binding); assert.ok(result);
  assert.equal(result.version, ROLE_SCHEMA_DIAGNOSTICS_VERSION);
  assert.equal(result.sourceSha256, sha(raw));
  for (const key of ['role', 'phase', 'callId', 'candidateId', 'outputContractHash'] as const) assert.equal(result[key], binding[key]);
  assert.ok(result.issues.length <= 8); assert.equal(raw, before);
  return result;
};

test('ordinary PM policy is derived from the exact closed input schema and preserves its original order/hash', () => {
  const before = JSON.stringify(contract);
  const facts = pmOutputPolicy('think-design', contract);
  assert.equal(facts.version, 'production-pm-output-policy-v1'); assert.equal(facts.version, PM_OUTPUT_POLICY_VERSION);
  assert.equal(facts.phase, 'think-design'); assert.equal(facts.outputContractHash, sha(before));
  assert.deepEqual(facts.root, { allowedFields: ['decision', 'summary', 'tasks', 'risks'], requiredFields: ['decision', 'summary', 'tasks', 'risks'], additionalProperties: false });
  assert.deepEqual(facts.designDefaultFields, ['summary', 'tasks[].description', 'risks[]']);
  assert.equal(JSON.stringify(contract), before); assert.ok(Object.isFrozen(facts.root.allowedFields));
  for (const phase of ['feedback-0', 'feedback-1', 'feedback-25']) assert.deepEqual(pmOutputPolicy(phase, contract).designDefaultFields, facts.designDefaultFields);
});

test('acceptance-plan has a distinct actual root and legal default mapping, never quote/ID fields or ordinary PM fields', () => {
  const actual = outputContractSnapshot(acceptancePlanSchema); const facts = pmOutputPolicy('acceptance-plan', actual);
  assert.deepEqual(facts.root.allowedFields, ['version', 'obligations', 'groups']);
  assert.deepEqual(facts.root.requiredFields, ['version', 'obligations', 'groups']);
  assert.deepEqual(facts.designDefaultFields, ['obligations[].scenario', 'obligations[].expected', 'groups[].checks[].setup', 'groups[].checks[].exercise', 'groups[].checks[].assertions']);
  assert.equal(facts.outputContractHash, sha(JSON.stringify(actual)));
  assert.throws(() => pmOutputPolicy('acceptance-plan', contract), /Role output policy unavailable/);
  assert.throws(() => pmOutputPolicy('think-design', actual), /Role output policy unavailable/);
});

test('only grouped v2 removes the incompatible default-field instruction; legacy HTML/camera and grouped v1 prompt bytes stay fixed', () => {
  assert.equal(GROUPED_ACCEPTANCE_PROMPT_VERSION, 'production-html-grouped-v2');
  assert.equal(LEGACY_GROUPED_ACCEPTANCE_PROMPT_VERSION, 'production-html-grouped-v1');
  const expectedHtml = {
    product: '5ee931fedd19aa62e02cf1e2ac890242a6ee31a7e86861e0633f82d4d2830f87',
    researcher: 'e22accdc831f19c63caf082f17a27f74cb2e99b11b97eb70317f7337db2bda36',
    'project-manager': 'c5f26f6533272681b419fa991b766e755ad452b0fa1d93bb902e08ee4f925c77',
    tester: 'ae09d70b4e3ca5c40b51fa494902d28c7ec0a9f5b09bb0e09217417391372125',
    developer: 'e8e0cbc0889f783d210bca7d60638cfbebbdbee439b4a2cc90214bc4469b4b51',
  };
  const expectedCamera = {
    product: 'f7aee927db01451e745eba24955728cba2488d0e57a55d3e0de1796e771d5387',
    researcher: 'e839fa92a5dc9fb3fe5a0568a96612142a392c193263afb8ee85b9484d78ef70',
    'project-manager': '49ebe0f4654d2af7fe6c1e491461ee7d8e72222cb6e443eaa54776fc8a9db082',
    tester: '2b9b767e36e70bd2a753dbb507f6af6436acef24a0afb8702e52a57b808463b0',
    developer: '92d4338e4b419a6f8993fdb2070f0ae1c41e7a320ef41d9151121b1918f0930d',
  };
  assert.deepEqual(Object.fromEntries(Object.entries(CONTRACT_INSTRUCTIONS).map(([role, text]) => [role, sha(text)])), expectedHtml);
  assert.deepEqual(Object.fromEntries(Object.entries(contractProfile('camera-scene-v1').instructions).map(([role, text]) => [role, sha(text)])), expectedCamera);
  assert.equal(sha(ACCEPTANCE_PLAN_INSTRUCTIONS), 'b00fae9a4c6a15c832093ec26b700dd60d7bafccf4adf7cb5a7ea44cbe205465');
  assert.equal(sha(ACCEPTANCE_GROUP_INSTRUCTIONS), '66e6a089975239d6e2706c02ace70ae853a3d8b035457404a45aa0d9b0f0597b');
  for (const text of [...Object.values(CONTRACT_INSTRUCTIONS), ACCEPTANCE_PLAN_INSTRUCTIONS, ACCEPTANCE_GROUP_INSTRUCTIONS]) assert.ok(text.includes('并在acceptance或constraints记录以供冻结'));
  for (const text of [...Object.values(GROUPED_CONTRACT_INSTRUCTIONS), GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS, GROUPED_ACCEPTANCE_GROUP_INSTRUCTIONS]) {
    assert.equal(text.includes('并在acceptance或constraints记录以供冻结'), false);
    assert.ok(text.includes('本阶段outputContract已有且语义适合的字段'));
  }
  for (const text of [GROUPED_CONTRACT_INSTRUCTIONS['project-manager'], GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS]) {
    assert.ok(text.includes('普通决策仅decision/summary/tasks/risks'));
    assert.ok(text.includes('验收计划仅version/obligations/groups'));
    assert.ok(text.includes('根对象闭合后不得再追加tasks'));
    assert.ok(text.includes('不能自动删字段、截取合法JSON前缀或修改Gate'));
  }
  assert.throws(() => planSchema.parse({ ...valid, notes: [] }));
});

test('step-audited grouped v3 preserves all v2 prompt bytes and the strict four-field Verifier output', () => {
  assert.equal(STEP_AUDITED_GROUPED_PROMPT_VERSION, 'production-html-grouped-v3');
  const expected = {
    product: 'f84ce943189b22c58450d04b38b47b4f67463eca99ba9548f9e4cfa85ba9b391',
    researcher: 'e3b484fe9da65216b36bed6fcda0f44bbb584cefe68155b5b3d93c171c136672',
    'project-manager': '83f07d44b73c66ae9b09d48f640adc497dce2c94f4b9970b4c73d2b9c8bcc4d7',
    tester: 'bf0e427494212f1847762f5befa4e5aae5dffb8a5c30187ee4fc930663cbda19',
    developer: 'cfc9ce1d00e2ee4401f4ea433e0682e2c551bcc35e03ed50c46b1e1bf87de0b8',
    p: '08dbac2535c51ced6f6b64b28afe9d04f746d603699167e70467a776dd8d63d8',
    g: '8eb96b4982e9ed40839e3dc72a9b26be5a99e1294bba7c202957595ed0376ae5',
    v: '052d12d128dc2bbbadcbdade51e75adc39603c35cc71173865348b88ca177921',
  };
  assert.deepEqual(Object.fromEntries(Object.entries({ ...GROUPED_CONTRACT_INSTRUCTIONS, p: GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS, g: GROUPED_ACCEPTANCE_GROUP_INSTRUCTIONS, v: ACCEPTANCE_CONSTRUCTION_REVIEW_INSTRUCTIONS }).map(([name, text]) => [name, sha(text)])), expected);
  for (const role of ['product', 'tester', 'developer'] as const) assert.equal(STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS[role], GROUPED_CONTRACT_INSTRUCTIONS[role]);
  for (const role of ['researcher', 'project-manager'] as const) assert.equal(STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS[role], `${GROUPED_CONTRACT_INSTRUCTIONS[role]} ${STEP_AUDIT_PLANNING_INSTRUCTIONS}`);
  assert.equal(STEP_AUDITED_ACCEPTANCE_PLAN_INSTRUCTIONS, `${GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS} ${STEP_AUDIT_PLANNING_INSTRUCTIONS}`);
  assert.equal(STEP_AUDITED_ACCEPTANCE_GROUP_INSTRUCTIONS, `${GROUPED_ACCEPTANCE_GROUP_INSTRUCTIONS} ${STEP_AUDIT_PLANNING_INSTRUCTIONS}`);
  assert.ok(STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS.startsWith(`${ACCEPTANCE_CONSTRUCTION_REVIEW_INSTRUCTIONS} `));
  assert.ok(STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS.includes('审计不能发现计划漏掉的原始要求'));
  assert.deepEqual(Object.keys(verifierSchema.shape), ['decision', 'selectedCandidateId', 'scores', 'reason']);
});

test('policy rejects incompatible phases, open roots and nonexistent or wrongly typed mapping paths, never inventing fields', () => {
  for (const phase of ['product', 'acceptance', 'feedback-01', 'feedback--1', 'feedback-1000000', 'think-design\n', 'feedback-0\n']) assert.throws(() => pmOutputPolicy(phase, contract));
  for (const edit of [
    (s: Record<string, unknown>) => { s.additionalProperties = true; },
    (s: Record<string, unknown>) => { delete s.required; },
    (s: Record<string, unknown>) => { s.required = ['missing']; },
    (s: Record<string, unknown>) => { s.required = ['summary', 'summary']; },
    (s: Record<string, unknown>) => { (s.properties as Record<string, unknown>).summary = { type: 'integer' }; },
    (s: Record<string, unknown>) => { delete (s.properties as Record<string, unknown>).tasks; },
  ]) { const copied = structuredClone(contract); edit(copied.jsonSchema); assert.throws(() => pmOutputPolicy('think-design', copied)); }
});

test('legal JSON returns undefined without proving coverage and syntactically illegal JSON remains the syntax diagnostic responsibility', () => {
  const raw = JSON.stringify(valid); assert.equal(diagnoseRoleSchema(raw, planSchema, binding), undefined);
  for (const fenced of [` \n\`\`\`json\n${raw}\n\`\`\`\n`, `\`\`\`\n${raw}\n\`\`\``]) assert.equal(diagnoseRoleSchema(fenced, planSchema, binding), undefined);
  for (const bad of ['{} trailing', '{} {}', '{"tasks":', '```json\n{}', 'before ```json\n{}\n```', '```javascript\n{}\n```']) {
    assert.throws(() => parseJson(bad), SyntaxError); assert.equal(diagnoseRoleSchema(bad, planSchema, binding), undefined);
  }
  const result = inspect('{}'); assert.equal(result.kind, 'schema-structure'); assert.equal(result.issueCount, 4);
  assert.deepEqual(result.issues.map(issue => issue.path), ['$.decision', '$.summary', '$.tasks', '$.risks']);
});

test('unknown root/nested keys and hostile messages are counted but never exposed as diagnostic text or paths', () => {
  const marker = 'SECRET-UNTRUSTED-UNKNOWN-PROPERTY';
  const hostile = `${marker}\n\"😀\\/etc/private`;
  const value = { ...valid, [hostile]: 'provider body', tasks: [{ ...valid.tasks[0], [hostile]: 'not a host field', other: 'extra' }] };
  const result = inspect(value); assert.equal(result.kind, 'schema-structure'); assert.equal(result.issueCount, 2);
  assert.deepEqual(result.issues, [{ code: 'unrecognized_keys', path: '$.tasks[]', unknownKeyCount: 2 }, { code: 'unrecognized_keys', path: '$', unknownKeyCount: 1 }]);
  assert.equal(JSON.stringify(result).includes(marker), false); assert.equal(JSON.stringify(result).includes('provider body'), false);
  const custom = planSchema.superRefine((_value, ctx) => { ctx.addIssue({ code: 'custom', path: ['tasks', 0, hostile, 'summary'], message: marker }); });
  const controlled = inspect(valid, custom);
  assert.deepEqual(controlled.issues, [{ code: 'custom', path: '$.tasks[]' }]); assert.equal(JSON.stringify(controlled).includes(marker), false);
});

test('missing parent fields, actual nested types/enums and array capacity have distinct safe schema paths', () => {
  assert.deepEqual(inspect({ ...valid, tasks: undefined }).issues, [{ code: 'invalid_type', path: '$.tasks' }]);
  assert.deepEqual(inspect({ ...valid, tasks: 'not an array' }).issues, [{ code: 'invalid_type', path: '$.tasks' }]);
  assert.deepEqual(inspect({ ...valid, tasks: [{}] }).issues.map(issue => issue.path), ['$.tasks[].id', '$.tasks[].owner', '$.tasks[].description']);
  assert.deepEqual(inspect({ ...valid, tasks: [{ ...valid.tasks[0], owner: 'untrusted-owner' }] }).issues, [{ code: 'invalid_value', path: '$.tasks[].owner' }]);
  assert.deepEqual(inspect({ ...valid, tasks: [] }).issues, [{ code: 'too_small', path: '$.tasks' }]);
  assert.deepEqual(inspect({ ...valid, tasks: Array.from({ length: 13 }, () => valid.tasks[0]) }).issues, [{ code: 'too_big', path: '$.tasks' }]);
});

test('diagnosis is capped at eight issues while retaining actual total, and never sorts or changes candidate values', () => {
  const raw = JSON.stringify({ ...valid, tasks: Array.from({ length: 4 }, () => ({})) }); const before = raw;
  const result = inspect(raw); assert.equal(result.issueCount, 12); assert.equal(result.issues.length, 8); assert.equal(result.truncated, true);
  assert.equal(raw, before); assert.equal(result.sourceSha256, sha(before)); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.issues));
  assert.throws(() => planSchema.parse(parseJson(raw)), 'Diagnosis must never repair invalid input');
});

test('schema navigation supports actual unions/tuple slots and drops dynamic record keys or invented paths', () => {
  const schema = z.object({ entries: z.array(z.union([z.object({ kind: z.literal('a'), detail: z.string() }).strict(), z.object({ kind: z.literal('b'), detail: z.number() }).strict()])), tuple: z.tuple([z.object({ value: z.string() }).strict()]), record: z.record(z.string(), z.number()) }).strict().superRefine((_v, ctx) => { ctx.addIssue({ code: 'custom', path: ['record', 'HOSTILE-DYNAMIC-KEY'], message: 'HOSTILE MESSAGE' }); });
  const result = inspect({ entries: [{ kind: 'a', detail: 'ok' }], tuple: [{ value: 3 }], record: { 'HOSTILE-DYNAMIC-KEY': 'bad' } }, schema);
  assert.deepEqual(result.issues.map(issue => issue.path), ['$.tuple[].value', '$.record']);
  assert.equal(JSON.stringify(result).includes('HOSTILE'), false);
  const union = inspect({ entries: [{ kind: 'a', detail: false }], tuple: [{ value: 'ok' }], record: {} }, schema);
  assert.equal(union.issues[0]!.path, '$.entries[]'); assert.equal(union.issues[0]!.code, 'invalid_union');
});

test('resource limits precede schema/refinement and return only fixed bound facts', () => {
  assert.deepEqual(ROLE_SCHEMA_DIAGNOSTIC_LIMITS, { rawBytes: 262144, nodes: 10000, depth: 16, issues: 8 });
  let visited = 0; const tracked = z.unknown().superRefine((_v, _ctx) => { visited++; });
  const large = JSON.stringify('界'.repeat(90000));
  const many = JSON.stringify(Array.from({ length: 10000 }, () => 0));
  let deep: unknown = 0; for (let i = 0; i < 17; i++) deep = [deep];
  for (const [raw, resource] of [[large, 'raw-bytes'], [many, 'nodes'], [JSON.stringify(deep), 'depth']] as const) {
    const result = inspect(raw, tracked); assert.equal(result.kind, 'resource-limit'); assert.equal(result.resource, resource);
    assert.deepEqual(result.issues, []); assert.equal(result.issueCount, 0); assert.equal(result.truncated, false);
  }
  assert.equal(visited, 0);
  assert.equal(diagnoseRoleSchema(JSON.stringify(Array.from({ length: 9999 }, () => 0)), tracked, binding), undefined);
  assert.equal(visited, 1);
});

test('diagnostic binding rejects untrusted role/phase/IDs/hash instead of copying malformed host metadata', () => {
  for (const change of [{ role: 'tester' }, { phase: 'user-controlled' }, { phase: 'feedback-0\n' }, { callId: 'not-a-uuid' }, { callId: binding.callId + '\n' }, { candidateId: binding.candidateId + '\n' }, { candidateId: 'provider secret' }, { outputContractHash: 'a'.repeat(63) }, { outputContractHash: 'A'.repeat(64) }, { outputContractHash: binding.outputContractHash + '\n' }]) assert.throws(() => diagnoseRoleSchema('{}', planSchema, { ...binding, ...change } as RoleSchemaBinding), /Role output policy unavailable/);
});

test('immutable HTML05 extra-field failures yield controlled diagnostics bound to real public source calls; trailing JSON is not repaired', () => {
  const path = new URL('../docs/production/experiments/HTML-05/run.json', import.meta.url); const bytes = readFileSync(path); const originalSha = sha(bytes);
  const run = JSON.parse(bytes.toString('utf8')) as { id: string; calls: Array<{ role: string; phase: string; id: string; candidateId: string; rawOutput: string }> };
  assert.equal(run.id, '9a56085f-8a2e-474d-97fd-82f82aaac795');
  const calls = run.calls.filter(call => call.role === 'project-manager'); assert.equal(calls.length, 3);
  const expected = ['a70a9e7553580e119ff7e5116d5865e38ddaf69ebe28b572831a34ffd6d852c1', '383ea04cc409579416767304e270c041d473fc0f2202a1066b8781fbd944720b', '5f3347aa43571dd2859ecf358fc082f31bf34adfcfd32bde8cff32ffaa5f8235'];
  calls.forEach((call, index) => {
    assert.equal(sha(call.rawOutput), expected[index]);
    const realBinding = { ...binding, phase: call.phase, callId: call.id, candidateId: call.candidateId };
    const result = diagnoseRoleSchema(call.rawOutput, planSchema, realBinding);
    if (index === 2) { assert.equal(result, undefined); assert.throws(() => parseJson(call.rawOutput), SyntaxError); return; }
    assert.ok(result); assert.equal(result.sourceSha256, expected[index]); assert.equal(result.callId, call.id); assert.equal(result.candidateId, call.candidateId);
    assert.deepEqual(result.issues, [{ code: 'unrecognized_keys', path: '$', unknownKeyCount: 1 }]);
    assert.equal(JSON.stringify(result).includes('decision_note'), false); assert.equal(JSON.stringify(result).includes('decision_rationale_note'), false);
    assert.throws(() => planSchema.parse(parseJson(call.rawOutput)));
  });
  assert.equal(sha(readFileSync(path)), originalSha, 'Read-only replay never updates historical bytes');
});
