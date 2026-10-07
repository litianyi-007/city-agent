import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { HARNESS_NAME, runRole } from '../server/harness.ts';
import { createSingleRequestRelay } from '../server/research/single-request-relay.ts';

const model = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', apiKey: 'offline-relay-fixture-key' };
const messages = [{ role: 'system', content: 'Return JSON only.' }, { role: 'user', content: 'Offline relay test.' }];
const payload = { model: model.modelId, max_tokens: 3000, thinking: { type: 'disabled' }, messages, stream: true };

function sseResponse(text = '{"offline":true}') {
  return new Response([
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function post(baseUrl: string, body: unknown, key = model.apiKey, path = '/chat/completions') {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('only registered official model configuration may initialize a relay', async () => {
  for (const changed of [{ provider: 'openai-compatible' }, { baseUrl: 'https://example.invalid' }, { modelId: 'unregistered-model' }]) {
    await assert.rejects(createSingleRequestRelay({ model: { ...model, ...changed }, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async () => { throw new Error('No upstream call permitted.'); } }), /只允许/);
  }
});

test('invalid numeric reservation or output caps are refused before creating a forwarding listener', async () => {
  for (const changed of [{ maxOutputTokens: 0 }, { maxOutputTokens: 3.5 }, { maxOutputTokens: Number.NaN }, { maxOutputTokens: Number.POSITIVE_INFINITY }, { reservedInputTokens: 0 }, { reservedInputTokens: Number.NaN }, { reservedInputTokens: Number.POSITIVE_INFINITY }]) {
    let relay: Awaited<ReturnType<typeof createSingleRequestRelay>> | undefined;
    try {
      await assert.rejects(async () => { relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, ...changed, upstreamFetch: async () => { throw new Error('No upstream call permitted.'); } }); });
    } finally { await relay?.close(); }
  }
});

test('real Harness SDK payload passes the actual relay with thinking disabled, no tools, exact prompts and one offline upstream request', { timeout: 45_000 }, async () => {
  const upstreamCalls: { url: string; init: RequestInit; body: any }[] = [];
  const upstreamFetch: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
    assert.ok(init); const body = JSON.parse(String(init.body));
    upstreamCalls.push({ url: String(url), init, body });
    return sseResponse();
  };
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch });
  try {
    const result = await runRole({ ...model, baseUrl: relay.baseUrl }, messages[0].content, messages[1].content, new AbortController().signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true });
    assert.equal(result.text, '{"offline":true}');
    assert.equal(result.harness, HARNESS_NAME); assert.equal(result.usageReported, true);
    assert.equal(result.inputTokens, 13); assert.equal(result.outputTokens, 7);
    assert.equal(upstreamCalls.length, 1);
    const { init, body } = upstreamCalls[0];
    assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'stream_options', 'thinking']);
    assert.deepEqual(body.messages, messages);
    assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.tools, undefined);
    assert.equal(body.model, model.modelId); assert.equal(body.max_tokens, 3000);
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` });
    assert.deepEqual(relay.snapshot(), { forwardedRequests: 1, deniedRequests: 0, inputUtf8Bytes: Buffer.byteLength(JSON.stringify(messages)), providerStatus: 200, maxOutputTokens: 3000 });
    const repeat = await post(relay.baseUrl, payload); assert.equal(repeat.status, 409);
    assert.equal(upstreamCalls.length, 1); assert.equal(relay.snapshot().deniedRequests, 1);
    assert.equal(JSON.stringify(relay.snapshot()).includes(model.apiKey), false);
  } finally { await relay.close(); }
});

test('wrong credential/path/method, model, tools, reasoning, prompt type and bounds are rejected without upstream fetch', async () => {
  let calls = 0;
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    assert.equal((await post(relay.baseUrl, payload, 'incorrect-key')).status, 409);
    assert.equal((await post(relay.baseUrl, payload, model.apiKey, '/wrong-path')).status, 409);
    assert.equal((await fetch(`${relay.baseUrl}/chat/completions`, { headers: { Authorization: `Bearer ${model.apiKey}` } })).status, 409);
    for (const changed of [
      { model: 'different-model' }, { max_tokens: 3001 }, { max_tokens: 0 }, { max_tokens: 100.5 },
      { thinking: { type: 'enabled' } }, { tools: [{ type: 'function', function: { name: 'host-tool' } }] },
      { messages: [{ role: 'assistant', content: 'No follow-up assistant/tool turn permitted.' }] },
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'Unsupported content shape' }] }] },
      { messages: [{ role: 'user', content: 'x'.repeat(10000) }] },
    ]) assert.equal((await post(relay.baseUrl, { ...payload, ...changed })).status, 409);
    assert.equal(calls, 0); assert.equal(relay.snapshot().forwardedRequests, 0);
    assert.equal(relay.snapshot().deniedRequests, 12);
    assert.equal((await post(relay.baseUrl, payload)).status, 200);
    assert.equal(calls, 1);
  } finally { await relay.close(); }
});

test('512KB limit and malformed JSON fail before forwarding any request', async () => {
  let calls = 0;
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 1_000_000, upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    assert.equal((await post(relay.baseUrl, { ...payload, messages: [{ role: 'user', content: 'x'.repeat(512001) }] })).status, 409);
    assert.equal((await post(relay.baseUrl, '{malformed')).status, 502);
    assert.equal(calls, 0); assert.equal(relay.snapshot().forwardedRequests, 0);
  } finally { await relay.close(); }
});

test('upstream failure counts the irreversible request and rejects all retries', async () => {
  let calls = 0;
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async () => { calls++; throw new Error(`private-provider-error-${model.apiKey}`); } });
  try {
    const first = await post(relay.baseUrl, payload);
    assert.equal(first.status, 502); assert.equal((await first.text()).includes(model.apiKey), false);
    assert.equal((await post(relay.baseUrl, payload)).status, 409);
    assert.equal(calls, 1); assert.equal(relay.snapshot().forwardedRequests, 1);
    assert.equal(relay.snapshot().providerStatus, null);
  } finally { await relay.close(); }
});

test('provider error status is retained once, without hidden retry or redirect', async () => {
  let calls = 0;
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async (_url, init) => { calls++; assert.equal(init?.redirect, 'error'); return new Response('{"error":"offline authentication error"}', { status: 401, headers: { 'content-type': 'application/json' } }); } });
  try {
    assert.equal((await post(relay.baseUrl, payload)).status, 401);
    assert.equal(relay.snapshot().providerStatus, 401);
    assert.equal((await post(relay.baseUrl, payload)).status, 409);
    assert.equal(calls, 1);
  } finally { await relay.close(); }
});

test('multiple completions, malformed tools and unregistered top-level parameters cannot multiply or alter a paid request', async () => {
  for (const changed of [{ n: 2 }, { tools: {} }, { max_completion_tokens: 100000 }, { unregisteredBillingParameter: true }]) {
    let calls = 0;
    const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async () => { calls++; return sseResponse(); } });
    try {
      assert.equal((await post(relay.baseUrl, { ...payload, ...changed })).status, 409, `Unregistered payload: ${Object.keys(changed).join(',')}`);
      assert.equal(calls, 0);
    } finally { await relay.close(); }
  }
});

function heldPost(baseUrl: string) {
  const body = JSON.stringify(payload);
  let finish!: () => void;
  const result = new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${model.apiKey}`, 'content-length': Buffer.byteLength(body) } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    request.on('error', reject);
    request.write(body.slice(0, -1));
    finish = () => request.end(body.slice(-1));
  });
  return { finish, result };
}

test('concurrent partially-read requests cannot both obtain a single-request forwarding slot', async () => {
  let calls = 0;
  const relay = await createSingleRequestRelay({ model, maxOutputTokens: 3000, reservedInputTokens: 10000, upstreamFetch: async () => { calls++; return sseResponse(); } });
  try {
    const first = heldPost(relay.baseUrl); const second = heldPost(relay.baseUrl);
    // Both handlers must see the partial-body phase before either body completes.
    await new Promise(resolve => setTimeout(resolve, 100));
    first.finish(); await first.result;
    second.finish(); const statuses = [await first.result, await second.result].sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(calls, 1); assert.equal(relay.snapshot().forwardedRequests, 1);
  } finally { await relay.close(); }
});
