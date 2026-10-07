import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses';
import type { Model } from '@earendil-works/pi-ai';
import { fingerprint } from '../../shared/evidence.js';

/** Research-only: this module owns its localhost fixture; callers cannot supply an endpoint or key. */
export const STRUCTURED_CAPABILITY_PROBE_VERSION = 'responses-offline-1.0';
const ROUTE = 'city-responses-offline';
const MODEL = 'city-responses-fixture';
const KEY_ENV = 'CITY_RESPONSES_OFFLINE_KEY';
const FIXTURE_KEY = 'offline-fixture-not-a-real-key';
const MAX_BYTES = 128_000;
const TIMEOUT_MS = 30_000;
const sha256 = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex');

export interface OfflineResponsesProbeInput {
  mode: 'harness-profile' | 'pi-on-payload';
  schema: Record<string, unknown>;
  responseText: string;
  fixture?: 'completed' | 'incomplete' | 'no-terminal' | 'http-500';
}

export interface OfflineResponsesProbeEvidence {
  version: typeof STRUCTURED_CAPABILITY_PROBE_VERSION;
  mode: OfflineResponsesProbeInput['mode'];
  /** Capability claims below concern local bytes, never provider schema enforcement. */
  scope: 'localhost-fixture-only';
  fixture: NonNullable<OfflineResponsesProbeInput['fixture']>;
  schemaHash: string;
  observedSchemaHash: string | null;
  bodyHash: string | null;
  rawResponseHash: string;
  requestCount: number;
  requests: { method: string; path: string; body: Record<string, unknown> }[];
  text: string;
  completed: boolean;
  toolCallEvents: number;
  toolResultEvents: number;
  failure: string | null;
  limits: { maxRequests: 1; retries: 0; maxOutputTokens: 512; timeoutMs: 30000 };
}

function fixtureWire(text: string, fixture: OfflineResponsesProbeEvidence['fixture']): string {
  if (fixture === 'http-500') return JSON.stringify({ error: { message: 'Offline capability fixture failure', type: 'server_error' } });
  const item = { type: 'message', id: 'msg_offline', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
  const response = { id: 'resp_offline', object: 'response', created_at: 0, model: MODEL, status: fixture === 'incomplete' ? 'incomplete' : 'completed',
    output: [item], usage: { input_tokens: 13, output_tokens: 7, total_tokens: 20, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 0 } },
    error: null, incomplete_details: fixture === 'incomplete' ? { reason: 'max_output_tokens' } : null };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] },
    { type: 'response.output_item.done', output_index: 0, item },
    ...(fixture === 'no-terminal' ? [] : [{ type: fixture === 'incomplete' ? 'response.incomplete' : 'response.completed', response }]),
  ];
  return events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
}

function rejectFixture(response: ServerResponse, message: string) {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message, type: 'offline_fixture_rejection' } }));
}

/**
 * A real fixed DSH SDK child selects Responses via a profile. Deliberately
 * attempted profile `text`/`samplingParams` show whether the wrapper forwards
 * them. The other mode calls the installed pi-ai adapter's existing onPayload
 * seam directly; it does not imply that seam is available through DSH.
 * Neither mode is registered by the application or permits real network input.
 */
