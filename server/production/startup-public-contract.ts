import { PRODUCTION_OUTPUT_ENVELOPE_POLICY_LITERALS, PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, PRODUCTION_ACCEPTANCE_POLICY_LITERALS, PRODUCTION_PM_OUTPUT_POLICY_LITERALS, PRODUCTION_STARTUP_GUARD_POLICY_LITERALS, PRODUCTION_STEP_AUDIT_POLICY_LITERALS, type ProductionRunInput } from '../../shared/production-schema.js';
import { ACCEPTANCE_DIAGNOSTICS_VERSION, acceptanceCapacityFacts } from './acceptance-diagnostics.js';
import { ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS, acceptancePlanSchema } from './acceptance-plan.js';
import { ACCEPTANCE_PLANNING_VERSION, OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS, OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS, OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS, OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS, outputContractSnapshot, planSchema, researchSchema } from './contracts.js';
import { outputEnvelopePolicy } from './output-envelope.js';
import { OUTPUT_DIAGNOSTICS_VERSION } from './output-diagnostics.js';
import { pmOutputPolicy } from './role-output-policy.js';

export const STARTUP_PUBLIC_GUARD_VERSION = 'production-startup-public-guard-v1' as const;
/** The identical, complete fixed host material checked before a first model
 * call and during free launch readiness. No credential access or model call. */
export function startupPublicGuardInputs(input: Pick<ProductionRunInput, 'capability' | 'acceptanceStrategy'>): unknown[] {
  const values: unknown[] = [{ startupGuardProtocolLiterals: PRODUCTION_STARTUP_GUARD_POLICY_LITERALS }];
  if (input.capability !== 'camera-scene-v1') values.push({ outputDiagnosticsVersion: OUTPUT_DIAGNOSTICS_VERSION, acceptanceCapacity: acceptanceCapacityFacts(), acceptanceDiagnosticsVersion: ACCEPTANCE_DIAGNOSTICS_VERSION, acceptancePlanningVersion: ACCEPTANCE_PLANNING_VERSION, protocolLiterals: PRODUCTION_ACCEPTANCE_POLICY_LITERALS });
  if (input.acceptanceStrategy === 'planned-groups-v1') {
    values.push({ strategy: input.acceptanceStrategy, groupProtocolLiterals: PRODUCTION_ACCEPTANCE_GROUP_POLICY_LITERALS, pmProtocolLiterals: PRODUCTION_PM_OUTPUT_POLICY_LITERALS, diagnostics: ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS, pmPolicies: [pmOutputPolicy('think-design', outputContractSnapshot(planSchema)), pmOutputPolicy('acceptance-plan', outputContractSnapshot(acceptancePlanSchema))] });
    values.push({ stepAuditProtocolLiterals: PRODUCTION_STEP_AUDIT_POLICY_LITERALS });
    values.push({ outputEnvelopeProtocolLiterals: PRODUCTION_OUTPUT_ENVELOPE_POLICY_LITERALS, outputEnvelopes: [outputEnvelopePolicy('researcher', 'research', outputContractSnapshot(researchSchema)), ...['think-design', 'feedback-0', 'feedback-1', 'feedback-2'].map(phase => outputEnvelopePolicy('project-manager', phase, outputContractSnapshot(planSchema))), outputEnvelopePolicy('project-manager', 'acceptance-plan', outputContractSnapshot(acceptancePlanSchema))] });
    // Each complete instruction remains a separate bounded check. Never
    // truncate, drop historical credential generations or skip tail bytes.
    for (const instructions of [...Object.values(OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS), OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS, OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS, OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS]) values.push({ instructions });
  }
  return values;
}
export function assertProductionStartupPublicSafe(store: { assertStudyPublicSafe(value: unknown): void }, input: Pick<ProductionRunInput, 'capability' | 'acceptanceStrategy'>): void {
  for (const value of startupPublicGuardInputs(input)) store.assertStudyPublicSafe(value);
}
