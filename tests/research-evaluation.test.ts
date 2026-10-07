import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { getResearchTemplates } from '../server/research/templates';
import { getResidentTemplates, residentCreateSchema, residentPublic } from '../server/research/residents';
import { executeSurvey } from '../shared/survey-runner';
import { createCompletenessPlan, evaluateCompleteness } from '../shared/research-evaluation';

async function fixture() {
  return executeSurvey({ task: getResearchTemplates()[2], pack: getPopulationPack(), population: getPopulationModel(),
    presets: [residentPublic(residentCreateSchema.parse(getResidentTemplates()[0]), 'test-general', '2026-10-07', false)],
    mode: 'fixture', count: 3, seed: 42, signal: new AbortController().signal,
    pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: '2026-10-07', source: 'test only' },
    call: async () => { throw new Error('must never call'); } });
}
test('offline completeness reports fixture thresholds without upgrading real-model or market gates', async () => {
  const run = await fixture();
  const plan = createCompletenessPlan(run, { id: 'synthetic-test', registeredAt: '2026-01-01T00:00:00Z', requireRealModel: false });
  const report = evaluateCompleteness(plan, run);
  assert.equal(report.status, 'threshold-met'); assert.equal(report.counts.valid, 3);
  assert.equal(report.realThirtyResidentGate, 'not-met'); assert.equal(report.externalValidity, 'not-validated');
  assert.equal(report.metrics.modelCalls, 0); assert.match(report.reportHash, /^[a-f0-9]{64}$/);
  assert.equal(evaluateCompleteness({ ...plan, requireRealModel: true }, run).status, 'not-qualified');
});
test('late preregistration, wrong frame and duplicate planned IDs cannot qualify', async () => {
  const run = await fixture(); const plan = createCompletenessPlan(run, { id: 'negative', registeredAt: '2026-01-01T00:00:00Z', requireRealModel: false });
  for (const changed of [{ registeredAt: '2030-01-01T00:00:00Z' }, { profileHash: '0'.repeat(64) }, { exposure: 'no-persona' as const }]) assert.equal(evaluateCompleteness({ ...plan, ...changed }, run).status, 'not-qualified');
  assert.throws(() => evaluateCompleteness({ ...plan, plannedResidentIds: ['one', 'one'] }, run));
});
test('tampered valid counts or raw answers are rejected rather than trusted as score evidence', async () => {
  const run = await fixture(); const plan = createCompletenessPlan(run, { id: 'tamper', registeredAt: '2026-01-01T00:00:00Z', requireRealModel: false });
  assert.throws(() => evaluateCompleteness(plan, { ...run, metrics: { ...run.metrics, valid: 29 } }), /汇总/);
  const changed = structuredClone(run); changed.responses[0].raw = '{}';
  assert.throws(() => evaluateCompleteness(plan, changed));
});
