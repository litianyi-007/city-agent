import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fingerprint } from '../../shared/evidence';

export interface OfflineJob { name: string; executable: string; args: string[] }
export interface OfflineJobResult {
  name: string; exitCode: number | null; signal: NodeJS.Signals | null;
  timedOut: boolean; cancelled: boolean; logTruncated: boolean; startFailed: boolean; orphanedGroupDetected: boolean;
  stdout: Buffer; stderr: Buffer;
}

// Only this invocation's POSIX process group is signalled. A detached browser may
// create another group: its registered job must clean it up; this is not a claim
// that arbitrary detached descendants are supervised. Windows is fail-closed.
export function runOfflineJob(job: OfflineJob, options: {
  cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; maxLogBytes?: number; graceMs?: number; signal?: AbortSignal;
}): Promise<OfflineJobResult> {
  const timeoutMs = options.timeoutMs ?? 150_000, maxLogBytes = options.maxLogBytes ?? 16 * 1024 * 1024;
  const graceMs = options.graceMs ?? 2_000;
  if (![timeoutMs, maxLogBytes, graceMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid offline runner limits.');
  if (process.platform === 'win32' || options.signal?.aborted) return Promise.resolve({ name: job.name, exitCode: null, signal: null,
    timedOut: false, cancelled: Boolean(options.signal?.aborted), logTruncated: false,
    startFailed: !options.signal?.aborted, orphanedGroupDetected: false, stdout: Buffer.alloc(0),
    stderr: Buffer.from(options.signal?.aborted ? 'Offline job cancelled before start.\n' : 'Offline process-group supervision is not available on this platform.\n') });
  return new Promise(resolve => {
    const child = spawn(job.executable, job.args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let retainedBytes = 0, timedOut = false, cancelled = false, logTruncated = false, startFailed = false, stopping = false, orphanedGroupDetected = false;
    let forceKillCompleted = Promise.resolve();
    const signalGroup = (signal: NodeJS.Signals) => {
      // The identifier comes only from spawn, never flags, environment or logs.
      if (child.pid && Number.isSafeInteger(child.pid) && child.pid > 1) {
        try { process.kill(-child.pid, signal); } catch { /* An exited owned group needs no signal. */ }
      }
    };
    const stop = () => {
      if (stopping) return; stopping = true; signalGroup('SIGTERM');
      // Do not cancel this escalation when the leader closes: a same-group child
      // with ignored stdio may outlive the leader and ignore SIGTERM.
      forceKillCompleted = new Promise(done => setTimeout(() => {
        signalGroup('SIGKILL');
        // A separately detached descendant may retain a pipe outside this group.
        // Close our readers after escalation so a failed job cannot hang forever.
        child.stdout.destroy(); child.stderr.destroy(); done();
      }, graceMs));
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const abort = () => { cancelled = true; stop(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const retain = (target: Buffer[], bytes: Buffer) => {
      const room = Math.max(0, maxLogBytes - retainedBytes), length = Math.min(room, bytes.length);
      if (length) { target.push(Buffer.from(bytes.subarray(0, length))); retainedBytes += length; }
      if (length < bytes.length) { logTruncated = true; stop(); }
    };
    child.stdout.on('data', bytes => retain(stdout, bytes));
    child.stderr.on('data', bytes => retain(stderr, bytes));
    child.once('error', () => { startFailed = true; retain(stderr, Buffer.from('Offline runner could not start registered job.\n')); });
    child.once('close', async (exitCode, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      // A leader can exit (even with code 0) while ignored-stdio children in its
      // own group continue running. Detect and terminate that group before return.
      if (!stopping && child.pid && Number.isSafeInteger(child.pid) && child.pid > 1) {
        try { process.kill(-child.pid, 0); orphanedGroupDetected = true; stop(); } catch { /* Owned group has already exited. */ }
      }
      await forceKillCompleted;
      resolve({ name: job.name, exitCode, signal, timedOut, cancelled, logTruncated, startFailed, orphanedGroupDetected,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export function parseOfflineTapSummary(stdout: string) {
  const keys = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'], counts: Record<string, number> = {};
  let unique = true;
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)) {
    if (Object.hasOwn(counts, match[1])) unique = false;
    counts[match[1]] = Number(match[2]);
  }
  const complete = unique && keys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
  return { counts, complete };
}

export async function verifyOfflineReviewEnd<S, H>(input: {
  sourcesBefore: S; historyBefore: H; captureSources: () => Promise<S>; verifyHistory: () => Promise<H>;
}) {
  let sourcesAfter: S | null = null, historyAfter: H | null = null;
  let sourceVerificationState: 'matched' | 'changed' | 'verification-failed' = 'verification-failed';
  let historicalVerificationState: 'matched' | 'changed' | 'verification-failed' = 'verification-failed';
  // Static failure states intentionally do not serialize thrown paths or secrets.
  try { sourcesAfter = await input.captureSources(); sourceVerificationState = fingerprint(input.sourcesBefore) === fingerprint(sourcesAfter) ? 'matched' : 'changed'; } catch { /* Preserve job logs on end-check failure. */ }
  try { historyAfter = await input.verifyHistory(); historicalVerificationState = fingerprint(input.historyBefore) === fingerprint(historyAfter) ? 'matched' : 'changed'; } catch { /* Preserve job logs on end-check failure. */ }
  return { sourcesAfter, historyAfter, sourceVerificationState, historicalVerificationState,
    sourceMatched: sourceVerificationState === 'matched', historicalMatched: historicalVerificationState === 'matched' };
}

export async function writeOfflineReviewBundle(input: {
  parent: string; results: OfflineJobResult[]; historicalIntegrity: unknown; report: unknown;
}) {
  await mkdir(input.parent, { recursive: true });
  const directory = await mkdtemp(path.join(input.parent, 'system-'));
  for (const result of input.results) {
    if (!/^[a-z][a-z-]*$/.test(result.name)) throw new Error('Invalid registered offline job name.');
    for (const kind of ['stdout', 'stderr'] as const) await writeFile(path.join(directory, `${result.name}.${kind}.log`), result[kind], { flag: 'wx', mode: 0o600 });
  }
  await writeFile(path.join(directory, 'historical-integrity.json'), JSON.stringify(input.historicalIntegrity, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // The completion marker comes last; failed persistence cannot leave a pass report.
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(input.report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return directory;
}
