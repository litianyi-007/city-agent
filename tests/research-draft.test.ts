import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankResearchTask, readResearchDraft } from '../src/research-draft.js';
import { newQuestion, questionTypes } from '../src/QuestionEditor.js';
import { getResearchTemplates } from '../server/research/templates.js';
import { researchTaskSchema } from '../shared/research-schema.js';

test('blank UI draft does not inherit school qualifications, commercial assumptions or a filled answer', () => {
  const source = getResearchTemplates()[0];
  const task = createBlankResearchTask(source.population, 'unique-id');
  assert.notEqual(task.id, source.id);
  assert.deepEqual(task.population.filters, []);
  assert.deepEqual(task.declarations, []);
  assert.deepEqual(task.decisionContext, { offering: '', buyer: '', endUser: '', channel: '' });
  assert.deepEqual(task.requestedOutputs, ['questionnaire-review']);
  assert.equal(researchTaskSchema.safeParse(task).success, false);
  assert.ok(source.population.filters.length > 0);
});

test('UI advanced JSON errors preserve source input and surface contract field paths', () => {
  const task = getResearchTemplates()[2]; const original = structuredClone(task);
  assert.throws(() => readResearchDraft(task, '[invalid', '[]', []), /JSON/);
  assert.throws(() => readResearchDraft(task, '[{"field":"age","op":"between","min":60,"max":10}]', '[]', []), /population.filters.0.max/);
  assert.throws(() => readResearchDraft({ ...task, questionnaire: { ...task.questionnaire, questions: [] } }, '[]', '[]', []), /questionnaire.questions/);
  assert.deepEqual(task, original);
  const ids = ['selected-preset'];
  const parsed = readResearchDraft(task, JSON.stringify(task.population.filters), JSON.stringify(task.declarations), ids);
  ids.length = 0;
  assert.deepEqual(parsed.task, original); assert.deepEqual(parsed.residentAgentIds, ['selected-preset']);
  assert.equal('apiKey' in parsed, false);
});

test('all five question editor factories produce valid bounded questions and retain caller IDs', () => {
  for (const type of Object.keys(questionTypes) as (keyof typeof questionTypes)[]) {
    const question = newQuestion(type, 'stable-question-id', '需要回答的问题');
    assert.equal(question.id, 'stable-question-id');
    const template = getResearchTemplates()[2];
    assert.equal(researchTaskSchema.safeParse({ ...template, validationRules: [], comparisons: [], questionnaire: { ...template.questionnaire, questions: [question] } }).success, true);
    assert.equal(newQuestion('text', question.id, question.prompt).id, question.id);
  }
});
