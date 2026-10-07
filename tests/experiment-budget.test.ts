import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget, ExperimentBudgetError, experimentLedgerPath, type ExperimentBudgetGuard, type ExperimentBudgetOptions } from '../server/research/experiment-budget.ts';

const pricing = {
  provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY' as const,
  inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
  sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', checkedAt: '2026-10-07T00:00:00.000Z',
};
const request = { requestId: 'resident-001', purpose: 'resident-survey', inputText: 'system\n问卷与人格payload', maxOutputTokens: 3000 };

function fixture(overrides: Partial<ExperimentBudgetOptions> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'city-budget-test-'));
  const options = { ledgerPath: join(directory, 'experiment.budget.json'), experimentId: 'test-experiment', budgetCny: 5, maxProviderRequests: 24, pricing, ...overrides };
  let guard: ExperimentBudgetGuard | undefined;
  return {
    directory, options,
    get guard() { guard ??= createExperimentBudget(options); return guard; },
    read() { return JSON.parse(readFileSync(options.ledgerPath, 'utf8')); },
    cleanup() { try { guard?.close(); } finally { rmSync(directory, { recursive: true, force: true }); } },
  };
}

function throwsCode(action: () => unknown, code: ExperimentBudgetError['code']) {
  assert.throws(action, (error: unknown) => error instanceof ExperimentBudgetError && error.code === code);
}

test('pre-call reservation is durable, conservative, keyless, and immutable to caller snapshots', () => {
  const f = fixture();
  try {
    const reserved = f.guard.reserve(request);
    const ledger = f.read();
    assert.equal(ledger.requestCount, 1);
    assert.equal(ledger.reservations[0].state, 'reserved');
    assert.equal(reserved.reservedInputTokens, Buffer.byteLength(request.inputText, 'utf8') + 4096);
    assert.equal(ledger.reservations[0].committedNanoCny, reserved.reservedCny * 1e9);
    assert.equal(ledger.committedCny, reserved.reservedCny);
    assert.equal(ledger.remainingCny, 5 - reserved.reservedCny);
    assert.ok(reserved.reservedCny > 0.024);
    assert.equal(JSON.stringify(ledger).includes(request.inputText), false);
    assert.equal(JSON.stringify(ledger).includes('Authorization'), false);
    const snapshot = f.guard.snapshot(); snapshot.budgetCny = 999; snapshot.reservations.length = 0;
    assert.equal(f.guard.snapshot().budgetCny, 5);
    assert.equal(f.guard.snapshot().requestCount, 1);
    assert.equal(existsSync(`${f.options.ledgerPath}.lock`), true);
  } finally { f.cleanup(); }
});

test('known successful usage releases only the conservative excess and never refunds request count', () => {
  const f = fixture();
  try {
    const reserved = f.guard.reserve(request);
    const settled = f.guard.settle(reserved.reservationId, { outcome: 'succeeded', usage: { inputTokens: 1000, outputTokens: 500 } });
    assert.equal(settled.state, 'active');
    assert.equal(settled.reservations[0].state, 'settled');
    assert.equal(settled.committedCny, 0.006);
    assert.equal(settled.knownUsageCostCny, 0.006);
    assert.equal(settled.requestCount, 1);
    assert.equal(settled.remainingCny, 4.994);
    assert.deepEqual(f.read(), settled);
    f.guard.reserve({ ...request, requestId: 'resident-002' });
    assert.equal(f.guard.snapshot().requestCount, 2);
  } finally { f.cleanup(); }
});

test('zero budget, insufficient budget, and zero requests all fail before authorization', () => {
  for (const [options, code] of [
    [{ budgetCny: 0 }, 'budget-limit'],
    [{ budgetCny: 0.000001 }, 'budget-limit'],
    [{ maxProviderRequests: 0 }, 'request-limit'],
  ] as const) {
    const f = fixture(options);
    try {
      throwsCode(() => f.guard.reserve(request), code);
      assert.equal(f.guard.snapshot().requestCount, 0);
      assert.equal(f.guard.snapshot().state, 'halted');
      throwsCode(() => f.guard.reserve(request), 'halted');
    } finally { f.cleanup(); }
  }
});

