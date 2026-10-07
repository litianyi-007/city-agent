import { createHash } from 'node:crypto';
import { parseJson, parseVerifiedDecision, VerifierDecisionError } from './contracts.js';

export { VerifierDecisionError } from './contracts.js';
export const VERIFIER_DECISION_DIAGNOSTICS_VERSION = 'verifier-decision-diagnostic-v1' as const;
export const VERIFIER_RESPONSE_MAX_BYTES = 32000;
export type VerifierDiagnosticPath = '$' | '$.decision' | '$.selectedCandidateId' | '$.scores' | '$.scores[]'
  | '$.scores[].candidateId' | '$.scores[].score' | '$.scores[].reason' | '$.reason';
export type VerifierSchemaIssueCode = 'invalid_type' | 'invalid_value' | 'too_small' | 'too_big' | 'unrecognized_keys' | 'other';
interface DiagnosticBase {
  version: typeof VERIFIER_DECISION_DIAGNOSTICS_VERSION;
  /** Exact supplied source, never a repaired result or a provider excerpt.
   * Oversized inputs are not hashed; their size is sufficient for refusal. */
  source?: { sourceSha256?: string; byteLength: number; utf16Length: number };
}
export type VerifierDecisionDiagnostic = DiagnosticBase & (
  | { category: 'response-bound'; code: 'invalid-response-type' | 'response-too-large'; path: '$'; maximumBytes: 32000 }
  | { category: 'json-syntax'; code: 'invalid-json' | 'duplicate-json-key'; path: '$'; positionUnit: 'utf16-code-unit'; bodyOffset: number; position: number | null; rawPosition: number | null }
  | { category: 'zod-structure'; code: 'schema-structure'; path: '$'; issueCount: number;
      issues: Array<{ code: VerifierSchemaIssueCode; path: VerifierDiagnosticPath }>; issuesTruncated: boolean }
  | { category: 'candidate-ids'; code: 'candidate-id-coverage'; path: '$.scores'; expectedCandidateCount: number;
      scoreEntryCount: number; uniqueCandidateCount: number; missingCandidateCount: number; unknownCandidateCount: number; duplicateCandidateCount: number }
  | { category: 'selected-id'; code: 'abstain-selects-candidate' | 'accept-without-selected-id' | 'selected-id-not-scored'; path: '$.selectedCandidateId' }
  | { category: 'minimum-score'; code: 'selected-score-below-minimum'; path: '$.scores[].score'; selectedScore: number; minimumScore: 3 }
  | { category: 'highest-score'; code: 'selected-score-not-highest'; path: '$.scores[].score'; selectedScore: number; highestScore: number }
);

function bodyCoordinates(raw: string): { offset: number; body: string } {
  const trimmed = raw.trim(); const offset = raw.length - raw.trimStart().length;
  // Exactly the existing parseJson whole-fence grammar, solely for coordinates.
  // This does not extract a JSON object from prose or repair incomplete fences.
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/id.exec(trimmed);
  return match ? { offset: offset + match.indices![1]![0], body: match[1]! } : { offset, body: trimmed };
}

/** Scan only after JSON.parse succeeded. Object keys are decoded exactly as
 * JSON strings, so escaped aliases also count as duplicates. Iterative stacks
 * avoid recursing through attacker-controlled depth. No key leaves this scan. */
function duplicateKeyPosition(body: string): number | null {
  const stack: Array<{ kind: 'object'; keys: Set<string>; expectingKey: boolean } | { kind: 'array' }> = [];
  for (let index = 0; index < body.length; index++) {
    const character = body[index]; const current = stack.at(-1);
    if (character === '"') {
      const start = index;
      for (index++; index < body.length; index++) {
        if (body[index] === '\\') index++;
        else if (body[index] === '"') break;
      }
      if (current?.kind === 'object' && current.expectingKey) {
        const key = JSON.parse(body.slice(start, index + 1)) as string;
        if (current.keys.has(key)) return start;
        current.keys.add(key); current.expectingKey = false;
      }
    } else if (character === '{') stack.push({ kind: 'object', keys: new Set(), expectingKey: true });
    else if (character === '[') stack.push({ kind: 'array' });
    else if (character === '}' || character === ']') stack.pop();
    else if (character === ',' && current?.kind === 'object') current.expectingKey = true;
  }
  return null;
}

/** Strict, bounded Verifier parsing with host-owned diagnostics. Never retains
 * provider text, Zod messages, unknown property names, candidate IDs or reasons.
 * The existing JSON.parse/fence grammar is preserved; duplicate keys are
 * additionally refused by this versioned Verifier policy. No repair or retry. */
export function parseVerifierDecisionText(raw: unknown, candidateIds: string[]): ReturnType<typeof parseVerifiedDecision> {
  if (typeof raw !== 'string') throw new VerifierDecisionError({ version: VERIFIER_DECISION_DIAGNOSTICS_VERSION,
    category: 'response-bound', code: 'invalid-response-type', path: '$', maximumBytes: VERIFIER_RESPONSE_MAX_BYTES });
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > VERIFIER_RESPONSE_MAX_BYTES) throw new VerifierDecisionError({ version: VERIFIER_DECISION_DIAGNOSTICS_VERSION,
    category: 'response-bound', code: 'response-too-large', path: '$', maximumBytes: VERIFIER_RESPONSE_MAX_BYTES,
    source: { byteLength, utf16Length: raw.length } });
  const source = { sourceSha256: createHash('sha256').update(raw, 'utf8').digest('hex'), byteLength, utf16Length: raw.length };
  let value: unknown;
  try { value = parseJson(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const { offset, body } = bodyCoordinates(raw);
    // Only V8's terminal numeric position protocol is used. Its arbitrary
    // message, including any provider text quoted within it, is discarded.
    const match = /\bin JSON at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(error.message);
    const reported = match ? Number(match[1]) : null;
    const position = reported !== null && Number.isSafeInteger(reported) && reported >= 0 && reported <= body.length ? reported : null;
    throw new VerifierDecisionError({ version: VERIFIER_DECISION_DIAGNOSTICS_VERSION, category: 'json-syntax', code: 'invalid-json', path: '$',
      positionUnit: 'utf16-code-unit', bodyOffset: offset, position, rawPosition: position === null ? null : offset + position, source });
  }
  const { offset, body } = bodyCoordinates(raw); const duplicatePosition = duplicateKeyPosition(body);
  if (duplicatePosition !== null) throw new VerifierDecisionError({ version: VERIFIER_DECISION_DIAGNOSTICS_VERSION,
    category: 'json-syntax', code: 'duplicate-json-key', path: '$', positionUnit: 'utf16-code-unit', bodyOffset: offset,
    position: duplicatePosition, rawPosition: offset + duplicatePosition, source });
  try { return parseVerifiedDecision(value, candidateIds); }
  catch (error) {
    if (!(error instanceof VerifierDecisionError)) throw error;
    throw new VerifierDecisionError({ ...error.diagnostic, source });
  }
}
