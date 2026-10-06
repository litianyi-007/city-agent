import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/index.js';
import { CityStore } from '../server/store.js';
import { getResidentTemplates, type ResidentAgentInput } from '../server/research/residents.js';
import { getResearchTemplates } from '../server/research/templates.js';
import { researchTaskSchema as sharedSchema } from '../shared/research-schema.js';
import { researchTaskSchema as serverSchema } from '../server/research/contract.js';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-residents-'));
  const store = new CityStore(directory);
  let starts = 0;
  const server = createServer(createApp(store, { start() { starts++; }, cancel() {} }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { store, directory, baseUrl: `http://127.0.0.1:${address.port}`, starts: () => starts,
    request: (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}/api${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  };
}

const input = (): ResidentAgentInput => ({ ...getResidentTemplates()[2], name: '独立养猫预设', apiKey: 'resident-secret-not-a-real-key-12345' });
const draft = (residentAgentIds: string[] = []) => ({ task: getResearchTemplates()[2], residentAgentIds });

test('four resident presets seed once, stay separate from engineering roles, and survive restart', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-resident-reopen-'));
  const store = new CityStore(directory);
  const before = store.getResidentAgents(); assert.equal(before.length, 4); assert.equal(store.getAgents().length, 4);
  const resident = store.createResidentAgent(input());
  const project = store.saveResearchProject(draft([resident.id]));
  store.close();
  const reopened = new CityStore(directory);
  t.after(() => { reopened.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(reopened.getResidentAgents().length, 5);
  assert.deepEqual(reopened.getResidentAgents().slice(0, 4), before);
  assert.equal(reopened.getResidentAgent(resident.id, true)?.apiKey, input().apiKey);
  assert.deepEqual(reopened.listResearchProjects(), [project]);
  assert.equal(reopened.getAgents().length, 4);
});

test('resident credentials are encrypted and never returned by public CRUD', async t => {
  const { request, directory, store } = await fixture(t);
  const created = await request('/research/resident-agents', 'POST', input()); assert.equal(created.status, 201);
  const agent = await created.json();
  assert.equal(agent.hasApiKey, true); assert.equal(agent.kind, 'resident-agent-preset'); assert.equal(agent.apiKey, undefined);
  const list = await (await request('/research/resident-agents')).json();
  assert.ok(!JSON.stringify(list).includes(input().apiKey as string));
  assert.ok(!JSON.stringify(list).includes('"secret"'));
  assert.equal(store.getResidentAgent(agent.id, true)?.apiKey, input().apiKey);
  for (const name of readdirSync(directory).filter(name => name.includes('sqlite'))) {
    assert.ok(!readFileSync(path.join(directory, name)).includes(Buffer.from(input().apiKey as string)), name);
  }
});

test('metadata patch retains key; explicit clear and endpoint changes remove it', async t => {
  const { request, store } = await fixture(t);
  const agent = store.createResidentAgent(input());
  assert.equal((await request(`/research/resident-agents/${agent.id}`, 'PATCH', { name: '改名' })).status, 200);
  assert.equal(store.getResidentAgent(agent.id, true)?.apiKey, input().apiKey);
  assert.equal((await request(`/research/resident-agents/${agent.id}`, 'PATCH', { baseUrl: 'https://example.test/v1' })).status, 200);
  assert.equal(store.getResidentAgent(agent.id)?.hasApiKey, false);
  store.updateResidentAgent(agent.id, { apiKey: 'replacement-secret' });
  const cleared = await request(`/research/resident-agents/${agent.id}`, 'PATCH', { apiKey: null });
  assert.equal((await cleared.json()).hasApiKey, false);
  store.updateResidentAgent(agent.id, { apiKey: 'replacement-secret' });
  store.updateResidentAgent(agent.id, { provider: 'openai-compatible' });
  assert.equal(store.getResidentAgent(agent.id)?.hasApiKey, false);
  store.updateResidentAgent(agent.id, { baseUrl: 'https://other.example.test', apiKey: 'explicit-new-secret' });
  assert.equal(store.getResidentAgent(agent.id, true)?.apiKey, 'explicit-new-secret');
});

test('clone creates independent public configuration and freshly encrypted credentials', async t => {
  const { request, directory, store } = await fixture(t);
  const agent = store.createResidentAgent(input());
  const response = await request(`/research/resident-agents/${agent.id}/clone`, 'POST', {}); assert.equal(response.status, 201);
  const copy = await response.json(); assert.notEqual(copy.id, agent.id); assert.equal(copy.hasApiKey, true);
  assert.deepEqual(copy.population, agent.population); assert.deepEqual(copy.assumptions, agent.assumptions);
  const db = new DatabaseSync(path.join(directory, 'city-agent.sqlite'), { readOnly: true });
  try {
    const first = db.prepare('SELECT secret FROM resident_agents WHERE id = ?').get(agent.id);
    const second = db.prepare('SELECT secret FROM resident_agents WHERE id = ?').get(copy.id);
    assert.notEqual(first?.secret, second?.secret);
  } finally { db.close(); }
  store.updateResidentAgent(agent.id, { apiKey: null, description: '原件修改' });
  assert.equal(store.getResidentAgent(copy.id, true)?.apiKey, input().apiKey);
  assert.notEqual(store.getResidentAgent(copy.id)?.description, '原件修改');
  assert.equal((await request(`/research/resident-agents/${copy.id}/clone`, 'POST', { hasApiKey: true })).status, 400);
});

test('strict resident inputs reject forged evidence, metadata, secrets-in-url and invalid patches atomically', async t => {
  const { request, store } = await fixture(t);
  for (const patch of [{ role: 'researcher' }, { status: 'ready' }, { hasApiKey: true }, { representedPopulation: 1000 },
    { templateId: 'unknown' }, { provenance: 'fact' }, { memoryEnabled: true }, { temperature: 0.5 },
    { baseUrl: 'https://user:secret@example.test' }, { baseUrl: 'https://example.test?key=secret' },
    { baseUrl: 'file:///tmp/data' }, { baseUrl: 'https://example.test#secret' },
    { assumptions: [{ claim: 'real buyer', provenance: 'fact' }] },
    { population: { ...input().population, verified: true } },
  ]) {
    assert.equal((await request('/research/resident-agents', 'POST', { ...input(), ...patch })).status, 400, JSON.stringify(patch));
  }
  const agent = store.createResidentAgent(input());
  for (const patch of [{}, { population: { regionCode: 'binjiang' } }, { apiKey: 12 }]) {
    assert.equal((await request(`/research/resident-agents/${agent.id}`, 'PATCH', patch)).status, 400);
    assert.deepEqual(store.getResidentAgent(agent.id), agent);
  }
  assert.throws(() => store.createResidentAgent({ ...input(), verified: true } as ResidentAgentInput));
});

test('resident IDs cannot be used as engineering agents or trigger the legacy runner', async t => {
  const { request, store, starts } = await fixture(t);
  const resident = store.getResidentAgents()[0]; const engineering = store.getAgents()[0];
  assert.equal((await request(`/research/resident-agents/${engineering.id}`, 'PATCH', { name: 'no' })).status, 404);
  assert.equal((await request(`/agents/${resident.id}`, 'PATCH', { name: 'no' })).status, 404);
  const run = await request('/runs', 'POST', { task: '隔离检查', mode: 'demo', agentIds: [resident.id, ...store.getAgents().slice(1).map(agent => agent.id)] });
  assert.equal(run.status, 400); assert.equal(starts(), 0); assert.equal(store.listRuns().length, 0);
});

test('projects save drafts only, update and reload, reject unknown references and forged status', async t => {
  const { request, store, starts } = await fixture(t);
  const resident = store.getResidentAgents()[0];
  const response = await request('/research/projects', 'POST', draft([resident.id])); assert.equal(response.status, 201);
  const saved = await response.json(); assert.equal(saved.stage, 'draft'); assert.equal(saved.status, undefined);
  assert.equal((await request(`/research/resident-agents/${resident.id}`, 'DELETE')).status, 409);
  const updated = await request(`/research/projects/${saved.id}`, 'PUT', { ...draft(), task: { ...draft().task, title: '更改后的标题' } });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).id, saved.id);
  assert.equal((await (await request('/research/projects')).json())[0].task.title, '更改后的标题');
  assert.equal((await request(`/research/resident-agents/${resident.id}`, 'DELETE')).status, 204);
  assert.equal((await request('/research/projects', 'POST', draft([resident.id]))).status, 400);
  assert.equal((await request('/research/projects', 'POST', { ...draft(), executorAvailable: true })).status, 400);
  assert.equal(starts(), 0); assert.equal(store.listRuns().length, 0);
});

test('preflight checks each preset intersection and preserves missing evidence despite saved keys', async t => {
  const { request, store, starts } = await fixture(t);
  const resident = store.createResidentAgent(input());
  const response = await request('/research/projects/validate', 'POST', draft([resident.id])); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.taskCheck.status, 'ready');
  assert.equal(result.residents[0].status, 'needs-data');
  assert.ok(result.residents[0].missingEvidence.some((entry: string) => entry.includes('petOwner')));
  assert.equal(result.residents[0].modelConfigured, true);
  assert.equal(result.executorAvailable, false); assert.equal(result.modelCalls, 0); assert.equal(result.marketResearchValidated, false);
  assert.equal(starts(), 0); assert.equal(store.listResearchProjects().length, 0);
  assert.ok(!JSON.stringify(result).includes(input().apiKey as string));
});