test('request cap counts all reserved calls including explicit reported zero usage', () => {
  const f = fixture({ maxProviderRequests: 1 });
  try {
    const first = f.guard.reserve(request);
    f.guard.settle(first.reservationId, { outcome: 'succeeded', usage: { inputTokens: 0, outputTokens: 0 } });
    throwsCode(() => f.guard.reserve({ ...request, requestId: 'resident-002' }), 'request-limit');
    assert.equal(f.guard.snapshot().requestCount, 1);
    assert.equal(f.guard.snapshot().state, 'halted');
    assert.equal(f.guard.snapshot().knownUsageCostCny, 0);
  } finally { f.cleanup(); }
});

test('unknown, fractional, negative, missing or non-finite usage retains reservation and halts', () => {
  for (const usage of [null, { inputTokens: -1, outputTokens: 1 }, { inputTokens: 0.5, outputTokens: 1 }, { inputTokens: Number.NaN, outputTokens: 1 }, { inputTokens: 10, outputTokens: undefined }, { inputTokens: 10, outputTokens: 5, apiKey: 'canary-not-allowed' }]) {
    const f = fixture();
    try {
      const reserved = f.guard.reserve(request);
      const settled = f.guard.settle(reserved.reservationId, { outcome: 'succeeded', usage } as never);
      assert.equal(settled.state, 'halted');
      assert.equal(settled.stopReason, 'unknown-usage');
      assert.equal(settled.committedCny, reserved.reservedCny);
      assert.equal(settled.reservations[0].state, 'uncertain');
      assert.equal(settled.reservations[0].usage, undefined);
      assert.equal(settled.reservations[0].actualNanoCny, undefined);
      assert.equal(settled.usageStatus, 'incomplete');
      assert.equal(settled.knownUsageRequestCount, 0);
      throwsCode(() => f.guard.reserve({ ...request, requestId: 'resident-002' }), 'halted');
      assert.equal(JSON.stringify(f.read()).includes('canary-not-allowed'), false);
    } finally { f.cleanup(); }
  }
});

test('failed and cancelled requests keep full reservations even if reported cost is smaller', () => {
  for (const outcome of ['failed', 'cancelled'] as const) {
    const f = fixture();
    try {
      const first = f.guard.reserve(request);
      const settled = f.guard.settle(first.reservationId, { outcome, usage: { inputTokens: 10, outputTokens: 5 } });
      assert.equal(settled.state, 'halted');
      assert.equal(settled.requestCount, 1);
      assert.equal(settled.committedCny, first.reservedCny);
      assert.equal(settled.knownUsageCostCny, 0.00006);
      assert.equal(settled.stopReason, `request-${outcome}`);
    } finally { f.cleanup(); }
  }
});

test('any input/output token boundary overrun halts even when cost is below total reserved money', () => {
  for (const overrun of ['input', 'output'] as const) {
    const f = fixture();
    try {
      const first = f.guard.reserve(request);
      const usage = overrun === 'input' ? { inputTokens: first.reservedInputTokens + 1, outputTokens: 0 } : { inputTokens: 0, outputTokens: 3001 };
      const settled = f.guard.settle(first.reservationId, { outcome: 'succeeded', usage });
      assert.equal(settled.state, 'halted');
      assert.equal(settled.stopReason, 'usage-exceeded-reservation');
      assert.equal(settled.committedCny, first.reservedCny);
      assert.deepEqual(settled.reservations[0].usage, usage);
    } finally { f.cleanup(); }
  }
});

test('known actual cost over reserve is retained without pretending the external bill is capped', () => {
  const f = fixture();
  try {
    const first = f.guard.reserve(request);
    const settled = f.guard.settle(first.reservationId, { outcome: 'succeeded', usage: { inputTokens: 10_000_000, outputTokens: 10_000_000 } });
    assert.equal(settled.state, 'halted');
    assert.equal(settled.committedCny, 100);
    assert.equal(settled.knownUsageCostCny, 100);
    assert.equal(settled.remainingCny, 0);
    assert.match(settled.limitation, /not a provider billing guarantee/);
  } finally { f.cleanup(); }
});

