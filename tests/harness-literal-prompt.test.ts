import assert from 'node:assert/strict';
import { readdir, lstat, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { HARNESS_PROMPT_TRANSPORT_VERSION, runRole } from '../server/harness.ts';

const harnessRoot = fileURLToPath(new URL('../.city-agent-harness/', import.meta.url));
const systemText = '  中文系统约束\n{{particleCount}} {{cwd}} {{model}} {{unknown_variable}} {{UPPER}} {{a.b}} {{{nested}}} {{}} \\{{cwd}}\n{"template":"{{evil}}","__jsExpr":"throw new Error()"}\r\n尾部空白  ';
const userText = JSON.stringify({ brief: '用户原文 {{cwd}} {{model}} {{unknown_variable}} {{particleCount}} {{UPPER}} {{{nested}}} {{}} \\{{cwd}} 中文\n', data: { __jsExpr: 'process.env.SECRET', literal: '${NOT_A_TEMPLATE}' } });
const limits = { maxOutputTokens: 1024, timeoutMs: 90_000, reportUsage: true };

async function roleDirectories(): Promise<Set<string>> {
  try { return new Set((await readdir(harnessRoot)).filter(name => name.startsWith('role-'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set(); throw error; }
}

/** Only this fixture's non-secret prompt/model patch identifies ownership. */
async function fixtureDirectories(before: Set<string>, modelId: string): Promise<string[]> {
  const owned: string[] = [];
  for (const name of await roleDirectories()) {
    if (before.has(name)) continue;
    try {
      const patch: unknown = JSON.parse(await readFile(`${harnessRoot}/${name}/role.patch.yml`, 'utf8'));
      if (!Array.isArray(patch)) continue;
      const inserts = patch.flatMap(row => row && typeof row === 'object' && Array.isArray(row.insert) ? row.insert : []);
      const literal = inserts.find(row => row?.id === 'city-literal-prompt');
      const llm = inserts.find(row => row?.id === 'city-llm');
      if (literal?.config?.literalPrompt === systemText && llm?.config?.providers?.['city-agent']?.models?.[0]?.id === modelId) owned.push(name);
    } catch (error) {
      // Other parallel tests may be creating or already cleaning their patch.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  return owned;
}

async function withLocalProvider(
  handler: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => Promise<void> | void,
  run: (baseUrl: string) => Promise<void>,
) {
  let handlerError: unknown;
  const server = createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      await handler(request, response, JSON.parse(text));
    } catch (error) {
      handlerError = error;
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Free local fixture failure' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/v1`); if (handlerError) throw handlerError; }
  catch (error) { throw handlerError ?? error; }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function assertWire(body: Record<string, unknown>) {
  assert.deepEqual(body.messages, [{ role: 'system', content: systemText }, { role: 'user', content: userText }]);
  const messages = body.messages as Array<{ content: string }>;
  assert.deepEqual(Buffer.from(messages[0]!.content), Buffer.from(systemText));
  assert.deepEqual(Buffer.from(messages[1]!.content), Buffer.from(userText));
  assert.equal(body.tools, undefined);
  assert.equal(body.max_tokens, 1024);
}

function complete(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'literal fixture complete' }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7 } })}\n\n`);
  response.end('data: [DONE]\n\n');
}

test('official renderer preserves all literal variable-like text through one non-recursive registered value', async () => {
  assert.equal(HARNESS_PROMPT_TRANSPORT_VERSION, 'harness-literal-prompt-v1');
  const plugin = await import(new URL('../server/harness-literal-prompt.mjs', import.meta.url).href);
  let variableName = '';
  let value: (() => string) | undefined;
  plugin.apply({ systemPrompt: { variable: (name: string, provider: () => string) => { variableName = name; value = provider; } } }, { literalPrompt: systemText });
  assert.deepEqual(plugin.inject, ['systemPrompt']);
  assert.equal(variableName, 'city_agent_literal_prompt');
  assert.ok(value);
  const base = { contexts: [], tools: [], variables: { city_agent_literal_prompt: value(), cwd: 'DO_NOT_SUBSTITUTE', model: 'DO_NOT_SUBSTITUTE' } };
  assert.equal(renderPrompt({ ...base, sections: [{ name: 'deployment:persona-prefix', text: '{{city_agent_literal_prompt}}' }] }), systemText);
  assert.throws(() => renderPrompt({ ...base, sections: [{ name: 'deployment:persona-prefix', text: '{{particleCount}}' }] }), /malformed prompt variable/);
  assert.equal(renderPrompt({ ...base, sections: [{ name: 'deployment:persona-prefix', text: '{{cwd}}' }] }), 'DO_NOT_SUBSTITUTE');
  assert.throws(() => plugin.apply({}, { literalPrompt: {}, extra: 'invalid' }), TypeError);
});

test('real SDK and wire observer preserve exact system/user bytes, disabled tools, known usage and workspace cleanup', { timeout: 45_000 }, async () => {
  const before = await roleDirectories();
  const ownedDirectories = new Set<string>();
  let posts = 0;
  await withLocalProvider(async (request, response, body) => {
    posts++;
    assert.equal(request.url, '/v1/chat/completions');
    assertWire(body);
    for (const name of await fixtureDirectories(before, 'literal-transport-fixture')) ownedDirectories.add(name);
    complete(response);
  }, async baseUrl => {
    const result = await runRole({ provider: 'openai-compatible', baseUrl, modelId: 'literal-transport-fixture', apiKey: 'synthetic-literal-transport-key' }, systemText, userText, new AbortController().signal, undefined, limits);
    assert.equal(result.text, 'literal fixture complete');
    assert.equal(result.usageReported, true);
    assert.equal(result.inputTokens, 13);
    assert.equal(result.outputTokens, 7);
    assert.equal(result.providerRequests?.requests, 1);
    assert.equal(result.providerRequests?.deniedRequests, 0);
  });
  assert.equal(posts, 1);
  assert.ok(ownedDirectories.size >= 1);
  for (const name of ownedDirectories) await assert.rejects(lstat(`${harnessRoot}/${name}`), { code: 'ENOENT' });
});

test('literal prompt transport keeps real SDK cancellation, provider abort and ephemeral cleanup unchanged', { timeout: 45_000 }, async () => {
  const before = await roleDirectories();
  const ownedDirectories = new Set<string>();
  const controller = new AbortController();
  let closed = false;
  let posts = 0;
  await withLocalProvider(async (_request, response, body) => {
    posts++;
    assertWire(body);
    for (const name of await fixtureDirectories(before, 'literal-cancel-fixture')) ownedDirectories.add(name);
    response.on('close', () => { closed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': free local pending fixture\n\n');
    setTimeout(() => controller.abort(), 50);
  }, async baseUrl => {
    await assert.rejects(runRole({ provider: 'openai-compatible', baseUrl, modelId: 'literal-cancel-fixture', apiKey: 'synthetic-literal-cancel-key' }, systemText, userText, controller.signal, undefined, limits), (error: any) => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.evidence.providerRequests.requests, 1);
      assert.equal(error.evidence.inputTokens, null);
      assert.equal(error.evidence.outputTokens, null);
      return true;
    });
    const deadline = Date.now() + 1000;
    while (!closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(closed, true);
  });
  assert.equal(posts, 1);
  assert.ok(ownedDirectories.size >= 1);
  for (const name of ownedDirectories) await assert.rejects(lstat(`${harnessRoot}/${name}`), { code: 'ENOENT' });
});
