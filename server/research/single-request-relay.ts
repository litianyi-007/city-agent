import { createServer } from 'node:http';
import type { RoleModelConfig } from '../harness';

/** One paid upstream POST only. Extra Harness steps/redirects/retries are denied before forwarding. */
export async function createSingleRequestRelay(input: { model: RoleModelConfig; maxOutputTokens: number; reservedInputTokens: number; upstreamFetch?: typeof fetch }) {
  if (input.model.provider !== 'deepseek' || input.model.baseUrl.replace(/\/$/, '') !== 'https://api.deepseek.com' || input.model.modelId !== 'deepseek-flash') throw new Error('真实轮只允许已登记DeepSeek官方Flash配置。');
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 128 || input.maxOutputTokens > 12_000
    || !Number.isSafeInteger(input.reservedInputTokens) || input.reservedInputTokens < 1024 || input.reservedInputTokens > 16_000_000) throw new Error('单请求转发限额必须是有效安全整数。');
  const stats = { forwardedRequests: 0, deniedRequests: 0, inputUtf8Bytes: 0, providerStatus: null as number | null, maxOutputTokens: input.maxOutputTokens };
  const cancellation = new AbortController();
  const server = createServer(async (request, response) => {
    const reject = () => { stats.deniedRequests++; response.writeHead(409).end('Registered single-request policy denied forwarding.'); };
    try {
      if (request.method !== 'POST' || request.url !== '/chat/completions' || stats.forwardedRequests || request.headers.authorization !== `Bearer ${input.model.apiKey}`) { reject(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > 512_000) { reject(); return; } chunks.push(Buffer.from(chunk)); }
      const body = Buffer.concat(chunks).toString('utf8'); const payload = JSON.parse(body);
      const text = JSON.stringify(payload.messages);
      const ceiling = payload.max_tokens;
      const allowed = ['model', 'messages', 'max_tokens', 'stream', 'stream_options', 'thinking'];
      if (stats.forwardedRequests || Object.keys(payload).some(key => !allowed.includes(key))
        || payload.model !== input.model.modelId || !Number.isInteger(ceiling) || ceiling > input.maxOutputTokens || ceiling < 1
        || !Array.isArray(payload.messages) || payload.messages.some((message: any) => !['system', 'user'].includes(message.role) || typeof message.content !== 'string')
        || payload.messages.length !== 2 || payload.messages[0].role !== 'system' || payload.messages[1].role !== 'user'
        || payload.tools?.length || payload.thinking?.type !== 'disabled' || Buffer.byteLength(text) + 1024 > input.reservedInputTokens) { reject(); return; }
      stats.forwardedRequests++; stats.inputUtf8Bytes = Buffer.byteLength(text);
      const upstream = await (input.upstreamFetch ?? fetch)('https://api.deepseek.com/chat/completions', { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.model.apiKey}` }, body,
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(90_000)]) });
      stats.providerStatus = upstream.status;
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      if (upstream.body) { const reader = upstream.body.getReader(); while (true) { const { value, done } = await reader.read(); if (done) break; response.write(value); } }
      response.end();
    } catch { if (!response.headersSent) response.writeHead(502); response.end('Registered upstream request failed; no retry.'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('受控转发监听失败。');
  return { baseUrl: `http://127.0.0.1:${address.port}`, snapshot: () => ({ ...stats }), close: async () => {
    cancellation.abort(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
