import { createHash } from 'node:crypto';
import { productionApiKeySchema } from '../../shared/production-schema.js';
import { JEV_ENDPOINT, type JevCandidateContext, type JevEvaluation } from '../../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS } from '../../shared/production-verifier-challenge-corpus.js';
import { HarnessCallError, runRole, HARNESS_JSON_OUTPUT_VERSION } from '../harness.js';
import { observerPathFor, type ObservedUsage } from '../usage-observer.js';
import { evaluateJevCandidates } from './jev.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import { verifierStudyPublicConfiguration, STUDY_PROPOSED_LLM_TIMEOUT_MS, STUDY_PROPOSED_OUTPUT_TOKENS } from './verifier-study-preflight.js';
import type { StudyUsage } from './verifier-study.js';

export const VERIFIER_STUDY_TRANSPORT_VERSION = 'verifier-study-transport-v1';
export type VerifierStudyTransportSource = 'real-provider' | 'loopback-engineering';
export interface VerifierStudyTransportObservation {
  version: typeof VERIFIER_STUDY_TRANSPORT_VERSION; executionSource: VerifierStudyTransportSource;
  engine: 'llm' | 'jev'; poolId: string | null; status: 'completed' | 'failed' | 'cancelled' | 'denied';
  actualProviderHttpAttempts: number | null;
  /** Historical field name: LLM means actual loopback HTTP POSTs; Jev means
   * in-memory trusted fetch dispatches, NOT local or external network HTTP. */
  localFixtureHttpAttempts: number | null; fixtureDispatchKind: 'loopback-http-post' | 'in-memory-fetch' | null;
  countEvidence: 'not-dispatched' | 'harness-proxy-dispatch' | 'trusted-fetch-dispatch' | 'unknown';
  requestedModelId: string; returnedModelId: string | null; httpStatus: number | null;
  responseFormat: ObservedUsage['responseFormat'] | null; requestSha256: string | null; configurationSha256: string;
  error: string | null; cleanupAwaited: boolean;
}
export interface VerifierStudyTransportLlmResult {
  text: string; usage: StudyUsage; observation: VerifierStudyTransportObservation;
}
export interface VerifierStudyTransportFailure {
  text: null; rawOutput: string | null; usage: StudyUsage; observation: VerifierStudyTransportObservation;
}
/** The runner can durably account a failed response without selecting its text. */
export class VerifierStudyTransportError extends Error {
  constructor(readonly result: VerifierStudyTransportFailure) { super(result.observation.error ?? 'Verifier study transport failed'); this.name = result.observation.status === 'cancelled' ? 'AbortError' : 'VerifierStudyTransportError'; }
}
export interface VerifierStudyTransportSecrets { llmKey: string; jevKey: string; }
export interface VerifierStudyTransportGuardContext {
  engine: 'llm' | 'jev'; poolId: string; requestSha256: string; configurationSha256: string; executionSource: VerifierStudyTransportSource;
}
export interface VerifierStudyTransportOptions {
  configuration: { verifier: unknown; jev: unknown };
  secrets: VerifierStudyTransportSecrets;
  /** Synchronous control-plane checks only. Absence ALWAYS denies dispatch. */
  guards?: { assertAuthorized: (context: VerifierStudyTransportGuardContext) => void; assertFresh: () => void };
  /** Trusted test-code seam only; no API/query/config can activate it. Jev fetch
   * must be an in-memory fixture honoring AbortSignal. LLM routes ONLY to
   * literal 127.0.0.1. Ignoring cancellation is not supported or safe. */
  engineering?: { llmBaseUrl: string; jevFetch: typeof fetch };
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factoryTransports = new WeakSet<object>();
const unknownUsage = (): StudyUsage => ({ inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
const exactKeys = (value: unknown, required: string[], optional: string[] = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new Error('Unknown or incomplete transport fields; no credential/endpoint fallback');
};
function immutable<T>(value: T): T {
  const result = structuredClone(value);
  const freeze = (item: unknown) => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); } };
  freeze(result); return result;
}
function synchronousGuard(check: () => unknown) {
  const value = check();
  if (value !== undefined) {
    // Deny thenables without leaking a later unhandled rejection. This is NOT
    // waiting for asynchronous permission or interpreting its resolved value.
    if (value && typeof (value as { then?: unknown }).then === 'function') void Promise.resolve(value).catch(() => undefined);
    throw new Error('Transport guards must be synchronous and throw on denial');
  }
}

