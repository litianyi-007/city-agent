import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { HARNESS_JSON_OUTPUT_VERSION, HARNESS_PROMPT_TRANSPORT_VERSION, HARNESS_VERSION, HarnessCallError, runRole } from '../harness.js';
import { observerPathFor, USAGE_OBSERVER_VERSION, type ObservedUsage } from '../usage-observer.js';

export const VERIFIER_WIRE_PREFLIGHT_VERSION = 'verifier-wire-loopback-v1';
const FIXTURE_KEY = 'synthetic-verifier-preflight-token-not-a-real-key';
const CONTEXT_WINDOW = 65_536;
const RESERVATION_OVERHEAD = 1024;
const MAX_REQUEST_BYTES = 1_048_576;
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const exactKeys = (value: unknown, keys: string[], name: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${name}; unsupported fields are not silently ignored`);
};

export interface VerifierWireLogicalPrompt { systemPrompt: string; userPrompt: string; }
export interface VerifierWireOptions { provider: 'deepseek'; upstreamBaseUrl: string; modelId: string; maxOutputTokens: number; timeoutMs: number; }
export type VerifierWireFixtureScenario = 'success' | 'missing-usage' | 'zero-usage' | 'partial-usage' | 'header-halfcut' | 'http-refusal' | 'abort-after-request' | 'length' | 'empty';

/** Pure, credential-free expectation. The actual SDK wire must match it exactly.
 * This byte-based reservation is deliberately conservative engineering planning,
 * not a provider tokenizer/context guarantee or billed usage measurement. */
export function prepareVerifierWirePreflight(logical: VerifierWireLogicalPrompt, options: VerifierWireOptions) {
  exactKeys(logical, ['systemPrompt', 'userPrompt'], 'logical prompt');
  exactKeys(options, ['provider', 'upstreamBaseUrl', 'modelId', 'maxOutputTokens', 'timeoutMs'], 'wire options');
  if (typeof logical.systemPrompt !== 'string' || typeof logical.userPrompt !== 'string' || !logical.systemPrompt.trim() || !logical.userPrompt.trim() || Buffer.byteLength(`${logical.systemPrompt}\n${logical.userPrompt}`) > 60_000) throw new Error('Invalid or oversized literal logical prompt');
  if (options.provider !== 'deepseek' || typeof options.modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(options.modelId)) throw new Error('Wire preflight requires explicit DeepSeek provider and an exact safe model ID');
  if (typeof options.upstreamBaseUrl !== 'string') throw new Error('A public upstream Base URL is required only as compatibility metadata');
  const upstream = new URL(options.upstreamBaseUrl);
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash || options.upstreamBaseUrl !== upstream.toString().replace(/\/$/, '') || options.upstreamBaseUrl.length > 1000) throw new Error('Upstream metadata must be an exact normalized HTTPS Base URL without credentials, query or fragment');
  if (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 128 || options.maxOutputTokens > 12_000 || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 180_000) throw new Error('Invalid Harness wire limits');
  const expectedBody = {
    model: options.modelId,
    messages: [{ role: 'system', content: logical.systemPrompt }, { role: 'user', content: logical.userPrompt }],
    stream: true, stream_options: { include_usage: true }, max_tokens: options.maxOutputTokens,
    thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
  };
  const serialized = JSON.stringify(expectedBody);
  const bodyBytes = Buffer.byteLength(serialized);
  const reservedInputTokens = bodyBytes + RESERVATION_OVERHEAD;
  if (bodyBytes > MAX_REQUEST_BYTES || reservedInputTokens + options.maxOutputTokens > CONTEXT_WINDOW) throw new Error('Conservative request reservation exceeds the pinned Harness context window');
  return {
    version: VERIFIER_WIRE_PREFLIGHT_VERSION,
    executionSource: 'offline-sdk-loopback-fixture' as const,
    harnessVersion: HARNESS_VERSION, promptTransportVersion: HARNESS_PROMPT_TRANSPORT_VERSION,
    jsonOutputVersion: HARNESS_JSON_OUTPUT_VERSION, usageObserverVersion: USAGE_OBSERVER_VERSION,
    configuration: { ...options, contextWindow: CONTEXT_WINDOW, reasoningEffort: 'off', responseMode: 'json-object', maxProviderPostsPerInvocation: 1, retries: 0, tools: 'disabled', sampling: 'no configurable temperature; no sampling fields on expected wire' },
    offlineCompatibilityPath: observerPathFor(upstream),
    upstreamUrlSha256: hash(options.upstreamBaseUrl),
    logicalPromptSha256: hash(JSON.stringify({ systemPrompt: logical.systemPrompt, userPrompt: logical.userPrompt })),
    systemPromptUtf8Sha256: hash(logical.systemPrompt), userPromptUtf8Sha256: hash(logical.userPrompt),
    systemPromptUtf8Bytes: Buffer.byteLength(logical.systemPrompt), userPromptUtf8Bytes: Buffer.byteLength(logical.userPrompt),
    expectedBody, expectedBodyCanonicalSha256: hash(canonical(expectedBody)), expectedBodyBytes: bodyBytes,
    reservation: { inputTokens: reservedInputTokens, outputTokens: options.maxOutputTokens, overheadTokens: RESERVATION_OVERHEAD, contextWindow: CONTEXT_WINDOW, fits: true,
      method: 'complete serialized JSON UTF-8 bytes plus 1024 engineering overhead; NOT a calibrated tokenizer or provider guarantee' },
    evidenceBoundary: 'Actual pinned SDK wire to a loopback fake provider only; no real model response, provider authentication, measured model quality, billed usage, or paid-study authorization',
  };
}

function sendFixture(response: ServerResponse, scenario: VerifierWireFixtureScenario) {
  if (scenario === 'http-refusal') { response.writeHead(400, { 'content-type': 'application/json' }); response.end('{"error":{"message":"Offline fixture refuses the frozen JSON request"}}'); return; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (scenario === 'header-halfcut') { response.write('data: {"choices":'); response.end(); return; }
  if (scenario === 'abort-after-request') { response.write(': offline fixture pending\n\n'); return; }
  const text = scenario === 'empty' ? '' : scenario === 'length' ? '{"partial":' : '{"offlineFixture":true}';
  const usage = scenario === 'missing-usage' ? undefined : scenario === 'partial-usage' ? { prompt_tokens: 13 } : scenario === 'zero-usage' ? { prompt_tokens: 0, completion_tokens: 0 } : { prompt_tokens: 13, completion_tokens: 7 };
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: scenario === 'length' ? 'length' : 'stop' }], ...(usage ? { usage } : {}) })}\n\n`);
  response.end('data: [DONE]\n\n');
}

