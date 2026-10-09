import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/index.ts';
import { CityStore } from '../server/store.ts';
import { getResearchTemplates } from '../server/research/templates.ts';
import { getPopulationPack } from '../server/population/service.ts';
import { hashPopulationPack } from '../server/population/model.ts';
import type { RoleResult, runRole } from '../server/harness.ts';

const secret = 'synthetic-api-planner-key-not-real';
function output() {
  return { task: getResearchTemplates()[0], assumptions: ['synthetic fixture only'], clarifications: ['需用户确认'], dataGaps: ['资格分母未知'] };
}
const modelResult = (text = JSON.stringify(output())): RoleResult => ({ text, inputTokens: 0, outputTokens: 0, harness: 'injected synthetic fixture' });

async function fixture(t: TestContext, planningRunner: typeof runRole = async () => modelResult()) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-next-api-'));
  const store = new CityStore(directory);
  let starts = 0;
  const server = createServer(createApp(store, { start() { starts++; }, cancel() {} }, planningRunner));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const agent = store.createAgent({ name: 'fixture researcher', role: 'researcher', provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', modelId: 'synthetic-model', apiKey: secret });
  const body = () => ({ agentId: agent.id, acknowledgeCost: true, request: '合成测试规划，不是实际市场调查。', population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' }, maxQuestions: 12 });
  const request = (route: string, data?: unknown, options: RequestInit = {}) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: data === undefined ? 'GET' : 'POST', ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  return { directory, store, agent, body, request, starts: () => starts };
}

async function until(predicate: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture deadline exceeded');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('planning model catalog is public and restricted to enabled product/researcher roles', async t => {
  const { request, store } = await fixture(t);
  store.createAgent({ name: 'disabled', role: 'product', enabled: false, apiKey: secret });
  const response = await request('/api/research/planning/agents');
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  const catalog = JSON.parse(text);
  assert.ok(catalog.length > 0);
  assert.ok(catalog.every((agent: { role: string; enabled: boolean }) => ['product', 'researcher'].includes(agent.role) && agent.enabled));
  assert.equal(catalog.some((agent: { apiKey?: string }) => 'apiKey' in agent), false);
});

test('one explicit planning call returns/persists sanitized candidate without resident or legacy execution', async t => {
  let calls = 0;
  const { request, body, directory, store, starts } = await fixture(t, async () => {
    calls++;
    const candidate = output(); candidate.task.title = `fixture ${secret}`;
    return modelResult(JSON.stringify(candidate));
  });
  const packHash = hashPopulationPack(getPopulationPack());
  const response = await request('/api/research/planning', { ...body(), request: `fixture ${secret}` });
  assert.equal(response.status, 200, await response.clone().text());
  const text = await response.text(); const result = JSON.parse(text);
  assert.equal(text.includes(secret), false);
  assert.equal(result.status, 'candidate');
  assert.equal(result.residentCalls, 0);
  assert.equal(result.evidence.execution, 'injected-runner');
  assert.equal(result.evidence.inputTokens, null);
  assert.equal(result.evidence.cost, null);
  assert.equal(result.preflight.marketResearchValidated, false);
  const filename = path.join(directory, 'planning', `${result.recordId}.json`);
  const saved = readFileSync(filename, 'utf8');
  assert.equal(saved.includes(secret), false);
  assert.equal(JSON.parse(saved).result.evidence.responseHash, result.evidence.responseHash);
  if (process.platform !== 'win32') assert.equal(statSync(filename).mode & 0o777, 0o600);
  assert.equal(calls, 1); assert.equal(starts(), 0);
  assert.deepEqual(store.listRuns(), []); assert.deepEqual(store.listSurveyRuns(), []); assert.deepEqual(store.listResearchProjects(), []);
  assert.equal(hashPopulationPack(getPopulationPack()), packHash);
});

test('no acknowledgement, missing key, disabled/wrong role, extra fields and cross-site input make zero calls', async t => {
  let calls = 0;
  const { request, body, store } = await fixture(t, async () => { calls++; return modelResult(); });
  const noKey = store.getAgents().find(agent => agent.role === 'researcher' && !agent.hasApiKey)!;
  const developer = store.createAgent({ name: 'wrong role', role: 'developer', apiKey: secret });
  const disabled = store.createAgent({ name: 'disabled', role: 'product', enabled: false, apiKey: secret });
  for (const bad of [
    { ...body(), acknowledgeCost: false }, { ...body(), acknowledgeCost: undefined }, { ...body(), apiKey: secret },
    { ...body(), agentId: noKey.id }, { ...body(), agentId: developer.id }, { ...body(), agentId: disabled.id },
    { ...body(), maxQuestions: 1.5 }, { ...body(), request: '' },
  ]) assert.equal((await request('/api/research/planning', bad)).status, 400);
  assert.equal((await request('/api/research/planning', body(), { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/research/planning', body(), { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls, 0);
});

test('malformed and fact-upgrade output fails once and persists redacted failure, never retries', async t => {
  let calls = 0;
  const { request, body, directory, store } = await fixture(t, async () => { calls++; return modelResult(`malformed ${secret}`); });
  const response = await request('/api/research/planning', body());
  assert.equal(response.status, 422);
  const text = await response.text(); const failure = JSON.parse(text);
  assert.equal(text.includes(secret), false);
  assert.equal(failure.evidence.state, 'failed');
  assert.equal(failure.recorded, true);
  assert.equal(readFileSync(path.join(directory, 'planning', `${failure.recordId}.json`), 'utf8').includes(secret), false);
  assert.equal(calls, 1); assert.deepEqual(store.listSurveyRuns(), []);
});

test('planning concurrency is bounded and rejected second call cannot invoke runner', async t => {
  let calls = 0; let release!: (result: RoleResult) => void;
  const { request, body } = await fixture(t, async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = request('/api/research/planning', body());
  await until(() => calls === 1);
  assert.equal((await request('/api/research/planning', body())).status, 409);
  assert.equal(calls, 1);
  release(modelResult());
  assert.equal((await first).status, 200);
});

test('HTTP client cancellation reaches planner signal and persists cancellation without retry', async t => {
  let calls = 0; let cancelled = false;
  const { request, body, directory } = await fixture(t, async (_agent, _system, _user, signal) => {
    calls++;
    return await new Promise<RoleResult>((_resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new DOMException('synthetic cancelled', 'AbortError')); }, { once: true }));
  });
  const controller = new AbortController();
  const pending = request('/api/research/planning', body(), { signal: controller.signal });
  const rejected = assert.rejects(pending, /abort/i);
  await until(() => calls === 1);
  controller.abort(); await rejected;
  await until(() => cancelled);
  await until(() => {
    try { return readdirSync(path.join(directory, 'planning')).length === 1; } catch { return false; }
  });
  const files = readdirSync(path.join(directory, 'planning'));
  const saved = JSON.parse(readFileSync(path.join(directory, 'planning', files[0]), 'utf8'));
  assert.equal(saved.evidence.state, 'cancelled'); assert.equal(calls, 1);
});

test('in-flight planning cancel aborts the runner, returns no candidate, and releases the slot', async t => {
  let calls = 0;
  const cancelId = '33333333-3333-4333-8333-333333333333';
  const unknownId = '44444444-4444-4444-8444-444444444444';
  const { request, body, directory } = await fixture(t, async (_agent, _system, _user, signal) => {
    calls++;
    if (calls === 1) {
      return await new Promise<RoleResult>((_resolve, reject) => {
        const abort = () => reject(new DOMException('synthetic cancelled', 'AbortError'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
    return modelResult();
  });
  let settled = false;
  const pending = request('/api/research/planning', { ...body(), cancelId }).then(response => { settled = true; return response; });
  await until(() => calls === 1);
  assert.equal((await request('/api/research/planning/cancel', { cancelId: unknownId })).status, 409);
  assert.equal(settled, false);
  assert.equal(calls, 1);
  const cancel = await request('/api/research/planning/cancel', { cancelId });
  assert.equal(cancel.status, 200);
  assert.deepEqual(await cancel.json(), { cancelled: true, cancelId });
  const response = await pending;
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.evidence.state, 'cancelled');
  assert.equal(Object.hasOwn(payload, 'task'), false);
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(calls, 1);
  const saved = JSON.parse(readFileSync(path.join(directory, 'planning', `${payload.recordId}.json`), 'utf8'));
  assert.equal(saved.evidence.state, 'cancelled');
  assert.equal(saved.result, undefined);
  assert.equal((await request('/api/research/planning/cancel', { cancelId })).status, 409);
  const again = await request('/api/research/planning', body());
  assert.equal(again.status, 200, await again.clone().text());
  assert.equal((await again.json()).status, 'candidate');
  assert.equal(calls, 2);
});

test('idle planning cancel and malformed cancel ids make zero model calls', async t => {
  let calls = 0;
  const { request } = await fixture(t, async () => { calls++; return modelResult(); });
  assert.equal((await request('/api/research/planning/cancel', { cancelId: '55555555-5555-4555-8555-555555555555' })).status, 409);
  assert.equal((await request('/api/research/planning/cancel', {})).status, 400);
  assert.equal((await request('/api/research/planning/cancel', { cancelId: 'not-a-uuid' })).status, 400);
  assert.equal((await request('/api/research/planning/cancel', { cancelId: '66666666-6666-4666-8666-666666666666', extra: true })).status, 400);
  assert.equal(calls, 0);
});

test('business evidence audit API never activates data or starts models and empty template remains needs-data', async t => {
  let calls = 0;
  const { request, store, starts } = await fixture(t, async () => { calls++; return modelResult(); });
  const packHash = hashPopulationPack(getPopulationPack());
  const templateResponse = await request('/api/research/business-evidence/template');
  assert.equal(templateResponse.status, 200);
  const pack = await templateResponse.json();
  const response = await request('/api/research/business-evidence/validate', { pack });
  assert.equal(response.status, 200);
  const audit = await response.json();
  assert.equal(audit.status, 'needs-data');
  assert.equal(audit.manualSourceVerificationNeeded, true);
  assert.equal(audit.automaticRecommendationsAllowed, false);
  assert.equal(audit.populationPublicationAllowed, false);
  assert.equal((await request('/api/research/business-evidence/validate', { pack, extra: 'forbidden' })).status, 400);
  const invalid = await request('/api/research/business-evidence/validate', { pack: { garbage: true } });
  assert.equal((await invalid.json()).status, 'invalid');
  assert.equal(calls, 0); assert.equal(starts(), 0);
  assert.deepEqual(store.listRuns(), []); assert.deepEqual(store.listSurveyRuns(), []);
  assert.equal(hashPopulationPack(getPopulationPack()), packHash);
});

test('configured local web origin is accepted while arbitrary local port and opaque origin are denied', async t => {
  const previous = process.env.CITY_AGENT_WEB_PORT;
  try {
    process.env.CITY_AGENT_WEB_PORT = '5188';
    const { request } = await fixture(t);
    assert.equal((await request('/api/health', undefined, { headers: { Origin: 'http://localhost:5188' } })).status, 200);
    assert.equal((await request('/api/health', undefined, { headers: { Origin: 'http://localhost:5189' } })).status, 403);
    assert.equal((await request('/api/health', undefined, { headers: { Origin: 'null' } })).status, 403);
  } finally {
    if (previous === undefined) delete process.env.CITY_AGENT_WEB_PORT; else process.env.CITY_AGENT_WEB_PORT = previous;
  }
});
