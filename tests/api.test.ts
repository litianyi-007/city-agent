import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createApp } from '../server/index.js';
import { CityStore } from '../server/store.js';
import type { Agent, Run, RunInput, Runner } from '../server/types.js';

async function fixture(t: TestContext, customRunner?: Runner, dataSubdirectory = '') {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'city-agent-api-test-'));
  const directory = path.join(temporaryRoot, dataSubdirectory);
  const store = new CityStore(directory);
  const started: Array<{ id: string; input: RunInput }> = [];
  const runner = customRunner ?? { start(id: string, input: RunInput) { started.push({ id, input }); }, cancel() {} };
  const server = createServer(createApp(store, runner));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (endpoint: string, options: RequestInit = {}) => fetch(`${baseUrl}${endpoint}`, {
    ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const runInput = (): RunInput => ({ task: '调研模拟城市人口的咖啡需求，交付可用页面。', mode: 'demo', agentIds: store.getAgents().map(agent => agent.id), product: '咖啡', price: 29, sampleSize: 120, seed: 42 });
  return { directory, store, started, request, runInput, baseUrl };
}

test('agent API keeps credentials encrypted, preserves omitted keys, and clones complete configuration', async t => {
  const { store, directory, request } = await fixture(t);
  const secret = 'test-secret-should-never-leave-server-12345';
  const response = await request('/api/agents', { method: 'POST', body: JSON.stringify({
    name: 'Research copy source', role: 'researcher', provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'local-test-model', apiKey: secret,
  }) });
  assert.equal(response.status, 201);
  const agent = await response.json() as Agent;
  assert.equal(agent.hasApiKey, true);
  assert.equal('apiKey' in agent, false);
  const edit = await request(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) });
  assert.equal(edit.status, 200);
  assert.equal(store.getAgent(agent.id, true)?.apiKey, secret);
  const clonedResponse = await request(`/api/agents/${agent.id}/clone`, { method: 'POST' });
  assert.equal(clonedResponse.status, 201);
  const clone = await clonedResponse.json() as Agent;
  assert.notEqual(clone.id, agent.id);
  assert.equal(clone.role, 'researcher');
  assert.equal(clone.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(clone.modelId, agent.modelId);
  assert.equal(clone.hasApiKey, true);
  assert.equal(store.getAgent(clone.id, true)?.apiKey, secret);
  assert.equal('apiKey' in clone, false);
  assert.equal((await (await request('/api/agents')).text()).includes(secret), false);
  assert.equal(statSync(path.join(directory, 'encryption.key')).mode & 0o777, 0o600);
  for (const file of readdirSync(directory)) {
    if (statSync(path.join(directory, file)).isFile()) assert.equal(readFileSync(path.join(directory, file)).includes(Buffer.from(secret)), false, file);
  }
  const cleared = await request(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ apiKey: null }) });
  assert.equal((await cleared.json() as Agent).hasApiKey, false);
  assert.equal(store.getAgent(agent.id, true)?.apiKey, undefined);
});

test('run snapshots retain original credentials internally after edits and never expose them', async t => {
  const { store, request, runInput, started } = await fixture(t);
  const source = store.getAgents()[0];
  const secret = 'snapshot-secret-123456';
  store.updateAgent(source.id, { apiKey: secret });
  const response = await request('/api/runs', { method: 'POST', body: JSON.stringify(runInput()) });
  assert.equal(response.status, 202);
  const run = await response.json() as Run;
  assert.deepEqual(run.input, runInput());
  assert.equal(run.agentSnapshot[0].hasApiKey, true);
  assert.equal(JSON.stringify(run).includes(secret), false);
  assert.equal(started[0].id, run.id);
  store.updateAgent(source.id, { apiKey: 'replacement-secret', modelId: 'replacement-model' });
  store.deleteAgent(source.id);
  assert.equal(store.getRunAgents(run.id, true)[0].apiKey, secret);
  assert.equal(store.getRunAgents(run.id, true)[0].modelId, 'deepseek-flash');
  run.stages[0].output = `Accidental model echo: ${secret}`;
  store.saveRun(run);
  const detail = await request(`/api/runs/${run.id}`);
  const text = await detail.text();
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('[REDACTED]'), true);
  assert.equal((await (await request('/api/runs')).text()).includes(secret), false);
});

