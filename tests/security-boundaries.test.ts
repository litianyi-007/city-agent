import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { CityStore, StoreError } from '../server/store.ts';
import { createApp } from '../server/index.ts';
import { assertPublicMetadataSafe, getResidentTemplates, residentCreateSchema, residentPublicSchema } from '../server/research/residents.ts';
import { getResearchTemplates } from '../server/research/templates.ts';
import { HarnessCallError, type runRole } from '../server/harness.ts';
import { planResearch, ResearchPlanningError } from '../server/research/planning.ts';
import { fingerprint } from '../shared/evidence.ts';
import { containsKnownSecret, redactKnownSecret } from '../shared/redaction.ts';
import { createDefaultPersona } from '../shared/resident-persona.ts';
import type { SurveyRun } from '../shared/survey-engine.ts';

const secret = 'boundary-private-key';
const mixed = `\\u0062${secret.slice(1)}`;
const unicode = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
function storeFixture(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-agent-security-test-'));
  const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory };
}
const candidate = () => ({ task: getResearchTemplates()[0], assumptions: ['fixture only'], clarifications: [], dataGaps: ['qualification denominator missing'] });
const config = { provider: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1:39997/v1', modelId: 'local-fixture', apiKey: secret };
const planningInput = { request: 'Synthetic planning fixture only', population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' as const }, maxQuestions: 12 };

test('role endpoint/provider edits clear inherited credentials unless explicitly resubmitted; normal edits and clones remain compatible', t => {
  const { store } = storeFixture(t);
  const original = store.createAgent({ name: 'Configured role', role: 'product', ...config });
  assert.equal(store.updateAgent(original.id, { name: 'Renamed role', modelId: 'another-model' }).hasApiKey, true);
  assert.equal(store.updateAgent(original.id, { baseUrl: config.baseUrl + '/' }).hasApiKey, true);
  const copy = store.cloneAgent(original.id);
  assert.equal(store.getAgent(copy.id, true)?.apiKey, secret);
  assert.equal(store.updateAgent(copy.id, { baseUrl: 'http://127.0.0.1:39998/v1' }).hasApiKey, false);
  assert.equal(store.getAgent(copy.id, true)?.apiKey, undefined);
  assert.equal(store.getAgent(original.id, true)?.apiKey, secret);
  assert.equal(store.updateAgent(original.id, { provider: 'anthropic' }).hasApiKey, false);
  const newSecret = 'explicit-new-fixture-key';
  assert.equal(store.updateAgent(original.id, { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:39999/v1', apiKey: newSecret }).hasApiKey, true);
  assert.equal(store.getAgent(original.id, true)?.apiKey, newSecret);
  assert.equal(store.updateAgent(original.id, { apiKey: null }).hasApiKey, false);
});

test('public metadata guard rejects known raw/encoded keys without changing input or rejecting ordinary credential lessons', t => {
  const { store } = storeFixture(t);
  const beforeRoles = store.getAgents();
  const beforeResidents = store.getResidentAgents();
  for (const leaked of [secret, mixed]) {
    assert.throws(() => store.createAgent({ name: leaked, role: 'researcher', apiKey: secret }), (error: unknown) => {
      assert.ok(error instanceof StoreError); assert.equal(error.statusCode, 400); assert.ok(!error.message.includes(secret)); return true;
    });
    assert.throws(() => store.createResidentAgent({ ...getResidentTemplates()[0], name: 'Rejected resident', description: leaked, apiKey: secret }), /公开配置.*凭据/);
  }
  const safe = store.createAgent({ name: 'Safe role', role: 'product', apiKey: secret });
  assert.throws(() => store.updateAgent(safe.id, { name: mixed }), /公开配置.*凭据/);
  const persona = createDefaultPersona(); persona.personality.customTraits.push({ label: 'Custom trait', description: mixed });
  assert.throws(() => store.createResidentAgent({ ...getResidentTemplates()[0], persona, apiKey: secret }), /公开配置.*凭据/);
  assert.throws(() => assertPublicMetadataSafe({ [mixed]: 'untrusted key name' }, [secret]), /凭据/);
  assert.doesNotThrow(() => assertPublicMetadataSafe({ title: 'Bearer 场景术语 sk-item' }, [secret]));
  assert.equal(store.getAgents().length, beforeRoles.length + 1);
  assert.deepEqual(store.getResidentAgents(), beforeResidents);
  assert.equal(store.getAgent(safe.id)?.name, 'Safe role');
  const legalNoKey = { title: 'Bearer 场景术语，以及短名称 sk-item', description: '未配置凭据的合法自由文本' };
  const untouched = structuredClone(legalNoKey);
  assert.doesNotThrow(() => assertPublicMetadataSafe(legalNoKey, []));
  assert.deepEqual(legalNoKey, untouched);
  const legacy = residentCreateSchema.parse(getResidentTemplates()[0]); delete legacy.persona;
  assert.equal(store.createResidentAgent(legacy).persona, undefined);
  assert.equal(store.createResidentAgent({ ...legacy, description: 'Bearer 场景术语 sk-item，不含实际密钥' }).description, 'Bearer 场景术语 sk-item，不含实际密钥');
});

test('precise secret detector covers raw/JSON/unicode/mixed/truncated keys but not safe Bearer examples or unrelated tokens', () => {
  for (const text of [secret, mixed, unicode, JSON.stringify({ value: mixed }), `{"partial":"${unicode}`, JSON.stringify({ [mixed]: 'value' })]) assert.equal(containsKnownSecret(text, secret), true);
  assert.equal(containsKnownSecret('Bearer tutorial-example sk-different-credential-123456', secret), false);
  assert.equal(containsKnownSecret(JSON.stringify({ description: 'Bearer 场景术语，认证教材示例' }), secret), false);
  assert.equal(containsKnownSecret(secret, ''), false);
  const knownSkKey = 'sk-actual-fixture-123456789';
  assert.equal(containsKnownSecret(JSON.stringify({ description: knownSkKey }), knownSkKey), true);
  assert.equal(containsKnownSecret(JSON.stringify({ number: 12345 }), '12345'), false);
});

test('drafts, survey evidence and role snapshots reject credentials before persistence, including unsafe legacy metadata', t => {
  const { store, directory } = storeFixture(t);
  const role = store.getAgents().find(agent => agent.role === 'product')!;
  store.updateAgent(role.id, { apiKey: secret });
  const ids = store.getAgents().map(agent => agent.id);
  const safeRun = store.createRun({ task: 'Bearer 场景术语，认证教材示例', mode: 'demo', agentIds: ids });
  assert.equal(safeRun.task, 'Bearer 场景术语，认证教材示例');
  assert.throws(() => store.createRun({ task: mixed, mode: 'demo', agentIds: ids }), /冻结快照.*凭据/);
  const task = getResearchTemplates()[0]; task.title = mixed;
  assert.throws(() => store.saveResearchProject({ task, residentAgentIds: [] }), /调查草稿.*凭据/);
  assert.deepEqual(store.listResearchProjects(), []);
  const survey = JSON.parse(readFileSync(new URL('../public/submission/sample-run.json', import.meta.url), 'utf8')) as SurveyRun;
  survey.task.title = mixed;
  assert.throws(() => store.saveSurveyRun(survey), /问卷运行证据.*凭据/);
  assert.deepEqual(store.listSurveyRuns(), []);
  const db = new DatabaseSync(path.join(directory, 'city-agent.sqlite'));
  t.after(() => db.close());
  const pollutedRun = structuredClone(safeRun); pollutedRun.agentSnapshot[0].name = mixed;
  db.prepare('UPDATE runs SET data = ? WHERE id = ?').run(JSON.stringify(pollutedRun), safeRun.id);
  assert.throws(() => store.getRunAgents(safeRun.id), /冻结智能体快照.*凭据/);
  assert.throws(() => store.getRun(safeRun.id), /运行证据.*凭据/);
  const row = db.prepare('SELECT data FROM agents WHERE id = ?').get(role.id) as { data: string };
  const polluted = JSON.parse(row.data); polluted.name = mixed;
  db.prepare('UPDATE agents SET data = ? WHERE id = ?').run(JSON.stringify(polluted), role.id);
  assert.throws(() => store.getAgents(), /公开配置.*凭据/);
  assert.throws(() => store.createRun({ task: 'Safe task text', mode: 'demo', agentIds: ids }), /冻结快照.*凭据/);
  assert.equal((db.prepare('SELECT count(*) AS n FROM runs').get() as { n: number }).n, 1);
  // Repair is explicit; neither reads nor failed writes silently alter history.
  assert.equal((JSON.parse((db.prepare('SELECT data FROM agents WHERE id = ?').get(role.id) as { data: string }).data)).name, mixed);
});

test('planner uses the shared sanitizer for every input/model field before hashes and records the exact adapter prompts', async () => {
  const input = { ...planningInput, request: `request ${unicode}`, context: `context ${mixed}`, population: { ...planningInput.population, regionCode: `region-${mixed}` } };
  const model = { ...config, modelId: `model-${mixed}`, baseUrl: `http://127.0.0.1:39997/${mixed}` };
  let sentSystem = ''; let sentUser = ''; let calls = 0;
  const result = await planResearch(input, model, new AbortController().signal, async (_agent, system, user) => {
    calls++; sentSystem = system; sentUser = user;
    assert.equal(redactKnownSecret(user, secret), user);
    const output = candidate(); output.task.population = { ...output.task.population, ...JSON.parse(user).population }; output.task.title = `response ${mixed}`;
    return { text: JSON.stringify(output), inputTokens: 1, outputTokens: 1, usageReported: true, harness: 'injected-only' };
  });
  const serialized = JSON.stringify(result);
  assert.equal(redactKnownSecret(serialized, secret), serialized);
  assert.equal(result.evidence.systemPrompt, sentSystem);
  assert.equal(result.evidence.userPrompt, sentUser);
  assert.equal(result.evidence.promptHash, fingerprint({ system: sentSystem, user: sentUser }));
  assert.equal(result.evidence.inputHash, fingerprint(result.evidence.input));
  assert.equal(result.evidence.modelConfigHash, fingerprint(result.evidence.model));
  assert.equal(result.evidence.input.request.includes('REDACTED'), true);
  assert.equal(result.evidence.model.modelId.includes('REDACTED'), true);
  assert.equal(calls, 1);
  assert.equal(input.request.includes(unicode), true); // Caller data was not changed.
  await assert.rejects(planResearch(planningInput, config, new AbortController().signal, async () => {
    throw new HarnessCallError(`injected failure ${unicode}`, { text: `{"partial":"${unicode}`, inputTokens: 2, outputTokens: 3 });
  }), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    const failed = JSON.stringify(error.evidence);
    assert.equal(redactKnownSecret(failed, secret), failed);
    assert.equal(error.evidence.inputTokens, 2); return true;
  });
});

test('actual HTTP rejects contaminated public config and planner JSON evidence/0600 records contain no reversible known key', async t => {
  const { store, directory } = storeFixture(t);
  let plannerCalls = 0; let starts = 0;
  const planner: typeof runRole = async () => { plannerCalls++; return { text: JSON.stringify(candidate()), inputTokens: 0, outputTokens: 0, harness: 'injected-only' }; };
  const server = createApp(store, { start() { starts++; }, cancel() {} }, planner).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (route: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const rejected = await post('/api/agents', { name: mixed, role: 'product', apiKey: secret });
  assert.equal(rejected.status, 400);
  const rejectedBody = await rejected.text(); assert.match(rejectedBody, /凭据/); assert.equal(redactKnownSecret(rejectedBody, secret), rejectedBody);
  const agent = store.createAgent({ name: 'Safe planner', role: 'researcher', ...config });
  const response = await post('/api/research/planning', { ...planningInput, request: `request ${unicode}`, context: `context ${mixed}`, agentId: agent.id, acknowledgeCost: true });
  assert.equal(response.status, 200);
  const text = await response.text(); assert.equal(redactKnownSecret(text, secret), text);
  const parsed = JSON.parse(text);
  const record = readFileSync(path.join(directory, 'planning', `${parsed.recordId}.json`), 'utf8');
  assert.equal(redactKnownSecret(record, secret), record);
  assert.equal(JSON.parse(record).result.evidence.input.request.includes('REDACTED'), true);
  assert.equal(plannerCalls, 1); assert.equal(starts, 0);
});

test('Pages rejects contaminated metadata/drafts atomically, retains session clone behavior, clears endpoint keys and rejects private imports', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>(); let failWrite = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => { if (failWrite) throw new Error('synthetic storage denial'); storage.set(name, value); },
  } });
  try {
    const { pagesApi, getBrowserModel } = await import('../src/pages-api.ts');
    // No Key: ordinary free text and old optional-persona imports stay lawful.
    const original: any[] = await pagesApi('/resident-agents');
    assert.equal(original.length, 4);
    const oldPresets = original.map(({ persona: _persona, ...value }) => value);
    storage.set('city-agent-pages-v1:residents', JSON.stringify(oldPresets));
    assert.equal((await pagesApi<any[]>('/resident-agents')).every(agent => agent.persona === undefined), true);
    const safe: any = await pagesApi('/resident-agents', 'POST', { ...getResidentTemplates()[0], name: 'Pages safe', ...config });
    const before = storage.get('city-agent-pages-v1:residents')!;
    assert.equal(before.includes(secret), false);
    await assert.rejects(pagesApi('/resident-agents', 'POST', { ...getResidentTemplates()[0], name: 'Rejected Pages', description: mixed, apiKey: secret }), /凭据/);
    await assert.rejects(pagesApi(`/resident-agents/${safe.id}`, 'PATCH', { description: unicode }), /凭据/);
    assert.equal(storage.get('city-agent-pages-v1:residents'), before);
    const task = getResearchTemplates()[0]; task.title = mixed;
    await assert.rejects(pagesApi('/projects', 'POST', { task, residentAgentIds: [safe.id] }), /调查草稿.*凭据/);
    assert.equal(storage.has('city-agent-pages-v1:projects'), false);
    failWrite = true;
    await assert.rejects(pagesApi(`/resident-agents/${safe.id}`, 'PATCH', { apiKey: 'not-committed-new-key' }), /存储不可写/);
    failWrite = false;
    assert.equal(getBrowserModel(safe.id).apiKey, secret);
    const clone: any = await pagesApi(`/resident-agents/${safe.id}/clone`, 'POST', {});
    assert.equal(getBrowserModel(clone.id).apiKey, secret);
    assert.equal((await pagesApi<any>(`/resident-agents/${safe.id}`, 'PATCH', { baseUrl: 'http://127.0.0.1:39998/v1' })).hasApiKey, false);
    assert.throws(() => getBrowserModel(safe.id), /填[写入].*API Key/);
    const saved = storage.get('city-agent-pages-v1:residents')!;
    const imported = JSON.parse(saved); imported[0].apiKey = 'private-import-field';
    assert.equal(residentPublicSchema.safeParse(imported[0]).success, false);
    storage.set('city-agent-pages-v1:residents', JSON.stringify(imported));
    await assert.rejects(pagesApi('/resident-agents'), /公开存档不能包含API Key/);
    assert.equal(storage.get('city-agent-pages-v1:residents'), JSON.stringify(imported));
    storage.set('city-agent-pages-v1:residents', saved);
    assert.equal((await pagesApi<any[]>('/resident-agents')).length, 6);
    assert.equal([...storage.values()].some(value => value.includes(secret)), false);
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
