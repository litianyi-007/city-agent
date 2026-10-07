import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { RoleModelConfig } from '../harness';
import { compileAnswerContract, type AnswerContract } from '../../shared/answer-contract';
import { fingerprint } from '../../shared/evidence';
import { containsKnownSecret } from '../../shared/redaction';
import { createResponsesStreamWitness } from './responses-stream.mjs';

export const RESPONSES_REQUEST_VERSION = 'frozen-responses-request-1.0';
export const RESPONSES_RELAY_VERSION = 'frozen-responses-relay-1.0';
export const RESPONSES_INPUT_ENVELOPE_TOKENS = 1024;
export const RESPONSES_UPSTREAM_URL = 'https://api.deepseek.com/v1/responses';
const MAX_BODY_BYTES = 512_000;
const MAX_RESPONSE_BYTES = 512_000;
const REQUEST_TIMEOUT_MS = 90_000;
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));

export interface FrozenResponsesRequest {
  version: typeof RESPONSES_REQUEST_VERSION;
  body: string;
  bodySha256: string;
  schemaHash: string;
  system: string;
  user: string;
  modelId: string;
  maxOutputTokens: number;
  bodyUtf8Bytes: number;
}

function registeredModel(input: RoleModelConfig): RoleModelConfig {
  if (!record(input) || Object.keys(input).some(key => !['provider', 'baseUrl', 'modelId', 'apiKey', 'temperature'].includes(key))
    || input.provider !== 'deepseek' || !['https://api.deepseek.com', 'https://api.deepseek.com/'].includes(input.baseUrl)
    || input.modelId !== 'deepseek-flash' || typeof input.apiKey !== 'string' || !/^[\x21-\x7e]{1,8000}$/.test(input.apiKey)
    || input.temperature !== undefined) throw new Error('Responses候选只允许已登记的官方DeepSeek Flash配置和非空凭据，不支持temperature。');
  return { provider: input.provider, baseUrl: 'https://api.deepseek.com', modelId: input.modelId, apiKey: input.apiKey };
}

function outputCap(value: number): void {
  if (!Number.isSafeInteger(value) || value < 128 || value > 12_000) throw new Error('Responses输出上限必须是128至12000的安全整数。');
}

function payloadFor(modelId: string, system: string, user: string, schema: Record<string, unknown>, maxOutputTokens: number) {
  return { model: modelId, input: [{ role: 'system', content: [{ type: 'input_text', text: system }] }, { role: 'user', content: [{ type: 'input_text', text: user }] }],
    stream: true, max_output_tokens: maxOutputTokens, store: false, tools: [], tool_choice: 'none',
    text: { format: { type: 'json_schema', name: 'resident_answers', schema } }, reasoning: { effort: 'none' } };
}

/** Freeze the complete wire, including every question, before a budget is reserved. */
export function compileResponsesRequest(input: { model: RoleModelConfig; system: string; user: string; contract: AnswerContract; maxOutputTokens: number }): FrozenResponsesRequest {
  if (!exactKeys(input, ['model', 'system', 'user', 'contract', 'maxOutputTokens'])) throw new Error('Responses编译拒绝未登记选项。');
  const model = registeredModel(input.model); outputCap(input.maxOutputTokens);
  if (typeof input.system !== 'string' || typeof input.user !== 'string' || !input.system.trim() || !input.user.trim()) throw new Error('Responses必须绑定明确的system/user输入。');
  const contract = structuredClone(input.contract);
  const expected = compileAnswerContract(contract.task, contract.residentId, contract.rules);
  if (contract.version !== expected.version || contract.taskHash !== fingerprint(contract.task) || contract.rulesHash !== fingerprint(contract.rules)
    || contract.schemaHash !== fingerprint(contract.schema) || expected.schemaHash !== contract.schemaHash) throw new Error('Responses冻结答卷契约发生漂移。');
  const body = JSON.stringify(payloadFor(model.modelId, input.system, input.user, expected.schema, input.maxOutputTokens));
  const bodyUtf8Bytes = Buffer.byteLength(body);
  if (bodyUtf8Bytes > MAX_BODY_BYTES) throw new Error('Responses完整请求超过512KB。');
  if (containsKnownSecret(body, model.apiKey)) throw new Error('Responses输入包含配置凭据；禁止冻结、监听和转发。');
  return Object.freeze({ version: RESPONSES_REQUEST_VERSION, body, bodySha256: sha256(body), schemaHash: expected.schemaHash,
    system: input.system, user: input.user, modelId: model.modelId, maxOutputTokens: input.maxOutputTokens, bodyUtf8Bytes });
}

