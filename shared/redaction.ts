const REDACTED = '[REDACTED]';
interface SourceRange { start: number; end: number }
interface DecodedText { text: string; source: SourceRange[] }

/** Decode only JSON escapes, retaining locations in the original text. No eval. */
function decodeJsonEscapes(input: DecodedText): DecodedText {
  const text: string[] = []; const source: SourceRange[] = [];
  const short: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  for (let index = 0; index < input.text.length;) {
    let character = input.text[index]; let length = 1;
    if (character === '\\') {
      const unicode = /^\\[uU]([0-9a-fA-F]{4})/.exec(input.text.slice(index, index + 6));
      if (unicode) { character = String.fromCharCode(Number.parseInt(unicode[1], 16)); length = 6; }
      else if (Object.hasOwn(short, input.text[index + 1])) { character = short[input.text[index + 1]]; length = 2; }
    }
    text.push(character);
    source.push({ start: input.source[index].start, end: input.source[index + length - 1].end });
    index += length;
  }
  return { text: text.join(''), source };
}

function sensitiveSpans(input: DecodedText, key: string): SourceRange[] {
  const matches: SourceRange[] = [];
  const add = (start: number, length: number) => {
    if (length) matches.push({ start: input.source[start].start, end: input.source[start + length - 1].end });
  };
  if (key) {
    for (let index = input.text.indexOf(key); index >= 0; index = input.text.indexOf(key, index + key.length)) add(index, key.length);
  }
  // A credential-shaped token is conservatively private. Plain "Bearer" or
  // short strings such as "sk-item" are not treated as credentials.
  for (const match of input.text.matchAll(/\bBearer\s+([^\s"'<>`]+)/gi)) {
    if (match[1] !== REDACTED) add(match.index + match[0].length - match[1].length, match[1].length);
  }
  for (const match of input.text.matchAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g)) add(match.index, match[0].length);
  return matches;
}

function redactFlatString(text: string, key: string): string {
  if (!text) return text;
  let decoded: DecodedText = { text, source: Array.from({ length: text.length }, (_value, index) => ({ start: index, end: index + 1 })) };
  const spans: SourceRange[] = [];
  // Normal JSON output needs one pass; extra passes also cover nested escaped
  // JSON strings and truncated strings with escaped backslashes. Bounded work
  // does not claim to identify arbitrary encoding/encryption/covert channels.
  for (let level = 0; level <= 4; level++) {
    for (const span of sensitiveSpans(decoded, key)) spans.push(span);
    if (!decoded.text.includes('\\')) break;
    const next = decodeJsonEscapes(decoded);
    if (next.text === decoded.text) break;
    decoded = next;
  }
  if (!spans.length) return text;
  spans.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: SourceRange[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  // A deliberately pathological configured key must not reappear inside the
  // marker itself (e.g. an API key literally equal to "REDACTED").
  const marker = key && REDACTED.includes(key) ? '' : REDACTED;
  let result = ''; let cursor = 0;
  for (const span of merged) { result += text.slice(cursor, span.start) + marker; cursor = span.end; }
  return result + text.slice(cursor);
}

/** Exact known credential detection, without Bearer/sk heuristics or mutation. */
export function containsKnownSecret(text: string, key: string): boolean {
  if (!text || !key) return false;
  const contains = (value: string) => {
    let decoded: DecodedText = { text: value, source: Array.from({ length: value.length }, (_value, index) => ({ start: index, end: index + 1 })) };
    for (let level = 0; level <= 4; level++) {
      if (decoded.text.includes(key)) return true;
      if (!decoded.text.includes('\\')) break;
      const next = decodeJsonEscapes(decoded);
      if (next.text === decoded.text) break;
      decoded = next;
    }
    return false;
  };
  try { JSON.parse(text); }
  catch { return contains(text); }
  // Match the redactor's JSON-string boundary: numbers and separate fields are
  // not combined into a fictional credential, and escaped object keys count.
  return [...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)].some(token => contains(JSON.parse(token[0]) as string));
}

/**
 * Redact a selected connection's known credential plus common credential-shaped
 * Bearer/sk tokens. Complete JSON remains valid, including escaped object keys.
 * Unchanged text is returned byte-for-byte; other JSON number/whitespace tokens
 * are not reserialized (avoids changing large-integer precision).
 * This is not a detector for arbitrary secrets, encryption or split-key covert
 * channels, and does not access any config, network or other resident's key.
 */
export function redactKnownSecret(text: string, key: string): string {
  try { JSON.parse(text); }
  catch { return redactFlatString(text, key); }
  const tokens = [...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)];
  const originalKeys = new Set<string>();
  for (const token of tokens) {
    if (/^\s*:/.test(text.slice(token.index! + token[0].length))) originalKeys.add(JSON.parse(token[0]) as string);
  }
  const keyReplacements = new Map<string, string>();
  let sequence = 0;
  return text.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (token, offset: number) => {
    const decoded = JSON.parse(token) as string;
    let clean = redactFlatString(decoded, key);
    if (clean === decoded) return token;
    if (/^\s*:/.test(text.slice(offset + token.length))) {
      // Keep an unrelated existing "[REDACTED]" property rather than creating
      // duplicate names which silently discard values on the next JSON.parse.
      if (!keyReplacements.has(decoded)) {
        let replacement = clean;
        while (originalKeys.has(replacement)) replacement = `${clean}#redacted-key-${++sequence}`;
        keyReplacements.set(decoded, replacement); originalKeys.add(replacement);
      }
      clean = keyReplacements.get(decoded)!;
    }
    return JSON.stringify(clean);
  });
}
