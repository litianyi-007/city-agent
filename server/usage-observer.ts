import { createServer, type IncomingMessage } from 'node:http';

export const USAGE_OBSERVER_VERSION = 'raw-wire-usage-v1';
/** Explicit control-plane request format; does not certify provider compliance. */
export const HARNESS_JSON_OUTPUT_VERSION = 'harness-json-output-v1';
export interface JsonOutputOptions { provider: 'deepseek'; modelId: string; }
export interface ObservedResponseFormat { version: typeof HARNESS_JSON_OUTPUT_VERSION; mode: 'json-object'; evidence: 'requested' | 'wire-observed'; }
/** Preserve pinned pi-ai 0.85.1 domain-substring compat detection without DNS tricks. */
export function observerPathFor(upstream: URL) { return `/__city_agent_usage/${encodeURIComponent(upstream.toString().replace(/\/$/, ''))}${upstream.pathname.replace(/\/$/, '')}`; }
export interface ObservedUsage { requests: number; deniedRequests: number; status: number | null; transportComplete: boolean; httpEof: boolean; protocolComplete: boolean; inputReported: boolean; outputReported: boolean; inputTokens: number | null; outputTokens: number | null; complete: boolean; responseFormat?: ObservedResponseFormat; }
const finiteToken = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** No arbitrary sampling dictionary, prompt rewrite, output repair or tool enabling. */
function jsonOutputPayload(payload: Buffer, options: JsonOutputOptions): Buffer<ArrayBuffer> {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  const value: unknown = JSON.parse(decoded); const object = record(value);
  if (!object || Object.getPrototypeOf(object) !== Object.prototype || object.model !== options.modelId || object.stream !== true || !Array.isArray(object.messages) || object.messages.length === 0) throw new Error('JSON output request envelope rejected');
  for (const name of ['tools', 'tool_choice', 'functions', 'function_call']) if (own(object, name)) throw new Error('JSON output requests cannot enable tools');
  for (const message of object.messages) {
    const item = record(message);
    if (!item || typeof item.role !== 'string' || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || ['tool_calls', 'tool_call_id', 'function_call'].some(name => own(item, name))) throw new Error('JSON output message envelope rejected');
  }
  if (own(object, 'response_format')) {
    const format = record(object.response_format);
    if (!format || Object.keys(format).length !== 1 || format.type !== 'json_object') throw new Error('Conflicting JSON response format rejected');
  }
  // Reject non-finite JSON numbers rather than silently converting them to null.
  const serialized = JSON.stringify({ ...object, response_format: { type: 'json_object' } }, (_key, current) => { if (typeof current === 'number' && !Number.isFinite(current)) throw new Error('Non-finite JSON request number rejected'); return current; });
  const rewritten = Buffer.from(serialized, 'utf8');
  if (rewritten.byteLength > 1048576) throw new Error('JSON output request exceeds controlled limit after rewrite');
  return rewritten;
}

