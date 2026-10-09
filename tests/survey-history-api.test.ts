import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/index.ts';
import { CityStore } from '../server/store.ts';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { getResearchTemplates } from '../server/research/templates.ts';
import { getBusinessDemos } from '../shared/research-demo.ts';
import { executeSurvey } from '../shared/survey-runner.ts';
import { surveyRunSummary, type SurveyRun, type SurveyRunSummary } from '../shared/survey-engine.ts';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-survey-history-'));
  const store = new CityStore(directory);
  const server = createServer(createApp(store, { start() {}, cancel() {} }));
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
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { store, request };
}

const pricing = { currency: 'CNY' as const, inputPerMillion: null, outputPerMillion: null, suppliedAt: '', source: 'history-regression' };

test('survey list returns summaries and the full pack stays on the detail route', async t => {
  const { store, request } = await fixture(t);
  const pet = getBusinessDemos().find(demo => demo.id === 'pet-snacks')!;
  const child = getBusinessDemos().find(demo => demo.id === 'child-snacks')!;
  const population = getPopulationModel();
  const pack = getPopulationPack();
  const saved: SurveyRun[] = [];
  for (const demo of [pet, child]) {
    const run = await executeSurvey({
      task: demo.task, population, pack, presets: demo.presets.slice(0, 1), count: 12, seed: 42, mode: 'fixture', pricing,
      signal: new AbortController().signal, call: async () => { throw new Error('fixture must not call a model'); },
    });
    assert.equal(run.metrics.modelCalls, 0);
    assert.equal(run.metrics.valid, 12);
    assert.equal(run.metrics.contradictions, 0);
    assert.equal(run.logicAudit?.status, 'checked');
    store.saveSurveyRun(run);
    saved.push(run);
  }
  const listResponse = await request('/api/research/surveys');
  const listText = await listResponse.text();
  assert.equal(listResponse.status, 200);
  const detailResponse = await request(`/api/research/surveys/${saved[0].id}`);
  const detailText = await detailResponse.text();
  assert.equal(detailResponse.status, 200);
  assert.ok(detailText.length > 50_000, `detail ${detailText.length}`);
  assert.ok(listText.length * 10 < detailText.length, `list ${listText.length} detail ${detailText.length}`);
  const list = JSON.parse(listText) as SurveyRunSummary[];
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(item => item.id), [saved[1].id, saved[0].id]);
  for (const run of saved) assert.deepEqual(list.find(item => item.id === run.id), surveyRunSummary(run));
  assert.equal(list.every(item => !('responses' in item) && !('profiles' in item) && !('prompt' in item) && !('logicAudit' in item) && !('task' in item)), true);
  assert.equal(listText.includes('"responses"'), false);
  const detail = JSON.parse(detailText);
  assert.equal(detail.responses.length, 12);
  assert.equal(detail.logicAudit.status, 'checked');
  assert.equal(detail.metrics.valid, 12);
  assert.notDeepEqual(list.find(item => item.id === saved[0].id), detail);
  assert.equal((await request(`/api/research/surveys/${randomUUID()}`)).status, 404);
});

test('a missing resident preset is not reported as a missing key', async t => {
  const { store, request } = await fixture(t);
  const task = getResearchTemplates()[2];
  const preset = store.getResidentAgents()[0];
  assert.equal(preset.hasApiKey, false);
  assert.equal(preset.enabled, true);
  const body = (residentAgentIds: string[], mode: 'fixture' | 'live') => ({
    task, residentAgentIds, mode, count: 1, seed: 42, assumptionsAccepted: true, pricing,
  });
  const missing = randomUUID();
  for (const mode of ['fixture', 'live'] as const) {
    const response = await request('/api/research/surveys', 'POST', body([missing], mode));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, '所选人群预设不存在，请刷新后重新选择。');
    assert.equal(JSON.stringify(payload).includes('缺少Key'), false);
  }
  store.updateResidentAgent(preset.id, { enabled: false });
  const disabled = await request('/api/research/surveys', 'POST', body([preset.id], 'live'));
  assert.equal(disabled.status, 400);
  assert.equal((await disabled.json()).error, '所选人群预设未启用。');
  store.updateResidentAgent(preset.id, { enabled: true });
  const live = await request('/api/research/surveys', 'POST', body([preset.id], 'live'));
  assert.equal(live.status, 400);
  assert.equal((await live.json()).error, '所选预设缺少Key。');
  const started = await request('/api/research/surveys', 'POST', body([preset.id], 'fixture'));
  assert.equal(started.status, 202);
  const { id } = await started.json();
  for (let tick = 0; tick < 50 && store.getSurveyRun(id)?.state !== 'completed'; tick++) await new Promise(resolve => setTimeout(resolve, 20));
  const run = store.getSurveyRun(id);
  assert.equal(run?.state, 'completed');
  assert.equal(run?.metrics.modelCalls, 0);
});
