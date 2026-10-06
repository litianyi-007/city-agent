import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash as nodeHash } from 'node:crypto';
import { createHash } from '../src/browser-crypto';
import { getResearchTemplates } from '../server/research/templates';
import { getResidentTemplates, residentCreateSchema, residentPublic } from '../server/research/residents';
import { getPopulationModel } from '../server/population/service';
import { buildProfiles, fixtureAnswers, summarize, validateAnswers, type ResponseRecord } from '../shared/survey-engine';

const task = getResearchTemplates()[2];
const preset = residentPublic(residentCreateSchema.parse(getResidentTemplates()[0]), 'preset-id', '2026-10-07', false);
test('browser fingerprint matches Node SHA-256 for actual questionnaire and unicode evidence', () => {
  for (const input of ['', '中文', JSON.stringify(task)]) assert.equal(createHash('sha256').update(input).digest('hex'), nodeHash('sha256').update(input).digest('hex'));
});
test('profile coverage is repeatable, respects AND filters and keeps age/qualification assumptions explicit', () => {
  const profiles = buildProfiles(task, getPopulationModel(), [preset], 12, 42);
  assert.deepEqual(profiles, buildProfiles(task, getPopulationModel(), [preset], 12, 42));
  assert.equal(new Set(profiles.map(profile => `${profile.street}:${profile.ageBand}:${profile.sex}`)).size, 12);
  assert.ok(profiles.every(profile => profile.age >= 18 && profile.attributes.find(attribute => attribute.key === 'age')?.provenance === 'assumption'));
  assert.ok(profiles.every(profile => !('weight' in profile)));
  const empty = { ...task, population: { ...task.population, filters: [{ field: 'age', op: 'between' as const, min: 0, max: 14 }] } };
  assert.throws(() => buildProfiles(empty, getPopulationModel(), [preset], 12, 42), /交集为空/);
});
test('all 15 answers validate, forged resident/option/duplicate and required omissions fail', () => {
  const profile = buildProfiles(task, getPopulationModel(), [preset], 1, 42)[0];
  const raw = fixtureAnswers(task, profile, 42); assert.equal(validateAnswers(task, profile.id, raw).length, 15);
  const answer = JSON.parse(raw); answer.residentId = 'other'; assert.throws(() => validateAnswers(task, profile.id, JSON.stringify(answer)));
  answer.residentId = profile.id; answer.answers[0].value = 'forged'; assert.throws(() => validateAnswers(task, profile.id, JSON.stringify(answer)));
  const missing = JSON.parse(raw); missing.answers.pop(); assert.throws(() => validateAnswers(task, profile.id, JSON.stringify(missing)), /必答题/);
  const duplicate = JSON.parse(raw); duplicate.answers.push(duplicate.answers[0]); assert.throws(() => validateAnswers(task, profile.id, JSON.stringify(duplicate)), /重复/);
});
test('statistics exclude failed answers but retain planned denominator and compute multiselect by respondent', () => {
  const profile = buildProfiles(task, getPopulationModel(), [preset], 1, 42)[0];
  const raw = fixtureAnswers(task, profile, 42); const answers = validateAnswers(task, profile.id, raw);
  const records: ResponseRecord[] = [{ residentId: profile.id, status: 'valid', raw, answers, durationMs: 1, inputTokens: 0, outputTokens: 0 }, { residentId: 'failed-id', status: 'failed', raw: '', answers: [], durationMs: 1, inputTokens: null, outputTokens: null }];
  const result = summarize(task, records); assert.ok(result.every(question => question.denominator === 1 && question.missing === 1));
  assert.equal(result.find(question => question.questionId === 'top-features')?.choices?.reduce((sum, choice) => sum + choice.count, 0), (answers.find(answer => answer.questionId === 'top-features')!.value as string[]).length);
});
