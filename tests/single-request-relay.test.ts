import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { HARNESS_NAME, runRole } from '../server/harness.ts';
import { createSingleRequestRelay, RELAY_INPUT_ENVELOPE_TOKENS, SINGLE_REQUEST_RELAY_VERSION } from '../server/research/single-request-relay.ts';
import { PROVIDER_USAGE_WITNESS_VERSION } from '../server/research/provider-usage-witness.ts';

const model = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', apiKey: 'offline-relay-fixture-key' };
const expectedPrompts = { system: 'Return JSON only.', user: 'Offline relay test.' };
const messages = [{ role: 'system', content: expectedPrompts.system }, { role: 'user', content: expectedPrompts.user }];
const payload = { model: model.modelId, messages, max_tokens: 3000, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } };
const digest = (body: string) => createHash('sha256').update(body).digest('hex');

function sseResponse(text = '{"offline":true}') {
  return new Response([
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const relayInput = { model, maxOutputTokens: 3000, reservedInputTokens: 10000, expectedPrompts };
const createRelay = (overrides: Partial<Parameters<typeof createSingleRequestRelay>[0]> = {}) =>
  createSingleRequestRelay({ ...relayInput, upstreamFetch: async () => sseResponse(), ...overrides });

async function post(baseUrl: string, body: unknown, key = model.apiKey, path = '/chat/completions') {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('unregistered model, invalid caps and absent frozen prompts cannot create a listening relay', async () => {
  for (const changed of [{ model: { ...model, provider: 'openai-compatible' } }, { model: { ...model, baseUrl: 'https://example.invalid' } },
    { model: { ...model, modelId: 'unregistered-model' } }, { maxOutputTokens: 0 }, { maxOutputTokens: 3.5 },
    { maxOutputTokens: Number.NaN }, { maxOutputTokens: Infinity }, { reservedInputTokens: 0 }, { reservedInputTokens: Number.NaN },
    { reservedInputTokens: Infinity }, { expectedPrompts: undefined }]) {
    await assert.rejects(createRelay({ ...changed, upstreamFetch: async () => { throw new Error('No upstream call permitted.'); } }));
  }
});

test('real Harness SDK forwards one immutable frozen body with keyless hash and raw usage witness', { timeout: 45_000 }, async () => {
  const upstreamCalls: { url: string; init: RequestInit; body: any }[] = [];
  const mutablePrompts = { ...expectedPrompts }; const mutableModel = { ...model };
  const relay = await createRelay({ expectedPrompts: mutablePrompts, model: mutableModel, upstreamFetch: async (url, init) => {
    assert.ok(init); upstreamCalls.push({ url: String(url), init, body: JSON.parse(String(init.body)) }); return sseResponse();
  } });
  mutablePrompts.user = 'Caller changed after initialization.'; mutableModel.modelId = 'mutated-model';
  try {
    const result = await runRole({ ...model, baseUrl: relay.baseUrl }, expectedPrompts.system, expectedPrompts.user, new AbortController().signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true });
    assert.equal(result.text, '{"offline":true}'); assert.equal(result.harness, HARNESS_NAME); assert.equal(result.usageReported, true);
    assert.equal(result.inputTokens, 13); assert.equal(result.outputTokens, 7); assert.equal(upstreamCalls.length, 1);
    const { url, init, body } = upstreamCalls[0];
    assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.deepEqual(body, payload);
    assert.equal(init.body, JSON.stringify(payload)); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` });
    const snapshot = relay.snapshot();
    assert.equal(snapshot.relayVersion, SINGLE_REQUEST_RELAY_VERSION); assert.equal(snapshot.requestAttempts, 1);
    assert.equal(snapshot.forwardedRequests, 1); assert.equal(snapshot.deniedRequests, 0);
    assert.equal(snapshot.inputUtf8Bytes, Buffer.byteLength(JSON.stringify(messages)));
    assert.equal(snapshot.bodyUtf8Bytes, Buffer.byteLength(JSON.stringify(payload)));
    assert.equal(snapshot.frozenBodySha256, digest(String(init.body))); assert.equal(snapshot.forwardedBodySha256, snapshot.frozenBodySha256);
    assert.deepEqual(snapshot.providerUsageWitness, { version: PROVIDER_USAGE_WITNESS_VERSION, state: 'reported', usagePackets: 1, usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 } });
    assert.equal((await post(relay.baseUrl, payload)).status, 409);
    assert.equal(upstreamCalls.length, 1); assert.equal(relay.snapshot().deniedRequests, 1); assert.equal(relay.snapshot().requestAttempts, 2);
    for (const secret of [model.apiKey, expectedPrompts.system, expectedPrompts.user]) assert.equal(JSON.stringify(relay.snapshot()).includes(secret), false);
  } finally { await relay.close(); }
});

test('each rejected first attempt locks its invocation before any corrected request or retry', async () => {
  const invalid: { body?: unknown; key?: string; path?: string; method?: string; expectedStatus?: number }[] = [
    { key: 'incorrect-key' }, { path: '/wrong-path' }, { method: 'GET' }, { body: '{malformed', expectedStatus: 502 },
    ...[{ model: 'different-model' }, { max_tokens: 3001 }, { max_tokens: 2999 }, { max_tokens: 0 }, { max_tokens: 100.5 },
      { thinking: { type: 'enabled' } }, { thinking: { type: 'disabled', extra: 'unregistered' } },
      { tools: [{ type: 'function', function: { name: 'host-tool' } }] }, { tools: {} }, { n: 2 }, { max_completion_tokens: 100000 },
      { messages: [{ role: 'system', content: expectedPrompts.system }, { role: 'user', content: 'Same size, different prompt.' }] },
      { messages: [{ role: 'system', content: expectedPrompts.system, name: 'unregistered' }, messages[1]] },
      { messages: [{ role: 'assistant', content: 'No follow-up turn.' }] },
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'Unsupported content shape' }] }] },
      { stream: false }, { stream_options: { include_usage: false } }, { stream_options: { include_usage: true, extra: 'x'.repeat(100000) } },
      { stream_options: {} }, { unregisteredBillingParameter: true }].map(changed => ({ body: { ...payload, ...changed } })),
  ];
  for (const input of invalid) {
    let calls = 0;
    const relay = await createRelay({ upstreamFetch: async () => { calls++; return sseResponse(); } });
    try {
      const first = input.method ? await fetch(`${relay.baseUrl}/chat/completions`, { method: input.method, headers: { Authorization: `Bearer ${model.apiKey}` } })
        : await post(relay.baseUrl, input.body ?? payload, input.key ?? model.apiKey, input.path ?? '/chat/completions');
      assert.equal(first.status, input.expectedStatus ?? 409); await first.text();
      const retry = await post(relay.baseUrl, payload); assert.equal(retry.status, 409); await retry.text();
      assert.equal(calls, 0); assert.equal(relay.snapshot().forwardedRequests, 0);
      assert.equal(relay.snapshot().deniedRequests, 2); assert.equal(relay.snapshot().requestAttempts, 2);
    } finally { await relay.close(); }
  }
});

test('actual full wire bytes plus envelope are bounded, including ignored JSON whitespace and 512KB input', async () => {
  const body = JSON.stringify(payload); const exactReserve = Buffer.byteLength(body) + RELAY_INPUT_ENVELOPE_TOKENS;
  await assert.rejects(createRelay({ reservedInputTokens: exactReserve - 1 }), /完整wire/);
  let calls = 0;
  const relay = await createRelay({ reservedInputTokens: exactReserve, upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    assert.equal((await post(relay.baseUrl, body + ' ')).status, 409); assert.equal((await post(relay.baseUrl, payload)).status, 409);
    assert.equal(calls, 0); assert.equal(relay.snapshot().receivedBodyUtf8Bytes, Buffer.byteLength(body) + 1);
  } finally { await relay.close(); }
  const oversized = await createRelay({ reservedInputTokens: 1_000_000, upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    assert.equal((await post(oversized.baseUrl, ' '.repeat(512001))).status, 409);
    assert.equal((await post(oversized.baseUrl, payload)).status, 409); assert.equal(calls, 0);
  } finally { await oversized.close(); }
});

test('upstream failure consumes exactly one irreversible request and rejects later requests', async () => {
  let calls = 0;
  const relay = await createRelay({ upstreamFetch: async () => { calls++; throw new Error(`private-provider-error-${model.apiKey}`); } });
  try {
    const first = await post(relay.baseUrl, payload); assert.equal(first.status, 502); assert.equal((await first.text()).includes(model.apiKey), false);
    assert.equal((await post(relay.baseUrl, payload)).status, 409); assert.equal(calls, 1);
    assert.equal(relay.snapshot().forwardedRequests, 1); assert.equal(relay.snapshot().providerStatus, null);
    assert.equal(relay.snapshot().providerUsageWitness.state, 'transport-failed');
  } finally { await relay.close(); }
});

test('provider HTTP error status and unsupported success JSON cannot certify usage or retry', async () => {
  for (const status of [401, 200]) {
    let calls = 0;
    const relay = await createRelay({ upstreamFetch: async (_url, init) => { calls++; assert.equal(init?.redirect, 'error');
      return new Response('{"usage":{"prompt_tokens":13,"completion_tokens":7,"total_tokens":20}}', { status, headers: { 'content-type': 'application/json' } });
    } });
    try {
      const first = await post(relay.baseUrl, payload); assert.equal(first.status, status); await first.text();
      assert.equal(relay.snapshot().providerStatus, status); assert.equal(relay.snapshot().providerUsageWitness.usage, null);
      assert.equal((await post(relay.baseUrl, payload)).status, 409); assert.equal(calls, 1);
    } finally { await relay.close(); }
  }
});

function heldPost(baseUrl: string) {
  const body = JSON.stringify(payload); let finish!: () => void;
  const result = new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${model.apiKey}`, 'content-length': Buffer.byteLength(body) } },
      response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    request.on('error', reject); request.write(body.slice(0, -1)); finish = () => request.end(body.slice(-1));
  });
  return { finish, result };
}

test('concurrent partially-read requests claim at most one attempt and a denied competitor stops forwarding', async () => {
  let calls = 0;
  const relay = await createRelay({ upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    const first = heldPost(relay.baseUrl); const second = heldPost(relay.baseUrl);
    await new Promise(resolve => setTimeout(resolve, 100));
    first.finish(); second.finish();
    assert.deepEqual((await Promise.all([first.result, second.result])).sort(), [409, 409]);
    assert.equal(calls, 0); assert.equal(relay.snapshot().requestAttempts, 2); assert.equal(relay.snapshot().forwardedRequests, 0);
  } finally { await relay.close(); }
});
