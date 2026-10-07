import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { VerifierStudyLedger, type StudyLedgerOptions } from '../server/production/verifier-study-ledger.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(project, 'tests/fixtures/verifier-study-crash.mjs');
const runId = 'study-free-01'; const decisionId = 'H01:B'; const callId = 'H01:B:1';
const manifest = () => ({ runId, status: 'running', executionSource: 'injected-test', cachePolicy: 'bypass', plannedDecisions: [{ decisionId, poolId: 'H01', strategy: 'B' }], budgets: { currency: 'USD', maxCalls: 54 } });
function temporary(t: TestContext): string {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'city-verifier-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
function ledgerAt(t: TestContext, options: StudyLedgerOptions = {}): VerifierStudyLedger { return VerifierStudyLedger.create(path.join(temporary(t), 'study'), manifest(), options); }
function decision(ledger: VerifierStudyLedger): void { ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running' }); }
function intent(ledger: VerifierStudyLedger): void { ledger.append('call-intent', { runId, decisionId, callId, kind: 'llm', status: 'pending', requestSnapshot: { messages: ['new session, no answer cache'] }, usage: null }); }
function result(ledger: VerifierStudyLedger): void { ledger.append('call-result', { runId, decisionId, callId, status: 'completed', usage: { inputTokens: 10, outputTokens: 3, estimatedCost: 0.002, currency: 'USD' }, providerRequests: 1, responseSnapshot: { decision: 'abstain' } }); }
function closeDecision(ledger: VerifierStudyLedger): void { ledger.append('decision-result', { runId, decisionId, decision: 'abstain', selectedCandidateId: null }); }
const eio = () => Object.assign(new Error('Injected EIO, no provider callback'), { code: 'EIO' });
const fileHash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('manifest independently survives failure of initial run-start and explicit recovery never reports success', t => {
  const directory = path.join(temporary(t), 'study');
  assert.throws(() => VerifierStudyLedger.create(directory, manifest(), { beforePersist(operation, context) { if (operation === 'event' && context.eventType === 'run-start') throw eio(); } }), /EIO/);
  assert.deepEqual(readdirSync(directory), ['manifest.json']);
  const ledger = VerifierStudyLedger.open(directory); assert.deepEqual(ledger.readEvents(), []);
  assert.equal(ledger.readManifest().manifest.runId, runId);
  assert.equal(lstatSync(directory).mode & 0o777, 0o700); assert.equal(lstatSync(path.join(directory, 'manifest.json')).mode & 0o777, 0o600);
  const recovered = ledger.recoverInterrupted(); assert.equal(recovered.recovered, true);
  assert.equal(recovered.events.at(-1)!.type, 'run-end'); assert.equal(recovered.events.at(-1)!.payload.status, 'interrupted'); assert.equal(recovered.events.at(-1)!.payload.usage, null);
  assert.equal(ledger.recoverInterrupted().recovered, false);
});

test('create and append commit evidence before returning; readers deep-copy, reopen remains read-only and terminal is immutable', t => {
  const ledger = ledgerAt(t); const firstHash = fileHash(path.join(ledger.directory, 'event-000001.json'));
  assert.equal(ledger.readEvents()[0].type, 'run-start'); decision(ledger); intent(ledger); result(ledger); closeDecision(ledger);
  ledger.append('oracle-intent', { runId, oracleId: 'H01:a', poolId: 'H01', candidateId: 'a', status: 'pending' });
  ledger.append('oracle-result', { runId, oracleId: 'H01:a', poolId: 'H01', candidateId: 'a', status: 'completed', result: { passed: true } });
  const terminal = ledger.append('run-end', { runId, status: 'completed', summary: { selected: 0 } }); terminal.payload.status = 'failed';
  const events = ledger.readEvents(); events[0].payload.status = 'edited'; const snapshot = ledger.readManifest(); snapshot.manifest.cachePolicy = 'reuse';
  assert.equal(ledger.readEvents()[0].payload.status, 'running'); assert.equal(ledger.readEvents().at(-1)!.payload.status, 'completed'); assert.equal(ledger.readManifest().manifest.cachePolicy, 'bypass');
  const before = readdirSync(ledger.directory).map(file => [file, fileHash(path.join(ledger.directory, file))]);
  const opened = VerifierStudyLedger.open(ledger.directory); assert.deepEqual(opened.readEvents(), ledger.readEvents()); assert.equal(opened.recoverInterrupted().recovered, false);
  assert.deepEqual(readdirSync(ledger.directory).map(file => [file, fileHash(path.join(ledger.directory, file))]), before);
  assert.equal(fileHash(path.join(ledger.directory, 'event-000001.json')), firstHash);
  assert.throws(() => opened.append('run-end', { runId, status: 'completed' }), /terminal/);
});

test('exclusive creation cannot reuse or erase an existing study', t => {
  const ledger = ledgerAt(t); const existing = readFileSync(path.join(ledger.directory, 'manifest.json'));
  assert.throws(() => VerifierStudyLedger.create(ledger.directory, manifest()), /EEXIST/);
  assert.deepEqual(readFileSync(path.join(ledger.directory, 'manifest.json')), existing);
});

test('normalized isolated paths, symlink parents, directory/file symlinks and file hard links are rejected', t => {
  const root = temporary(t); const ledger = VerifierStudyLedger.create(path.join(root, 'study'), manifest());
  assert.throws(() => VerifierStudyLedger.create('relative/study', manifest()), /absolute/);
  assert.throws(() => VerifierStudyLedger.create(`${root}/../traversal`, manifest()), /traversal/);
  assert.throws(() => VerifierStudyLedger.create('/', manifest()), /root/);
  symlinkSync(ledger.directory, path.join(root, 'alias')); assert.throws(() => VerifierStudyLedger.create(path.join(root, 'alias', 'nested'), manifest()), /symlink/);
  assert.throws(() => VerifierStudyLedger.open(path.join(root, 'alias')), /symlink/);
  const file = path.join(ledger.directory, 'event-000001.json'); const original = readFileSync(file);
  rmSync(file); symlinkSync(path.join(ledger.directory, 'manifest.json'), file); assert.throws(() => VerifierStudyLedger.open(ledger.directory), /symlink/);
  rmSync(file); writeFileSync(path.join(root, 'shared-event'), original, { mode: 0o600 }); linkSync(path.join(root, 'shared-event'), file);
  assert.throws(() => VerifierStudyLedger.open(ledger.directory), /hard links/);
});

test('wrong permissions and foreign unexpected files are rejected, not changed or silently ignored', t => {
  const ledger = ledgerAt(t); const file = path.join(ledger.directory, 'event-000001.json');
  chmodSync(file, 0o644); assert.throws(() => VerifierStudyLedger.open(ledger.directory), /permissions/); assert.equal(lstatSync(file).mode & 0o777, 0o644);
  chmodSync(file, 0o600); writeFileSync(path.join(ledger.directory, 'report.json'), '{}', { mode: 0o600 });
  assert.throws(() => VerifierStudyLedger.open(ledger.directory), /unexpected/); assert.ok(existsSync(path.join(ledger.directory, 'report.json')));
});

test('secret fields and recognizable credentials never become persisted evidence', t => {
  const root = temporary(t);
  const syntheticSuffix = '123456789012345678901234'; // Runtime rejection fixture, never an actual credential.
  for (const [index, unsafe] of [{ apiKey: 'opaque' }, { nested: { authorization: 'opaque' } }, { metadata: 'apikey_' + syntheticSuffix }, { response: 'Bearer ' + syntheticSuffix }, { credential: 'sk-' + syntheticSuffix }, { private_key: 'opaque' }].entries()) {
    const directory = path.join(root, `unsafe-${index}`); assert.throws(() => VerifierStudyLedger.create(directory, { ...manifest(), ...unsafe }), /credential|secret/); assert.equal(existsSync(directory), false);
  }
  const ledger = VerifierStudyLedger.create(path.join(root, 'safe'), manifest());
  assert.throws(() => ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running', api_key: 'opaque' }), /secret/);
  assert.equal(ledger.readEvents().length, 1);
});

test('non-JSON values, circular/decorated/sparse objects and accessors are refused without running their getters', t => {
  const ledger = ledgerAt(t); const circular: Record<string, unknown> = {}; circular.self = circular;
  const decorated = Object.assign(['value'], { extra: 'value' }); const hiddenArray = Object.defineProperty(['value'], 'extra', { value: 'hidden', enumerable: false }); const sparse = Array<string>(2);
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), () => {}, circular, decorated, hiddenArray, sparse, { [Symbol('hidden')]: 'value' }]) {
    assert.throws(() => ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running', value }));
  }
  let getterCalls = 0; const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalls++; return 'leak'; } });
  const arrayGetter = Object.defineProperty(['safe'], '0', { enumerable: true, get() { getterCalls++; return 'leak'; } });
  for (const value of [getter, arrayGetter]) assert.throws(() => ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running', value }), /accessor/);
  assert.equal(getterCalls, 0); assert.equal(ledger.readEvents().length, 1);
  let proxyTraps = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { proxyTraps++; return Object.prototype; }, ownKeys() { proxyTraps++; return []; }, get() { proxyTraps++; return undefined; } });
  assert.throws(() => ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running', proxy }), /Proxy/);
  assert.equal(proxyTraps, 0); assert.equal(ledger.readEvents().length, 1);
});

