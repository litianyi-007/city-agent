import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL_ID, jevConfigPatchSchema, type JevCandidateContext } from '../shared/jev-schema.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';

const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'fixture-jev-secret-not-a-real-key' };
const context: JevCandidateContext = { phase: 'product', goal: 'Offline todo page', acceptance: 'Add and remove tasks with correct totals.', frozenHash: null, candidates: [{ id: 'candidate-one', value: { goal: 'Offline todo page', scope: 'offline-single-html' } }] };
function responseBody(indices = [4]) {
  const answers: Record<string, unknown> = {};
  indices.forEach((value, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c${index}_${dimension}`] = { type: 'score', score: value, legend: Object.fromEntries([0, 1, 2, 3, 4].map(level => [String(level), `Level ${level}`])), probabilities: Object.fromEntries([0, 1, 2, 3, 4].map(level => [String(level), level === value ? 1 : 0])), confidence: 1 };
    answers[`c${index}_safe`] = { type: 'noul', noul: value > 2 ? 1 : 0 };
  });
  const ids = indices.map((_, index) => index === 0 ? 'candidate-one' : 'candidate-two');
  const selected = indices.every(value => value < 3) ? 'abstain' : ids[indices.indexOf(Math.max(...indices))];
  answers.best = { type: 'choice', choice: selected, probabilities: Object.fromEntries([...ids, 'abstain'].map(id => [id, id === selected ? 1 : 0])), confidence: 1 };
  return { model: JEV_MODEL_ID, answers, usage: { input_tokens: 1000, output_tokens: 40 } };
}
const successfulFetch = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

test('Jev uses the pinned official endpoint and evaluates a single candidate via all primitives', async () => {
  let calls = 0;
  const injectedFetch = (async (url, init) => {
    calls++; assert.equal(url, JEV_ENDPOINT); assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${config.apiKey}`);
    const request = JSON.parse(String(init?.body)); assert.equal(request.model, JEV_MODEL_ID);
    assert.deepEqual(Object.keys(request.questions), ['c0_coverage', 'c0_consistency', 'c0_scope', 'c0_safe', 'best']);
    return new Response(JSON.stringify(responseBody()));
  }) as typeof fetch;
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: injectedFetch });
  assert.equal(calls, 1); assert.equal(result.status, 'accepted'); assert.equal(result.selectedCandidateId, 'candidate-one');
  assert.equal(result.usage.inputTokens, 1000); assert.equal(result.usage.estimatedCost, 0.000042);
  assert.equal(result.scores[0].minimumScore, 4); assert.equal(result.providerRequests, 1);
  assert.equal(JSON.stringify(result).includes(config.apiKey), false);
});

test('Jev full-batch scoring selects the qualified candidate, not the first candidate', async () => {
  const two = { ...context, candidates: [...context.candidates, { id: 'candidate-two', value: 'Complete offline implementation' }] };
  const result = await evaluateJevCandidates(config, two, new AbortController().signal, { fetch: successfulFetch(responseBody([1, 4])) });
  assert.equal(result.status, 'accepted'); assert.equal(result.selectedCandidateId, 'candidate-two'); assert.equal(result.scores[0].stronglyRejected, true);
});

test('All clearly bad candidates are rejected; not changed into a successful template', async () => {
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(responseBody([1])) });
  assert.equal(result.status, 'rejected'); assert.equal(result.selectedCandidateId, null); assert.equal(result.usage.complete, true);
});

test('A Choice selecting a weaker qualified candidate is uncertain, not labelled the best answer', async () => {
  const body = responseBody([3, 4]);
  body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 1, 'candidate-two': 0, abstain: 0 }, confidence: 1 };
  const two = { ...context, candidates: [...context.candidates, { id: 'candidate-two', value: 'More complete candidate' }] };
  const result = await evaluateJevCandidates(config, two, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'uncertain'); assert.equal(result.selectedCandidateId, null);
});

test('Low concentration is uncertain, never an implied accuracy or automatic acceptance', async () => {
  const body = responseBody();
  for (const dimension of ['coverage', 'consistency', 'scope']) body.answers[`c0_${dimension}`] = { type: 'score', score: 2, legend: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' }, probabilities: { '0': 0.2, '1': 0.2, '2': 0.2, '3': 0.2, '4': 0.2 }, confidence: 0 };
  body.answers.c0_safe = { type: 'noul', noul: 0.5 }; body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.5, abstain: 0.5 }, confidence: 0 };
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'uncertain'); assert.equal(result.selectedCandidateId, null);
});

