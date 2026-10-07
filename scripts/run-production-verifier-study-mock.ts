import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { jevConfigSchema, type JevCandidateContext } from '../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';
import { runInjectedVerifierStudy, runStudyChromiumOracle } from '../server/production/verifier-study.js';
import { VerifierStudyLedger } from '../server/production/verifier-study-ledger.js';

// Trusted engineering CLI. All model hooks are pure local mocks; Jev fetch is
// ALWAYS injected. Never opens production store/keys, invokes Harness models,
// requests camera permission or executes generated host scripts.
const root = realpathSync(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
if (realpathSync(process.cwd()) !== root || !root.endsWith('/city-agent-autonomous-production')) throw new Error('Run only from the autonomous-production worktree');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('branch', '--show-current') !== 'feature/autonomous-production') throw new Error('Unexpected worktree branch');
const outputRoot = join(root, 'output');
if (!existsSync(outputRoot)) mkdirSync(outputRoot, { mode: 0o700 });
if (lstatSync(outputRoot).isSymbolicLink() || realpathSync(outputRoot) !== outputRoot) throw new Error('Output must be the independent real worktree directory');
const output = mkdtempSync(join(outputRoot, 'production-verifier-study-mock-')); const directory = join(output, 'ledger');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const sources = ['server/production/verifier-study.ts', 'server/production/verifier-study-ledger.ts', 'server/production/verifier-study-strategy.ts', 'server/production/verifier-corpus-preparation.ts', 'server/production/verifier-scene-oracle.ts', 'server/production/jev.ts', 'server/production/contracts.ts', 'server/production/camera-gate.ts', 'server/gate.ts', 'server/harness.ts', 'server/harness-literal-prompt.mjs', 'server/usage-observer.ts', 'server/production/acceptance-preflight.ts', 'server/production/review-context.ts', 'server/production/output-diagnostics.ts', 'server/production/store.ts', 'shared/production-verifier-challenge-corpus.ts', 'shared/production-verifier-html-corpus-a.ts', 'shared/production-verifier-html-corpus-b.ts', 'shared/production-verifier-scene-corpus.ts', 'shared/production-verifier-rubric.ts', 'shared/production-schema.ts', 'shared/production-coverage.ts', 'shared/production-execution-profile.ts', 'shared/camera-scene-schema.ts', 'shared/camera-scene-runtime.ts', 'shared/camera-hand-worker.ts', 'shared/camera-test-semantics.ts', 'shared/camera-asset-manifest.ts', 'shared/jev-schema.ts', 'scripts/run-production-verifier-study-mock.ts', 'package.json', 'package-lock.json', 'tsconfig.json'];
const sourceHash = (path: string) => { const absolute = join(root, path); if (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute) throw new Error('Source is not an independent real file'); return digest(readFileSync(absolute)); };
const sourceCommit = git('rev-parse', 'HEAD'); const sourceHashes = Object.fromEntries(sources.map(path => [path, sourceHash(path)]));
const sourceClean = git('status', '--porcelain', '--untracked-files=normal') === '';
const assertSource = () => {
  if (git('rev-parse', 'HEAD') !== sourceCommit || git('branch', '--show-current') !== 'feature/autonomous-production') throw new Error('Study source branch/HEAD changed');
  for (const [path, expected] of Object.entries(sourceHashes)) if (sourceHash(path) !== expected) throw new Error(`Study source changed: ${path}`);
};
const mockConfig = { ...jevConfigSchema.parse({ enabled: true }), apiKey: 'local-study-fixture-not-a-provider-credential' };
const mockWire = (context: JevCandidateContext) => {
  const request = buildJevCandidateRequest(mockConfig.modelId, context); const answers: Record<string, unknown> = {};
  context.candidates.forEach((_candidate, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) {
      const name = `c${index}_${dimension}`;
      answers[name] = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
        legend: Object.fromEntries((request.questions[name].criteria as string[]).map((label, level) => [String(level), label])) };
    }
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  });
  // Deliberate uncertainty drives exactly one B-equivalent independent fallback.
  // No business label, Oracle result or candidate inspection chooses the answer.
  answers.best = { type: 'choice', choice: 'abstain', confidence: 1, probabilities: { ...Object.fromEntries(context.candidates.map(candidate => [candidate.id, 0])), abstain: 1 } };
  return { model: mockConfig.modelId, answers, usage: { input_tokens: 101, output_tokens: 7 } };
};
const startedAt = new Date().toISOString();
write('provenance.json', { evidenceKind: 'injected-study-plus-real-Chromium-not-model-evaluation', startedAt, sourceCommit, sourceClean, sourceHashes,
  nodeVersion: process.version, strategies: ['baseline', 'llm', 'jev-cascade'], pools: VERIFIER_CHALLENGE_IDS,
  mockPolicy: 'Every LLM selects first ID with equal legal scores; every Jev is uncertain and falls back once. Neither receives controller labels or Oracle results.',
  actualProviderHttpAttempts: 0, actualModelTokens: null, actualProviderCost: 0, actualModelQualityEffect: null,
  feeBoundary: 'Pure local model callbacks/injected fetch: known no external provider request. Fixture usage/cost inside ledger is NOT real model accounting.' });
