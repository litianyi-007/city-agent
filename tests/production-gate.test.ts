import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preflightAcceptanceChecks, runGate, type AcceptanceCheck } from '../server/gate.js';
import { testsSchema } from '../server/production/contracts.js';

const html = '<!doctype html><html><head><title>Exact gate</title></head><body><button id="add" onclick="document.querySelector(\'#count\').textContent=\'10\';document.querySelector(\'#items\').innerHTML=\'<li>A</li><li>B</li>\'">Add</button><output id="count">0</output><ul id="items"></ul></body></html>';
const setup: AcceptanceCheck = { name: 'Initial state', steps: [{ action: 'assertTextExact', selector: '#count', text: '0' }, { action: 'assertCount', selector: '#items li', count: 0 }] };

test('production exact assertions reject numeric substring false positive and wrong element counts', async () => {
  const checks: AcceptanceCheck[] = [setup, { name: 'Expected one item, not ten', steps: [{ action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#count', text: '1' }] }, { name: 'Expected exactly one actual item', steps: [{ action: 'click', selector: '#add' }, { action: 'assertCount', selector: '#items li', count: 1 }] }];
  const result = await runGate(html, checks);
  assert.equal(result.passed, false);
  assert.equal(result.checks.filter(check => !check.passed).length, 2);
});

test('production exact assertions pass real interactive results with exact counts', async () => {
  const result = await runGate(html, [setup, { name: 'Exact actual interaction', steps: [{ action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#count', text: '10' }, { action: 'assertCount', selector: '#items li', count: 2 }] }]);
  assert.equal(result.passed, true, JSON.stringify(result));
});

test('production test contract CSS syntax is rejected before development', async () => {
  const result = await preflightAcceptanceChecks([setup, { name: 'Bad selector', steps: [{ action: 'click', selector: '#add[' }, { action: 'assertCount', selector: '#items li', count: 1 }] }]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /非法 CSS/);
});

test('production rejects input-mirror-only and merely-visible contracts without a business result', () => {
  assert.throws(() => testsSchema.parse({ checks: [setup, { name: 'Native input echo only', steps: [{ action: 'fill', selector: '#input', value: 'a' }, { action: 'assertValue', selector: '#input', value: 'a' }] }] }), /业务结果/);
  assert.throws(() => testsSchema.parse({ checks: [setup, { name: 'Visible button only', steps: [{ action: 'click', selector: '#button' }, { action: 'assertVisible', selector: '#button' }] }] }), /业务结果/);
  assert.doesNotThrow(() => testsSchema.parse({ checks: [setup, { name: 'Actual output', steps: [{ action: 'click', selector: '#add' }, { action: 'assertCount', selector: '#items li', count: 1 }] }] }));
});
