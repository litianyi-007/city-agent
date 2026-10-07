import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { productionRunInputSchema, PRODUCTION_REPAIR_POLICY_VERSION, type ProductionRun } from '../shared/production-schema.js';
import { productionReport } from '../server/production/index.js';

function fixture(): ProductionRun {
  return { id: randomUUID(), status: 'failed', createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'injected-test', input: productionRunInputSchema.parse({ brief: 'Free report snapshot only', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'report-unit', source: 'Injected engineering test', acceptance: 'Ledger fidelity', kind: 'illustrative' } }), agentSnapshot: [], events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, complete: false, currency: 'USD' }, interventions: [], artifacts: [] };
}

test('submission report exports exact new repair ledger without rewriting historical unknowns', () => {
  const old = fixture(); const current = fixture(); current.repairs = 1; current.repairPolicyVersion = PRODUCTION_REPAIR_POLICY_VERSION;
  current.repairHistory = [{ id: randomUUID(), time: '2026-10-07T00:00:01Z', phase: 'acceptance', role: 'tester', kind: 'stage-regeneration', attempt: 1, reason: 'Invalid JSON rejected, new role call required', rejectedCandidateIds: ['original-candidate'], frozenHash: null }];
  const before = JSON.stringify([old, current]); const report = productionReport([old, current]);
  assert.equal(report.executionRecords[0].repairPolicyVersion, null); assert.equal(report.executionRecords[0].repairHistory, null);
  assert.equal(report.executionRecords[1].repairPolicyVersion, PRODUCTION_REPAIR_POLICY_VERSION); assert.equal(report.executionRecords[1].repairCount, 1); assert.deepEqual(report.executionRecords[1].repairHistory, current.repairHistory);
  assert.equal(JSON.stringify([old, current]), before); assert.equal(report.metrics.realModelStarted, 0, 'Injected report state cannot become real model evidence');
});
