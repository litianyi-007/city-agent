import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifierStudyPublicRunSchema } from '../shared/verifier-study-control-schema.js';
import { VerifierStudyController, type VerifierStudyControllerOptions } from '../server/production/verifier-study-control.js';
import { verifierStudyEngineeringConfiguration } from '../server/production/verifier-study-engineering-fixture.js';
import type { ObservedStudySummary } from '../server/production/verifier-study.js';
import type { ProductionAgent } from '../shared/production-schema.js';
import { VerifierStudyLedger } from '../server/production/verifier-study-ledger.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const acknowledgement = (id: string) => ({ preparationId: id, estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true });
function directory() { const base = mkdtempSync(join(realpathSync(tmpdir()), 'verifier-study-control-')); chmodSync(base, 0o700); return join(base, 'studies'); }
function fakeStore() {
  const config = verifierStudyEngineeringConfiguration(); let generation = 1; let secretReads = 0;
  let agents: ProductionAgent[] = [{ ...structuredClone(config.verifier), pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } }]; let jev = structuredClone(config.jev);
  return { store: { agents: () => structuredClone(agents), jevConfig: () => structuredClone(jev),
    studyConfigurationIdentity: () => `private-opaque-generation-${generation}`,
    secretAgents: () => { secretReads++; throw new Error('Engineering must not read secrets'); },
    secretJevConfig: () => { secretReads++; throw new Error('Engineering must not read secrets'); } },
    rotate: () => { generation++; }, changeName: () => { agents[0].name += ' changed'; }, empty: () => { agents = []; jev.hasApiKey = false; }, secretReads: () => secretReads };
}
function summary(status: 'completed' | 'failed' | 'cancelled' = 'completed'): ObservedStudySummary {
  const time = new Date().toISOString(); return { version: 'verifier-study-observed-v1', runId: randomUUID(), executionSource: 'loopback-engineering',
    cachePolicy: 'bypass', status, reason: status === 'completed' ? null : 'Fixture interruption', startedAt: time, endedAt: time, durationMs: 0,
    plannedDecisions: 54, attemptedDecisions: 0, notStartedDecisions: 54, plannedOracles: 36, attemptedOracles: 0, completedOracles: 0,
    callbackIntents: 0, actualProviderHttpAttempts: 0, localFixtureHttpAttempts: 0, actualModelUsage: null,
    usage: { complete: true, knownInputTokens: 0, knownOutputTokens: 0, knownEstimatedCost: 0, currency: 'USD', unknownCalls: 0,
      scope: 'loopback-fixture-accounting-not-model-measurement' }, byStrategy: [], ledgerTerminalPersisted: true };
}
function setup(executor?: VerifierStudyControllerOptions['engineeringTestExecutor'], extra: Partial<VerifierStudyControllerOptions> = {}) {
  const fixture = fakeStore(); let fresh = true; let otherBusy = false;
  const options: VerifierStudyControllerOptions = { directory: directory(), bootId: randomUUID(), store: fixture.store,
    assertExecutionFresh: () => { if (!fresh) throw new Error('Boot executable changed'); }, isOtherBusy: () => otherBusy,
    engineeringTestExecutor: executor ?? (async () => summary()), ...extra };
  const controller = new VerifierStudyController(options);
  return { controller, options, fixture, drift: () => { fresh = false; }, busyOther: () => { otherBusy = true; } };
}
async function settled(controller: VerifierStudyController, id: string, max = 60000) {
  const started = Date.now(); while (controller.busy) { if (Date.now() - started > max) throw new Error('Controller did not settle'); await new Promise(resolve => setTimeout(resolve, 200)); }
  return controller.get(id)!;
}

test('prepare has no credentials/dispatch, strict full18 public plan and current-boot one-use preparation', async () => {
  let callbacks = 0; const { controller, fixture } = setup(async () => { callbacks++; return summary(); });
  const prepared = controller.prepare({ executionSource: 'loopback-engineering' });
  assert.equal(prepared.plan.poolIds.length, 18); assert.deepEqual(prepared.plan.strategies, ['baseline', 'llm', 'jev-cascade']);
  assert.equal(prepared.plan.limits.maxEstimatedCostUsd, 1); assert.equal(Date.parse(prepared.expiresAt) - Date.now() <= 3600000, true);
  assert.equal(callbacks, 0); assert.equal(fixture.secretReads(), 0); assert.equal(JSON.stringify(prepared).includes('private-opaque-generation'), false);
  assert.equal(JSON.stringify(prepared).includes('hashes'), false); assert.equal(JSON.stringify(prepared).includes('/Users/'), false);
  assert.throws(() => controller.prepare({ executionSource: 'loopback-engineering', verifierAgentId: randomUUID() }), /does not use/);
  assert.throws(() => controller.prepare({ executionSource: 'loopback-engineering', executionPorts: {} }), /Invalid/);
  assert.throws(() => controller.start({ preparationId: prepared.id }), /acknowledgements/);
  const run = controller.start(acknowledgement(prepared.id)); assert.equal(run.status, 'running'); assert.equal(controller.busy, true);
  await settled(controller, run.id); assert.equal(callbacks, 1); assert.equal(fixture.secretReads(), 0);
  assert.throws(() => controller.start(acknowledgement(prepared.id)), /consumed/); await controller.close();
});

