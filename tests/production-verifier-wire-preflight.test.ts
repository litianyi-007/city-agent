import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureVerifierWirePreflight, prepareVerifierWirePreflight, type VerifierWireFixtureScenario } from '../server/production/verifier-wire-preflight.ts';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.ts';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.ts';
import { stream as piStream } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';

const options = { provider: 'deepseek' as const, upstreamBaseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', maxOutputTokens: 4096, timeoutMs: 30_000 };
const logical = { systemPrompt: 'JSON only. 中文 {{unknown}} {{cwd}} {{model}}\\{{}} "quotes"\r\n', userPrompt: 'Exact JSON candidates {{particleCount}}\n尾部空格  ' };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

test('all 18 complete candidate contexts fit exact pure wire reservation without truncation or private fields', () => {
  for (const id of VERIFIER_CHALLENGE_IDS) {
    const requests = verifierPreparationRequests(id); const prepared = prepareVerifierWirePreflight(requests.logicalLlm, options);
    assert.equal(prepared.logicalPromptSha256, requests.metadata.logicalLlmPromptSha256);
    assert.deepEqual(prepared.expectedBody.messages, [{ role: 'system', content: requests.logicalLlm.systemPrompt }, { role: 'user', content: requests.logicalLlm.userPrompt }]);
    assert.equal(prepared.reservation.inputTokens, prepared.expectedBodyBytes + 1024);
    assert.ok(prepared.reservation.inputTokens + options.maxOutputTokens < prepared.reservation.contextWindow);
    assert.equal(prepared.expectedBody.response_format.type, 'json_object'); assert.deepEqual(prepared.expectedBody.thinking, { type: 'disabled' });
    assert.equal(Object.hasOwn(prepared.expectedBody, 'tools'), false); assert.equal(Object.hasOwn(prepared.configuration, 'apiKey'), false);
    assert.match(prepared.reservation.method, /NOT a calibrated tokenizer/);
  }
});

test('preflight rejects unsupported sampling, keys, endpoints, limits and mutated envelopes before any SDK dispatch', () => {
  for (const field of ['temperature', 'topP', 'baseUrl', 'apiKey', 'retryPolicy', 'fetch']) assert.throws(() => prepareVerifierWirePreflight(logical, { ...options, [field]: 1 } as typeof options), /unsupported fields/);
  assert.throws(() => prepareVerifierWirePreflight({ ...logical, gold: 'bad' } as typeof logical, options), /unsupported fields/);
  for (const modelId of ['', 'x?y', ' model ', 'x'.repeat(201)]) assert.throws(() => prepareVerifierWirePreflight(logical, { ...options, modelId }), /model ID/);
  for (const maxOutputTokens of [127, 12001, NaN, 2048.5]) assert.throws(() => prepareVerifierWirePreflight(logical, { ...options, maxOutputTokens }), /limits/);
  assert.throws(() => prepareVerifierWirePreflight(logical, { ...options, provider: 'openai-compatible' } as unknown as typeof options), /explicit DeepSeek/);
  for (const upstreamBaseUrl of ['http://api.deepseek.com', 'https://user:password@api.deepseek.com', 'https://api.deepseek.com?key=hidden', 'https://api.deepseek.com/#secret', 'https://api.deepseek.com/']) assert.throws(() => prepareVerifierWirePreflight(logical, { ...options, upstreamBaseUrl }), /metadata/);
  assert.throws(() => prepareVerifierWirePreflight({ systemPrompt: 'x'.repeat(60000), userPrompt: 'JSON' }, options), /oversized/);
  assert.throws(() => prepareVerifierWirePreflight({ systemPrompt: 'JSON', userPrompt: '\\'.repeat(30000) }, { ...options, maxOutputTokens: 12000 }), /reservation exceeds/);
});

test('offline marker preserves official DeepSeek URL-derived pinned adapter body shape using in-memory fake fetch', async () => {
  const prepared = prepareVerifierWirePreflight(logical, options);
  const bodies: unknown[] = [];
  for (const baseUrl of [options.upstreamBaseUrl, `http://127.0.0.1:12345${prepared.offlineCompatibilityPath}`]) {
    const model: Model<'openai-completions'> = { id: options.modelId, name: options.modelId, api: 'openai-completions', provider: 'city-agent', baseUrl, reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: options.maxOutputTokens, compat: { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, thinkingFormat: 'deepseek' } };
    for await (const _event of piStream(model, { systemPrompt: logical.systemPrompt, messages: [{ role: 'user', content: logical.userPrompt, timestamp: 0 }] }, { apiKey: 'synthetic-memory-provider-not-a-real-key', sessionId: 'fixed', maxTokens: options.maxOutputTokens, maxRetries: 0, fetch: async (_request, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":13,"completion_tokens":7}}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    } })) { /* All provider requests intercepted in memory; no socket or fee. */ }
  }
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
  const { response_format: _format, ...expectedAdapterBody } = prepared.expectedBody;
  assert.deepEqual(bodies[0], expectedAdapterBody);
});

test('pinned SDK complete wire preserves full corpus prompts, native JSON, disabled thinking and per-session freshness', { timeout: 120_000 }, async () => {
  for (const id of ['H12', 'C17'] as const) {
    const requests = verifierPreparationRequests(id); const result = await captureVerifierWirePreflight(requests.logicalLlm, options);
    assert.equal(result.status, 'completed', JSON.stringify({ failure: result.failure, wireError: result.wireError }));
    assert.equal(result.wire?.validated, true); assert.equal(result.wire?.exactLiteralMessages, true);
    assert.equal(result.wire?.bodyCanonicalSha256, result.expectedBodyCanonicalSha256);
    assert.equal(result.wire?.bodySha256, sha(result.wire!.bodyUtf8));
    assert.equal(result.logicalPromptSha256, requests.metadata.logicalLlmPromptSha256);
    assert.equal(result.transport.localProviderPosts, 1); assert.equal(result.transport.externalProviderPosts, 0);
    assert.equal(result.transport.observedUsage?.requests, 1); assert.equal(result.transport.observedUsage?.responseFormat?.evidence, 'wire-observed');
    assert.equal(result.transport.fixtureServerClosed, true); assert.equal(result.transport.providerResponseDestroyedAfterCleanup, true);
    assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [13, 7]);
    assert.equal(result.usage.actualModelCost, null); assert.equal(JSON.stringify(result).includes('synthetic-verifier-preflight-token'), false);
  }
  const first = await captureVerifierWirePreflight(logical, options); const second = await captureVerifierWirePreflight(logical, options);
  assert.notEqual(first.invocationId, second.invocationId); assert.equal(first.wire?.bodySha256, second.wire?.bodySha256);
  assert.equal(first.transport.localProviderPosts, 1); assert.equal(second.transport.localProviderPosts, 1);
});

test('missing or partial usage is unknown, while explicit protocol-complete zero remains known', { timeout: 100_000 }, async () => {
  for (const scenario of ['missing-usage', 'partial-usage', 'zero-usage'] as VerifierWireFixtureScenario[]) {
    const result = await captureVerifierWirePreflight(logical, options, undefined, scenario);
    assert.equal(result.status, 'completed'); assert.equal(result.transport.localProviderPosts, 1); assert.equal(result.transport.observedUsage?.protocolComplete, true);
    assert.equal(result.usage.complete, scenario === 'zero-usage');
    assert.equal(result.usage.inputTokens, scenario === 'zero-usage' ? 0 : null); assert.equal(result.usage.outputTokens, scenario === 'zero-usage' ? 0 : null);
    assert.equal(result.usage.actualModelCost, null);
  }
});

test('HTTP refusal, half-cut stream, length and empty remain once-only failed attempts without manufactured usage', { timeout: 120_000 }, async () => {
  for (const scenario of ['http-refusal', 'header-halfcut', 'length', 'empty'] as VerifierWireFixtureScenario[]) {
    const result = await captureVerifierWirePreflight(logical, options, undefined, scenario);
    assert.equal(result.status, 'failed', scenario); assert.equal(result.transport.localProviderPosts, 1); assert.equal(result.transport.observedUsage?.requests, 1);
    assert.equal(result.transport.fixtureServerClosed, true); assert.equal(result.usage.actualModelCost, null);
    if (scenario === 'http-refusal' || scenario === 'header-halfcut' || scenario === 'empty') { assert.equal(result.usage.complete, false); assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.outputTokens, null); }
    if (scenario === 'length') { assert.equal(result.roleText, '{"partial":'); assert.equal(result.usage.complete, true); assert.equal(result.usage.inputTokens, 13); }
  }
});

test('cancellation actually closes provider connection before fixture force-close and cancels the SDK invocation', { timeout: 45_000 }, async () => {
  const result = await captureVerifierWirePreflight(logical, options, undefined, 'abort-after-request');
  assert.equal(result.status, 'cancelled'); assert.equal(result.failureName, 'AbortError'); assert.equal(result.transport.localProviderPosts, 1);
  assert.equal(result.transport.responseClosedBeforeCleanup, true); assert.equal(result.transport.providerResponseDestroyedAfterCleanup, true); assert.equal(result.transport.fixtureServerClosed, true);
  assert.equal(result.usage.complete, false); assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.outputTokens, null);
});

test('pre-aborted invocation is preserved as cancelled, creates no provider POST, and does not infer zero usage', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await captureVerifierWirePreflight(logical, options, controller.signal);
  assert.equal(result.status, 'cancelled'); assert.equal(result.transport.localProviderPosts, 0); assert.equal(result.wire, null); assert.equal(result.transport.observedUsage, null);
  assert.equal(result.transport.fixtureServerClosed, true); assert.equal(result.usage.inputTokens, null); assert.equal(result.usage.actualModelCost, null);
});
