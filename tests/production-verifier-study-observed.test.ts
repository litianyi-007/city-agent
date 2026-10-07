import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { jevConfigSchema } from '../shared/jev-schema.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { VerifierStudyLedger } from '../server/production/verifier-study-ledger.js';
import { prepareObservedVerifierStudyPlan } from '../server/production/verifier-study-observed-policy.js';
import { snapshotVerifierStudySource } from '../server/production/verifier-study-source.js';
import { createVerifierStudyTransport, type VerifierStudyTransportOptions } from '../server/production/verifier-study-transport.js';
import { runObservedVerifierStudy } from '../server/production/verifier-study.js';

const keys = { llmKey: 'synthetic-observed-llm-not-a-real-key', jevKey: 'synthetic-observed-jev-not-a-real-key' };
const config = { verifier: { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Fixture verifier', role: 'verifier', enabled: true,
  provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
  pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } }, jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true } };
const request = verifierPreparationRequests('H01');
const dir = () => join(mkdtempSync(join(realpathSync(tmpdir()), 'verifier-observed-')), 'run');
function jevReply(uncertain = false, input = 101, output = 7) {
  const envelope = buildJevCandidateRequest(config.jev.modelId, request.snapshot); const answers: Record<string, unknown> = {};
  request.snapshot.candidates.forEach((_candidate, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) {
      const name = `c${index}_${dimension}`;
      answers[name] = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
        legend: Object.fromEntries((envelope.questions[name].criteria as string[]).map((label, score) => [score, label])) };
    }
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  });
  answers.best = { type: 'choice', choice: uncertain ? 'abstain' : request.snapshot.candidates[0].id, confidence: 1,
    probabilities: { ...Object.fromEntries(request.snapshot.candidates.map((candidate, index) => [candidate.id, !uncertain && index === 0 ? 1 : 0])), abstain: uncertain ? 1 : 0 } };
  return { model: config.jev.modelId, answers, usage: { input_tokens: input, output_tokens: output } };
}
function sse(res: ServerResponse, mode = 'success') {
  const candidates = request.snapshot.candidates;
  const text = mode === 'length' ? `{"partial":"${keys.llmKey} ${keys.jevKey}` : JSON.stringify({ decision: 'accept', selectedCandidateId: candidates[0].id,
    scores: candidates.map(candidate => ({ candidateId: candidate.id, score: 3, reason: 'Fixture only' })), reason: 'Not real model quality' });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: mode === 'length' ? 'length' : 'stop' }],
    ...(mode === 'missing' ? {} : { usage: { prompt_tokens: 101, completion_tokens: 7 } }) })}\n\n`);
  res.end('data: [DONE]\n\n');
}
async function fixture(run: (base: string, posts: () => number) => Promise<void>, mode = 'success') {
  let posts = 0;
  const server = createServer(async (req, res) => { for await (const _ of req) { /* consume fixture input */ } posts++; sse(res, mode); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, () => posts); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function setup(base: string, options: { strategies?: Array<'baseline' | 'llm' | 'jev-cascade'>; limits?: Parameters<typeof prepareObservedVerifierStudyPlan>[0]['limits']; fetch?: typeof fetch; guards?: VerifierStudyTransportOptions['guards'] } = {}) {
  const plan = prepareObservedVerifierStudyPlan({ executionSource: 'loopback-engineering', configuration: config, source: snapshotVerifierStudySource(),
    poolIds: ['H01'], strategies: options.strategies ?? ['baseline', 'llm', 'jev-cascade'], limits: options.limits });
  const transport = createVerifierStudyTransport({ configuration: config, secrets: keys, engineering: {
    llmBaseUrl: base, jevFetch: options.fetch ?? (async () => new Response(JSON.stringify(jevReply(true)))) },
    guards: options.guards ?? { assertFresh: () => {}, assertAuthorized: () => {} } });
  const consent = { id: randomUUID(), frozenStudySha256: plan.frozenStudySha256, status: 'engineering-only', scope: 'single-new-study-no-auto-resume',
    approvedAt: new Date().toISOString(), estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true };
  return { directory: dir(), plan, transport, consent };
}
const events = (directory: string) => VerifierStudyLedger.open(directory).readEvents();

test('native observed runner persists plan/consent, actual dispatches and real Chromium Oracle; no caller-supplied Oracle', { timeout: 60000 }, async () => {
  await fixture(async (base, posts) => {
    const options = setup(base); const actual = await runObservedVerifierStudy(options);
    assert.equal(actual.status, 'completed'); assert.equal(actual.version, 'verifier-study-observed-v1'); assert.equal(actual.executionSource, 'loopback-engineering');
    assert.equal(actual.ledgerTerminalPersisted, true); assert.equal(actual.callbackIntents, 3); assert.equal(posts(), 2);
    assert.equal(actual.actualProviderHttpAttempts, 0); assert.equal(actual.localFixtureHttpAttempts, 3); assert.equal(actual.actualModelUsage, null);
    assert.equal(actual.usage.scope, 'loopback-fixture-accounting-not-model-measurement'); assert.equal(actual.usage.knownInputTokens, 303);
    assert.equal(actual.completedOracles, 2); assert.equal(actual.byStrategy.every(item => item.selectedOraclePass === 1), true);
    const ledger = VerifierStudyLedger.open(options.directory); const manifest = ledger.readManifest().manifest;
    assert.deepEqual(manifest.consent, options.consent); assert.deepEqual(manifest.observedPlan, options.plan);
    assert.equal(Object.hasOwn(manifest, 'authorization'), false);
    const log = events(options.directory); const calls = log.filter(event => event.type === 'call-result');
    assert.equal(calls.every(event => (event.payload.responseSnapshot as { observation: { cleanupAwaited: boolean } }).observation.cleanupAwaited), true);
    assert.equal(log.findIndex(event => event.type === 'oracle-intent') > log.map(event => event.type).lastIndexOf('decision-result'), true);
    assert.equal(JSON.stringify(manifest).includes(keys.llmKey), false);
    await assert.rejects(runObservedVerifierStudy({ ...options, directory: dir() }), /reused/);
  });
});

test('unknown usage retains actual HTTP but stops fallback and next decisions; unknown is not zero', { timeout: 30000 }, async () => {
  await fixture(async (base, posts) => {
    const options = setup(base, { strategies: ['llm', 'jev-cascade'] }); const actual = await runObservedVerifierStudy(options);
    assert.equal(actual.status, 'failed'); assert.equal(actual.usage.complete, false); assert.equal(actual.usage.unknownCalls, 1);
    assert.equal(actual.localFixtureHttpAttempts, 1); assert.equal(actual.actualProviderHttpAttempts, 0); assert.equal(actual.actualModelUsage, null);
    assert.equal(actual.notStartedDecisions, 1); assert.equal(actual.attemptedOracles, 0); assert.equal(posts(), 1);
  }, 'missing');
});

test('native failed length observation keeps known usage, dispatch and redacted partial output without selecting it', { timeout: 30000 }, async () => {
  await fixture(async (base, posts) => {
    const options = setup(base, { strategies: ['llm', 'jev-cascade'] }); const actual = await runObservedVerifierStudy(options);
    assert.equal(actual.status, 'failed'); assert.equal(actual.usage.complete, true); assert.equal(actual.usage.knownInputTokens, 101);
    assert.equal(actual.localFixtureHttpAttempts, 1); assert.equal(posts(), 1); assert.equal(actual.attemptedOracles, 0);
    const result = events(options.directory).find(event => event.type === 'call-result')!;
    assert.equal(result.payload.status, 'failed'); assert.equal((result.payload.responseSnapshot as { text: null }).text, null);
    const bytes = JSON.stringify(events(options.directory));
    assert.equal(bytes.includes(keys.llmKey), false); assert.equal(bytes.includes(keys.jevKey), false); assert.match(bytes, /REDACTED/);
    assert.equal(actual.byStrategy[0].accepted, 0);
  }, 'length');
});

test('last free Jev output exceeding observation limit fails before fallback; zero output price does not waive tokens', async () => {
  await fixture(async (base, posts) => {
    const options = setup(base, { strategies: ['jev-cascade'], fetch: async () => new Response(JSON.stringify(jevReply(true, 101, 4097))) });
    const actual = await runObservedVerifierStudy(options);
    assert.equal(actual.status, 'failed'); assert.match(actual.reason!, /reservation/); assert.equal(actual.usage.knownOutputTokens, 4097);
    assert.equal(actual.usage.knownEstimatedCost, 101 * config.jev.inputPerMillion / 1000000);
    assert.equal(posts(), 0); assert.equal(actual.callbackIntents, 1); assert.equal(actual.attemptedOracles, 0);
  });
});

test('Jev uses 65536 input reservation rather than silently applying the LLM 61440 ceiling', { timeout: 60000 }, async () => {
  await fixture(async base => {
    const options = setup(base, { strategies: ['jev-cascade'], fetch: async () => new Response(JSON.stringify(jevReply(false, 62000))) });
    const actual = await runObservedVerifierStudy(options); assert.equal(actual.status, 'completed'); assert.equal(actual.usage.knownInputTokens, 62000);
    const intent = events(options.directory).find(event => event.type === 'call-intent')!;
    assert.equal((intent.payload.reservation as { inputTokens: number }).inputTokens, 65536);
  });
});

test('native cancellation joins asynchronous Jev body cleanup before writing decision and terminal', async () => {
  await fixture(async (base, posts) => {
    const controller = new AbortController(); let cleanup = false; let dispatched = 0;
    const options = setup(base, { strategies: ['jev-cascade', 'llm'], fetch: async () => {
      dispatched++; setTimeout(() => controller.abort(), 10);
      return new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode('{"pending":')); },
        async cancel() { await new Promise<void>(resolve => setTimeout(resolve, 40)); cleanup = true; } }));
    } });
    const actual = await runObservedVerifierStudy({ ...options, signal: controller.signal });
    assert.equal(cleanup, true); assert.equal(dispatched, 1); assert.equal(posts(), 0); assert.equal(actual.status, 'cancelled');
    assert.equal(actual.ledgerTerminalPersisted, true); assert.equal(actual.usage.complete, false); assert.equal(actual.localFixtureHttpAttempts, 1);
    assert.equal(actual.notStartedDecisions, 1); assert.equal(actual.attemptedOracles, 0);
    const log = events(options.directory); assert.equal(log.at(-1)!.type, 'run-end');
    assert.equal((log.find(event => event.type === 'call-result')!.payload.responseSnapshot as { observation: { cleanupAwaited: boolean } }).observation.cleanupAwaited, true);
    const before = JSON.stringify(log); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(JSON.stringify(events(options.directory)), before);
  });
});

test('pre-dispatch budget and pre-cancellation create durable terminal but no provider or Oracle work', async () => {
  await fixture(async (base, posts) => {
    const options = setup(base, { strategies: ['llm'], limits: { maxCalls: 0 } }); const actual = await runObservedVerifierStudy(options);
    assert.equal(actual.status, 'failed'); assert.equal(actual.callbackIntents, 0); assert.equal(actual.actualProviderHttpAttempts, 0); assert.equal(posts(), 0);
    const other = setup(base); const signal = AbortSignal.abort(); const cancelled = await runObservedVerifierStudy({ ...other, signal });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.ledgerTerminalPersisted, true); assert.equal(cancelled.callbackIntents, 0);
  });
});

test('fake provenance, clone plan/transport, wrong configuration or extra execution ports cannot create a ledger', async () => {
  await fixture(async (base, posts) => {
    for (const mutate of [
      (value: ReturnType<typeof setup>) => ({ ...value, plan: structuredClone(value.plan) }),
      (value: ReturnType<typeof setup>) => ({ ...value, transport: { ...value.transport } }),
      (value: ReturnType<typeof setup>) => ({ ...value, oracle: async () => ({ passed: true }) }),
      (value: ReturnType<typeof setup>) => ({ ...value, consent: { ...value.consent, frozenStudySha256: 'a'.repeat(64) } }),
      (value: ReturnType<typeof setup>) => ({ ...value, plan: prepareObservedVerifierStudyPlan({ executionSource: 'loopback-engineering', source: snapshotVerifierStudySource(),
        configuration: { ...config, verifier: { ...config.verifier, modelId: 'other' } }, poolIds: ['H01'] }) }),
    ]) {
      const options = setup(base); await assert.rejects(runObservedVerifierStudy(mutate(options) as Parameters<typeof runObservedVerifierStudy>[0]));
      assert.equal(existsSync(options.directory), false);
    }
    assert.equal(posts(), 0);
  });
});
