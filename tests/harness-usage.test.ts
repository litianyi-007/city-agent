import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { stream as piStream } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model, OpenAICompletionsCompat } from '@earendil-works/pi-ai';
import { runRole } from '../server/harness.js';
import { createUsageProxy, observerPathFor, WireUsageObserver } from '../server/usage-observer.js';

async function provider(handler: (req: IncomingMessage, res: ServerResponse) => void, check: (url: string) => Promise<void>) {
  let handlerError: unknown;
  const server = createServer(async (req, res) => { try { for await (const _chunk of req) { /* Consume fixture body without saving credentials. */ } handler(req, res); } catch (error) { handlerError = error; res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"local fixture rejected request"}}'); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await check(`http://127.0.0.1:${address.port}`); if (handlerError) throw handlerError; } catch (error) { throw handlerError ?? error; }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function openai(res: ServerResponse, usage?: unknown) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [{ choices: [{ index: 0, delta: { role: 'assistant', content: 'accepted' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(usage === undefined ? {} : { usage }) }]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end('data: [DONE]\n\n');
}
const limits = { maxOutputTokens: 3000, timeoutMs: 30000, reportUsage: true };

test('raw-wire observer does not infer missing or partial usage from normalized zero fields', () => {
  for (const value of [{}, { usage: { prompt_tokens: 10 } }, { usage: { completion_tokens: 2 } }, { usage: { prompt_tokens: NaN, completion_tokens: 2 } }, { usage: { prompt_tokens: '10', completion_tokens: 2 } }]) {
    const observer = new WireUsageObserver('openai-completions'); observer.observe(value); const result = observer.result(); assert.equal(result.inputReported && result.outputReported, false);
  }
  const zero = new WireUsageObserver('openai-completions'); zero.observe({ usage: { prompt_tokens: 0, completion_tokens: 0 } }); assert.deepEqual(zero.result(), { inputReported: true, outputReported: true, inputTokens: 0, outputTokens: 0 });
  const nested = new WireUsageObserver('openai-completions'); nested.observe({ choices: [{ usage: { prompt_tokens: 13, completion_tokens: 7 } }] }); assert.equal(nested.result().inputTokens, 13);
});

test('raw SSE parser handles split frames and Anthropic cache totals without saving content', () => {
  const observer = new WireUsageObserver('anthropic-messages'); const events = [ { type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 } } }, { type: 'message_delta', usage: { output_tokens: 7 } } ];
  const stream = events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
  for (let index = 0; index < stream.length; index += 3) observer.feedSse(stream.slice(index, index + 3)); observer.finishSse(); assert.deepEqual(observer.result(), { inputReported: true, outputReported: true, inputTokens: 18, outputTokens: 7 });
  const partial = new WireUsageObserver('anthropic-messages'); partial.observe(events[0]); assert.equal(partial.result().outputReported, false);
});

test('real SDK raw usage absent and partial are unknown; full cached and actual zero usage are known', { timeout: 90000 }, async () => {
  for (const [raw, known, inputTokens, outputTokens] of [ [undefined, false, null, null], [{ prompt_tokens: 10 }, false, null, null], [{ prompt_tokens: 13, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 5 } }, true, 13, 7], [{ prompt_tokens: 0, completion_tokens: 0 }, true, 0, 0] ] as const) {
    await provider((req, res) => { assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer usage-fixture-key'); openai(res, raw); }, async url => {
      const result = await runRole({ provider: 'openai-compatible', baseUrl: `${url}/v1`, modelId: 'usage-fixture-model', apiKey: 'usage-fixture-key' }, 'Return text.', 'Local usage test', new AbortController().signal, undefined, limits);
      assert.equal(result.usageReported, known); assert.equal(result.providerRequests?.requests, 1); assert.equal(result.providerRequests?.complete, known);
      if (known) { assert.equal(result.inputTokens, inputTokens); assert.equal(result.outputTokens, outputTokens); }
      assert.equal(JSON.stringify(result.providerRequests).includes('usage-fixture-key'), false);
    });
  }
});

