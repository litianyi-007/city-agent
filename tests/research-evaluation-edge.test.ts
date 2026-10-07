import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonaProof } from '../scripts/create-persona-proof.ts';
import { createCompletenessPlan, evaluateCompleteness } from '../shared/research-evaluation.ts';
import { fingerprint } from '../shared/evidence.ts';
import { residentPrompt, type SurveyRun } from '../shared/survey-engine.ts';
import { samplingReport } from '../shared/survey-analysis.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

async function evidence(count = 4) { return (await createPersonaProof({ count })).run; }

test('30-person fixture cannot qualify for a real-model gate or market validity', async () => {
  const run = await evidence(30);
  const plan = createCompletenessPlan(run, { id: 'edge-fixture', registeredAt: run.startedAt, requireRealModel: false });
  const report = evaluateCompleteness(plan, run);
  assert.equal(report.counts.planned, 30); assert.equal(report.counts.valid, 30);
  assert.equal(report.realThirtyResidentGate, 'not-met');
  assert.equal(report.executionIdentity, 'declared-mode-not-independently-attested');
  assert.equal(report.externalValidity, 'not-validated');
  assert.equal(evaluateCompleteness({ ...plan, requireRealModel: true }, run).status, 'not-qualified');
});

test('offline timestamps remain self-declared and do not certify immutable preregistration', async () => {
  const run = await evidence();
  // This plan is knowingly constructed AFTER evidence exists; a backdated field is not attestation.
  const plan = createCompletenessPlan(run, { id: 'edge-declared-time', registeredAt: run.startedAt, requireRealModel: false });
  const report = evaluateCompleteness(plan, run);
  assert.match(report.limitations.join('\n'), /计划时间.*声明.*不是不可伪造/);
  assert.equal(report.registrationIdentity, 'declared-not-independently-attested');
  assert.equal('preRegistered' in report, false);
  assert.equal('registrationVerified' in report, false);
  const late = { ...plan, registeredAt: new Date(Date.parse(run.startedAt) + 1).toISOString() };
  assert.equal(evaluateCompleteness(late, run).status, 'not-qualified');
});

test('usage, cost and invocation fields cannot carry impossible values into a trusted report', async () => {
  const run = await evidence();
  for (const metrics of [
    { inputTokens: -1 }, { outputTokens: Number.NaN }, { inputTokens: .5 }, { modelCalls: -1 },
    { apiCostCny: -1 }, { apiCostCny: Number.POSITIVE_INFINITY }, { inputTokens: null }, { apiCostCny: 9 },
  ]) assert.throws(() => parseSurveyEvidence({ ...run, metrics: { ...run.metrics, ...metrics } }));
});

test('response Token totals must match metrics, while live unknown usage cannot become zero cost', async () => {
  const run = await evidence();
  const mismatched = structuredClone(run); mismatched.responses[0].inputTokens = 19;
  assert.throws(() => parseSurveyEvidence(mismatched));
  const unknown = structuredClone(run); unknown.mode = 'live'; unknown.metrics.modelCalls = run.profiles.length;
  for (const response of unknown.responses) { response.inputTokens = null; response.outputTokens = null; }
  unknown.metrics.inputTokens = null; unknown.metrics.outputTokens = null; unknown.metrics.apiCostCny = 0;
  assert.throws(() => parseSurveyEvidence(unknown));
  unknown.metrics.apiCostCny = null;
  assert.equal(parseSurveyEvidence(unknown).metrics.apiCostCny, null);
});

test('five-layer profile and preset snapshots cannot disagree even after downstream hash recalculation', async () => {
  const run = await evidence();
  const changed: SurveyRun = structuredClone(run);
  const profile = changed.profiles[0]; assert.ok(profile.persona);
  profile.persona.education.level = profile.persona.education.level === 'master' ? 'bachelor' : 'master';
  changed.profileHash = fingerprint(changed.profiles);
  const user = changed.prompt.users.find(item => item.residentId === profile.id)!;
  user.text = residentPrompt(changed.task, profile, changed.exposure ?? 'full'); user.hash = fingerprint(user.text);
  assert.throws(() => parseSurveyEvidence(changed));
});

test('unknown layers cannot be marked fact and nested credential fields are rejected before persistence', async () => {
  const run = await evidence();
  const fact = structuredClone(run) as any; fact.profiles[0].persona.provenance = 'fact';
  fact.profileHash = fingerprint(fact.profiles);
  assert.throws(() => parseSurveyEvidence(fact));
  assert.throws(() => parseSurveyEvidence({ ...run, extra: { arbitrary: [{ SECRET: 'do-not-save' }] } }), /密钥/);
});

test('distinct five-layer inputs count as distinct synthetic profiles, not independent real humans', async () => {
  const run = await evidence();
  const first = structuredClone(run.profiles[0]); assert.ok(first.persona);
  const second = structuredClone(first); second.id = 'other-synthetic-id';
  second.persona!.education.level = first.persona.education.level === 'master' ? 'bachelor' : 'master';
  const report = samplingReport([first, second]);
  assert.equal(report.planned, 2); assert.equal(report.uniqueProfiles, 2);
  assert.equal(report.populationWeighted, false);
});

test('a frozen completeness plan cannot silently switch models or execution parameters', async () => {
  const run = await evidence();
  const plan = createCompletenessPlan(run, { id: 'edge-frozen-config', registeredAt: run.startedAt, requireRealModel: false });
  const switchedModel = structuredClone(run); switchedModel.models[0].modelId = 'changed-selector';
  const modelReport = evaluateCompleteness(plan, switchedModel);
  assert.equal(modelReport.status, 'not-qualified');
  assert.equal(modelReport.checks.find(check => check.id === 'execution-config')?.passed, false);
  const switchedParameters = structuredClone(run); switchedParameters.parameters!.maxOutputTokens = 6000;
  const parameterReport = evaluateCompleteness(plan, switchedParameters);
  assert.equal(parameterReport.status, 'not-qualified');
  assert.equal(parameterReport.checks.find(check => check.id === 'execution-config')?.passed, false);
});

test('a foreign or missing pricing currency cannot be interpreted as CNY', async () => {
  const run = await evidence(); run.mode = 'live';
  run.metrics.modelCalls = run.responses.length;
  for (const response of run.responses) { response.inputTokens = 1; response.outputTokens = 1; }
  run.metrics.inputTokens = run.responses.length; run.metrics.outputTokens = run.responses.length;
  run.pricing = { currency: 'CNY', inputPerMillion: 1, outputPerMillion: 2, suppliedAt: run.startedAt, source: 'synthetic accounting test, not a current vendor price' };
  run.metrics.apiCostCny = run.responses.length * 3 / 1e6;
  assert.equal(parseSurveyEvidence(run).metrics.apiCostCny, run.metrics.apiCostCny);
  const usd = structuredClone(run) as any; usd.pricing.currency = 'USD';
  assert.throws(() => parseSurveyEvidence(usd));
  const missing = structuredClone(run) as any; delete missing.pricing.currency;
  assert.throws(() => parseSurveyEvidence(missing));
});
