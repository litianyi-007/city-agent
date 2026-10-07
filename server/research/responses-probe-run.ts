import { createHash } from 'node:crypto';
import { fingerprint } from '../../shared/evidence';
import { containsKnownSecret } from '../../shared/redaction';
import { evaluateResponsesProbeAnswer, RESPONSES_PROBE_MODEL, type ResponsesProbeCase, type ResponsesProbeEvaluation } from '../../shared/responses-probe-plan';
import type { RoleModelConfig } from '../harness';
import type { ExperimentBudgetGuard } from './experiment-budget';
import { compileResponsesRequest, RESPONSES_UPSTREAM_URL } from './responses-relay';
import { createResponsesStreamWitness } from './responses-stream.mjs';
import { assertProbeRequest, validateProbeRegistration, type ProbeRegistration } from './responses-probe-registration';
import { runStructuredResponsesHarness, StructuredResponsesError, type StructuredResponsesEvidence } from './structured-responses-harness';

const MAX_BYTES = 512_000, sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Host-only single-use observer; the live CLI offers no transport/URL injection. */
export function createProbeRecorder(probe: ResponsesProbeCase, apiKey: string, fetchImpl: typeof fetch = fetch) {
  let attempts = 0, forwarded = 0, status: number | null = null, receivedBytes = 0;
  let providerMediaType: 'text/event-stream' | 'application/json' | 'other' | null = null;
  let complete = false, overflow = false, cleanupFailed = false, finished = false;
  const chunks: Buffer[] = [], controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, cancelPromise: Promise<void> | undefined;
  let transportClosed: Promise<void> | undefined, closeTransport: (() => void) | undefined;
  const boundedCleanup = async (operation: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Probe recorder cleanup timeout.')), 2_000); })]); }
    catch { cleanupFailed = true; }
    finally { if (timer) clearTimeout(timer); }
  };
  const cancelReader = () => cancelPromise ??= (async () => {
    controller.abort();
    if (!reader) return;
    await boundedCleanup(reader.cancel());
  })();
  const fetcher: typeof fetch = async (url, init) => {
    attempts++;
    const headers = new Headers(init?.headers);
    if (finished || attempts !== 1 || String(url) !== RESPONSES_UPSTREAM_URL || init?.method !== 'POST' || init.redirect !== 'error'
      || init.body !== probe.frozenRequest.body || !init.signal || init.signal.aborted
      || Object.keys(init).some(key => !['method', 'redirect', 'headers', 'body', 'signal'].includes(key))
      || headers.get('authorization') !== `Bearer ${apiKey}` || headers.get('content-type') !== 'application/json'
      || [...headers.keys()].some(key => !['authorization', 'content-type'].includes(key))) throw new Error('Unregistered probe wire rejected.');
    forwarded++;
    transportClosed = new Promise<void>(resolve => { closeTransport = resolve; });
    try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.any([init.signal, controller.signal]) });
    if (finished || controller.signal.aborted || init.signal.aborted) {
      if (response.body) await boundedCleanup(response.body.cancel());
      throw new Error('Probe response arrived after cancellation.');
    }
    status = response.status;
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    providerMediaType = mediaType === 'text/event-stream' || mediaType === 'application/json' ? mediaType : 'other';
    if (!response.body) { complete = true; return response; }
    reader = response.body.getReader();
    const observed = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const next = await reader!.read();
          // reader.cancel() can resolve an already pending read with done:true.
          // That is not upstream EOF; never certify a cancelled prefix as complete.
          if (finished || controller.signal.aborted) { target.error(new Error('Probe body cancelled before EOF.')); return; }
          if (next.done) { complete = true; reader!.releaseLock(); reader = undefined; target.close(); return; }
          receivedBytes += next.value.byteLength;
          if (receivedBytes > MAX_BYTES) { overflow = true; await cancelReader(); target.error(new Error('Probe response exceeded byte cap.')); return; }
          chunks.push(Buffer.from(next.value)); target.enqueue(next.value);
        } catch { await cancelReader(); target.error(new Error('Probe response transport failed.')); }
      },
      async cancel() { await cancelReader(); },
    }, { highWaterMark: 0 });
    return new Response(observed, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' } });
    } finally { closeTransport?.(); }
  };
  return { fetcher,
    async finish() { finished = true; await cancelReader(); if (transportClosed) await boundedCleanup(transportClosed); },
    snapshot() {
      const bytes = Buffer.concat(chunks);
      let unsafeReason: 'secret-echo' | 'invalid-utf8' | 'not-complete' | null = complete && !overflow ? null : 'not-complete';
      if (!unsafeReason) {
        try { if (containsKnownSecret(new TextDecoder('utf-8', { fatal: true }).decode(bytes), apiKey)) unsafeReason = 'secret-echo'; }
        catch { unsafeReason = 'invalid-utf8'; }
      }
      return { version: 'bounded-provider-original-recorder-1.0' as const, attempts, forwarded, providerStatus: status, providerMediaType,
        state: complete && !overflow ? 'eof-complete' as const : forwarded ? 'partial-or-no-body' as const : 'not-called' as const,
        receivedBytes, retainedBytes: bytes.length, completeSha256: complete && !overflow ? sha(bytes) : null,
        receivedPrefixSha256: complete && !overflow ? null : bytes.length ? sha(bytes) : null, overflow, cleanupFailed, unsafeReason,
        rawBytes: !unsafeReason && !cleanupFailed ? bytes : null,
        meaning: 'Only bytes actually pulled by relay; full hash requires EOF. Partial/overflow/unsafe original is not exported.' };
    } };
}