/** Only compiler-shaped, byte-identical bodies can reach the fixed upstream. */
function validateFrozen(input: FrozenResponsesRequest, model: RoleModelConfig): FrozenResponsesRequest {
  if (!exactKeys(input, ['version', 'body', 'bodySha256', 'schemaHash', 'system', 'user', 'modelId', 'maxOutputTokens', 'bodyUtf8Bytes'])
    || input.version !== RESPONSES_REQUEST_VERSION || typeof input.body !== 'string' || typeof input.system !== 'string' || !input.system.trim()
    || typeof input.user !== 'string' || !input.user.trim() || input.modelId !== model.modelId) throw new Error('Responses冻结请求字段不匹配。');
  outputCap(input.maxOutputTokens);
  const bytes = Buffer.byteLength(input.body);
  if (bytes > MAX_BODY_BYTES || input.bodyUtf8Bytes !== bytes || input.bodySha256 !== sha256(input.body)
    || containsKnownSecret(input.body, model.apiKey)) throw new Error('Responses完整请求hash、大小或私密性检查失败。');
  let payload: unknown;
  try { payload = JSON.parse(input.body); } catch { throw new Error('Responses冻结请求不是合法JSON。'); }
  if (!exactKeys(payload, ['model', 'input', 'stream', 'max_output_tokens', 'store', 'tools', 'tool_choice', 'text', 'reasoning'])
    || !exactKeys(payload.text, ['format']) || !exactKeys(payload.text.format, ['type', 'name', 'schema']) || !record(payload.text.format.schema)
    || fingerprint(payload.text.format.schema) !== input.schemaHash
    || JSON.stringify(payloadFor(model.modelId, input.system, input.user, payload.text.format.schema, input.maxOutputTokens)) !== input.body) throw new Error('Responses冻结完整wire不符合唯一注册结构。');
  return Object.freeze({ ...input });
}

