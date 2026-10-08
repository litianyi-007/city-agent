import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseJson, researchSchema } from '../server/production/contracts.ts';
import { diagnoseJsonOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION, OUTPUT_DIAGNOSTICS_VERSION } from '../server/production/output-diagnostics.ts';

// Free, archived-source replay and pure parser tests only. No provider, browser,
// generated code, secret reads, JSON repair, migration or delivery inference.
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function syntaxError(raw: string): SyntaxError {
  try { parseJson(raw); assert.fail('Expected a real parser failure'); }
  catch (error) { assert.ok(error instanceof SyntaxError); return error; }
}
function inspect(raw: string) {
  const before = raw;
  const result = diagnoseJsonOutput(raw);
  assert.ok(result);
  assert.equal(result.version, OUTPUT_DIAGNOSTICS_VERSION);
  assert.equal(result.kind, 'json-syntax');
  assert.equal(result.positionUnit, 'utf16-code-unit');
  assert.equal(result.sourceSha256, sha(raw));
  assert.equal(result.message, syntaxError(raw).message);
  assert.equal(result.excerpt.text, raw.slice(result.excerpt.start, result.excerpt.end));
  assert.ok(result.excerpt.text.length <= 320);
  assert.equal(result.excerpt.truncated, result.excerpt.start !== 0 || result.excerpt.end !== raw.length);
  assert.equal(result.rawPosition, result.position === null ? null : result.bodyOffset + result.position);
  assert.equal(raw, before);
  return result;
}

test('HTML-02 three immutable archived malformed outputs bind the exact parser location and source SHA without repair', () => {
  const path = new URL('../docs/production/experiments/HTML-02/run.json', import.meta.url);
  const archive = readFileSync(path); const archiveSha = sha(archive);
  const run = JSON.parse(archive.toString('utf8')) as { id: string; status: string; calls: Array<{ id: string; role: string; rawOutput: string; error?: string }> };
  assert.equal(run.id, '850135e8-7993-424d-8ee2-ee384a7c32fd');
  assert.equal(run.status, 'failed');
  const expected = [
    ['f6dec516-9232-4a92-ba72-23f050d4ac60', 1816, '5e8ab59a5e058012e4efb2b45d446d84e771febdaa0c4512e681ee38b0764eca'],
    ['22ecb862-1e7f-42c7-a9d3-2dae4bc05ba1', 1843, '00419029a489d4b544afd9f592aefb5e86f62d1e9bf3414b2b89b7aac0b490e0'],
    ['2fc30dc1-cddc-4aa3-97a9-d3b658159a50', 1891, '7c00d84f20148a4bdb8f0b0ff165e22553a50cf3271df6307e49a73331f59ddd'],
  ] as const;
  const calls = run.calls.filter(call => call.role === 'researcher');
  assert.equal(calls.length, expected.length);
  calls.forEach((call, index) => {
    const [id, position, sourceSha] = expected[index]!;
    assert.equal(call.id, id);
    const result = inspect(call.rawOutput);
    assert.equal(result.position, position);
    assert.equal(result.rawPosition, position);
    assert.equal(result.bodyOffset, 0);
    assert.equal(result.sourceSha256, sourceSha);
    assert.equal(call.rawOutput.slice(position - 1, position + 15), ']","constraints"');
    assert.ok(result.excerpt.text.includes(']","constraints"'));
    assert.equal(result.excerpt.truncated, true);
    assert.ok(call.error?.endsWith(result.message));
    assert.throws(() => parseJson(call.rawOutput), SyntaxError, 'Diagnostic must not make invalid archived JSON pass');
  });
  assert.equal(sha(readFileSync(path)), archiveSha, 'Never rewrite the original archive');
});

test('positions are UTF-16 code units rather than Unicode code points or UTF-8 bytes', () => {
  const body = '{"note":"😀汉字","value":1,}'; const raw = ` \t\n${body}\n `;
  const result = inspect(raw); const expected = body.lastIndexOf('}');
  assert.equal(result.bodyOffset, 3);
  assert.equal(result.position, expected);
  assert.equal(result.rawPosition, 3 + expected);
  assert.notEqual(expected, [...body.slice(0, expected)].length);
  assert.notEqual(expected, Buffer.byteLength(body.slice(0, expected), 'utf8'));
});

test('leading whitespace and complete JSON or untagged code fences map body positions exactly like the real parser', () => {
  const body = '{"x":1,}'; const position = body.lastIndexOf('}');
  for (const raw of [`${body}`, ` \t\r\n${body} \r\n `, ` \n\`\`\`json\n${body}\n\`\`\` \n`, `\uFEFF\t\`\`\`JSON\r\n${body}\r\n\`\`\`\r\n `, `\`\`\`\n\n${body}\n\n\`\`\``]) {
    const result = inspect(raw);
    assert.equal(result.bodyOffset, raw.indexOf('{'));
    assert.equal(result.position, position);
    assert.equal(result.rawPosition, raw.indexOf('{') + position);
    assert.equal(raw[result.rawPosition!], '}');
  }
});

test('quotes, escapes and raw control characters remain invalid and are diagnosed from the actual SyntaxError', () => {
  for (const raw of ['{"value":"before "after"}', '{"value":"bad\\q"}', '{"value":"line\nbreak"}', '{"value":}', '[1,,2]', '{"value":NaN}']) {
    const result = inspect(raw);
    assert.throws(() => parseJson(raw), SyntaxError);
    if (result.position !== null) assert.ok(result.excerpt.start <= result.rawPosition! && result.excerpt.end > result.rawPosition!);
  }
});

