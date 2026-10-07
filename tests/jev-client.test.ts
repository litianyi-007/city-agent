import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL_ID, JEV_POLICY_VERSION, jevConfigPatchSchema, type JevCandidateContext } from '../shared/jev-schema.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';

const config = { ...DEFAULT_JEV_CONFIG, enabled: true, apiKey: 'fixture-jev-secret-not-a-real-key' };
const context: JevCandidateContext = { phase: 'product', goal: 'Offline todo page', acceptance: 'Add and remove tasks with correct totals.', frozenHash: null, candidates: [{ id: 'candidate-one', value: { goal: 'Offline todo page', scope: 'offline-single-html' } }] };
const levels = buildJevCandidateRequest(JEV_MODEL_ID, context).questions.c0_coverage.criteria as string[];
function responseBody(indices = [4]) {
  const answers: Record<string, unknown> = {};
  indices.forEach((value, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c${index}_${dimension}`] = { type: 'score', score: value, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])), probabilities: Object.fromEntries([0, 1, 2, 3, 4].map(level => [String(level), level === value ? 1 : 0])), confidence: 1 };
    answers[`c${index}_safe`] = { type: 'noul', noul: value > 2 ? 1 : 0 };
  });
  const ids = indices.map((_, index) => index === 0 ? 'candidate-one' : 'candidate-two');
  const selected = indices.every(value => value < 3) ? 'abstain' : ids[indices.indexOf(Math.max(...indices))];
  answers.best = { type: 'choice', choice: selected, probabilities: Object.fromEntries([...ids, 'abstain'].map(id => [id, id === selected ? 1 : 0])), confidence: 1 };
  return { model: JEV_MODEL_ID, answers, usage: { input_tokens: 1000, output_tokens: 40 } };
}
const successfulFetch = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
function roundedScore(score: number, confidence: number, probabilities: Record<string, number>) {
  return { type: 'score', score, confidence, probabilities, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])) };
}

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

test('Provider cannot reverse or rewrite the frozen rubric legend while returning a high score', async () => {
  const body = responseBody();
  (body.answers.c0_coverage as { legend: Record<string, string> }).legend['4'] = levels[0];
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'error'); assert.match(result.error!, /legend differs/); assert.equal(result.usage.complete, true);
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
  for (const dimension of ['coverage', 'consistency', 'scope']) body.answers[`c0_${dimension}`] = roundedScore(2, 0, { '0': 0.2, '1': 0.2, '2': 0.2, '3': 0.2, '4': 0.2 });
  body.answers.c0_safe = { type: 'noul', noul: 0.5 }; body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.5, abstain: 0.5 }, confidence: 0 };
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'uncertain'); assert.equal(result.selectedCandidateId, null);
});

test('v4 preserves v2 two-decimal arithmetic and modal-tie validation without altering evidence', async () => {
  const body = responseBody();
  body.answers.c0_consistency = roundedScore(2.27, 0.11, { '0': 0.04, '1': 0.33, '2': 0.13, '3': 0.33, '4': 0.17 });
  body.answers.c0_scope = roundedScore(3.11, 0.26, { '0': 0.03, '1': 0.12, '2': 0.04, '3': 0.30, '4': 0.51 });
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(JEV_POLICY_VERSION, 'jev-candidate-v4'); assert.equal(result.policyVersion, JEV_POLICY_VERSION);
  assert.equal(result.status, 'uncertain'); assert.equal(result.selectedCandidateId, null);
  assert.equal(result.scores[0].dimensions.consistency.score, 2.27);
  assert.equal(result.scores[0].dimensions.consistency.confidence, 0.11);
  assert.deepEqual(result.rawResponse, body); assert.equal(result.scores[0].qualified, false);
});

test('rounded probability sums .99 and 1.01 are validated as unit-sum intervals, not normalized', async () => {
  for (const [sum, answer] of [[0.99, roundedScore(3.78, 0.82, { '0': 0, '1': 0, '2': 0, '3': 0.20, '4': 0.79 })], [1.01, roundedScore(3.79, 0.83, { '0': 0, '1': 0, '2': 0.01, '3': 0.20, '4': 0.80 })]] as const) {
    const body = responseBody(); body.answers.c0_scope = answer;
    const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
    assert.equal(result.status, 'accepted'); assert.equal(result.scores[0].dimensions.scope.score, answer.score);
    assert.ok(Math.abs(Object.values(result.scores[0].dimensions.scope.probabilities).reduce((total, value) => total + value, 0) - sum) < 1e-9);
    assert.deepEqual(result.rawResponse, body);
  }
});

test('Joint score/concentration validation rejects individually plausible but incompatible intervals', async () => {
  // Mode 4 implies confidence=max(0,(E-2.8)/1.2). The reported score interval
  // E=[3.385,3.395] cannot yield confidence=[.505,.515], despite independent
  // probability-box extrema intersecting both intervals.
  const body = responseBody(); body.answers.c0_scope = roundedScore(3.39, 0.51, { '0': 0.10, '1': 0, '2': 0.10, '3': 0, '4': 0.80 });
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'error'); assert.equal(result.selectedCandidateId, null);
  assert.equal(result.errorKind, 'arithmetic-drift'); assert.deepEqual(result.diagnostics, [{ code: 'score-concentration-drift', answerId: 'c0_scope' }]); assert.deepEqual(result.scores, []); assert.equal(result.choice, null);
  assert.match(result.reason, /no joint probability distribution/); assert.deepEqual(result.rawResponse, body);
  // The adjacent jointly consistent evidence remains valid, without relaxing .5.
  body.answers.c0_scope = roundedScore(3.40, 0.50, { '0': 0.10, '1': 0, '2': 0.10, '3': 0, '4': 0.80 });
  assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) })).status, 'accepted');
});

test('Choice must be a displayed argmax; a strictly lower rounded option cannot win', async () => {
  const two = { ...context, candidates: [...context.candidates, { id: 'candidate-two', value: 'Another complete candidate' }] };
  const body = responseBody([4, 4]);
  body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.33, 'candidate-two': 0.34, abstain: 0.33 }, confidence: 0.01 };
  const result = await evaluateJevCandidates(config, two, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'error'); assert.match(result.reason, /displayed highest-probability/);
  assert.equal(result.errorKind, 'fatal'); assert.deepEqual(result.scores, []); assert.equal(result.choice, null);
  body.answers.best = { type: 'choice', choice: 'candidate-two', probabilities: { 'candidate-one': 0.34, 'candidate-two': 0.34, abstain: 0.32 }, confidence: 0.01 };
  assert.equal((await evaluateJevCandidates(config, two, new AbortController().signal, { fetch: successfulFetch(body) })).status, 'uncertain');
});

test('Choice concentration and rounded probabilities must share one unit-sum distribution', async () => {
  // The .99 displayed sum forces the hidden selected probability to .855;
  // concentration must then be .71, not the independently plausible .69.
  const body = responseBody(); body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.85, abstain: 0.14 }, confidence: 0.69 };
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.status, 'error'); assert.match(result.reason, /no joint probability distribution/); assert.deepEqual(result.rawResponse, body);
  assert.equal(result.errorKind, 'arithmetic-drift'); assert.deepEqual(result.diagnostics, [{ code: 'choice-concentration-drift', answerId: 'best' }]);
});

test('Choice supports display rounding propagation while quality and concentration thresholds stay fixed', async () => {
  for (const [probabilities, confidence] of [[{ 'candidate-one': 0.85, abstain: 0.14 }, 0.71], [{ 'candidate-one': 0.85, abstain: 0.16 }, 0.69]] as const) {
    const body = responseBody(); body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities, confidence };
    const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
    assert.equal(result.status, 'accepted'); assert.deepEqual(result.choice?.probabilities, probabilities);
  }
  const lowConfidence = responseBody(); lowConfidence.answers.c0_scope = roundedScore(3.39, 0.49, { '0': 0, '1': 0, '2': 0.20, '3': 0.21, '4': 0.59 });
  assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(lowConfidence) })).status, 'uncertain');
  const lowScore = responseBody(); lowScore.answers.c0_scope = roundedScore(2.99, 0.99, { '0': 0, '1': 0, '2': 0.01, '3': 0.99, '4': 0 });
  assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(lowScore) })).status, 'rejected');
  assert.equal(DEFAULT_JEV_CONFIG.minScore, 3); assert.equal(DEFAULT_JEV_CONFIG.minConfidence, 0.5);
});

test('v2 rounding compatibility still rejects corrupted distributions, scores, confidence and missing values', async () => {
  const invalidScores = [
    roundedScore(3.11, 0.26, { '0': -0.01, '1': 0.16, '2': 0.04, '3': 0.30, '4': 0.51 }),
    roundedScore(3.11, 0.26, { '0': 0.03, '1': 0.12, '2': 0.04, '3': 0.30, '4': 0.40 }),
    roundedScore(2.8, 0.26, { '0': 0.03, '1': 0.12, '2': 0.04, '3': 0.30, '4': 0.51 }),
    roundedScore(3.11, 0.9, { '0': 0.03, '1': 0.12, '2': 0.04, '3': 0.30, '4': 0.51 }),
    roundedScore(3.11, 0.26, { '0': 0.03, '1': 0.12, '2': 0.04, '3': 0.30 }),
  ];
  for (const answer of invalidScores) { const body = responseBody(); body.answers.c0_scope = answer; assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) })).status, 'error'); }
  const choice = responseBody(); choice.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.85, abstain: 0.15 }, confidence: 0.3 };
  assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(choice) })).status, 'error');
  const missing = responseBody(); missing.answers.c0_scope = { type: 'score', confidence: 1, probabilities: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, legend: { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4' } };
  assert.equal((await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(missing) })).status, 'error');
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

test('v3 checks the entire batch before arithmetic classification; later fatal errors cannot be masked', async () => {
  const two = { ...context, candidates: [...context.candidates, { id: 'candidate-two', value: 'Second supplied candidate' }] };
  const mutations: Array<[string, (body: ReturnType<typeof responseBody>) => void]> = [
    ['later missing answer', body => { delete body.answers.c1_scope; }],
    ['later missing field', body => { delete (body.answers.c1_scope as Record<string, unknown>).confidence; }],
    ['later extra field', body => { (body.answers.c1_scope as Record<string, unknown>).errorKind = 'arithmetic-drift'; }],
    ['later wrong type', body => { (body.answers.c1_scope as Record<string, unknown>).type = 'choice'; }],
    ['later score range', body => { (body.answers.c1_scope as Record<string, unknown>).score = 5; }],
    ['later confidence range', body => { (body.answers.c1_scope as Record<string, unknown>).confidence = -0.1; }],
    ['later invalid probability', body => { (body.answers.c1_scope as { probabilities: Record<string, number> }).probabilities['4'] = -0.1; }],
    ['later unit sum invalid', body => { (body.answers.c1_scope as { probabilities: Record<string, number> }).probabilities['4'] = 0.5; }],
    ['later missing level', body => { delete (body.answers.c1_scope as { probabilities: Record<string, number> }).probabilities['0']; }],
    ['later changed legend', body => { (body.answers.c1_scope as { legend: Record<string, string> }).legend['4'] = levels[0]; }],
    ['later malformed safety', body => { body.answers.c1_safe = { type: 'noul', noul: 2 }; }],
    ['earlier malformed safety', body => { body.answers.c0_safe = { type: 'noul' }; }],
    ['wrong best candidate ID', body => { (body.answers.best as Record<string, unknown>).choice = 'foreign-id'; }],
    ['nonmodal best', body => { body.answers.best = { type: 'choice', choice: 'candidate-one', confidence: 0, probabilities: { 'candidate-one': 0.2, 'candidate-two': 0.6, abstain: 0.2 } }; }],
    ['best illegal distribution', body => { body.answers.best = { type: 'choice', choice: 'candidate-one', confidence: 1, probabilities: { 'candidate-one': 1, 'candidate-two': 0, abstain: 0.5 } }; }],
    ['wrong model', body => { body.model = 'unfrozen-model'; }],
    ['missing usage', body => { delete (body as { usage?: unknown }).usage; }],
    ['invalid usage', body => { body.usage.output_tokens = -1; }],
    ['extra answer ID', body => { body.answers.arithmeticDrift = 'not authority'; }],
  ];
  for (const [label, mutate] of mutations) {
    const body = responseBody([4, 4]); (body.answers.c0_coverage as { score: number }).score = 0;
    mutate(body);
    const result = await evaluateJevCandidates(config, two, new AbortController().signal, { fetch: successfulFetch(body) });
    assert.equal(result.status, 'error', label); assert.equal(result.errorKind, 'fatal', label);
    assert.equal(result.selectedCandidateId, null, label); assert.deepEqual(result.scores, [], label); assert.equal(result.choice, null, label); assert.equal(result.diagnostics, undefined, label);
    assert.deepEqual(result.rawResponse, body, label);
  }
});

test('v3 exposes only controlled bounded arithmetic diagnostics and discards every partial selection', async () => {
  const body = responseBody();
  (body.answers.c0_coverage as { score: number }).score = 0;
  body.answers.c0_scope = roundedScore(3.39, 0.51, { '0': 0.10, '1': 0, '2': 0.10, '3': 0, '4': 0.80 });
  body.answers.best = { type: 'choice', choice: 'candidate-one', probabilities: { 'candidate-one': 0.85, abstain: 0.14 }, confidence: 0.69 };
  const result = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(result.errorKind, 'arithmetic-drift'); assert.equal(result.selectedCandidateId, null); assert.deepEqual(result.scores, []); assert.equal(result.choice, null);
  assert.deepEqual(result.diagnostics, [{ code: 'score-mean-drift', answerId: 'c0_coverage' }, { code: 'score-concentration-drift', answerId: 'c0_scope' }, { code: 'choice-concentration-drift', answerId: 'best' }]);
  assert.deepEqual(result.rawResponse, body); assert.equal(result.usage.complete, true);
});

test('provider error text cannot assign arithmetic drift and zero explicitly reported usage remains truthful', async () => {
  const forged = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: (async () => new Response(JSON.stringify({ errorKind: 'arithmetic-drift', message: 'score does not match', usage: { input_tokens: 0, output_tokens: 0 } }), { status: 400 })) as typeof fetch });
  assert.equal(forged.errorKind, 'fatal'); assert.equal(forged.diagnostics, undefined);
  const body = responseBody(); body.usage = { input_tokens: 0, output_tokens: 0 };
  const zero = await evaluateJevCandidates(config, context, new AbortController().signal, { fetch: successfulFetch(body) });
  assert.equal(zero.status, 'accepted'); assert.equal(zero.usage.complete, true); assert.equal(zero.usage.estimatedCost, 0);
});
