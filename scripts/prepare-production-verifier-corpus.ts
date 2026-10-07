import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runGate } from '../server/gate.js';
import { codeSchema, testsSchema } from '../server/production/contracts.js';
import { cameraSceneCodeSchema } from '../shared/camera-scene-schema.js';
import { runVerifierSceneOracle } from '../server/production/verifier-scene-oracle.js';
import { verifierPreparationManifest, verifierPreparationProgress, type VerifierPreparationIntent } from '../server/production/verifier-corpus-preparation.js';
import { VERIFIER_CHALLENGE_CORPUS_VERSION, VERIFIER_CHALLENGE_HTML_POOLS, VERIFIER_CHALLENGE_SCENE_POOLS, VERIFIER_CHALLENGE_EXPECTATIONS } from '../shared/production-verifier-challenge-corpus.js';

// Trusted free engineering preparation only. No models, credentials, generated
// host code, media permissions, credential reads, provider calls or production
// Store instantiation. Constants transitively import the Harness SDK/store hash.
const root = realpathSync(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
if (realpathSync(process.cwd()) !== root || !root.endsWith('/city-agent-autonomous-production')) throw new Error('Run from the autonomous production worktree');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('branch', '--show-current') !== 'feature/autonomous-production') throw new Error('Unexpected worktree branch');
const outputRoot = join(root, 'output');
if (lstatSync(outputRoot).isSymbolicLink() || realpathSync(outputRoot) !== outputRoot) throw new Error('Output must be the independent real worktree output directory');
const directory = mkdtempSync(join(outputRoot, 'production-verifier-preparation-'));
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const startedAt = new Date().toISOString();
const sources = ['shared/production-verifier-html-corpus-a.ts', 'shared/production-verifier-html-corpus-b.ts', 'shared/production-verifier-scene-corpus.ts', 'shared/production-verifier-challenge-corpus.ts', 'server/production/verifier-corpus-preparation.ts', 'server/production/verifier-scene-oracle.ts', 'server/gate.ts', 'server/production/camera-gate.ts', 'shared/camera-scene-runtime.ts', 'shared/camera-scene-schema.ts', 'shared/camera-asset-manifest.ts', 'shared/camera-hand-worker.ts', 'shared/camera-test-semantics.ts', 'shared/production-schema.ts', 'shared/production-coverage.ts', 'shared/production-execution-profile.ts', 'shared/jev-schema.ts', 'server/production/contracts.ts', 'shared/production-verifier-rubric.ts', 'server/production/jev.ts', 'server/production/acceptance-preflight.ts', 'server/production/review-context.ts', 'server/production/output-diagnostics.ts', 'server/production/store.ts', 'server/harness.ts', 'server/harness-literal-prompt.mjs', 'server/usage-observer.ts', 'scripts/prepare-production-verifier-corpus.ts', 'package.json', 'package-lock.json', 'tsconfig.json'];
const sourceHash = (path: string) => { const absolute = join(root, path); if (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute) throw new Error(`Source is not an independent real file: ${path}`); return createHash('sha256').update(readFileSync(absolute)).digest('hex'); };
const sourceHashes = Object.fromEntries(sources.map(path => [path, sourceHash(path)]));
const manifest = { ...verifierPreparationManifest(), startedAt, sourceCommit: git('rev-parse', 'HEAD'), sourceClean: git('status', '--porcelain', '--untracked-files=normal') === '', nodeVersion: process.version, sourceHashes, labelSha256: hash(VERIFIER_CHALLENGE_EXPECTATIONS), corpusSha256: hash([...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS]), localOnly: true, license: 'Repository-authored synthetic fixtures; repository license applies; not business tickets' };
write('manifest.json', manifest);
write('candidates.json', { version: VERIFIER_CHALLENGE_CORPUS_VERSION, pools: [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS] });
write('labels-controller-only.json', VERIFIER_CHALLENGE_EXPECTATIONS);
if (!manifest.bytePreflight.valid) throw new Error(`Byte preflight refused; preserved ${directory}`);
const controller = new AbortController();
const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
const results: { poolId: string; candidateId: string; expectedPass: boolean; candidateValueJsonSha256: string; checksSha256: string; actual: unknown; matched: boolean; healthy: boolean }[] = [];
const intents: (VerifierPreparationIntent & { startedAt: string; endedAt?: string; candidateValueJsonSha256: string; checksSha256: string; error?: string })[] = [];
let currentIntent: (typeof intents)[number] | undefined;
let failure: string | null = null; let browserVersion: string | null = null;
const start = performance.now();
const assertSource = () => {
  if (git('rev-parse', 'HEAD') !== manifest.sourceCommit || git('branch', '--show-current') !== 'feature/autonomous-production') throw new Error('Preparation HEAD/branch changed');
  for (const [path, expected] of Object.entries(sourceHashes)) if (sourceHash(path) !== expected) throw new Error(`Preparation source changed: ${path}`);
};
try {
  const browser = await chromium.launch({ headless: true, timeout: 8000 });
  try { browserVersion = browser.version(); } finally { await browser.close(); }
  for (const pool of [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS]) {
    for (const candidate of pool.candidates) {
      controller.signal.throwIfAborted();
      assertSource();
      const before = hash({ pool, candidate });
      currentIntent = { poolId: pool.id, candidateId: candidate.id, status: 'started', startedAt: new Date().toISOString(), candidateValueJsonSha256: hash(candidate.value), checksSha256: hash(pool.checks) };
      intents.push(currentIntent); write(`intent-${pool.id}-${candidate.id}.json`, currentIntent);
      testsSchema.parse({ checks: pool.checks });
      const label = VERIFIER_CHALLENGE_EXPECTATIONS.find(item => item.poolId === pool.id && item.candidateId === candidate.id);
      if (!label) throw new Error('Missing independent control label');
      let actual; let healthy: boolean;
      if ('scene' in candidate.value && 'required' in pool) {
        cameraSceneCodeSchema.parse(candidate.value);
        actual = await runVerifierSceneOracle(pool, candidate.value.scene, controller.signal);
        const allChecks = [...actual.gate.checks, ...(actual.componentDiagnostics ?? []).flatMap(item => item.gate.checks)];
        healthy = !actual.failureKind && !actual.gate.failureKind && actual.gate.checks[0]?.passed === true && allChecks.every(check => !/timed?\s*out|超时|超过.*秒|JavaScript错误|JavaScript 错误|未授权网络|连接失败|Chromium 运行环境/i.test(check.detail ?? ''));
      } else if ('html' in candidate.value) {
        codeSchema.parse(candidate.value);
        actual = await runGate(candidate.value.html, structuredClone(pool.checks), controller.signal);
        healthy = !actual.failureKind && actual.checks[0]?.passed === true && actual.checks.length === pool.checks.length + 1 && actual.checks.filter(check => !check.passed).every(check => /文本不精确等于|元素数量不等于|的值不是/.test(check.detail ?? '') && !/JavaScript|页面错误|网络|跳转|超时|超过|Timeout|Chromium/i.test(check.detail ?? ''));
      } else throw new Error('Candidate capability does not match pool');
      controller.signal.throwIfAborted();
      if (hash({ pool, candidate }) !== before) throw new Error('Candidate or frozen checks changed during Oracle execution');
      assertSource();
      const result = { poolId: pool.id, candidateId: candidate.id, expectedPass: label.expectedPass, candidateValueJsonSha256: hash(candidate.value), sourceSerialization: 'JSON.stringify(value)', ...('html' in candidate.value ? { htmlUtf8Sha256: hash(candidate.value.html) } : { sceneJsonSha256: hash(candidate.value.scene) }), checksSha256: hash(pool.checks), actual, matched: actual.passed === label.expectedPass, healthy };
      results.push(result); write(`oracle-${pool.id}-${candidate.id}.json`, result);
      if (!healthy || !result.matched) throw new Error(`Oracle label/health disagreement: ${pool.id}/${candidate.id}`);
      currentIntent.status = 'completed'; currentIntent.endedAt = new Date().toISOString();
      write(`terminal-${pool.id}-${candidate.id}.json`, currentIntent); currentIntent = undefined;
    }
  }
  controller.signal.throwIfAborted(); assertSource();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  if (currentIntent) { currentIntent.status = controller.signal.aborted ? 'cancelled' : 'failed'; currentIntent.endedAt = new Date().toISOString(); currentIntent.error = failure; write(`terminal-${currentIntent.poolId}-${currentIntent.candidateId}.json`, { ...currentIntent, actual: results.find(result => result.poolId === currentIntent!.poolId && result.candidateId === currentIntent!.candidateId)?.actual ?? null }); }
}
finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
const allIds = [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS].flatMap(pool => pool.candidates.map(candidate => ({ poolId: pool.id, candidateId: candidate.id })));
const summary = { version: VERIFIER_CHALLENGE_CORPUS_VERSION, evidenceKind: 'outer-authored-challenge-preparation', status: failure ? 'failed-or-cancelled' : 'oracle-preparation-complete-not-model-evaluated', startedAt, endedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start), sourceCommit: manifest.sourceCommit, sourceClean: manifest.sourceClean, manifestSha256: createHash('sha256').update(readFileSync(join(directory, 'manifest.json'))).digest('hex'), browserVersion, ...verifierPreparationProgress(allIds, intents), labelMatches: results.filter(result => result.matched && result.healthy).length, failure, modelRequests: 0, modelEffect: null, modelCost: null, resultsSha256: hash(results), intentsSha256: hash(intents) };
write('summary.json', summary); write('oracle-results.json', results); write('intents.json', intents);
console.log(JSON.stringify({ directory, summary }, null, 2));
if (failure) process.exitCode = 1;
