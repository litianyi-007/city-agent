import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { RoleModelConfig } from '../harness';
import { createProviderUsageWitness } from './provider-usage-witness';

export const SINGLE_REQUEST_RELAY_VERSION = 'frozen-deepseek-wire-relay-2.0';
export const RELAY_INPUT_ENVELOPE_TOKENS = 1024;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

/** One invocation attempt and one frozen paid POST. All later requests are denied. */
export async function createSingleRequestRelay(input: { model: RoleModelConfig; maxOutputTokens: number; reservedInputTokens: number;
  /** Required at runtime. Optional typing keeps the frozen historical script inspectable, but it cannot open this new relay. */
  expectedPrompts?: { system: string; user: string }; upstreamFetch?: typeof fetch }) {
  const model = { ...input.model };
  const { maxOutputTokens, reservedInputTokens, upstreamFetch } = input;
  if (model.provider !== 'deepseek' || model.baseUrl.replace(/\/$/, '') !== 'https://api.deepseek.com' || model.modelId !== 'deepseek-flash') throw new Error('真实轮只允许已登记DeepSeek官方Flash配置。');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 12_000
    || !Number.isSafeInteger(reservedInputTokens) || reservedInputTokens < 1024 || reservedInputTokens > 16_000_000) throw new Error('单请求转发限额必须是有效安全整数。');
  if (!exactKeys(input.expectedPrompts, ['system', 'user']) || typeof input.expectedPrompts.system !== 'string' || typeof input.expectedPrompts.user !== 'string') throw new Error('受控转发2.0必须绑定已冻结system/user；历史无绑定调用不兼容且禁止转发。');
  const messages = [{ role: 'system', content: input.expectedPrompts.system }, { role: 'user', content: input.expectedPrompts.user }];
  const frozenPayload = { model: model.modelId, messages, max_tokens: maxOutputTokens, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } };
  const frozenBody = JSON.stringify(frozenPayload);
  const bodyUtf8Bytes = Buffer.byteLength(frozenBody);
  if (bodyUtf8Bytes > 512_000 || bodyUtf8Bytes + RELAY_INPUT_ENVELOPE_TOKENS > reservedInputTokens) throw new Error('冻结完整wire请求超出已预留输入限额；禁止监听和转发。');
  const stats = { relayVersion: SINGLE_REQUEST_RELAY_VERSION, requestAttempts: 0, forwardedRequests: 0, deniedRequests: 0, inputUtf8Bytes: 0,
    receivedBodyUtf8Bytes: 0, bodyUtf8Bytes, frozenBodySha256: sha256(frozenBody), forwardedBodySha256: null as string | null,
    providerStatus: null as number | null, maxOutputTokens };
  const usageWitness = createProviderUsageWitness();
  const cancellation = new AbortController();
  const server = createServer(async (request, response) => {
    const reject = () => { stats.deniedRequests++; response.writeHead(409).end('Registered single-request policy denied forwarding.'); };
    // Claim synchronously before reading even one byte; bad JSON/auth/path consumes the invocation too.
    stats.requestAttempts++;
    try {
      if (stats.requestAttempts !== 1 || request.method !== 'POST' || request.url !== '/chat/completions' || request.headers.authorization !== `Bearer ${model.apiKey}`) { reject(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += Buffer.byteLength(chunk); stats.receivedBodyUtf8Bytes = size;
        if (size > 512_000 || size + RELAY_INPUT_ENVELOPE_TOKENS > reservedInputTokens) { reject(); return; } chunks.push(Buffer.from(chunk)); }
      const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); const payload: unknown = JSON.parse(body);
      if (stats.deniedRequests || !exactKeys(payload, ['model', 'messages', 'max_tokens', 'stream', 'stream_options', 'thinking'])
        || payload.model !== model.modelId || payload.max_tokens !== maxOutputTokens || payload.stream !== true
        || !exactKeys(payload.stream_options, ['include_usage']) || payload.stream_options.include_usage !== true
        || !exactKeys(payload.thinking, ['type']) || payload.thinking.type !== 'disabled'
        || !Array.isArray(payload.messages) || payload.messages.length !== 2
        || payload.messages.some((message: unknown, index: number) => !exactKeys(message, ['role', 'content'])
          || message.role !== messages[index].role || message.content !== messages[index].content)) { reject(); return; }
      // Forward the frozen serialization, so field order, duplicates and whitespace never alter the paid body.
      stats.forwardedRequests++; stats.inputUtf8Bytes = Buffer.byteLength(JSON.stringify(messages)); stats.forwardedBodySha256 = stats.frozenBodySha256;
      const upstream = await (upstreamFetch ?? fetch)('https://api.deepseek.com/chat/completions', { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` }, body: frozenBody,
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]) });
      stats.providerStatus = upstream.status;
      const inspectUsage = upstream.ok && upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream';
      if (!inspectUsage) usageWitness.fail(upstream.ok ? 'unsupported-provider-response' : 'provider-http-error');
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      if (upstream.body) { const reader = upstream.body.getReader(); while (true) { const { value, done } = await reader.read(); if (done) break; if (inspectUsage) usageWitness.observe(value); response.write(value); } }
      if (inspectUsage) usageWitness.complete();
      response.end();
    } catch { if (stats.forwardedRequests) usageWitness.fail(); else stats.deniedRequests++;
      if (!response.headersSent) response.writeHead(502); response.end('Registered request failed; invocation consumed; no retry.'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('受控转发监听失败。');
  return { baseUrl: `http://127.0.0.1:${address.port}`, snapshot: () => ({ ...stats, providerUsageWitness: usageWitness.snapshot() }), close: async () => {
    cancellation.abort(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

export type SingleRequestRelaySnapshot = ReturnType<Awaited<ReturnType<typeof createSingleRequestRelay>>['snapshot']>;
