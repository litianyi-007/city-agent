import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { expandAssistantStream } from '@deepseek-ai/dsh-llm';
import { decodeAnswerContract, type AnswerContract } from '../../shared/answer-contract';
import { fingerprint } from '../../shared/evidence';
import { containsKnownSecret } from '../../shared/redaction';
import { HARNESS_NAME, type RoleModelConfig } from '../harness';
import { ExperimentBudgetError, type ExperimentBudgetGuard } from './experiment-budget';
import { compileResponsesRequest, createResponsesRelay } from './responses-relay';

export const STRUCTURED_RESPONSES_VERSION = 'bounded-responses-harness-1.0';
const ROUTE = 'city-bounded-responses';
type Relay = Awaited<ReturnType<typeof createResponsesRelay>>;
export interface StructuredResponsesEvidence {
  version: typeof STRUCTURED_RESPONSES_VERSION;
  bodyHash: string;
  schemaHash: string;
  transport: ReturnType<Relay['snapshot']> | null;
  stepCount: number;
  toolCalls: number;
  toolResults: number;
  assistantMessages: number;
  contentChunks: number;
  cleanupErrors: string[];
}
export class StructuredResponsesError extends Error {
  constructor(public readonly code: string, public readonly evidence: StructuredResponsesEvidence) {
    super(`Structured Responses invocation rejected (${code}).`);
  }
}

