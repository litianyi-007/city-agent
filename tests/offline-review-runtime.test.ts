import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseOfflineTapSummary, runOfflineJob, verifyOfflineReviewEnd, writeOfflineReviewBundle } from '../server/research/offline-review-runtime';

const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
const job = (code: string) => ({ name: 'fixture', executable: process.execPath, args: ['-e', code] });

test('offline runner preserves separate raw byte logs, including split UTF8', async () => {
  const result = await runOfflineJob(job("process.stdout.write(Buffer.from([0xe4])); setTimeout(() => { process.stdout.write(Buffer.from([0xb8,0xad])); process.stderr.write(Buffer.from([0xff,0x00])); }, 20);"), { cwd: process.cwd(), env });
  assert.equal(result.exitCode, 0); assert.equal(result.startFailed, false);
  assert.deepEqual(result.stdout, Buffer.from('中')); assert.deepEqual(result.stderr, Buffer.from([0xff, 0x00]));
  assert.equal(result.logTruncated, false); assert.equal(result.timedOut, false);
});

test('offline runner caps combined stdout/stderr bytes and rejects truncated output', async () => {
  const result = await runOfflineJob(job("process.stdout.write(Buffer.alloc(256, 65)); process.stderr.write(Buffer.alloc(256, 66)); setInterval(() => {}, 1000);"),
    { cwd: process.cwd(), env, maxLogBytes: 300, graceMs: 30 });
  assert.equal(result.logTruncated, true); assert.equal(result.timedOut, false);
  assert.equal(result.stdout.length + result.stderr.length, 300);
  assert.ok(result.stdout.every(byte => byte === 65)); assert.ok(result.stderr.every(byte => byte === 66));
});

test('offline timeout escalates after leader close to kill an ignored-stdio same-group descendant', async () => {
  const code = "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\", () => {}); setInterval(() => {}, 1000);'], {stdio:'ignore'}); console.log(child.pid); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);";
  const result = await runOfflineJob(job(code), { cwd: process.cwd(), env, timeoutMs: 2_000, graceMs: 100 });
  assert.equal(result.timedOut, true); assert.equal(result.logTruncated, false);
  const pid = Number(result.stdout.toString('utf8').trim()); assert.ok(Number.isSafeInteger(pid) && pid > 1);
  // This PID belongs only to this test fixture. Never target IDs from user input.
  for (let attempt = 0; attempt < 50; attempt++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  // Safe cleanup if an assertion would otherwise leave this synthetic child alive.
  try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone. */ }
  assert.fail('Own fixture descendant remained alive after timeout escalation.');
});

test('offline spawn errors are controlled and do not produce successful job state', async () => {
  const result = await runOfflineJob({ name: 'fixture', executable: '/nonexistent-offline-fixture-command', args: [] }, { cwd: process.cwd(), env });
  assert.equal(result.startFailed, true); assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout.length, 0); assert.match(result.stderr.toString('utf8'), /could not start/);
});

test('leader exit, including code zero, cannot leave an ignored-stdio owned group child running', async () => {
  for (const code of [0, 1]) {
    const fixture = `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.send("ready");'], {stdio:['ignore','ignore','ignore','ipc']}); child.once('message', () => { console.log(child.pid); process.exit(${code}); });`;
    const result = await runOfflineJob(job(fixture), { cwd: process.cwd(), env, graceMs: 50 });
    assert.equal(result.exitCode, code); assert.equal(result.orphanedGroupDetected, true);
    assert.equal(result.timedOut, false); const pid = Number(result.stdout.toString('utf8').trim());
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    let alive = true;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(pid, 0); } catch { alive = false; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* Own fixture already gone. */ } }
    assert.equal(alive, false, 'Own fixture descendant remained alive after leader-exit cleanup.');
  }
});

