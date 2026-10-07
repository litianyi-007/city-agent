import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget, ExperimentBudgetError } from '../server/research/experiment-budget.ts';
import { providerJsonUsageWitness } from '../server/research/provider-usage-witness.ts';

const valid = { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 };
const pricing = { provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY' as const,
  inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
  sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', checkedAt: '2026-10-07T00:00:00.000Z' };

test('offline browser response JSON rejects missing, partial, contradictory total/cache/auxiliary usage and retains the CORS reserve', () => {
  const usages: unknown[] = [undefined, null, {}, { prompt_tokens: 13, completion_tokens: 7 },
    { ...valid, total_tokens: 21 }, { ...valid, prompt_tokens: -1 },
    { ...valid, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7 },
    { ...valid, prompt_tokens_details: { cached_tokens: 14 } },
    { ...valid, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 9 } },
    { ...valid, completion_tokens_details: { reasoning_tokens: 8 } },
    { ...valid, prompt_tokens_details: { audio_tokens: -1 } },
    JSON.parse('{"prompt_tokens":1e400,"completion_tokens":0,"total_tokens":1e400}')];
  for (const usage of usages) {
    const directory = mkdtempSync(join(tmpdir(), 'city-browser-usage-'));
    const guard = createExperimentBudget({ ledgerPath: join(directory, 'budget.json'), experimentId: 'offline-cors', budgetCny: 5, maxProviderRequests: 2, pricing });
    try {
      const reserved = guard.reserve({ requestId: 'cors.child-snacks', purpose: 'browser-cors', inputText: '离线CORS问卷', maxOutputTokens: 3000, inputEnvelopeTokens: 16384 });
      const body = { choices: [{ message: { content: '{"offline":true}' }, finish_reason: 'stop' }], ...(usage === undefined ? {} : { usage }) };
      const witness = providerJsonUsageWitness(body.usage ?? null);
      assert.notEqual(witness.state, 'reported'); assert.equal(witness.usage, null);
      const ledger = guard.settle(reserved.reservationId, { outcome: 'succeeded', usage: witness.usage });
      assert.equal(ledger.state, 'halted'); assert.equal(ledger.knownUsageRequestCount, 0); assert.equal(ledger.usageStatus, 'incomplete');
      assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny);
      assert.equal(ledger.reservations[0].usage, undefined);
      assert.throws(() => guard.reserve({ requestId: 'cors.pet-snacks', purpose: 'browser-cors', inputText: 'No replacement', maxOutputTokens: 3000 }),
        (error: unknown) => error instanceof ExperimentBudgetError && error.code === 'halted');
    } finally { guard.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('offline browser response JSON preserves legitimate zero and total prompt counters including cache hits and writes', () => {
  for (const usage of [{ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, valid,
    { ...valid, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 8 },
    { ...valid, prompt_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 } }]) {
    const body = JSON.parse(JSON.stringify({ usage }));
    const witness = providerJsonUsageWitness(body.usage);
    assert.equal(witness.state, 'reported');
    assert.deepEqual(witness.usage, { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens });
  }
});
