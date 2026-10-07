import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../shared/evidence';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';
import { captureOfflineSources } from '../server/research/offline-source-seal';
import { parseOfflineTapSummary, runOfflineJob, verifyOfflineReviewEnd, writeOfflineReviewBundle } from '../server/research/offline-review-runtime';

const root = fileURLToPath(new URL('..', import.meta.url)), args = process.argv.slice(2);
if (args.some(arg => !['--load-check', '--local-full'].includes(arg)) || args.length !== new Set(args).size) throw new Error('仅支持 --load-check / --local-full；不接收Key、URL、预算或自定义命令。');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('全套离线日志复核需要Node22。');
const scope = args.includes('--local-full') ? 'local-full' : 'repository', startedAt = new Date().toISOString(), start = performance.now();
const sources = await captureOfflineSources(root), before = await verifyHistoricalEvidence(root, scope);
// Derive the fixed test list from the same BEFORE inventory that is hashed.
const tests = sources.map(source => source.name).filter(name => /^tests\/[^/]+\.test\.ts$/.test(name));
if (tests.length === 0) throw new Error('No registered unit tests in sealed inventory; automatic discovery is refused.');
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim();
const jobs = [{ name: 'unit', executable: process.execPath, args: ['--import', 'tsx', '--test', ...tests] },
  ...(args.includes('--load-check') ? [
    { name: 'browser', executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'test:e2e'] },
    { name: 'pages-build', executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build:pages'] },
    { name: 'responses', executable: process.execPath, args: ['--import', 'tsx', 'scripts/run-offline-responses-review.ts', ...(scope === 'local-full' ? ['--local-full'] : [])] },
  ] : [])];
const cancellation = new AbortController(), cancel = () => cancellation.abort();
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
try {
const results = await Promise.all(jobs.map(job => runOfflineJob(job, { cwd: root, env, signal: cancellation.signal })));
const end = await verifyOfflineReviewEnd({ sourcesBefore: sources, historyBefore: before,
  captureSources: () => captureOfflineSources(root), verifyHistory: () => verifyHistoricalEvidence(root, scope) });
const { counts, complete } = parseOfflineTapSummary(results.find(result => result.name === 'unit')!.stdout.toString('utf8'));
const passed = !cancellation.signal.aborted && end.sourceMatched && end.historicalMatched && complete
  && results.every(result => result.exitCode === 0 && !result.signal && !result.timedOut && !result.cancelled && !result.logTruncated && !result.startFailed && !result.orphanedGroupDetected)
  && counts.tests > 0 && counts.pass === counts.tests && [counts.fail, counts.cancelled, counts.skipped, counts.todo].every(value => value === 0);
const report = { version: 'offline-system-review-1.1', startedAt, endedAt: new Date().toISOString(), durationMs: performance.now() - start,
  status: passed ? 'passed' : 'failed', cancelled: cancellation.signal.aborted, loadCheck: args.includes('--load-check'), counts,
  jobs: results.map(({ stdout, stderr, ...summary }) => ({ ...summary,
    stdoutBytes: stdout.length, stderrBytes: stderr.length,
    stdoutSha256: createHash('sha256').update(stdout).digest('hex'), stderrSha256: createHash('sha256').update(stderr).digest('hex') })),
  source: { node: process.versions.node, head, files: sources, filesAfter: end.sourcesAfter,
    sourceMatched: end.sourceMatched, verificationState: end.sourceVerificationState,
    inventorySha256: fingerprint(sources), workingTreeSnapshotNotNewPublishedCommit: true,
    scope: 'fixed application/test directories and root entry/config files; excludes dependencies, public assets, private data and environment files' },
  historicalIntegrity: { scope, verifiedCount: end.historyAfter?.verifiedCount ?? null, beforeCount: before.verifiedCount,
    matched: end.historicalMatched, verificationState: end.historicalVerificationState },
  runner: { jobTimeoutMs: 150_000, terminationGraceMs: 2_000, combinedLogCapBytesPerJob: 16 * 1024 * 1024,
    processGroupCleanup: 'own-posix-job-group-only', detachedDescendantCleanupCertified: false, windowsSupport: 'fail-closed', uniqueTapSummaryRequired: true,
    cancellation: 'SIGINT/SIGTERM abort jobs, preserve received logs, emit failure; SIGKILL not recoverable' },
  providerRequests: 0, apiCostCny: 0, realProviderSchemaSupport: 'not-tested', productionRouteActivated: false,
  limitation: 'Registered fixture tests only; no live provider authority. Received stdout/stderr retained even on test/end-check failure, subject to the explicit byte cap and timeout closure. A subsequent pass does not establish the cause of an earlier transient failure. Duration includes checks/tests, excludes bundle export.' };
const directory = await writeOfflineReviewBundle({ parent: path.join(root, 'output/offline-review'), results,
  historicalIntegrity: { before, after: end.historyAfter, verificationState: end.historicalVerificationState }, report });
console.log(JSON.stringify({ directory, status: report.status, counts, jobs: report.jobs,
  historicalFiles: end.historyAfter?.verifiedCount ?? null, sourceFiles: sources.length, durationMs: report.durationMs }, null, 2));
process.exitCode = passed ? 0 : 1;
} finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