test('preflight reports incompatible frames, disabled presets, no selection and unsupported outputs', async t => {
  const { request, store } = await fixture(t);
  const resident = store.createResidentAgent({ ...input(), enabled: false, population: { ...input().population, regionCode: 'another-region' } });
  const result = await (await request('/research/projects/validate', 'POST', draft([resident.id]))).json();
  assert.ok(result.residents[0].missingEvidence.some((entry: string) => entry.includes('不一致')));
  assert.ok(result.executionBlockers.some((entry: string) => entry.includes('停用')));
  const empty = await (await request('/research/projects/validate', 'POST', draft())).json();
  assert.ok(empty.executionBlockers.some((entry: string) => entry.includes('尚未选择')));
  const unsupported = await (await request('/research/projects/validate', 'POST', { ...draft(), task: { ...draft().task, requestedOutputs: ['site-recommendation'] } })).json();
  assert.equal(unsupported.taskCheck.status, 'unsupported');
});

test('resident CRUD inherits origin, host and request validation', async t => {
  const { request, baseUrl } = await fixture(t);
  assert.equal((await request('/research/resident-agents', 'POST', input(), { Origin: 'https://evil.example' })).status, 403);
  // Node fetch normalizes Host; use raw HTTP to exercise the actual rebinding guard.
  const rebinding = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = httpRequest(`${baseUrl}/api/research/projects`, { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    outgoing.on('error', reject); outgoing.end(JSON.stringify(draft()));
  });
  assert.equal(rebinding, 403);
  assert.equal((await request('/research/projects', 'POST', draft(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/research/projects/validate', 'POST', draft(['bad-id']))).status, 400);
  assert.equal((await request('/research/projects/validate', 'POST', { ...draft(), task: { ...draft().task, persona: 'forged' } })).status, 400);
});

test('shared browser questionnaire schema is exactly the server schema, with stable template IDs', () => {
  assert.equal(sharedSchema, serverSchema);
  for (const task of getResearchTemplates()) assert.deepEqual(sharedSchema.parse(task), task);
});
