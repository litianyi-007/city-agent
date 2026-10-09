import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { acceptancePlanSchema } from './acceptance-plan.js';

export const ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION = 'production-acceptance-source-diagnostics-v1' as const;
export const ACCEPTANCE_SOURCE_DIAGNOSTIC_LITERALS = Object.freeze([
  ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, 'acceptance-plan', 'source-quote-mismatch', 'brief', 'acceptance',
] as const);

/** Optional diagnostic resource bounds, not permission to enlarge run input. */
export const ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS = Object.freeze({
  rawBytes: 131072, briefCharacters: 6000, acceptanceCharacters: 3000,
  briefBytes: 24000, acceptanceBytes: 12000, mismatches: 24,
});

export interface AcceptanceSourceDiagnostic {
  readonly version: typeof ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION;
  readonly phase: 'acceptance-plan';
  readonly kind: 'source-quote-mismatch';
  readonly callId: string;
  readonly candidateId: string;
  /** SHA256 of the entire supplied, already-redacted raw UTF-8 answer. */
  readonly sourceSha256: string;
  readonly outputContractHash: string;
  readonly materials: { readonly briefSha256: string; readonly acceptanceSha256: string };
  readonly mismatchCount: number;
  readonly mismatches: readonly { readonly obligationIndex: number; readonly source: 'brief' | 'acceptance' }[];
}

interface Source { brief: string; acceptance: string; }
interface Binding { callId: string; candidateId: string; outputContractHash: string; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const sha256 = /^[0-9a-f]{64}(?![\s\S])/;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Check descriptors before reading values: no coercion, accessors, inherited
 * data, symbols, exotic prototypes, or Proxy traps may execute as feedback. */
function stringFields(value: unknown, keys: readonly string[]): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined;
  const result: Record<string, string> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string') return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

/** Positions and hashes only. This explains a strictly source-mismatched but
 * structurally legal plan; it never changes quotes, grants acceptance, creates
 * a candidate, retries a model, or certifies coverage. Undefined means no safe
 * diagnosis, NOT a valid candidate. The caller must redact before calling.
 * Complete-fence parsing matches the existing role parser; no prefix extraction
 * or quote/whitespace/punctuation/Unicode normalization is performed. */
export function diagnoseAcceptanceSource(raw: string, source: Source, binding: Binding): AcceptanceSourceDiagnostic | undefined {
  if (typeof raw !== 'string' || raw.length > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.rawBytes
    || Buffer.byteLength(raw, 'utf8') > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.rawBytes) return undefined;
  try {
    const materials = stringFields(source, ['brief', 'acceptance']);
    const fields = stringFields(binding, ['callId', 'candidateId', 'outputContractHash']);
    if (!materials || !fields || !uuid.test(fields.callId!) || !uuid.test(fields.candidateId!) || !sha256.test(fields.outputContractHash!)) return undefined;
    if (materials.brief!.length > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.briefCharacters
      || materials.acceptance!.length > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.acceptanceCharacters
      || Buffer.byteLength(materials.brief!, 'utf8') > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.briefBytes
      || Buffer.byteLength(materials.acceptance!, 'utf8') > ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.acceptanceBytes) return undefined;
    const trimmed = raw.trim();
    const body = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed)?.[1] ?? trimmed;
    const parsed = acceptancePlanSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return undefined;
    const mismatches = parsed.data.obligations.flatMap((obligation, obligationIndex) =>
      materials[obligation.source]!.includes(obligation.quote) ? [] : [Object.freeze({ obligationIndex, source: obligation.source })]);
    if (!mismatches.length) return undefined;
    return Object.freeze({ version: ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, phase: 'acceptance-plan', kind: 'source-quote-mismatch',
      callId: fields.callId!, candidateId: fields.candidateId!, sourceSha256: hash(raw), outputContractHash: fields.outputContractHash!,
      materials: Object.freeze({ briefSha256: hash(materials.brief!), acceptanceSha256: hash(materials.acceptance!) }),
      mismatchCount: mismatches.length, mismatches: Object.freeze(mismatches.slice(0, ACCEPTANCE_SOURCE_DIAGNOSTIC_LIMITS.mismatches)) });
  } catch { return undefined; }
}
