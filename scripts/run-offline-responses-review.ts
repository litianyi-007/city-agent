import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fingerprint } from '../shared/evidence';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';

// This command owns no provider URL, credential, budget authorization or response repair option.
const root = fileURLToPath(new URL('..', import.meta.url)), args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--local-full')) throw new Error('用法：npm run review:responses:offline [-- --local-full]；不接受Key、URL或实验预算。');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('离线Responses复核需要Node22。');
const scope = args.includes('--local-full') ? 'local-full' : 'repository';
const startedAt = new Date().toISOString(), start = performance.now();
const names = ['scripts/run-offline-responses-review.ts', 'server/research/responses-stream.mjs', 'server/research/responses-stream.d.mts',
  'server/research/responses-relay.ts', 'server/research/structured-responses-harness.ts', 'server/research/structured-responses-plugin.mjs',
  'tests/responses-stream.test.ts', 'tests/responses-relay.test.ts', 'tests/structured-responses-harness.test.ts',
  'shared/answer-contract.ts', 'shared/redaction.ts', 'shared/evidence.ts', 'server/research/experiment-budget.ts', 'server/research/historical-integrity.ts'];
const capture = () => Promise.all(names.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(root, name))).digest('hex') })));
const sourceFiles = await capture(), before = await verifyHistoricalEvidence(root, scope);
// Strip all model secrets and runtime overrides from the child. Each registered test creates its own synthetic fixture.
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
const command = ['--import', 'tsx', '--test', 'tests/responses-stream.test.ts', 'tests/responses-relay.test.ts', 'tests/structured-responses-harness.test.ts'];
const { stdout, stderr } = await promisify(execFile)(process.execPath, command, { cwd: root, env, timeout: 60_000, maxBuffer: 2_000_000 });
const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
if (!(counts.tests > 0) || counts.pass !== counts.tests || [counts.fail, counts.cancelled, counts.skipped, counts.todo].some(value => value !== 0)) throw new Error('注册Responses离线测试未全部完成通过；不导出通过报告。');
const after = await verifyHistoricalEvidence(root, scope);
if (fingerprint(before) !== fingerprint(after) || fingerprint(sourceFiles) !== fingerprint(await capture())) throw new Error('复核期间历史证据或源码漂移；不导出通过报告。');
const report = { version: 'offline-responses-review-1.0', startedAt, endedAt: new Date().toISOString(), durationMs: performance.now() - start,
  proofScope: 'registered-local-tests-with-real-DSH-child', counts, command: ['node', ...command],
  providerRequests: 0, inputTokens: 0, outputTokens: 0, apiCostCny: 0, syntheticUsageIsNotBilling: true,
  realProviderSchemaSupport: 'not-tested', productionRouteActivated: false, logicOrMarketQualityCertified: false,
  historicalIntegrity: { scope, verifiedCount: after.verifiedCount, beforeHash: fingerprint(before), afterHash: fingerprint(after), matched: true },
  source: { node: process.versions.node, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim(),
    files: sourceFiles, fileHashAlgorithm: 'sha256-file-bytes', workingTreeSnapshotNotNewPublishedCommit: true },
  limitation: 'Synthetic upstream bytes/keys and budget ledger are test fixtures. Local HTTP/real Harness process do not prove provider schema support, CORS, billing or resident preferences. Total duration includes tests and before/after verification; excludes artifact export.' };
const parent = path.join(root, 'output/offline-review'); await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, 'responses-'));
// Write the pass report last, so a failed artifact export cannot leave a misleading completion marker.
for (const [name, content] of [['tests.tap', stdout], ['test-warnings.txt', stderr], ['historical-integrity.json', JSON.stringify(after, null, 2) + '\n'],
  ['report.json', JSON.stringify(report, null, 2) + '\n']]) await writeFile(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory, counts, verifiedHistoricalFiles: after.verifiedCount, sourceFiles: sourceFiles.length, providerRequests: 0, apiCostCny: 0, durationMs: report.durationMs }, null, 2));
