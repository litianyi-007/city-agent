import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createRunner } from '../server/orchestrator.ts';
import { CityStore } from '../server/store.ts';
import type { Run } from '../server/types.ts';

function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-agent-finalization-test-'));
  const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const run = store.createRun({ task: '仅用于本地终态发布测试的模拟交付', mode: 'demo', agentIds: store.getAgents().map(agent => agent.id), sampleSize: 30 });
  const manifestPath = path.join(store.runDir(run.id), 'manifest.json');
  const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8')) as { status: string; finishedAt: string; modelCalls: number };
  return { store, run, manifestPath, readManifest };
}

/** Observe every public write, not only the eventual happy-path result. */
function observeWrites(store: CityStore, observe: (snapshot: Run) => void) {
  const save = store.saveRun.bind(store);
  store.saveRun = snapshot => { observe(structuredClone(snapshot)); save(snapshot); };
}

test('completed outcome is published once and only after its matching manifest exists', async t => {
  const { store, run, manifestPath, readManifest } = fixture(t);
  let terminalWrites = 0; let finalizingWrites = 0;
  observeWrites(store, snapshot => {
    if (snapshot.status === 'completed') {
      terminalWrites++;
      assert.ok(existsSync(manifestPath), 'completed must never precede the manifest file');
      assert.ok(snapshot.artifacts.some(artifact => artifact.name === 'manifest.json'));
      assert.equal(readManifest().status, 'completed');
      assert.equal(readManifest().finishedAt, snapshot.finishedAt);
    } else {
      assert.equal(snapshot.finishedAt, undefined, 'nonfinal public state cannot declare finish time');
      if (snapshot.events.at(-1)?.message.startsWith('流程演示完成')) {
        finalizingWrites++;
        assert.equal(snapshot.status, 'running');
      }
    }
  });
  await createRunner(store, { demoDelayMs: 0, runGate: async () => ({ passed: true, checks: [{ name: 'synthetic gate fixture', passed: true }] }) }).start(run.id, run.input);
  assert.equal(terminalWrites, 1);
  assert.ok(finalizingWrites >= 1);
  assert.equal(store.getRun(run.id)?.status, 'completed');
  assert.equal(readManifest().modelCalls, 0);
});

test('failed Gate keeps its real failed manifest and never publishes an incomplete terminal snapshot', async t => {
  const { store, run, readManifest } = fixture(t);
  let terminalWrites = 0;
  observeWrites(store, snapshot => {
    if (snapshot.status === 'failed') { terminalWrites++; assert.equal(readManifest().status, 'failed'); assert.ok(snapshot.finishedAt); }
    else assert.equal(snapshot.status, 'running');
  });
  await createRunner(store, { demoDelayMs: 0, runGate: async () => ({ passed: false, checks: [{ name: 'synthetic failed gate', passed: false }] }) }).start(run.id, run.input);
  assert.equal(terminalWrites, 1);
  assert.equal(store.getRun(run.id)?.status, 'failed');
  assert.equal(store.getRun(run.id)?.gate?.passed, false);
  assert.equal(readManifest().modelCalls, 0);
});

test('manifest write failure directly publishes failed and releases cancellation waiters', { timeout: 5000 }, async t => {
  const { store, run, manifestPath } = fixture(t);
  mkdirSync(manifestPath); // Deterministic local write failure, no injected production hook.
  const terminalStatuses: string[] = [];
  observeWrites(store, snapshot => {
    if (snapshot.status !== 'running') terminalStatuses.push(snapshot.status);
  });
  const runner = createRunner(store, { demoDelayMs: 0, runGate: async () => ({ passed: true, checks: [{ name: 'synthetic gate fixture', passed: true }] }) });
  await runner.start(run.id, run.input);
  await runner.cancel(run.id);
  const finished = store.getRun(run.id)!;
  assert.deepEqual(terminalStatuses, ['failed']);
  assert.match(finished.error!, /无法保存执行清单/);
  assert.ok(finished.finishedAt);
  assert.equal(finished.artifacts.some(artifact => artifact.name === 'manifest.json'), false);
  assert.equal(finished.gate?.passed, true); // Gate is not changed to conceal storage failure.
});

