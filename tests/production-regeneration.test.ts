import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { chromium } from 'playwright';
import { productionApiKeySchema, productionRunInputSchema, PRODUCTION_REPAIR_POLICY_VERSION, type ProductionRun } from '../shared/production-schema.js';
import { type JevCandidateContext, type JevEvaluation, type SecretJevConfig, JEV_POLICY_VERSION } from '../shared/jev-schema.js';
import { createProductionService } from '../server/production/index.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import { hash, ProductionStore } from '../server/production/store.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { runRole, RoleResult } from '../server/harness.js';
import { runGate } from '../server/gate.js';
import { diagnoseJsonOutput, OUTPUT_DIAGNOSTICS_VERSION } from '../server/production/output-diagnostics.js';

const INVALID_TEST_JSON = '{"checks":[{"name":"invalid function syntax","steps":[{"assertTextExact":"#result","bare-value"}]}]}';
const standaloneInput = (brief: string) => productionRunInputSchema.parse({ brief, agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'standalone-unit', source: 'Free engineering fixture', acceptance: 'Add tasks and show counts', kind: 'illustrative' } });
const result = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected engineering test; no HTTP' });
const injected: typeof runRole = async (_agent, system, prompt) => {
  const data = JSON.parse(prompt);
  if (system.startsWith('你是独立质量Verifier')) return result({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Explicit injected oracle, not a real model judgment' })), reason: 'Free engineering fixture' });
  if (system.includes('"goal"')) return result({ goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] });
  if (system.includes('"observations"')) return result({ observations: ['Use supplied requirements to implement a list with exact result counts.'], constraints: ['Offline HTML and immutable acceptance only.'], unknowns: ['deferred: real model reliability is unverified'] });
  if (system.includes('"decision"')) return result({ decision: data.context.gate?.passed === false ? 'revise' : 'proceed', summary: 'Scoped fixture decision based on actual control-plane Gate', tasks: [{ id: 'work', owner: 'developer', description: 'Implement or repair the frozen result contract' }], risks: [] });
  if (system.includes('"checks"')) return result({ checks: demoChecks('create') });
  return result({ html: demoHtml(data.input) });
};
function abstain(prompt: string) { const data = JSON.parse(prompt); return result({ decision: 'abstain', selectedCandidateId: null, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 1, reason: 'Injected quality rejection; not true model accuracy' })), reason: 'Concrete fixture quality defect; immutable Gate' }); }
function jevFixture(config: SecretJevConfig, context: JevCandidateContext, status: JevEvaluation['status'] = 'accepted'): JevEvaluation {
  return { policyVersion: JEV_POLICY_VERSION, status, selectedCandidateId: status === 'accepted' ? context.candidates[0].id : null, reason: `Injected ${status}; no network`, requestSnapshot: buildJevCandidateRequest(config.modelId, context), rawResponse: { fixture: true }, scores: [], choice: null, usage: { inputTokens: 100, outputTokens: 0, estimatedCost: 0.0000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1 };
}

function setup(t: TestContext, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-regeneration-unit-'));
  const service = createProductionService(directory, { roleCall: injected, gate: async () => ({ passed: true, checks: [{ name: 'Injected Gate, not browser delivery evidence', passed: true }] }), ...options });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `regeneration-unit-key-${agent.role}-not-real`, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } });
  service.store.patchJevConfig({ enabled: true, apiKey: 'regeneration-jev-unit-key-not-real', minScore: 3, minConfidence: 0.5 });
  const queue = (overrides: Record<string, unknown> = {}) => {
    const input = productionRunInputSchema.parse({ mode: 'live', brief: 'Build a reusable task list', agentIds: service.store.agents().map(agent => agent.id), budgetAuthorized: true, requirement: { id: 'repair-unit', source: 'Free injected engineering fixture', acceptance: 'Add task, reject blank input and show exact count', kind: 'illustrative' }, ...overrides });
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', jevSnapshot: service.store.jevConfig(), agentSnapshot: service.store.agents(), events: [], calls: [], jevCalls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
    service.store.addRun(run, input.agentIds); service.pipeline.start(run); return run.id;
  };
  const wait = async (id: string) => { const deadline = Date.now() + 20000; while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(service.pipeline.busy, false); return service.store.run(id)!; };
  return { directory, service, queue, wait, start: async (overrides: Record<string, unknown> = {}) => wait(queue(overrides)) };
}

