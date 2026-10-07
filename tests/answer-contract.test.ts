import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAnswerContract, decodeAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { getBusinessDemos, createBusinessDemoRun } from '../shared/research-demo';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { fingerprint } from '../shared/evidence';

// Independent JSON Schema oracle: it never calls the production decoder/old validator.
function oracle(schema: any, value: any): boolean {
  if (schema.anyOf && !schema.anyOf.some((child: any) => oracle(child, value))) return false;
  if (schema.not && oracle(schema.not, value)) return false;
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.type === 'null' && value !== null) return false;
  if (schema.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return false;
  if (schema.type === 'string' && typeof value !== 'string') return false;
  if (schema.type === 'array' && !Array.isArray(value)) return false;
  if (schema.type === 'integer' && !Number.isInteger(value)) return false;
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some((key: string) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key) && !oracle(child, value[key])) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return false;
    if (schema.items && !value.every(item => oracle(schema.items, item))) return false;
    if (schema.contains && !value.some(item => oracle(schema.contains, item))) return false;
  }
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (typeof value === 'string' && (schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength)) return false;
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  return true;
}

test('new object contract preserves all 24 complete business fixtures; old task/raw stays untouched', async () => {
  for (const demo of getBusinessDemos()) {
    const { run } = await createBusinessDemoRun({ demoId: demo.id, population: getPopulationModel(), pack: getPopulationPack() });
    const before = fingerprint(run);
    for (const record of run.responses) {
      const contract = compileAnswerContract(run.task, record.residentId, demo.logicRules);
      const raw = encodeAnswerContract(record.residentId, record.answers);
      assert.equal(oracle(contract.schema, JSON.parse(raw)), true);
      assert.deepEqual(decodeAnswerContract(contract, raw), record.answers);
      assert.equal(contract.schemaHash, fingerprint(contract.schema));
      assert.deepEqual((contract.schema.properties as any).answers.required, run.task.questionnaire.questions.map(q => q.id));
    }
    assert.equal(fingerprint(run), before);
  }
});

test('all structural mutations are rejected by production and independently compiled-schema oracle', async () => {
  const demo = getBusinessDemos()[0];
  const { run } = await createBusinessDemoRun({ demoId: demo.id, population: getPopulationModel(), pack: getPopulationPack() });
  const record = run.responses[0]; const contract = compileAnswerContract(run.task, record.residentId, demo.logicRules);
  const original = JSON.parse(encodeAnswerContract(record.residentId, record.answers));
  const mutations: [string, (v: any) => void][] = [
    ['optional omission', v => { delete v.answers['child-own-taste']; }],
    ['required omission', v => { delete v.answers.eligibility; }],
    ['unknown question', v => { v.answers['not-a-question'] = null; }],
    ['wrong resident', v => { v.residentId = 'resident-wrong'; }],
    ['extra root field', v => { v.explanation = 'extra'; }],
    ['wrong root type', v => { v.answers = []; }],
    ['single wrong ID', v => { v.answers.eligibility = 'not-a-choice'; }],
    ['single as array', v => { v.answers.eligibility = ['eligible']; }],
    ['required null', v => { v.answers.eligibility = null; }],
    ['multiple scalar', v => { v.answers['planned-channels'] = 'unknown'; }],
    ['multiple duplicate', v => { v.answers['planned-channels'] = ['online', 'online']; }],
    ['multiple exclusive', v => { v.answers['planned-channels'] = ['online', 'unknown']; }],
    ['multiple unknown ID', v => { v.answers['planned-channels'] = ['not-a-choice']; }],
    ['multiple empty', v => { v.answers['planned-channels'] = []; }],
    ['number string', v => { v.answers['monthly-budget'] = '80'; }],
    ['number below min', v => { v.answers['monthly-budget'] = -1; }],
    ['number above max', v => { v.answers['monthly-budget'] = 1e9; }],
    ['text wrong type', v => { v.answers['child-own-taste'] = 0; }],
    ['text too long', v => { v.answers['needed-evidence'] = 'x'.repeat(3000); }],
  ];
  const scale = run.task.questionnaire.questions.find(q => q.type === 'scale')!;
  mutations.push(['fractional scale', v => { v.answers[scale.id] = 1.5; }]);
  for (const [name, mutate] of mutations) {
    const value = structuredClone(original); mutate(value);
    assert.equal(oracle(contract.schema, value), false, name);
    assert.throws(() => decodeAnswerContract(contract, JSON.stringify(value)), name);
  }
});

