import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { JEV_POLICY_VERSION, type JevEvaluation, type JevCandidateContext, type SecretJevConfig } from '../shared/jev-schema.js';
import { productionRunInputSchema, type ProductionRunInput } from '../shared/production-schema.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { createProductionService, productionReport } from '../server/production/index.js';
import { buildJevCandidateRequest, type evaluateJevCandidates } from '../server/production/jev.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import type { runRole } from '../server/harness.js';

const FIXTURE_KEY = 'jev-unit-fixture-key-not-real';
function evaluation(config: SecretJevConfig, context: JevCandidateContext, status: JevEvaluation['status'] = 'accepted'): JevEvaluation {
  const selectedCandidateId = status === 'accepted' ? context.candidates[0].id : null;
  const dimensions = { score: status === 'uncertain' ? 3 : status === 'rejected' ? 1 : 4, probabilities: status === 'uncertain' ? { '0': 0, '1': 0, '2': 0.5, '3': 0, '4': 0.5 } : status === 'rejected' ? { '0': 0, '1': 1, '2': 0, '3': 0, '4': 0 } : { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, confidence: status === 'uncertain' ? 1 / 6 : 1, legend: { '0': 'none', '1': 'major', '2': 'partial', '3': 'good', '4': 'complete' } };
  const choiceId = status === 'accepted' || status === 'uncertain' ? context.candidates[0].id : 'abstain';
  return { policyVersion: JEV_POLICY_VERSION, status, selectedCandidateId, reason: `Injected Jev ${status}, no HTTP request`, requestSnapshot: buildJevCandidateRequest(config.modelId, context), rawResponse: { note: `Echo for secret redaction regression: ${config.apiKey}` }, scores: context.candidates.map(candidate => ({ candidateId: candidate.id, dimensions: { coverage: dimensions, consistency: dimensions, scope: dimensions }, meanScore: dimensions.score, minimumScore: dimensions.score, scopeProbability: 1, scopeCertainty: 1, qualified: status === 'accepted', stronglyRejected: status === 'rejected' })), choice: { choice: choiceId, probabilities: Object.fromEntries([...context.candidates.map(candidate => [candidate.id, candidate.id === choiceId ? 1 : 0]), ['abstain', choiceId === 'abstain' ? 1 : 0]]), confidence: 1 }, usage: { inputTokens: 100, outputTokens: 0, estimatedCost: 0.0000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1 };
}
const accept: typeof evaluateJevCandidates = async (config, context) => evaluation(config, context);

async function setup(t: TestContext, options: ProductionOptions = {}) {
  const branchRoot = fileURLToPath(new URL('../', import.meta.url));
  const directory = mkdtempSync(path.join(branchRoot, '.city-agent-jev-unit-')); const service = createProductionService(directory, options); const app = express(); app.use(express.json()); app.use('/api/production', service.router); const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await service.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(directory, { recursive: true, force: true }); });
  const request = (route: string, body?: unknown, method = 'GET') => fetch(`http://127.0.0.1:${address.port}/api/production${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const benchmark = PRODUCTION_DEMO_CASES[0];
  const input = (overrides: Partial<ProductionRunInput> = {}) => productionRunInputSchema.parse({ brief: benchmark.brief, mode: 'mock-jev', verifierEngine: 'jev-cascade', demoCaseId: benchmark.operation, budgetAuthorized: true, agentIds: service.store.agents().map(agent => agent.id), requirement: { id: benchmark.id, source: benchmark.source, background: benchmark.background, acceptance: benchmark.acceptance, difficulty: benchmark.difficulty, kind: benchmark.kind }, ...overrides });
  const configure = () => { service.store.patchJevConfig({ enabled: true, apiKey: FIXTURE_KEY }); };
  const configureModels = () => { for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `role-injected-key-${agent.role}`, pricing: { currency: 'USD', inputPerMillion: 1, outputPerMillion: 1 } }); };
  const wait = async (id: string) => { const deadline = Date.now() + 20000; while (Date.now() < deadline) { const run = service.store.run(id)!; if (!['queued', 'running'].includes(run.status)) { while (service.pipeline.busy) await new Promise(resolve => setTimeout(resolve, 10)); return service.store.run(id)!; } await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Jev production test did not finish'); };
  return { service, directory, request, input, configure, configureModels, wait };
}

const injectedRole: typeof runRole = async (_agent, system, prompt) => {
  const data = JSON.parse(prompt); let value: unknown;
  if (system.startsWith('你是独立质量Verifier')) value = { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected fallback verifies every supplied candidate' })), reason: 'Injected verifier; not an API call' };
  else if (system.includes('"goal"')) value = { goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] };
  else if (system.includes('"observations"')) value = { observations: ['Provided requirements only'], constraints: ['offline HTML'], unknowns: [] };
  else if (system.includes('"decision"')) value = { decision: data.context.gate?.passed === false ? 'revise' : 'proceed', summary: 'Bounded injected plan', tasks: [{ id: 'build', owner: 'developer', description: 'Implement frozen contract' }], risks: [] };
  else if (system.includes('"checks"')) value = { checks: demoChecks('create') };
  else value = { html: demoHtml(data.input) };
  return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Injected engineering fixture; no model network request' };
};

test('Jev configuration masks credentials, encrypts persisted keys, supports rotation/clear and rejects unsupported models', async t => {
  const { directory, request, service } = await setup(t, { jevCall: accept }); const initial = await (await request('/jev/config')).json(); assert.equal(initial.hasApiKey, false); assert.equal(initial.enabled, false);
  const configured = await request('/jev/config', { enabled: true, apiKey: FIXTURE_KEY, maxRequests: 13, minScore: 3.4, timeoutMs: 5000 }, 'PATCH'); assert.equal(configured.status, 200); const publicConfig = await configured.json(); assert.equal(publicConfig.hasApiKey, true); assert.equal('apiKey' in publicConfig, false); assert.equal(service.store.secretJevConfig().apiKey, FIXTURE_KEY);
  await request('/jev/config', { minConfidence: 0.7 }, 'PATCH'); assert.equal(service.store.secretJevConfig().apiKey, FIXTURE_KEY); assert.equal(service.store.jevConfig().enabled, true, 'PATCH must not apply omitted enabled default'); assert.equal(service.store.jevConfig().maxRequests, 13); assert.equal(service.store.jevConfig().minScore, 3.4); assert.equal(service.store.jevConfig().timeoutMs, 5000);
  const replacement = 'new-unit-jev-key-only-not-real'; await request('/jev/config', { apiKey: replacement }, 'PATCH'); assert.equal(service.store.secretJevConfig().apiKey, replacement); assert.equal(service.store.jevConfig().minConfidence, 0.7); assert.equal(service.store.jevConfig().enabled, true);
  const persisted = readFileSync(path.join(directory, 'production', 'state.json'), 'utf8'); assert.equal(persisted.includes(FIXTURE_KEY), false); assert.equal(persisted.includes(replacement), false); assert.equal(statSync(path.join(directory, 'production', 'state.json')).mode & 0o777, 0o600);
  assert.equal((await request('/jev/config', { modelId: 'silently-replace-version' }, 'PATCH')).status, 400);
  const cleared = await (await request('/jev/config', { apiKey: null }, 'PATCH')).json(); assert.equal(cleared.hasApiKey, false); assert.equal(service.store.secretJevConfig().apiKey, undefined);
});

test('mock-jev accepted six quality decisions executes the real browser Gate but stays injected, never real autonomous generation', async t => {
  const { request, input, configure, wait, service } = await setup(t, { jevCall: accept }); configure(); const response = await request('/runs', input(), 'POST'); assert.equal(response.status, 202); const run = await wait((await response.json()).id);
  assert.equal(run.status, 'completed', run.error); assert.equal(run.gate?.passed, true); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.jevCalls?.length, 6); assert.equal(run.calls.length, 6); assert.equal(run.calls.every(call => call.executionSource === 'mock'), true); assert.equal(run.calls.some(call => call.role === 'verifier'), false); assert.equal(run.verifications.every(review => review.engine === 'jev' && review.decision === 'accept'), true);
  assert.equal(run.usage.inputTokens, 600); assert.equal(run.usage.outputTokens, 0); assert.ok(Math.abs(run.usage.estimatedCost! - 0.0000252) < 1e-12); assert.equal(run.usage.complete, true);
  const evidence = await (await request(`/runs/${run.id}/artifacts/evidence.json`)).text(); assert.equal(evidence.includes(FIXTURE_KEY), false); assert.equal(JSON.stringify(service.store.runs()).includes(FIXTURE_KEY), false); assert.match(evidence, /REDACTED/);
  const report = productionReport(service.store.runs()); assert.equal(report.metrics.realModelStarted, 0); assert.equal(report.metrics.realModelPassed, 0); assert.equal(report.metrics.goodProductRate, null); assert.equal(report.executionRecords[0].actualProviderRequests, 0); assert.equal(report.executionRecords[0].harnessInvocations, 0);
});

test('mock-jev requires enabled credentials, explicit authorization and USD budget without inheriting role keys', async t => {
  const { request, input, configure } = await setup(t, { jevCall: accept }); assert.equal((await request('/runs', input(), 'POST')).status, 400); configure(); assert.equal((await request('/runs', input({ budgetAuthorized: false }), 'POST')).status, 400); assert.equal((await request('/runs', input({ limits: { ...input().limits, currency: 'CNY' } }), 'POST')).status, 400);
});

test('Jev unknown usage stops after one decision request and records unknown instead of zero', async t => {
  let invocations = 0; const { request, input, configure, wait } = await setup(t, { jevCall: async (config, context) => { invocations++; return { ...evaluation(config, context), usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } }; } }); configure(); const run = await wait((await (await request('/runs', input(), 'POST')).json()).id);
  assert.equal(run.status, 'failed'); assert.equal(invocations, 1); assert.equal(run.jevCalls?.length, 1); assert.equal(run.calls.length, 1); assert.equal(run.usage.inputTokens, null); assert.equal(run.usage.estimatedCost, null); assert.equal(run.usage.complete, false); assert.match(run.error!, /unknown/);
});

test('Jev rejection and errors fail closed, and uncertain mock decisions cannot fabricate LLM fallback', async t => {
  for (const status of ['rejected', 'error', 'uncertain'] as const) {
    const { request, input, configure, wait } = await setup(t, { jevCall: async (config, context) => evaluation(config, context, status), roleCall: async () => { throw new Error('Unwanted fallback model call'); } }); configure(); const run = await wait((await (await request('/runs', input(), 'POST')).json()).id);
    assert.equal(run.status, 'failed'); assert.equal(run.jevCalls?.length, status === 'rejected' ? 3 : 1); assert.equal(run.calls.length, status === 'rejected' ? 3 : 1); assert.equal(run.repairs, status === 'rejected' ? 2 : 0); assert.equal(run.calls.some(call => call.role === 'verifier'), false); assert.equal(run.verifications[0].decision, 'abstain'); assert.match(run.error!, new RegExp(status));
  }
});

test('live uncertainty escalates once to configured independent LLM verifier; other accepted stages stay on Jev', async t => {
  const { request, input, configure, configureModels, wait, service } = await setup(t, { roleCall: injectedRole, jevCall: async (config, context) => evaluation(config, context, context.phase === 'product' ? 'uncertain' : 'accepted') }); configure(); configureModels(); const run = await wait((await (await request('/runs', input({ mode: 'live', demoCaseId: undefined }), 'POST')).json()).id);
  assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.jevCalls?.length, 6); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 1); assert.equal(run.verifications.filter(review => review.engine === 'jev-llm-fallback').length, 1); assert.equal(run.verifications.filter(review => review.engine === 'jev' && review.decision === 'abstain').length, 1); assert.equal(run.gate?.passed, true); assert.equal(productionReport(service.store.runs()).metrics.realModelPassed, 0);
});

test('cancelling Jev evaluation aborts signal, preserves audit, forbids concurrent config changes and performs no fallback', async t => {
  let aborted = false; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const { request, input, configure, wait } = await setup(t, { jevCall: async (_config, _context, signal) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('Injected Jev aborted')); }, { once: true })); } }); configure(); const response = await request('/runs', input(), 'POST'); const id = (await response.json()).id; await started;
  assert.equal((await request('/jev/config', { apiKey: 'cannot-change-while-active' }, 'PATCH')).status, 409); await request(`/runs/${id}/cancel`, undefined, 'POST'); const run = await wait(id); assert.equal(run.status, 'cancelled'); assert.equal(aborted, true); assert.equal(run.interventions.length, 1); assert.equal(run.jevCalls?.length, 1); assert.equal(run.calls.some(call => call.role === 'verifier'), false); assert.equal(run.usage.complete, false);
});

test('Jev private run configuration snapshot survives external rotation and exports neither old nor new key', async t => {
  const seenKeys: Array<string | undefined> = []; let fixture: Awaited<ReturnType<typeof setup>>;
  fixture = await setup(t, { jevCall: async (config, context) => { seenKeys.push(config.apiKey); if (seenKeys.length === 1) fixture.service.store.patchJevConfig({ apiKey: 'external-rotation-unit-key' }); return evaluation(config, context); } }); fixture.configure(); const run = await fixture.wait((await (await fixture.request('/runs', fixture.input(), 'POST')).json()).id);
  assert.equal(run.status, 'completed', run.error); assert.deepEqual(seenKeys, Array(6).fill(FIXTURE_KEY)); assert.equal(fixture.service.store.secretJevConfig(run.id).apiKey, FIXTURE_KEY); assert.equal(fixture.service.store.secretJevConfig().apiKey, 'external-rotation-unit-key');
  const serialized = JSON.stringify(run); assert.equal(serialized.includes(FIXTURE_KEY), false); assert.equal(serialized.includes('external-rotation-unit-key'), false);
});

test('HTTP metrics distinguish logical Harness startup from observed provider POST requests', async t => {
  const { request, input, configure, wait, service } = await setup(t, { jevCall: accept }); configure(); const run = await wait((await (await request('/runs', input(), 'POST')).json()).id);
  run.calls[0].executionSource = 'harness'; run.calls[0].providerRequests = { requests: 0, deniedRequests: 1, status: null, transportComplete: false, inputReported: false, outputReported: false, inputTokens: null, outputTokens: null, complete: false };
  let report = productionReport([run]); assert.equal(report.executionRecords[0].harnessInvocations, 1); assert.equal(report.executionRecords[0].actualProviderRequests, 0);
  delete run.calls[0].providerRequests; report = productionReport([run]); assert.equal(report.executionRecords[0].actualProviderRequests, null);
  assert.equal(productionReport(service.store.runs()).metrics.realModelStarted, 0);
});

test('Jev request and money ceilings stop subsequent evaluation before any additional HTTP attempt', async t => {
  const { request, input, configure, wait, service } = await setup(t, { jevCall: accept }); configure(); service.store.patchJevConfig({ maxRequests: 1 });
  const limitedResponse = await request('/runs', input(), 'POST'); const limitedBody = await limitedResponse.json(); assert.equal(limitedResponse.status, 202, JSON.stringify(limitedBody)); const limited = await wait(limitedBody.id); assert.equal(limited.status, 'failed'); assert.equal(limited.jevCalls?.length, 1); assert.equal(limited.calls.length, 2); assert.match(limited.error!, /请求预算耗尽/);
  const money = await wait((await (await request('/runs', input({ limits: { ...input().limits, maxCost: 0.00001 } }), 'POST')).json()).id); assert.equal(money.status, 'failed'); assert.equal(money.jevCalls?.length, 0); assert.match(money.error!, /预算不足/);
});

test('partial role edits preserve customized provider, model, disabled state and endpoint-scoped credential', async t => {
  const { request, service } = await setup(t, { jevCall: accept }); const response = await request('/agents', { name: 'Customized product', role: 'product', provider: 'anthropic', baseUrl: 'https://local-fixture.invalid', modelId: 'nondefault-fixture-model', enabled: false, apiKey: 'custom-role-fixture-key' }, 'POST'); assert.equal(response.status, 201); const agent = await response.json();
  const patched = await (await request(`/agents/${agent.id}`, { name: 'Renamed only' }, 'PATCH')).json(); assert.equal(patched.name, 'Renamed only'); assert.equal(patched.provider, 'anthropic'); assert.equal(patched.baseUrl, 'https://local-fixture.invalid'); assert.equal(patched.modelId, 'nondefault-fixture-model'); assert.equal(patched.enabled, false); assert.equal(patched.hasApiKey, true); assert.equal(service.store.secretAgents([agent.id])[0].apiKey, 'custom-role-fixture-key');
});
