import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderUsageWitness, PROVIDER_USAGE_WITNESS_VERSION } from '../server/research/provider-usage-witness.ts';

const valid = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 };
function witness(packets: unknown[], done = true) {
  const observer = createProviderUsageWitness();
  const bytes = new TextEncoder().encode(packets.map(packet => `data: ${JSON.stringify(packet)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : ''));
  // Preserve every byte boundary, including multibyte UTF8 and CRLF.
  for (const byte of bytes) observer.observe(Uint8Array.of(byte));
  observer.complete(); return observer.snapshot();
}

test('missing wire usage stays unknown, including streaming usage:null packets', () => {
  for (const packets of [[{ choices: [] }], [{ choices: [], usage: null }]]) {
    const evidence = witness(packets);
    assert.equal(evidence.state, 'missing'); assert.equal(evidence.usage, null); assert.equal(evidence.usagePackets, 0);
    assert.equal(evidence.version, PROVIDER_USAGE_WITNESS_VERSION);
  }
});

test('partial, negative, fractional, nonnumeric, unsafe and inconsistent counters never receive default zero', () => {
  for (const usage of [{}, { prompt_tokens: 13 }, { prompt_tokens: 13, completion_tokens: 7 },
    { ...valid, prompt_tokens: -1 }, { ...valid, completion_tokens: 0.5 }, { ...valid, total_tokens: 21 },
    { ...valid, prompt_tokens: '13' }, { ...valid, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, completion_tokens: null }, { ...valid, completion_tokens: Number.NaN }, { ...valid, prompt_tokens: Infinity },
    { ...valid, reasoning_tokens: -1 }, { ...valid, prompt_tokens_details: { audio_tokens: -1 } }]) {
    const evidence = witness([{ usage }]);
    assert.equal(evidence.state, 'invalid', JSON.stringify(usage)); assert.equal(evidence.usage, null);
  }
  const observer = createProviderUsageWitness();
  observer.observe(new TextEncoder().encode('data: {"usage":{"prompt_tokens":1e400,"completion_tokens":0,"total_tokens":1e400}}\n\ndata: [DONE]\n\n'));
  observer.complete(); assert.equal(observer.snapshot().state, 'invalid');
});

test('complete zero and positive counters are reported only after complete transport', () => {
  for (const usage of [valid, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }]) {
    const observer = createProviderUsageWitness();
    observer.observe(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '离线问卷' } }], usage })}\n\ndata: [DONE]\n\n`));
    assert.equal(observer.snapshot().state, 'pending'); assert.equal(observer.snapshot().usage, null);
    observer.complete();
    assert.deepEqual(observer.snapshot().usage, { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens });
    const snapshot = observer.snapshot(); snapshot.usage!.inputTokens = 999;
    assert.equal(observer.snapshot().usage!.inputTokens, usage.prompt_tokens);
  }
});

test('one-byte Chinese SSE fixture preserves UTF8 characters and certifies only the complete usage packet', () => {
  const content = '离线问卷：滨江儿童零食 🐈';
  assert.ok(Buffer.byteLength(content, 'utf8') > content.length);
  const evidence = witness([{ choices: [{ delta: { content }, index: 0, finish_reason: null }], usage: null },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: valid }]);
  assert.equal(evidence.state, 'reported'); assert.equal(evidence.usagePackets, 1);
  assert.deepEqual(evidence.usage, { inputTokens: 13, outputTokens: 7, totalTokens: 20 });
});

test('cache reads and writes are part of total prompt size and contradictory cache metadata fails closed', () => {
  for (const extras of [{ prompt_tokens_details: { cached_tokens: 5 } },
    { prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 8 },
    { prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } }]) {
    assert.deepEqual(witness([{ usage: { ...valid, ...extras } }]).usage, { inputTokens: 13, outputTokens: 7, totalTokens: 20 });
  }
  for (const extras of [{ prompt_cache_hit_tokens: 5 }, { prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7 },
    { prompt_tokens_details: { cached_tokens: -1 } }, { prompt_tokens_details: { cached_tokens: 14 } },
    { prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 9 } },
    { prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 8, prompt_tokens_details: { cached_tokens: 4 } },
    { completion_tokens_details: { reasoning_tokens: 8 } }]) {
    assert.equal(witness([{ usage: { ...valid, ...extras } }]).state, 'invalid');
  }
});

test('a partial or changed usage packet poisons the whole request even if a later packet is complete', () => {
  for (const packets of [[{ usage: { prompt_tokens: 13 } }, { usage: valid }],
    [{ usage: valid }, { usage: { prompt_tokens: 14, completion_tokens: 7, total_tokens: 21 } }]]) {
    const evidence = witness(packets); assert.equal(evidence.state, 'invalid'); assert.equal(evidence.usage, null);
  }
  assert.equal(witness([{ usage: valid }, { usage: valid }]).state, 'reported');
});

test('unfinished, malformed, post-DONE or failed streams cannot certify any usage', () => {
  assert.equal(witness([{ usage: valid }], false).state, 'invalid');
  for (const raw of ['data: {broken}\n\ndata: [DONE]\n\n', `data: ${JSON.stringify({ usage: valid })}\n`,
    `data: [DONE]\n\ndata: ${JSON.stringify({ usage: valid })}\n\n`]) {
    const observer = createProviderUsageWitness(); observer.observe(new TextEncoder().encode(raw)); observer.complete();
    assert.equal(observer.snapshot().state, 'invalid'); assert.equal(observer.snapshot().usage, null);
  }
  const observer = createProviderUsageWitness();
  observer.observe(new TextEncoder().encode(`data: ${JSON.stringify({ usage: valid })}\n\ndata: [DONE]\n\n`));
  observer.fail(); observer.complete();
  assert.equal(observer.snapshot().state, 'transport-failed'); assert.equal(observer.snapshot().usage, null);
});

test('multiline SSE keeps complete usage and oversized many-line events are poisoned without repeated full-array sums', () => {
  const observer = createProviderUsageWitness();
  observer.observe(new TextEncoder().encode('data: {"usage":\ndata: {"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\ndata: [DONE]\n\n'));
  observer.complete(); assert.equal(observer.snapshot().state, 'reported');
  assert.deepEqual(observer.snapshot().usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const large = createProviderUsageWitness();
  large.observe(new TextEncoder().encode(Array.from({ length: 6000 }, () => 'data: ' + 'x'.repeat(100)).join('\n') + '\n\ndata: [DONE]\n\n'));
  large.complete(); assert.equal(large.snapshot().state, 'invalid');
  assert.equal(large.snapshot().reason, 'sse-packet-too-large'); assert.equal(large.snapshot().usage, null);
});
