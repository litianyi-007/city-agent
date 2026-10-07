import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jevConfigSchema } from '../shared/jev-schema.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { prepareObservedVerifierStudyPlan } from '../server/production/verifier-study-observed-policy.js';
import { snapshotVerifierStudySource, assertVerifierStudySourceFresh } from '../server/production/verifier-study-source.js';
import { createVerifierStudyTransport } from '../server/production/verifier-study-transport.js';
import { runObservedVerifierStudy } from '../server/production/verifier-study.js';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.js';
import { prepareVerifierWirePreflight } from '../server/production/verifier-wire-preflight.js';

// FREE local-only engineering CLI. No live flag, store, page configuration,
// real credentials, paid authorization, arbitrary inputs or API exposure.
const root = realpathSync(dirname(fileURLToPath(new URL('../package.json', import.meta.url))));
if (process.argv.length !== 2 || realpathSync(process.cwd()) !== root || !root.endsWith('/city-agent-autonomous-production')) throw new Error('Run without arguments only in the production worktree');
const source = snapshotVerifierStudySource();
const configuration = {
  verifier: { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Engineering verifier fixture', role: 'verifier', enabled: true,
    provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } },
  jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true },
};
const plan = prepareObservedVerifierStudyPlan({ executionSource: 'loopback-engineering', configuration, source });
const fixtureKeys = { llmKey: 'synthetic-study-llm-not-a-real-credential', jevKey: 'synthetic-study-jev-not-a-real-credential' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requests = VERIFIER_CHALLENGE_IDS.map(id => verifierPreparationRequests(id));
const expectedBodies = requests.map(request => prepareVerifierWirePreflight(request.logicalLlm, {
  provider: 'deepseek', upstreamBaseUrl: configuration.verifier.baseUrl, modelId: configuration.verifier.modelId, maxOutputTokens: 4096, timeoutMs: 120000 }).expectedBody);
let posts = 0; let fixtureJevDispatches = 0; let rejected = 0; let grantActive = false;
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${fixtureKeys.llmKey}` || posts >= 36) throw new Error('Unexpected fixture request');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const part of request) { bytes += Buffer.byteLength(part); if (bytes > 65536) throw new Error('Oversized fixture request'); chunks.push(Buffer.from(part)); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!expectedBodies.some(expected => hash(expected) === hash(body))) throw new Error('Full frozen wire mismatch');
    posts++;
    const candidates = JSON.parse(body.messages[1].content).candidates as Array<{ id: string }>;
    const text = JSON.stringify({ decision: 'accept', selectedCandidateId: candidates[0].id,
      scores: candidates.map(candidate => ({ candidateId: candidate.id, score: 3, reason: 'Synthetic first-choice fixture, not model quality' })), reason: 'Engineering fixture only' });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 101, completion_tokens: 7 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  } catch { rejected++; response.writeHead(400); response.end('{}'); }
});
const jevFetch: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init!.body));
  const request = requests.find(value => hash(value.jev) === hash(body));
  if (!request || fixtureJevDispatches >= 18) throw new Error('Unexpected in-memory Jev fixture request');
  fixtureJevDispatches++;
  const envelope = buildJevCandidateRequest(configuration.jev.modelId, request.snapshot); const answers: Record<string, unknown> = {};
  request.snapshot.candidates.forEach((_candidate, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) {
      const name = `c${index}_${dimension}`;
      answers[name] = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
        legend: Object.fromEntries((envelope.questions[name].criteria as string[]).map((label, score) => [score, label])) };
    }
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  });
  answers.best = { type: 'choice', choice: 'abstain', confidence: 1,
    probabilities: { ...Object.fromEntries(request.snapshot.candidates.map(candidate => [candidate.id, 0])), abstain: 1 } };
  return new Response(JSON.stringify({ model: configuration.jev.modelId, answers, usage: { input_tokens: 101, output_tokens: 7 } }));
};
const outputRoot = join(root, 'output'); if (!existsSync(outputRoot)) mkdirSync(outputRoot, { mode: 0o700 });
if (lstatSync(outputRoot).isSymbolicLink() || realpathSync(outputRoot) !== outputRoot) throw new Error('Independent output required');
const output = mkdtempSync(join(outputRoot, 'production-verifier-observed-'));
const write = (name: string, value: unknown) => {
  const fd = openSync(join(output, name), 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(output, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
};
const cancellation = new AbortController(); const cancel = () => cancellation.abort();
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
write('started.json', { status: 'running-engineering-only', startedAt: new Date().toISOString(), source, plan,
  externalProviderHttpAttempts: 0, actualModelUsage: null });
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  const transport = createVerifierStudyTransport({ configuration, secrets: fixtureKeys, engineering: { llmBaseUrl: `http://127.0.0.1:${address.port}`, jevFetch },
    guards: { assertFresh: () => assertVerifierStudySourceFresh(source, false), assertAuthorized: context => {
      if (!grantActive || context.executionSource !== 'loopback-engineering' || context.configurationSha256 !== transport.configurationSha256) throw new Error('No engineering grant');
    } } });
  grantActive = true;
  const summary = await runObservedVerifierStudy({ directory: join(output, 'run'), plan, transport, signal: cancellation.signal,
    consent: { id: randomUUID(), frozenStudySha256: plan.frozenStudySha256, status: 'engineering-only', scope: 'single-new-study-no-auto-resume',
      approvedAt: new Date().toISOString(), estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true } });
  grantActive = false;
  assertVerifierStudySourceFresh(source, false);
  write('receipt.json', { summary, source, actualLoopbackHttpPosts: posts, inMemoryJevFetchDispatches: fixtureJevDispatches, rejectedFixtureRequests: rejected,
    externalProviderHttpAttempts: 0, actualProviderFeeUsd: 0, actualModelUsage: null, nodeVersion: process.version,
    sourceMatchedAtFinalCheckpoint: true,
    evidenceBoundary: 'Actual pinned Harness to loopback fake SSE provider, in-memory fake Jev JSON, real isolated Chromium Oracles. Synthetic usage/decisions, no real model quality or bill.' });
  assertVerifierStudySourceFresh(source, false);
  console.log(JSON.stringify({ output, summary, actualLoopbackHttpPosts: posts, inMemoryJevFetchDispatches: fixtureJevDispatches }, null, 2));
  if (summary.status !== 'completed' || rejected) process.exitCode = 1;
} catch {
  write('stopped.json', { status: cancellation.signal.aborted ? 'cancelled' : 'failed', externalProviderHttpAttempts: 0,
    actualModelUsage: null, actualLoopbackHttpPosts: posts, inMemoryJevFetchDispatches: fixtureJevDispatches,
    reason: 'Engineering study stopped; retained manifest and intents require explicit read-only inspection/recovery, no paid replay.' });
  console.error(JSON.stringify({ output, status: 'engineering-study-stopped' })); process.exitCode = 1;
} finally {
  grantActive = false; process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}
