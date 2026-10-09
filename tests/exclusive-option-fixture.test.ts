import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { getBusinessDemos } from '../shared/research-demo.ts';
import { executeSurvey, type SurveyExecution } from '../shared/survey-runner.ts';
import type { ResearchTask } from '../shared/research-schema.ts';
import { buildProfiles, checkCoherence, fixtureAnswers, SURVEY_VERSION, validateAnswers, type Answer } from '../shared/survey-engine.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

const population = getPopulationModel();
const pack = getPopulationPack();
const pricing = { currency: 'CNY' as const, inputPerMillion: null, outputPerMillion: null, suppliedAt: '', source: 'exclusive-regression' };
const pet = getBusinessDemos().find(demo => demo.id === 'pet-snacks')!;
const child = getBusinessDemos().find(demo => demo.id === 'child-snacks')!;

function declaredExclusive(question: ResearchTask['questionnaire']['questions'][number]): string[] {
  if (question.type !== 'multiple' || !/排他|不能与其他/.test(question.prompt)) return [];
  return question.options.filter(option => option.id === 'none' || option.id === 'unknown').map(option => option.id);
}

function mixesExclusive(task: ResearchTask, answers: Answer[]): string[] {
  return task.questionnaire.questions.flatMap(question => {
    const exclusive = declaredExclusive(question);
    const value = answers.find(answer => answer.questionId === question.id)?.value;
    return exclusive.length && Array.isArray(value) && value.length > 1 && exclusive.some(id => value.includes(id)) ? [`${question.id}=${JSON.stringify(value)}`] : [];
  });
}

function execution(task: ResearchTask, presets: SurveyExecution['presets'], extra: Partial<SurveyExecution> = {}): SurveyExecution {
  return {
    task, population, pack, presets, count: 2, seed: 922572, mode: 'fixture', pricing,
    signal: new AbortController().signal, call: async () => { throw new Error('fixture must not call a model'); }, ...extra,
  };
}

