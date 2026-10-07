import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test, type TestContext } from 'node:test';
import { ProductionPipeline } from '../server/production/pipeline.js';
import { ProductionStore } from '../server/production/store.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import { JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation, type SecretJevConfig } from '../shared/jev-schema.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { projectProductionLedger } from '../shared/production-ledger.js';

// This suite never starts an API server, SDK process or browser. Even accidental
// network access is rejected; its injected usage is not a real provider bill.
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error('No HTTP in pending-usage engineering fixture'); }; });
after(() => { globalThis.fetch = originalFetch; });

function acceptedJev(config: SecretJevConfig, context: JevCandidateContext): JevEvaluation {
  const dimension = { score: 4, probabilities: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, confidence: 1, legend: { '0': 'none', '1': 'major', '2': 'partial', '3': 'good', '4': 'complete' } };
  return {
    policyVersion: JEV_POLICY_VERSION, status: 'accepted', selectedCandidateId: context.candidates[0].id,
    reason: 'Injected accepted decision; not a model quality result', requestSnapshot: buildJevCandidateRequest(config.modelId, context),
    rawResponse: { fixture: true }, scores: context.candidates.map(candidate => ({ candidateId: candidate.id, dimensions: { coverage: dimension, consistency: dimension, scope: dimension }, meanScore: 4, minimumScore: 4, scopeProbability: 1, scopeCertainty: 1, qualified: true, stronglyRejected: false })),
    choice: { choice: context.candidates[0].id, probabilities: Object.fromEntries([...context.candidates.map((candidate, index) => [candidate.id, index === 0 ? 1 : 0]), ['abstain', 0]]), confidence: 1 },
    usage: { inputTokens: 40, outputTokens: 5, estimatedCost: 40 * config.inputPerMillion / 1e6, currency: 'USD', complete: true },
    modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1,
  };
}

interface FixtureOptions { target: 'role' | 'jev'; outcome?: 'known' | 'unknown'; maxCost?: number; jevInputPrice?: number; }
function fixture(t: TestContext, options: FixtureOptions) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-pending-usage-'));
  const store = new ProductionStore(directory);
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://fixture.invalid', apiKey: `pending-usage-synthetic-token-${agent.role}`, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } });
  if (options.target === 'jev') store.patchJevConfig({ enabled: true, apiKey: 'pending-usage-jev-synthetic-token', ...(options.jevInputPrice === undefined ? {} : { inputPerMillion: options.jevInputPrice }) });
  const input = productionRunInputSchema.parse({
    brief: 'Create a controlled local task list with add and completion behavior', mode: 'live', budgetAuthorized: true,
    verifierEngine: options.target === 'jev' ? 'jev-cascade' : 'llm-rubric', agentIds: store.agents().map(agent => agent.id), limits: { maxCost: options.maxCost ?? 5 },
    requirement: { id: 'FREE-PENDING-USAGE', source: 'Pure injected engineering fixture, not business or model evidence', acceptance: 'Retain independent add/completion checks and unknown usage accounting', kind: 'illustrative' },
  });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), ...(options.target === 'jev' ? { jevSnapshot: store.jevConfig(), jevCalls: [] } : {}), calls: [], verifications: [], outputs: [], events: [], gateHistory: [], repairs: 0, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  let entered!: () => void; const pending = new Promise<void>(resolve => { entered = resolve; });
  let release: (() => void) | undefined; let pendingCount = 0; let roleCalls = 0; let jevCalls = 0;
  const pause = <T>(signal: AbortSignal, value: T): Promise<T> => new Promise((resolve, reject) => {
    pendingCount++; const abort = () => { release = undefined; reject(new DOMException('Injected cancellation', 'AbortError')); };
    release = () => { signal.removeEventListener('abort', abort); release = undefined; resolve(value); };
    signal.addEventListener('abort', abort, { once: true }); entered();
  });
  const pipeline = new ProductionPipeline(store, {
    roleCall: async (agent, _system, prompt, signal) => {
      roleCalls++; const data = JSON.parse(prompt); let value: unknown;
      if (agent.modelId === 'verifier') value = { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected independent review only' })), reason: 'No actual model call' };
      else if (agent.modelId === 'product') value = { goal: input.brief, scope: 'offline-single-html', acceptance: [input.requirement.acceptance], exclusions: ['No real-model evidence'] };
      else if (agent.modelId === 'researcher') value = { observations: ['Provided input only'], constraints: ['Controlled offline HTML'], unknowns: ['Actual model performance not tested'] };
      else if (agent.modelId === 'project-manager') value = { decision: 'proceed', summary: 'Injected plan only', tasks: [{ id: 'deliver', owner: 'developer', description: 'Implement frozen contract' }], risks: ['No actual model evidence'] };
      else if (agent.modelId === 'tester') value = { checks: demoChecks('create') };
      else if (agent.modelId === 'developer') value = { html: demoHtml(input) };
      else throw new Error('Unexpected injected role');
      const result = { text: JSON.stringify(value), inputTokens: 100, outputTokens: 20, usageReported: true, harness: 'Injected usage fixture; no model HTTP' };
      if (options.target === 'role' && agent.modelId === 'researcher') return pause(signal, { ...result, ...(options.outcome === 'unknown' ? { inputTokens: 0, outputTokens: 0, usageReported: false } : {}) });
      return result;
    },
    jevCall: async (config, context, signal) => {
      jevCalls++; const result = acceptedJev(config, context);
      if (context.phase === 'research') return pause(signal, options.outcome === 'unknown' ? { ...result, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } } : result);
      return result;
    },
    acceptancePreflight: async () => ({ valid: true, errors: [] }),
    gate: async () => ({ passed: true, checks: [{ name: 'Injected Gate, not browser evidence', passed: true }] }),
  });
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  const wait = async () => { const deadline = Date.now() + 5000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(pipeline.busy, false, 'Injected run must become terminal'); return store.run(run.id)!; };
  const start = () => pipeline.start(store.run(run.id)!);
  return { store, run, pipeline, start, pending, release: () => { assert.ok(release, 'A real injected pending request must exist'); release(); }, wait, counts: () => ({ roleCalls, jevCalls, pendingCount }) };
}