test('invalid tester JSON leads to an actual second tester call, revalidation and only then acceptance freeze', async t => {
  let testerCalls = 0; const { service, start } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"checks"') && ++testerCalls === 1) return result(INVALID_TEST_JSON); return injected(...args); } });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(testerCalls, 2); assert.equal(run.repairs, 1); assert.equal(run.repairPolicyVersion, PRODUCTION_REPAIR_POLICY_VERSION); assert.equal(run.evidenceKind, 'injected-test');
  const testers = run.calls.filter(call => call.role === 'tester'); assert.equal(testers[0].rawOutput, INVALID_TEST_JSON); assert.ok(testers[0].error); assert.notEqual(testers[0].candidateId, testers[1].candidateId); assert.equal(testers[1].phase, 'acceptance');
  const regeneration = JSON.parse(testers[1].userPrompt).context.regeneration; assert.equal(regeneration.attempt, 1); assert.equal(regeneration.frozenHash, null); assert.equal(regeneration.rejectedCandidates[0].rawOutputExcerpt, INVALID_TEST_JSON); assert.equal(regeneration.rejectedCandidates[0].rawOutputSha256, hash(INVALID_TEST_JSON)); assert.deepEqual(regeneration.rejectedCandidateIds, [testers[0].candidateId]);
  assert.equal(run.validationContract?.outputDiagnosticsVersion, OUTPUT_DIAGNOSTICS_VERSION);
  assert.deepEqual(testers[0].outputDiagnostic, diagnoseJsonOutput(INVALID_TEST_JSON));
  assert.deepEqual(regeneration.rejectedCandidates[0].outputDiagnostic, testers[0].outputDiagnostic);
  assert.equal(regeneration.rejectedCandidates[0].callId, testers[0].id);
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1); assert.ok(run.frozenContract); assert.equal(run.repairHistory![0].kind, 'stage-regeneration'); assert.equal(run.repairHistory![0].role, 'tester'); assert.equal(run.verifications.filter(review => review.phase === 'acceptance').length, 2);
  const manifest = JSON.parse(service.store.readArtifact(run.id, 'delivery-manifest.json')); assert.equal(manifest.repairPolicyVersion, PRODUCTION_REPAIR_POLICY_VERSION); assert.deepEqual(manifest.repairHistory, run.repairHistory);
});

test('late syntax failure carries a bound error-position excerpt beyond the old prefix, never a repaired answer or reviewer hint', async t => {
  const malformed = `{"observations":["${'x'.repeat(2500)}"]","constraints":["scope"],"unknowns":[]}`;
  let researchCalls = 0; let reviewed = false;
  const { service, start } = setup(t, { roleCall: async (...args) => {
    const data = JSON.parse(args[2]);
    if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"observations"')) {
      researchCalls++;
      if (researchCalls === 1) return result(malformed);
      const rejected = data.context.regeneration.rejectedCandidates[0];
      assert.equal(rejected.rawOutputTruncated, true);
      assert.equal(rejected.rawOutputExcerpt.length, 2000);
      assert.deepEqual(rejected.outputDiagnostic, diagnoseJsonOutput(malformed));
      assert.equal(rejected.outputDiagnostic.sourceSha256, rejected.rawOutputSha256);
      assert.ok(rejected.outputDiagnostic.rawPosition > 2000);
      assert.ok(rejected.outputDiagnostic.excerpt.text.includes(']","constraints"'));
      assert.equal(rejected.outputDiagnostic.excerpt.text, malformed.slice(rejected.outputDiagnostic.excerpt.start, rejected.outputDiagnostic.excerpt.end));
    }
    if (args[1].startsWith('你是独立质量Verifier') && data.criteria.phase === 'research') {
      reviewed = true;
      assert.equal(data.state.reviewContext.regeneration, undefined);
      assert.equal(JSON.stringify(data.state.reviewContext).includes('x'.repeat(320)), false);
    }
    return injected(...args);
  } });
  const run = await start();
  assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test');
  assert.equal(researchCalls, 2); assert.equal(reviewed, true); assert.equal(run.repairs, 1);
  const first = run.calls.find(call => call.role === 'researcher')!;
  assert.equal(first.rawOutput, malformed); assert.equal(first.selected, undefined);
  assert.deepEqual(JSON.parse(service.store.readArtifact(run.id, 'evidence.json')).calls.find((call: ProductionRun['calls'][number]) => call.id === first.id).outputDiagnostic, first.outputDiagnostic);
});

