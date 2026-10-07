import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runGate, type AcceptanceCheck } from '../server/gate.js';
import { ACCEPTANCE_CONTRACT_VERSION, PROMPT_VERSION, testsSchema } from '../server/production/contracts.js';
import { demoChecks } from '../server/production/fixtures.js';

const mirror: AcceptanceCheck[] = [
  { name: 'Native input alpha', steps: [{ action: 'fill', selector: '#input', value: 'alpha' }, { action: 'assertValue', selector: 'input', value: 'alpha' }] },
  { name: 'Native input beta', steps: [{ action: 'fill', selector: '#input', value: 'beta' }, { action: 'assertValue', selector: '[id=input]', value: 'beta' }] },
];

test('v2 production contract refuses selector aliases that only mirror the native input value', () => {
  assert.equal(PROMPT_VERSION, 'production-html-v4'); assert.equal(ACCEPTANCE_CONTRACT_VERSION, 'production-acceptance-v2');
  assert.throws(() => testsSchema.parse({ checks: mirror }), /业务结果/);
  assert.throws(() => testsSchema.parse({ checks: [mirror[0], { name: 'Focus and echo only', steps: [{ action: 'click', selector: '#input' }, { action: 'assertValue', selector: 'input', value: '' }] }] }), /业务结果/);
});

test('v2 production contract refuses fill-driven assertChanged aliases without a business result', () => {
  assert.throws(() => testsSchema.parse({ checks: [mirror[0], { name: 'Native fill change only', steps: [{ action: 'assertChanged', selector: 'input', after: { action: 'fill', selector: '#input', value: 'alpha' } }] }] }), /业务结果/);
});

test('legacy browser gate still demonstrates the weak input-only behavior, but production now blocks freezing it', async () => {
  const html = '<!doctype html><html><title>Native input only</title><body>Only an input<input id="input"></body></html>';
  assert.equal((await runGate(html, mirror)).passed, true, 'legacy gate behavior is intentionally unchanged for the parallel virtual-society line');
  assert.equal(testsSchema.safeParse({ checks: mirror }).success, false);
});

test('value-clearing assertions remain auxiliary and all frozen fixture business contracts still validate', () => {
  const checks: AcceptanceCheck[] = [mirror[0], { name: 'Actual output and auxiliary cleared input', steps: [{ action: 'fill', selector: '#input', value: 'alpha' }, { action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#result', text: 'alpha' }, { action: 'assertValue', selector: '#input', value: '' }] }];
  assert.doesNotThrow(() => testsSchema.parse({ checks }));
  for (const operation of ['create', 'feature', 'bugfix'] as const) assert.doesNotThrow(() => testsSchema.parse({ checks: demoChecks(operation) }));
  assert.doesNotThrow(() => testsSchema.parse({ checks: [mirror[0], { name: 'Clicked result changed', steps: [{ action: 'assertChanged', selector: '#result', after: { action: 'click', selector: '#add' } }] }] }));
});
