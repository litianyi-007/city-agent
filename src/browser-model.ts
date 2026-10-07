import type { RoleModelConfig } from '../server/harness';
import { redactKnownSecret } from '../shared/redaction';

async function requestBrowserModel(config: RoleModelConfig, system: string, user: string, signal: AbortSignal) {
  const base = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('模型地址须为无凭证和查询参数的HTTP(S)根地址。');
  if (!config.apiKey.trim() || !config.modelId.trim()) throw new Error('请填写模型ID和API Key。');
  const anthropic = config.provider === 'anthropic';
  const root = base.toString().replace(/\/+$/, '');
  const endpoint = anthropic ? `${root.endsWith('/v1') ? root : root + '/v1'}/messages` : `${root}/chat/completions`;
  const safeSystem = redactKnownSecret(system, config.apiKey);
  const safeUser = redactKnownSecret(user, config.apiKey);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), credentials: 'omit',
      headers: { 'Content-Type': 'application/json', ...(anthropic ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : { Authorization: `Bearer ${config.apiKey}` }) },
      body: JSON.stringify(anthropic ? { model: config.modelId, system: safeSystem, messages: [{ role: 'user', content: safeUser }], max_tokens: 3000, stream: false }
        : { model: config.modelId, messages: [{ role: 'system', content: safeSystem }, { role: 'user', content: safeUser }], max_tokens: 3000, stream: false, ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) }),
    });
  } catch (error) {
    if (signal.aborted) throw new Error('调查已取消。');
    throw new Error('模型接口连接失败或超时。请确认接口允许本站跨域访问（CORS）、地址和网络可用。');
  }
  if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}），请检查模型、凭据、额度与接口协议。`);
  const data = await response.json();
  const raw = anthropic ? data.content?.filter((item: { type: string }) => item.type === 'text').map((item: { text: string }) => item.text).join('') : data.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || raw.length > 100_000) throw new Error('模型回复为空或超过输出限制。');
  const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const evidence = { text: redactKnownSecret(raw, config.apiKey),
    inputTokens: tokens(anthropic ? data.usage?.input_tokens : data.usage?.prompt_tokens),
    outputTokens: tokens(anthropic ? data.usage?.output_tokens : data.usage?.completion_tokens) };
  if (anthropic ? data.stop_reason === 'max_tokens' : data.choices?.[0]?.finish_reason === 'length') {
    throw Object.assign(new Error('模型输出已截断；保留用量与原文，不补填或重试。'), { evidence });
  }
  return evidence;
}

export async function callBrowserModel(config: RoleModelConfig, system: string, user: string, signal: AbortSignal) {
  try { return await requestBrowserModel(config, system, user, signal); }
  catch (error) {
    const safe = new Error(redactKnownSecret(error instanceof Error ? error.message : String(error), config.apiKey).slice(0, 2000));
    safe.name = redactKnownSecret(error instanceof Error ? error.name : 'Error', config.apiKey).slice(0, 100);
    const evidence = (error as { evidence?: { text?: unknown; inputTokens?: unknown; outputTokens?: unknown } })?.evidence;
    if (evidence && typeof evidence.text === 'string') {
      const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
      Object.assign(safe, { evidence: { text: redactKnownSecret(evidence.text, config.apiKey), inputTokens: tokens(evidence.inputTokens), outputTokens: tokens(evidence.outputTokens) } });
    }
    throw safe;
  }
}
