import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { acceptanceSchema, runGate, type AcceptanceCheck } from '../server/gate.ts';

const interactiveHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>城市商品调研</title></head>
<body><h1>城市商品调研</h1><label>价格 <input id="price" value="20"></label><output id="demand">80</output>
<button id="report">生成报告</button><p id="status">等待调研</p>
<script>document.querySelector('#price').addEventListener('input',event=>document.querySelector('#demand').textContent=String(100-Number(event.target.value)));
document.querySelector('#report').onclick=()=>document.querySelector('#status').textContent='报告已生成';</script></body></html>`;

const checks: AcceptanceCheck[] = [
  { name: '价格影响需求', steps: [{ action: 'assertChanged', selector: '#demand', after: { action: 'fill', selector: '#price', value: '60' } }] },
  { name: '报告可生成', steps: [{ action: 'click', selector: '#report' }, { action: 'assertText', selector: '#status', text: '报告已生成' }] },
];

test('acceptance requires meaningful interaction and bounds declarations', () => {
  assert.equal(acceptanceSchema.safeParse(checks).success, true);
  assert.equal(acceptanceSchema.safeParse([
    { name: 'heading', steps: [{ action: 'assertVisible', selector: 'h1' }] },
    { name: 'button', steps: [{ action: 'click', selector: 'button' }, { action: 'assertVisible', selector: 'h1' }] },
  ]).success, false);
  assert.equal(acceptanceSchema.safeParse([checks[0]]).success, false);
  assert.equal(acceptanceSchema.safeParse(Array.from({ length: 13 }, () => checks[0])).success, false);
});

test('Chromium independently executes interactive acceptance on fresh pages', { timeout: 30_000 }, async () => {
  const result = await runGate(interactiveHtml, checks);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.checks.length, 3);
});

test('a fixed no-op price change fails behavioral acceptance', { timeout: 30_000 }, async () => {
  const fixed = interactiveHtml.replace("String(100-Number(event.target.value))", "'80'");
  const result = await runGate(fixed, checks);
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === '价格影响需求')?.passed, false);
});

test('bad JavaScript cannot pass the browser baseline', { timeout: 30_000 }, async () => {
  const broken = interactiveHtml.replace('<script>', '<script>this is not valid javascript ???;');
  const result = await runGate(broken, checks);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0]?.passed, false);
  assert.match(result.checks[0]?.detail ?? '', /JavaScript/);
});

test('network access is blocked even when generated HTML attempts it', { timeout: 30_000 }, async () => {
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end('secret'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const leaking = interactiveHtml.replace('<script>', `<script>fetch('http://127.0.0.1:${address.port}/').catch(()=>{});`);
    const result = await runGate(leaking, checks);
    assert.equal(result.passed, false);
    assert.equal(requests, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('abort closes active Chromium work instead of reporting success', { timeout: 30_000 }, async () => {
  const controller = new AbortController();
  const pending = runGate(interactiveHtml, [
    { name: 'never appears', steps: [{ action: 'assertVisible', selector: '#never' }] }, checks[1]!,
  ], controller.signal);
  const timer = setTimeout(() => controller.abort(), 300);
  try { await assert.rejects(pending, { name: 'AbortError' }); }
  finally { clearTimeout(timer); }
});