export interface ProbeSlot {
  id: ResponsesProbeCase['id']; requestId: string; status: 'not-started' | 'in-progress' | 'passed' | 'failed';
  startedAt: string | null; endedAt: string | null; durationMs: number | null; failureCode: string | null;
  httpAccepted: boolean | null; protocolCompleted: boolean | null; structureConformance: 'not-evaluated' | 'checked' | 'conflict';
  keywordExecution: 'unknown'; evaluation: ResponsesProbeEvaluation | null; evidence: StructuredResponsesEvidence | null;
  recorder: Omit<ReturnType<ReturnType<typeof createProbeRecorder>['snapshot']>, 'rawBytes'> | null;
}

/** Sequential executor. Every first failure stops ALL; checkpoint and source seal precede the next request. */
export async function runResponsesProbe(input: {
  plan: ProbeRegistration; guard: ExperimentBudgetGuard; model: RoleModelConfig; signal: AbortSignal;
  assertSources: () => Promise<void>;
  checkpoint: (slots: ProbeSlot[], original?: { id: ProbeSlot['id']; bytes: Buffer }) => Promise<void>;
  /** Unit fixtures only; not accepted by CLI flags or authorization. */
  fetchImpl?: typeof fetch;
}) {
  const plan = validateProbeRegistration(input.plan);
  if (fingerprint({ provider: input.model.provider, baseUrl: input.model.baseUrl, modelId: input.model.modelId }) !== fingerprint(RESPONSES_PROBE_MODEL)
    || containsKnownSecret(JSON.stringify(plan), input.model.apiKey)
    || input.guard.snapshot().budgetCny !== 1 || input.guard.snapshot().maxProviderRequests !== 2) throw new Error('Probe model, payload or budget scope invalid.');
  const slots: ProbeSlot[] = plan.cases.map(probe => ({ id: probe.id, requestId: probe.requestId, status: 'not-started',
    startedAt: null, endedAt: null, durationMs: null, failureCode: null, httpAccepted: null, protocolCompleted: null,
    structureConformance: 'not-evaluated', keywordExecution: 'unknown', evaluation: null, evidence: null, recorder: null }));
  const halt = (reason: string) => { if (input.guard.snapshot().state === 'active') input.guard.stop(reason); };
  let stopReason: string | null = null;
  try {
    await input.checkpoint(structuredClone(slots));
    for (const [index, probe] of plan.cases.entries()) {
      if (stopReason || input.signal.aborted || input.guard.snapshot().state !== 'active') { stopReason ??= input.signal.aborted ? 'probe-cancelled' : 'probe-budget-halted'; halt(stopReason); break; }
      await input.assertSources(); assertProbeRequest(plan, index, probe);
      const compiled = compileResponsesRequest({ model: input.model, contract: probe.contract, system: probe.system, user: probe.user, maxOutputTokens: 3000 });
      if (fingerprint(compiled) !== fingerprint(probe.frozenRequest)) throw new Error('Probe frozen wire drift.');
      const slot = slots[index], start = performance.now(); slot.status = 'in-progress'; slot.startedAt = new Date().toISOString();
      await input.checkpoint(structuredClone(slots));
      const recorder = createProbeRecorder(probe, input.model.apiKey, input.fetchImpl);
      let failure: string | null = null, nativeRaw: string | null = null;
      try {
        const result = await runStructuredResponsesHarness({ guard: input.guard, requestId: probe.requestId, purpose: probe.purpose,
          model: input.model, contract: probe.contract, system: probe.system, user: probe.user, signal: input.signal,
          maxOutputTokens: 3000, upstreamFetch: recorder.fetcher });
        slot.evidence = result.evidence; nativeRaw = result.raw;
      } catch (error) { slot.evidence = error instanceof StructuredResponsesError ? error.evidence : null; failure = error instanceof StructuredResponsesError ? error.code : 'probe-invocation-failed'; }
      finally { await recorder.finish(); }
      const { rawBytes, ...recorded } = recorder.snapshot(); slot.recorder = recorded;
      slot.httpAccepted = recorded.providerStatus === null ? null : recorded.providerStatus === 200;
      slot.protocolCompleted = slot.evidence?.transport ? slot.evidence.transport.providerWitness.state === 'reported' : null;
      // This capability registration admits exactly the documented HTTP 200.
      // The generic relay's broader 2xx transport tolerance must not widen it.
      if (slot.httpAccepted !== true) failure ??= 'probe-http-not-accepted';
      if (recorded.cleanupFailed || recorded.overflow || recorded.unsafeReason === 'secret-echo' || recorded.unsafeReason === 'invalid-utf8') failure ??= 'probe-original-unsafe';
      if (recorded.attempts !== 1 || recorded.forwarded !== 1 || recorded.state !== 'eof-complete') failure ??= 'probe-original-incomplete';
      if (recorded.state === 'eof-complete' && recorded.completeSha256 !== slot.evidence?.transport?.providerWitness.rawResponseSha256) failure ??= 'probe-original-hash-mismatch';
      try {
      if (!nativeRaw && rawBytes && slot.httpAccepted) {
        // Forensic-only recovery of the same terminal text; never repairs, retries,
        // turns a failed Harness invocation into success, or bypasses its decoder.
        const witness = createResponsesStreamWitness({ expectedModel: input.model.modelId }); witness.observe(rawBytes); witness.complete();
        if (witness.snapshot().state === 'reported') nativeRaw = witness.snapshot().text;
      }
      if (nativeRaw && !containsKnownSecret(nativeRaw, input.model.apiKey)) {
        slot.evaluation = evaluateResponsesProbeAnswer(probe, nativeRaw);
        slot.structureConformance = slot.evaluation.structure.status;
        if (!slot.evaluation.passed) failure ??= 'probe-quality-rejected';
      }
      } catch { failure ??= 'probe-answer-audit-failed'; }
      if (!slot.evaluation) failure ??= 'probe-no-safe-answer';
      if (input.signal.aborted) failure ??= 'probe-cancelled';
      slot.durationMs = performance.now() - start; slot.endedAt = new Date().toISOString(); slot.failureCode = failure;
      slot.status = failure ? 'failed' : 'passed';
      if (failure) { stopReason = failure; halt('probe-first-failure'); }
      await input.checkpoint(structuredClone(slots), rawBytes ? { id: probe.id, bytes: rawBytes } : undefined);
      await input.assertSources();
      if (stopReason) break;
    }
  } catch { stopReason ??= 'probe-preflight-or-storage-failed'; halt('probe-preflight-or-storage-failed'); }
  if (input.signal.aborted) { stopReason ??= 'probe-cancelled'; halt('probe-cancelled'); }
  for (const slot of slots) if (slot.status === 'in-progress') { slot.status = 'failed'; slot.failureCode = stopReason; slot.endedAt = new Date().toISOString(); }
  return { version: 'responses-probe-run-1.0', slots, stopReason, status: !stopReason && slots.every(slot => slot.status === 'passed') ? 'passed' : 'stopped',
    planned: 2, passed: slots.filter(slot => slot.status === 'passed').length, failed: slots.filter(slot => slot.status === 'failed').length,
    notStarted: slots.filter(slot => slot.status === 'not-started').length,
    marketResearchValidated: false, personaContributionValidated: false, keywordExecution: 'unknown' };
}
