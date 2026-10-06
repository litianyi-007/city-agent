import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/index.ts';
import { CityStore } from '../server/store.ts';
import { getPopulationPack } from '../server/population/service.ts';
import { hashPopulationPack, type CompiledPopulation, type RegionPack } from '../server/population/model.ts';

async function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'city-population-api-'));
  const store = new CityStore(root);
  const server = createServer(createApp(store, { start() {}, cancel() {} }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    rmSync(root, { recursive: true });
  });
  return {
    root, store,
    request: (url: string, body?: unknown) => fetch(`http://127.0.0.1:${address.port}${url}`, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  };
}

test('population HTTP overview serves auditable census model and separate recent evidence without agent credentials', async (t) => {
  const { store, request } = await fixture(t);
  const secret = 'population-endpoint-must-not-disclose-this-key';
  store.updateAgent(store.getAgents()[0].id, { apiKey: secret });
  const response = await request('/api/population');
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  const overview = JSON.parse(text);
  assert.equal(overview.status, 'ready');
  assert.equal(overview.model.population, 503859);
  assert.equal(overview.model.eligiblePopulation, 434827);
  assert.equal(overview.model.period, '2020-11-01');
  assert.equal(overview.model.cells.length, 24);
  assert.ok(overview.sourceFiles.length >= 6);
  assert.ok(overview.sourceFiles.every((check: { passed: boolean }) => check.passed));
  assert.ok(overview.recent.sources.some((source: { id: string }) => source.id === 'binjiang-2025-communique'));
  assert.equal(overview.model.datasetHash, hashPopulationPack(getPopulationPack()));
  const model = await (await request('/api/population/model')).json() as CompiledPopulation;
  assert.equal(model.datasetHash, overview.model.datasetHash);
  const pack = await (await request('/api/population/pack')).json() as RegionPack;
  assert.equal(pack.observations.length, 28);
  assert.ok(pack.observations.some((row) => row.derivation?.operation === 'subtract'));
  const city = await (await request('/api/city')).json();
  assert.equal(city.datasetHash, overview.model.datasetHash);
  assert.equal(city.population, model.population);
});

test('population intake validates in isolation and leaves the active dataset unchanged', async (t) => {
  const { request } = await fixture(t);
  const active = getPopulationPack();
  const valid = structuredClone(active);
  valid.id = 'candidate-region';
  const good = await request('/api/population/validate', valid);
  assert.equal(good.status, 200);
  const report = await good.json();
  assert.equal(report.status, 'ready');
  assert.equal(report.datasetHash, hashPopulationPack(valid));
  const template = await (await request('/api/population/template')).json() as RegionPack;
  assert.deepEqual(template.observations, []);
  assert.equal((await (await request('/api/population/validate', template)).json()).status, 'blocked');
  const mixed = structuredClone(valid);
  mixed.observations[0].period = '2025-12-31';
  const blocked = await (await request('/api/population/validate', mixed)).json();
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.audit.checks.find((check: { id: string }) => check.id === 'same-basis').passed, false);
  assert.equal((await (await request('/api/population/validate', { apiKey: 'invalid' })).json()).status, 'blocked');
  assert.deepEqual(await (await request('/api/population/pack')).json(), active);
});

test('population downloads only serve registered evidence, force attachment, and match source bytes', async (t) => {
  const { request } = await fixture(t);
  const pack = getPopulationPack();
  for (const id of [pack.sources[0].id, 'binjiang-2025-communique']) {
    const response = await request(`/api/population/sources/${id}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Disposition') || '', /^attachment;/);
    assert.match(response.headers.get('Content-Security-Policy') || '', /sandbox/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    if (id === pack.sources[0].id) assert.equal(createHash('sha256').update(bytes).digest('hex'), pack.sources[0].sha256);
  }
  for (const id of ['encryption.key', 'unknown', encodeURIComponent('../../.city-agent/encryption.key')]) {
    assert.equal((await request(`/api/population/sources/${id}`)).status, 404);
  }
});

test('HTTP validation rejects private paths and symlink escapes before hashing their content', async (t) => {
  const { request, root } = await fixture(t);
  const privateText = 'private fixture content that is outside the public evidence tree';
  const privatePath = path.join(root, 'private.txt');
  writeFileSync(privatePath, privateText);
  const sourceRoot = path.resolve('data/population/sources');
  const links = mkdtempSync(path.join(sourceRoot, 'validation-test-'));
  t.after(() => rmSync(links, { recursive: true }));
  symlinkSync(privatePath, path.join(links, 'private-link.txt'));
  for (const candidatePath of ['package.json', '../../etc/passwd', privatePath, path.relative(process.cwd(), path.join(links, 'private-link.txt'))]) {
    const pack = getPopulationPack();
    pack.sources[0].localPath = candidatePath;
    pack.sources[0].sha256 = createHash('sha256').update(privateText).digest('hex');
    pack.sources[0].bytes = Buffer.byteLength(privateText);
    const report = await (await request('/api/population/validate', pack)).json();
    assert.equal(report.status, 'blocked');
    assert.ok(report.sourceFiles.some((source: { passed: boolean }) => !source.passed));
    assert.ok(report.sourceFiles.every((source: Record<string, unknown>) => source.actualSha256 === undefined));
  }
  const pack = getPopulationPack();
  pack.sources[0].sha256 = '0'.repeat(64);
  const report = await (await request('/api/population/validate', pack)).json();
  assert.equal(report.status, 'blocked');
  assert.equal(report.sourceFiles[0].actualSha256, createHash('sha256').update(readFileSync(pack.sources[0].localPath)).digest('hex'));
});
