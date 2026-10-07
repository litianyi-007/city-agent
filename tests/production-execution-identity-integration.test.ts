import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test, type TestContext } from 'node:test';
import type { Request, Response } from 'express';
import { createProductionService } from '../server/production/index.js';
import { ProductionPipeline } from '../server/production/pipeline.js';
import { ProductionStore } from '../server/production/store.js';
import { captureProductionExecutionIdentity, EXECUTION_IDENTITY_REQUIRED_SOURCES, type ExecutionDiskEvidence } from '../server/production/provenance.js';
import { runJevBenchmark } from '../server/production/jev-benchmark.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { DEFAULT_JEV_CONFIG, JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation, type SecretJevConfig } from '../shared/jev-schema.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';

// Engineering-only trusted injections. No API listener, browser/SDK or model
// transport is started; the API wrapper is called as a plain function.
const originalFetch = globalThis.fetch; let prohibitedFetches = 0;
before(() => { globalThis.fetch = async () => { prohibitedFetches++; throw new Error('No HTTP in execution-identity integration fixture'); }; });
after(() => { globalThis.fetch = originalFetch; assert.equal(prohibitedFetches, 0); });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function identity() {
  const commit = 'a'.repeat(40);
  const files = (names: readonly string[]) => names.map(name => ({ path: name, sha256: sha(`public-fixture:${name}`), bytes: name.length + 15 }));
  const current: ExecutionDiskEvidence = { commit, sourceClean: true, sourceFiles: files(EXECUTION_IDENTITY_REQUIRED_SOURCES), buildSnapshot: { platformCommit: commit, sourceClean: true, builtAt: new Date(Date.now() - 60000).toISOString() }, buildFiles: files(['dist/index.html', 'dist/production-build.json', 'dist/assets/fixture.js']) };
  const guard = captureProductionExecutionIdentity({ reader: () => current, bootId: 'injected-boot-A' });
  let freshnessChecks = 0;
  return { boot: guard.bootIdentity, drift: () => { current.sourceFiles[0] = { ...current.sourceFiles[0], sha256: sha('changed public source') }; }, assertFresh: () => { freshnessChecks++; guard.assertFresh(); }, checks: () => freshnessChecks };
}
function temporaryDirectory() { return mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-execution-identity-integration-')); }
function configure(store: ProductionStore) {
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://fixture.invalid', apiKey: `execution-identity-fixture-token-${agent.role}`, pricing: { inputPerMillion: 0.30, outputPerMillion: 1.20, currency: 'USD' } });
  store.patchJevConfig({ enabled: true, apiKey: 'execution-identity-jev-fixture-token' });
}
function input(store: ProductionStore, mode: 'live' | 'mock-jev' = 'live', useJev = false) {
  const fixture = PRODUCTION_DEMO_CASES[0];
  return productionRunInputSchema.parse({ brief: fixture.brief, mode, ...(mode === 'mock-jev' ? { demoCaseId: fixture.operation } : {}), verifierEngine: useJev ? 'jev-cascade' : 'llm-rubric', budgetAuthorized: true, agentIds: store.agents().map(agent => agent.id), limits: { maxCalls: 30, maxCost: 1 }, requirement: { id: 'INJECTED-IDENTITY', source: 'Pure engineering fixture; no model/business success', acceptance: fixture.acceptance, kind: 'illustrative' } });
}
function invokeRunEndpoint(service: ReturnType<typeof createProductionService>, body: unknown) {
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => unknown }> } };
  const layer = (service.router.stack as unknown as Layer[]).find(item => item.route?.path === '/runs' && item.route.methods.post);
  assert.ok(layer?.route); let status = 200; let value: unknown;
  const response = { status(code: number) { status = code; return this; }, json(item: unknown) { value = item; return this; } };
  layer.route.stack[0].handle({ body } as Request, response as unknown as Response);
  return { status, value };
}
function accepted(config: SecretJevConfig, context: JevCandidateContext): JevEvaluation {
  return { policyVersion: JEV_POLICY_VERSION, status: 'accepted', selectedCandidateId: context.candidates[0].id, reason: 'Injected quality oracle only, zero HTTP', requestSnapshot: buildJevCandidateRequest(config.modelId, context), rawResponse: { fixture: true }, scores: [], choice: null, usage: { inputTokens: 40, outputTokens: 5, estimatedCost: 40 * config.inputPerMillion / 1e6, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1 };
}

test('live and paid Mock/Jev API startup drift refuses before run registration, any role or Jev evaluator', async t => {
  for (const mode of ['live', 'mock-jev'] as const) {
    const directory = temporaryDirectory(); const control = identity(); let roles = 0; let jev = 0;
    const service = createProductionService(directory, { executionIdentity: control.boot, assertExecutionFresh: control.assertFresh, roleCall: async () => { roles++; throw new Error('Should not reach injected role'); }, jevCall: async () => { jev++; throw new Error('Should not reach injected Jev'); }, gate: async () => { throw new Error('Should not reach injected Gate'); }, acceptancePreflight: async () => ({ valid: true, errors: [] }) });
    try {
      configure(service.store); control.drift();
      const result = invokeRunEndpoint(service, input(service.store, mode, true));
      assert.equal(result.status, 400); assert.match((result.value as { error: string }).error, /execution-identity-drift/);
      assert.equal(service.store.runs().length, 0); assert.equal(service.pipeline.busy, false);
      assert.equal(roles, 0); assert.equal(jev, 0); assert.equal(control.checks(), 1);
      assert.equal(control.boot.commit, 'a'.repeat(40));
    } finally { await service.close(); rmSync(directory, { recursive: true, force: true }); }
  }
  t.diagnostic('API handlers executed directly: zero local listeners and zero model/provider HTTP.');
});

async function pipelineFixture(t: TestContext, options: { useJev?: boolean; driftAfterRole?: 'product' | 'researcher'; foreignBoot?: boolean }) {
  const directory = temporaryDirectory(); const store = new ProductionStore(directory); configure(store); const control = identity();
  const runInput = input(store, 'live', options.useJev);
  const run: ProductionRun = { id: randomUUID(), input: runInput, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', platformCommit: control.boot.commit!, executionIdentity: { ...control.boot, ...(options.foreignBoot ? { bootId: 'injected-foreign-boot' } : {}) }, agentSnapshot: store.agents(), jevSnapshot: store.jevConfig(), jevCalls: [], calls: [], events: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, runInput.agentIds); const roles: string[] = []; const evaluations: string[] = []; let gates = 0;
  const pipeline = new ProductionPipeline(store, { executionIdentity: control.boot, assertExecutionFresh: control.assertFresh,
    roleCall: async (agent, _system, prompt) => {
      const role = agent.modelId; roles.push(role); const request = JSON.parse(prompt); let value: unknown;
      if (role === 'product') value = { goal: runInput.brief, scope: 'offline-single-html', acceptance: [runInput.requirement.acceptance], exclusions: ['No real-model delivery proof'] };
      else if (role === 'researcher') value = { observations: ['Known fixture input'], constraints: ['No network or host execution'], unknowns: ['Actual model quality unverified'] };
      else if (role === 'verifier') value = { decision: 'accept', selectedCandidateId: request.candidates[0].id, scores: request.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Engineering oracle only' })), reason: 'No actual model dispatch' };
      else throw new Error(`Unexpected late stage ${role}`);
      if (role === options.driftAfterRole) control.drift();
      return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 20, usageReported: true, harness: 'Injected, not provider HTTP' };
    },
    jevCall: async (config, context) => { evaluations.push(context.phase); return accepted(config, context); },
    gate: async () => { gates++; throw new Error('No Gate should be reached'); }, acceptancePreflight: async () => ({ valid: true, errors: [] }),
  });
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  pipeline.start(store.run(run.id)!); const deadline = Date.now() + 5000;
  while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pipeline.busy, false); return { run: store.run(run.id)!, store, control, roles, evaluations, gates };
}

test('mid-run source drift stops the next role/Verifier before its invocation is registered or dispatched', async t => {
  const f = await pipelineFixture(t, { driftAfterRole: 'product' });
  assert.equal(f.run.status, 'failed'); assert.match(f.run.error!, /execution-identity-drift/);
  assert.deepEqual(f.roles, ['product']); assert.deepEqual(f.evaluations, []); assert.equal(f.run.calls.length, 1); assert.equal(f.run.jevCalls!.length, 0);
  assert.equal(f.control.checks(), 2); assert.equal(f.run.repairs, 0); assert.equal(f.run.frozenContract, undefined); assert.equal(f.gates, 0);
  assert.equal(f.run.calls[0].finishedAt !== undefined, true); assert.equal(f.run.usage.complete, true);
  const manifest = JSON.parse(f.store.readArtifact(f.run.id, 'delivery-manifest.json'));
  assert.deepEqual(manifest.executionIdentity, f.control.boot); assert.deepEqual(f.run.executionIdentity, f.control.boot);
  assert.equal(manifest.source, null); assert.equal(manifest.status, 'failed');
});

test('drift before the next Jev evaluation preserves the first evaluation and blocks any subsequent evaluator or fallback', async t => {
  const f = await pipelineFixture(t, { useJev: true, driftAfterRole: 'researcher' });
  assert.equal(f.run.status, 'failed'); assert.match(f.run.error!, /execution-identity-drift/);
  assert.deepEqual(f.roles, ['product', 'researcher']); assert.deepEqual(f.evaluations, ['product']);
  assert.equal(f.control.checks(), 4); assert.equal(f.run.calls.length, 2); assert.equal(f.run.jevCalls!.length, 1);
  assert.equal(f.run.jevCalls![0].phase, 'product'); assert.equal(f.run.jevCalls![0].evaluation.usage.complete, true);
  assert.equal(f.run.repairs, 0); assert.equal(f.run.frozenContract, undefined); assert.equal(f.gates, 0);
  assert.equal(f.run.calls.some(call => call.role === 'verifier'), false); assert.equal(f.run.usage.complete, true);
});

test('a task identity from a different boot is rejected even when the live source guard currently passes', async t => {
  const f = await pipelineFixture(t, { foreignBoot: true });
  assert.equal(f.run.status, 'failed'); assert.match(f.run.error!, /任务启动身份与当前进程不一致/);
  assert.deepEqual(f.roles, []); assert.deepEqual(f.evaluations, []); assert.equal(f.run.calls.length, 0); assert.equal(f.run.jevCalls!.length, 0);
  assert.equal(f.control.checks(), 1); assert.equal(f.run.repairs, 0); assert.equal(f.gates, 0);
});

test('benchmark source drift stops before the next evaluator without another evaluation invocation', async t => {
  const control = identity(); let evaluations = 0; let gates = 0;
  const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'execution-identity-benchmark-fixture-token' };
  const result = await runJevBenchmark(config, new AbortController().signal, { assertExecutionFresh: control.assertFresh,
    evaluate: async (pinned, context) => { evaluations++; const result = accepted(pinned, context); control.drift(); return result; },
    gate: async () => { gates++; return { passed: true, checks: [{ name: 'Injected oracle, not browser evidence', passed: true }] }; },
  });
  assert.equal(result.status, 'failed'); assert.equal(evaluations, 1); assert.equal(control.checks(), 3, 'The first request is checked before and after persisting intent; next case is refused before dispatch');
  assert.equal(result.evidenceSource, 'injected-test'); assert.equal(result.gateSource, 'injected-test');
  assert.match(result.cases[1].evaluationError!, /execution-identity-drift/);
  assert.equal(result.cases[0].evaluation !== null, true); assert.equal(result.cases[1].evaluation, null); assert.equal(result.cases[2].status, 'skipped');
  assert.equal(result.cases[1].evaluationInvoked, false, 'A control-side refusal is not an evaluator invocation');
  assert.equal(result.cases.filter(item => item.evaluationInvoked).length, 1, 'Only the first evaluator was invoked');
  assert.equal(result.usage.evaluationAttempts, 2, 'Historical field counts attempted case intents, not physical dispatches');
  assert.equal(result.metrics.attemptedCases, 2);
  assert.ok(gates >= 2); t.diagnostic('Both evaluator and Gates are pure injections; provider HTTP remains zero.');
});

