import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { runGate, type AcceptanceCheck } from '../server/gate.ts';
import { CONTRACT_INSTRUCTIONS, PROMPT_VERSION, contractProfile } from '../server/production/contracts.ts';
import { HTML_DOM_CONTRACT_INSTRUCTIONS, HTML_EXECUTION_INSTRUCTIONS, HTML_EXECUTION_PROFILE, HTML_EXECUTION_PROFILE_VERSION } from '../shared/production-execution-profile.ts';

const checks: AcceptanceCheck[] = [
  { name: 'initial independent result', steps: [{ action: 'assertTextExact', selector: '#result', text: 'idle' }] },
  { name: 'local interaction changes the result', steps: [{ action: 'fill', selector: '#entry', value: 'sample' }, { action: 'click', selector: '#activate' }, { action: 'assertTextExact', selector: '#result', text: 'sample' }] },
];
const fixture = (nativeSubmit: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Execution boundary fixture</title></head><body><h1>Engineering fixture, not a model delivery</h1><form id="controls"><label>Entry<input id="entry"></label><button id="activate" type="${nativeSubmit ? 'submit' : 'button'}">Apply</button></form><output id="result">idle</output><script>${nativeSubmit ? `document.querySelector('#controls').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#result').textContent=document.querySelector('#entry').value;});` : `document.querySelector('#activate').addEventListener('click',()=>{document.querySelector('#result').textContent=document.querySelector('#entry').value;});`}</script></body></html>`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('HTML execution profile is immutable and describes the actual unchanged Gate response CSP', async () => {
  assert.equal(HTML_EXECUTION_PROFILE_VERSION, 'production-html-execution-v1');
  assert.equal(HTML_EXECUTION_PROFILE.version, HTML_EXECUTION_PROFILE_VERSION);
  assert.equal(Object.isFrozen(HTML_EXECUTION_PROFILE), true);
  assert.equal(Object.isFrozen(HTML_EXECUTION_PROFILE.cspDirectives), true);
  assert.equal(Object.isFrozen(HTML_EXECUTION_PROFILE.localInputHandling), true);
  assert.equal(Object.isFrozen(HTML_EXECUTION_PROFILE.gateInteractions), true);
  assert.throws(() => Object.assign(HTML_EXECUTION_PROFILE, { nativeFormSubmission: 'allowed' }), TypeError);
  const gateSource = await readFile(new URL('../server/gate.ts', import.meta.url), 'utf8');
  const cspBlock = /const CSP = \[([\s\S]*?)\]\.join\('; '\);/.exec(gateSource)?.[1];
  assert.ok(cspBlock, 'Read the real Gate CSP, not a fixture copy');
  const directives = [...cspBlock.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(match => match[1] ?? match[2]);
  assert.deepEqual(directives, HTML_EXECUTION_PROFILE.cspDirectives);
  assert.equal(HTML_EXECUTION_PROFILE.nativeFormSubmission, 'disabled-before-submit-event');
  assert.equal(HTML_EXECUTION_PROFILE.networkRequests, 'denied');
  assert.equal(HTML_EXECUTION_PROFILE.navigation, 'denied');
  assert.ok(!directives.includes('sandbox allow-scripts allow-forms'));
  assert.match(gateSource, /route\.abort\('blockedbyclient'\)/);
});

test('actual HTML role contracts announce v9 execution facts and frozen content/control DOM ownership without changing camera scope', () => {
  assert.equal(PROMPT_VERSION, 'production-html-v10');
  const profile = contractProfile('offline-single-html');
  assert.equal(profile.promptVersion, PROMPT_VERSION);
  for (const [role, instruction] of Object.entries(profile.instructions)) {
    assert.equal(instruction, CONTRACT_INSTRUCTIONS[role as keyof typeof CONTRACT_INSTRUCTIONS]);
    assert.ok(instruction.includes(HTML_EXECUTION_INSTRUCTIONS), role);
    assert.ok(instruction.includes(HTML_DOM_CONTRACT_INSTRUCTIONS), role);
    assert.match(instruction, /submit事件触发前即被禁止/);
    assert.match(instruction, /type=button/);
    assert.match(instruction, /不能改选择器、测试或精确预期/);
    assert.match(instruction, /独立内容节点/);
    assert.doesNotMatch(instruction, /#todo-list|准备发布/);
  }
  const camera = contractProfile('camera-scene-v1');
  assert.equal(camera.promptVersion, 'production-camera-scene-v7');
  for (const instruction of Object.values(camera.instructions)) assert.equal(instruction.includes(HTML_EXECUTION_PROFILE_VERSION), false);
});

test('actual restricted Chromium rejects native submit but accepts explicit local click under the same frozen checks', { timeout: 45000 }, async t => {
  // Both pages are outer-authored engineering fixtures, not model output or
  // autonomous-delivery evidence. runGate owns real contexts/browser cleanup.
  const before = hash(checks);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const native = await runGate(fixture(true), structuredClone(checks), controller.signal);
  const local = await runGate(fixture(false), structuredClone(checks), controller.signal);
  t.diagnostic(JSON.stringify({ evidenceKind: 'engineering-fixture', modelRequests: 0, executionProfile: HTML_EXECUTION_PROFILE_VERSION, native, local }));
  assert.equal(native.failureKind, undefined, 'Infrastructure failure cannot establish the form boundary');
  assert.equal(native.checks.find(check => check.name === 'initial independent result')?.passed, true);
  assert.equal(native.checks.find(check => check.name === 'local interaction changes the result')?.passed, false);
  assert.equal(native.passed, false);
  assert.match(native.checks.find(check => check.name === 'local interaction changes the result')?.detail ?? '', /#result 文本不精确等于：sample/);
  assert.equal(local.failureKind, undefined);
  assert.equal(local.passed, true, JSON.stringify(local));
  assert.equal(local.checks.length, 3);
  assert.equal(hash(checks), before, 'Do not rewrite the frozen checks for either artifact');
});

test('cancelling this actual Gate closes its Chromium resource and does not create a passing result', { timeout: 15000 }, async t => {
  const originalLaunch = chromium.launch;
  const controller = new AbortController();
  let browser: Browser | undefined;
  let resolveLaunched!: () => void;
  let resolveClosed!: () => void;
  const launched = new Promise<void>(resolve => { resolveLaunched = resolve; });
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  t.after(async () => {
    controller.abort();
    chromium.launch = originalLaunch;
    if (cleanupTimer) clearTimeout(cleanupTimer);
    await browser?.close().catch(() => undefined);
  });
  chromium.launch = async options => {
    browser = await originalLaunch.call(chromium, options);
    browser.once('disconnected', resolveClosed);
    resolveLaunched();
    return browser;
  };
  const pending = runGate(fixture(false), [checks[0]!, { name: 'waiting for cancellation', steps: [{ action: 'assertVisible', selector: '#not-present' }] }, checks[1]!], controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await launched;
  controller.abort();
  await rejected;
  await Promise.race([closed, new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Cancelled Gate left Chromium connected')), 5000); })]);
  assert.equal(browser?.isConnected(), false);
});