/** Candidate only: deliberately not imported by the application API or the Pages route. */
export async function runStructuredResponsesHarness(input: {
  guard: ExperimentBudgetGuard; requestId: string; purpose: string; model: RoleModelConfig;
  contract: AnswerContract; system: string; user: string; signal: AbortSignal; maxOutputTokens: number;
  /** Synthetic tests use a controlled fetch. Default remains the fixed official endpoint in the relay. */
  upstreamFetch?: typeof fetch;
}) {
  if (input.signal.aborted) throw new Error('Responses invocation cancelled before start.');
  if (Object.keys(input).some(key => !['guard', 'requestId', 'purpose', 'model', 'contract', 'system', 'user', 'signal', 'maxOutputTokens', 'upstreamFetch'].includes(key))) throw new Error('Unknown bounded Responses option.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Responses Harness requires Node 22.');
  const contract = structuredClone(input.contract), model = { ...input.model };
  let request: ReturnType<typeof compileResponsesRequest>;
  try { request = compileResponsesRequest({ model, system: input.system, user: input.user, contract, maxOutputTokens: input.maxOutputTokens }); }
  catch { throw new Error('Invalid frozen Responses request; no request dispatched.'); }
  if (containsKnownSecret(JSON.stringify({ requestId: input.requestId, purpose: input.purpose }), model.apiKey)) throw new Error('Responses identifiers contain a configured credential.');
  const pricing = input.guard.snapshot().pricing;
  if (pricing.provider !== model.provider || pricing.modelId !== model.modelId) throw new Error('Budget pricing must match the frozen Responses model.');
  // Reserve the entire serialization, including every schema property, before listening or spawning.
  const reservation = input.guard.reserve({ requestId: input.requestId, purpose: input.purpose, inputText: request.body,
    maxOutputTokens: input.maxOutputTokens, inputEnvelopeTokens: 1024 });
  const evidence: StructuredResponsesEvidence = { version: STRUCTURED_RESPONSES_VERSION, bodyHash: request.bodySha256, schemaHash: request.schemaHash,
    transport: null, stepCount: 0, toolCalls: 0, toolResults: 0, assistantMessages: 0, contentChunks: 0, cleanupErrors: [] };
  let relay: Relay | undefined, harness: DeepSeekHarness | undefined, workspace: string | undefined;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let resultValue: { raw: string; answers: ReturnType<typeof decodeAnswerContract>; inputTokens: number; outputTokens: number;
    harness: string; evidence: StructuredResponsesEvidence } | undefined;
  let primary: Error | undefined, stopTimer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  let acceptedTransportHash: string | undefined;
  let childClose: Promise<void> | undefined;
  const closeChild = () => (childClose ??= harness?.close() ?? Promise.resolve());
  function reject(code: string): never { throw new StructuredResponsesError(code, evidence); }
  try {
    relay = await createResponsesRelay({ model, frozenRequest: request, reservedInputTokens: reservation.reservedInputTokens,
      signal: input.signal, upstreamFetch: input.upstreamFetch });
    workspace = await mkdtemp(join(tmpdir(), 'city-bounded-responses-'));
    const port = Number(new URL(relay.baseUrl).port), patchPath = join(workspace, 'responses.patch.yml');
    const patch = [...['persistent-bash', 'persistent-pwsh', 'terminal-bash', 'terminal-pwsh', 'pty', 'subprocess', 'sandbox', 'sandbox-policy', 'llm-deepseek', 'llm-retry'].map(id => ({ id, disabled: true })),
      { id: 'system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: input.system } },
      { insert: [{ id: ROUTE, name: fileURLToPath(new URL('./structured-responses-plugin.mjs', import.meta.url)),
        config: { port, relayToken: relay.relayToken, body: request.body, bodyHash: request.bodySha256, schemaHash: request.schemaHash,
          modelId: model.modelId, maxOutputTokens: input.maxOutputTokens } }] }];
    await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
    input.signal.throwIfAborted();
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
    if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    harness = new DeepSeekHarness({ profile: 'sdk-minimal', patches: [patchPath], cwd: workspace, processCwd: workspace, dshHome: join(workspace, 'home'),
      env, provider: ROUTE, model: model.modelId, maxTokens: input.maxOutputTokens,
      initializeTimeoutMs: 30_000, requestTimeoutMs: 90_000, shutdownTimeoutMs: 500, disposeEofGraceMs: 500, disposeGraceMs: 1000 });
    const stopped = new Promise<never>((_, rejectPromise) => {
      const stop = () => { rejectPromise(new StructuredResponsesError(input.signal.aborted ? 'RESPONSES_CANCELLED' : 'RESPONSES_TIMEOUT', evidence)); void closeChild().catch(() => undefined); };
      abort = stop; input.signal.addEventListener('abort', stop, { once: true }); stopTimer = setTimeout(stop, 90_000);
      if (input.signal.aborted) stop();
    });
    const result = await Promise.race([harness.run(input.user), stopped]);
    input.signal.throwIfAborted();
    evidence.stepCount = result.events.filter(event => event.type === 'step/start').length;
    evidence.toolCalls = result.events.filter(event => event.type === 'tool/call').length;
    evidence.toolResults = result.events.filter(event => event.type === 'tool/result').length;
    const messages = result.events.filter(event => event.type === 'assistant/message'); evidence.assistantMessages = messages.length;
    evidence.contentChunks = result.events.flatMap(event => event.type === 'assistant/message' || event.type === 'assistant/attempt'
      ? expandAssistantStream(event.data.stream).filter(({ chunk }) => chunk.type !== 'usage' && chunk.type !== 'finish') : []).length;
    evidence.transport = relay.snapshot();
    const end = [...result.events].reverse().find(event => event.type === 'turn/end');
    if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed' || evidence.stepCount !== 1 || evidence.toolCalls || evidence.toolResults || messages.length !== 1) reject('RESPONSES_SDK_NON_COMPLETION');
    const transport = evidence.transport, witness = transport.providerWitness;
    if (transport.requestAttempts !== 1 || transport.forwardedRequests !== 1 || transport.deniedRequests !== 0
      || transport.forwardedBodySha256 !== request.bodySha256 || witness.state !== 'reported' || !witness.usage || !witness.rawResponseSha256) reject('RESPONSES_WIRE_WITNESS_MISMATCH');
    const expectedReplay = { response: { version: STRUCTURED_RESPONSES_VERSION, schemaHash: request.schemaHash,
      bodyHash: request.bodySha256, rawResponseHash: witness.rawResponseSha256, dispatches: 1 } };
    if (fingerprint(messages[0].data.message.source.replayState) !== fingerprint(expectedReplay)
      || createHash('sha256').update(result.finalResponse).digest('hex') !== transport.responseTextSha256) reject('RESPONSES_REPLAY_MISMATCH');
    const sdk = messages[0].data.usage;
    const sdkInput = (sdk?.inputTokens ?? NaN) + (sdk?.cacheReadTokens ?? 0) + (sdk?.cacheWriteTokens ?? 0);
    if (!Number.isSafeInteger(sdkInput) || sdkInput !== witness.usage.inputTokens || sdk?.outputTokens !== witness.usage.outputTokens
      || sdk.totalTokens !== witness.usage.totalTokens || (sdk.cacheReadTokens ?? 0) !== witness.usage.cacheReadTokens
      || (sdk.cacheWriteTokens ?? 0) !== 0 || (sdk.reasoningTokens ?? 0) !== witness.usage.reasoningTokens) reject('RESPONSES_SDK_USAGE_MISMATCH');
    usage = { inputTokens: witness.usage.inputTokens, outputTokens: witness.usage.outputTokens };
    if (containsKnownSecret(result.finalResponse, model.apiKey)) reject('RESPONSES_OUTPUT_SECRET');
    const answers = (() => { try { return decodeAnswerContract(contract, result.finalResponse); } catch { return reject('RESPONSES_ANSWER_CONTRACT_REJECTED'); } })();
    resultValue = { raw: result.finalResponse, answers, ...usage, harness: HARNESS_NAME, evidence };
    acceptedTransportHash = fingerprint(evidence.transport);
  } catch (error) {
    primary = error instanceof StructuredResponsesError || error instanceof ExperimentBudgetError ? error : new StructuredResponsesError(input.signal.aborted ? 'RESPONSES_CANCELLED' : 'RESPONSES_INVOCATION_FAILED', evidence);
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
    if (abort) input.signal.removeEventListener('abort', abort);
    if (relay) evidence.transport = relay.snapshot();
    try { await closeChild(); } catch { evidence.cleanupErrors.push('child-close'); }
    try { await relay?.close(); } catch { evidence.cleanupErrors.push('relay-close'); }
    try { if (workspace) await rm(workspace, { recursive: true, force: true }); } catch { evidence.cleanupErrors.push('workspace-remove'); }
    // Seal evidence after both child and listener close: a late denied dispatch still invalidates this invocation.
    if (relay) evidence.transport = relay.snapshot();
  }
  if (!primary && acceptedTransportHash && fingerprint(evidence.transport) !== acceptedTransportHash) primary = new StructuredResponsesError('RESPONSES_FINAL_WITNESS_CHANGED', evidence);
  if (evidence.cleanupErrors.length) {
    primary ??= new StructuredResponsesError('RESPONSES_CLEANUP_FAILED', evidence);
  }
  if (input.signal.aborted) primary ??= new StructuredResponsesError('RESPONSES_CANCELLED', evidence);
  // The durable reservation remains pending through every cleanup. A concurrent request cannot spend it early.
  try {
    const ledger = input.guard.settle(reservation.reservationId, { outcome: primary ? input.signal.aborted ? 'cancelled' : 'failed' : 'succeeded', usage });
    if (!primary && ledger.state !== 'active') primary = new StructuredResponsesError('RESPONSES_BUDGET_HALTED', evidence);
  } catch (error) {
    primary ??= error instanceof ExperimentBudgetError ? error : new StructuredResponsesError('RESPONSES_SETTLEMENT_FAILED', evidence);
  }
  if (primary) throw primary;
  return resultValue!;
}
