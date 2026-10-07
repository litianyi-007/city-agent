import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HarnessCallError, HARNESS_NAME, type RoleResult, type runRole } from '../server/harness.ts';
import { runBoundedHarness } from '../server/research/bounded-harness.ts';
import { createExperimentBudget, ExperimentBudgetError } from '../server/research/experiment-budget.ts';
import type { SingleRequestRelaySnapshot } from '../server/research/single-request-relay.ts';

const model = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', apiKey: 'offline-wire-fixture-key' };
const system = 'Return JSON only.';
const user = '离线 fixture: usage contract.';
const validUsage = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 };
const pricing = { provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY' as const,
  inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
  sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', checkedAt: '2026-10-07T00:00:00.000Z' };

function stream(usage: unknown, includeUsage = true) {
  return [{ choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }], usage: null },
    { choices: [{ delta: { content: '{"offline":true}' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], ...(includeUsage ? { usage } : {}) }]
    .map(packet => `data: ${JSON.stringify(packet)}\n\n`).join('') + 'data: [DONE]\n\n';
}

async function fixture(body: string | null) {
  let wireRequests = 0;
  const server = createServer(async (request, response) => {
    wireRequests++;
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/chat/completions');
    assert.equal(request.headers.authorization, `Bearer ${model.apiKey}`);
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(payload.model, model.modelId); assert.equal(payload.max_tokens, 3000);
    if (body === null) { request.socket.destroy(); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const bytes = Buffer.from(body);
    // Actual HTTP fetch boundaries deliberately differ from SSE packet boundaries.
    response.write(bytes.subarray(0, 11)); response.write(bytes.subarray(11, 23)); response.end(bytes.subarray(23));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const directory = mkdtempSync(join(tmpdir(), 'city-witness-test-'));
  const ledgerPath = join(directory, 'budget.json');
  const guard = createExperimentBudget({ ledgerPath, experimentId: 'offline-usage-witness', budgetCny: 5, maxProviderRequests: 24, pricing });
  const transport: SingleRequestRelaySnapshot[] = [];
  const upstreamFetch: typeof fetch = (url, init) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions'); assert.equal(init?.redirect, 'error');
    return fetch(`http://127.0.0.1:${address.port}/chat/completions`, init);
  };
  return { guard, transport, ledgerPath, wireRequests: () => wireRequests,
    call: (requestId = 'resident-001', roleRunner?: typeof runRole) => runBoundedHarness({ guard, requestId, purpose: 'resident', model, system, user,
      signal: new AbortController().signal, maxOutputTokens: 3000, upstreamFetch, roleRunner, onTransport: snapshot => transport.push(snapshot) }),
    async close() {
      try { guard.close(); } finally {
        server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

function retained(f: Awaited<ReturnType<typeof fixture>>, expectedWireRequests = 1) {
  const ledger = f.guard.snapshot();
  assert.equal(ledger.state, 'halted'); assert.equal(ledger.usageStatus, 'incomplete'); assert.equal(ledger.knownUsageRequestCount, 0);
  assert.equal(ledger.requestCount, 1); assert.equal(ledger.reservations[0].state, 'uncertain');
  assert.equal(ledger.reservations[0].usage, undefined); assert.equal(ledger.reservations[0].actualNanoCny, undefined);
  assert.ok(ledger.reservations[0].reservationNanoCny > 0);
  assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny);
  assert.deepEqual(JSON.parse(readFileSync(f.ledgerPath, 'utf8')), ledger);
  assert.equal(f.wireRequests(), expectedWireRequests); assert.equal(f.transport[0].forwardedRequests, expectedWireRequests);
}

test('real Harness SDK defaults absent usage fields to zero, but the bounded wire witness halts and retains the reserve', { timeout: 60_000 }, async () => {
  for (const body of [stream(undefined, false), stream({ prompt_tokens: 13 }),
    stream({ ...validUsage, prompt_tokens: -1 }), stream({ ...validUsage, total_tokens: 21 })]) {
    const f = await fixture(body);
    try {
      await assert.rejects(f.call(), (error: unknown) => error instanceof HarnessCallError && error.evidence.inputTokens === null && error.evidence.outputTokens === null);
      retained(f);
      assert.equal(f.transport[0].deniedRequests, 0, 'The SDK did not attempt a retry after its first response.');
      await assert.rejects(f.call('resident-002'), (error: unknown) => error instanceof ExperimentBudgetError && error.code === 'halted');
      assert.equal(f.wireRequests(), 1, 'No follow-up sample, fallback, top-up, or upstream retry is permitted.');
      assert.equal(f.transport.length, 1);
    } finally { await f.close(); }
  }
});

test('real Harness SDK and wire totals agree for legitimate zero, positive, cache hits and cache writes', { timeout: 60_000 }, async () => {
  for (const usage of [{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, validUsage,
    { ...validUsage, prompt_tokens_details: { cached_tokens: 5 } },
    { ...validUsage, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 8 },
    { ...validUsage, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 } }]) {
    const f = await fixture(stream(usage));
    try {
      const result = await f.call(); assert.equal(result.text, '{"offline":true}'); assert.equal(result.harness, HARNESS_NAME);
      assert.equal(result.usageReported, true); assert.equal(result.inputTokens, usage.prompt_tokens); assert.equal(result.outputTokens, usage.completion_tokens);
      const ledger = f.guard.snapshot(); assert.equal(ledger.state, 'active'); assert.equal(ledger.knownUsageRequestCount, 1);
      assert.deepEqual(ledger.reservations[0].usage, { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens });
      assert.equal(ledger.committedNanoCny, usage.prompt_tokens * 2000 + usage.completion_tokens * 8000);
      assert.equal(f.transport[0].providerUsageWitness.state, 'reported'); assert.equal(f.transport[0].deniedRequests, 0);
      assert.equal(f.wireRequests(), 1);
    } finally { await f.close(); }
  }
});

test('actual upstream socket failure stops globally after one wire request without zero settlement or retry', { timeout: 45_000 }, async () => {
  const f = await fixture(null);
  try {
    await assert.rejects(f.call()); retained(f);
    assert.equal(f.transport[0].providerUsageWitness.state, 'transport-failed');
    assert.equal(f.transport[0].deniedRequests, 0);
    await assert.rejects(f.call('resident-002')); assert.equal(f.wireRequests(), 1);
  } finally { await f.close(); }
});

const directRunner = (repeat = false, wrongSdkUsage = false): typeof runRole => async (agent, system, user, _signal, _onEvent, limits): Promise<RoleResult> => {
  const payload = { model: agent.modelId, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: limits!.maxOutputTokens, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } };
  const send = () => fetch(`${agent.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${agent.apiKey}` }, body: JSON.stringify(payload) });
  const first = await send(); assert.equal(first.status, 200); await first.text();
  if (repeat) { const second = await send(); assert.equal(second.status, 409); await second.text(); }
  return { text: '{"offline":true}', harness: 'injected-fixture', inputTokens: wrongSdkUsage ? 0 : 13, outputTokens: 7, usageReported: true };
};

test('duplicate relay requests and SDK/wire discrepancies poison settlement without additional upstream requests', async () => {
  for (const [repeat, wrongSdkUsage] of [[true, false], [false, true]]) {
    const f = await fixture(stream(validUsage));
    try {
      await assert.rejects(f.call('resident-001', directRunner(repeat, wrongSdkUsage))); retained(f);
      assert.equal(f.transport[0].providerUsageWitness.state, 'reported'); assert.equal(f.transport[0].deniedRequests, repeat ? 1 : 0);
      await assert.rejects(f.call('resident-002')); assert.equal(f.wireRequests(), 1);
    } finally { await f.close(); }
  }
});

test('replaced prompts, nested additions, malformed first JSON and excess body bytes cannot escape a reservation through a corrected retry', async () => {
  for (const mode of ['swap-prompts', 'nested-extra', 'malformed-first', 'wire-whitespace']) {
    const f = await fixture(stream(validUsage));
    const runner: typeof runRole = async (agent, system, user, _signal, _event, limits) => {
      const payload = { model: agent.modelId, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: limits!.maxOutputTokens, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } };
      const wrong = mode === 'swap-prompts' ? JSON.stringify({ ...payload, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Different content' }] })
        : mode === 'nested-extra' ? JSON.stringify({ ...payload, thinking: { type: 'disabled', extra: 'unregistered' } })
        : mode === 'malformed-first' ? '{malformed' : JSON.stringify(payload) + ' '.repeat(20_000);
      const send = (body: string) => fetch(`${agent.baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${agent.apiKey}` }, body });
      const first = await send(wrong); assert.equal(first.status, mode === 'malformed-first' ? 502 : 409); await first.text();
      const corrected = await send(JSON.stringify(payload)); assert.equal(corrected.status, 409); await corrected.text();
      // Even a runner falsely claiming success cannot settle a denied invocation.
      return { text: '{"offline":true}', inputTokens: 13, outputTokens: 7, usageReported: true, harness: 'injected-fixture' };
    };
    try {
      await assert.rejects(f.call('resident-001', runner)); retained(f, 0);
      assert.equal(f.transport[0].requestAttempts, 2); assert.equal(f.transport[0].deniedRequests, 2);
      assert.equal(f.transport[0].forwardedBodySha256, null);
      await assert.rejects(f.call('resident-002')); assert.equal(f.wireRequests(), 0);
    } finally { await f.close(); }
  }
});
