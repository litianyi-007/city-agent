import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { captureVerifierWirePreflight } from '../server/production/verifier-wire-preflight.js';
import { prepareVerifierStudyProposal, verifierStudyPublicConfiguration, STUDY_PROPOSED_LLM_TIMEOUT_MS, STUDY_PROPOSED_OUTPUT_TOKENS, type VerifierWireCapture } from '../server/production/verifier-study-preflight.js';

// FREE trusted engineering CLI: fixed GET-only loopback public API + real SDK
// to a loopback fake provider. No key getter, live endpoint, POST API, resume,
// deployment or paid adapter. Do not add a --live flag to this preparation CLI.
const root = realpathSync(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
if (process.argv.length !== 2 || realpathSync(process.cwd()) !== root || !root.endsWith('/city-agent-autonomous-production')) throw new Error('Run without arguments only in the autonomous-production worktree');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('branch', '--show-current') !== 'feature/autonomous-production') throw new Error('Unexpected worktree branch');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['server/production/verifier-wire-preflight.ts', 'server/production/verifier-study-preflight.ts',
  'scripts/prepare-production-verifier-study.ts', 'server/production/verifier-study.ts', 'server/production/verifier-study-ledger.ts',
  'server/production/verifier-study-strategy.ts', 'server/production/verifier-corpus-preparation.ts', 'server/production/jev.ts',
  'server/production/contracts.ts', 'server/production/review-context.ts', 'server/production/acceptance-preflight.ts',
  'server/production/output-diagnostics.ts', 'server/production/verifier-scene-oracle.ts', 'server/production/camera-gate.ts',
  'server/gate.ts', 'server/harness.ts', 'server/harness-literal-prompt.mjs', 'server/usage-observer.ts',
  'shared/production-verifier-challenge-corpus.ts', 'shared/production-verifier-html-corpus-a.ts', 'shared/production-verifier-html-corpus-b.ts',
  'shared/production-verifier-scene-corpus.ts', 'shared/production-verifier-rubric.ts', 'shared/production-schema.ts',
  'shared/production-coverage.ts', 'shared/production-execution-profile.ts', 'shared/jev-schema.ts', 'shared/camera-scene-schema.ts',
  'shared/camera-scene-runtime.ts', 'shared/camera-test-semantics.ts', 'shared/camera-asset-manifest.ts', 'package.json', 'package-lock.json'];
const sourceHash = (path: string) => { const file = join(root, path); if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || realpathSync(file) !== file) throw new Error('Source must be a real independent file'); return hash(readFileSync(file)); };
const source = { commit: git('rev-parse', 'HEAD'), clean: git('status', '--porcelain', '--untracked-files=normal') === '', hashes: Object.fromEntries(sourcePaths.map(path => [path, sourceHash(path)])) };
const assertSource = () => { if (git('branch', '--show-current') !== 'feature/autonomous-production' || git('rev-parse', 'HEAD') !== source.commit
  || sourcePaths.some(path => sourceHash(path) !== source.hashes[path])) throw new Error('Preflight source changed; no further captures'); };