/** Race injected transports too: an implementation ignoring AbortSignal cannot hold shutdown hostage. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(new Error('Responses operation cancelled.')); }
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new Error('Responses operation cancelled.')); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, () => {
      signal.removeEventListener('abort', onAbort); reject(new Error('Responses transport failed.'));
    });
  });
}

/** Candidate only; no default application route imports or activates this relay. */
export async function createResponsesRelay(input: { model: RoleModelConfig; frozenRequest: FrozenResponsesRequest; reservedInputTokens: number;
  signal?: AbortSignal; upstreamFetch?: typeof fetch }) {
  if (!record(input) || Object.keys(input).some(key => !['model', 'frozenRequest', 'reservedInputTokens', 'signal', 'upstreamFetch'].includes(key))) throw new Error('Responses relay拒绝未登记选项。');
  const model = registeredModel(input.model), frozen = validateFrozen(input.frozenRequest, model);
  if (!Number.isSafeInteger(input.reservedInputTokens) || input.reservedInputTokens < RESPONSES_INPUT_ENVELOPE_TOKENS || input.reservedInputTokens > 16_000_000
    || frozen.bodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS > input.reservedInputTokens) throw new Error('Responses完整wire及envelope超出持久预算预留；禁止监听和转发。');
  if (input.signal?.aborted) throw new Error('Responses relay在监听前已取消。');
  const upstreamFetch = input.upstreamFetch ?? fetch, reservedInputTokens = input.reservedInputTokens;
  const relayToken = randomUUID(), cancellation = new AbortController();
  const signal = input.signal ? AbortSignal.any([cancellation.signal, input.signal]) : cancellation.signal;
  const witness = createResponsesStreamWitness({ expectedModel: model.modelId, maxBytes: MAX_RESPONSE_BYTES });
  let witnessOverride: { state: 'invalid' | 'transport-failed'; reason: string } | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, closed = false, closePromise: Promise<void> | undefined;
  const tasks = new Set<Promise<void>>();
  const stats = { relayVersion: RESPONSES_RELAY_VERSION, requestAttempts: 0, forwardedRequests: 0, deniedRequests: 0,
    receivedBodyUtf8Bytes: 0, bodyUtf8Bytes: frozen.bodyUtf8Bytes, frozenBodySha256: frozen.bodySha256, forwardedBodySha256: null as string | null,
    schemaHash: frozen.schemaHash, providerStatus: null as number | null, responseUtf8Bytes: 0, maxOutputTokens: frozen.maxOutputTokens };
  const providerWitness = () => {
    const { text: _privateText, responseId: _privateResponseId, ...safe } = witness.snapshot();
    const safeIdentity = { ...safe, responseIdSha256: _privateResponseId === null ? null : sha256(_privateResponseId) };
    return witnessOverride ? { ...safeIdentity, ...witnessOverride, usage: null } : safeIdentity;
  };
  const server = createServer((request, response) => {
    // Synchronous claim: malformed, unauthorized and concurrent requests all consume this invocation.
    stats.requestAttempts++;
    const attempt = stats.requestAttempts;
    const task = (async () => {
      const deny = () => { stats.deniedRequests++; request.resume(); if (!response.destroyed) response.writeHead(409, { 'content-type': 'application/json' }).end('{"error":"Registered Responses invocation denied; no retry."}'); };
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const onClientAbort = () => cancellation.abort();
      request.once('aborted', onClientAbort);
      response.once('close', () => { if (!response.writableEnded && stats.forwardedRequests) cancellation.abort(); });
      try {
        if (closed || requestSignal.aborted || attempt !== 1 || request.method !== 'POST' || request.url !== '/v1/responses'
          || request.headers.authorization !== `Bearer ${relayToken}`) { deny(); return; }
        const chunks: Buffer[] = [], iterator = request[Symbol.asyncIterator]();
        while (true) {
          const part = await abortable(iterator.next(), requestSignal); if (part.done) break;
          const bytes = Buffer.from(part.value); stats.receivedBodyUtf8Bytes += bytes.length;
          if (stats.receivedBodyUtf8Bytes > MAX_BODY_BYTES || stats.receivedBodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS > reservedInputTokens) { deny(); return; }
          chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks);
        // Raw byte equality excludes duplicate keys, escaped aliases, whitespace and semantic drift alike.
        if (stats.deniedRequests || stats.requestAttempts !== 1 || !bytes.equals(Buffer.from(frozen.body))) { deny(); return; }
        if (requestSignal.aborted) throw new Error('Responses operation cancelled.');
        stats.forwardedRequests++; stats.forwardedBodySha256 = frozen.bodySha256;
        const upstream = await abortable(upstreamFetch(RESPONSES_UPSTREAM_URL, { method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` }, body: frozen.body, signal: requestSignal }).then(result => {
          if (requestSignal.aborted) void result.body?.cancel().catch(() => {});
          return result;
        }), requestSignal);
        stats.providerStatus = upstream.status;
        const acceptedHttp = upstream.ok && upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream';
        const rawChunks: Buffer[] = [];
        if (upstream.body) {
          reader = upstream.body.getReader();
          while (true) {
            const part = await abortable(reader.read(), requestSignal); if (part.done) break;
            stats.responseUtf8Bytes += part.value.byteLength;
            if (stats.responseUtf8Bytes > MAX_RESPONSE_BYTES) { witness.observe(part.value); witnessOverride = { state: 'invalid', reason: 'response-size-limit' }; throw new Error('Response limit exceeded.'); }
            const chunk = Buffer.from(part.value); rawChunks.push(chunk); witness.observe(chunk);
          }
        }
        witness.complete();
        if (!acceptedHttp) witnessOverride = { state: 'invalid', reason: upstream.ok ? 'unsupported-provider-response' : 'provider-http-error' };
        const raw = Buffer.concat(rawChunks);
        if (containsKnownSecret(new TextDecoder('utf-8', { fatal: true }).decode(raw), model.apiKey)) witnessOverride = { state: 'invalid', reason: 'provider-secret-echo' };
        if (stats.requestAttempts !== 1 || stats.deniedRequests) witnessOverride = { state: 'invalid', reason: 'invocation-policy-violated' };
        if (providerWitness().state !== 'reported' || requestSignal.aborted) throw new Error('Provider evidence rejected.');
        // No byte of successful content is visible to the SDK before complete raw evidence is accepted.
        if (!response.destroyed) response.writeHead(200, { 'content-type': 'text/event-stream' }).end(raw);
      } catch {
        if (stats.forwardedRequests) {
          if (!witnessOverride && (providerWitness().state === 'pending' || requestSignal.aborted)) { witness.fail('provider-transport-failed'); witnessOverride = { state: 'transport-failed', reason: 'provider-transport-failed' }; }
          witness.complete();
        } else stats.deniedRequests++;
        if (!response.destroyed && !response.headersSent) response.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"Registered Responses request failed; no retry."}');
      } finally {
        request.removeListener('aborted', onClientAbort);
        if (reader) { const ownedReader = reader; reader = undefined; void ownedReader.cancel().catch(() => {}); }
      }
    })();
    tasks.add(task); void task.then(() => tasks.delete(task), () => tasks.delete(task));
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch { cancellation.abort(); server.closeAllConnections(); throw new Error('Responses relay监听失败。'); }
  const address = server.address();
  if (!address || typeof address === 'string') { cancellation.abort(); server.closeAllConnections(); server.close(); throw new Error('Responses relay监听失败。'); }
  return { baseUrl: `http://127.0.0.1:${address.port}`, relayToken, snapshot: () => {
    const safe = providerWitness(), text = witness.snapshot().text;
    return { ...stats, providerWitness: safe, responseTextSha256: safe.state === 'reported' && text !== null ? sha256(text) : null };
  }, close: () => {
    closePromise ??= (async () => {
      closed = true; cancellation.abort();
      if (reader) void reader.cancel().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => { if (!server.listening) { resolve(); return; } server.close(error => error ? reject(new Error('Responses relay关闭失败。')) : resolve()); });
      await Promise.allSettled([...tasks]);
    })();
    return closePromise;
  } };
}

export type ResponsesRelaySnapshot = ReturnType<Awaited<ReturnType<typeof createResponsesRelay>>['snapshot']>;
