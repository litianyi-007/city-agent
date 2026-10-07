import type { JevEvaluation } from './jev-schema.js';
import type { ProductionRun } from './production-schema.js';

type RequestRun = Pick<ProductionRun, 'calls' | 'jevCalls'> & Partial<Pick<ProductionRun, 'evidenceKind'>>;
type LedgerRun = RequestRun & Pick<ProductionRun, 'usage'>;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const currency = (value: unknown): value is 'USD' | 'CNY' => value === 'USD' || value === 'CNY';
function safeCountSum(values: Array<number | null>): number | null {
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return count(sum) ? sum : null;
}

/** A saved initial intent is not an observation of zero HTTP requests.
 * Missing legacy observation fields have the same unknown meaning as null.
 * A completed preflight failure with an error and observed requests=0 remains 0.
 */
export function isUnresolvedJevIntent(evaluation: JevEvaluation): boolean {
  return evaluation.providerRequests === 0 && evaluation.requestSnapshot == null && evaluation.rawResponse == null && evaluation.httpStatus == null && evaluation.modelIdReturned == null && !evaluation.error && !evaluation.usage?.complete;
}

/** Read-only projection of explicit observation fields. Neither role/model
 * metadata nor a missing legacy execution source proves a provider request.
 * The deprecated aliases are retained for existing material/report consumers.
 */
export function productionRequestCounts(run: RequestRun) {
  const harness = run.calls.filter(call => call.executionSource === 'harness');
  const unclassifiedCallRecords = run.calls.filter(call => !['harness', 'mock', 'injected'].includes(call.executionSource)).length;
  const harnessCounts = harness.map(call => count(call.providerRequests?.requests) ? call.providerRequests!.requests : null);
  const jevDispatchCounts = (run.jevCalls ?? []).map(call => !isUnresolvedJevIntent(call.evaluation) && count(call.evaluation.providerRequests) ? call.evaluation.providerRequests : null);
  // An in-memory injected fetch can report a dispatch without a physical HTTP
  // request. Without transport provenance it is not provider HTTP evidence.
  const jevCounts = run.evidenceKind === 'injected-test' ? jevDispatchCounts.map(() => null) : jevDispatchCounts;
  const unknownHarnessRequestIntents = harnessCounts.filter(value => value === null).length;
  const unknownJevRequestIntents = jevCounts.filter(value => value === null).length;
  const unknownRequestIntents = unknownHarnessRequestIntents + unknownJevRequestIntents + unclassifiedCallRecords;
  const knownHarnessProviderRequests = safeCountSum(harnessCounts);
  const knownJevProviderRequests = safeCountSum(jevCounts);
  const knownProviderRequests = safeCountSum([...harnessCounts, ...jevCounts]);
  return {
    callRecords: run.calls.length,
    budgetRecords: run.calls.length + (run.jevCalls?.length ?? 0),
    harnessInvocations: harness.length,
    simulatedStageRecords: run.calls.filter(call => call.executionSource === 'mock').length,
    injectedTestRecords: run.calls.filter(call => call.executionSource === 'injected').length,
    unclassifiedCallRecords,
    observedJevDispatches: safeCountSum(jevDispatchCounts),
    unknownJevDispatchIntents: jevDispatchCounts.filter(value => value === null).length,
    unverifiedJevDispatches: run.evidenceKind === 'injected-test' ? safeCountSum(jevDispatchCounts) : 0,
    actualProviderRequests: unknownRequestIntents ? null : knownProviderRequests,
    knownProviderRequests, unknownRequestIntents,
    knownHarnessProviderRequests, unknownHarnessRequestIntents,
    jevProviderRequests: unknownJevRequestIntents ? null : knownJevProviderRequests,
    knownJevProviderRequests, unknownJevRequestIntents,
    actualProviderRequestsDefinition: 'Observed HTTP attempts, not an invoice; unresolved intents are unknown, known subtotal retained',
    actualModelCalls: harness.length,
    actualModelCallsDefinition: 'Deprecated alias of Harness invocations; use actualProviderRequests for HTTP attempts',
  };
}

export interface ProductionUsageSubtotal {
  knownSubtotal: number | null;
  reportedEntries: number;
  unknownEntries: number;
  overflow: boolean;
}

/** Independently subtotal every reported field. Known zero is retained;
 * unknown never becomes zero, and unlike the original aggregate, partial
 * observations remain visible. Cross-currency costs are not added together.
 * This function does not mutate or replace run.usage or historical evidence.
 */
export function productionUsageLedger(run: LedgerRun) {
  const entries = [...run.calls.map(call => call.usage), ...(run.jevCalls ?? []).map(call => call.evaluation.usage)];
  const sameCurrency = (value: unknown) => currency(run.usage.currency) && currency(value) && value === run.usage.currency;
  function subtotal(field: 'inputTokens' | 'outputTokens' | 'estimatedCost'): ProductionUsageSubtotal {
    let sum = 0; let reportedEntries = 0; let unknownEntries = 0;
    for (const entry of entries) {
      const value = entry?.[field];
      const valid = field === 'estimatedCost' ? amount(value) && sameCurrency(entry.currency) : count(value);
      if (valid) { sum += value!; reportedEntries++; } else unknownEntries++;
    }
    const overflow = field === 'estimatedCost' ? !amount(sum) : !count(sum);
    return { knownSubtotal: reportedEntries === 0 || overflow ? null : sum, reportedEntries, unknownEntries, overflow };
  }
  return {
    entries: entries.length,
    inputTokens: subtotal('inputTokens'), outputTokens: subtotal('outputTokens'), estimatedCost: subtotal('estimatedCost'),
    currency: currency(run.usage.currency) ? run.usage.currency : null,
    currencyMismatchEntries: entries.filter(entry => amount(entry?.estimatedCost) && !sameCurrency(entry.currency)).length,
    unknownUsageEntries: entries.filter(entry => !count(entry?.inputTokens) || !count(entry?.outputTokens) || !amount(entry?.estimatedCost) || !sameCurrency(entry.currency)).length,
  };
}

export function projectProductionLedger(run: LedgerRun) {
  return { requests: productionRequestCounts(run), usage: productionUsageLedger(run) };
}