export async function probeOfflineResponsesCapability(input: OfflineResponsesProbeInput): Promise<OfflineResponsesProbeEvidence> {
  const mode = input.mode;
  if (!['harness-profile', 'pi-on-payload'].includes(mode)) throw new Error('Unknown offline capability mode.');
  const fixture = input.fixture ?? 'completed';
  if (!['completed', 'incomplete', 'no-terminal', 'http-500'].includes(fixture)) throw new Error('Unknown offline fixture.');
  const encodedSchema = JSON.stringify(input.schema);
  if (!encodedSchema || Buffer.byteLength(encodedSchema) > MAX_BYTES || Buffer.byteLength(input.responseText) > MAX_BYTES) throw new Error('Offline fixture exceeds 128KB.');
  const schema = JSON.parse(encodedSchema) as Record<string, unknown>;
  if (!schema || Array.isArray(schema) || typeof schema !== 'object') throw new Error('Offline schema must be an object.');
  const schemaHash = fingerprint(schema);
  const wire = fixtureWire(input.responseText, fixture);
  const requests: OfflineResponsesProbeEvidence['requests'] = [];
  let bodyHash: string | null = null;
  let requestCount = 0;
  let fixtureFailure: string | null = null;
  const server = createServer(async (request, response) => {
    requestCount++;
    if (requestCount > 1) { fixtureFailure = 'Second request rejected by offline fixture.'; rejectFixture(response, fixtureFailure); return; }
    if (request.method !== 'POST' || request.url !== '/v1/responses' || request.headers.authorization !== `Bearer ${FIXTURE_KEY}`) {
      fixtureFailure = 'Unexpected offline method, path or credential.'; rejectFixture(response, fixtureFailure); return;
    }
    try {
      const chunks: Buffer[] = [];
      let byteLength = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += bytes.length;
        if (byteLength > MAX_BYTES * 2) throw new Error('Offline request exceeds 256KB.');
        chunks.push(bytes);
      }
      const rawBytes = Buffer.concat(chunks);
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({ method: request.method, path: request.url, body });
      bodyHash = sha256(rawBytes);
      response.writeHead(fixture === 'http-500' ? 500 : 200, { 'content-type': fixture === 'http-500' ? 'application/json' : 'text/event-stream' });
      response.end(wire);
    } catch {
      fixtureFailure = 'Invalid or oversized offline request.';
      rejectFixture(response, fixtureFailure);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Offline fixture failed to listen.');
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  let workspace: string | undefined;
  let harness: DeepSeekHarness | undefined;
  let text = '';
  let completed = false;
  let toolCallEvents = 0;
  let toolResultEvents = 0;
  let failure: string | null = null;
  try {
    if (mode === 'harness-profile') {
      if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Offline Harness fixture requires Node 22.');
      workspace = await mkdtemp(join(tmpdir(), 'city-responses-capability-'));
      const patchPath = join(workspace, 'responses.patch.yml');
      const format = { type: 'json_schema', name: 'city_answer_probe', schema };
      const patch = [
        ...['persistent-bash', 'persistent-pwsh', 'terminal-bash', 'terminal-pwsh', 'pty', 'subprocess', 'sandbox', 'sandbox-policy', 'llm-deepseek', 'llm-retry'].map(id => ({ id, disabled: true })),
        { id: 'system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'Return a fixed JSON answer. Do not call tools.' } },
        { insert: [{ id: 'city-responses-offline', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { [ROUTE]: {
          api: 'openai-responses', apiKeyEnv: KEY_ENV, baseURL,
          models: [{ id: MODEL, contextWindow: 65_536, maxTokens: 512, reasoningEfforts: false }],
          compat: { supportsDeveloperRole: false },
          cacheRetention: 'none', timeoutMs: TIMEOUT_MS, streamIdleTimeoutMs: TIMEOUT_MS,
          retryPolicy: { mode: 'normal', maxRetries: 0 },
          // Unsupported profile fields are deliberately attempted, never called capabilities.
          text: { format }, samplingParams: { text: { format } },
        } } } }] },
      ];
      await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
      harness = new DeepSeekHarness({ profile: 'sdk-minimal', patches: [patchPath], dshHome: join(workspace, 'home'), processCwd: workspace, cwd: workspace,
        env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', [KEY_ENV]: FIXTURE_KEY }, provider: ROUTE, model: MODEL, maxTokens: 512,
        initializeTimeoutMs: TIMEOUT_MS, requestTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 500, disposeEofGraceMs: 500, disposeGraceMs: 1000 });
      const result = await harness.run('Offline answer capability probe.');
      text = result.finalResponse;
      toolCallEvents = result.events.filter(event => event.type === 'tool/call').length;
      toolResultEvents = result.events.filter(event => event.type === 'tool/result').length;
      const terminal = [...result.events].reverse().find(event => event.type === 'turn/end');
      completed = terminal?.type === 'turn/end' && terminal.data.reason.kind === 'completed';
      if (!completed) failure = 'Harness did not complete the offline turn.';
    } else {
      const model: Model<'openai-responses'> = { id: MODEL, name: MODEL, api: 'openai-responses', provider: ROUTE, baseUrl: baseURL,
        reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65_536, maxTokens: 512 };
      let fetchCount = 0;
      const result = await streamResponses(model, { systemPrompt: 'Return a fixed JSON answer. Do not call tools.', messages: [{ role: 'user', content: 'Offline answer capability probe.', timestamp: 0 }] }, {
        apiKey: FIXTURE_KEY, env: {}, maxTokens: 512, maxRetries: 0, timeoutMs: TIMEOUT_MS, signal: AbortSignal.timeout(TIMEOUT_MS), cacheRetention: 'none', toolChoice: 'none',
        fetch: async (url, options) => {
          if (++fetchCount > 1 || String(url) !== `${baseURL}/responses`) throw new Error('Offline fetch target or request count changed.');
          return fetch(url, { ...options, redirect: 'error' });
        },
        onPayload: payload => ({ ...(payload as Record<string, unknown>), text: { format: { type: 'json_schema', name: 'city_answer_probe', schema } } }),
      }).result();
      text = result.content.filter(block => block.type === 'text').map(block => block.text).join('');
      toolCallEvents = result.content.filter(block => block.type === 'toolCall').length;
      completed = result.stopReason === 'stop';
      if (!completed) failure = 'pi-ai did not complete the offline response.';
    }
  } catch (error) {
    // This probe uses a fixed fake key and never persists provider exception bodies.
    failure = error instanceof Error && /requires Node 22/.test(error.message) ? error.message : 'Offline SDK probe failed.';
  } finally {
    try { await harness?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  }
  if (fixtureFailure) { failure = fixtureFailure; completed = false; }
  const observedSchema = (requests[0]?.body.text as { format?: { schema?: unknown } } | undefined)?.format?.schema;
  return { version: STRUCTURED_CAPABILITY_PROBE_VERSION, mode, scope: 'localhost-fixture-only', fixture, schemaHash,
    observedSchemaHash: observedSchema === undefined ? null : fingerprint(observedSchema), bodyHash, rawResponseHash: sha256(wire), requestCount, requests,
    text, completed, toolCallEvents, toolResultEvents, failure, limits: { maxRequests: 1, retries: 0, maxOutputTokens: 512, timeoutMs: 30000 } };
}