test('only one outstanding request may be authorized and duplicate IDs cannot be retried', () => {
  const f = fixture();
  try {
    const first = f.guard.reserve(request);
    throwsCode(() => f.guard.reserve({ ...request, requestId: 'resident-002' }), 'pending-request');
    assert.equal(f.guard.snapshot().requestCount, 1);
    f.guard.settle(first.reservationId, { outcome: 'succeeded', usage: { inputTokens: 1, outputTokens: 1 } });
    throwsCode(() => f.guard.reserve(request), 'invalid-request');
    assert.equal(f.guard.snapshot().state, 'halted');
    assert.equal(f.guard.snapshot().requestCount, 1);
  } finally { f.cleanup(); }
});

test('unknown and duplicate settlement fail closed rather than adjusting a previous record', () => {
  for (const duplicate of [false, true]) {
    const f = fixture();
    try {
      const first = f.guard.reserve(request);
      if (duplicate) f.guard.settle(first.reservationId, { outcome: 'succeeded', usage: { inputTokens: 1, outputTokens: 1 } });
      const before = f.guard.snapshot().reservations[0];
      throwsCode(() => f.guard.settle(duplicate ? first.reservationId : 'unknown', { outcome: 'succeeded', usage: { inputTokens: 0, outputTokens: 0 } }), 'invalid-settlement');
      assert.equal(f.guard.snapshot().state, 'halted');
      assert.deepEqual(f.guard.snapshot().reservations[0], before);
    } finally { f.cleanup(); }
  }
});

test('existing ledgers are never resumed or overwritten, including after normal close', () => {
  const f = fixture();
  try {
    const first = f.guard.reserve(request);
    f.guard.settle(first.reservationId, { outcome: 'succeeded', usage: { inputTokens: 1, outputTokens: 1 } });
    throwsCode(() => createExperimentBudget(f.options), 'existing-ledger');
    f.guard.close();
    const original = readFileSync(f.options.ledgerPath, 'utf8');
    throwsCode(() => createExperimentBudget(f.options), 'existing-ledger');
    assert.equal(readFileSync(f.options.ledgerPath, 'utf8'), original);
    assert.equal(existsSync(`${f.options.ledgerPath}.lock`), false);
    throwsCode(() => f.guard.reserve({ ...request, requestId: 'resident-002' }), 'closed');
  } finally { f.cleanup(); }
});

test('exclusive lock prevents a fresh concurrent ledger and is never auto-cleared', () => {
  const f = fixture();
  try {
    const lockPath = `${f.options.ledgerPath}.lock`;
    const lock = JSON.stringify({ owner: 'different-owner', pid: process.pid });
    writeFileSync(lockPath, lock);
    throwsCode(() => createExperimentBudget(f.options), 'locked');
    assert.equal(readFileSync(lockPath, 'utf8'), lock);
    assert.equal(existsSync(f.options.ledgerPath), false);
  } finally { f.cleanup(); }
});

test('reservation storage failure authorizes zero new requests and poisons later operations', () => {
  const f = fixture();
  const moved = `${f.directory}-moved`;
  try {
    void f.guard;
    renameSync(f.directory, moved);
    throwsCode(() => f.guard.reserve(request), 'storage-failed');
    assert.equal(f.guard.snapshot().requestCount, 0);
    assert.equal(f.guard.snapshot().state, 'halted');
    assert.equal(f.guard.snapshot().storageStatus, 'uncertain');
    throwsCode(() => f.guard.reserve(request), 'storage-failed');
    const original = JSON.parse(readFileSync(join(moved, 'experiment.budget.json'), 'utf8'));
    assert.equal(original.requestCount, 0);
    f.guard.close();
  } finally { f.cleanup(); rmSync(moved, { recursive: true, force: true }); }
});

test('settlement storage failure leaves pre-call reservation intact and poisons later operations', () => {
  const f = fixture();
  const moved = `${f.directory}-moved`;
  try {
    const reserved = f.guard.reserve(request);
    renameSync(f.directory, moved);
    throwsCode(() => f.guard.settle(reserved.reservationId, { outcome: 'succeeded', usage: { inputTokens: 1, outputTokens: 1 } }), 'storage-failed');
    throwsCode(() => f.guard.reserve({ ...request, requestId: 'resident-002' }), 'storage-failed');
    const original = JSON.parse(readFileSync(join(moved, 'experiment.budget.json'), 'utf8'));
    assert.equal(original.requestCount, 1);
    assert.equal(original.reservations[0].state, 'reserved');
    assert.equal(original.committedCny, reserved.reservedCny);
    f.guard.close();
  } finally { f.cleanup(); rmSync(moved, { recursive: true, force: true }); }
});

