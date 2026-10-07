import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { createProductionService } from '../server/production/index.js';

test('production service supports the exact macOS system temporary alias without weakening study paths', { skip: process.platform !== 'darwin' }, async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-study-system-alias-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const service = createProductionService(directory, { assertExecutionFresh: () => {} });
  t.after(() => service.close());
  assert.equal(service.store.directory, path.join(realpathSync(directory), 'production'));
  assert.ok(existsSync(path.join(service.store.directory, 'studies')));
});

test('production service rejects custom data symlinks before writing or reading Store state', () => {
  const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'city-study-custom-link-'));
  try {
    const target = path.join(directory, 'target'); mkdirSync(target);
    const link = path.join(directory, 'link'); symlinkSync(target, link, 'dir');
    for (const candidate of [link, path.join(link, 'nested')]) {
      assert.throws(() => createProductionService(candidate), /符号链接/);
      assert.deepEqual(readdirSync(target), []);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production service rejects existing study and dangling symlinks before Store initialization', () => {
  const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'city-study-existing-link-'));
  try {
    const data = path.join(directory, 'data'); const production = path.join(data, 'production'); mkdirSync(production, { recursive: true });
    const target = path.join(directory, 'target'); mkdirSync(target);
    symlinkSync(target, path.join(production, 'studies'), 'dir');
    assert.throws(() => createProductionService(data), /符号链接/);
    assert.deepEqual(readdirSync(production), ['studies']);
    assert.deepEqual(readdirSync(target), []);
    const dangling = path.join(directory, 'dangling'); symlinkSync(path.join(directory, 'missing'), dangling, 'dir');
    assert.throws(() => createProductionService(dangling), /符号链接/);
    assert.equal(existsSync(path.join(directory, 'missing')), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('production service refuses relative or non-normalized roots instead of resolving away traversal', () => {
  for (const directory of ['relative-data', '/', '/tmp/../tmp/example', '/var//folders/example', '/var\0/folders/example']) {
    assert.throws(() => createProductionService(directory), /规范绝对路径|根目录/);
  }
});

async function setup(t: TestContext) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-study-api-'));
  let checks = 0;
  const service = createProductionService(directory, { assertExecutionFresh: () => { checks++; } });
  const app = express(); app.use(express.json()); app.use('/api/production', service.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  return { service, checks: () => checks, request: (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`http://127.0.0.1:${address.port}/api/production${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
}

test('study API exposes an empty read-only list, strict inputs and no caller transport or paid shortcuts', async t => {
  const f = await setup(t);
  f.service.store.redact = () => { throw new Error('Free rejected study requests must not decrypt Keys for error redaction'); };
  assert.deepEqual(await (await f.request('/verifier-studies')).json(), []);
  for (const body of [
    { executionSource: 'live' },
    { executionSource: 'loopback-engineering', llmBaseUrl: 'http://127.0.0.1:12345' },
    { executionSource: 'real-provider', budgetAuthorized: true, apiKey: 'untrusted-user-field' },
    { executionSource: 'loopback-engineering', oracle: 'return-true' },
  ]) assert.equal((await f.request('/verifier-studies/prepare', body)).status, 400);
  for (const body of [{}, { preparationId: 'unknown', estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true }, { preparationId: 'unknown', estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true, consent: { status: 'granted' } }]) {
    assert.ok((await f.request('/verifier-studies/start', body)).status >= 400);
  }
  assert.deepEqual(await (await f.request('/verifier-studies')).json(), []);
  assert.ok((await f.request('/verifier-studies/00000000-0000-4000-8000-000000000000/cancel', {})).status >= 400);
  assert.ok((await f.request('/verifier-studies/00000000-0000-4000-8000-000000000000')).status >= 400);
});

test('free preparation never reads configured keys, exposes only public freeze and is not execution', async t => {
  const f = await setup(t); let decrypted = 0;
  f.service.store.secretAgents = () => { decrypted++; throw new Error('No stored keys for free preparation'); };
  f.service.store.secretJevConfig = () => { decrypted++; throw new Error('No stored keys for free preparation'); };
  const response = await f.request('/verifier-studies/prepare', { executionSource: 'loopback-engineering' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const preparation = await response.json();
  assert.equal(preparation.executionSource, 'loopback-engineering');
  assert.match(preparation.frozenStudySha256, /^[a-f0-9]{64}$/);
  assert.equal(preparation.plan.poolIds.length, 18);
  assert.deepEqual(preparation.plan.strategies, ['baseline', 'llm', 'jev-cascade']);
  assert.equal(preparation.plan.limits.maxEstimatedCostUsd, 1);
  assert.equal(decrypted, 0);
  assert.deepEqual(await (await f.request('/verifier-studies')).json(), []);
  const text = JSON.stringify(preparation);
  assert.equal(text.includes('synthetic-study-llm-not-a-real-credential'), false);
  assert.equal(text.includes('synthetic-study-jev-not-a-real-credential'), false);
  assert.equal(text.includes('credentialIdentity'), false);
  assert.equal(text.includes(f.service.store.directory), false);
});

test('real study preparation requires page configuration and cannot be enabled by claimed Key presence', async t => {
  const f = await setup(t); let decrypted = 0;
  f.service.store.secretAgents = () => { decrypted++; throw new Error('No decrypt during rejected prepare'); };
  f.service.store.secretJevConfig = () => { decrypted++; throw new Error('No decrypt during rejected prepare'); };
  const response = await f.request('/verifier-studies/prepare', { executionSource: 'real-provider', verifierAgentId: f.service.store.agents().find(agent => agent.role === 'verifier')!.id });
  assert.ok(response.status >= 400);
  assert.equal(decrypted, 0);
  assert.deepEqual(await (await f.request('/verifier-studies')).json(), []);
});
