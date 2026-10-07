import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isUnresolvedJevIntent, productionRequestCounts, projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

const archived = (): ProductionRun => JSON.parse(readFileSync(new URL('../docs/production/experiments/CAMERA-05/run.json', import.meta.url), 'utf8'));

test('read-only CAMERA-05 projection retains unknown totals and separately reports observed POSTs and known subtotal', () => {
  const run = archived(); const before = JSON.stringify(run);
  const { requests, usage } = projectProductionLedger(run);
  assert.equal(requests.harnessInvocations, 8); assert.equal(requests.knownHarnessProviderRequests, 7);
  assert.equal(requests.jevProviderRequests, 3); assert.equal(requests.actualProviderRequests, 10); assert.equal(requests.budgetRecords, 11);
  assert.equal(requests.unknownRequestIntents, 0);
  assert.deepEqual(usage.inputTokens, { knownSubtotal: 61317, reportedEntries: 10, unknownEntries: 1, overflow: false });
  assert.deepEqual(usage.outputTokens, { knownSubtotal: 4842, reportedEntries: 10, unknownEntries: 1, overflow: false });
  assert.ok(Math.abs(usage.estimatedCost.knownSubtotal! - 0.01776294) < 1e-12);
  assert.equal(usage.unknownUsageEntries, 1); assert.equal(usage.currency, 'USD');
  assert.equal(run.usage.inputTokens, null); assert.equal(run.usage.estimatedCost, null);
  assert.equal(JSON.stringify(run), before);
});

test('reported zero POST and zero input remain known without inventing unknown output or cost', () => {
  const run = archived(); run.calls = [run.calls.at(-1)!]; run.jevCalls = [];
  run.calls[0].usage.inputTokens = 0;
  const ledger = projectProductionLedger(run);
  assert.equal(ledger.requests.actualProviderRequests, 0);
  assert.equal(ledger.usage.inputTokens.knownSubtotal, 0);
  assert.equal(ledger.usage.outputTokens.knownSubtotal, null);
  assert.equal(ledger.usage.estimatedCost.knownSubtotal, null);
  assert.equal(ledger.usage.unknownUsageEntries, 1);
});

test('missing legacy Jev observations and unclassified role records never imply zero HTTP', () => {
  const run = archived(); run.calls = []; run.jevCalls = [run.jevCalls![0]];
  const evaluation = run.jevCalls[0].evaluation;
  Object.assign(evaluation, { providerRequests: 0, durationMs: 120, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } });
  for (const field of ['requestSnapshot', 'rawResponse', 'httpStatus', 'modelIdReturned', 'error'] as const) delete (evaluation as unknown as Record<string, unknown>)[field];
  assert.equal(isUnresolvedJevIntent(evaluation), true);
  assert.equal(productionRequestCounts(run).actualProviderRequests, null);
  assert.equal(productionRequestCounts(run).unknownJevRequestIntents, 1);
  evaluation.error = '已完成的控制面预检拒绝，没有派发';
  assert.equal(productionRequestCounts(run).actualProviderRequests, 0);
  run.jevCalls = []; run.calls = [archived().calls[0]];
  delete (run.calls[0] as unknown as Record<string, unknown>).executionSource;
  assert.equal(productionRequestCounts(run).unclassifiedCallRecords, 1);
  assert.equal(productionRequestCounts(run).actualProviderRequests, null);
});

test('cost subtotal excludes missing, unsupported and mixed currencies instead of guessing or converting', () => {
  for (const [aggregate, entry] of [[undefined, undefined], ['USD', undefined], ['USD', 'CNY'], ['GBP', 'GBP']]) {
    const run = archived(); run.calls = [run.calls[0]]; run.jevCalls = [];
    Object.assign(run.usage, { currency: aggregate }); Object.assign(run.calls[0].usage, { currency: entry, estimatedCost: 1 });
    const ledger = projectProductionLedger(run);
    assert.equal(ledger.usage.estimatedCost.knownSubtotal, null);
    assert.equal(ledger.usage.estimatedCost.unknownEntries, 1);
    assert.equal(ledger.usage.currencyMismatchEntries, 1);
    assert.equal(ledger.usage.unknownUsageEntries, 1);
  }
});

test('invalid counters and overflow fail to unknown; Mock/injected role records are not inferred provider calls', () => {
  for (const value of [undefined, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const run = archived(); run.jevCalls = []; run.calls = [run.calls[0]];
    Object.assign(run.calls[0].providerRequests!, { requests: value });
    assert.equal(productionRequestCounts(run).actualProviderRequests, null);
  }
  const run = archived(); run.jevCalls = []; run.calls = run.calls.slice(0, 2);
  for (const call of run.calls) call.providerRequests!.requests = Number.MAX_SAFE_INTEGER;
  assert.equal(productionRequestCounts(run).actualProviderRequests, null);
  assert.equal(productionRequestCounts(run).knownProviderRequests, null);
  run.calls[0].executionSource = 'mock'; run.calls[1].executionSource = 'injected';
  assert.equal(productionRequestCounts(run).actualProviderRequests, 0);
  assert.equal(productionRequestCounts(run).simulatedStageRecords, 1);
  assert.equal(productionRequestCounts(run).injectedTestRecords, 1);
});
