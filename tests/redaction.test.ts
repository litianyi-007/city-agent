import assert from 'node:assert/strict';
import test from 'node:test';
import { redactKnownSecret } from '../shared/redaction';
import { callBrowserModel } from '../src/browser-model';

const key = 'private-key-AbC123';
const unicode = (value: string, upper = false) => value.split('').map(character => {
  const hex = character.charCodeAt(0).toString(16).padStart(4, '0');
  return `\\u${upper ? hex.toUpperCase() : hex}`;
}).join('');

test('redaction preserves ordinary JSON formatting, escaping, large numbers and noncredential text exactly', () => {
  for (const input of ['', '普通内容与 sk-item 不应改写。', 'Bearer', 'NotBearer token', '{ "n": 9007199254740993, "s": "普通内容\\n换行", "a": [null, true] }', '"\\u666e\\u901a"']) {
    assert.equal(redactKnownSecret(input, key), input);
  }
  const large = '{ "n": 9007199254740993, "secret": "private-key-AbC123", "unchanged": "\\u666e\\u901a" }';
  const clean = redactKnownSecret(large, key);
  assert.equal(clean, '{ "n": 9007199254740993, "secret": "[REDACTED]", "unchanged": "\\u666e\\u901a" }');
});

test('known credentials are masked in raw, JSON escaped, mixed literal/unicode and case-varied hex forms', () => {
  const unusualKey = 'secret-"slash\\newline\n-终😀';
  assert.equal(redactKnownSecret(`prefix ${key} suffix ${key}`, key), 'prefix [REDACTED] suffix [REDACTED]');
  for (const encoded of [unicode(key), unicode(key, true), 'private-\\u006bey-Ab\\u0043123']) {
    const clean = redactKnownSecret(`prefix ${encoded} suffix`, key);
    assert.equal(clean, 'prefix [REDACTED] suffix');
  }
  const escaped = JSON.stringify(unusualKey).slice(1, -1);
  assert.equal(redactKnownSecret(`partial: ${escaped}`, unusualKey), 'partial: [REDACTED]');
  assert.equal(JSON.parse(redactKnownSecret(JSON.stringify(unusualKey), unusualKey)), '[REDACTED]');
  const differentCase = key.toLowerCase();
  assert.equal(redactKnownSecret(differentCase, key), differentCase, 'actual credential literal matching remains case-sensitive');
});

test('all nested JSON string values and object keys redact without deleting colliding safe properties', () => {
  const input = `{"${unicode(key)}":{"a":["${unicode(key, true)}",{"text":"before ${key} after"}]},"[REDACTED]":"safe existing value","number":7}`;
  const clean = redactKnownSecret(input, key);
  const parsed = JSON.parse(clean);
  assert.equal(parsed['[REDACTED]'], 'safe existing value');
  assert.equal(parsed['[REDACTED]#redacted-key-1'].a[0], '[REDACTED]');
  assert.equal(parsed['[REDACTED]#redacted-key-1'].a[1].text, 'before [REDACTED] after');
  assert.equal(Object.keys(parsed).length, 3);
  assert.equal(redactKnownSecret(clean, key), clean);
  assert.ok(!clean.includes(key));
});

test('invalid and truncated output masks direct, escaped and mixed Unicode credentials before any later parse/export', () => {
  for (const text of [`{"answers":[{"value":"${key}`, `{"answers":[{"value":"${unicode(key)}`, `broken ${JSON.stringify(unicode(key)).slice(1, -1)}`, `broken private-\\u006bey-AbC123`]) {
    const clean = redactKnownSecret(text, key);
    assert.ok(clean.includes('[REDACTED]'), clean);
    assert.ok(!clean.includes(key));
    assert.ok(!clean.includes(unicode(key)));
  }
});

test('Bearer/sk credential-shaped tokens mask after Unicode decode; common text and empty key stay safe', () => {
  const text = '{ "auth": "Bearer other-token-123", "raw": "sk-abcdefghijklmnop", "encoded": "\\u0042earer hidden-token", "label": "sk-item" }';
  const clean = redactKnownSecret(text, '');
  assert.deepEqual(JSON.parse(clean), { auth: 'Bearer [REDACTED]', raw: '[REDACTED]', encoded: 'Bearer [REDACTED]', label: 'sk-item' });
  assert.equal(redactKnownSecret(clean, ''), clean);
  assert.equal(redactKnownSecret('[REDACTED]', 'REDACTED'), '[]', 'replacement marker must not reintroduce a pathological known key');
});

test('browser model keeps credentials only in trusted headers, not sent prompts or returned JSON', async t => {
  let dispatched = 0;
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, options?: RequestInit) => {
    dispatched++;
    const headers = options!.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(options!.body as string);
    assert.ok(!JSON.stringify(body).includes(key));
    assert.equal(body.messages[0].content, 'Instructions [REDACTED]');
    assert.equal(JSON.parse(body.messages[1].content).description, '[REDACTED]');
    return Response.json({ choices: [{ message: { content: `{"residentId":"resident-1","answers":[{"questionId":"q","value":"${unicode(key)}"}],"${unicode(key)}":"nested"}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 8 } });
  });
  const result = await callBrowserModel({ provider: 'openai-compatible', baseUrl: 'http://fixture.local/v1', modelId: 'fixture-model', apiKey: key }, `Instructions ${key}`, `{"description":"${unicode(key)}"}`, new AbortController().signal);
  const parsed = JSON.parse(result.text);
  assert.equal(parsed.answers[0].value, '[REDACTED]');
  assert.equal(parsed['[REDACTED]'], 'nested');
  assert.equal(result.inputTokens, 11);
  assert.equal(result.outputTokens, 8);
  assert.equal(dispatched, 1);
});

test('browser truncated output and response-parse errors carry only sanitized evidence/messages', async t => {
  let call = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    call++;
    if (call === 1) return Response.json({ choices: [{ message: { content: `{"unfinished":"${unicode(key)}` }, finish_reason: 'length' }], usage: { prompt_tokens: 17, completion_tokens: 3000 } });
    return Object.assign(Response.json({}), { json: async () => { throw new Error(`Parser error: ${unicode(key)}`); } });
  });
  const config = { provider: 'openai-compatible', baseUrl: 'http://fixture.local/v1', modelId: 'fixture-model', apiKey: key };
  await assert.rejects(callBrowserModel(config, 'system', 'user', new AbortController().signal), (error: unknown) => {
    const failed = error as Error & { evidence: { text: string; inputTokens: number; outputTokens: number } };
    assert.match(failed.message, /截断/);
    assert.ok(failed.evidence.text.includes('[REDACTED]'));
    assert.equal(failed.evidence.inputTokens, 17);
    assert.equal(failed.evidence.outputTokens, 3000);
    return true;
  });
  await assert.rejects(callBrowserModel(config, 'system', 'user', new AbortController().signal), (error: Error) => {
    assert.equal(error.message, 'Parser error: [REDACTED]');
    return true;
  });
});