test('benchmark rechecks source after awaiting intent persistence and resets a refused invocation to known zero dispatches', async t => {
  const control = identity(); let evaluations = 0; let persistedPending = false;
  const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'execution-identity-benchmark-fixture-token' };
  const result = await runJevBenchmark(config, new AbortController().signal, {
    assertExecutionFresh: control.assertFresh,
    onSnapshot: async snapshot => {
      if (!persistedPending && snapshot.cases[0].evaluationInvoked && snapshot.cases[0].evaluation === null) {
        persistedPending = true; await Promise.resolve(); control.drift();
      }
    },
    evaluate: async (pinned, context) => { evaluations++; return accepted(pinned, context); },
    gate: async () => ({ passed: true, checks: [{ name: 'Injected oracle only', passed: true }] }),
  });
  assert.equal(persistedPending, true); assert.equal(evaluations, 0); assert.equal(control.checks(), 2);
  assert.equal(result.status, 'failed'); assert.match(result.cases[0].evaluationError!, /execution-identity-drift/);
  assert.equal(result.cases[0].attempted, true, 'The refused intent is not removed from the case ledger');
  assert.equal(result.cases[0].evaluationInvoked, false); assert.equal(result.cases[0].evaluation, null);
  assert.equal(result.cases.filter(item => item.evaluationInvoked).length, 0);
  assert.equal(result.usage.evaluationAttempts, 1, 'The refused case intent is preserved, not claimed as an actual dispatch');
  assert.equal(result.metrics.attemptedCases, 1); assert.equal(result.usage.providerRequests, 0);
  assert.equal(result.usage.complete, true); assert.equal(result.usage.estimatedCost, 0, 'Zero dispatched requests is a known empty ledger, not absent provider usage filled with zero');
  assert.deepEqual(result.cases.slice(1).map(item => item.status), ['skipped', 'skipped']);
  t.diagnostic('The asynchronous persistence window uses pure callbacks; no actual disk drift, model/provider HTTP or Gate browser.');
});

