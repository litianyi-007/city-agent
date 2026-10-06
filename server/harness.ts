import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepSeekHarness, type DeepSeekHarnessOptions } from '@deepseek-ai/dsh-sdk-client';
import { createUsageProxy, type ObservedUsage } from './usage-observer.js';

export const HARNESS_VERSION = '0.1.5-rc.3';
export const HARNESS_NAME = `DeepSeek Harness ${HARNESS_VERSION}`;

export interface RoleModelConfig {
  provider: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  /** The SDK has no temperature setting; supplied values are rejected explicitly. */
  temperature?: number;
}

export interface RoleResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  harness: string;
  usageReported?: boolean;
  /** Sanitized raw-wire presence/counts only; no request bodies or credentials. */
  providerRequests?: ObservedUsage;
}

/** Only sanitized, allowlisted evidence is carried across a failed call. */
export class HarnessCallError extends Error {
  constructor(message: string, public evidence: { text: string; inputTokens: number | null; outputTokens: number | null; providerRequests?: ObservedUsage }) { super(message); }
}

const ROLE_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = 12_000;
const ROUTE = 'city-agent';
const KEY_ENV = 'CITY_AGENT_MODEL_KEY';

function protocolFor(provider: string): 'openai-completions' | 'anthropic-messages' {
  if (['anthropic', 'anthropic-messages'].includes(provider)) return 'anthropic-messages';
  if (['deepseek', 'openai', 'openai-compatible', 'openai-completions'].includes(provider)) {
    return 'openai-completions';
  }
  throw new Error(`不支持的 provider: ${provider}`);
}

function validateModel(agent: RoleModelConfig): URL {
  protocolFor(agent.provider);
  const url = new URL(agent.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 必须是没有用户名、密码、查询参数的 HTTP(S) API 根地址。');
  }
  if (!agent.modelId.trim() || !agent.apiKey.trim()) throw new Error('请为 Agent 配置 Model ID 和 API Key。');
  if (agent.temperature !== undefined) throw new Error('此版本 DeepSeek Harness SDK 不支持 temperature 配置。');
  return url;
}

function safeError(error: unknown, key: string, providerRequests?: ObservedUsage): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const message = key ? raw.split(key).join('[REDACTED]') : raw;
  const result = error instanceof HarnessCallError
    ? new HarnessCallError(message.slice(0, 2000), { ...error.evidence, text: error.evidence.text.split(key).join('[REDACTED]'), ...(providerRequests ? { providerRequests } : {}) })
    : providerRequests ? new HarnessCallError(message.slice(0, 2000), { text: '', inputTokens: null, outputTokens: null, providerRequests }) : new Error(message.slice(0, 2000));
  result.name = error instanceof Error ? error.name : 'Error';
  return result;
}

/**
 * A real Harness process per role invocation, using its official agent loop and
 * provider adapter. The shipped minimal profile's shell tools are disabled.
 * City Agent owns the workflow; the model returns text/JSON only. In particular,
 * no model-generated source is executed in this process or on the host.
 */