/** Raw-wire presence tracking, not SDK-normalized zero-filled usage. No body is retained. */
export class WireUsageObserver {
  private input: number | null = null;
  private output: number | null = null;
  private inputPresent = false;
  private outputPresent = false;
  private parserValid = true;
  private buffer = '';
  private ended = false;
  private anthropicComponents: Record<string, number | null> = { input_tokens: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  constructor(private protocol: 'openai-completions' | 'anthropic-messages') {}
  observe(value: unknown) {
    const event = record(value); if (!event) return;
    if (this.protocol === 'anthropic-messages' && event.type === 'message_stop') { this.ended = true; return; }
    if (this.protocol === 'openai-completions') {
      const choices = Array.isArray(event.choices) ? event.choices : [];
      const usages = [event.usage, ...choices.map(choice => record(choice)?.usage)].filter(value => value !== undefined);
      for (const raw of usages) {
        const usage = record(raw); if (!usage) { this.inputPresent = this.outputPresent = false; continue; }
        this.inputPresent = own(usage, 'prompt_tokens') && finiteToken(usage.prompt_tokens);
        this.outputPresent = own(usage, 'completion_tokens') && finiteToken(usage.completion_tokens);
        this.input = this.inputPresent ? usage.prompt_tokens as number : null;
        this.output = this.outputPresent ? usage.completion_tokens as number : null;
      }
    } else {
      const message = record(event.message); const usage = record(event.usage ?? message?.usage); if (!usage) return;
      if (event.type === 'message_start' || event.type === 'message' || event.type === 'message_delta' || !event.type) {
        const caches = ['cache_creation_input_tokens', 'cache_read_input_tokens'];
        if (event.type === 'message_start' || event.type === 'message') this.anthropicComponents = { input_tokens: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        for (const key of ['input_tokens', ...caches]) if (own(usage, key) && usage[key] !== null && usage[key] !== undefined) this.anthropicComponents[key] = finiteToken(usage[key]) ? usage[key] as number : null;
        this.inputPresent = Object.values(this.anthropicComponents).every(finiteToken);
        this.input = this.inputPresent ? Object.values(this.anthropicComponents).reduce<number>((sum, value) => sum + value!, 0) : null;
        if (!finiteToken(this.input)) { this.inputPresent = false; this.input = null; }
      }
      if (event.type === 'message_delta' || event.type === 'message' || (!event.type && own(usage, 'output_tokens'))) {
        if (event.type !== 'message_delta' || own(usage, 'output_tokens') && usage.output_tokens !== null && usage.output_tokens !== undefined) { this.outputPresent = own(usage, 'output_tokens') && finiteToken(usage.output_tokens); this.output = this.outputPresent ? usage.output_tokens as number : null; }
      }
    }
  }
  feedSse(text: string) {
    if (!this.parserValid || this.ended) return;
    this.buffer += text;
    if (this.buffer.length > 262144) { this.parserValid = false; this.buffer = ''; return; }
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index); this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data === '[DONE]') { this.ended = true; this.buffer = ''; return; }
      if (!data) continue;
      try { this.observe(JSON.parse(data)); } catch { this.parserValid = false; }
    }
  }
  finishSse() { if (this.buffer.trim()) this.feedSse('\n\n'); this.buffer = ''; }
  invalidate() { this.parserValid = false; this.buffer = ''; }
  get protocolComplete() { return this.ended && this.parserValid; }
  result() { return { inputReported: this.inputPresent && this.parserValid, outputReported: this.outputPresent && this.parserValid, inputTokens: this.inputPresent && this.parserValid ? this.input : null, outputTokens: this.outputPresent && this.parserValid ? this.output : null }; }
}

/**
 * Trusted control-plane forwarding proxy. One upstream POST maximum per role,
 * exact provider path and credential, bounded parsing, no redirects or key/body logs.
 */
