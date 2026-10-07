import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptanceSchema } from '../server/gate.js';
import { ACCEPTANCE_CONTRACT_VERSION, CAMERA_ACCEPTANCE_VERSION, CAMERA_PROMPT_VERSION, CONTRACT_INSTRUCTIONS, CRITERIA_VERSION, PROMPT_VERSION, TESTER_STEP_EXAMPLES, TESTER_VALID_JSON_EXAMPLE, contractProfile, parseJson, testsSchema } from '../server/production/contracts.js';

test('tester full few-shot is parseable strict JSON and valid production business-check syntax', () => {
  const example = parseJson(TESTER_VALID_JSON_EXAMPLE) as { checks: unknown[] };
  assert.deepEqual(testsSchema.parse(example), example); assert.equal(acceptanceSchema.safeParse(example.checks).success, true);
  assert.ok(CONTRACT_INSTRUCTIONS.tester.includes(TESTER_VALID_JSON_EXAMPLE)); assert.ok(CONTRACT_INSTRUCTIONS.tester.includes(JSON.stringify(TESTER_STEP_EXAMPLES)));
  assert.equal(PROMPT_VERSION, 'production-html-v6'); assert.equal(CAMERA_PROMPT_VERSION, 'production-camera-scene-v5');
  assert.equal(CRITERIA_VERSION, 'verifier-phase-ordinal-v3'); assert.equal(ACCEPTANCE_CONTRACT_VERSION, 'production-acceptance-v2'); assert.equal(CAMERA_ACCEPTANCE_VERSION, 'production-camera-acceptance-v1');
});

test('every documented action object validates through the unchanged Gate step schema', () => {
  const example = JSON.parse(TESTER_VALID_JSON_EXAMPLE);
  assert.deepEqual([...new Set(TESTER_STEP_EXAMPLES.map(step => step.action))].sort(), ['assertChanged', 'assertCount', 'assertText', 'assertTextExact', 'assertValue', 'assertVisible', 'click', 'fill'].sort());
  for (const step of TESTER_STEP_EXAMPLES) {
    const checks = [example.checks[0], { name: `Documented ${step.action}`, steps: [step] }];
    assert.equal(acceptanceSchema.safeParse(checks).success, true, JSON.stringify(step)); assert.equal(testsSchema.safeParse({ checks }).success, true);
  }
});

test('function-like objects, misplaced fields and CAMERA02 bare-value JSON remain refused without repair', () => {
  const example = JSON.parse(TESTER_VALID_JSON_EXAMPLE);
  for (const step of [{ click: '#submit' }, { assertVisible: '#result' }, { assertTextExact: '#result', text: 'expected' }, { action: 'assertCount', selector: '#items li', count: '1' }, { action: 'assertTextExact', selector: '#result', value: 'expected' }, { action: 'assertChanged', selector: '#result', after: { click: '#update' } }, { action: 'assertChanged', selector: '#input', after: { action: 'fill', selector: '#input' } }, { action: 'click', selector: '#submit', text: 'extra' }]) {
    const candidate = { checks: [example.checks[0], { name: 'Illegal syntax fixture', steps: [step] }] };
    assert.equal(testsSchema.safeParse(candidate).success, false); assert.equal(acceptanceSchema.safeParse(candidate.checks).success, false);
  }
  const raw = '{"checks":[{"name":"synthetic invalid","steps":[{"assertTextExact":"#result","bare-value"}]}]}';
  assert.throws(() => parseJson(raw), SyntaxError); assert.equal(raw, '{"checks":[{"name":"synthetic invalid","steps":[{"assertTextExact":"#result","bare-value"}]}]}', 'No normalization or output repair');
});

test('camera tester instructions keep particle counts invariant and distinguish continuous palmX from button steps', () => {
  const prompt = contractProfile('camera-scene-v1').instructions.tester;
  assert.match(prompt, /不改变#particle-count/); assert.match(prompt, /palmX则连续映射\[0,1\]到\[-π,π\]/); assert.match(prompt, /不是按钮步进/);
  assert.match(prompt, /手动旋转按钮每次步进π\/8/); assert.match(prompt, /CSS步骤不得注入摄像头或要求识别结果/); assert.match(prompt, /不能把预览off状态断言套在synthetic Gate/);
  assert.match(prompt, /数值结果必须assertTextExact或assertCount/); assert.match(prompt, /不向严格\{checks\}添加非法字段/);
  assert.equal(JSON.stringify(TESTER_VALID_JSON_EXAMPLE).includes('圣诞'), false, 'Syntax example is generic, not a task-specific fallback');
});
