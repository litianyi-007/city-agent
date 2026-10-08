import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PRODUCTION_ROLES, productionRunInputSchema, type ProductionAgent, type ProductionRunInput } from '../shared/production-schema.js';
import { estimateProductionCost, productionLaunchCallEnvelope, PRODUCTION_INPUT_TOKEN_RESERVATION } from '../shared/production-launch-preflight.js';
import { buildProductionLaunchPreflight } from '../server/production/launch-preflight.js';
import { EXECUTION_IDENTITY_LIMITATION, PRODUCTION_EXECUTION_IDENTITY_VERSION, type ProductionExecutionIdentity } from '../server/production/provenance.js';

function agents(): ProductionAgent[] {
  return PRODUCTION_ROLES.map((role, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: role, role, provider: 'deepseek', baseUrl: 'https://api.example.invalid', modelId: 'declared-fixture-model', hasApiKey: true, enabled: true, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } }));
}
function input(models = agents()): ProductionRunInput {
  return productionRunInputSchema.parse({ brief: '  添加、完成、删除待办事项  ', mode: 'live', capability: 'offline-single-html', verifierEngine: 'llm-rubric', budgetAuthorized: false, agentIds: models.map(agent => agent.id), candidateCount: 2, requirement: { id: '  HTML-PREPARE  ', source: '用户声明', acceptance: '添加后条目出现、完成后计数变化、删除后条目消失。', kind: 'user-declared-real' }, limits: { maxCalls: 80, maxTokens: 5_000_000, maxCost: 100 } });
}
function identity(): ProductionExecutionIdentity {
  return { version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId: 'fixture-boot', startedAt: '2026-10-08T00:00:00.000Z', commit: 'a'.repeat(40), sourceClean: true, sourceFingerprint: 'b'.repeat(64), sourceFiles: [], buildSnapshot: { platformCommit: 'a'.repeat(40), sourceClean: true, builtAt: '2026-10-07T23:00:00.000Z' }, buildFingerprint: 'c'.repeat(64), buildFiles: [], ready: true, issues: [], limitation: EXECUTION_IDENTITY_LIMITATION };
}
const issueCodes = (report: ReturnType<typeof buildProductionLaunchPreflight>) => report.issues.map(issue => issue.code);