test('proxy keeps JSON replies intact, observes raw counts, validates request scope and refuses second POST before spending', async () => {
  let requests = 0;
  await provider((req, res) => { requests++; assert.equal(req.url, '/v1/chat/completions'); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); }, async url => {
    const proxy = await createUsageProxy(new URL(`${url}/v1`), 'openai-completions', 'scope-test-key', new AbortController().signal);
    try {
      assert.equal((await fetch(`${proxy.baseUrl}/wrong`, { method: 'POST', headers: { authorization: 'Bearer scope-test-key' }, body: '{}' })).status, 403);
      assert.equal((await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' })).status, 403);
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer scope-test-key', 'content-type': 'application/json' }, body: '{}' }); const data = await response.json(); assert.equal(data.choices[0].message.content, 'ok');
      assert.equal((await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer scope-test-key' }, body: '{}' })).status, 409);
      const summary = proxy.summary(); assert.equal(summary.requests, 1); assert.equal(summary.deniedRequests, 3); assert.equal(summary.inputTokens, 8); assert.equal(summary.outputTokens, 4); assert.equal(summary.complete, true);
    } finally { await proxy.close(); }
  }); assert.equal(requests, 1);
});

test('real SDK Anthropic native SSE full input/output is known but a missing final output remains unknown', { timeout: 90000 }, async () => {
  for (const reportOutput of [true, false]) await provider((req, res) => {
    assert.equal(new URL(req.url!, 'http://fixture').pathname, '/v1/messages'); assert.equal(req.headers['x-api-key'], 'anthropic-usage-key'); res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [ { type: 'message_start', message: { id: 'msg_usage', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'native' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: reportOutput ? { output_tokens: 5 } : {} }, { type: 'message_stop' } ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); res.end();
  }, async url => { const result = await runRole({ provider: 'anthropic', baseUrl: url, modelId: 'claude-fixture', apiKey: 'anthropic-usage-key' }, 'Return text.', 'Anthropic local fixture', new AbortController().signal, undefined, limits); assert.equal(result.usageReported, reportOutput); assert.equal(result.providerRequests?.requests, 1); if (reportOutput) { assert.equal(result.inputTokens, 11); assert.equal(result.outputTokens, 5); } });
});

test('usage proxy abort closes its upstream stream and its listening port', { timeout: 30000 }, async () => {
  let closed = false; const controller = new AbortController(); let closedProxyUrl = '';
  await provider((_req, res) => { res.on('close', () => { closed = true; }); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); setTimeout(() => controller.abort(), 50); }, async url => {
    const proxy = await createUsageProxy(new URL(`${url}/v1`), 'openai-completions', 'abort-key', controller.signal); closedProxyUrl = proxy.baseUrl;
    const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer abort-key' }, body: '{}' }); await assert.rejects(response.text()); await proxy.close();
    const deadline = Date.now() + 1000; while (!closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(closed, true); assert.equal(proxy.summary().complete, false);
  }); await assert.rejects(fetch(closedProxyUrl));
});

test('marker URL preserves pinned pi-ai adapter-generated body/headers with original Harness compatibility overrides', async () => {
  const capture = async (baseUrl: string, compat?: OpenAICompletionsCompat) => {
    let body: unknown; let headers: unknown;
    const model: Model<'openai-completions'> = { id: 'test-model', name: 'test-model', api: 'openai-completions', provider: 'city-agent', baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: 1024, ...(compat ? { compat } : {}) };
    for await (const _event of piStream(model, { systemPrompt: 'fixture', messages: [{ role: 'user', content: 'fixture', timestamp: 0 }] }, { apiKey: 'fake-fetch-fixture-key', sessionId: 'fixed-session', maxTokens: 1024, maxRetries: 0, fetch: async (_request, init) => { body = JSON.parse(String(init?.body)); headers = Object.fromEntries(new Headers(init?.headers).entries()); return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }); } })) { /* Entire execution is in-memory fake fetch, not a paid API. */ }
    assert.ok(body); return { body, headers };
  };
  for (const url of ['https://api.openai.com/v1', 'https://api.deepseek.com', 'https://api.x.ai/v1', 'https://api.moonshot.cn/v1', 'https://openrouter.ai/api/v1', 'https://api.together.ai/v1', 'https://api.cloudflare.com/client/v4/accounts/demo/ai/v1', 'https://gateway.ai.cloudflare.com/v1/demo', 'https://integrate.api.nvidia.com/v1', 'https://api.z.ai/api/paas/v4', 'https://api.ant-ling.com/v1', 'https://api.cerebras.ai/v1', 'https://llm.chutes.ai/v1', 'https://opencode.ai/zen/v1']) {
    const upstream = new URL(url); const marker = `http://127.0.0.1:12345${observerPathFor(upstream)}`;
    for (const compat of [undefined, { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, ...(url.includes('deepseek.com') ? { thinkingFormat: 'deepseek' as const } : {}) }] as Array<OpenAICompletionsCompat | undefined>) assert.deepEqual(await capture(marker, compat), await capture(url, compat), `URL semantics changed for ${url}`);
  }
  const direct = await capture('https://api.openai.com/v1'); assert.equal((direct.body as Record<string, unknown>).prompt_cache_key, 'fixed-session');
});

test('Anthropic OAuth-style credentials preserve native Bearer, x-app and Harness-overridden identity header through proxy', { timeout: 45000 }, async () => {
  await provider((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer sk-ant-oat-fixture-key'); assert.equal(req.headers['x-api-key'], undefined); assert.equal(req.headers['x-app'], 'cli'); assert.match(String(req.headers['user-agent']), /^deepseek-harness\/0\.1\.5-rc\.3/); res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [{ type: 'message_start', message: { id: 'msg_oauth', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'native' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); res.end();
  }, async url => { const result = await runRole({ provider: 'anthropic', baseUrl: url, modelId: 'claude-fixture', apiKey: 'sk-ant-oat-fixture-key' }, 'Return text.', 'OAuth local test', new AbortController().signal, undefined, limits); assert.equal(result.usageReported, true); assert.equal(result.providerRequests?.requests, 1); });
});

test('cancelling real Harness with wire observer stops its actual provider stream and preserves unknown usage evidence', { timeout: 30000 }, async () => {
  const controller = new AbortController(); let connectionClosed = false;
  await provider((_req, res) => { res.on('close', () => { connectionClosed = true; }); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); setTimeout(() => controller.abort(), 50); }, async url => {
    await assert.rejects(runRole({ provider: 'openai-compatible', baseUrl: `${url}/v1`, modelId: 'cancel-wire-fixture', apiKey: 'cancel-wire-key' }, 'Return text.', 'Cancel fixture', controller.signal, undefined, limits), (error: any) => { assert.equal(error.name, 'AbortError'); assert.equal(error.evidence.inputTokens, null); assert.equal(error.evidence.outputTokens, null); assert.equal(error.evidence.providerRequests.requests, 1); assert.equal(error.evidence.providerRequests.complete, false); return true; });
    const deadline = Date.now() + 1000; while (!connectionClosed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(connectionClosed, true);
  });
});

test('raw-wire parser rejects unsafe integers, Anthropic cache-sum overflow and malformed frames', () => {
  const openai = new WireUsageObserver('openai-completions'); openai.observe({ usage: { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 1 } }); assert.equal(openai.result().inputReported, false);
  const anthropic = new WireUsageObserver('anthropic-messages'); anthropic.observe({ type: 'message_start', message: { usage: { input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1 } } }); assert.equal(anthropic.result().inputReported, false);
  const malformed = new WireUsageObserver('openai-completions'); malformed.feedSse('data: {broken-json\n\n'); malformed.feedSse('data: {"usage":{"prompt_tokens":13,"completion_tokens":7}}\n\n'); assert.equal(malformed.result().inputReported, false);
});

test('explicit SSE protocol completion preserves reported usage when SDK closes before provider HTTP EOF', { timeout: 30000 }, async () => {
  let providerClosed = false;
  await provider((_req, res) => { res.on('close', () => { providerClosed = true; }); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":13,"completion_tokens":7}}\n\ndata: [DONE]\n\n'); /* Deliberately no HTTP end: SDK must terminate at [DONE]. */ }, async url => {
    const result = await runRole({ provider: 'openai-compatible', baseUrl: `${url}/v1`, modelId: 'done-without-eof', apiKey: 'done-fixture-key' }, 'Return text.', 'Protocol completion fixture', new AbortController().signal, undefined, limits); assert.equal(result.usageReported, true); assert.equal(result.providerRequests?.transportComplete, true); assert.equal(result.inputTokens, 13); assert.equal(result.outputTokens, 7);
    const deadline = Date.now() + 1000; while (!providerClosed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(providerClosed, true);
  });
});

test('Anthropic cumulative delta input/cache revisions match the real SDK final total and null updates preserve prior components', { timeout: 30000 }, async () => {
  await provider((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [{ type: 'message_start', message: { id: 'msg_delta_usage', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'updated' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 15, cache_creation_input_tokens: 5, cache_read_input_tokens: 3, output_tokens: 7 } }, { type: 'message_delta', delta: {}, usage: { input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null } }, { type: 'message_stop' }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); res.end();
  }, async url => { const result = await runRole({ provider: 'anthropic', baseUrl: url, modelId: 'claude-fixture', apiKey: 'anthropic-delta-key' }, 'Return text.', 'Cumulative input cache fixture', new AbortController().signal, undefined, limits); assert.equal(result.usageReported, true); assert.equal(result.inputTokens, 23); assert.equal(result.outputTokens, 7); assert.equal(result.providerRequests?.inputTokens, 23); });
});
