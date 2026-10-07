/** Wire evidence for the registered DeepSeek relay only, never SDK-defaulted counters. */
export const PROVIDER_USAGE_WITNESS_VERSION = 'deepseek-provider-usage-witness-1.0';

export interface ProviderUsageWitness {
  version: typeof PROVIDER_USAGE_WITNESS_VERSION;
  state: 'pending' | 'reported' | 'missing' | 'invalid' | 'transport-failed';
  usagePackets: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  reason?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const tokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const has = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);

export function parseProviderUsage(value: unknown): { usage: NonNullable<ProviderUsageWitness['usage']>; cacheRead?: number; cacheWrite?: number } | null {
  if (!isRecord(value) || !tokenCount(value.prompt_tokens) || !tokenCount(value.completion_tokens) || !tokenCount(value.total_tokens)) return null;
  const total = value.prompt_tokens + value.completion_tokens;
  if (!Number.isSafeInteger(total) || total !== value.total_tokens) return null;
  for (const [key, count] of Object.entries(value)) {
    if (key.endsWith('_tokens') && (!tokenCount(count) || count > total)) return null;
  }
  const readCounts: number[] = [];
  let cacheWrite: number | undefined;
  for (const key of ['prompt_cache_hit_tokens', 'cached_tokens']) {
    if (has(value, key)) { if (!tokenCount(value[key])) return null; readCounts.push(value[key]); }
  }
  if (has(value, 'prompt_cache_hit_tokens') || has(value, 'prompt_cache_miss_tokens')) {
    if (!tokenCount(value.prompt_cache_hit_tokens) || !tokenCount(value.prompt_cache_miss_tokens)
      || value.prompt_cache_hit_tokens + value.prompt_cache_miss_tokens !== value.prompt_tokens) return null;
  }
  if (has(value, 'prompt_tokens_details')) {
    if (!isRecord(value.prompt_tokens_details)) return null;
    for (const [key, count] of Object.entries(value.prompt_tokens_details)) {
      if (key.endsWith('_tokens') && (!tokenCount(count) || count > value.prompt_tokens)) return null;
    }
    for (const key of ['cached_tokens', 'cache_write_tokens']) {
      if (!has(value.prompt_tokens_details, key)) continue;
      const count = value.prompt_tokens_details[key]; if (!tokenCount(count)) return null;
      if (key === 'cached_tokens') readCounts.push(count); else cacheWrite = count;
    }
  }
  if (has(value, 'completion_tokens_details')) {
    if (!isRecord(value.completion_tokens_details)) return null;
    for (const [key, count] of Object.entries(value.completion_tokens_details)) {
      if (key.endsWith('_tokens') && (!tokenCount(count) || count > value.completion_tokens)) return null;
    }
  }
  const cacheRead = readCounts[0];
  if (readCounts.some(count => count !== cacheRead) || (cacheRead ?? 0) + (cacheWrite ?? 0) > value.prompt_tokens) return null;
  return { usage: { inputTokens: value.prompt_tokens, outputTokens: value.completion_tokens, totalTokens: value.total_tokens }, cacheRead, cacheWrite };
}

/** The CORS branch uses the same complete usage validation as the streaming relay. */
export function providerJsonUsageWitness(value: unknown): ProviderUsageWitness {
  const parsed = parseProviderUsage(value);
  return { version: PROVIDER_USAGE_WITNESS_VERSION, state: parsed ? 'reported' : value == null ? 'missing' : 'invalid',
    usagePackets: value == null ? 0 : 1, usage: parsed?.usage ?? null,
    ...(!parsed ? { reason: value == null ? 'missing-provider-usage' : 'invalid-provider-usage' } : {}) };
}

/** Inspect streaming bytes without retaining response text, credentials, or prompts. */
export function createProviderUsageWitness() {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let data: string[] = [];
  let dataCharacters = 0;
  let sawDone = false;
  let completed = false;
  let normalized: ReturnType<typeof parseProviderUsage>;
  const evidence: ProviderUsageWitness = { version: PROVIDER_USAGE_WITNESS_VERSION, state: 'pending', usagePackets: 0, usage: null };
  const invalidate = (reason: string) => { evidence.state = 'invalid'; evidence.reason ??= reason; evidence.usage = null; };
  const packet = () => {
    if (!data.length) return;
    const raw = data.join('\n'); data = []; dataCharacters = 0;
    if (sawDone) { invalidate('packet-after-done'); return; }
    if (raw === '[DONE]') { sawDone = true; return; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { invalidate('invalid-sse-json'); return; }
    if (!isRecord(parsed)) { invalidate('invalid-sse-packet'); return; }
    // OpenAI-compatible streaming packets may carry usage:null before the final counter packet.
    if (!has(parsed, 'usage') || parsed.usage === null) return;
    evidence.usagePackets++;
    const current = parseProviderUsage(parsed.usage);
    if (!current) { invalidate('invalid-provider-usage'); return; }
    if (normalized && JSON.stringify(normalized) !== JSON.stringify(current)) { invalidate('inconsistent-provider-usage'); return; }
    normalized = current;
  };
  const drain = (final = false) => {
    let boundary: number;
    while ((boundary = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, boundary).replace(/\r$/, ''); pending = pending.slice(boundary + 1);
      if (!line) packet();
      else if (line.startsWith('data:')) { const part = line.slice(5).replace(/^ /, ''); data.push(part); dataCharacters += part.length + 1; }
      if (dataCharacters > 512_000) { invalidate('sse-packet-too-large'); data = []; dataCharacters = 0; }
    }
    if (pending.length > 512_000) { invalidate('sse-packet-too-large'); pending = ''; }
    // A trailing undelimited event is not a complete SSE packet.
    if (final && (pending.trim() || data.length)) invalidate('incomplete-sse-packet');
  };
  return {
    observe(bytes: Uint8Array) {
      if (completed) { invalidate('bytes-after-completion'); return; }
      try { pending += decoder.decode(bytes, { stream: true }); drain(); } catch { invalidate('invalid-sse-encoding'); }
    },
    complete() {
      if (completed) return;
      completed = true;
      try { pending += decoder.decode(); drain(true); } catch { invalidate('invalid-sse-encoding'); }
      if (evidence.state !== 'pending') return;
      if (!sawDone) invalidate('incomplete-provider-stream');
      else if (!normalized) { evidence.state = 'missing'; evidence.reason = 'missing-provider-usage'; }
      else { evidence.state = 'reported'; evidence.usage = { ...normalized.usage }; }
    },
    fail(reason = 'upstream-transport-failed') { completed = true; evidence.state = 'transport-failed'; evidence.reason = reason; evidence.usage = null; },
    snapshot(): ProviderUsageWitness { return structuredClone(evidence); },
  };
}