test('in-flight cancel waits for its cancelled manifest and retains zero-call contract', { timeout: 5000 }, async t => {
  const { store, run, readManifest } = fixture(t);
  let reached!: () => void;
  const stageStarted = new Promise<void>(resolve => { reached = resolve; });
  let terminalWrites = 0;
  observeWrites(store, snapshot => {
    if (snapshot.events.at(-1)?.type === 'demo') reached();
    if (snapshot.status === 'cancelled') { terminalWrites++; assert.equal(readManifest().status, 'cancelled'); }
    else assert.equal(snapshot.status, 'running');
  });
  let gateCalls = 0;
  const runner = createRunner(store, { demoDelayMs: 30_000, runGate: async () => { gateCalls++; throw new Error('Cancelled stage must not reach the Gate.'); } });
  const work = runner.start(run.id, run.input);
  await stageStarted;
  await Promise.all([runner.cancel(run.id), work]);
  assert.equal(terminalWrites, 1);
  assert.equal(store.getRun(run.id)?.status, 'cancelled');
  assert.equal(readManifest().modelCalls, 0);
  assert.equal(gateCalls, 0);
});

test('queued cancellation remains immediate without inventing execution artifacts', async t => {
  const { store, run, manifestPath } = fixture(t);
  const runner = createRunner(store);
  await runner.cancel(run.id);
  await runner.start(run.id, run.input);
  assert.equal(store.getRun(run.id)?.status, 'cancelled');
  assert.ok(store.getRun(run.id)?.finishedAt);
  assert.equal(existsSync(manifestPath), false);
  assert.deepEqual(store.getRun(run.id)?.artifacts, []);
});

test('cancel after the passed Gate waits for publication without rewriting the real completed outcome', { timeout: 5000 }, async t => {
  const { store, run, readManifest } = fixture(t);
  let reached!: () => void;
  const finalizing = new Promise<void>(resolve => { reached = resolve; });
  observeWrites(store, snapshot => { if (snapshot.events.at(-1)?.message.startsWith('流程演示完成')) reached(); });
  const runner = createRunner(store, { demoDelayMs: 0, runGate: async () => ({ passed: true, checks: [{ name: 'synthetic gate fixture', passed: true }] }) });
  const work = runner.start(run.id, run.input);
  await finalizing;
  await Promise.all([runner.cancel(run.id), work]);
  assert.equal(store.getRun(run.id)?.status, 'completed');
  assert.equal(readManifest().status, 'completed');
});

test('final persistence failure rejects cancellation waiters and does not leave a controller hanging', { timeout: 5000 }, async t => {
  const { store, run, readManifest } = fixture(t);
  let reached!: () => void;
  const finalizing = new Promise<void>(resolve => { reached = resolve; });
  const save = store.saveRun.bind(store);
  store.saveRun = snapshot => {
    if (snapshot.events.at(-1)?.message.startsWith('流程演示完成')) reached();
    if (snapshot.status === 'completed') throw new Error('synthetic terminal publish failure');
    save(snapshot);
  };
  const runner = createRunner(store, { demoDelayMs: 0, runGate: async () => ({ passed: true, checks: [{ name: 'synthetic gate fixture', passed: true }] }) });
  const work = runner.start(run.id, run.input);
  const startRejected = assert.rejects(Promise.resolve(work), /synthetic terminal publish failure/);
  await finalizing;
  await Promise.all([startRejected, assert.rejects(Promise.resolve(runner.cancel(run.id)), /synthetic terminal publish failure/)]);
  assert.equal(readManifest().status, 'completed');
  assert.equal(store.getRun(run.id)?.status, 'running'); // Never return a false completed/cancelled result.
  await runner.cancel(run.id); // No stale completion/controller after failure.
});

test('initialization failure after waiter registration still records failure and cleans cancellation state', { timeout: 5000 }, async t => {
  const { store, run, readManifest } = fixture(t);
  store.runDir = () => { throw new Error('synthetic artifact directory initialization failure'); };
  const runner = createRunner(store, { demoDelayMs: 0 });
  await runner.start(run.id, run.input);
  await runner.cancel(run.id);
  assert.equal(store.getRun(run.id)?.status, 'failed');
  assert.match(store.getRun(run.id)?.error!, /synthetic artifact directory initialization failure/);
  assert.equal(readManifest().status, 'failed');
  assert.equal(readManifest().modelCalls, 0);
});
