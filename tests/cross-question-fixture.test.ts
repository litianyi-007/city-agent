import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { BUSINESS_FIXTURE_POLICY_ID, createBusinessDemoRun, getBusinessDemos } from '../shared/research-demo.ts';
import { executeSurvey, type SurveyExecution } from '../shared/survey-runner.ts';
import { fixtureAnswers, type Answer } from '../shared/survey-engine.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

const population = getPopulationModel();
const pack = getPopulationPack();
const pricing = { currency: 'CNY' as const, inputPerMillion: null, outputPerMillion: null, suppliedAt: '', source: 'logic-regression' };
const pet = getBusinessDemos().find(demo => demo.id === 'pet-snacks')!;
const child = getBusinessDemos().find(demo => demo.id === 'child-snacks')!;

function execution(task: typeof pet.task, presets: SurveyExecution['presets'], extra: Partial<SurveyExecution> = {}): SurveyExecution {
  return {
    task, population, pack, presets, count: 2, seed: 20261009, mode: 'fixture', pricing,
    signal: new AbortController().signal, call: async () => { throw new Error('fixture must not call a model'); }, ...extra,
  };
}

function withAnswers(profileId: string, task: typeof pet.task, profile: Parameters<typeof fixtureAnswers>[1], seed: number, edits: Record<string, Answer['value']>) {
  const raw = JSON.parse(fixtureAnswers(task, profile, seed)) as { residentId: string; answers: Answer[] };
  raw.residentId = profileId;
  for (const [questionId, value] of Object.entries(edits)) raw.answers.find(answer => answer.questionId === questionId)!.value = value;
  return JSON.stringify(raw);
}

test('caregiver and pet API fixtures are invalid when registered cross-question rules fire, and the pack keeps the audit', async () => {
  for (const demo of [child, pet]) {
    const run = await executeSurvey(execution(demo.task, demo.presets.slice(0, 1)));
    assert.equal(run.metrics.modelCalls, 0);
    assert.equal(run.parameters?.fixturePolicyId, undefined);
    assert.ok(run.logicAudit);
    assert.ok(run.logicAudit.registered > 0);
    assert.equal(run.logicAudit.status, 'conflict');
    const conflicts = run.responses.filter(response => response.logic?.status === 'conflict');
    assert.ok(conflicts.length > 0, demo.id);
    for (const response of conflicts) {
      assert.equal(response.status, 'invalid');
      assert.equal(response.structureValid, true);
      assert.ok(response.logic!.issues.length > 0);
    }
    assert.equal(run.metrics.valid, run.responses.length - conflicts.length);
    assert.ok((run.metrics.contradictions ?? 0) >= conflicts.length);
    const imported = parseSurveyEvidence(JSON.parse(JSON.stringify(run)));
    assert.equal(imported.logicAudit?.status, 'conflict');
    assert.equal(imported.metrics.contradictions, run.metrics.contradictions);
    assert.equal(imported.metrics.valid, run.metrics.valid);
  }

  const caregiver = await executeSurvey(execution(child.task, child.presets.slice(0, 1), {
    count: 1, fixturePolicyId: 'child-taste-regression',
    fixtureResponse: profile => withAnswers(profile.id, child.task, profile, 20261009, {
      'child-evidence': 'not-collected',
      'child-own-taste': '工程演示答卷：此文本验证开放题保留与回查，不表达真实消费偏好。',
    }),
  }));
  const taste = caregiver.responses[0];
  assert.equal(taste.answers.find(answer => answer.questionId === 'child-evidence')!.value, 'not-collected');
  assert.match(String(taste.answers.find(answer => answer.questionId === 'child-own-taste')!.value), /工程演示答卷/);
  assert.equal(taste.status, 'invalid');
  assert.ok(taste.logic?.issues.some(issue => issue.ruleId === 'child-no-direct-taste-not-collected'));
  assert.equal(caregiver.logicAudit?.status, 'conflict');
  assert.ok((caregiver.metrics.contradictions ?? 0) > 0);
  assert.equal(caregiver.metrics.valid, 0);

  const petConflict = await executeSurvey(execution(pet.task, pet.presets.slice(0, 1), {
    count: 1, seed: 42, fixturePolicyId: 'pet-no-purchase-regression',
    fixtureResponse: profile => withAnswers(profile.id, pet.task, profile, 42, {
      'purchase-intent': 'no', 'monthly-budget': 30.29, 'package-size': 'g100', 'planned-channels': ['pickup', 'veterinary'],
    }),
  }));
  const resident = petConflict.responses[0];
  assert.equal(resident.status, 'invalid');
  assert.equal(resident.structureValid, true);
  for (const ruleId of ['no-purchase-zero-budget', 'no-purchase-no-package', 'no-purchase-no-channel']) {
    assert.ok(resident.logic?.issues.some(issue => issue.ruleId === ruleId), ruleId);
  }
  assert.ok((petConflict.metrics.contradictions ?? 0) > 0);
  assert.equal(petConflict.metrics.valid, 0);
  assert.equal(petConflict.logicAudit?.records[0].status, 'conflict');

  const business = await createBusinessDemoRun({ demoId: 'pet-snacks', population, pack, seed: 20261007 });
  assert.equal(business.run.parameters?.fixturePolicyId, BUSINESS_FIXTURE_POLICY_ID);
  assert.equal(business.run.metrics.valid, 12);
  assert.equal(business.run.metrics.contradictions, 0);
  assert.equal(business.logicAudit.failed, 0);
  assert.equal(business.logicAudit.status, 'checked');
  assert.equal(business.run.logicAudit?.status, 'checked');
  assert.equal(parseSurveyEvidence(JSON.parse(JSON.stringify(business.run))).logicAudit?.status, 'checked');
});