test('pet snack rule fixture does not treat none/unknown mixes as contradiction-free valid answers', async () => {
  assert.equal(pet.task.questionnaire.questions.length, 18);
  assert.equal(child.task.questionnaire.questions.length, 17);
  const presets = pet.presets.slice(0, 1);
  const profiles = buildProfiles(pet.task, population, presets, 2, 922572);
  assert.deepEqual(profiles.map(profile => profile.id), ['resident-001', 'resident-002']);
  for (const seed of [42, 922572, 20261007]) {
    for (const profile of buildProfiles(pet.task, population, presets, 2, seed)) {
      const answers = validateAnswers(pet.task, profile.id, fixtureAnswers(pet.task, profile, seed));
      assert.deepEqual(mixesExclusive(pet.task, answers), [], `${seed} ${profile.id}`);
      const legacy = checkCoherence(pet.task, profile, answers);
      assert.equal(legacy.status, 'not-configured');
      assert.equal(legacy.checked, 0);
      const passed = checkCoherence(pet.task, profile, answers, { recordExclusivePasses: true });
      assert.equal(passed.status, 'checked');
      assert.ok(passed.checked > 0);
      assert.equal(passed.issues.length, 0);
    }
  }
  const generated = await executeSurvey(execution(pet.task, presets));
  assert.equal(generated.state, 'completed');
  assert.equal(generated.mode, 'fixture');
  assert.equal(generated.metrics.modelCalls, 0);
  assert.equal(generated.metrics.structurallyValid, 2);
  assert.equal(generated.version, SURVEY_VERSION);
  assert.ok(generated.responses.every(response => response.status === 'valid' && response.structureValid === true && response.coherence?.status === 'checked' && response.coherence.checked > 0 && response.coherence.issues.length === 0));
  assert.ok(generated.responses.every(response => response.logic?.status === 'checked' && response.logic.issues.length === 0));
  assert.equal(generated.metrics.valid, 2);
  assert.equal(generated.metrics.contradictions, 0);
  assert.equal(generated.logicAudit?.status, 'checked');

  const quoted = await executeSurvey(execution(pet.task, presets, {
    fixturePolicyId: 'exclusive-option-regression',
    fixtureResponse: profile => {
      const raw = JSON.parse(fixtureAnswers(pet.task, profile, 922572)) as { residentId: string; answers: Answer[] };
      const set = (questionId: string, value: Answer['value']) => { raw.answers.find(answer => answer.questionId === questionId)!.value = value; };
      if (profile.id === 'resident-001') {
        set('past-snack-categories', ['freeze-dried', 'none', 'cat-creamy']);
        set('planned-channels', ['online', 'none']);
      } else set('past-snack-categories', ['unknown', 'none']);
      return JSON.stringify(raw);
    },
  }));
  assert.equal(quoted.metrics.modelCalls, 0);
  assert.equal(quoted.metrics.valid, 0);
  assert.equal(quoted.metrics.contradictions, 2);
  assert.ok(quoted.metrics.contradictions > 0);
  for (const response of quoted.responses) {
    assert.equal(response.status, 'invalid');
    assert.equal(response.structureValid, true);
    assert.equal(response.coherence?.status, 'contradiction');
    assert.ok((response.coherence?.checked ?? 0) > 0);
    assert.ok(response.coherence?.issues.some(issue => issue.severity === 'error'));
  }
  const residentOne = quoted.responses.find(response => response.residentId === 'resident-001')!;
  assert.deepEqual(residentOne.answers.find(answer => answer.questionId === 'past-snack-categories')!.value, ['freeze-dried', 'none', 'cat-creamy']);
  assert.deepEqual(residentOne.answers.find(answer => answer.questionId === 'planned-channels')!.value, ['online', 'none']);
  assert.deepEqual(quoted.responses.find(response => response.residentId === 'resident-002')!.answers.find(answer => answer.questionId === 'past-snack-categories')!.value, ['unknown', 'none']);

  const unknownOnly = await executeSurvey(execution(pet.task, presets, {
    count: 1, seed: 42, fixturePolicyId: 'unknown-only-regression',
    fixtureResponse: profile => {
      const raw = JSON.parse(fixtureAnswers(pet.task, profile, 42)) as { answers: Answer[] };
      raw.answers.find(answer => answer.questionId === 'past-snack-categories')!.value = ['unknown'];
      return JSON.stringify(raw);
    },
  }));
  assert.equal(unknownOnly.responses[0].coherence?.status, 'checked');
  assert.ok((unknownOnly.responses[0].coherence?.checked ?? 0) > 0);
  assert.equal(unknownOnly.responses[0].coherence?.issues.some(issue => issue.questionId === 'past-snack-categories'), false);
  assert.deepEqual(unknownOnly.responses[0].answers.find(answer => answer.questionId === 'past-snack-categories')!.value, ['unknown']);

  const caregiver = await executeSurvey(execution(child.task, child.presets.slice(0, 1), { seed: 42 }));
  assert.equal(caregiver.task.questionnaire.questions.length, 17);
  assert.equal(caregiver.state, 'completed');
  assert.equal(caregiver.metrics.modelCalls, 0);
  for (const response of caregiver.responses) {
    assert.deepEqual(mixesExclusive(child.task, response.answers), []);
    assert.equal(response.status, 'valid');
    assert.equal(response.logic?.status, 'checked');
    assert.equal(response.logic?.issues.length, 0);
    assert.equal(response.coherence?.status, 'checked');
    assert.ok((response.coherence?.checked ?? 0) > 0);
  }
  assert.equal(caregiver.metrics.valid, 2);
  assert.equal(caregiver.metrics.contradictions, 0);
  assert.equal(caregiver.logicAudit?.status, 'checked');
});

test('clean pet snack fixture records the exclusive check as run and passed', async () => {
  const presets = pet.presets.slice(0, 1);
  const profiles = buildProfiles(pet.task, population, presets, 2, 20261009);
  assert.deepEqual(profiles.map(profile => profile.id), ['resident-001', 'resident-002']);
  for (const profile of profiles) {
    const answers = validateAnswers(pet.task, profile.id, fixtureAnswers(pet.task, profile, 20261009));
    assert.deepEqual(mixesExclusive(pet.task, answers), []);
    const storedLikeHistorical = checkCoherence(pet.task, profile, answers);
    assert.equal(storedLikeHistorical.status, 'not-configured');
    assert.equal(storedLikeHistorical.checked, 0);
    const passed = checkCoherence(pet.task, profile, answers, { recordExclusivePasses: true });
    assert.notEqual(passed.status, 'not-configured');
    assert.equal(passed.status, 'checked');
    assert.ok(passed.checked > 0);
    assert.equal(passed.scope, storedLikeHistorical.scope);
  }
  const run = await executeSurvey(execution(pet.task, presets, { seed: 20261009 }));
  assert.equal(run.metrics.modelCalls, 0);
  assert.ok(run.responses.every(response => response.coherence?.status === 'checked' && (response.coherence?.checked ?? 0) > 0));
  assert.equal(run.metrics.valid, 2);
  assert.equal(run.metrics.contradictions, 0);
  assert.equal(run.logicAudit?.status, 'checked');
  assert.equal(run.metrics.contradictions, run.responses.filter(response => response.coherence?.status === 'contradiction' || response.logic?.status === 'conflict').length);
  const imported = parseSurveyEvidence(JSON.parse(JSON.stringify(run)));
  assert.equal(imported.responses[0].coherence?.status, 'checked');
  assert.ok((imported.responses[0].coherence?.checked ?? 0) > 0);
});