test('offline jobs support controlled cancellation without serializing caller reasons', async () => {
  const pre = new AbortController(); pre.abort(new Error('synthetic-private-cancel-reason'));
  const rejected = await runOfflineJob(job("console.log('must-not-start');"), { cwd: process.cwd(), env, signal: pre.signal });
  assert.equal(rejected.cancelled, true); assert.equal(rejected.stdout.length, 0);
  assert.doesNotMatch(rejected.stderr.toString('utf8'), /synthetic-private/);
  const mid = new AbortController(), timer = setTimeout(() => mid.abort(new Error('synthetic-private-cancel-reason')), 150);
  try {
    const stopped = await runOfflineJob(job('setInterval(() => {}, 1000);'), { cwd: process.cwd(), env, signal: mid.signal, graceMs: 30 });
    assert.equal(stopped.cancelled, true); assert.equal(stopped.timedOut, false);
    assert.doesNotMatch(stopped.stderr.toString('utf8'), /synthetic-private/);
  } finally { clearTimeout(timer); }
});

test('offline TAP requires exactly one complete, safe integer summary', () => {
  const summary = '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(parseOfflineTapSummary(summary).complete, true);
  assert.equal(parseOfflineTapSummary(summary + '# pass 1\n').complete, false);
  assert.equal(parseOfflineTapSummary(summary.replace('# todo 0\n', '')).complete, false);
  assert.equal(parseOfflineTapSummary(summary.replace('# tests 1', '# tests 999999999999999999999')).complete, false);
});

test('source/history end-check exceptions preserve collected logs and static failure report', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'city-offline-negative-'));
  try {
    const before = [{ name: 'fixture.ts', sha256: 'initial' }], history = { verifiedCount: 1 };
    const end = await verifyOfflineReviewEnd({ sourcesBefore: before, historyBefore: history,
      captureSources: async () => { throw new Error('synthetic-private-text-never-export'); },
      verifyHistory: async () => { throw new Error('synthetic-private-text-never-export'); } });
    assert.equal(end.sourceMatched, false); assert.equal(end.historicalMatched, false);
    assert.equal(end.sourceVerificationState, 'verification-failed'); assert.equal(end.historicalVerificationState, 'verification-failed');
    const result = await runOfflineJob(job("process.stdout.write('fixture-out'); process.stderr.write('fixture-err'); process.exitCode = 1;"), { cwd: process.cwd(), env });
    const directory = await writeOfflineReviewBundle({ parent, results: [result], historicalIntegrity: { before: history, after: end.historyAfter }, report: { status: 'failed', ...end } });
    assert.equal(await readFile(path.join(directory, 'fixture.stdout.log'), 'utf8'), 'fixture-out');
    assert.equal(await readFile(path.join(directory, 'fixture.stderr.log'), 'utf8'), 'fixture-err');
    const report = await readFile(path.join(directory, 'report.json'), 'utf8'); assert.doesNotMatch(report, /synthetic-private-text/);
    assert.equal(JSON.parse(report).status, 'failed');
    assert.equal((await stat(path.join(directory, 'report.json'))).mode & 0o777, 0o600);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('offline end seal independently detects changed source or historical inventory', async () => {
  const end = await verifyOfflineReviewEnd({ sourcesBefore: [{ name: 'a.ts', sha256: 'one' }], historyBefore: { count: 1 },
    captureSources: async () => [{ name: 'a.ts', sha256: 'one' }, { name: 'added.ts', sha256: 'two' }], verifyHistory: async () => ({ count: 2 }) });
  assert.equal(end.sourceVerificationState, 'changed'); assert.equal(end.historicalVerificationState, 'changed');
  assert.equal(end.sourceMatched, false); assert.equal(end.historicalMatched, false);
});

test('bundle export failure does not leave a misleading pass report', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'city-offline-export-negative-'));
  try {
    await assert.rejects(writeOfflineReviewBundle({ parent, results: [], historicalIntegrity: { state: 'saved' },
      report: { status: 'passed', invalidSyntheticField: 1n } }), /BigInt/);
    const [name] = await readdir(parent); assert.ok(name.startsWith('system-'));
    assert.equal(JSON.parse(await readFile(path.join(parent, name, 'historical-integrity.json'), 'utf8')).state, 'saved');
    await assert.rejects(stat(path.join(parent, name, 'report.json')), { code: 'ENOENT' });
  } finally { await rm(parent, { recursive: true, force: true }); }
});
