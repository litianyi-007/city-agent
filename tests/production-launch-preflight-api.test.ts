import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { createProductionService } from '../server/production/index.js';
import { EXECUTION_IDENTITY_LIMITATION, PRODUCTION_EXECUTION_IDENTITY_VERSION, type ProductionExecutionIdentity } from '../server/production/provenance.js';
import { productionRunInputSchema, type ProductionAgent } from '../shared/production-schema.js';
import type { ProductionLaunchPreflightReport } from '../shared/production-launch-preflight.js';

const fixtureCredential = 'fixture-preflight-only-token-20261008';
function identity(): ProductionExecutionIdentity {
  return { version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId: 'launch-api-fixture-boot', startedAt: '2026-10-08T00:00:00.000Z', commit: 'a'.repeat(40), sourceClean: true, sourceFingerprint: 'b'.repeat(64), sourceFiles: [], buildSnapshot: { platformCommit: 'a'.repeat(40), sourceClean: true, builtAt: '2026-10-07T23:00:00.000Z' }, buildFingerprint: 'c'.repeat(64), buildFiles: [], ready: true, issues: [], limitation: EXECUTION_IDENTITY_LIMITATION };
}
async function setup(t: TestContext, options: { configured?: boolean; stale?: boolean; unready?: boolean } = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-launch-preflight-api-'));
  let freshnessChecks = 0; let forbiddenOperations = 0;
  const service = createProductionService(directory, { executionIdentity: { ...identity(), ...(options.unready ? { ready: false, sourceClean: false } : {}) }, assertExecutionFresh: () => { freshnessChecks++; if (options.stale) throw new Error('synthetic-private-freshness-detail'); }, roleCall: async () => { forbiddenOperations++; throw new Error('Free preflight must never dispatch'); } });
  if (options.configured !== false) for (const agent of service.store.agents()) {
    service.store.patchAgent(agent.id, { apiKey: fixtureCredential, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } });
  }
  const models = service.store.agents();
  const beforeFiles = readdirSync(directory, { recursive: true }).sort();
  const forbidden = () => { forbiddenOperations++; throw new Error('Free preflight attempted secret/decryption/persistence/runtime operation'); };
  // Only brand-new test-owned synthetic credentials are installed above. From
  // this point, both success and rejection must use public/encrypted comparison,
  // never a decrypting redactor or persistence/dispatch path.
  for (const name of ['decrypt', 'secretAgents', 'runAgents', 'secretJevConfig', 'redact', 'sanitize', 'persist', 'addRun', 'save', 'writeArtifact', 'saveJevBenchmark']) Reflect.set(service.store, name, forbidden);
  Reflect.set(service.pipeline, 'start', forbidden); Reflect.set(service.studies, 'start', forbidden); Reflect.set(service.studies, 'prepare', forbidden);
  const app = express(); app.use(express.json()); app.use('/api/production', service.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (target: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = target instanceof Request ? new URL(target.url) : new URL(String(target));
    assert.equal(url.origin, `http://127.0.0.1:${address.port}`, 'No provider/network request may escape the test API');
    return localFetch(target, init);
  });
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  const input = productionRunInputSchema.parse({ brief: '添加、完成、删除待办事项', mode: 'live', capability: 'offline-single-html', verifierEngine: 'llm-rubric', budgetAuthorized: false, agentIds: models.map(agent => agent.id), candidateCount: 2, requirement: { id: 'HTML-FREE-PREPARE', source: '用户声明', acceptance: '添加、完成、删除分别具有独立业务结果断言。', kind: 'user-declared-real' }, limits: { maxCalls: 80, maxTokens: 5_000_000, maxCost: 100 } });
  return { service, input, models, checks: () => freshnessChecks, request: (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/production/runs/preflight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), assertFree: () => {
    assert.equal(forbiddenOperations, 0); assert.equal(service.pipeline.busy, false); assert.equal(service.studies.busy, false);
    assert.deepEqual(service.store.runs(), []); assert.deepEqual(service.store.jevBenchmarks(), []); assert.deepEqual(service.studies.list(), []);
    assert.deepEqual(readdirSync(directory, { recursive: true }).sort(), beforeFiles);
  } };
}