test('duplicate/unbound intents, wrong run IDs, premature terminals and running decision-results fail before writes', t => {
  const ledger = ledgerAt(t); assert.throws(() => intent(ledger), /unbound/); decision(ledger);
  assert.throws(() => decision(ledger), /duplicate/); assert.throws(() => ledger.append('decision-result', { runId, decisionId, decision: 'abstain', status: 'running' }), /invalid/);
  assert.throws(() => ledger.append('call-intent', { runId: 'other', decisionId, callId, kind: 'llm', status: 'pending', usage: null }), /run ID/);
  intent(ledger); assert.throws(() => intent(ledger), /duplicate/); assert.throws(() => closeDecision(ledger), /unresolved/);
  assert.throws(() => ledger.append('run-end', { runId, status: 'failed' }), /close all/);
  assert.throws(() => ledger.append('call-result', { runId, decisionId, callId, status: 'unknown', usage: { inputTokens: 0, outputTokens: 0 } }), /unknown usage/);
  result(ledger); assert.throws(() => result(ledger), /duplicate/); closeDecision(ledger); assert.throws(() => closeDecision(ledger), /duplicate/);
  assert.equal(VerifierStudyLedger.open(ledger.directory).readEvents().length, 5);
});

test('call and decision results cannot contradict optional lineage fields in their persisted intents', t => {
  const ledger = ledgerAt(t); decision(ledger);
  for (const changed of [{ poolId: 'H02' }, { strategy: 'C' }]) assert.throws(() => ledger.append('call-intent', { runId, decisionId, callId, poolId: 'H01', strategy: 'B', kind: 'llm', status: 'pending', usage: null, ...changed }), /lineage/);
  ledger.append('call-intent', { runId, decisionId, callId, poolId: 'H01', strategy: 'B', kind: 'llm', status: 'pending', usage: null });
  for (const changed of [{ kind: 'jev' }, { poolId: 'H02' }, { strategy: 'C' }]) assert.throws(() => ledger.append('call-result', { runId, decisionId, callId, status: 'completed', usage: { inputTokens: 10, outputTokens: 3 }, ...changed }), /lineage/);
  result(ledger);
  for (const changed of [{ poolId: 'H02' }, { strategy: 'C' }]) assert.throws(() => ledger.append('decision-result', { runId, decisionId, decision: 'abstain', ...changed }), /lineage/);
  closeDecision(ledger); ledger.append('run-end', { runId, status: 'completed' });
  assert.equal(VerifierStudyLedger.open(ledger.directory).readEvents().at(-1)!.payload.status, 'completed');
});