test('default real benchmark evaluation without an execution identity guard fails closed before dispatch or Gate', async t => {
  let gates = 0;
  const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'execution-identity-benchmark-fixture-token' };
  const result = await runJevBenchmark(config, new AbortController().signal, {
    // No injected evaluator and no freshness guard: the production default
    // must be refused before it can reach the globally prohibited fetch.
    gate: async () => { gates++; return { passed: true, checks: [{ name: 'Injected oracle must not execute', passed: true }] }; },
  });
  assert.equal(result.status, 'failed'); assert.match(result.error!, /缺少生产启动身份门禁/);
  assert.equal(result.evidenceSource, 'live-jev-evaluation'); assert.equal(result.gateSource, 'injected-test');
  assert.equal(gates, 0); assert.equal(prohibitedFetches, 0, 'Default evaluator never reaches provider transport');
  assert.ok(result.cases.every(item => !item.attempted && !item.evaluationInvoked && item.evaluation === null));
  assert.deepEqual(result.cases.map(item => item.status), ['skipped', 'skipped', 'skipped']);
  assert.equal(result.usage.evaluationAttempts, 0); assert.equal(result.usage.providerRequests, 0);
  assert.equal(result.usage.complete, true); assert.equal(result.usage.estimatedCost, 0, 'A locally refused default request is a known empty ledger');
  t.diagnostic('Synthetic credentials only; global fetch remains prohibited and no Gate browser runs.');
});
