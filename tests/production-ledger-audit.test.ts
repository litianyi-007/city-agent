import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { isUnresolvedJevIntent, productionReport, productionRequestCounts } from '../server/production/index.js';
import { ProductionStore } from '../server/production/store.js';
import { productionRunInputSchema, type ProductionCall, type ProductionRun } from '../shared/production-schema.js';
import { JEV_POLICY_VERSION, type JevEvaluation } from '../shared/jev-schema.js';
import { materialAccounting } from '../scripts/production-materials.js';

function pending(): JevEvaluation { return { policyVersion: JEV_POLICY_VERSION, status: 'error', selectedCandidateId: null, reason: '请求已登记，尚未获得结果', requestSnapshot: null, rawResponse: null, scores: [], choice: null, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, modelIdRequested: 'jev-1.13.0', modelIdReturned: null, httpStatus: null, providerRequests: 0, durationMs: 0 }; }
function run(): ProductionRun { return { id: randomUUID(), input: productionRunInputSchema.parse({ mode: 'mock-jev', brief: 'Free ledger fixture', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'unit-ledger', source: 'free injected regression', acceptance: 'Accounting only', kind: 'illustrative' } }), evidenceKind: 'fixture-with-real-jev', status: 'interrupted', createdAt: new Date().toISOString(), agentSnapshot: [], events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, interventions: [], artifacts: [], jevCalls: [{ id: randomUUID(), phase: 'product', configHash: 'unit', startedAt: new Date().toISOString(), evaluation: pending() }] }; }
function harnessCall(requests?: number): ProductionCall { return { id: randomUUID(), role: 'developer', candidateId: randomUUID(), phase: 'implement', executionSource: 'harness', startedAt: new Date().toISOString(), model: { id: randomUUID(), provider: 'deepseek', baseUrl: 'https://fixture.invalid', modelId: 'unit' }, promptVersion: 'unit', promptHash: 'unit', configHash: 'unit', systemPrompt: 'unit', userPrompt: 'unit', rawOutput: '', usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD' }, ...(requests === undefined ? {} : { providerRequests: { requests, deniedRequests: 0, status: null, transportComplete: false, inputReported: false, outputReported: false, inputTokens: null, outputTokens: null, complete: false } }) }; }

test('interrupted Jev intent remains unknown across report scopes, with known HTTP subtotal retained', () => {
  const fixture = run(); fixture.calls = [harnessCall(1), harnessCall()]; const completed = { ...pending(), providerRequests: 1, durationMs: 100, httpStatus: 500, error: 'Known single POST failed; usage unknown' };
  fixture.jevCalls!.push({ ...fixture.jevCalls![0], id: randomUUID(), evaluation: completed }); const before = JSON.stringify(fixture);
  const counts = productionRequestCounts(fixture); assert.equal(counts.harnessInvocations, 2); assert.equal(counts.actualProviderRequests, null); assert.equal(counts.knownProviderRequests, 2); assert.equal(counts.unknownRequestIntents, 2); assert.equal(counts.jevProviderRequests, null); assert.equal(counts.knownJevProviderRequests, 1); assert.equal(counts.unknownJevRequestIntents, 1);
  const report = productionReport([fixture]); for (const scope of [report.requestLedger[0], report.executionRecords[0], report.metrics.perRun[0]]) { assert.equal(scope.actualProviderRequests, null); assert.equal(scope.knownProviderRequests, 2); assert.equal(scope.unknownRequestIntents, 2); }
  assert.equal(JSON.stringify(fixture), before, 'presentation accounting must not rewrite historical evidence');
});

test('known zero-POST preflight failure and actually reported zero are not misclassified as unresolved intents', () => {
  const fixture = run(); const noPost = { ...pending(), error: 'Disabled or request rejected before fetch', reason: 'Request rejected before fetch', durationMs: 0 }; fixture.jevCalls![0].evaluation = noPost;
  assert.equal(isUnresolvedJevIntent(noPost), false); assert.equal(productionRequestCounts(fixture).actualProviderRequests, 0);
  fixture.jevCalls![0].evaluation = { ...pending(), status: 'accepted', usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true } }; assert.equal(isUnresolvedJevIntent(fixture.jevCalls![0].evaluation), false); assert.equal(productionRequestCounts(fixture).jevProviderRequests, 0);
});

test('invalid stored request counters fail presentation closed instead of negative or nonfinite counts', () => {
  for (const requests of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) { const fixture = run(); fixture.jevCalls![0].evaluation = { ...pending(), providerRequests: requests, error: 'Malformed injected counter' }; assert.equal(productionRequestCounts(fixture).actualProviderRequests, null); assert.equal(productionRequestCounts(fixture).unknownJevRequestIntents, 1); }
});

test('restarted pending production intent remains interrupted and unpaid request count is never inferred from default zero', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-ledger-audit-unit-')); t.after(() => rmSync(directory, { recursive: true, force: true })); const store = new ProductionStore(directory); const fixture = run(); fixture.status = 'running'; fixture.input.agentIds = store.agents().map(agent => agent.id); store.addRun(fixture, fixture.input.agentIds);
  const restored = new ProductionStore(directory); const interrupted = restored.run(fixture.id)!; assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.jevCalls![0].evaluation.providerRequests, 0, 'historical raw intent bytes retain their original default'); assert.equal(productionRequestCounts(interrupted).actualProviderRequests, null); assert.equal(productionRequestCounts(interrupted).unknownRequestIntents, 1);
});

test('runtime report and offline materials use the same unknown-intent classification and known Jev subtotal', () => {
  const fixture = run(); fixture.jevCalls!.push({ ...fixture.jevCalls![0], id: randomUUID(), evaluation: { ...pending(), providerRequests: 1, durationMs: 1, httpStatus: 500, error: 'Fixture failed response' } });
  const counts = productionRequestCounts(fixture); const material = materialAccounting([], [], [fixture]).measuredScope.jevDecisions;
  assert.equal(material.providerRequests, counts.jevProviderRequests); assert.equal(material.knownProviderRequests, counts.knownJevProviderRequests); assert.equal(material.unknownRequestIntents, counts.unknownJevRequestIntents);
});