test('missing positions remain null, including truncation and input text spoofing a position marker', () => {
  for (const raw of ['{"items":[', '', ' \t\n ', 'not-json in JSON at position 12345', '```json\n{"items":[\n```']) {
    const result = inspect(raw);
    assert.equal(result.position, null);
    assert.equal(result.rawPosition, null);
  }
  const raw = `{"items":["${'界'.repeat(500)}`;
  const result = inspect(raw);
  // V8 may report the exact string-end position for this form. Do not invent
  // that position for the distinct unexpected-end forms above.
  assert.ok(result.excerpt.text.includes('界'));
  assert.equal(result.excerpt.truncated, true);
});

test('parser compatibility does not extract JSON from partial, foreign or embedded fences', () => {
  for (const raw of ['before ```json\n{}\n```', '```json\n{}\n``` after', '```javascript\n{}\n```', '```json\n{}', '{} trailing', '{} {}', '{"x":1} <!-- end -->']) {
    inspect(raw);
    assert.throws(() => parseJson(raw), SyntaxError);
  }
});

test('bounded excerpts are verbatim, identify truncation and never split valid surrogate pairs', () => {
  const late = `{"note":"${'😀'.repeat(200)}","value":1,}`;
  const early = `{"x":1,,"note":"${'😀'.repeat(200)}"}`;
  for (const [raw, expected] of [[late, late.lastIndexOf('}')], [early, early.indexOf(',,') + 1]] as const) {
    const result = inspect(raw);
    assert.equal(result.position, expected);
    assert.equal(result.excerpt.truncated, true);
    assert.equal(/[\uDC00-\uDFFF]/.test(result.excerpt.text[0]!), false);
    assert.equal(/[\uD800-\uDBFF]/.test(result.excerpt.text.at(-1)!), false);
  }
  const short = inspect('{"x":1,}');
  assert.equal(short.excerpt.truncated, false);
  assert.equal(short.excerpt.start, 0);
  assert.equal(short.excerpt.end, 8);
});

test('all syntactically legal JSON returns undefined even when the role schema would reject it', () => {
  for (const raw of ['{}', '[]', 'null', 'true', '123', '"string"', '{"value":"quote \\" and emoji 😀"}', ' \n```json\n{"x":1}\n``` \n', '```\n{"x":1}\n```']) {
    assert.equal(diagnoseJsonOutput(raw), undefined);
    assert.doesNotThrow(() => parseJson(raw));
  }
  assert.equal(researchSchema.safeParse({}).success, false);
  assert.equal(diagnoseJsonOutput('{}'), undefined, 'Do not manufacture a schema-semantic diagnosis');
});

test('v2 locates trailing objects, primitives and early closure with whitespace, fences and Unicode without extraction', () => {
  for (const body of ['{} {}', '{} trailing', '123 true', '{"note":"😀汉字"},"tasks":[]', '{"value":1} <!-- end -->']) {
    const trailing = body.startsWith('123') ? body.indexOf('true') : body.indexOf('}') + 1;
    const expected = body.indexOf(body.slice(trailing).trimStart(), trailing);
    for (const raw of [body, ` \t\n${body}\n `, ` \n\`\`\`json\n${body}\n\`\`\` \n`]) {
      const result = inspect(raw);
      assert.equal(result.position, expected);
      assert.equal(result.rawPosition, raw.indexOf(body) + expected);
      assert.ok(result.excerpt.start <= result.rawPosition! && result.excerpt.end > result.rawPosition!);
      assert.throws(() => parseJson(raw), SyntaxError);
      const legacy = diagnoseJsonOutput(raw, LEGACY_OUTPUT_DIAGNOSTICS_VERSION)!;
      assert.equal(legacy.version, LEGACY_OUTPUT_DIAGNOSTICS_VERSION);
      assert.equal(legacy.position, null);
    }
  }
});

test('HTML-05 original v1 null-position record is unchanged while v2 identifies the actual early-close position 505', () => {
  const location = new URL('../docs/production/experiments/HTML-05/run.json', import.meta.url);
  const bytes = readFileSync(location); const before = sha(bytes);
  const run = JSON.parse(bytes.toString('utf8'));
  const call = run.calls.at(-1);
  assert.equal(call.id, 'd0a6e23b-c912-4596-a04f-ec0ec1e18960');
  assert.equal(sha(call.rawOutput), '5f3347aa43571dd2859ecf358fc082f31bf34adfcfd32bde8cff32ffaa5f8235');
  assert.deepEqual(diagnoseJsonOutput(call.rawOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION), call.outputDiagnostic);
  const result = inspect(call.rawOutput);
  assert.equal(result.position, 505); assert.equal(result.rawPosition, 505);
  assert.equal(call.rawOutput.slice(504, 515), '},"tasks":[');
  assert.ok(result.excerpt.text.includes('},"tasks":['));
  assert.ok(result.excerpt.start <= 505 && result.excerpt.end > 505);
  assert.equal(call.outputDiagnostic.position, null);
  assert.equal(sha(readFileSync(location)), before, 'Never repair, migrate or regrade the old run');
});

test('v2 never takes a fabricated after-JSON position from user-provided text', () => {
  for (const raw of ['not-json after JSON at position 12', 'after JSON at position 3', '```json\n{"items":[\n```']) {
    const result = inspect(raw);
    assert.equal(result.position, null);
    assert.equal(result.rawPosition, null);
  }
  const unterminated = '{"note":"after JSON at position 42';
  const actual = inspect(unterminated);
  assert.notEqual(actual.position, 42, 'A real string-end parser position must not be confused with quoted input');
  assert.equal(actual.position, unterminated.length);
});
