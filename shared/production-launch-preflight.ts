import type { ProductionAgent, ProductionRunInput } from './production-schema.js';

export const PRODUCTION_LAUNCH_PREFLIGHT_VERSION = 'production-launch-preflight-v1' as const;
/** Same conservative per-request reservation used by the paid pipeline. */
export const PRODUCTION_INPUT_TOKEN_RESERVATION = 65536;
export function estimateProductionCost(pricing: ProductionAgent['pricing'] | null | undefined, inputTokens: number, outputTokens: number): number | null {
  return pricing ? (inputTokens * pricing.inputPerMillion + outputTokens * pricing.outputPerMillion) / 1e6 : null;
}
export function productionLaunchCallEnvelope(candidateCount: 1 | 2, repairLimit: number, acceptanceStrategy?: ProductionRunInput['acceptanceStrategy']) {
  if (acceptanceStrategy === 'planned-groups-v1') {
    if (candidateCount !== 1) throw new Error('Grouped acceptance requires a single candidate; no silent downgrade');
    // Five existing stages (each generated + reviewed), plan + review, at
    // most three raw group generations and one whole-assembly review.
    // The largest repair branch remains the three-role PM replan (six calls),
    // larger than rebuilding all three groups + whole review (four calls).
    return { baseCalls: 16, worstCaseCalls: 16 + 6 * repairLimit };
  }
  // Six initial stages. Replanning adds at most three stages per shared repair;
  // ordinary regeneration adds one, and a Gate repair adds two.
  return { baseCalls: 6 * (candidateCount + 1), worstCaseCalls: (6 + 3 * repairLimit) * (candidateCount + 1) };
}
export type ProductionLaunchPreflightIssueCode = 'agent-selection-invalid' | 'agent-disabled' | 'agent-key-missing' | 'agent-pricing-missing' | 'agent-currency-mismatch' | 'execution-unready' | 'execution-stale' | 'first-request-token-budget' | 'first-request-cost-budget' | 'startup-public-contract-rejected';
export type ProductionLaunchPreflightWarningCode = 'not-paid-authorization' | 'acceptance-not-frozen' | 'reservation-not-billing' | 'budget-may-stop-early' | 'call-envelope-exceeds-budget' | 'token-envelope-exceeds-budget' | 'cost-envelope-exceeds-budget' | 'source-bound-not-real-validated' | 'planned-groups-not-real-validated' | 'startup-guard-not-guarantee';
export interface ProductionLaunchExecutionSummary {
  bootId: string | null; startedAt: string | null; commit: string | null; sourceClean: boolean;
  sourceFingerprint: string | null; buildFingerprint: string | null;
  buildSnapshot: { platformCommit: string; sourceClean: boolean; builtAt: string } | null;
  ready: boolean; fresh: boolean;
}
export interface ProductionLaunchPreflightReport {
  version: typeof PRODUCTION_LAUNCH_PREFLIGHT_VERSION; ready: boolean;
  paidAuthorized: false; finalGate: null; modelRequests: 0;
  input: ProductionRunInput; models: ProductionAgent[]; execution: ProductionLaunchExecutionSummary;
  /** Opt-in only: legacy report serialization/hash stays byte-compatible. */
  configuration?: { promptVersion: string; pmOutputPolicyVersion: string; roleSchemaDiagnosticsVersion: string; acceptanceStepAuditVersion?: string; acceptanceReviewProjectionVersion?: string };
  /** Present only when the server has checked the same full fixed material
   * and encrypted credential set as startup. No plaintext/secret metadata. */
  startupGuard?: { version: string; publicCollisionGuardVersion: string; ready: boolean };
  budget: {
    baseCalls: number; worstCaseCalls: number; inputTokensPerRequest: number; outputTokensPerRequest: number;
    firstRequest: { totalTokens: number; estimatedCost: number | null; currency: 'USD' | 'CNY' };
    envelope: { baseTokens: number; worstCaseTokens: number; baseEstimatedCost: number | null; worstCaseEstimatedCost: number | null; currency: 'USD' | 'CNY' };
  };
  issues: Array<{ code: ProductionLaunchPreflightIssueCode; message: string }>;
  warnings: Array<{ code: ProductionLaunchPreflightWarningCode; message: string }>;
  reportHash: string;
}
