import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productionReport } from '../server/production/index.js';
import type { ProductionRun } from '../shared/production-schema.js';

test('submission report preserves typed verifier escalation and source linkage, without rewriting old failed evidence', () => {
  const historical: ProductionRun = JSON.parse(readFileSync(new URL('../docs/production/experiments/CAMERA-03/run.json', import.meta.url), 'utf8'));
  const unchanged = JSON.stringify(historical);
  const oldReport = productionReport([historical]);
  assert.deepEqual(oldReport.executionRecords[0].verifications, historical.verifications);
  assert.equal(oldReport.metrics.realModelPassed, 0);
  assert.equal(oldReport.executionRecords[0].status, 'failed');
  assert.equal(oldReport.executionRecords[0].actualProviderRequests, 3);

  const failedAttempt = structuredClone(historical);
  failedAttempt.evidenceKind = 'injected-test';
  failedAttempt.calls.push({
    ...structuredClone(failedAttempt.calls[0]),
    id: 'free-verifier-attempt', role: 'verifier', phase: 'product:verify',
    executionSource: 'injected', verificationEngine: 'jev-llm-protocol-fallback',
    sourceJevCallId: failedAttempt.jevCalls![0].id,
    rawOutput: '', error: 'Injected unknown usage; no model judgment obtained',
    usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD' },
  });
  const attemptReport = productionReport([failedAttempt]);
  assert.equal(attemptReport.executionRecords[0].verifierAttempts[0].engine, 'jev-llm-protocol-fallback');
  assert.equal(attemptReport.executionRecords[0].verifierAttempts[0].sourceJevCallId, failedAttempt.jevCalls![0].id);
  assert.equal(attemptReport.executionRecords[0].verifierAttempts[0].usage.estimatedCost, null);
  assert.deepEqual(attemptReport.executionRecords[0].verifications, historical.verifications, 'Unobserved attempt must not fabricate a model judgment');

  const fixture = structuredClone(historical);
  fixture.evidenceKind = 'injected-test';
  fixture.verifications.push({
    phase: 'product',
    engine: 'jev-llm-protocol-fallback',
    sourceJevCallId: fixture.jevCalls![0].id,
    candidateIds: ['fixture-candidate'],
    selectedCandidateId: null,
    criteriaHash: 'fixture-hash',
    scores: [{ candidateId: 'fixture-candidate', score: 1, reason: 'Injected semantic rejection, not a model result' }],
    decision: 'abstain',
    reason: 'Injected standalone verifier; malformed Jev decision is not acceptance',
  });
  const report = productionReport([fixture]);
  assert.deepEqual(report.executionRecords[0].verifications, fixture.verifications);
  assert.equal(report.executionRecords[0].verifications.at(-1)!.sourceJevCallId, fixture.jevCalls![0].id);
  assert.equal(report.metrics.realModelStarted, 0, 'fixture must not enter real autonomous denominator');
  assert.equal(report.metrics.realModelPassed, 0);
  assert.equal(JSON.stringify(historical), unchanged, 'no v3 fields or success backfill into old CAMERA-03');
});