test('consumed consent, full frozen plan and independent running record precede executor', async () => {
  let checked = false;
  const { controller, options } = setup(async context => {
    const parent = join(context.directory, '..'); const grant = JSON.parse(readFileSync(join(parent, 'consent-consumed.json'), 'utf8'));
    const running = JSON.parse(readFileSync(join(parent, 'running.json'), 'utf8'));
    assert.equal(running.grantSha256, hash(grant)); assert.deepEqual(grant.frozenPlan, context.plan);
    assert.equal(grant.run.status, 'running'); assert.equal(grant.consent.estimatedBillingOnlyAcknowledged, true); context.assertFresh(); checked = true; return summary();
  });
  const preparation = controller.prepare({ executionSource: 'loopback-engineering' }); const run = controller.start(acknowledgement(preparation.id));
  const final = await settled(controller, run.id); assert.equal(checked, true); assert.equal(final.status, 'completed');
  assert.equal(existsSync(join(options.directory, run.id, 'terminal.json')), true); assert.equal(final.summary!.actualModelUsage, null);
  assert.equal(JSON.stringify(controller.list()).includes('private-opaque-generation'), false); verifierStudyPublicRunSchema.parse(final); await controller.close();
});

test('configuration mutation, key rotation, changed executable and expired preparation deny before callback', async () => {
  for (const mutate of ['rotate', 'name', 'source', 'expire'] as const) {
    let calls = 0; const fixture = setup(async () => { calls++; return summary(); }); const prepared = fixture.controller.prepare({ executionSource: 'loopback-engineering' });
    if (mutate === 'rotate') fixture.fixture.rotate(); if (mutate === 'name') fixture.fixture.changeName(); if (mutate === 'source') fixture.drift();
    const originalNow = Date.now; if (mutate === 'expire') Date.now = () => Date.parse(prepared.expiresAt) + 1;
    try { assert.throws(() => fixture.controller.start(acknowledgement(prepared.id)), /changed|expired/); }
    finally { Date.now = originalNow; }
    assert.equal(calls, 0); assert.equal(fixture.fixture.secretReads(), 0); await fixture.controller.close();
  }
});

test('one active run and other-operation exclusion; cancel and close join asynchronous cleanup', async () => {
  let cleanup = false; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const { controller, fixture } = setup(async context => {
    entered(); await new Promise<void>(resolve => { context.signal.addEventListener('abort', () => setTimeout(() => { cleanup = true; resolve(); }, 40), { once: true }); }); return summary('cancelled');
  });
  const prepared = controller.prepare({ executionSource: 'loopback-engineering' }); const run = controller.start(acknowledgement(prepared.id)); await started;
  assert.throws(() => controller.prepare({ executionSource: 'loopback-engineering' }), /active/);
  const cancel = controller.cancel(run.id); assert.equal(controller.busy, true); assert.equal(cleanup, false);
  const stopped = await cancel; assert.equal(cleanup, true); assert.equal(stopped!.status, 'cancelled'); assert.equal(controller.busy, false);
  assert.equal(fixture.secretReads(), 0); await controller.close(); assert.throws(() => controller.prepare({ executionSource: 'loopback-engineering' }), /closed/);
  const other = setup(); other.busyOther(); assert.throws(() => other.controller.prepare({ executionSource: 'loopback-engineering' }), /active/); await other.controller.close();
});

test('per-dispatch configuration guard stops a pending engineering delegate without reading real secrets', async () => {
  let release!: () => void; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const { controller, fixture } = setup(async context => { entered(); await gate; context.assertFresh(); return summary(); });
  const prepared = controller.prepare({ executionSource: 'loopback-engineering' }); const run = controller.start(acknowledgement(prepared.id)); await started;
  fixture.rotate(); release(); const stopped = await settled(controller, run.id); assert.equal(stopped.status, 'failed'); assert.equal(stopped.summary, null);
  assert.deepEqual(stopped.progress, { ledgerEvents: null, decisions: null, calls: null, oracles: null }); assert.equal(fixture.secretReads(), 0); await controller.close();
});