export async function runRole(
  agent: RoleModelConfig,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal,
  onEvent?: (message: string) => void,
  limits?: { maxOutputTokens: number; timeoutMs: number; reportUsage?: boolean },
): Promise<RoleResult> {
  signal.throwIfAborted();
  const baseUrl = validateModel(agent);
  const api = protocolFor(agent.provider);
  const maxTokens = limits?.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  const timeoutMs = limits?.timeoutMs ?? ROLE_TIMEOUT_MS;
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > MAX_OUTPUT_TOKENS || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > ROLE_TIMEOUT_MS) throw new Error('Harness调用限额无效。');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error('DeepSeek Harness 需要 Node.js 22 或更新版本，请使用项目指定的 Node 版本。');
  const temporaryRoot = fileURLToPath(new URL('../.city-agent-harness/', import.meta.url));
  try { if ((await lstat(temporaryRoot)).isSymbolicLink()) throw new Error('Harness 临时目录不得为符号链接。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  if ((await lstat(temporaryRoot)).isSymbolicLink()) throw new Error('Harness 临时目录不得为符号链接。');
  await chmod(temporaryRoot, 0o700);
  const workspace = await mkdtemp(join(temporaryRoot, 'role-'));
  let harness: DeepSeekHarness | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let stopError: Error | undefined;
  let closePromise: Promise<void> | undefined;
  let usageProxy: Awaited<ReturnType<typeof createUsageProxy>> | undefined;
  const close = () => (closePromise ??= (async () => { const results = await Promise.allSettled([harness?.close() ?? Promise.resolve(), usageProxy?.close() ?? Promise.resolve()]); const failure = results.find(result => result.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason; })());
  try {
    if (limits?.reportUsage) usageProxy = await createUsageProxy(baseUrl, api, agent.apiKey, signal);
    const patchPath = join(workspace, 'role.patch.yml');
    // JSON is valid YAML. No executable interpolation and no key enters this file.
    const patch = [
      ...[
        'persistent-bash', 'persistent-pwsh', 'terminal-bash', 'terminal-pwsh',
        'pty', 'subprocess', 'sandbox', 'sandbox-policy', 'llm-deepseek',
      ].map((id) => ({ id, disabled: true })),
      {
        id: 'system-prompt',
        config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: systemPrompt },
      },
      {
        insert: [{
          id: 'city-llm',
          name: '@deepseek-ai/dsh-llm-pi-ai',
          config: {
            providers: {
              [ROUTE]: {
                api,
                apiKeyEnv: KEY_ENV,
                baseURL: usageProxy?.baseUrl ?? baseUrl.toString().replace(/\/$/, ''),
                models: [{ id: agent.modelId, contextWindow: 65_536, maxTokens, reasoningEfforts: agent.provider === 'deepseek' ? { off: 'none', high: 'high' } : false }],
                ...(api === 'openai-completions' && agent.provider !== 'openai' ? {
                  compat: { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, ...(agent.provider === 'deepseek' ? { thinkingFormat: 'deepseek' } : {}) },
                } : {}),
                timeoutMs,
                streamIdleTimeoutMs: 90_000,
                retryPolicy: { mode: 'normal', maxRetries: 0 },
              },
            },
          },
        }],
      },
    ];
    await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
    signal.throwIfAborted();
    // A complete, deliberately small child environment prevents inheriting
    // unrelated API keys, NODE_OPTIONS, or DSH profile overrides from the host.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'en_US.UTF-8', [KEY_ENV]: agent.apiKey };
    if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    harness = new DeepSeekHarness({
      profile: 'sdk-minimal',
      patches: [patchPath],
      dshHome: join(workspace, 'harness-home'),
      processCwd: workspace,
      cwd: workspace,
      env,
      provider: ROUTE,
      model: agent.modelId,
      ...(agent.provider === 'deepseek' ? { reasoningEffort: 'off' as DeepSeekHarnessOptions['reasoningEffort'] } : {}),
      maxTokens,
      initializeTimeoutMs: 30_000,
      requestTimeoutMs: timeoutMs,
      shutdownTimeoutMs: 500,
      disposeEofGraceMs: 500,
      disposeGraceMs: 1000,
    });
    const stop = new Promise<never>((_, reject) => {
      const abort = (error: Error) => {
        stopError ??= error;
        reject(stopError);
        void close().catch(() => undefined);
      };
      abortListener = () => abort(new DOMException('任务已取消。', 'AbortError'));
      signal.addEventListener('abort', abortListener, { once: true });
      timeout = setTimeout(() => abort(new Error(`角色执行超过 ${timeoutMs / 1000} 秒，已停止 Harness 进程。`)), timeoutMs);
    });
    onEvent?.('DeepSeek Harness 已启动，正在请求模型。');
    const result = await Promise.race([
      harness.run(userPrompt, {
        onNotification(notification) {
          const event = notification.params.event as { type?: string } | undefined;
          if (notification.method === 'session.event' && event?.type === 'assistant/message') {
            onEvent?.('模型已完成回复，正在校验交付内容。');
          }
        },
      }),
      stop,
    ]);
    signal.throwIfAborted();
    let inputTokens = 0;
    let outputTokens = 0;
    let usageReported = false;
    let assistantMessages = 0;
    let allNormalizedUsageValid = true;
    for (const event of result.events) {
      if (event.type !== 'assistant/message') continue;
      assistantMessages++;
      const normalizedValid = typeof event.data.usage?.inputTokens === 'number' && typeof event.data.usage?.outputTokens === 'number' && Number.isFinite(event.data.usage.inputTokens) && Number.isFinite(event.data.usage.outputTokens);
      allNormalizedUsageValid &&= normalizedValid;
      usageReported ||= normalizedValid;
      // pi-ai input excludes cache reads/writes; report the complete prompt size.
      inputTokens += (event.data.usage?.inputTokens ?? 0) + (event.data.usage?.cacheReadTokens ?? 0) + (event.data.usage?.cacheWriteTokens ?? 0);
      outputTokens += event.data.usage?.outputTokens ?? 0;
    }
    const providerRequests = usageProxy?.summary();
    if (providerRequests) {
      usageReported = providerRequests.complete && assistantMessages === 1 && allNormalizedUsageValid && inputTokens === providerRequests.inputTokens && outputTokens === providerRequests.outputTokens;
      if (usageReported) { inputTokens = providerRequests.inputTokens!; outputTokens = providerRequests.outputTokens!; }
    }
    const end = [...result.events].reverse().find((event) => event.type === 'turn/end');
    if (!end || end.type !== 'turn/end' || end.data.reason.kind !== 'completed' || !result.finalResponse.trim()) {
      const reason = end?.type === 'turn/end' ? JSON.stringify(end.data.reason) : '没有完成事件';
      throw new HarnessCallError(`模型执行未完成或返回空内容: ${reason}`, { text: result.finalResponse, inputTokens: usageReported ? inputTokens : null, outputTokens: usageReported ? outputTokens : null });
    }
    return { text: result.finalResponse.split(agent.apiKey).join('[REDACTED]'), inputTokens, outputTokens, harness: HARNESS_NAME, ...(limits?.reportUsage ? { usageReported, providerRequests } : {}) };
  } catch (error) {
    throw safeError(stopError ?? error, agent.apiKey, usageProxy?.summary());
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener) signal.removeEventListener('abort', abortListener);
    try { await close(); }
    finally { try { await usageProxy?.close(); } finally { await rm(workspace, { recursive: true, force: true }); } }
  }
}