/** Free transport preflight: callers cannot provide a key, endpoint, fetch hook,
 * SDK replacement, or arbitrary server handler. Each invocation creates its own
 * SDK session and loopback provider. Public upstream URL is encoded in a LOCAL
 * path solely to preserve pinned pi-ai URL-substring compatibility detection;
 * it is never passed to fetch or used as a network destination. The full body is
 * retained but never headers or credentials. No live provider path is offered. */
export async function captureVerifierWirePreflight(logical: VerifierWireLogicalPrompt, options: VerifierWireOptions, signal: AbortSignal = new AbortController().signal, scenario: VerifierWireFixtureScenario = 'success') {
  const preparation = prepareVerifierWirePreflight(logical, options);
  if (!['success', 'missing-usage', 'zero-usage', 'partial-usage', 'header-halfcut', 'http-refusal', 'abort-after-request', 'length', 'empty'].includes(scenario)) throw new Error('Unknown offline fixture scenario');
  const invocationId = randomUUID(); const startedAt = new Date().toISOString(); const start = Date.now();
  const cancellation = new AbortController(); const combined = AbortSignal.any([signal, cancellation.signal]);
  let posts = 0; let rejectedRequests = 0; let receivedBody: string | null = null; let wireBody: Record<string, unknown> | null = null;
  let wireError: string | null = null; let responseClosed = false; let responseClosedBeforeCleanup = false;
  let observedUsage: ObservedUsage | null = null; let usageReported = false; let inputTokens: number | null = null; let outputTokens: number | null = null;
  let roleText: string | null = null; let failure: string | null = null; let failureName: string | null = null; let host = '';
  let providerResponse: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== `${preparation.offlineCompatibilityPath}/chat/completions` || request.headers.host !== host || request.headers.authorization !== `Bearer ${FIXTURE_KEY}` || posts >= 1) {
      rejectedRequests++; response.writeHead(403, { 'content-type': 'application/json' }); response.end('{"error":{"message":"Offline fixture request scope rejected"}}'); return;
    }
    posts++; providerResponse = response; response.once('close', () => { responseClosed = true; });
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > MAX_REQUEST_BYTES) throw new Error('Offline wire exceeds body limit'); chunks.push(buffer); }
      receivedBody = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      wireBody = JSON.parse(receivedBody) as Record<string, unknown>;
      exactKeys(wireBody, Object.keys(preparation.expectedBody), 'full SDK wire');
      if (canonical(wireBody) !== canonical(preparation.expectedBody)) throw new Error('Actual SDK full wire diverges from frozen expectation; no truncation, rewrite, added tools or unknown parameters allowed');
      if (receivedBody.includes(FIXTURE_KEY)) throw new Error('Credential found in request body');
      sendFixture(response, scenario);
      if (scenario === 'abort-after-request') cancellation.abort(new DOMException('Offline fixture cancellation', 'AbortError'));
    } catch (error) {
      wireError = error instanceof Error ? error.message : 'Offline fixture rejected wire';
      if (!response.headersSent) { response.writeHead(400, { 'content-type': 'application/json' }); response.end('{"error":{"message":"Offline fixture rejected full wire"}}'); } else response.destroy();
    }
  });
  server.maxConnections = 4; server.headersTimeout = 5000; server.requestTimeout = 15000;
  let listening = false;
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); listening = true;
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Loopback fixture address missing'); host = `127.0.0.1:${address.port}`;
    const result = await runRole({ provider: 'deepseek', baseUrl: `http://${host}${preparation.offlineCompatibilityPath}`, modelId: options.modelId, apiKey: FIXTURE_KEY }, logical.systemPrompt, logical.userPrompt, combined, undefined, { maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs, reportUsage: true, responseMode: 'json-object' });
    roleText = result.text; observedUsage = result.providerRequests ?? null;
    usageReported = result.usageReported === true; if (usageReported) { inputTokens = result.inputTokens; outputTokens = result.outputTokens; }
  } catch (error) {
    failureName = error instanceof Error ? error.name : 'Error'; failure = error instanceof Error ? error.message : 'Offline SDK preflight failed';
    if (error instanceof HarnessCallError) { observedUsage = error.evidence.providerRequests ?? null; roleText = error.evidence.text; inputTokens = error.evidence.inputTokens; outputTokens = error.evidence.outputTokens; usageReported = inputTokens !== null && outputTokens !== null && observedUsage?.complete === true; }
  } finally {
    // This flag is captured before our own force-close, so cancellation tests
    // cannot pass merely because fixture teardown killed the connection.
    responseClosedBeforeCleanup = responseClosed;
    server.closeAllConnections();
    if (listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  const capturedBody = wireBody as Record<string, unknown> | null;
  const capturedUtf8 = receivedBody as string | null;
  const wire = capturedUtf8 === null || capturedBody === null ? null : {
    body: capturedBody, bodyUtf8: capturedUtf8, bodySha256: hash(capturedUtf8), bodyBytes: Buffer.byteLength(capturedUtf8),
    bodyCanonicalSha256: hash(canonical(capturedBody)), validated: wireError === null,
    exactLiteralMessages: canonical(capturedBody.messages) === canonical(preparation.expectedBody.messages),
  };
  const status = combined.aborted ? 'cancelled' as const : failure || wireError ? 'failed' as const : 'completed' as const;
  return { ...preparation, invocationId, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - start, scenario, status,
    wire, wireError, failure, failureName, roleText,
    transport: { localProviderPosts: posts, rejectedLocalRequests: rejectedRequests, externalProviderPosts: 0, observedUsage,
      responseClosedBeforeCleanup, providerResponseDestroyedAfterCleanup: providerResponse?.destroyed ?? null, fixtureServerClosed: !server.listening },
    usage: { evidence: 'synthetic-loopback-response-not-model-usage' as const, complete: usageReported, inputTokens: usageReported ? inputTokens : null, outputTokens: usageReported ? outputTokens : null, actualModelInputTokens: null, actualModelOutputTokens: null, actualModelCost: null },
  };
}