test('syntax diagnostic metadata cannot be masked by an otherwise valid credential substring', () => {
  for (const literal of [OUTPUT_DIAGNOSTICS_VERSION, 'outputDiagnosticsVersion', 'outputDiagnostic']) {
    for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) {
      assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false);
    }
  }
  assert.equal(productionApiKeySchema.safeParse('ordinary_synthetic_metadata_key_0123456789').success, true);
});

test('actual invalid CSS preflight rejects then regenerates the tester, not a silently weakened contract', async t => {
  let attempts = 0; const { start } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"checks"') && ++attempts === 1) { const checks = demoChecks('create'); checks[0].steps[0].selector = '#broken['; return result({ checks }); } return injected(...args); } });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(attempts, 2); assert.match(run.calls.find(call => call.role === 'tester')!.error!, /非法 CSS/); assert.equal(run.repairs, 1); assert.deepEqual(run.frozenContract!.checks, demoChecks('create'));
});

test('semantic rejection regenerates the original tester, preserves raw placeholder and freezes a versioned coverage hash', async t => {
  let testerCalls = 0; let gates = 0; const hashes: string[] = [];
  const { service, start } = setup(t, { roleCall: async (...args) => {
    const data = JSON.parse(args[2]);
    assert.equal((data.context ?? data.state.reviewContext).coverageContract.version, 'production-coverage-owners-v1');
    if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"checks"') && ++testerCalls === 1) {
      const checks = demoChecks('create'); checks[0].steps.push({ action: 'assertTextExact', selector: '#total-count', text: '{{totalCount}}' });
      return result({ checks });
    }
    if (data.context?.frozenContract) hashes.push(data.context.frozenContract.hash);
    return injected(...args);
  }, gate: async () => ({ passed: ++gates > 1, checks: [{ name: 'Injected behavior Gate for global-pool test', passed: gates > 1 }] }) });
  const run = await start(); assert.equal(run.status, 'completed', run.error);
  assert.equal(testerCalls, 2); assert.equal(run.repairs, 2);
  const testers = run.calls.filter(call => call.role === 'tester');
  assert.match(testers[0].rawOutput, /\{\{totalCount\}\}/); assert.match(testers[0].error!, /unbound-expectation/);
  assert.match(JSON.parse(testers[1].userPrompt).context.regeneration.reason, /unbound-expectation/);
  assert.deepEqual(run.frozenContract!.checks, demoChecks('create'));
  assert.equal(run.frozenContract!.validationContractHash, hash(run.validationContract));
  assert.equal(new Set(hashes).size, 1);
  const manifest = JSON.parse(service.store.readArtifact(run.id, 'delivery-manifest.json'));
  assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.validationContractHash, run.frozenContract!.validationContractHash);
  assert.equal(manifest.compactOutputPolicy.version, 'verifier-compact-output-v2');
  assert.equal(run.repairHistory![0].kind, 'stage-regeneration'); assert.equal(run.repairHistory![1].kind, 'gate-repair');
});

test('overlong Verifier reason stays a fatal protocol error with full raw output, not a truncated success or role retry', async t => {
  const { start } = setup(t, { roleCall: async (...args) => {
    if (args[1].startsWith('你是独立质量Verifier')) {
      const data = JSON.parse(args[2]);
      return result({ decision: 'abstain', selectedCandidateId: null, scores: [{ candidateId: data.candidates[0].id, score: 2, reason: 'x'.repeat(1428) }], reason: 'Original role needs correction, but this protocol is illegal.' });
    }
    return injected(...args);
  } });
  const run = await start(); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0);
  assert.equal(JSON.parse(run.calls.at(-1)!.rawOutput).scores[0].reason.length, 1428);
  assert.match(run.error!, /Verifier 校验失败/); assert.equal(run.frozenContract, undefined);
});