test('free launch API returns public ready identity/rates and does not authorize, decrypt, persist or run a model', async t => {
  const f = await setup(t);
  for (const policy of ['legacy', 'source-bound-v1']) {
    const response = await f.request({ ...f.input, implementationEvidencePolicy: policy });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const report = await response.json() as ProductionLaunchPreflightReport;
    assert.equal(report.ready, true); assert.equal(report.paidAuthorized, false); assert.equal(report.modelRequests, 0); assert.equal(report.finalGate, null);
    assert.equal(report.input.budgetAuthorized, false); assert.equal(report.models.length, 6);
    assert.ok(report.models.every(model => model.hasApiKey && model.pricing?.currency === 'USD'));
    assert.equal(report.execution.bootId, 'launch-api-fixture-boot'); assert.equal(report.execution.fresh, true);
    assert.match(report.reportHash, /^[a-f0-9]{64}$/); assert.equal(report.budget.worstCaseCalls, 36);
    assert.equal(JSON.stringify(report).includes(fixtureCredential), false); assert.equal(JSON.stringify(report).includes('apiKey'), false);
  }
  assert.equal(f.checks(), 2); f.assertFree();
});

test('missing public credentials/rates and dirty or stale boot produce unready zero-request reports, not paid fallback', async t => {
  for (const options of [{ configured: false }, { unready: true }, { stale: true }]) await t.test(JSON.stringify(options), async child => {
    const f = await setup(child, options); const response = await f.request(f.input);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const report = await response.json() as ProductionLaunchPreflightReport;
    assert.equal(report.ready, false); assert.equal(report.modelRequests, 0); assert.equal(report.paidAuthorized, false); assert.equal(report.finalGate, null);
    if (options.configured === false) { assert.ok(report.issues.some(issue => issue.code === 'agent-key-missing')); assert.ok(report.issues.some(issue => issue.code === 'agent-pricing-missing')); assert.equal(report.budget.firstRequest.estimatedCost, null); }
    if (options.unready) assert.ok(report.issues.some(issue => issue.code === 'execution-unready'));
    if (options.stale) { assert.ok(report.issues.some(issue => issue.code === 'execution-stale')); assert.equal(JSON.stringify(report).includes('synthetic-private-freshness-detail'), false); }
    f.assertFree();
  });
});

test('paid/Mock/camera/Jev/extra-field and credential-collision requests receive one fixed no-store error without decrypting', async t => {
  const f = await setup(t); let fixed: unknown;
  const { budgetAuthorized: _missing, ...withoutAuthorization } = f.input;
  for (const body of [withoutAuthorization, { ...f.input, budgetAuthorized: true }, { ...f.input, mode: 'demo' }, { ...f.input, mode: 'mock-jev' }, { ...f.input, capability: 'camera-scene-v1' }, { ...f.input, verifierEngine: 'jev-cascade' }, { ...f.input, apiKey: 'untrusted-extra-provider-token' }, { ...f.input, brief: `a decoded synthetic credential ${fixtureCredential}` }, { ...f.input, [fixtureCredential]: 'untrusted-key-name' }]) {
    const response = await f.request(body); assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
    const error = await response.json(); fixed ??= error; assert.deepEqual(error, fixed);
    assert.equal(JSON.stringify(error).includes(fixtureCredential), false); assert.equal(JSON.stringify(error).includes('untrusted-extra-provider-token'), false);
  }
  // Also scan the derived report, not only the request. A public snapshot
  // corrupted with legacy credential text must be refused before exposure.
  f.service.store.agents = () => f.models.map((model, index): ProductionAgent => ({ ...model, ...(index === 0 ? { name: fixtureCredential } : {}) }));
  const response = await f.request(f.input); assert.equal(response.status, 400); assert.deepEqual(await response.json(), fixed);
  f.assertFree();
});

test('free API enforces mutual exclusion before metadata or freshness and never reveals active task details', async t => {
  const f = await setup(t);
  Object.defineProperty(f.service.pipeline, 'busy', { configurable: true, get: () => true });
  const response = await f.request(f.input);
  assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(await response.json()), ['error']); assert.equal(f.checks(), 0);
  Object.defineProperty(f.service.pipeline, 'busy', { configurable: true, get: () => false });
  f.assertFree();
});
