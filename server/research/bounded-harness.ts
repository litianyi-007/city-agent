import { HarnessCallError, runRole, type RoleModelConfig, type RoleResult } from '../harness';
import type { ExperimentBudgetGuard } from './experiment-budget';
import { createSingleRequestRelay, type SingleRequestRelaySnapshot } from './single-request-relay';

/** Only this relay-backed boundary upgrades normalized SDK counters to known provider usage. */
function witnessedUsage(transport: SingleRequestRelaySnapshot | undefined, inputTokens: unknown, outputTokens: unknown) {
  const witness = transport?.providerUsageWitness;
  if (transport?.forwardedRequests !== 1 || transport.requestAttempts !== 1 || transport.deniedRequests !== 0
    || transport.forwardedBodySha256 !== transport.frozenBodySha256 || witness?.state !== 'reported' || !witness.usage
    || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
    || inputTokens !== witness.usage.inputTokens || outputTokens !== witness.usage.outputTokens) return null;
  return { inputTokens: witness.usage.inputTokens, outputTokens: witness.usage.outputTokens };
}

export async function runBoundedHarness(input: {
  guard: ExperimentBudgetGuard;
  requestId: string;
  purpose: string;
  model: RoleModelConfig;
  system: string;
  user: string;
  signal: AbortSignal;
  maxOutputTokens: number;
  onEvent?: (message: string) => void;
  onTransport?: (snapshot: SingleRequestRelaySnapshot) => void;
  /** Local fixtures only inject transport/runner; production uses the real relay and Harness. */
  upstreamFetch?: typeof fetch;
  roleRunner?: typeof runRole;
}): Promise<RoleResult> {
  const { guard, model, system, user, signal, maxOutputTokens } = input;
  const reservation = guard.reserve({ requestId: input.requestId, purpose: input.purpose,
    inputText: JSON.stringify({ system, user }), maxOutputTokens, inputEnvelopeTokens: 16384 });
  let relay: Awaited<ReturnType<typeof createSingleRequestRelay>> | undefined;
  try {
    relay = await createSingleRequestRelay({ model, maxOutputTokens, reservedInputTokens: reservation.reservedInputTokens,
      expectedPrompts: { system, user }, upstreamFetch: input.upstreamFetch });
    const result = await (input.roleRunner ?? runRole)({ ...model, baseUrl: relay.baseUrl }, system, user, signal, input.onEvent,
      { maxOutputTokens, timeoutMs: 90_000, reportUsage: true });
    const usage = result.usageReported === true ? witnessedUsage(relay.snapshot(), result.inputTokens, result.outputTokens) : null;
    const ledger = guard.settle(reservation.reservationId, { outcome: 'succeeded', usage });
    if (ledger.state === 'halted') throw new HarnessCallError('预算检查停止后续请求：上游用量未被完整核验或超预留。',
      { text: result.text, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null });
    return { ...result, ...usage!, usageReported: true };
  } catch (error) {
    const evidence = error instanceof HarnessCallError ? error.evidence : undefined;
    const usage = witnessedUsage(relay?.snapshot(), evidence?.inputTokens, evidence?.outputTokens);
    if (guard.snapshot().reservations.some(entry => entry.reservationId === reservation.reservationId && entry.state === 'reserved')) {
      guard.settle(reservation.reservationId, { outcome: signal.aborted ? 'cancelled' : 'failed', usage });
    }
    if (error instanceof HarnessCallError && !usage) throw new HarnessCallError(error.message, { text: error.evidence.text, inputTokens: null, outputTokens: null });
    throw error;
  } finally {
    try { if (relay) input.onTransport?.(relay.snapshot()); }
    finally {
      try { await relay?.close(); }
      catch (error) { if (guard.snapshot().state === 'active') guard.stop('transport-cleanup-failed'); throw error; }
    }
  }
}