test('valid LLM abstention regenerates the original role under the same phase rubric', async t => {
  let denied = false; const { start } = setup(t, { roleCall: async (...args) => { if (args[1].startsWith('你是独立质量Verifier') && JSON.parse(args[2]).criteria.phase === 'research' && !denied) { denied = true; return abstain(args[2]); } return injected(...args); } });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.calls.filter(call => call.role === 'researcher').length, 2); assert.equal(run.repairs, 1); const history = run.repairHistory![0]; assert.equal(history.phase, 'research'); assert.equal(history.role, 'researcher');
  const reviews = run.verifications.filter(review => review.phase === 'research'); assert.deepEqual(reviews.map(review => review.decision), ['abstain', 'accept']); assert.notEqual(reviews[0].criteriaHash, reviews[1].criteriaHash); assert.notEqual(reviews[0].candidateIds[0], reviews[1].candidateIds[0]);
});

test('valid Jev rejection regenerates the original role without pretending a fallback accepted it', async t => {
  let first = true; const { start } = setup(t, { jevCall: async (config, context) => { if (context.phase === 'product' && first) { first = false; return jevFixture(config, context, 'rejected'); } return jevFixture(config, context); } });
  const run = await start({ verifierEngine: 'jev-cascade' }); assert.equal(run.status, 'completed', run.error); assert.equal(run.calls.filter(call => call.role === 'product').length, 2); assert.equal(run.calls.some(call => call.role === 'verifier'), false); assert.equal(run.jevCalls!.length, 7); assert.equal(run.jevCalls![0].evaluation.status, 'rejected'); assert.equal(run.repairs, 1); assert.equal(run.repairHistory![0].role, 'product');
});

test('one stage regeneration and one Gate repair share exactly two global slots and preserve frozen checks', async t => {
  let attempts = 0; let gates = 0; const checksSeen: string[] = [];
  const { start } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"checks"') && ++attempts === 1) return result(INVALID_TEST_JSON); return injected(...args); }, gate: async (_html, checks) => { checksSeen.push(JSON.stringify(checks)); return { passed: ++gates > 1, checks: [{ name: 'Injected first failure', passed: gates > 1 }] }; } });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 2); assert.equal(run.gateHistory.length, 2); assert.deepEqual(run.repairHistory!.map(repair => [repair.attempt, repair.kind]), [[1, 'stage-regeneration'], [2, 'gate-repair']]); assert.equal(new Set(checksSeen).size, 1);
  assert.equal(run.repairHistory![0].frozenHash, null); assert.equal(run.repairHistory![1].frozenHash, run.frozenContract!.hash); const development = run.calls.filter(call => call.role === 'developer'); assert.equal(development.length, 2); assert.equal(JSON.parse(development[1].userPrompt).context.frozenContract.hash, run.frozenContract!.hash);
});

test('exhausted stage pool forbids subsequent Gate repair and retains actual failed Gate evidence', async t => {
  let attempts = 0; const { start } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"checks"') && ++attempts <= 2) return result(INVALID_TEST_JSON); return injected(...args); }, gate: async () => ({ passed: false, checks: [{ name: 'Real recorded fixture failure', passed: false }] }) });
  const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.repairs, 2); assert.equal(run.repairHistory!.length, 2); assert.equal(attempts, 3); assert.equal(run.gateHistory.length, 1); assert.equal(run.calls.filter(call => call.role === 'developer').length, 1); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

test('feedback regeneration uses current global budget, then Gate repair leaves no third quality regeneration', async t => {
  let feedbackReviews = 0; let gates = 0; const budgets: number[] = []; let fixture: ReturnType<typeof setup>;
  fixture = setup(t, { roleCall: async (...args) => { const data = JSON.parse(args[2]); if (args[1].startsWith('你是独立质量Verifier') && data.criteria.phase.startsWith('feedback-')) { feedbackReviews++; if (feedbackReviews === 1 || feedbackReviews === 3) return abstain(args[2]); } else if (!args[1].startsWith('你是独立质量Verifier') && args[1].includes('"decision"') && data.context.gate) { const actual = fixture.service.store.runs()[0].input.limits.maxRepairCycles - fixture.service.store.runs()[0].repairs; assert.equal(data.context.remainingRepairs, actual); assert.equal(data.context.repairBudget.remaining, actual); budgets.push(actual); } return injected(...args); }, gate: async () => ({ passed: ++gates > 1, checks: [{ name: 'Fixture Gate', passed: gates > 1 }] }) });
  const run = await fixture.start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽/); assert.deepEqual(budgets, [2, 1, 0]); assert.equal(run.repairs, 2); assert.equal(run.repairHistory![0].role, 'project-manager'); assert.equal(run.repairHistory![1].kind, 'gate-repair'); assert.equal(run.repairHistory!.every(repair => repair.frozenHash === run.frozenContract!.hash), true); assert.equal(run.gateHistory.length, 2);
});