test('close with a pending request marks uncertain and retains its reservation', () => {
  const f = fixture();
  try {
    const reserved = f.guard.reserve(request);
    f.guard.close();
    const ledger = f.read();
    assert.equal(ledger.state, 'halted');
    assert.equal(ledger.stopReason, 'closed-with-pending-request');
    assert.equal(ledger.reservations[0].state, 'uncertain');
    assert.equal(ledger.committedCny, reserved.reservedCny);
    assert.equal(existsSync(`${f.options.ledgerPath}.lock`), false);
    throwsCode(() => createExperimentBudget(f.options), 'existing-ledger');
  } finally { f.cleanup(); }
});

test('invalid config, credentials, unknown fields and under-sized envelopes are rejected', () => {
  const f = fixture();
  try {
    for (const invalid of [
      { ...f.options, ledgerPath: 'relative.json' }, { ...f.options, budgetCny: -1 }, { ...f.options, maxProviderRequests: 1.5 },
      { ...f.options, apiKey: 'canary-private' },
      { ...f.options, pricing: { ...pricing, apiKey: 'canary-private' } },
      { ...f.options, pricing: { ...pricing, sourceUrl: 'https://user:private@example.com/pricing' } },
      { ...f.options, pricing: { ...pricing, sourceUrl: 'https://example.com/pricing?key=private' } },
      { ...f.options, pricing: { ...pricing, inputCnyPerMillionTokens: 0 } },
      { ...f.options, pricing: { ...pricing, outputCnyPerMillionTokens: Number.POSITIVE_INFINITY } },
    ]) throwsCode(() => createExperimentBudget(invalid as never), 'invalid-config');
    assert.equal(existsSync(f.options.ledgerPath), false);
    throwsCode(() => f.guard.reserve({ ...request, inputEnvelopeTokens: 0 }), 'invalid-request');
    assert.equal(f.guard.snapshot().requestCount, 0);
    assert.equal(f.guard.snapshot().state, 'halted');
  } finally { f.cleanup(); }
});

test('prices round upward and authorised money rounds downward at nano-CNY boundaries', () => {
  const f = fixture({ budgetCny: 0.1000000009, pricing: { ...pricing, inputCnyPerMillionTokens: 0.0001, outputCnyPerMillionTokens: 0.0001 } });
  try {
    assert.equal(f.guard.snapshot().budgetNanoCny, 100_000_000);
    assert.equal(f.guard.snapshot().inputNanoCnyPerToken, 1);
    assert.equal(f.guard.snapshot().outputNanoCnyPerToken, 1);
    assert.equal(experimentLedgerPath(f.directory, 'safe-id'), join(f.directory, 'safe-id.budget.json'));
    throwsCode(() => experimentLedgerPath(f.directory, '../unsafe'), 'invalid-config');
  } finally { f.cleanup(); }
});

test('24 bounded successful settlements can release reserves, but a 25th provider request is refused', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 24; i++) {
      const reserved = f.guard.reserve({ ...request, requestId: `request-${i + 1}` });
      const settled = f.guard.settle(reserved.reservationId, { outcome: 'succeeded', usage: { inputTokens: 100, outputTokens: 50 } });
      assert.equal(settled.requestCount, i + 1);
      assert.equal(settled.state, 'active');
      assert.equal(settled.reservations[i].state, 'settled');
    }
    assert.equal(f.guard.snapshot().knownUsageRequestCount, 24);
    assert.equal(f.guard.snapshot().usageStatus, 'reported');
    assert.equal(f.guard.snapshot().committedCny, 0.0144);
    throwsCode(() => f.guard.reserve({ ...request, requestId: 'request-25' }), 'request-limit');
    assert.equal(f.read().requestCount, 24);
    assert.equal(f.read().state, 'halted');
  } finally { f.cleanup(); }
});
