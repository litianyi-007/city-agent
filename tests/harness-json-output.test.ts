import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { HARNESS_JSON_OUTPUT_VERSION, HarnessCallError, runRole } from '../server/harness.ts';
import { createUsageProxy } from '../server/usage-observer.ts';

const fixtureKey = 'synthetic-json-output-fixture-token-not-real';
const systemText = 'Return JSON only. 中文 "引号" {{unknown}} {{cwd}}\r\nDo not call tools.';
const userText = 'Literal user input {{model}} {{particleCount}} "quotes" 中文\n';
const limits = { maxOutputTokens: 1024, timeoutMs: 30_000, reportUsage: true, responseMode: 'json-object' as const };

async function withProvider(handler: (req: IncomingMessage, res: ServerResponse, bytes: Buffer) => void, check: (baseUrl: string) => Promise<void>) {
  let error: unknown;
  const server = createServer(async (req, res) => {
    try { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); handler(req, res, Buffer.concat(chunks)); }
    catch (failure) { error = failure; res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Free local fixture failure"}}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await check(`http://127.0.0.1:${address.port}/v1`); if (error) throw error; }
  catch (failure) { throw error ?? failure; }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(failure => failure ? reject(failure) : resolve())); }
}

function reply(res: ServerResponse, text: string, finish = 'stop', usage: unknown = { prompt_tokens: 13, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 5 } }) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [{ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: finish }], ...(usage === undefined ? {} : { usage }) }]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end('data: [DONE]\n\n');
}

test('real pinned SDK adds only DeepSeek json_object while preserving literal messages, model, caps, disabled tools and reported usage', { timeout: 60_000 }, async () => {
  const captures: Record<string, unknown>[] = [];
  await withProvider((req, res, bytes) => { assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`); captures.push(JSON.parse(bytes.toString('utf8'))); reply(res, '{"accepted":true}'); }, async baseUrl => {
    const agent = { provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: fixtureKey };
    const baseline = await runRole(agent, systemText, userText, new AbortController().signal, undefined, { ...limits, responseMode: undefined });
    assert.equal(baseline.providerRequests?.responseFormat, undefined);
    const json = await runRole(agent, systemText, userText, new AbortController().signal, undefined, limits);
    assert.equal(json.text, '{"accepted":true}'); assert.equal(json.usageReported, true); assert.equal(json.inputTokens, 13); assert.equal(json.outputTokens, 7);
    assert.deepEqual(json.providerRequests?.responseFormat, { version: HARNESS_JSON_OUTPUT_VERSION, mode: 'json-object', evidence: 'wire-observed' });
    assert.equal(JSON.stringify(json).includes(fixtureKey), false);
  });
  assert.equal(captures.length, 2); const { response_format, ...rest } = captures[1]; assert.deepEqual(response_format, { type: 'json_object' }); assert.deepEqual(rest, captures[0]);
  assert.deepEqual(rest.messages, [{ role: 'system', content: systemText }, { role: 'user', content: userText }]); assert.deepEqual(rest.thinking, { type: 'disabled' }); assert.equal(rest.max_tokens, 1024); assert.deepEqual(rest.stream_options, { include_usage: true });
  assert.equal(Object.hasOwn(rest, 'tools'), false); assert.equal(Object.hasOwn(rest, 'tool_choice'), false);
});

test('native mode refuses unsupported providers before dispatch and does not silently choose text', async () => {
  for (const provider of ['anthropic', 'openai', 'openai-compatible']) await assert.rejects(runRole({ provider, baseUrl: 'https://example.invalid', modelId: 'fixture', apiKey: fixtureKey }, systemText, userText, new AbortController().signal, undefined, limits), /explicit DeepSeek Chat provider/);
  await assert.rejects(createUsageProxy(new URL('https://example.invalid'), 'anthropic-messages', fixtureKey, new AbortController().signal, { provider: 'deepseek', modelId: 'fixture' }), /explicit DeepSeek Chat/);
});

test('controlled proxy rejects malformed JSON, wrong model, tools and conflicting formats before any provider POST', async () => {
  let requests = 0;
  await withProvider((_req, res) => { requests++; reply(res, '{}'); }, async baseUrl => {
    const proxy = await createUsageProxy(new URL(baseUrl), 'openai-completions', fixtureKey, new AbortController().signal, { provider: 'deepseek', modelId: 'fixture' });
    const envelope = { model: 'fixture', stream: true, messages: [{ role: 'user', content: 'Return JSON' }] };
    const rejected = ['{ malformed', 'null', '[]', JSON.stringify({ ...envelope, model: 'another' }), JSON.stringify({ ...envelope, tools: [] }), JSON.stringify({ ...envelope, tool_choice: 'none' }), JSON.stringify({ ...envelope, functions: [] }), JSON.stringify({ ...envelope, response_format: { type: 'text' } }), JSON.stringify({ ...envelope, response_format: { type: 'json_object', strict: true } }), JSON.stringify({ ...envelope, messages: [{ role: 'assistant', content: 'JSON', tool_calls: [] }] }), JSON.stringify({ ...envelope, messages: [{ role: ['user'], content: 'JSON' }] }), JSON.stringify(envelope).replace('"stream":true', '"stream":true,"number":1e999'), Buffer.from([0xff])];
    try {
      for (const body of rejected) { const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${fixtureKey}`, 'content-type': 'application/json' }, body }); assert.equal(response.status, 400); await response.arrayBuffer(); }
      const refused = proxy.summary(); assert.equal(refused.requests, 0); assert.equal(refused.deniedRequests, rejected.length); assert.equal(refused.complete, false); assert.equal(refused.inputTokens, null); assert.equal(refused.responseFormat?.evidence, 'requested');
      // A legal pre-existing identical format is idempotent, not a conflict.
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${fixtureKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...envelope, response_format: { type: 'json_object' } }) }); assert.equal(response.status, 200); await response.arrayBuffer();
      const second = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${fixtureKey}`, 'content-type': 'application/json' }, body: JSON.stringify(envelope) }); assert.equal(second.status, 409); await second.arrayBuffer();
      assert.equal(proxy.summary().requests, 1);
    } finally { await proxy.close(); }
  }); assert.equal(requests, 1);
});

test('JSON rewrite rechecks the one-MiB ceiling and cannot create an oversized provider request', async () => {
  let requests = 0;
  await withProvider((_req, res) => { requests++; reply(res, '{}'); }, async baseUrl => {
    const proxy = await createUsageProxy(new URL(baseUrl), 'openai-completions', fixtureKey, new AbortController().signal, { provider: 'deepseek', modelId: 'fixture' });
    const envelope = { model: 'fixture', stream: true, messages: [{ role: 'user', content: 'JSON' }], padding: '' }; const originalBytes = Buffer.byteLength(JSON.stringify(envelope)); envelope.padding = 'x'.repeat(1048576 - 10 - originalBytes);
    const body = JSON.stringify(envelope); assert.equal(Buffer.byteLength(body), 1048576 - 10);
    try { const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${fixtureKey}`, 'content-type': 'application/json' }, body }); assert.equal(response.status, 400); await response.arrayBuffer(); assert.equal(proxy.summary().requests, 0); }
    finally { await proxy.close(); }
  }); assert.equal(requests, 0);
});