/** Track the FIRST native reader cancellation promise. Existing Jev's second
 * reader.cancel can resolve earlier than an in-flight first cancel; awaiting
 * this separate relay cleanup prevents a false cleanupAwaited claim. */
function trackedResponse(response: Response) {
  if (!response.body) return { response, cleanup: async () => {}, assertRedactionSafe: (_redact: <T>(value: T) => T) => {} };
  const reader = response.body.getReader(); let released = false; let finished = false; let cancelling: Promise<void> | undefined;
  const chunks: Uint8Array[] = []; let bodyBytes = 0; let bodyComplete = false;
  const release = () => { if (!released) { reader.releaseLock(); released = true; } };
  const cleanup = (reason?: unknown): Promise<void> => {
    if (cancelling) return cancelling;
    if (released) return Promise.resolve();
    cancelling = reader.cancel(reason).catch(() => undefined).finally(release);
    return cancelling;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try { const part = await reader.read(); if (part.done) { finished = true; bodyComplete = true; release(); controller.close(); }
        else { bodyBytes += part.value.byteLength; if (bodyBytes <= 200000) chunks.push(part.value.slice()); else chunks.length = 0; controller.enqueue(part.value); } }
      catch (error) { finished = true; release(); controller.error(error); }
    },
    cancel(reason) { return cleanup(reason); },
  });
  const assertRedactionSafe = (redact: <T>(value: T) => T) => {
    if (!bodyComplete || bodyBytes > 200000) return;
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { return; }
    // Check original properties BEFORE existing Jev's one-key sanitizer can
    // collapse two distinct keys into the same replacement property.
    redact(parsed);
  };
  return { response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }), cleanup, assertRedactionSafe };
}

/** Exact two-key masking includes JSON-escaped variants, strings nested inside
 * JSON strings, and property names. This also supports legacy escaped secrets
 * for auditing; actual transport keys still require the page credential schema. */