const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
let browserVersion: string | null = null;
try {
  const browser = await chromium.launch({ headless: true, timeout: 8000 }); try { browserVersion = browser.version(); } finally { await browser.close(); }
  assertSource();
  const summary = await runInjectedVerifierStudy({ directory, executionSource: 'injected-test', poolIds: [...VERIFIER_CHALLENGE_IDS], strategies: ['baseline', 'llm', 'jev-cascade'],
    budget: { maxCalls: 54, maxInputTokens: 1_080_000, maxOutputTokens: 54_000, maxEstimatedCost: 54, currency: 'USD',
      maxDurationMs: 300_000, callTimeoutMs: 5000, oracleTimeoutMs: 30_000, perCallInputTokens: 20_000, perCallOutputTokens: 1000, perCallEstimatedCost: 1 },
    signal: controller.signal, ports: {
      llm: async logical => {
        assertSource(); const candidates = JSON.parse(logical.userPrompt).candidates as Array<{ id: string }>;
        return { text: JSON.stringify({ decision: 'accept', selectedCandidateId: candidates[0].id,
          scores: candidates.map(candidate => ({ candidateId: candidate.id, score: 3, reason: 'Pure injected first-ID fixture' })), reason: 'Local mock, not a model quality judgment' }),
        usage: { inputTokens: 101, outputTokens: 7, estimatedCost: 0, currency: 'USD', complete: true } };
      },
      jev: async (context, signal) => { assertSource(); return evaluateJevCandidates(mockConfig, context, signal, { fetch: async () => new Response(JSON.stringify(mockWire(context)), { status: 200 }) }); },
      oracle: async (request, candidateId, signal) => { assertSource(); const result = await runStudyChromiumOracle(request, candidateId, signal); assertSource(); return result; },
    } });
  assertSource();
  const ledger = VerifierStudyLedger.open(directory);
  const allEvents = ledger.readEvents();
  const commitMarkers = allEvents.map(event => JSON.parse(readFileSync(join(directory, `event-${String(event.sequence).padStart(6, '0')}.commit.json`), 'utf8')) as unknown);
  write('summary.json', summary); write('events.json', allEvents); write('commit-markers.json', commitMarkers);
  write('receipt.json', { sourceCommit, sourceClean, sourceHashes, sourceUnchangedAfter: true, browserVersion, startedAt, endedAt: new Date().toISOString(),
    evidenceKind: 'injected-study-plus-real-Chromium-not-model-evaluation', runId: summary.runId,
    manifestSha256: digest(readFileSync(join(directory, 'manifest.json'))), eventsSha256: digest(readFileSync(join(output, 'events.json'))),
    summarySha256: digest(readFileSync(join(output, 'summary.json'))), commitMarkersSha256: digest(readFileSync(join(output, 'commit-markers.json'))), ledgerDirectorySha256: digest(directory),
    eventCount: allEvents.length, actualProviderHttpAttempts: 0, actualProviderCost: 0, actualModelTokens: null, actualModelQualityEffect: null });
  console.log(JSON.stringify({ directory: output, summary, browserVersion }, null, 2));
  if (summary.status !== 'completed' || !summary.ledgerTerminalPersisted) process.exitCode = 1;
} finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