test('Unexpected IDs, invalid distributions, inconsistent score/choice and model drift fail closed', async () => {
  const mutations = [
    (body: ReturnType<typeof responseBody>) => { body.answers.unexpected = {}; },
    (body: ReturnType<typeof responseBody>) => { (body.answers.c0_coverage as { probabilities: Record<string, number> }).probabilities['4'] = 0.8; },
    (body: ReturnType<typeof responseBody>) => { (body.answers.c0_coverage as { score: number }).score = 3; },
    (body: ReturnType<typeof responseBody>) => { (body.answers.best as { choice: string }).choice = 'abstain'; },
    (body: ReturnType<typeof responseBody>) => { (body.answers.best as { confidence: number }).confidence = 0.5; },
    (body: ReturnType<typeof responseBody>) => { body.model = 'unexpected-release'; },
  ];
  for (const mutate of mutations) { const body = responseBody(); mutate(body); const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) }); assert.equal(result.status, 'error'); assert.equal(result.selectedCandidateId, null); assert.equal(result.usage.complete, true); }
});

test('Missing usage remains unknown and is never reported as zero', async () => {
  const body = responseBody(); const { usage: _, ...missing } = body;
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(missing) });
  assert.equal(result.status, 'error'); assert.equal(result.usage.complete, false); assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.estimatedCost, null);
});

test('HTTP errors are redacted and not automatically retried', async () => {
  let calls = 0;
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: (async () => { calls++; return new Response(JSON.stringify({ message: config.apiKey }), { status: 429 }); }) as typeof fetch });
  assert.equal(calls, 1); assert.equal(result.httpStatus, 429); assert.equal(result.status, 'error'); assert.equal(result.usage.complete, false); assert.equal(JSON.stringify(result).includes(config.apiKey), false);
});

test('Cancelled and oversized inputs make no paid request; no silent evidence truncation', async () => {
  let calls = 0; const noFetch = (async () => { calls++; throw new Error('must not call'); }) as typeof fetch;
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await evaluateJevCandidates(config, context, cancelled.signal, { fetch: noFetch })).providerRequests, 0);
  assert.equal((await evaluateJevCandidates(config, { ...context, candidates: [{ id: 'candidate-one', value: 'x'.repeat(64000) }] }, new AbortController().signal, { fetch: noFetch })).providerRequests, 0);
  assert.equal(calls, 0);
});

test('Cancellation stops an in-flight HTTP request without a retry', async () => {
  const controller = new AbortController(); let calls = 0;
  const injected = (async (_url, init) => { calls++; return await new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }); controller.abort(); }); }) as typeof fetch;
  const result = await evaluateJevCandidates(config, context, controller.signal, { fetch: injected });
  assert.equal(calls, 1); assert.equal(result.status, 'error'); assert.match(result.reason, /cancelled/);
});

test('Cancellation closes a stalled response stream and does not assume a complete response', async () => {
  const controller = new AbortController(); let cancelled = false;
  const result = await evaluateJevCandidates(config, context, controller.signal, { fetch: (async () => { setTimeout(() => controller.abort(), 10); return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"model":')); }, cancel() { cancelled = true; } })); }) as typeof fetch });
  assert.equal(result.status, 'error'); assert.match(result.reason, /cancelled/); assert.equal(cancelled, true); assert.equal(result.usage.complete, false);
});

test('Known usage is retained even if the answer envelope is malformed', async () => {
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch({ model: JEV_MODEL_ID, usage: { input_tokens: 123, output_tokens: 7 } }) });
  assert.equal(result.status, 'error'); assert.equal(result.usage.complete, true); assert.equal(result.usage.inputTokens, 123);
});

test('Jev context, config, and response caps reject unsafe expansion', async () => {
  assert.throws(() => buildJevCandidateRequest(JEV_MODEL_ID, { ...context, candidates: [{ id: 'abstain', value: '' }] }));
  assert.throws(() => jevConfigPatchSchema.parse({ endpoint: 'https://other.example', apiKey: 'fake' }));
  assert.throws(() => jevConfigPatchSchema.parse({ modelId: 'jev-latest' }));
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch({ huge: 'x'.repeat(200001) }) });
  assert.equal(result.status, 'error'); assert.match(result.reason, /size limit/);
});
