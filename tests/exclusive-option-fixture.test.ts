import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { getBusinessDemos } from '../shared/research-demo.ts';
import { executeSurvey, type SurveyExecution } from '../shared/survey-runner.ts';
import type { ResearchTask } from '../shared/research-schema.ts';
import { buildProfiles, checkCoherence, fixtureAnswers, validateAnswers, type Answer } from '../shared/survey-engine.ts';

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
      assert.equal(checkCoherence(pet.task, profile, answers).status, 'not-configured');
      assert.equal(checkCoherence(pet.task, profile, answers).checked, 0);
    }
  }
  const generated = await executeSurvey(execution(pet.task, presets));
  assert.equal(generated.state, 'completed');
  assert.equal(generated.mode, 'fixture');
  assert.equal(generated.metrics.modelCalls, 0);
  assert.equal(generated.metrics.valid, 2);
  assert.equal(generated.metrics.structurallyValid, 2);
  assert.equal(generated.metrics.contradictions, 0);
  assert.ok(generated.responses.every(response => response.status === 'valid' && response.structureValid === true && response.coherence?.status === 'not-configured' && response.coherence.checked === 0));

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
  assert.equal(unknownOnly.metrics.valid, 1);
  assert.equal(unknownOnly.metrics.contradictions, 0);
  assert.equal(unknownOnly.responses[0].status, 'valid');
  assert.deepEqual(unknownOnly.responses[0].answers.find(answer => answer.questionId === 'past-snack-categories')!.value, ['unknown']);

  const caregiver = await executeSurvey(execution(child.task, child.presets.slice(0, 1), { seed: 42 }));
  assert.equal(caregiver.task.questionnaire.questions.length, 17);
  assert.equal(caregiver.state, 'completed');
  assert.equal(caregiver.metrics.valid, 2);
  assert.equal(caregiver.metrics.contradictions, 0);
  assert.equal(caregiver.metrics.modelCalls, 0);
  for (const response of caregiver.responses) assert.deepEqual(mixesExclusive(child.task, response.answers), []);
});
