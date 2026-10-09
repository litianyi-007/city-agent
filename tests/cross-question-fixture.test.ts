import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { BUSINESS_FIXTURE_POLICY_ID, createBusinessDemoRun, getBusinessDemos } from '../shared/research-demo.ts';
import { executeSurvey, type SurveyExecution } from '../shared/survey-runner.ts';
import { buildProfiles, fixtureAnswers, type Answer } from '../shared/survey-engine.ts';
import { checkQuestionnaireLogic } from '../shared/questionnaire-logic.ts';
import { registeredFixtureAnswers, registeredLogicRulesFor } from '../shared/registered-questionnaire-logic.ts';
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

function valueOf(answers: Answer[], questionId: string) {
  return answers.find(answer => answer.questionId === questionId)?.value;
}

function assertRegisteredAnswers(task: typeof pet.task, answers: Answer[]) {
  const value = (questionId: string) => valueOf(answers, questionId);
  if (task.questionnaire.id === 'business-child-q') assert.equal(value('child-own-taste'), null);
  if (value('purchase-intent') === 'no') {
    assert.equal(value('monthly-budget'), 0);
    assert.equal(value('package-size'), 'none');
    assert.deepEqual(value('planned-channels'), ['none']);
    assert.equal(value('travel-minutes'), null);
    assert.equal(value(task.questionnaire.id === 'business-child-q' ? 'price-per20g' : 'price-per50g'), 'none');
    if (task.questionnaire.id === 'business-pet-q') {
      assert.equal(value('online-handoff'), 'none');
      assert.equal(value('price10-intent'), 'no');
      assert.equal(value('price20-intent'), 'no');
    }
  }
  if (value('purchase-intent') === 'unknown') assert.equal(value('monthly-budget'), null);
  if (value('past-frequency') === 'none') assert.deepEqual(value(task.questionnaire.id === 'business-child-q' ? 'past-categories' : 'past-snack-categories'), ['none']);
  if (value('online-handoff') === 'delivery') assert.equal(value('travel-minutes'), null);
  if (value('pet-type') === 'cat') assert.equal((value('past-snack-categories') as string[]).includes('dog-chew'), false);
  if (value('pet-type') === 'dog') assert.equal((value('past-snack-categories') as string[]).includes('cat-creamy'), false);
  if (task.questionnaire.id === 'business-child-q' && Array.isArray(value('purchase-role')) && (value('purchase-role') as string[]).length === 1 && (value('purchase-role') as string[])[0] === 'none') assert.equal(value('traceability-importance'), null);
  const logic = checkQuestionnaireLogic(task, answers, registeredLogicRulesFor(task));
  assert.equal(logic.status, 'checked');
  assert.equal(logic.issues.length, 0);
}

test('generic 工程演示 fixtures already satisfy registered cross-question rules, and injected conflicts stay invalid', async () => {
  for (const demo of [child, pet]) {
    for (const seed of [0, 1, 42, 20261007, 20261009, 922572]) {
      for (const profile of buildProfiles(demo.task, population, demo.presets.slice(0, 1), 12, seed)) {
        const answers = JSON.parse(registeredFixtureAnswers(demo.task, profile, seed)).answers as Answer[];
        assertRegisteredAnswers(demo.task, answers);
      }
    }
    const run = await executeSurvey(execution(demo.task, demo.presets.slice(0, 1), { count: 12, seed: 42 }));
    assert.equal(run.metrics.modelCalls, 0);
    assert.equal(run.parameters?.fixturePolicyId, undefined);
    assert.equal(run.metrics.planned, 12);
    assert.equal(run.metrics.valid, 12);
    assert.equal(run.metrics.contradictions, 0);
    assert.ok(run.logicAudit);
    assert.ok(run.logicAudit.registered > 0);
    assert.equal(run.logicAudit.status, 'checked');
    assert.equal(run.logicAudit.records.filter(record => record.status === 'conflict').length, 0);
    for (const response of run.responses) {
      assert.equal(response.status, 'valid');
      assert.equal(response.structureValid, true);
      assert.equal(response.logic?.status, 'checked');
      assert.equal(response.logic?.issues.length, 0);
      assertRegisteredAnswers(demo.task, response.answers);
    }
    const imported = parseSurveyEvidence(JSON.parse(JSON.stringify(run)));
    assert.equal(imported.logicAudit?.status, 'checked');
    assert.equal(imported.metrics.contradictions, 0);
    assert.equal(imported.metrics.valid, 12);
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