const outputRoot = join(root, 'output'); if (!existsSync(outputRoot)) mkdirSync(outputRoot, { mode: 0o700 });
if (lstatSync(outputRoot).isSymbolicLink() || realpathSync(outputRoot) !== outputRoot) throw new Error('Independent real output directory required');
const output = mkdtempSync(join(outputRoot, 'production-verifier-wire-'));
const write = (name: string, value: unknown) => {
  const file = join(output, name); const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  const directoryFd = openSync(output, 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
};
const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
async function publicConfig() {
  const read = async (path: 'agents' | 'jev/config') => {
    const response = await fetch(`http://127.0.0.1:4420/api/production/${path}`, { method: 'GET', redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new Error('Local public settings API unavailable');
    const chunks: Uint8Array[] = []; let length = 0;
    if (!response.body) throw new Error('Public settings response body missing');
    const reader = response.body.getReader();
    try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > 65_536) { await reader.cancel(); throw new Error('Public settings response too large'); } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(raw) as unknown;
  };
  const agents = await read('agents');
  if (!Array.isArray(agents)) throw new Error('Invalid public Agent list');
  const verifiers = agents.filter(agent => agent?.role === 'verifier' && agent?.enabled === true);
  if (verifiers.length !== 1) throw new Error('Exactly one enabled Verifier required; no silent selection');
  return verifierStudyPublicConfiguration({ verifier: verifiers[0], jev: await read('jev/config') });
}
const startedAt = new Date().toISOString();
write('started.json', { status: 'running-free-preflight', startedAt, source, externalProviderHttpAttempts: 0, actualModelUsage: null });
try {
  const config = await publicConfig(); assertSource(); const configHash = hash(JSON.stringify(config));
  const options = { provider: config.verifier.provider, upstreamBaseUrl: config.verifier.baseUrl, modelId: config.verifier.modelId,
    maxOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS, timeoutMs: STUDY_PROPOSED_LLM_TIMEOUT_MS };
  const captures: Array<{ poolId: string; result: VerifierWireCapture }> = [];
  // Validate all public configuration and requests BEFORE starting SDK sessions.
  // Complete public snapshot validation above forbids defaults/secret fields;
  // the final proposal revalidates all captures and complete request bindings.
  for (const poolId of VERIFIER_CHALLENGE_IDS) {
    assertSource(); controller.signal.throwIfAborted();
    if (hash(JSON.stringify(await publicConfig())) !== configHash) throw new Error('Public configuration changed; no further captures');
    assertSource(); controller.signal.throwIfAborted();
    const request = verifierPreparationRequests(poolId);
    write(`${poolId}-intent.json`, { poolId, requestSha256: hash(JSON.stringify(request)), sourceCommit: source.commit, configurationSha256: configHash,
      status: 'local-fixture-pending', externalProviderHttpAttempts: 0 });
    const result = await captureVerifierWirePreflight(request.logicalLlm, options, controller.signal);
    write(`${poolId}-capture.json`, result); captures.push({ poolId, result });
    assertSource();
    if (result.status !== 'completed' || !result.wire?.validated) throw new Error(`Offline capture did not complete: ${poolId}`);
  }
  assertSource(); if (hash(JSON.stringify(await publicConfig())) !== configHash) throw new Error('Public configuration drift; proposal not assembled');
  assertSource(); controller.signal.throwIfAborted();
  const proposal = prepareVerifierStudyProposal({ ...config, source, captures });
  assertSource();
  write('proposal.json', proposal);
  assertSource();
  write('receipt.json', { status: 'completed-free-preflight', startedAt, endedAt: new Date().toISOString(), source, sourceMatchedAtCheckpoints: true,
    publicConfigurationMatchedAtCheckpoints: true, credentialIdentity: 'not-observed; hasApiKey cannot detect key rotation', proposalSha256: proposal.proposalSha256, proposalFileSha256: hash(readFileSync(join(output, 'proposal.json'))),
    captures: captures.map(({ poolId, result }) => ({ poolId, invocationId: result.invocationId, fileSha256: hash(readFileSync(join(output, `${poolId}-capture.json`))) })),
    localProviderHttpAttempts: captures.reduce((sum, item) => sum + item.result.transport.localProviderPosts, 0), externalProviderHttpAttempts: 0,
    actualProviderCost: 0, actualModelUsage: null, actualModelQualityEffect: null, nodeVersion: process.version });
  console.log(JSON.stringify({ output, status: proposal.status, readyForPaidExecution: false, blockers: proposal.blockers,
    pools: captures.length, maxWireBytes: Math.max(...captures.map(item => item.result.wire!.bodyBytes)), limits: proposal.proposedLimits }, null, 2));
} catch {
  // Errors intentionally do not echo API response bodies, keys or arbitrary text.
  write('stopped.json', { status: controller.signal.aborted ? 'cancelled' : 'failed', endedAt: new Date().toISOString(),
    reason: 'Free preflight stopped; inspect retained local intents/captures. No paid fallback or replay.', externalProviderHttpAttempts: 0, actualModelUsage: null });
  console.error(JSON.stringify({ output, status: 'free-preflight-stopped-no-paid-fallback' })); process.exitCode = 1;
} finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