export async function createUsageProxy(upstream: URL, protocol: 'openai-completions' | 'anthropic-messages', apiKey: string, signal: AbortSignal, jsonOutput?: JsonOutputOptions) {
  if (jsonOutput && (jsonOutput.provider !== 'deepseek' || protocol !== 'openai-completions' || typeof jsonOutput.modelId !== 'string' || !jsonOutput.modelId.trim() || Object.keys(jsonOutput).some(key => !['provider', 'modelId'].includes(key)))) throw new Error('Native JSON output is supported only by the explicit DeepSeek Chat control-plane profile');
  signal.throwIfAborted(); const observer = new WireUsageObserver(protocol); const cancellation = new AbortController();
  let requests = 0; let deniedRequests = 0; let status: number | null = null; let transportComplete = false; let formatForwarded = false;
  const basePath = upstream.pathname.replace(/\/$/, ''); const observerPath = observerPathFor(upstream); const endpoint = protocol === 'anthropic-messages' ? 'v1/messages' : 'chat/completions'; const expectedPath = `${observerPath}/${endpoint}`; const targetPath = `${basePath}/${endpoint}`;
  let expectedHost = '';
  const body = async (request: IncomingMessage) => { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of request) { const data = Buffer.from(chunk); bytes += data.length; if (bytes > 1048576) throw new Error('Provider request body exceeds controlled limit'); chunks.push(data); } return Buffer.concat(chunks); };
  const server = createServer(async (request, response) => {
    const deny = (code: number, message: string) => { deniedRequests++; response.writeHead(code, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message, type: 'usage_observer_rejection' } })); };
    let requestUrl: URL; try { requestUrl = new URL(request.url ?? '/', `http://${expectedHost || '127.0.0.1'}`); } catch { deny(403, 'Provider URL scope rejected'); return; }
    const oauth = protocol === 'anthropic-messages' && apiKey.includes('sk-ant-oat');
    const credential = protocol === 'anthropic-messages' && !oauth ? request.headers['x-api-key'] : request.headers.authorization;
    const expectedCredential = protocol === 'anthropic-messages' && !oauth ? apiKey : `Bearer ${apiKey}`;
    const queryAllowed = requestUrl.search === '' || protocol === 'anthropic-messages' && requestUrl.search === '?beta=true';
    if (request.method !== 'POST' || request.headers.host !== expectedHost || !request.url?.startsWith('/') || requestUrl.host !== expectedHost || requestUrl.pathname !== expectedPath || !queryAllowed || credential !== expectedCredential) { deny(403, 'Provider request scope rejected'); return; }
    if (requests >= 1) { deny(409, 'Additional provider POST rejected: one paid request per role invocation'); return; }
    try {
      const originalPayload = await body(request);
      let payload = originalPayload;
      if (jsonOutput) { try { payload = jsonOutputPayload(originalPayload, jsonOutput); } catch { deny(400, 'Controlled JSON output request rejected before provider dispatch'); return; } }
      if (requests >= 1) { deny(409, 'Additional provider POST rejected: one paid request per role invocation'); return; }
      signal.throwIfAborted(); cancellation.signal.throwIfAborted(); requests++;
      const headers = new Headers();
      for (const key of ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'anthropic-dangerous-direct-browser-access', ...(protocol === 'anthropic-messages' && !oauth ? ['x-api-key'] : ['authorization']), ...(oauth ? ['x-app', 'user-agent'] : [])]) { const value = request.headers[key]; if (typeof value === 'string') headers.set(key, value); }
      const disconnected = () => { if (!response.writableEnded) cancellation.abort(); }; response.on('close', disconnected);
      const target = new URL(upstream.origin); target.pathname = targetPath; target.search = requestUrl.search;
      const fetched = await fetch(target, { method: 'POST', headers, body: payload, redirect: 'error', signal: AbortSignal.any([signal, cancellation.signal]) });
      if (jsonOutput) formatForwarded = true;
      status = fetched.status; const contentType = fetched.headers.get('content-type') ?? 'application/octet-stream'; response.writeHead(fetched.status, { 'content-type': contentType, 'cache-control': 'no-store' });
      const reader = fetched.body?.getReader(); const decoder = new TextDecoder(); const isSse = contentType.includes('text/event-stream'); let json = ''; let bytes = 0;
      if (reader) while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 8388608) { observer.invalidate(); cancellation.abort(); throw new Error('Provider response exceeds controlled limit'); }
        const text = decoder.decode(chunk.value, { stream: true });
        if (isSse) observer.feedSse(text); else if (json.length + text.length <= 1048576) json += text; else observer.invalidate();
        if (!response.write(chunk.value)) await new Promise<void>((resolve, reject) => { const drain = () => { cleanup(); resolve(); }; const close = () => { cleanup(); reject(new Error('Downstream provider connection closed')); }; const cleanup = () => { response.off('drain', drain); response.off('close', close); }; response.once('drain', drain); response.once('close', close); });
        if (isSse && observer.protocolComplete) { response.off('close', disconnected); response.end(); await reader.cancel(); return; }
      }
      const tail = decoder.decode();
      if (isSse) { observer.feedSse(tail); observer.finishSse(); } else { json += tail; try { observer.observe(JSON.parse(json)); } catch { observer.invalidate(); } }
      transportComplete = true; response.off('close', disconnected); response.end();
    } catch {
      if (!observer.protocolComplete) observer.invalidate(); if (!response.headersSent) { response.writeHead(502, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Usage observer upstream request failed', type: 'usage_observer_error' } })); } else response.destroy();
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 15000; server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Usage observer address unavailable'); expectedHost = `127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= (async () => { cancellation.abort(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); signal.removeEventListener('abort', abort); })());
  const abort = () => { void close().catch(() => undefined); }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) await close();
  return { baseUrl: `http://${expectedHost}${observerPath}`, close, summary(): ObservedUsage { const raw = observer.result(); const finished = transportComplete || observer.protocolComplete; const complete = requests === 1 && status !== null && status >= 200 && status < 300 && finished && raw.inputReported && raw.outputReported; return { requests, deniedRequests, status, transportComplete: finished, httpEof: transportComplete, protocolComplete: observer.protocolComplete, ...raw, complete, ...(jsonOutput ? { responseFormat: { version: HARNESS_JSON_OUTPUT_VERSION, mode: 'json-object' as const, evidence: formatForwarded ? 'wire-observed' as const : 'requested' as const } } : {}) }; } };
}