test('launch reservations reuse exact paid cost arithmetic and bound shared repair branches', () => {
  assert.equal(PRODUCTION_INPUT_TOKEN_RESERVATION, 65536);
  assert.equal(estimateProductionCost(undefined, 65536, 6000), null);
  assert.equal(estimateProductionCost(null, 65536, 6000), null);
  assert.equal(estimateProductionCost({ inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY' }, 65536, 6000), 0);
  assert.equal(estimateProductionCost(agents()[0]!.pricing, 65536, 6000), (65536 * 0.3 + 6000 * 1.2) / 1e6);
  for (const candidates of [1, 2] as const) for (const repair of [0, 1, 2]) {
    assert.deepEqual(productionLaunchCallEnvelope(candidates, repair), { baseCalls: 6 * (candidates + 1), worstCaseCalls: (6 + 3 * repair) * (candidates + 1) });
  }
});

test('free ready report binds normalized requirements, six public models and boot/build identity without authorization', () => {
  const models = agents(); const execution = identity(); const raw = { ...input(), brief: '  添加待办事项  ' }; let freshChecks = 0;
  const before = JSON.stringify({ raw, models, execution });
  const report = buildProductionLaunchPreflight(raw, models, execution, () => { freshChecks++; });
  assert.equal(report.ready, true); assert.equal(freshChecks, 1);
  assert.equal(report.paidAuthorized, false); assert.equal(report.finalGate, null); assert.equal(report.modelRequests, 0);
  assert.equal(report.input.budgetAuthorized, false); assert.equal(report.input.brief, '添加待办事项');
  assert.equal(report.input.requirement.acceptance, raw.requirement.acceptance);
  assert.deepEqual(report.models.map(model => model.role), [...PRODUCTION_ROLES]);
  assert.deepEqual(report.execution, { bootId: execution.bootId, startedAt: execution.startedAt, commit: execution.commit, sourceClean: true, sourceFingerprint: execution.sourceFingerprint, buildFingerprint: execution.buildFingerprint, buildSnapshot: execution.buildSnapshot, ready: true, fresh: true });
  assert.equal(report.budget.baseCalls, 18); assert.equal(report.budget.worstCaseCalls, 36);
  assert.equal(report.budget.firstRequest.totalTokens, 71536);
  assert.deepEqual(report.warnings.map(warning => warning.code), ['not-paid-authorization', 'acceptance-not-frozen', 'reservation-not-billing', 'budget-may-stop-early']);
  const { reportHash, ...payload } = report;
  assert.equal(reportHash, createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.equal(JSON.stringify({ raw, models, execution }), before);
  assert.equal(buildProductionLaunchPreflight(raw, models, execution, () => {}).reportHash, reportHash);
});

test('preflight accepts separately disclosed source-bound policy but cannot be a paid or Mock shortcut', () => {
  const report = buildProductionLaunchPreflight({ ...input(), implementationEvidencePolicy: 'source-bound-v1' }, agents(), identity(), () => {});
  assert.equal(report.ready, true); assert.ok(report.warnings.some(warning => warning.code === 'source-bound-not-real-validated'));
  for (const change of [{ budgetAuthorized: true }, { budgetAuthorized: undefined }, { mode: 'demo' }, { mode: 'mock-jev' }, { capability: 'camera-scene-v1' }, { verifierEngine: 'jev-cascade' }, { arbitraryOverride: true }]) {
    assert.throws(() => buildProductionLaunchPreflight({ ...input(), ...change }, agents(), identity(), () => {}));
  }
  const { budgetAuthorized: _missing, ...missingAuthorization } = input();
  assert.throws(() => buildProductionLaunchPreflight(missingAuthorization, agents(), identity(), () => {}));
  assert.throws(() => buildProductionLaunchPreflight(null, agents(), identity(), () => {}));
  // Existing paid/default input contract is not changed by this free endpoint.
  assert.equal(productionRunInputSchema.parse({ ...input(), budgetAuthorized: true }).budgetAuthorized, true);
  const { mode: _mode, implementationEvidencePolicy: _policy, ...defaults } = input();
  assert.equal(productionRunInputSchema.parse(defaults).mode, 'demo');
});

test('each selected enabled role must be uniquely present with a public key state and declared valid rate', () => {
  const baseline = input();
  const mutations: Array<{ code: string; change: (models: ProductionAgent[]) => void }> = [
    { code: 'agent-disabled', change: models => { models[0]!.enabled = false; } },
    { code: 'agent-key-missing', change: models => { models[2]!.hasApiKey = false; } },
    { code: 'agent-pricing-missing', change: models => { delete models[3]!.pricing; } },
    { code: 'agent-selection-invalid', change: models => { models[5]!.role = 'product'; } },
    { code: 'agent-selection-invalid', change: models => { models[5]!.id = models[0]!.id; } },
    { code: 'agent-selection-invalid', change: models => { Reflect.deleteProperty(models[0]!, 'provider'); } },
    { code: 'agent-selection-invalid', change: models => { models[0]!.pricing!.inputPerMillion = Infinity; } },
  ];
  for (const mutation of mutations) {
    const models = agents(); mutation.change(models);
    const report = buildProductionLaunchPreflight(baseline, models, identity(), () => {});
    assert.equal(report.ready, false); assert.ok(issueCodes(report).includes(mutation.code as never), mutation.code);
    assert.equal(report.modelRequests, 0);
  }
  for (const ids of [[baseline.agentIds[0]!, ...baseline.agentIds.slice(0, 5)], [...baseline.agentIds.slice(0, 5), '00000000-0000-4000-8000-000000000099']]) {
    assert.ok(issueCodes(buildProductionLaunchPreflight({ ...baseline, agentIds: ids }, agents(), identity(), () => {})).includes('agent-selection-invalid'));
  }
  const privateFieldModels = agents(); Reflect.set(privateFieldModels[0]!, 'apiKey', 'synthetic-private-field-must-never-be-copied');
  assert.equal(JSON.stringify(buildProductionLaunchPreflight(baseline, privateFieldModels, identity(), () => {})).includes('synthetic-private-field'), false);
});

test('currency mismatch is unknown cost, not an invented conversion; same-currency CNY remains supported', () => {
  const models = agents(); models[0]!.pricing!.currency = 'CNY';
  const mismatch = buildProductionLaunchPreflight(input(), models, identity(), () => {});
  assert.equal(mismatch.ready, false); assert.ok(issueCodes(mismatch).includes('agent-currency-mismatch'));
  assert.equal(mismatch.budget.firstRequest.estimatedCost, null);
  assert.equal(mismatch.budget.envelope.baseEstimatedCost, null); assert.equal(mismatch.budget.envelope.worstCaseEstimatedCost, null);
  for (const model of models) model.pricing!.currency = 'CNY';
  const cny = buildProductionLaunchPreflight({ ...input(), limits: { ...input().limits, currency: 'CNY' } }, models, identity(), () => {});
  assert.equal(cny.ready, true); assert.equal(cny.budget.firstRequest.currency, 'CNY'); assert.ok(cny.budget.firstRequest.estimatedCost! > 0);
});

test('first request must fit both budgets while larger conservative envelopes only warn', () => {
  const baseline = input(); const firstTokens = 65536 + baseline.limits.maxOutputTokens;
  const firstCost = estimateProductionCost(agents()[0]!.pricing, 65536, baseline.limits.maxOutputTokens)!;
  const limits = { ...baseline.limits, maxCalls: 12, maxTokens: firstTokens, maxCost: firstCost };
  const equal = buildProductionLaunchPreflight({ ...baseline, limits }, agents(), identity(), () => {});
  assert.equal(equal.ready, true);
  assert.ok(equal.warnings.some(warning => warning.code === 'call-envelope-exceeds-budget'));
  assert.ok(equal.warnings.some(warning => warning.code === 'token-envelope-exceeds-budget'));
  assert.ok(equal.warnings.some(warning => warning.code === 'cost-envelope-exceeds-budget'));
  const tokenShort = buildProductionLaunchPreflight({ ...baseline, limits: { ...limits, maxTokens: firstTokens - 1 } }, agents(), identity(), () => {});
  assert.ok(issueCodes(tokenShort).includes('first-request-token-budget'));
  const costShort = buildProductionLaunchPreflight({ ...baseline, limits: { ...limits, maxCost: firstCost / 2 } }, agents(), identity(), () => {});
  assert.ok(issueCodes(costShort).includes('first-request-cost-budget'));
});

test('heterogeneous-role upper bound covers expensive developer repair, not only longest planning weights', () => {
  const models = agents(); models[3]!.pricing = { inputPerMillion: 100, outputPerMillion: 200, currency: 'USD' };
  const report = buildProductionLaunchPreflight(input(), models, identity(), () => {});
  const high = estimateProductionCost(models[3]!.pricing, 65536, 6000)!;
  assert.equal(report.ready, true);
  assert.equal(report.budget.envelope.baseEstimatedCost, 18 * high);
  assert.equal(report.budget.envelope.worstCaseEstimatedCost, 36 * high);
  assert.equal(report.budget.firstRequest.estimatedCost, estimateProductionCost(models[0]!.pricing, 65536, 6000));
  assert.ok(report.warnings.some(warning => warning.code === 'cost-envelope-exceeds-budget'));
});

test('unready or drifting execution is fixed, bounded and never exposes arbitrary failure text or paths', () => {
  for (const change of [{ ready: false }, { sourceClean: false }, { commit: null }, { sourceFingerprint: null }, { buildFingerprint: null }, { buildSnapshot: { ...identity().buildSnapshot!, sourceClean: false } }, { buildSnapshot: { ...identity().buildSnapshot!, platformCommit: 'd'.repeat(40) } }, { issues: ['dirty-worktree'] as const }]) {
    const report = buildProductionLaunchPreflight(input(), agents(), { ...identity(), ...change }, () => {});
    assert.equal(report.ready, false); assert.ok(issueCodes(report).includes('execution-unready'));
  }
  const report = buildProductionLaunchPreflight(input(), agents(), identity(), () => { throw new Error('synthetic-secret-with-private-path /private/config'); });
  assert.ok(issueCodes(report).includes('execution-stale'));
  assert.equal(JSON.stringify(report).includes('synthetic-secret-with-private-path'), false);
  assert.equal(JSON.stringify(report).includes('/private/config'), false);
  assert.ok(issueCodes(buildProductionLaunchPreflight(input(), agents(), identity(), undefined)).includes('execution-stale'));
});

test('hash changes for requirement, policy, public model/rate and boot/source/build identities', () => {
  const baseline = buildProductionLaunchPreflight(input(), agents(), identity(), () => {}).reportHash;
  for (const change of [{ brief: '新的真实需求正文' }, { requirement: { ...input().requirement, acceptance: '新的验收标准' } }, { implementationEvidencePolicy: 'source-bound-v1' as const }]) {
    assert.notEqual(buildProductionLaunchPreflight({ ...input(), ...change }, agents(), identity(), () => {}).reportHash, baseline);
  }
  const models = agents(); models[2]!.pricing!.inputPerMillion = 0.4;
  assert.notEqual(buildProductionLaunchPreflight(input(), models, identity(), () => {}).reportHash, baseline);
  models[2]!.modelId = 'new-public-model';
  assert.notEqual(buildProductionLaunchPreflight(input(), models, identity(), () => {}).reportHash, baseline);
  for (const change of [{ bootId: 'new-boot' }, { sourceFingerprint: 'd'.repeat(64) }, { buildFingerprint: 'e'.repeat(64) }]) {
    assert.notEqual(buildProductionLaunchPreflight(input(), agents(), { ...identity(), ...change }, () => {}).reportHash, baseline);
  }
});
