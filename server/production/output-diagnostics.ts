import { createHash } from 'node:crypto';
import { parseJson } from './contracts.js';

export const OUTPUT_DIAGNOSTICS_VERSION = 'production-json-diagnostics-v1' as const;
const MAX_EXCERPT_UNITS = 320;

export interface JsonOutputDiagnostic {
  version: typeof OUTPUT_DIAGNOSTICS_VERSION;
  kind: 'json-syntax';
  /** SHA-256 of the complete supplied, already-redacted source encoded as UTF-8. */
  sourceSha256: string;
  positionUnit: 'utf16-code-unit';
  /** Start of the JSON body in the supplied source, after the existing unwrap. */
  bodyOffset: number;
  /** JSON.parse's reported body position; null when the engine reports none. */
  position: number | null;
  rawPosition: number | null;
  /** A bounded verbatim slice of the supplied source, never repaired JSON. */
  excerpt: { start: number; end: number; text: string; truncated: boolean };
  message: string;
}

function bodyCoordinates(raw: string): { offset: number; body: string } {
  const trimmed = raw.trim();
  const offset = raw.length - raw.trimStart().length;
  // The exact complete-fence grammar used by parseJson, with indices solely
  // to map its capture back to the original UTF-16 source. No JSON extraction.
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/id.exec(trimmed);
  return match ? { offset: offset + match.indices![1]![0], body: match[1]! } : { offset, body: trimmed };
}

function excerpt(raw: string, bodyEnd: number, rawPosition: number | null): JsonOutputDiagnostic['excerpt'] {
  const target = rawPosition === null ? bodyEnd - MAX_EXCERPT_UNITS : rawPosition - MAX_EXCERPT_UNITS / 2;
  let start = Math.max(0, Math.min(target, raw.length - MAX_EXCERPT_UNITS));
  let end = Math.min(raw.length, start + MAX_EXCERPT_UNITS);
  // Do not manufacture a lone surrogate by cutting an otherwise valid pair.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(raw[start] ?? '') && /[\uD800-\uDBFF]/.test(raw[start - 1] ?? '')) start++;
  if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(raw[end] ?? '')) end--;
  return { start, end, text: raw.slice(start, end), truncated: start !== 0 || end !== raw.length };
}

/** Diagnose syntax only. The caller must redact first; this function neither
 * reads secrets nor sanitizes, edits, retries, evaluates or schema-validates
 * the source. Any diagnostic and its hash refer to this exact supplied string.
 */
export function diagnoseJsonOutput(raw: string): JsonOutputDiagnostic | undefined {
  try { parseJson(raw); return undefined; }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const { offset, body } = bodyCoordinates(raw);
    // Match only V8's terminal protocol, not a phrase quoted from user output.
    const match = /\bin JSON at position (\d+)(?: \(line \d+ column \d+\))?$/.exec(error.message);
    const reported = match ? Number(match[1]) : null;
    const position = reported !== null && Number.isSafeInteger(reported) && reported >= 0 && reported <= body.length ? reported : null;
    const rawPosition = position === null ? null : offset + position;
    return {
      version: OUTPUT_DIAGNOSTICS_VERSION,
      kind: 'json-syntax',
      sourceSha256: createHash('sha256').update(raw, 'utf8').digest('hex'),
      positionUnit: 'utf16-code-unit',
      bodyOffset: offset,
      position,
      rawPosition,
      excerpt: excerpt(raw, offset + body.length, rawPosition),
      message: error.message,
    };
  }
}