test('pending Oracle has durable intent, no premature run-end, and explicit recovery records unknown without replay', t => {
  const ledger = ledgerAt(t); ledger.append('oracle-intent', { runId, oracleId: 'H01:a', poolId: 'H01', candidateId: 'a', status: 'pending' });
  assert.throws(() => ledger.append('run-end', { runId, status: 'completed' }), /close all/);
  assert.throws(() => ledger.append('oracle-result', { runId, oracleId: 'H01:a', poolId: 'H02', candidateId: 'a', status: 'completed', result: true }), /unbound/);
  const reopened = VerifierStudyLedger.open(ledger.directory); assert.equal(reopened.readEvents().length, 2);
  const recovery = reopened.recoverInterrupted(); const oracle = recovery.events.find(event => event.type === 'oracle-result')!;
  assert.equal(oracle.payload.status, 'unknown'); assert.equal(oracle.payload.result, null); assert.equal(oracle.payload.recoveryOnly, true);
  assert.equal(recovery.events.at(-1)!.payload.status, 'interrupted');
});

test('large frozen manifest is retained exactly while oversize manifest/events and oversized stored file fail closed', t => {
  const root = temporary(t); const directory = path.join(root, 'large'); const snapshot = 'a'.repeat(2 * 1024 * 1024);
  const ledger = VerifierStudyLedger.create(directory, { ...manifest(), inputSnapshots: [{ snapshot }] });
  assert.equal((ledger.readManifest().manifest.inputSnapshots as Array<{ snapshot: string }>)[0].snapshot.length, snapshot.length);
  assert.deepEqual(VerifierStudyLedger.open(directory).readManifest(), ledger.readManifest());
  assert.throws(() => VerifierStudyLedger.create(path.join(root, 'too-large'), { ...manifest(), snapshot: 'a'.repeat(8 * 1024 * 1024) }), /manifest size/);
  assert.equal(existsSync(path.join(root, 'too-large')), false);
  assert.throws(() => ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running', snapshot: 'b'.repeat(1024 * 1024) }), /size limit/);
  assert.equal(ledger.readEvents().length, 1);
  writeFileSync(path.join(directory, 'event-000001.json'), 'a'.repeat(1024 * 1024 + 1), { mode: 0o600 }); assert.throws(() => VerifierStudyLedger.open(directory), /file size/);
});

test('truncated/invalid events, sequence gaps and changed content hashes are rejected rather than skipped', t => {
  const root = temporary(t);
  for (const [name, mutate] of [
    ['truncated', (file: string) => writeFileSync(file, readFileSync(file, 'utf8').slice(0, -5), { mode: 0o600 })],
    ['invalid', (file: string) => writeFileSync(file, '{not-json}\n', { mode: 0o600 })],
    ['changed', (file: string) => { const body = JSON.parse(readFileSync(file, 'utf8')); body.payload.status = 'forged'; writeFileSync(file, `${JSON.stringify(body)}\n`, { mode: 0o600 }); }],
    ['gap', (file: string) => { writeFileSync(path.join(path.dirname(file), 'event-000002.json'), readFileSync(file), { mode: 0o600 }); rmSync(file); }],
  ] as const) {
    const ledger = VerifierStudyLedger.create(path.join(root, name), manifest()); mutate(path.join(ledger.directory, 'event-000001.json'));
    assert.throws(() => VerifierStudyLedger.open(ledger.directory), /truncated|JSON|hash|gap/);
  }
});

test('tampering with an earlier committed event blocks append; no updated in-memory or terminal record is fabricated', t => {
  const ledger = ledgerAt(t); decision(ledger);
  const first = path.join(ledger.directory, 'event-000001.json'); const body = JSON.parse(readFileSync(first, 'utf8')); body.payload.notes = 'changed'; writeFileSync(first, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  assert.throws(() => intent(ledger), /committed event changed/); assert.equal(ledger.isFaulted(), true); assert.equal(ledger.readEvents().length, 2);
  assert.equal(existsSync(path.join(ledger.directory, 'event-000003.json')), false);
});

test('manifest write failure prevents initialization and any simulated provider dispatch', t => {
  const directory = path.join(temporary(t), 'study'); let invocations = 0;
  const start = () => { VerifierStudyLedger.create(directory, manifest(), { beforePersist(operation) { if (operation === 'manifest') throw eio(); } }); invocations++; };
  assert.throws(start, /EIO/); assert.equal(invocations, 0); assert.equal(existsSync(path.join(directory, 'manifest.json')), false);
  assert.throws(() => VerifierStudyLedger.open(directory), /missing/);
});

test('intent write failure blocks dispatch and future writes; explicit reopen preserves prior records', t => {
  const ledger = ledgerAt(t, { beforePersist(operation, context) { if (operation === 'event' && context.eventType === 'call-intent') throw eio(); } }); decision(ledger); let invocations = 0;
  assert.throws(() => { intent(ledger); invocations++; }, /EIO/); assert.equal(invocations, 0); assert.equal(ledger.readEvents().length, 2); assert.equal(ledger.isFaulted(), true);
  assert.throws(() => intent(ledger), /write-disabled/); const recovered = VerifierStudyLedger.open(ledger.directory).recoverInterrupted();
  assert.equal(recovered.events.filter(event => event.type === 'call-intent').length, 0); assert.equal(recovered.events.at(-1)!.payload.usage, null);
});

test('failed directory fsync after intent file leaves unconfirmed evidence and open fails closed without authorizing dispatch', t => {
  const ledger = ledgerAt(t, { beforePersist(operation, context) { if (operation === 'directory-sync' && context.eventType === 'call-intent') throw eio(); } }); decision(ledger); let invocations = 0;
  assert.throws(() => { intent(ledger); invocations++; }, /EIO/); assert.equal(invocations, 0); assert.equal(ledger.readEvents().length, 2);
  const pending = JSON.parse(readFileSync(path.join(ledger.directory, 'event-000003.json'), 'utf8'));
  assert.equal(pending.type, 'call-intent'); assert.equal(pending.payload.status, 'pending'); assert.equal(pending.payload.usage, null);
  assert.equal(existsSync(path.join(ledger.directory, 'event-000003.commit.json')), false);
  assert.throws(() => VerifierStudyLedger.open(ledger.directory), /unconfirmed commit marker/);
  assert.equal(ledger.isFaulted(), true); assert.throws(() => ledger.recoverInterrupted(), /write-disabled/);
});

test('visible completed run-end whose event directory barrier failed has no confirmation and cannot reopen as successful', t => {
  const ledger = ledgerAt(t, { beforePersist(operation, context) { if (operation === 'directory-sync' && context.phase === 'event' && context.eventType === 'run-end') throw eio(); } });
  const originals = readdirSync(ledger.directory).map(file => [file, fileHash(path.join(ledger.directory, file))] as const);
  assert.throws(() => ledger.append('run-end', { runId, status: 'completed', summary: { passed: true } }), /EIO/);
  assert.equal(ledger.readEvents().length, 1); assert.equal(ledger.isFaulted(), true);
  const visible = JSON.parse(readFileSync(path.join(ledger.directory, 'event-000002.json'), 'utf8'));
  assert.equal(visible.payload.status, 'completed'); assert.equal(visible.payload.summary.passed, true);
  assert.equal(existsSync(path.join(ledger.directory, 'event-000002.commit.json')), false);
  assert.throws(() => VerifierStudyLedger.open(ledger.directory), /unconfirmed commit marker/);
  for (const [file, sha] of originals) assert.equal(fileHash(path.join(ledger.directory, file)), sha);
  assert.equal(existsSync(path.join(ledger.directory, 'report.json')), false);
});

test('marker creation failure keeps fsynced event unconfirmed and never repairs or discards original evidence', t => {
  const ledger = ledgerAt(t, { beforePersist(operation, context) { if (operation === 'commit-marker' && context.eventType === 'run-end') throw eio(); } });
  assert.throws(() => ledger.append('run-end', { runId, status: 'completed' }), /EIO/);
  const file = path.join(ledger.directory, 'event-000002.json'); const before = fileHash(file);
  assert.equal(existsSync(path.join(ledger.directory, 'event-000002.commit.json')), false);
  assert.throws(() => VerifierStudyLedger.open(ledger.directory), /unconfirmed commit marker/);
  assert.equal(fileHash(file), before); assert.equal(ledger.readEvents().length, 1);
});

test('late marker directory-sync failure cannot authorize callback, but a valid visible marker proves the earlier event barrier', t => {
  const phases: string[] = [];
  const ledger = ledgerAt(t, { beforePersist(operation, context) {
    if (context.eventType !== 'call-intent') return;
    phases.push(`${operation}:${context.phase}`);
    if (operation === 'directory-sync' && context.phase === 'commit-marker') throw eio();
  } }); decision(ledger); let invocations = 0;
  assert.throws(() => { intent(ledger); invocations++; }, /EIO/);
  assert.equal(invocations, 0); assert.equal(ledger.isFaulted(), true);
  assert.deepEqual(phases, ['event:event', 'directory-sync:event', 'commit-marker:commit-marker', 'directory-sync:commit-marker']);
  assert.equal(ledger.readEvents().length, 2);
  const reopened = VerifierStudyLedger.open(ledger.directory);
  assert.equal(reopened.readEvents().at(-1)!.type, 'call-intent', 'confirmation proves prior event barrier, not that append returned');
  const recovered = reopened.recoverInterrupted(); const call = recovered.events.find(event => event.type === 'call-result')!;
  assert.equal(call.payload.status, 'unknown'); assert.equal(call.payload.usage, null); assert.equal(call.payload.actualWireAttempts, null);
  assert.equal(invocations, 0); assert.equal(recovered.events.at(-1)!.payload.status, 'interrupted');
});

test('missing, partial, forged, wrong-scope and symlinked commit markers fail closed', t => {
  const root = temporary(t);
  const cases = ['missing', 'partial', 'event-hash', 'sequence', 'scope', 'previous-hash', 'orphan', 'symlink'] as const;
  for (const name of cases) {
    const ledger = VerifierStudyLedger.create(path.join(root, name), manifest()); const file = path.join(ledger.directory, 'event-000001.commit.json');
    const original = readFileSync(file, 'utf8');
    if (name === 'missing') rmSync(file);
    else if (name === 'partial') writeFileSync(file, original.slice(0, -7), { mode: 0o600 });
    else if (name === 'orphan') writeFileSync(path.join(ledger.directory, 'event-000002.commit.json'), original, { mode: 0o600 });
    else if (name === 'symlink') { rmSync(file); symlinkSync(path.join(ledger.directory, 'manifest.json'), file); }
    else {
      const body = JSON.parse(original);
      if (name === 'event-hash') body.eventHash = '0'.repeat(64);
      if (name === 'sequence') body.sequence = 2;
      if (name === 'scope') body.directoryHash = '0'.repeat(64);
      if (name === 'previous-hash') body.previousCommitHash = '0'.repeat(64);
      writeFileSync(file, `${JSON.stringify(body)}\n`, { mode: 0o600 });
    }
    const before = readdirSync(ledger.directory).map(entry => [entry, lstatSync(path.join(ledger.directory, entry)).isSymbolicLink() ? 'symlink' : fileHash(path.join(ledger.directory, entry))]);
    assert.throws(() => VerifierStudyLedger.open(ledger.directory), /unconfirmed|truncated|marker|symlink/);
    assert.deepEqual(readdirSync(ledger.directory).map(entry => [entry, lstatSync(path.join(ledger.directory, entry)).isSymbolicLink() ? 'symlink' : fileHash(path.join(ledger.directory, entry))]), before);
  }
});

test('an earlier confirmation marker changed after opening also blocks future append', t => {
  const ledger = ledgerAt(t); const file = path.join(ledger.directory, 'event-000001.commit.json');
  const body = JSON.parse(readFileSync(file, 'utf8')); body.eventHash = '0'.repeat(64); writeFileSync(file, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  assert.throws(() => decision(ledger), /committed marker changed/); assert.equal(ledger.isFaulted(), true);
  assert.equal(existsSync(path.join(ledger.directory, 'event-000002.json')), false);
});

test('terminal write failure does not roll back independently committed manifest, call or decision', t => {
  const ledger = ledgerAt(t, { beforePersist(operation, context) { if (operation === 'event' && context.eventType === 'run-end') throw eio(); } }); decision(ledger); intent(ledger); result(ledger); closeDecision(ledger);
  const originals = readdirSync(ledger.directory).map(file => [file, fileHash(path.join(ledger.directory, file))] as const);
  assert.throws(() => ledger.append('run-end', { runId, status: 'completed', summary: { selected: 0 } }), /EIO/);
  assert.equal(ledger.readEvents().length, 5); const recovered = VerifierStudyLedger.open(ledger.directory).recoverInterrupted();
  assert.equal(recovered.events.at(-1)!.payload.status, 'interrupted'); assert.equal(recovered.events.at(-1)!.payload.usage, null);
  assert.equal(recovered.events.find(event => event.type === 'call-result')!.payload.status, 'completed');
  for (const [file, sha] of originals) assert.equal(fileHash(path.join(ledger.directory, file)), sha);
  assert.equal(existsSync(path.join(ledger.directory, 'report.json')), false);
});

test('a stale second writer cannot overwrite or fork the append-only chain', t => {
  const first = ledgerAt(t); const second = VerifierStudyLedger.open(first.directory); decision(first);
  assert.throws(() => decision(second), /another writer/); assert.equal(second.isFaulted(), true);
  assert.deepEqual(VerifierStudyLedger.open(first.directory).readEvents(), first.readEvents());
});

for (const point of ['after-start', 'after-intent', 'after-call-result']) test(`SIGKILL ${point}: committed evidence survives, recovery keeps unknown totals and cannot replay callback`, async t => {
  const root = temporary(t); const directory = path.join(root, 'study'); const counter = path.join(root, 'injected-callback-count');
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, directory, point, counter], { cwd: project, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let errors = ''; child.stderr!.on('data', data => { errors += String(data); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash fixture timeout: ${errors}`)); }, 15_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('message', message => { try { assert.deepEqual(message, { ready: true, point }); child.kill('SIGKILL'); } catch (error) { clearTimeout(timer); reject(error); } });
    child.once('exit', (code, signal) => { clearTimeout(timer); if (signal === 'SIGKILL') resolve(); else reject(new Error(`Crash fixture exited ${code}/${signal}: ${errors}`)); });
  });
  const before = readFileSync(counter, 'utf8'); assert.equal(before, point === 'after-call-result' ? '1' : '0');
  const ledger = VerifierStudyLedger.open(directory); const originalHashes = readdirSync(directory).map(file => [file, fileHash(path.join(directory, file))] as const);
  assert.equal(ledger.readEvents()[0].type, 'run-start'); assert.equal(ledger.readEvents().filter(event => event.type === 'call-intent').length, point === 'after-start' ? 0 : 1);
  assert.equal(ledger.readEvents().filter(event => event.type === 'call-result').length, point === 'after-call-result' ? 1 : 0);
  assert.equal(ledger.readEvents().some(event => event.type === 'run-end'), false);
  const recovered = ledger.recoverInterrupted(); assert.equal(recovered.recovered, true); assert.equal(recovered.events.at(-1)!.payload.status, 'interrupted'); assert.equal(recovered.events.at(-1)!.payload.usage, null);
  if (point === 'after-intent') { const call = recovered.events.find(event => event.type === 'call-result')!; assert.equal(call.payload.usage, null); assert.equal(call.payload.status, 'unknown'); }
  if (point === 'after-call-result') assert.equal((recovered.events.find(event => event.type === 'call-result')!.payload.usage as Record<string, unknown>).inputTokens, 7);
  assert.equal(readFileSync(counter, 'utf8'), before, 'explicit recovery must not re-invoke injected callback');
  for (const [file, sha] of originalHashes) assert.equal(fileHash(path.join(directory, file)), sha);
  assert.equal(existsSync(path.join(directory, 'report.json')), false); assert.equal(VerifierStudyLedger.open(directory).recoverInterrupted().recovered, false);
});