test('persistent invalid candidates exhaust the shared pool with all original raw outputs retained and bounded feedback', async t => {
  const hugeInvalid = '{malformed-' + 'untrusted-text-'.repeat(2000); const { start } = setup(t, { roleCall: async () => result(hugeInvalid) }); const run = await start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(run.calls.length, 3); assert.equal(run.verifications.length, 3); assert.equal(run.calls.every(call => call.rawOutput === hugeInvalid), true); assert.equal(run.repairHistory!.length, 2);
  const context = JSON.parse(run.calls[1].userPrompt).context.regeneration; assert.equal(context.rejectedCandidates[0].rawOutputExcerpt.length, 2000); assert.equal(context.rejectedCandidates[0].rawOutputTruncated, true); assert.equal(context.rejectedCandidates[0].rawOutputSha256, hash(hugeInvalid)); assert.ok(context.reason.length <= 2000);
});

test('provider/auth errors, unknown usage and illegal Verifier protocol stop without consuming retries', async t => {
  for (const kind of ['provider', 'unknown', 'protocol'] as const) {
    const { start } = setup(t, { roleCall: async (...args) => { if (kind === 'provider') throw new Error('Injected provider authentication 401'); const base = await injected(...args); if (kind === 'unknown') return { ...base, usageReported: false }; if (args[1].startsWith('你是独立质量Verifier')) return result({ decision: 'accept', selectedCandidateId: 'not-current', scores: [], reason: 'invalid protocol' }); return base; } });
    const run = await start(); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []); assert.equal(run.calls.length, kind === 'protocol' ? 2 : 1); assert.equal(run.outputs.length, 0);
  }
});

test('Jev errors and unknown usage never cause regeneration or synthetic fallback', async t => {
  for (const kind of ['error', 'unknown'] as const) { let calls = 0; const { start } = setup(t, { jevCall: async (config, context) => { calls++; const evaluation = jevFixture(config, context, kind === 'error' ? 'error' : 'rejected'); return kind === 'unknown' ? { ...evaluation, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } } : evaluation; } }); const run = await start({ verifierEngine: 'jev-cascade' }); assert.equal(run.status, 'failed'); assert.equal(calls, 1); assert.equal(run.calls.length, 1); assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []); }
});

test('preflight infrastructure failure is not caught as malformed tester content; budget stops before calls', async t => {
  const { start } = setup(t, { acceptancePreflight: async () => { throw new Error('Injected Chromium unavailable; infrastructure fault'); } }); const run = await start(); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0); assert.equal(run.calls.filter(call => call.role === 'tester').length, 1); assert.match(run.calls.at(-1)!.error!, /预检环境失败/); assert.equal(run.frozenContract, undefined);
  const low = setup(t); const limits = productionRunInputSchema.parse({ brief: 'Unit only', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'unit', source: 'unit', acceptance: 'unit' } }).limits; const budget = await low.start({ limits: { ...limits, maxCost: 0.000001 } }); assert.equal(budget.status, 'failed'); assert.equal(budget.calls.length, 0); assert.equal(budget.repairs, 0);
});

test('cancelled pending role and preflight are cleaned up without regeneration', async t => {
  for (const phase of ['role', 'preflight'] as const) {
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const options: ProductionOptions = phase === 'role' ? { roleCall: async (_agent, _system, _prompt, signal) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled role', 'AbortError')), { once: true })); } } : { acceptancePreflight: async (_checks, signal) => { entered(); return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Canceled preflight', 'AbortError')), { once: true })); } };
    const { service, queue, wait } = setup(t, options); const id = queue(); await enteredPromise; service.pipeline.cancel(id); const run = await wait(id); assert.equal(run.status, 'cancelled'); assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []); assert.equal(run.interventions.length, 1);
  }
});

