import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import { createProductionService } from '../server/production/index.js';
import { buildProductionLaunchPreflight } from '../server/production/launch-preflight.js';
import { ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_PLAN_VERSION, acceptanceGroupSchema, acceptancePlanHash, acceptancePlanSchema, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { OUTPUT_CONTRACT_VERSION, outputContractSnapshot, planSchema } from '../server/production/contracts.js';
import { EXECUTION_IDENTITY_LIMITATION, PRODUCTION_EXECUTION_IDENTITY_VERSION, type ProductionExecutionIdentity } from '../server/production/provenance.js';
import { PRODUCTION_INPUT_TOKEN_RESERVATION, estimateProductionCost, productionLaunchCallEnvelope } from '../shared/production-launch-preflight.js';
import { PRODUCTION_ROLES, productionRunInputSchema, type ProductionAgent, type ProductionRunInput } from '../shared/production-schema.js';
import { productionPhaseRubric } from '../shared/production-verifier-rubric.js';

// Pure preparation/schema fixtures and one loopback-only free API fixture.
// Synthetic credentials live only in a newly created test-owned directory;
// no SDK, provider, browser, generated candidate or paid launch is invoked.
function agents(): ProductionAgent[] {
  return PRODUCTION_ROLES.map((role, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: role, role, provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'free-grouped-fixture', enabled: true, hasApiKey: true, pricing: { inputPerMillion: .30, outputPerMillion: 1.20, currency: 'USD' } }));
}
function input(): ProductionRunInput {
  return productionRunInputSchema.parse({ brief: 'Build an offline list with exact business results.', capability: 'offline-single-html', mode: 'live', verifierEngine: 'llm-rubric', implementationEvidencePolicy: 'legacy', acceptanceStrategy: 'planned-groups-v1', candidateCount: 1, budgetAuthorized: false, agentIds: agents().map(agent => agent.id), requirement: { id: 'GROUPED-PREFLIGHT-FREE', source: 'Synthetic pure fixture', acceptance: 'Add valid entries; reject invalid input without modifying existing records.', kind: 'illustrative' }, limits: { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' } });
}
function identity(): ProductionExecutionIdentity {
  return { version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId: 'free-groups-boot', startedAt: '2026-10-08T00:00:00.000Z', commit: 'a'.repeat(40), sourceClean: true, sourceFingerprint: 'b'.repeat(64), sourceFiles: [], buildFingerprint: 'c'.repeat(64), buildFiles: [], buildSnapshot: { platformCommit: 'a'.repeat(40), sourceClean: true, builtAt: '2026-10-07T23:00:00.000Z' }, ready: true, issues: [], limitation: EXECUTION_IDENTITY_LIMITATION };
}
const legacyInput = () => { const { acceptanceStrategy: _strategy, ...legacy } = input(); return legacy; };
function contractPlan(): AcceptancePlan {
  return { version: ACCEPTANCE_PLAN_VERSION, obligations: [
    { id: 'o-brief', source: 'brief', quote: 'offline', scenario: 'Independent initial page.', expected: 'Exact positive outcome.' },
    { id: 'o-acceptance', source: 'acceptance', quote: 'boundary', scenario: 'Independent valid other fields.', expected: 'State remains unchanged.' },
  ], groups: [{ id: 'g-one', checks: [
    { id: 'c-positive', obligationIds: ['o-brief'], setup: 'New page with valid inputs.', exercise: 'Click the registered button.', assertions: 'Exact result and count.', stepBudget: 7 },
    { id: 'c-boundary', obligationIds: ['o-acceptance'], setup: 'New page with explicit existing state.', exercise: 'Change only the target boundary.', assertions: 'Exact unchanged state and error.', stepBudget: 20 },
  ] }] };
}

test('the actual model output contract serializes strict ordered slots and each host-bound ID, hash, round and step budget', () => {
  const value = contractPlan(); const planHash = acceptancePlanHash(value); const attemptId = '00000000-0000-4000-8000-000000000001';
  const contract = outputContractSnapshot(acceptanceGroupSchema(value, planHash, 'g-one', attemptId));
  assert.equal(contract.version, OUTPUT_CONTRACT_VERSION); assert.deepEqual(JSON.parse(JSON.stringify(contract)), contract);
  type Slot = { additionalProperties: boolean; required: string[]; properties: { checkId: { const: string }; check: { additionalProperties: boolean; properties: { steps: { maxItems: number } } } } };
  const schema = contract.jsonSchema as { type: string; additionalProperties: boolean; required: string[]; properties: { version: { const: string }; planHash: { const: string }; groupId: { const: string }; attemptId: { const: string }; checks: { type: string; items: boolean; minItems: number; maxItems: number; prefixItems: Slot[] } } };
  assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), ['attemptId', 'checks', 'groupId', 'planHash', 'version']);
  assert.equal(schema.properties.version.const, ACCEPTANCE_GROUP_VERSION); assert.equal(schema.properties.planHash.const, planHash);
  assert.equal(schema.properties.groupId.const, 'g-one'); assert.equal(schema.properties.attemptId.const, attemptId);
  const checks = schema.properties.checks; assert.equal(checks.type, 'array'); assert.equal(checks.items, false); assert.equal(checks.minItems, 2); assert.equal(checks.maxItems, 2);
  assert.deepEqual(checks.prefixItems.map(slot => slot.properties.checkId.const), ['c-positive', 'c-boundary']);
  assert.deepEqual(checks.prefixItems.map(slot => slot.properties.check.properties.steps.maxItems), [7, 20]);
  for (const slot of checks.prefixItems) {
    assert.equal(slot.additionalProperties, false); assert.equal(slot.properties.check.additionalProperties, false);
    assert.deepEqual([...slot.required].sort(), ['check', 'checkId']);
  }
});

test('the acceptance-plan rubric reviews only versioned obligations and slots, not ordinary PM output or a camera plan', () => {
  const rubric = productionPhaseRubric('acceptance-plan', 'offline-single-html')!;
  assert.equal(rubric.phase, 'acceptance-plan'); assert.equal(rubric.minimumOrdinalScore, 3);
  assert.match(rubric.expectedArtifact, /Strict versioned acceptance plan/); assert.match(rubric.dimensions.scope, /only the strict versioned obligations\/groups\/check-slots plan/);
  assert.match(rubric.dimensions.scope, /does NOT contain ordinary PM decision\/summary\/tasks\/risks; do not demand those fields/);
  assert.match(rubric.dimensions.coverage, /NOT semantic coverage proof/); assert.match(rubric.positiveExample, /quotes.*obligation.*independent setup.*slot budget/);
  assert.match(rubric.negativeExample, /Missing required scenarios.*depending on another check state.*removing required assertions/);
  for (const example of [rubric.positiveExample, rubric.negativeExample]) assert.doesNotMatch(example, /\b(?:proceed|revise|stop|decision|summary|tasks|risks)\b/i);
  assert.equal(productionPhaseRubric('acceptance-plan', 'camera-scene-v1'), null);
  const properties = outputContractSnapshot(acceptancePlanSchema).jsonSchema.properties!;
  assert.deepEqual(Object.keys(properties).sort(), ['groups', 'obligations', 'version']);
  const ordinary = { decision: 'proceed', summary: 'Existing ordinary PM contract remains valid.', tasks: [{ id: 't', owner: 'tester', description: 'Use original acceptance.' }], risks: [] };
  assert.equal(planSchema.safeParse(ordinary).success, true); assert.equal(acceptancePlanSchema.safeParse(ordinary).success, false);
  assert.equal(acceptancePlanSchema.safeParse(contractPlan()).success, true); assert.equal(planSchema.safeParse(contractPlan()).success, false);
});

test('new grouped envelope accounts for plan and whole review and shares at most two global repairs', () => {
  for (const repairs of [0, 1, 2]) assert.deepEqual(productionLaunchCallEnvelope(1, repairs, 'planned-groups-v1'), { baseCalls: 16, worstCaseCalls: 16 + 6 * repairs });
  assert.throws(() => productionLaunchCallEnvelope(2, 2, 'planned-groups-v1'), /single candidate/);
  for (const candidates of [1, 2] as const) for (const repairs of [0, 1, 2]) assert.deepEqual(productionLaunchCallEnvelope(candidates, repairs), { baseCalls: 6 * (candidates + 1), worstCaseCalls: (6 + 3 * repairs) * (candidates + 1) });
});

test('group preparation binds an explicit opt-in, reports sixteen/twenty-eight calls and never grants authorization', () => {
  const value = input(); const models = agents(); const execution = identity(); const before = JSON.stringify({ value, models, execution }); let freshness = 0;
  const report = buildProductionLaunchPreflight(value, models, execution, () => { freshness++; });
  assert.equal(report.ready, true); assert.equal(report.paidAuthorized, false); assert.equal(report.finalGate, null); assert.equal(report.modelRequests, 0); assert.equal(freshness, 1);
  assert.equal(report.input.acceptanceStrategy, 'planned-groups-v1'); assert.equal(report.input.budgetAuthorized, false);
  assert.deepEqual(report.configuration, { promptVersion: 'production-html-grouped-v2', pmOutputPolicyVersion: 'production-pm-output-policy-v1', roleSchemaDiagnosticsVersion: 'production-role-schema-diagnostics-v1' });
  assert.deepEqual({ base: report.budget.baseCalls, worst: report.budget.worstCaseCalls }, { base: 16, worst: 28 });
  assert.equal(report.budget.firstRequest.totalTokens, PRODUCTION_INPUT_TOKEN_RESERVATION + 6000);
  assert.equal(report.budget.firstRequest.estimatedCost, .0268608);
  assert.equal(report.budget.envelope.baseTokens, 16 * 71536); assert.equal(report.budget.envelope.worstCaseTokens, 28 * 71536);
  assert.equal(report.budget.envelope.worstCaseEstimatedCost, 28 * .0268608);
  assert.ok(report.warnings.some(warning => warning.code === 'planned-groups-not-real-validated'));
  assert.ok(report.warnings.some(warning => warning.code === 'call-envelope-exceeds-budget'));
  assert.ok(report.warnings.some(warning => warning.code === 'token-envelope-exceeds-budget'));
  assert.equal(report.input.limits.maxCalls, 24, 'An envelope warning never raises the actual caller limit to 28');
  assert.equal(JSON.stringify({ value, models, execution }), before);
  const { reportHash, ...payload } = report; assert.equal(reportHash, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.equal(JSON.stringify(report).includes('apiKey'), false, 'Only public hasApiKey status, never a credential field');
});

test('strategy is rejected for N2, Jev, source-bound, camera and either Mock mode without silently changing input', () => {
  for (const mutation of [{ candidateCount: 2 }, { verifierEngine: 'jev-cascade' }, { implementationEvidencePolicy: 'source-bound-v1' }, { capability: 'camera-scene-v1' }, { mode: 'demo' }, { mode: 'mock-jev' }, { acceptanceStrategy: 'unknown-strategy' }]) {
    const value = { ...input(), ...mutation }; const before = JSON.stringify(value);
    assert.equal(productionRunInputSchema.safeParse(value).success, false);
    assert.throws(() => buildProductionLaunchPreflight(value, agents(), identity(), () => {})); assert.equal(JSON.stringify(value), before);
  }
  assert.throws(() => buildProductionLaunchPreflight({ ...input(), budgetAuthorized: true }, agents(), identity(), () => {}));
  assert.equal(productionRunInputSchema.safeParse({ ...legacyInput(), capability: 'camera-scene-v1' }).success, true, 'No new strategy means unchanged valid camera input contract');
  assert.equal(productionRunInputSchema.safeParse({ ...legacyInput(), candidateCount: 2 }).success, true);
  assert.equal(productionRunInputSchema.safeParse({ ...legacyInput(), verifierEngine: 'jev-cascade' }).success, true);
});

test('heterogeneous grouped costs reserve the most expensive role, not merely the plan or largest-call branch', () => {
  const models = agents(); models.find(agent => agent.role === 'developer')!.pricing = { inputPerMillion: 100, outputPerMillion: 200, currency: 'USD' };
  const report = buildProductionLaunchPreflight(input(), models, identity(), () => {});
  const expensive = estimateProductionCost(models.find(agent => agent.role === 'developer')!.pricing, 65536, 6000)!;
  assert.equal(report.budget.envelope.baseEstimatedCost, 16 * expensive); assert.equal(report.budget.envelope.worstCaseEstimatedCost, 28 * expensive);
  assert.equal(report.budget.firstRequest.estimatedCost, .0268608); assert.equal(report.ready, true);
  assert.ok(report.warnings.some(warning => warning.code === 'cost-envelope-exceeds-budget'));
  models[0].pricing!.currency = 'CNY'; const mismatch = buildProductionLaunchPreflight(input(), models, identity(), () => {});
  assert.equal(mismatch.ready, false); assert.equal(mismatch.budget.firstRequest.estimatedCost, null); assert.equal(mismatch.budget.envelope.worstCaseEstimatedCost, null);
});

test('leaving strategy absent preserves every old report field and hash rather than storing a new default', () => {
  const models = agents(); const execution = identity(); const value = legacyInput();
  const legacy = buildProductionLaunchPreflight(value, models, execution, () => {});
  const explicitlyAbsent = buildProductionLaunchPreflight({ ...value, acceptanceStrategy: undefined }, models, execution, () => {});
  // undefined is not a JSON wire value; compare the actual serialized public
  // representation and hash, while checking a genuinely omitted field stays absent.
  assert.equal(JSON.stringify(explicitlyAbsent), JSON.stringify(legacy)); assert.equal(explicitlyAbsent.reportHash, legacy.reportHash);
  assert.equal(Object.hasOwn(legacy.input, 'acceptanceStrategy'), false);
  assert.equal(Object.hasOwn(legacy, 'configuration'), false);
  assert.equal(legacy.budget.baseCalls, 12); assert.equal(legacy.budget.worstCaseCalls, 24);
  assert.equal(legacy.warnings.some(warning => warning.code === 'planned-groups-not-real-validated'), false);
  assert.notEqual(buildProductionLaunchPreflight(input(), models, execution, () => {}).reportHash, legacy.reportHash);
});

test('the frozen HTML04 public preflight is reproduced byte-semantically with no opt-in or current-history migration', () => {
  const bytes = readFileSync(new URL('../docs/production/experiments/HTML-04/launch-preflight.json', import.meta.url));
  const archived = JSON.parse(bytes.toString('utf8'));
  const metadata = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-04/platform-metadata.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4d5377191c95d71f37029a4d64dcbe1744567fc43ce26bbb6c2c644b04bb3fb3');
  const replay = buildProductionLaunchPreflight(archived.input, archived.models, metadata.executionIdentity, () => {});
  assert.deepEqual(replay, archived); assert.equal(replay.reportHash, '488381b84197d3e66da2e33864a965a2e259e315fceb82e511d94a768fd6ac92');
  assert.equal(Object.hasOwn(replay.input, 'acceptanceStrategy'), false); assert.equal(replay.modelRequests, 0);
  assert.deepEqual(readFileSync(new URL('../docs/production/experiments/HTML-04/launch-preflight.json', import.meta.url)), bytes);
});

test('the grouped free API binds the opt-in and rejects incompatible inputs without decryption, persistence or dispatch', async t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-grouped-preflight-api-'));
  let forbiddenOperations = 0;
  const forbidden = () => { forbiddenOperations++; throw new Error('Grouped free fixture attempted a forbidden operation'); };
  const service = createProductionService(directory, { executionIdentity: identity(), assertExecutionFresh: () => {}, roleCall: async () => forbidden() });
  const credential = 'grouped-free-fixture-token-20261008';
  for (const model of service.store.agents()) service.store.patchAgent(model.id, { apiKey: credential, pricing: { inputPerMillion: .30, outputPerMillion: 1.20, currency: 'USD' } });
  const beforeFiles = readdirSync(directory, { recursive: true }).sort();
  for (const method of ['decrypt', 'secretAgents', 'runAgents', 'secretJevConfig', 'redact', 'sanitize', 'persist', 'addRun', 'save', 'writeArtifact', 'saveJevBenchmark']) Reflect.set(service.store, method, forbidden);
  Reflect.set(service.pipeline, 'start', forbidden); Reflect.set(service.studies, 'start', forbidden); Reflect.set(service.studies, 'prepare', forbidden);
  const app = express(); app.use(express.json()); app.use('/api/production', service.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`; const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (target: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = target instanceof Request ? new URL(target.url) : new URL(String(target));
    assert.equal(url.origin, origin, 'No provider/network request may escape the loopback free fixture');
    return localFetch(target, init);
  });
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  const body = { ...input(), agentIds: service.store.agents().map(model => model.id) };
  const request = (value: unknown) => fetch(`${origin}/api/production/runs/preflight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const response = await request(body); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = await response.json(); assert.equal(report.ready, true); assert.equal(report.paidAuthorized, false); assert.equal(report.modelRequests, 0); assert.equal(report.finalGate, null);
  assert.equal(report.input.acceptanceStrategy, 'planned-groups-v1'); assert.equal(report.input.budgetAuthorized, false);
  assert.equal(report.budget.baseCalls, 16); assert.equal(report.budget.worstCaseCalls, 28); assert.ok(report.warnings.some((warning: { code: string }) => warning.code === 'planned-groups-not-real-validated'));
  assert.equal(JSON.stringify(report).includes(credential), false);
  let fixedError: unknown;
  for (const mutation of [{ budgetAuthorized: true }, { candidateCount: 2 }, { capability: 'camera-scene-v1' }, { mode: 'demo' }, { verifierEngine: 'jev-cascade' }, { implementationEvidencePolicy: 'source-bound-v1' }, { acceptanceStrategy: 'not-registered' }, { brief: credential }]) {
    const refused = await request({ ...body, ...mutation }); assert.equal(refused.status, 400); assert.equal(refused.headers.get('cache-control'), 'no-store');
    const error = await refused.json(); fixedError ??= error; assert.deepEqual(error, fixedError); assert.equal(JSON.stringify(error).includes(credential), false);
  }
  assert.equal(forbiddenOperations, 0); assert.equal(service.pipeline.busy, false); assert.equal(service.studies.busy, false);
  assert.deepEqual(service.store.runs(), []); assert.deepEqual(service.store.jevBenchmarks(), []); assert.deepEqual(service.studies.list(), []);
  assert.deepEqual(readdirSync(directory, { recursive: true }).sort(), beforeFiles);
});