test('provider 400 keeps the native request and fails once without retry or removing response_format', { timeout: 45_000 }, async () => {
  let requests = 0;
  await withProvider((_req, res, bytes) => { requests++; assert.deepEqual(JSON.parse(bytes.toString()).response_format, { type: 'json_object' }); res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Local fixture refuses JSON mode"}}'); }, async baseUrl => {
    await assert.rejects(runRole({ provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: fixtureKey }, systemText, userText, new AbortController().signal, undefined, limits), (error: unknown) => { assert.ok(error instanceof HarnessCallError); assert.equal(error.evidence.providerRequests?.requests, 1); assert.equal(error.evidence.providerRequests?.status, 400); assert.equal(error.evidence.inputTokens, null); assert.equal(error.evidence.providerRequests?.responseFormat?.evidence, 'wire-observed'); return true; });
  }); assert.equal(requests, 1);
});

test('malformed provider JSON stays byte-for-byte raw and the unchanged strict parser rejects it', { timeout: 45_000 }, async () => {
  const malformed = '{"reason":"unescaped "quote""}';
  await withProvider((_req, res) => reply(res, malformed), async baseUrl => { const result = await runRole({ provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: fixtureKey }, systemText, userText, new AbortController().signal, undefined, limits); assert.equal(result.text, malformed); assert.equal(result.usageReported, true); assert.throws(() => JSON.parse(result.text)); });
});

test('empty and length replies remain failures with intact raw output and observed wire usage', { timeout: 60_000 }, async () => {
  for (const [text, finish] of [['', 'stop'], ['{"partial":', 'length']]) await withProvider((_req, res) => reply(res, text, finish), async baseUrl => { await assert.rejects(runRole({ provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: fixtureKey }, systemText, userText, new AbortController().signal, undefined, limits), (error: unknown) => { assert.ok(error instanceof HarnessCallError); assert.equal(error.evidence.text, text); assert.equal(error.evidence.providerRequests?.inputTokens, 13); assert.equal(error.evidence.providerRequests?.outputTokens, 7); assert.equal(error.evidence.providerRequests?.requests, 1);
    // The existing adapter can omit an empty assistant message. Keep aggregate
    // usage unknown when its normalized cross-check is absent, never infer zero.
    assert.equal(error.evidence.inputTokens, text ? 13 : null); assert.equal(error.evidence.outputTokens, text ? 7 : null); return true; }); });
});

test('JSON-mode cancellation closes the provider stream and carries unknown usage rather than zero', { timeout: 45_000 }, async () => {
  const controller = new AbortController(); let closed = false;
  await withProvider((_req, res, bytes) => { assert.deepEqual(JSON.parse(bytes.toString()).response_format, { type: 'json_object' }); res.on('close', () => { closed = true; }); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); setTimeout(() => controller.abort(), 20); }, async baseUrl => {
    await assert.rejects(runRole({ provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: fixtureKey }, systemText, userText, controller.signal, undefined, limits), (error: unknown) => { assert.ok(error instanceof HarnessCallError); assert.equal(error.name, 'AbortError'); assert.equal(error.evidence.providerRequests?.requests, 1); assert.equal(error.evidence.inputTokens, null); assert.equal(error.evidence.outputTokens, null); return true; });
    const deadline = Date.now() + 1000; while (!closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(closed, true);
  });
});