test('in-flight durable call intent is observable before any result or known usage', async () => {
  let entered!: () => void; let release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = setup(async context => {
    const runId = randomUUID(); const decisionId = randomUUID(); const callId = randomUUID(); const ledger = VerifierStudyLedger.create(context.directory, { runId, status: 'running' });
    ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'llm', status: 'running' });
    ledger.append('call-intent', { runId, decisionId, callId, poolId: 'H01', strategy: 'llm', kind: 'llm', status: 'pending', usage: null, actualProviderHttpAttempts: null });
    entered(); await gate;
    ledger.append('call-result', { runId, decisionId, callId, poolId: 'H01', strategy: 'llm', kind: 'llm', status: 'unknown', usage: null, actualProviderHttpAttempts: null });
    ledger.append('decision-result', { runId, decisionId, poolId: 'H01', strategy: 'llm', status: 'failed', decision: 'error' });
    return summary('failed');
  });
  const prepared = fixture.controller.prepare({ executionSource: 'loopback-engineering' }); const run = fixture.controller.start(acknowledgement(prepared.id)); await started;
  assert.equal(fixture.controller.get(run.id)!.progress.calls, 1); assert.equal(fixture.controller.get(run.id)!.progress.decisions, 0);
  assert.equal(fixture.controller.get(run.id)!.summary, null); release(); await settled(fixture.controller, run.id); await fixture.controller.close();
});

test('encrypt-only public-output guard is honored before exposure or dispatch without reading secrets', async () => {
  const store = fakeStore(); let outputs = 0; const fixture = setup(undefined, { store: { ...store.store, assertStudyPublicSafe: value => {
    outputs++; if (value && typeof value === 'object' && 'source' in value) throw new Error('Synthetic public-contract collision');
  } } });
  assert.throws(() => fixture.controller.prepare({ executionSource: 'loopback-engineering' }), /public-contract collision/);
  assert.equal(outputs, 1); assert.equal(store.secretReads(), 0); assert.deepEqual(fixture.controller.list(), []); await fixture.controller.close();
});

test('restart exposes interrupted unknown without replay or reusing old preparation; preserves original bytes', async () => {
  const old = setup(); const prepared = old.controller.prepare({ executionSource: 'loopback-engineering' }); const run = old.controller.start(acknowledgement(prepared.id)); await settled(old.controller, run.id);
  const directory2 = directory(); mkdirSync(directory2, { mode: 0o700 }); const runDir = join(directory2, run.id); mkdirSync(runDir, { mode: 0o700 });
  const grant = readFileSync(join(old.options.directory, run.id, 'consent-consumed.json')); const running = readFileSync(join(old.options.directory, run.id, 'running.json'));
  writeFileSync(join(runDir, 'consent-consumed.json'), grant, { mode: 0o600 }); writeFileSync(join(runDir, 'running.json'), running, { mode: 0o600 });
  let replayed = 0; const restart = setup(async () => { replayed++; return summary(); }, { directory: directory2, bootId: 'trusted-engineering-restart' });
  const recovered = restart.controller.get(run.id)!; assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.summary, null); assert.equal(recovered.progress.calls, null);
  assert.equal(replayed, 0); assert.equal(restart.controller.busy, false); assert.throws(() => restart.controller.start(acknowledgement(prepared.id)), /another boot/);
  assert.deepEqual(readFileSync(join(runDir, 'running.json')), running); assert.equal(readdirSync(runDir).length, 2);
  await restart.controller.close(); await old.controller.close();
});

test('public polling rejects arbitrary IDs, never exposes raw evidence; missing real config cannot decrypt', async () => {
  const { controller, fixture } = setup(); fixture.empty(); assert.throws(() => controller.prepare({ executionSource: 'real-provider' }), /Select/);
  assert.equal(fixture.secretReads(), 0); assert.equal(controller.get('../../secret'), null); assert.equal(await controller.cancel(randomUUID()), null);
  assert.deepEqual(controller.list(), []); await controller.close();
});

test('outstanding preparations are bounded and expire; injected engineering result cannot claim real provenance', async () => {
  const { controller } = setup(); const prepared = Array.from({ length: 16 }, () => controller.prepare({ executionSource: 'loopback-engineering' }));
  assert.throws(() => controller.prepare({ executionSource: 'loopback-engineering' }), /Too many/);
  const originalNow = Date.now; Date.now = () => Math.max(...prepared.map(item => Date.parse(item.expiresAt))) + 1;
  try { assert.equal(controller.prepare({ executionSource: 'loopback-engineering' }).plan.poolIds.length, 18); }
  finally { Date.now = originalNow; await controller.close(); }
  const forged = setup(async () => ({ ...summary(), executionSource: 'real-provider', actualModelUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    usage: { ...summary().usage, scope: 'observed-provider-declared-rate-estimate-not-bill' } }));
  const preparation = forged.controller.prepare({ executionSource: 'loopback-engineering' }); const run = forged.controller.start(acknowledgement(preparation.id));
  const failed = await settled(forged.controller, run.id); assert.equal(failed.status, 'failed'); assert.equal(failed.summary, null); await forged.controller.close();
});