export function createVerifierStudyRedactor(secrets: VerifierStudyTransportSecrets) {
  exactKeys(secrets, ['llmKey', 'jevKey']);
  const variants = new Set<string>();
  for (const secret of [secrets.llmKey, secrets.jevKey]) {
    if (typeof secret !== 'string' || secret.length < 16 || secret.length > 500 || !/^[\x21-\x7e]+$/.test(secret)) throw new Error('Invalid independent transport secret');
    let current = secret;
    for (let depth = 0; depth <= 4; depth++) { variants.add(current); current = JSON.stringify(current).slice(1, -1); }
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  const assertNoResidual = (value: string) => { if (ordered.some(variant => value.includes(variant))) throw new Error('Secret redaction residual; refusing to export evidence'); };
  const text = (value: string) => { let result = value; for (const variant of ordered) result = result.split(variant).join('[REDACTED]'); assertNoResidual(result); return result; };
  const walk = <T>(value: T): T => {
    if (typeof value === 'string') return text(value) as T;
    if (Array.isArray(value)) return value.map(walk) as T;
    if (value && typeof value === 'object') {
      const entries: Array<[string, unknown]> = []; const names = new Set<string>();
      for (const [key, child] of Object.entries(value)) { const name = text(key);
        if (names.has(name)) throw new Error('Secret redaction property-name collision; evidence cannot silently overwrite fields');
        names.add(name); entries.push([name, walk(child)]); }
      return Object.fromEntries(entries) as T;
    }
    return value;
  };
  const redact = <T>(value: T): T => {
    const result = walk(value); const serialized = JSON.stringify(result);
    // Numeric arrays/scalars and serialization boundaries can form an otherwise
    // invisible ASCII key. Never return a value whose final JSON export leaks.
    if (typeof serialized === 'string') assertNoResidual(serialized);
    return result;
  };
  return redact;
}

/** Real adapters are constructed but default DENY. This module never reads a
 * store/environment/key file, grants a budget, or accepts arbitrary prompts.
 * The runner must persist its intent and authorize this exact configuration
 * before invoking a transport. Engineering seams remain clearly separate. */
export function createVerifierStudyTransport(options: VerifierStudyTransportOptions) {
  exactKeys(options, ['configuration', 'secrets'], ['guards', 'engineering']);
  exactKeys(options.configuration, ['verifier', 'jev']); exactKeys(options.secrets, ['llmKey', 'jevKey']);
  // Do not include Zod's arbitrary input in errors or export keys in config.
  if (!productionApiKeySchema.safeParse(options.secrets.llmKey).success || !productionApiKeySchema.safeParse(options.secrets.jevKey).success) throw new Error('Independent transport keys violate the page credential policy');
  if ([options.secrets.llmKey, options.secrets.jevKey].some(key => key.includes('[REDACTED]'))) throw new Error('Transport keys cannot contain the replacement marker');
  const secrets = { llmKey: options.secrets.llmKey, jevKey: options.secrets.jevKey };
  const redact = createVerifierStudyRedactor(secrets);
  let parsed: ReturnType<typeof verifierStudyPublicConfiguration>;
  try { parsed = verifierStudyPublicConfiguration(options.configuration); }
  catch (error) { throw new Error(redact(error instanceof Error ? error.message : 'Invalid public transport configuration')); }
  const configuration = immutable(parsed);
  if (!['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(configuration.verifier.baseUrl) || !configuration.verifier.hasApiKey || !configuration.jev.enabled || !configuration.jev.hasApiKey) throw new Error('Transport requires complete official HTTPS public configuration and independent keys');
  const wireOptions = { provider: 'deepseek' as const, upstreamBaseUrl: configuration.verifier.baseUrl, modelId: configuration.verifier.modelId, maxOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS, timeoutMs: STUDY_PROPOSED_LLM_TIMEOUT_MS };
  const configurationSha256 = digest({ ...configuration, options: wireOptions });
  const prepared = VERIFIER_CHALLENGE_IDS.map(poolId => immutable(verifierPreparationRequests(poolId)));
  const preparedSha256 = digest(prepared);
  const publicContract = { configuration, wireOptions, prepared,
    protocol: { version: VERIFIER_STUDY_TRANSPORT_VERSION, executionSources: ['real-provider', 'loopback-engineering'],
      errorTypes: ['VerifierStudyTransportError', 'AbortError'],
      fieldNames: ['executionSource', 'actualProviderHttpAttempts', 'localFixtureHttpAttempts', 'fixtureDispatchKind', 'countEvidence', 'requestedModelId', 'returnedModelId', 'responseFormat', 'requestSha256', 'configurationSha256', 'cleanupAwaited', 'publicConfiguration', 'rawOutput', 'inputTokens', 'outputTokens', 'estimatedCost', 'complete'],
      statuses: ['completed', 'failed', 'cancelled', 'denied'], countEvidence: ['not-dispatched', 'harness-proxy-dispatch', 'trusted-fetch-dispatch', 'unknown'] },
  };
  if (JSON.stringify(redact(publicContract)) !== JSON.stringify(publicContract)) throw new Error('Secret collides with public contract; refusing before dispatch');
  let llmBaseUrl = configuration.verifier.baseUrl;
  const engineeringInput = options.engineering;
  if (engineeringInput) exactKeys(engineeringInput, ['llmBaseUrl', 'jevFetch']);
  const engineering = engineeringInput ? { llmBaseUrl: engineeringInput.llmBaseUrl, jevFetch: engineeringInput.jevFetch } : undefined;
  if (engineering) {
    exactKeys(engineering, ['llmBaseUrl', 'jevFetch']);
    const url = new URL(engineering.llmBaseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024 || url.username || url.password || url.search || url.hash || url.pathname !== '/' || typeof engineering.jevFetch !== 'function') throw new Error('Engineering hooks require literal loopback ephemeral origin and a trusted fixture fetch');
    llmBaseUrl = `${url.origin}${observerPathFor(new URL(configuration.verifier.baseUrl))}`;
  }
  const executionSource: VerifierStudyTransportSource = engineering ? 'loopback-engineering' : 'real-provider';
  const guardInput = options.guards;
  if (guardInput) { exactKeys(guardInput, ['assertAuthorized', 'assertFresh']); if (typeof guardInput.assertAuthorized !== 'function' || typeof guardInput.assertFresh !== 'function') throw new Error('Invalid synchronous transport guards'); }
  const guards = guardInput ? { assertAuthorized: guardInput.assertAuthorized, assertFresh: guardInput.assertFresh } : undefined;
  let busy = false;
  const bind = (engine: 'llm' | 'jev', request: unknown) => {
    const hash = digest(request);
    const match = prepared.find(item => digest(engine === 'llm' ? item.logicalLlm : item.snapshot) === hash);
    if (!match) throw new Error('Request differs from the complete fixed 18-pool whitelist');
    if (digest(VERIFIER_CHALLENGE_IDS.map(poolId => verifierPreparationRequests(poolId))) !== preparedSha256) throw new Error('Frozen request/source contract changed');
    return { poolId: match.metadata.poolId, requestSha256: hash };
  };
  const authorize = (engine: 'llm' | 'jev', request: unknown, signal: AbortSignal) => {
    signal.throwIfAborted(); if (busy) throw new Error('Concurrent verifier transports are forbidden');
    const binding = bind(engine, request);
    if (!guards) throw new Error('Transport dispatch denied: explicit authorization and source guards required');
    synchronousGuard(() => guards.assertFresh()); synchronousGuard(() => guards.assertAuthorized(immutable({ engine, ...binding, configurationSha256, executionSource })));
    signal.throwIfAborted(); busy = true; return binding;
  };
  const observation = (engine: 'llm' | 'jev'): VerifierStudyTransportObservation => ({ version: VERIFIER_STUDY_TRANSPORT_VERSION, executionSource, engine, poolId: null,
    status: 'denied', actualProviderHttpAttempts: 0, localFixtureHttpAttempts: engineering ? 0 : null,
    fixtureDispatchKind: engineering ? engine === 'llm' ? 'loopback-http-post' : 'in-memory-fetch' : null, countEvidence: 'not-dispatched',
    requestedModelId: engine === 'llm' ? configuration.verifier.modelId : configuration.jev.modelId, returnedModelId: null,
    httpStatus: null, responseFormat: engine === 'llm' ? { version: HARNESS_JSON_OUTPUT_VERSION, mode: 'json-object', evidence: 'requested' } : null,
    requestSha256: null, configurationSha256, error: null, cleanupAwaited: true });
  const account = (input: number | null | undefined, output: number | null | undefined, complete: boolean, engine: 'llm' | 'jev'): StudyUsage => {
    if (complete !== true || !Number.isSafeInteger(input) || input! < 0 || !Number.isSafeInteger(output) || output! < 0) return unknownUsage();
    const rates = engine === 'llm' ? configuration.verifier.pricing! : configuration.jev;
    return { inputTokens: input!, outputTokens: output!, estimatedCost: (input! * rates.inputPerMillion + output! * rates.outputPerMillion) / 1_000_000, complete: true, currency: 'USD' };
  };
  const annotate = (value: VerifierStudyTransportObservation, requests: number | undefined) => {
    const count = Number.isSafeInteger(requests) && requests! >= 0 && requests! <= 1 ? requests! : null;
    value.actualProviderHttpAttempts = engineering ? 0 : count; value.localFixtureHttpAttempts = engineering ? count : null;
    value.countEvidence = count === null ? 'unknown' : count === 0 ? 'not-dispatched' : value.engine === 'llm' ? 'harness-proxy-dispatch' : 'trusted-fetch-dispatch';
  };
  const postflight = (engine: 'llm' | 'jev', request: unknown, signal: AbortSignal) => {
    if (!guards) throw new Error('Post-call source guard is absent'); synchronousGuard(() => guards.assertFresh());
    bind(engine, request); signal.throwIfAborted();
  };
  const transport = Object.freeze({
    version: VERIFIER_STUDY_TRANSPORT_VERSION, executionSource, publicConfiguration: configuration, configurationSha256, redact,
    async llm(request: { systemPrompt: string; userPrompt: string }, signal: AbortSignal): Promise<VerifierStudyTransportLlmResult> {
      const evidence = observation('llm'); let dispatched = false; let usage = unknownUsage(); let rawOutput: string | null = null;
      try {
        const frozenRequest = immutable(request);
        const binding = authorize('llm', frozenRequest, signal); Object.assign(evidence, binding); dispatched = true; evidence.cleanupAwaited = false;
        const result = await runRole({ provider: 'deepseek', baseUrl: llmBaseUrl, modelId: configuration.verifier.modelId, apiKey: secrets.llmKey }, frozenRequest.systemPrompt, frozenRequest.userPrompt, signal, undefined, { maxOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS, timeoutMs: STUDY_PROPOSED_LLM_TIMEOUT_MS, responseMode: 'json-object', reportUsage: true });
        evidence.cleanupAwaited = true; evidence.status = 'completed'; evidence.httpStatus = result.providerRequests?.status ?? null;
        evidence.responseFormat = result.providerRequests?.responseFormat ?? evidence.responseFormat; annotate(evidence, result.providerRequests?.requests);
        rawOutput = result.text; usage = account(result.inputTokens, result.outputTokens, result.usageReported === true, 'llm');
        postflight('llm', frozenRequest, signal);
        return redact({ text: result.text, usage, observation: evidence });
      } catch (error) {
        evidence.status = signal.aborted ? 'cancelled' : dispatched ? 'failed' : 'denied'; evidence.error = error instanceof Error ? error.message : 'Verifier Harness call failed'; evidence.cleanupAwaited = true;
        if (dispatched && evidence.countEvidence === 'not-dispatched') annotate(evidence, error instanceof HarnessCallError ? error.evidence.providerRequests?.requests : undefined);
        if (error instanceof HarnessCallError) {
          const wire = error.evidence.providerRequests;
          evidence.httpStatus = wire?.status ?? null; evidence.responseFormat = wire?.responseFormat ?? evidence.responseFormat;
          // A failed/empty/cancelled call may lack an SDK assistant message and
          // therefore normalized counts. Preserve complete trusted wire usage
          // for billing evidence; this NEVER makes its partial text selectable.
          // Successful answer selection still requires runRole's cross-check.
          usage = account(wire?.inputTokens, wire?.outputTokens, wire?.complete === true, 'llm'); rawOutput = error.evidence.text;
        }
        throw new VerifierStudyTransportError(redact({ text: null, rawOutput, usage, observation: evidence }));
      } finally { if (dispatched) busy = false; }
    },
    async jev(request: JevCandidateContext, signal: AbortSignal): Promise<JevEvaluation & { observation: VerifierStudyTransportObservation }> {
      const evidence = observation('jev'); let dispatched = false; let fetchCalls = 0; let usage = unknownUsage(); let rawOutput: string | null = null; let cleanupResponse = async () => {}; let assertResponseRedactionSafe = () => {};
      try {
        const frozenRequest = immutable(request);
        const binding = authorize('jev', frozenRequest, signal); Object.assign(evidence, binding); dispatched = true; evidence.cleanupAwaited = false;
        const trustedFetch: typeof fetch = async (url, init) => {
          if (String(url) !== JEV_ENDPOINT || init?.method !== 'POST' || init.redirect !== 'error' || fetchCalls >= 1) throw new Error('Jev dispatch scope/retry violation');
          fetchCalls++; const fetched = await (engineering?.jevFetch ?? fetch)(url, init);
          const tracked = trackedResponse(fetched); cleanupResponse = tracked.cleanup; assertResponseRedactionSafe = () => tracked.assertRedactionSafe(redact); return tracked.response;
        };
        const result = await evaluateJevCandidates({ ...configuration.jev, apiKey: secrets.jevKey }, frozenRequest, signal, { fetch: trustedFetch });
        await cleanupResponse();
        evidence.cleanupAwaited = true; evidence.status = signal.aborted ? 'cancelled' : result.status === 'error' ? 'failed' : 'completed';
        evidence.httpStatus = result.httpStatus; evidence.returnedModelId = result.modelIdReturned; evidence.error = result.error ?? null; annotate(evidence, fetchCalls);
        usage = account(result.usage.inputTokens, result.usage.outputTokens, result.usage.complete, 'jev'); rawOutput = result.rawResponse === null ? null : JSON.stringify(result.rawResponse);
        assertResponseRedactionSafe();
        postflight('jev', frozenRequest, signal);
        return redact({ ...result, usage, observation: evidence });
      } catch (error) {
        await cleanupResponse();
        evidence.status = signal.aborted ? 'cancelled' : dispatched ? 'failed' : 'denied'; evidence.error = error instanceof Error ? error.message : 'Verifier Jev call failed'; evidence.cleanupAwaited = true;
        if (dispatched) annotate(evidence, fetchCalls);
        throw new VerifierStudyTransportError(redact({ text: null, rawOutput, usage, observation: evidence }));
      } finally { if (dispatched) busy = false; }
    },
  });
  factoryTransports.add(transport); return transport;
}

export type VerifierStudyTransport = ReturnType<typeof createVerifierStudyTransport>;
/** Private object identity brand; copying callbacks cannot label mocks real. */
export function assertVerifierStudyTransport(value: unknown): asserts value is VerifierStudyTransport {
  if (!value || typeof value !== 'object' || !factoryTransports.has(value)) throw new Error('Observed study requires a branded guarded transport factory, not arbitrary callbacks');
}
