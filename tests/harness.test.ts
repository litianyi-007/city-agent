import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { HARNESS_NAME, runRole } from '../server/harness.ts';

async function withProvider(
  handler: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => void,
  check: (baseUrl: string) => Promise<void>,
) {
  let handlerFailure: unknown;
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    try { handler(request, response, JSON.parse(text || '{}')); }
    catch (error) {
      handlerFailure = error;
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Local provider fixture rejected the request' } }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await check(`http://127.0.0.1:${address.port}/v1`);
    if (handlerFailure) throw handlerFailure;
  } catch (error) { throw handlerFailure ?? error; }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function complete(response: ServerResponse, text: string) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } } },
  ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end('data: [DONE]\n\n');
}

test('DeepSeek wire explicitly disables thinking and truncation preserves reported usage', { timeout: 45_000 }, async () => {
  await withProvider((_request, response, body) => {
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.max_tokens, 3000);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '{"partial":' }, index: 0, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'length' }], usage: { prompt_tokens: 13, completion_tokens: 3000, total_tokens: 3013 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  }, async baseUrl => {
    await assert.rejects(runRole({ provider: 'deepseek', baseUrl, modelId: 'deepseek-flash', apiKey: 'truncate-test-key' }, 'Return JSON.', 'test', new AbortController().signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true }), (error: any) => {
      assert.equal(error.evidence.inputTokens, 13); assert.equal(error.evidence.outputTokens, 3000);
      assert.match(error.evidence.text, /partial/); assert.match(error.message, /max-tokens/);
      return true;
    });
  });
});

test('real DeepSeek Harness SDK routes roles, keys, prompts and usage with zero host tools', { timeout: 45_000 }, async () => {
  const requests: Record<string, unknown>[] = [];
  const keys: unknown[] = [];
  await withProvider((request, response, body) => {
    assert.equal(request.url, '/v1/chat/completions');
    requests.push(body);
    keys.push(request.headers.authorization);
    complete(response, '{"accepted":true}');
  }, async (baseUrl) => {
    for (const role of ['product', 'research']) {
      const result = await runRole({ provider: 'openai-compatible', baseUrl, modelId: `${role}-model`, apiKey: `${role}-test-key` },
        `You are ${role}. Return JSON.`, `Task for ${role}`, new AbortController().signal);
      assert.deepEqual(result, { text: '{"accepted":true}', inputTokens: 13, outputTokens: 7, harness: HARNESS_NAME });
    }
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(keys, ['Bearer product-test-key', 'Bearer research-test-key']);
  for (const [index, role] of ['product', 'research'].entries()) {
    const request = requests[index]!;
    assert.equal(request.model, `${role}-model`);
    assert.equal(request.tools, undefined);
    assert.equal(request.max_tokens, 12_000);
    assert.deepEqual(request.messages, [
      { role: 'system', content: `You are ${role}. Return JSON.` },
      { role: 'user', content: `Task for ${role}` },
    ]);
  }
});

test('cancelling a role closes the real Harness provider connection', { timeout: 45_000 }, async () => {
  const controller = new AbortController();
  let connectionClosed = false;
  await withProvider((_request, response) => {
    response.on('close', () => { connectionClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': waiting\n\n');
    setTimeout(() => controller.abort(), 50);
  }, async (baseUrl) => {
    await assert.rejects(runRole({ provider: 'openai-compatible', baseUrl, modelId: 'test-model', apiKey: 'cancel-key' },
      'Return JSON.', 'Wait for result', controller.signal), { name: 'AbortError' });
    assert.equal(connectionClosed, true);
  });
});

test('provider errors fail the run and never expose the key', { timeout: 45_000 }, async () => {
  let calls = 0;
  await withProvider((_request, response) => {
    calls++;
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Invalid secret-should-not-leak', type: 'authentication_error' } }));
  }, async (baseUrl) => {
    await assert.rejects(runRole({ provider: 'openai-compatible', baseUrl, modelId: 'test-model', apiKey: 'secret-should-not-leak' },
      'Return JSON.', 'test', new AbortController().signal), (error: Error) => {
      assert.equal(error.message.includes('secret-should-not-leak'), false);
      assert.match(error.message, /未完成|401|authentication|Invalid/);
      return true;
    });
  });
  assert.equal(calls, 1);
});

test('Anthropic native messages protocol uses its own endpoint, key and SSE usage', { timeout: 45_000 }, async () => {
  await withProvider((request, response, body) => {
    assert.equal(new URL(request.url ?? '/', 'http://test').pathname, '/v1/messages');
    assert.equal(request.headers['x-api-key'], 'anthropic-test-key');
    assert.equal(body.model, 'custom-claude-model');
    assert.equal(body.tools, undefined);
    assert.equal(body.max_tokens, 12_000);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'custom-claude-model', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"native":true}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  }, async (baseUrl) => {
    const result = await runRole({ provider: 'anthropic', baseUrl: baseUrl.replace(/\/v1$/, ''), modelId: 'custom-claude-model', apiKey: 'anthropic-test-key' },
      'Return JSON.', 'test', new AbortController().signal);
    assert.equal(result.text, '{"native":true}');
    assert.equal(result.inputTokens, 11);
    assert.equal(result.outputTokens, 5);
  });
});

test('local Harness fixture masks escaped credentials in outbound prompts, complete JSON and failed partial evidence', { timeout: 45_000 }, async () => {
  const key = 'harness-private-AbC123';
  const encoded = key.split('').map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  let calls = 0;
  await withProvider((request, response, body) => {
    calls++;
    assert.equal(request.headers.authorization, `Bearer ${key}`);
    const messages = body.messages as { role: string; content: string }[];
    assert.equal(messages[0].content, 'System [REDACTED]');
    assert.equal(JSON.parse(messages[1].content).description, '[REDACTED]');
    if (calls === 1) complete(response, `{"answers":[{"value":"${encoded}"}],"${encoded}":"object key"}`);
    else {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `{"unfinished":"${encoded}` }, index: 0, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'length' }], usage: { prompt_tokens: 13, completion_tokens: 3000 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    }
  }, async baseUrl => {
    const config = { provider: 'openai-compatible', baseUrl, modelId: 'redaction-local-fixture', apiKey: key };
    const result = await runRole(config, `System ${encoded}`, `{"description":"${encoded}"}`, new AbortController().signal);
    assert.deepEqual(JSON.parse(result.text), { answers: [{ value: '[REDACTED]' }], '[REDACTED]': 'object key' });
    await assert.rejects(runRole(config, `System ${key}`, `{"description":"${encoded}"}`, new AbortController().signal), (error: unknown) => {
      const failure = error as Error & { evidence: { text: string; inputTokens: number; outputTokens: number } };
      assert.ok(failure.evidence.text.includes('[REDACTED]'));
      assert.ok(!failure.evidence.text.includes(key));
      assert.ok(!failure.evidence.text.includes(encoded));
      assert.equal(failure.evidence.inputTokens, 13);
      assert.equal(failure.evidence.outputTokens, 3000);
      return true;
    });
  });
  assert.equal(calls, 2);
});