test('zero versus null, duplicate escaped keys, no coercion and frozen schema drift', () => {
  const demo = getBusinessDemos()[0]; const contract = compileAnswerContract(demo.task, 'resident-001', demo.logicRules);
  const answers = demo.task.questionnaire.questions.map(q => ({ questionId: q.id, value: q.required ? q.type === 'single' ? q.options[0].id : q.type === 'multiple' ? [q.options[0].id] : q.type === 'scale' || q.type === 'number' ? q.min : '原文' : null }));
  const raw = encodeAnswerContract(contract.residentId, answers);
  const value = JSON.parse(raw); value.answers['monthly-budget'] = 0;
  assert.equal(decodeAnswerContract(contract, JSON.stringify(value)).find(a => a.questionId === 'monthly-budget')!.value, 0);
  value.answers['monthly-budget'] = null;
  assert.equal(decodeAnswerContract(contract, JSON.stringify(value)).find(a => a.questionId === 'monthly-budget')!.value, null);
  assert.throws(() => decodeAnswerContract(contract, raw.replace('"residentId":', '"residentId":"wrong","residentId":')), /重复/);
  assert.throws(() => decodeAnswerContract(contract, raw.replace('"residentId":', '"\\u0072esidentId":"wrong","residentId":')), /重复/);
  assert.throws(() => decodeAnswerContract(contract, '```json\n' + raw + '\n```'));
  const blank = JSON.parse(raw); blank.answers['needed-evidence'] = '  ';
  assert.throws(() => decodeAnswerContract(contract, JSON.stringify(blank)));
  const changed = structuredClone(contract); (changed.schema.properties as any).residentId.enum = ['other'];
  assert.throws(() => decodeAnswerContract(changed, raw), /漂移/);
  changed.schemaHash = fingerprint(changed.schema);
  assert.throws(() => decodeAnswerContract(changed, raw), /不一致/);
  assert.throws(() => encodeAnswerContract('resident-001', [answers[0], answers[0]]), /重复/);
});

test('new text limits use JSON Schema Unicode code points rather than changing historical UTF-16 rules', () => {
  const demo = getBusinessDemos()[0]; const task = structuredClone(demo.task);
  const question = task.questionnaire.questions.find(q => q.id === 'child-own-taste')!;
  assert.equal(question.type, 'text'); if (question.type !== 'text') return; question.maxLength = 1;
  const contract = compileAnswerContract(task, 'resident-001', demo.logicRules);
  const answers = task.questionnaire.questions.map(q => ({ questionId: q.id, value: q.required ? q.type === 'single' ? q.options[0].id : q.type === 'multiple' ? [q.options[0].id] : q.type === 'scale' || q.type === 'number' ? q.min : '原文' : null }));
  const value = JSON.parse(encodeAnswerContract(contract.residentId, answers)); value.answers['child-own-taste'] = '🍪';
  assert.equal(oracle(contract.schema, value), true); assert.doesNotThrow(() => decodeAnswerContract(contract, JSON.stringify(value)));
  value.answers['child-own-taste'] = '🍪🍪';
  assert.equal(oracle(contract.schema, value), false); assert.throws(() => decodeAnswerContract(contract, JSON.stringify(value)));
});

test('JSON object prototype names remain exact question IDs and nested duplicate keys cannot overwrite an answer', () => {
  const task = structuredClone(getBusinessDemos()[0].task);
  task.questionnaire.questions = [{ id: '__proto__', prompt: '保留稳定ID', type: 'text', required: false, maxLength: 20 }];
  delete task.validationRules; delete task.comparisons;
  const contract = compileAnswerContract(task, 'resident-001');
  const raw = encodeAnswerContract('resident-001', [{ questionId: '__proto__', value: null }]);
  assert.equal(oracle(contract.schema, JSON.parse(raw)), true);
  assert.deepEqual(decodeAnswerContract(contract, raw), [{ questionId: '__proto__', value: null }]);
  assert.throws(() => decodeAnswerContract(contract, raw.replace('"__proto__":null', '"__proto__":null,"\\u005f_proto__":"override"')), /重复/);
  assert.throws(() => decodeAnswerContract(contract, '{"residentId":"resident-001","answers":{}}'), /全部题目/);
});