test('Gate cannot mutate frozen assertions then report pass, and historical runs receive no implicit repair-policy migration', async t => {
  const { start } = setup(t, { gate: async (_html, checks) => { checks[0].name = 'Mutated frozen Gate'; return { passed: true, checks: [{ name: 'fake pass', passed: true }] }; } }); const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /改变冻结门禁输入/); assert.equal(run.gateHistory.length, 1); assert.deepEqual(run.frozenContract!.checks, demoChecks('create')); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
  const old = setup(t); const id = old.queue(); await old.wait(id); const historical = old.service.store.run(id)!; delete historical.repairPolicyVersion; delete historical.repairHistory; old.service.store.save(historical); const loaded = new ProductionStore(old.directory).run(id)!; assert.equal(loaded.repairPolicyVersion, undefined); assert.equal(loaded.repairHistory, undefined);
  for (const protocol of [PRODUCTION_REPAIR_POLICY_VERSION, 'stage-regeneration', 'repairPolicyVersion', 'rejectedCandidateIds', 'remainingRepairs', 'rawOutputExcerpt', 'rawOutputTruncated', 'rawOutputSha256']) assert.equal(productionApiKeySchema.safeParse(protocol).success, false, 'New policy label cannot become a redaction credential');
});

test('actual default Gate launch failure preserves typed environment evidence and performs no PM or developer retry', async t => {
  const originalLaunch = chromium.launch; let launches = 0;
  chromium.launch = async () => { launches++; throw new Error("Executable doesn't exist (injected local environment fault)"); };
  try {
    const { start } = setup(t, { gate: undefined, acceptancePreflight: async () => ({ valid: true, errors: [] }) }); const run = await start();
    assert.equal(run.status, 'failed'); assert.equal(run.gate!.failureKind, 'infrastructure'); assert.equal(run.gateHistory.length, 1); assert.equal(run.gateHistory[0].failureKind, 'infrastructure'); assert.match(run.error!, /Gate infrastructure/); assert.equal(run.repairs, 0); assert.deepEqual(run.repairHistory, []);
    assert.equal(launches, 1); assert.equal(run.calls.filter(call => call.role === 'developer').length, 1); assert.equal(run.calls.filter(call => call.role === 'project-manager').length, 1); assert.equal(run.calls.some(call => call.phase.startsWith('feedback-')), false); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
  } finally { chromium.launch = originalLaunch; }
});

test('total executor timeout is distinct from business check failure and is fatal to the pipeline', async t => {
  const originalLaunch = chromium.launch; const originalTimeout = globalThis.setTimeout;
  chromium.launch = async () => new Promise(() => {});
  // Exercise the real total-timeout path using a process-local accelerated
  // clock; no production timeout values, browser resources or model calls change.
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => originalTimeout(callback, milliseconds === 60000 ? 5 : milliseconds, ...args)) as typeof setTimeout;
  let gate;
  try { gate = await runGate(demoHtml(standaloneInput('Free timeout fixture')), demoChecks('create')); assert.equal(gate.failureKind, 'timeout'); assert.equal(gate.passed, false); }
  finally { chromium.launch = originalLaunch; globalThis.setTimeout = originalTimeout; }
  const { start } = setup(t, { gate: async () => gate }); const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /Gate timeout/); assert.equal(run.repairs, 0); assert.equal(run.gateHistory.length, 1); assert.equal(run.calls.some(call => call.phase.startsWith('feedback-')), false);
});

test('model-controlled test names and JavaScript error text cannot forge an infrastructure marker', async () => {
  const checks = demoChecks('create').map(check => ({ ...check, name: 'Chromium infrastructure failure fake' }));
  const html = demoHtml(standaloneInput('Free classification fixture')).replace('</body>', '<script>throw new Error("Executable doesn\\\'t exist; infrastructure");</script></body>');
  const gate = await runGate(html, checks); assert.equal(gate.passed, false); assert.equal(gate.failureKind, undefined);
});