function assertPending(run: ProductionRun, target: 'role' | 'jev') {
  assert.equal(run.status, 'running');
  const entry = target === 'role' ? run.calls.at(-1)!.usage : run.jevCalls!.at(-1)!.evaluation.usage;
  assert.equal(entry.inputTokens, null); assert.equal(entry.outputTokens, null); assert.equal(entry.estimatedCost, null);
  if (target === 'role') assert.equal(run.calls.at(-1)!.finishedAt, undefined);
  assert.deepEqual(run.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  const ledger = projectProductionLedger(run).usage;
  assert.equal(ledger.unknownUsageEntries, 1); assert.ok(ledger.inputTokens.knownSubtotal! > 0); assert.ok(ledger.outputTokens.knownSubtotal! > 0); assert.ok(ledger.estimatedCost.knownSubtotal! > 0);
  const entries = [...run.calls.map(call => call.usage), ...(run.jevCalls ?? []).map(call => call.evaluation.usage)];
  assert.equal(ledger.inputTokens.knownSubtotal, entries.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0));
  assert.equal(ledger.outputTokens.knownSubtotal, entries.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0));
  assert.equal(ledger.estimatedCost.knownSubtotal, entries.reduce((sum, usage) => sum + (usage.estimatedCost ?? 0), 0));
}

for (const target of ['role', 'jev'] as const) {
  test(`${target} pending registration immediately invalidates the total but retains known subtotals; known completion restores it`, async t => {
    const f = fixture(t, { target }); f.start(); await f.pending; assertPending(f.store.run(f.run.id)!, target);
    f.release(); const run = await f.wait(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.usage.complete, true); assert.equal(run.repairs, 0);
    const ledger = projectProductionLedger(run).usage; assert.equal(ledger.unknownUsageEntries, 0); assert.equal(run.usage.inputTokens, ledger.inputTokens.knownSubtotal); assert.equal(run.usage.outputTokens, ledger.outputTokens.knownSubtotal); assert.equal(run.usage.estimatedCost, ledger.estimatedCost.knownSubtotal); assert.equal(f.counts().pendingCount, 1);
  });

  test(`${target} unknown completion stays unknown and stops before any subsequent request`, async t => {
    const f = fixture(t, { target, outcome: 'unknown' }); f.start(); await f.pending; const pending = f.store.run(f.run.id)!; assertPending(pending, target); const counts = f.counts(); const subtotal = projectProductionLedger(pending).usage;
    f.release(); const run = await f.wait(); assert.equal(run.status, 'failed'); assert.match(run.error!, /unknown|用量未知/); assert.deepEqual(run.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }); assert.deepEqual(f.counts(), counts); assert.equal(run.repairs, 0); assert.equal(run.frozenContract, undefined);
    const ledger = projectProductionLedger(run).usage; assert.equal(ledger.inputTokens.knownSubtotal, subtotal.inputTokens.knownSubtotal); assert.equal(ledger.outputTokens.knownSubtotal, subtotal.outputTokens.knownSubtotal); assert.equal(ledger.estimatedCost.knownSubtotal, subtotal.estimatedCost.knownSubtotal);
  });

  test(`${target} cancellation preserves pending unknown totals, known subtotal and intervention without another request`, async t => {
    const f = fixture(t, { target }); f.start(); await f.pending; const pending = f.store.run(f.run.id)!; assertPending(pending, target); const counts = f.counts(); const subtotal = projectProductionLedger(pending).usage;
    f.pipeline.cancel(f.run.id); const run = await f.wait(); assert.equal(run.status, 'cancelled'); assert.equal(run.usage.complete, false); assert.equal(run.usage.estimatedCost, null); assert.equal(run.usage.inputTokens, null); assert.equal(run.usage.outputTokens, null); assert.equal(run.interventions.length, 1); assert.deepEqual(f.counts(), counts); assert.equal(run.repairs, 0);
    const ledger = projectProductionLedger(run).usage; assert.equal(ledger.inputTokens.knownSubtotal, subtotal.inputTokens.knownSubtotal); assert.equal(ledger.estimatedCost.knownSubtotal, subtotal.estimatedCost.knownSubtotal);
  });
}

test('role cost reservation refuses low budget before creating a pending invocation', async t => {
  const f = fixture(t, { target: 'role', maxCost: 0.00001 }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /费用预算不足/); assert.deepEqual(f.counts(), { roleCalls: 0, jevCalls: 0, pendingCount: 0 }); assert.equal(run.calls.length, 0); assert.equal(run.usage.complete, true); assert.equal(run.usage.estimatedCost, 0, 'No dispatches is a known empty ledger, not unknown usage invented as zero');
});

test('Jev cost reservation refuses before adding an evaluation intent, retaining the completed role subtotal', async t => {
  const f = fixture(t, { target: 'jev', maxCost: 0.08, jevInputPrice: 2 }); f.start(); const run = await f.wait();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /预算不足以预留 Jev/); assert.deepEqual(f.counts(), { roleCalls: 1, jevCalls: 0, pendingCount: 0 }); assert.equal(run.calls.length, 1); assert.equal(run.jevCalls!.length, 0); assert.equal(run.usage.complete, true); assert.equal(run.usage.inputTokens, 100); assert.equal(run.usage.outputTokens, 20); assert.equal(run.usage.estimatedCost, 0.00012);
});