test('API rejects missing role coverage, disabled agents, bad bounds, and unexpected fields', async t => {
  const { store, request, runInput, started } = await fixture(t);
  for (const body of [
    { ...runInput(), task: ' ' },
    { ...runInput(), sampleSize: 601 },
    { ...runInput(), sampleSize: 29 },
    { ...runInput(), price: -1 },
    { ...runInput(), mode: 'secret-live-mode' },
    { ...runInput(), agentIds: [] },
    { ...runInput(), apiKey: 'should-not-be-a-run-field' },
  ]) {
    assert.equal((await request('/api/runs', { method: 'POST', body: JSON.stringify(body) })).status, 400);
  }
  const validInput = runInput();
  const input = { ...validInput, agentIds: [...validInput.agentIds] };
  const duplicateRole = store.cloneAgent(input.agentIds[0]);
  input.agentIds[1] = duplicateRole.id;
  assert.equal((await request('/api/runs', { method: 'POST', body: JSON.stringify(input) })).status, 400);
  store.updateAgent(validInput.agentIds[0], { enabled: false });
  assert.equal((await request('/api/runs', { method: 'POST', body: JSON.stringify(validInput) })).status, 400);
  assert.equal(started.length, 0);
  assert.equal((await request('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'bad', role: 'developer', baseUrl: 'https://key:secret@example.test' }) })).status, 400);
  assert.equal((await request('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'bad', role: 'developer', baseUrl: 'file:///etc/passwd' }) })).status, 400);
  const unsupported = await request('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'bad', role: 'developer', temperature: 0.4 }) });
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json() as { error: string }).error, /不支持 temperature/);
});

test('only one submitted run can be active and normalized defaults are retained', async t => {
  const { store, request, runInput, started } = await fixture(t);
  const { product: _product, price: _price, sampleSize: _sampleSize, seed: _seed, ...minimal } = runInput();
  const responses = await Promise.all([
    request('/api/runs', { method: 'POST', body: JSON.stringify(minimal) }),
    request('/api/runs', { method: 'POST', body: JSON.stringify({ ...minimal, mode: 'live' }) }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
  assert.equal(started.length, 1);
  const accepted = responses.find(response => response.status === 202)!;
  const run = await accepted.json() as Run;
  assert.equal(run.input.product, 'AI 生活服务会员');
  assert.equal(run.input.price, 29);
  assert.equal(run.input.sampleSize, 120);
  assert.equal(run.input.seed, 42);
  run.status = 'failed';
  run.input.seed = 999;
  store.saveRun(run);
  assert.equal(store.getRun(run.id)?.input.seed, 42);
  assert.equal((await request('/api/runs', { method: 'POST', body: JSON.stringify(minimal) })).status, 202);
  assert.equal(started.length, 2);
});

test('API blocks cross-origin mutation and DNS rebinding hosts', async t => {
  const { request, baseUrl } = await fixture(t);
  assert.equal((await request('/api/agents', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: JSON.stringify({ name: 'bad', role: 'developer' }) })).status, 403);
  assert.equal((await request('/api/agents', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ name: 'bad', role: 'developer' }) })).status, 403);
  // Fetch normalizes Host, so use a raw HTTP request to exercise rebinding.
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = httpRequest(`${baseUrl}/api/health`, { headers: { Host: 'attacker.example:4310' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  assert.equal(rebindingStatus, 403);
  assert.equal((await request('/api/health', { headers: { Origin: 'http://localhost:5173' } })).status, 200);
});

test('artifact delivery only serves listed files within the run and sandboxes HTML', async t => {
  const { store, directory, request, runInput } = await fixture(t);
  const run = store.createRun(runInput());
  const runDirectory = store.runDir(run.id);
  writeFileSync(path.join(runDirectory, 'index.html'), '<!doctype html><h1>Fixture</h1>');
  writeFileSync(path.join(runDirectory, 'unlisted.txt'), 'private');
  writeFileSync(path.join(directory, 'private.txt'), 'private');
  symlinkSync(path.join(directory, 'private.txt'), path.join(runDirectory, 'linked.txt'));
  run.artifacts = [
    { name: 'index.html', path: 'index.html', type: 'text/html' },
    { name: 'escape.txt', path: '../../private.txt', type: 'text/plain' },
    { name: 'linked.txt', path: 'linked.txt', type: 'text/plain' },
  ];
  store.saveRun(run);
  const html = await request(`/api/runs/${run.id}/artifacts/index.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('Content-Security-Policy') || '', /sandbox allow-scripts/);
  assert.equal((html.headers.get('Content-Security-Policy') || '').includes('allow-same-origin'), false);
  assert.match(html.headers.get('Content-Disposition') || '', /^inline/);
  for (const name of ['unlisted.txt', 'escape.txt', 'linked.txt']) {
    assert.equal((await request(`/api/runs/${run.id}/artifacts/${name}`)).status, 404);
  }
});

test('artifacts in the default-style .city-agent directory remain readable without exposing private files', async t => {
  const { store, directory, request, runInput } = await fixture(t, undefined, '.city-agent');
  const run = store.createRun(runInput());
  const runDirectory = store.runDir(run.id);
  const page = '<!doctype html><html><head><title>Hidden directory regression</title></head><body>Usable demo</body></html>';
  writeFileSync(path.join(runDirectory, 'index.html'), page);
  symlinkSync(path.join(directory, 'encryption.key'), path.join(runDirectory, 'linked-key'));
  run.artifacts = [
    { name: 'index.html', path: 'index.html', type: 'text/html' },
    { name: 'escaped-key', path: '../../encryption.key', type: 'application/octet-stream' },
    { name: 'linked-key', path: 'linked-key', type: 'application/octet-stream' },
  ];
  store.saveRun(run);
  const html = await request(`/api/runs/${run.id}/artifacts/index.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('Content-Type') || '', /text\/html/);
  assert.match(html.headers.get('Content-Security-Policy') || '', /sandbox allow-scripts/);
  assert.match(html.headers.get('Content-Security-Policy') || '', /connect-src 'none'/);
  assert.equal((html.headers.get('Content-Security-Policy') || '').includes('allow-same-origin'), false);
  assert.equal(await html.text(), page);
  for (const name of ['encryption.key', 'escaped-key', 'linked-key']) {
    assert.equal((await request(`/api/runs/${run.id}/artifacts/${name}`)).status, 404);
  }
});

test('cancellation is persisted and ended runs cannot be cancelled again', async t => {
  const { store, request, runInput } = await fixture(t);
  const run = store.createRun(runInput());
  const response = await request(`/api/runs/${run.id}/cancel`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as Run).status, 'cancelled');
  assert.equal(store.getRun(run.id)?.status, 'cancelled');
  assert.equal((await request(`/api/runs/${run.id}/cancel`, { method: 'POST' })).status, 409);
});

test('restart marks pending work interrupted and preserves completed runs', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-recovery-test-'));
  let store: CityStore | undefined;
  try {
    store = new CityStore(directory);
    const input: RunInput = { task: 'Recovery test', mode: 'demo', agentIds: store.getAgents().map(agent => agent.id) };
    const queued = store.createRun(input);
    const running = store.createRun(input);
    running.status = 'running';
    running.stages[0].status = 'running';
    store.saveRun(running);
    const completed = store.createRun(input);
    completed.status = 'completed';
    store.saveRun(completed);
    store.close();
    store = new CityStore(directory);
    assert.equal(store.getRun(queued.id)?.status, 'interrupted');
    assert.equal(store.getRun(queued.id)?.input.sampleSize, 120);
    assert.equal(store.getRun(queued.id)?.input.product, 'AI 生活服务会员');
    assert.equal(store.getRun(running.id)?.status, 'interrupted');
    assert.equal(store.getRun(running.id)?.stages[0].status, 'failed');
    assert.equal(store.getRun(completed.id)?.status, 'completed');
    assert.equal(store.getAgents().length, 4);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a second server cannot interrupt work owned by a running process', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-owner-test-'));
  const store = new CityStore(directory);
  try {
    const run = store.createRun({ task: 'Active task', mode: 'demo', agentIds: store.getAgents().map(agent => agent.id) });
    run.status = 'running';
    store.saveRun(run);
    assert.throws(() => new CityStore(directory), /已有 City Agent 服务/);
    assert.equal(store.getRun(run.id)?.status, 'running');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an exited process leaves recoverable ownership and interrupted tasks', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-crash-test-'));
  let recovered: CityStore | undefined;
  try {
    const moduleUrl = new URL('../server/store.ts', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { CityStore } from ${JSON.stringify(moduleUrl)};
      const store = new CityStore(${JSON.stringify(directory)});
      store.createRun({task:'Crash fixture',mode:'demo',agentIds:store.getAgents().map(agent=>agent.id)});
      process.exit(0);
    `], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    recovered = new CityStore(directory);
    assert.equal(recovered.listRuns()[0].status, 'interrupted');
    assert.equal(recovered.listRuns()[0].input.product, 'AI 生活服务会员');
  } finally {
    recovered?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