test('unrecognized evidence and symlink directories are never overwritten or followed', async () => {
  const { controller, options } = setup(); const prepared = controller.prepare({ executionSource: 'loopback-engineering' }); const run = controller.start(acknowledgement(prepared.id)); await settled(controller, run.id); await controller.close();
  const grantFile = join(options.directory, run.id, 'consent-consumed.json'); const corrupt = '{"unknown":"preserve-me"}\n'; writeFileSync(grantFile, corrupt, { mode: 0o600 });
  assert.throws(() => setup(undefined, { directory: options.directory })); assert.equal(readFileSync(grantFile, 'utf8'), corrupt);
  const symlinkRoot = directory(); symlinkSync(options.directory, symlinkRoot); assert.throws(() => setup(undefined, { directory: symlinkRoot }), /symlink/);
});

test('failed terminal directory barrier cannot turn readable completed bytes into recovered success', async () => {
  const fixture = setup(undefined, { engineeringPersistFault: () => { throw new Error('Synthetic directory fsync failure'); } });
  const prepared = fixture.controller.prepare({ executionSource: 'loopback-engineering' }); const run = fixture.controller.start(acknowledgement(prepared.id));
  const failed = await settled(fixture.controller, run.id); assert.equal(failed.status, 'failed'); const runDir = join(fixture.options.directory, run.id);
  const terminalBefore = readFileSync(join(runDir, 'terminal.json')); assert.equal(JSON.parse(terminalBefore.toString()).run.status, 'completed');
  assert.equal(existsSync(join(runDir, 'terminal.confirmed.json')), false); await fixture.controller.close();
  const restarted = setup(undefined, { directory: fixture.options.directory }); const recovered = restarted.controller.get(run.id)!;
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.summary, null); assert.equal(recovered.progress.calls, null);
  assert.deepEqual(readFileSync(join(runDir, 'terminal.json')), terminalBefore); await restarted.controller.close();
});

test('terminal confirmation binds grant, terminal, directory and run; tampering fails closed', async () => {
  const fixture = setup(); const prepared = fixture.controller.prepare({ executionSource: 'loopback-engineering' }); const run = fixture.controller.start(acknowledgement(prepared.id));
  await settled(fixture.controller, run.id); await fixture.controller.close(); const runDir = join(fixture.options.directory, run.id);
  const confirmationFile = join(runDir, 'terminal.confirmed.json'); const confirmation = JSON.parse(readFileSync(confirmationFile, 'utf8'));
  confirmation.terminalSha256 = '0'.repeat(64); const bytes = `${JSON.stringify(confirmation)}\n`; writeFileSync(confirmationFile, bytes, { mode: 0o600 });
  assert.throws(() => setup(undefined, { directory: fixture.options.directory }), /confirmation invalid/); assert.equal(readFileSync(confirmationFile, 'utf8'), bytes);
});

test('free native control plane executes all18 through actual SDK and Chromium, not injected summary', { timeout: 600000 }, async () => {
  const { controller, options, fixture } = setup(undefined, { engineeringTestExecutor: undefined });
  const prepared = controller.prepare({ executionSource: 'loopback-engineering' }); const run = controller.start(acknowledgement(prepared.id));
  try {
    const final = await settled(controller, run.id, 600000); assert.equal(final.status, 'completed', JSON.stringify(final)); assert.equal(final.summary!.executionSource, 'loopback-engineering');
    assert.equal(final.summary!.attemptedDecisions, 54); assert.equal(final.summary!.callbackIntents, 54); assert.equal(final.summary!.completedOracles, 36);
    assert.equal(final.summary!.actualProviderHttpAttempts, 0); assert.equal(final.summary!.actualModelUsage, null); assert.equal(final.summary!.ledgerTerminalPersisted, true);
    const receipt = JSON.parse(readFileSync(join(options.directory, run.id, 'engineering-receipt.json'), 'utf8'));
    assert.equal(receipt.loopbackHttpPosts, 36); assert.equal(receipt.inMemoryJevFetchDispatches, 18); assert.equal(receipt.rejectedFixtureRequests, 0);
    assert.equal(receipt.externalProviderHttpAttempts, 0); assert.equal(fixture.secretReads(), 0); assert.equal(final.progress.calls, 54); assert.equal(final.progress.oracles, 36);
    assert.match(receipt.evidenceBoundary, /not real model quality/); assert.equal(JSON.stringify(final).includes('candidates'), false);
  } finally { await controller.close(); }
});
