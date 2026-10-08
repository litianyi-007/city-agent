import { createHash } from 'node:crypto';
import { z } from 'zod';
import { acceptanceSchema } from '../gate.js';
import { parseJson } from './contracts.js';

export const ACCEPTANCE_DIAGNOSTICS_VERSION = 'production-acceptance-diagnostics-v1' as const;
/** Resource limits for optional diagnosis, NOT expanded acceptance limits. */
export const ACCEPTANCE_DIAGNOSTIC_LIMITS = Object.freeze({ rawBytes: 65536, checks: 64, stepsPerCheck: 512 });
export interface AcceptanceCapacityFacts {
  readonly version: typeof ACCEPTANCE_DIAGNOSTICS_VERSION;
  readonly maxChecks: number;
  readonly maxSteps: number;
}
export interface AcceptanceCapacityDiagnostic extends AcceptanceCapacityFacts {
  /** Exact supplied, already-redacted source encoded as UTF-8; not parsed JSON. */
  readonly sourceSha256: string;
  readonly checkCount: number;
  readonly stepCounts: readonly number[];
  readonly oversizedStepCheckIndices: readonly number[];
  readonly checkCountExceedsLimit: boolean;
}

function deriveCapacity(): AcceptanceCapacityFacts {
  // Use the actual Gate schema, rather than a second manually maintained 12/20.
  const schema = z.toJSONSchema(acceptanceSchema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'throw' });
  const maxChecks = schema.maxItems;
  const item = schema.items;
  const steps = item && typeof item === 'object' && !Array.isArray(item) ? item.properties?.steps : undefined;
  const maxSteps = steps && typeof steps === 'object' ? steps.maxItems : undefined;
  if (typeof maxChecks !== 'number' || !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > ACCEPTANCE_DIAGNOSTIC_LIMITS.checks
    || typeof maxSteps !== 'number' || !Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > ACCEPTANCE_DIAGNOSTIC_LIMITS.stepsPerCheck) throw new Error('Acceptance capacity schema unavailable');
  return Object.freeze({ version: ACCEPTANCE_DIAGNOSTICS_VERSION, maxChecks, maxSteps });
}
const capacity = deriveCapacity();
/** Capacity only: not evidence of coverage, correctness or a passed Gate. */
export function acceptanceCapacityFacts(): AcceptanceCapacityFacts { return capacity; }

/** Optional numbers-only explanation of a rejected candidate. The caller must
 * redact first. This never edits/extracts/repairs source or grants acceptance;
 * undefined means insufficient diagnosis, not a valid candidate. */
export function diagnoseAcceptanceCapacity(raw: unknown): AcceptanceCapacityDiagnostic | undefined {
  // Primitive strings only: do not invoke accessors, toString or Proxy traps.
  if (typeof raw !== 'string' || raw.length > ACCEPTANCE_DIAGNOSTIC_LIMITS.rawBytes || Buffer.byteLength(raw, 'utf8') > ACCEPTANCE_DIAGNOSTIC_LIMITS.rawBytes) return undefined;
  try {
    const parsed: unknown = parseJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'checks')) return undefined;
    const checks = (parsed as { checks?: unknown }).checks;
    if (!Array.isArray(checks) || checks.length > ACCEPTANCE_DIAGNOSTIC_LIMITS.checks) return undefined;
    for (const check of checks) {
      if (!check || typeof check !== 'object' || Array.isArray(check) || !Array.isArray(check.steps) || check.steps.length > ACCEPTANCE_DIAGNOSTIC_LIMITS.stepsPerCheck) return undefined;
    }
    const validation = acceptanceSchema.safeParse(checks);
    if (validation.success || validation.error.issues.length === 0) return undefined;
    // Only explain Gate-schema capacity issues, not its other refinements.
    // Production-specific semantic checks remain the caller's responsibility;
    // a diagnostic is never the complete rejection verdict. Arbitrary Zod
    // paths, messages and input stay private.
    if (!validation.error.issues.every(issue => issue.code === 'too_big' && issue.origin === 'array' && issue.inclusive === true && (
      issue.path.length === 0 && issue.maximum === capacity.maxChecks
      || issue.path.length === 2 && typeof issue.path[0] === 'number' && Number.isSafeInteger(issue.path[0]) && issue.path[0] >= 0 && issue.path[0] < checks.length && issue.path[1] === 'steps' && issue.maximum === capacity.maxSteps
    ))) return undefined;
    const stepCounts = checks.map(check => check.steps.length as number);
    const oversizedStepCheckIndices = stepCounts.flatMap((count, index) => count > capacity.maxSteps ? [index] : []);
    const checkCountExceedsLimit = checks.length > capacity.maxChecks;
    if (!checkCountExceedsLimit && oversizedStepCheckIndices.length === 0) return undefined;
    return Object.freeze({ ...capacity, sourceSha256: createHash('sha256').update(raw, 'utf8').digest('hex'), checkCount: checks.length,
      stepCounts: Object.freeze(stepCounts), oversizedStepCheckIndices: Object.freeze(oversizedStepCheckIndices), checkCountExceedsLimit });
  } catch { return undefined; }
}
