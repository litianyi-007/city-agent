import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/index.js';
import { getPopulationPack } from '../server/population/service.js';
import { hashPopulationPack } from '../server/population/model.js';
import { CityStore } from '../server/store.js';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-research-api-'));
  const store = new CityStore(directory);
  let starts = 0;
  const server = createServer(createApp(store, { start() { starts++; }, cancel() {} }));
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
  return {
    store,
    starts: () => starts,
    request: (route: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  };
}

/** Deliberately not one of the shipped scenario templates. */
function unseenTask() {
  return {
    schemaVersion: '1.0', id: 'shared-tools-holdout', title: '社区共享工具租赁需求', objective: 'demand-validation',
    decisionContext: { offering: '假设社区共享工具租赁服务', buyer: '60岁及以上潜在租赁者', endUser: '租赁者本人', channel: '假设社区服务点' },
    population: {
      regionCode: 'binjiang', period: '2020-11-01', unit: 'person',
      filters: [{ field: 'age', op: 'gte', value: 60 }],
    },
    questionnaire: {
      id: 'shared-tools-questionnaire', version: '1',
      questions: [{
        id: 'interest', type: 'single', prompt: '在给定租赁条件下，是否愿意尝试共享工具服务？', required: true,
        options: [{ id: 'yes', label: '愿意' }, { id: 'no', label: '不愿意' }],
      }],
    },
    declarations: [], requestedOutputs: ['questionnaire-review', 'synthetic-analysis'],
  };
}

test('research templates are editable input data and are not executable or completed surveys', async t => {
  const { request, starts, store } = await fixture(t);
  const response = await request('/api/research/templates');
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.schemaVersion, '1.0');
  assert.equal(catalog.stage, 'preflight');
  assert.equal(catalog.executorAvailable, false);
  assert.equal(catalog.templates.length, 3);
  for (const task of catalog.templates) {
    const validation = await request('/api/research/validate', task);
    assert.equal(validation.status, 200, JSON.stringify(await validation.clone().json()));
    const result = await validation.json();
    assert.equal(result.executorAvailable, false);
    assert.equal(result.modelCalls, 0);
    assert.equal(result.marketResearchValidated, false);
    assert.match(result.taskHash, /^[a-f0-9]{64}$/);
    assert.match(result.populationHash, /^[a-f0-9]{64}$/);
  }
  assert.equal(starts(), 0);
  assert.deepEqual(store.listRuns(), []);
});

test('unseen questionnaire preflight has a positive ready path without case keywords or run creation', async t => {
  const { request, starts, store } = await fixture(t);
  const populationHash = hashPopulationPack(getPopulationPack());
  const agents = store.getAgents();
  const response = await request('/api/research/validate', unseenTask());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.populationHash, populationHash);
  assert.equal(result.executorAvailable, false);
  assert.equal(result.marketResearchValidated, false);
  assert.equal(result.modelCalls, 0);
  assert.equal('responses' in result, false);
  assert.equal('populationCount' in result, false);
  assert.equal(starts(), 0);
  assert.deepEqual(store.listRuns(), []);
  assert.deepEqual(store.getAgents(), agents);
  assert.equal(hashPopulationPack(getPopulationPack()), populationHash);
});

test('qualification and time gaps stay explicit instead of falling back to the generic price fixture', async t => {
  const { request, starts } = await fixture(t);
  for (const population of [
    { ...unseenTask().population, filters: [{ field: 'age', op: 'gte', value: 18 }] },
    { ...unseenTask().population, filters: [{ field: 'caregiver', op: 'eq', value: true }] },
    { ...unseenTask().population, filters: [{ field: 'pet_owner', op: 'eq', value: true }] },
    { ...unseenTask().population, unit: 'household' },
    { ...unseenTask().population, period: '2026-09-23' },
  ]) {
    const response = await request('/api/research/validate', { ...unseenTask(), population });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'needs-data', JSON.stringify(result));
    assert.ok(result.missingEvidence.length > 0);
    assert.equal(result.marketResearchValidated, false);
    assert.equal('responses' in result, false);
  }
  assert.equal(starts(), 0);
});

test('research API rejects invalid contracts, unexpected credential fields and cross-site requests', async t => {
  const { request, starts } = await fixture(t);
  const original = unseenTask();
  const duplicateQuestion = { ...original, questionnaire: { ...original.questionnaire, questions: [...original.questionnaire.questions, ...original.questionnaire.questions] } };
  for (const task of [
    {}, { ...original, apiKey: 'must-not-be-accepted' }, duplicateQuestion,
    { task: '不面向儿童的成人零食；小学附近的宠物店' },
    { ...original, questionnaire: { ...original.questionnaire, questions: [] } },
    { ...original, title: ' ' },
  ]) {
    const response = await request('/api/research/validate', task);
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes('must-not-be-accepted'), false);
  }
  assert.equal((await request('/api/research/validate', original, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/research/validate', original, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(starts(), 0);
});

test('declared unsupported outputs remain explicit and research contracts cannot start the legacy runner', async t => {
  const { request, store, starts } = await fixture(t);
  const task = { ...unseenTask(), requestedOutputs: ['questionnaire-review', 'site-recommendation', 'deploy'] };
  const response = await request('/api/research/validate', task);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.allowedOutputs, ['questionnaire-review']);
  assert.equal(result.semanticValidation, 'not-performed');
  assert.equal(result.executorAvailable, false);
  assert.equal((await request('/api/runs', task)).status, 400);
  assert.equal(starts(), 0);
  assert.deepEqual(store.listRuns(), []);
});

test('research HTTP preflight blocks damaged population evidence without exposing a ready frame', () => {
  // Isolate an in-memory read fault in a child process. The official source
  // bytes on disk and concurrent tests are never modified.
  const script = `
    import fs from 'node:fs/promises';
    import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { createServer } from 'node:http';
    import { once } from 'node:events';
    import os from 'node:os';
    import path from 'node:path';
    const originalRead = fs.readFile;
    fs.readFile = async function(file, ...args) {
      const value = await originalRead.call(this, file, ...args);
      return String(file).endsWith('/binjiang-census-yearbook.pdf') ? Buffer.from('corrupt test bytes') : value;
    };
    syncBuiltinESMExports();
    const { createApp } = await import('./server/index.ts');
    const { CityStore } = await import('./server/store.ts');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-research-integrity-'));
    const store = new CityStore(directory);
    let starts = 0;
    const server = createServer(createApp(store, { start() { starts++; }, cancel() {} }));
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/research/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: readFileSync(0, 'utf8'),
      });
      console.log(JSON.stringify({ httpStatus: response.status, body: await response.json(), starts, runs: store.listRuns().length }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), input: JSON.stringify(unseenTask()), encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.status, 'blocked');
  assert.equal(result.body.code, 'population-evidence-unavailable');
  assert.equal(result.body.executorAvailable, false);
  assert.equal(result.body.marketResearchValidated, false);
  assert.equal(result.starts, 0);
  assert.equal(result.runs, 0);
  assert.equal('populationCount' in result.body, false);
});
