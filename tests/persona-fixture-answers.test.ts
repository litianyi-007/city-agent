import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { checkQuestionnaireLogic } from '../shared/questionnaire-logic.ts';
import { registeredFixtureAnswers, registeredLogicRulesFor } from '../shared/registered-questionnaire-logic.ts';
import { researchTaskSchema, type ResearchTask } from '../shared/research-schema.ts';
import { BUSINESS_FIXTURE_POLICY_ID, businessFixtureResponse, createBusinessDemoRun, getBusinessDemos } from '../shared/research-demo.ts';
import { createDefaultPersona, type ResidentPersona } from '../shared/resident-persona.ts';
import { buildProfiles, fixtureAnswers, validateAnswers, type Answer, type Profile } from '../shared/survey-engine.ts';

const base = researchTaskSchema.parse(JSON.parse(readFileSync(new URL('../data/research/persona-proof-questionnaire.json', import.meta.url), 'utf8')));
const task: ResearchTask = researchTaskSchema.parse({
  ...base,
  questionnaire: {
    ...base.questionnaire,
    questions: [
      ...base.questionnaire.questions,
      { id: 'education-level', type: 'single', required: true, prompt: '给定教育层的学历设定？未知保持未知。', options: [
        { id: 'unknown', label: '未知' }, { id: 'bachelor', label: '本科' }, { id: 'doctor', label: '博士' },
      ] },
      { id: 'personality-openness', type: 'scale', required: true, prompt: '给定人格倾向中的开放性刻度。未知不记为中点。', min: 1, max: 5, minLabel: '低', maxLabel: '高' },
      { id: 'work-income', type: 'number', required: false, prompt: '工作与社会角色里的月收入情景，未知留空。', min: 0, max: 20000, unit: 'CNY/month' },
    ],
  },
});

function profile(persona?: ResidentPersona): Profile {
  return {
    id: 'resident-001', presetId: 'preset', presetName: '情景', street: 'xixing', streetName: '西兴', ageBand: '18-29', sex: 'female', age: 28,
    attributes: [], description: '', assumptions: [], behaviorNotes: '', ...(persona ? { persona } : {}),
  };
}
function value(raw: string, questionId: string): Answer['value'] {
  return JSON.parse(raw).answers.find((answer: Answer) => answer.questionId === questionId).value;
}
function doctorPersona(): ResidentPersona {
  const persona = createDefaultPersona();
  persona.education.level = 'doctor';
  return persona;
}

test('seed 99 fixture answers follow five-layer persona inputs and stay stable', () => {
  const blank = fixtureAnswers(task, profile(), 99);
  const unknown = fixtureAnswers(task, profile(createDefaultPersona()), 99);
  const doctor = doctorPersona();
  const filled = fixtureAnswers(task, profile(doctor), 99);
  const detailed = doctorPersona();
  detailed.education.customDetail = '情景说明';
  const detailedRaw = fixtureAnswers(task, profile(detailed), 99);
  assert.notDeepEqual(JSON.parse(blank).answers, JSON.parse(filled).answers);
  assert.match(String(value(filled, 'education-context')), /education=doctor/);
  assert.match(String(value(filled, 'education-context')), /不推出品类、价位或购买意愿/);
  assert.match(String(value(blank, 'education-context')), /education=unset/);
  assert.match(String(value(unknown, 'education-context')), /education=unknown/);
  assert.notEqual(value(unknown, 'education-context'), value(filled, 'education-context'));
  assert.match(String(value(detailedRaw, 'education-context')), /情景说明/);
  assert.notEqual(value(detailedRaw, 'education-context'), value(filled, 'education-context'));
  assert.equal(value(filled, 'education-level'), 'doctor');
  assert.equal(value(blank, 'education-level'), 'unknown');
  assert.equal(value(unknown, 'education-level'), 'unknown');
  assert.equal(value(blank, 'price-range'), value(filled, 'price-range'));
  assert.equal(value(unknown, 'price-range'), value(filled, 'price-range'));
  assert.equal(value(blank, 'trial-budget'), value(filled, 'trial-budget'));
  assert.equal(value(unknown, 'personality-context'), value(filled, 'personality-context'));
  assert.equal(value(blank, 'work-income'), null);
  assert.equal(value(filled, 'work-income'), null);
  assert.equal(fixtureAnswers(task, profile(doctor), 99), fixtureAnswers(task, profile(structuredClone(doctor)), 99));
  assert.equal(validateAnswers(task, 'resident-001', filled).length, task.questionnaire.questions.length);

  const low = doctorPersona();
  low.personality.openness = 0;
  const high = doctorPersona();
  high.personality.openness = 100;
  const lowRaw = fixtureAnswers(task, profile(low), 99);
  const highRaw = fixtureAnswers(task, profile(high), 99);
  assert.equal(value(lowRaw, 'personality-openness'), 1);
  assert.equal(value(highRaw, 'personality-openness'), 5);
  assert.match(String(value(highRaw, 'personality-context')), /openness=100/);
  assert.equal(value(lowRaw, 'education-context'), value(filled, 'education-context'));
  assert.equal(value(lowRaw, 'price-range'), value(highRaw, 'price-range'));

  const paid = doctorPersona();
  paid.work.income = { currency: 'CNY', period: 'month', basis: 'personal-gross', lower: 10000, upper: 20000 };
  const paidRaw = fixtureAnswers(task, profile(paid), 99);
  assert.equal(value(paidRaw, 'work-income'), 15000);
  assert.match(String(value(paidRaw, 'occupation-context')), /10000-20000/);
  assert.equal(value(paidRaw, 'trial-budget'), value(filled, 'trial-budget'));
  assert.equal(value(paidRaw, 'education-level'), 'doctor');
});

test('business-consistent-synthetic-v1 stays persona-invariant and logic-valid at seed 99', async () => {
  const population = getPopulationModel();
  const pet = getBusinessDemos().find(demo => demo.id === 'pet-snacks')!;
  const child = getBusinessDemos().find(demo => demo.id === 'child-snacks')!;
  for (const demo of [pet, child]) {
    const baseProfile = buildProfiles(demo.task, population, demo.presets.slice(0, 1), 1, 99)[0];
    const changed = structuredClone(baseProfile);
    changed.persona = doctorPersona();
    assert.equal(businessFixtureResponse(baseProfile, demo.task, 99), businessFixtureResponse(changed, demo.task, 99));
    assert.equal(registeredFixtureAnswers(demo.task, baseProfile, 99), registeredFixtureAnswers(demo.task, changed, 99));
    const answers = JSON.parse(registeredFixtureAnswers(demo.task, baseProfile, 99)).answers as Answer[];
    assert.equal(checkQuestionnaireLogic(demo.task, answers, registeredLogicRulesFor(demo.task)).status, 'checked');
  }
  const proof = await createBusinessDemoRun({
    demoId: 'pet-snacks', population, pack: getPopulationPack(), seed: 99, id: '77777777-7777-4777-8777-777777777777',
  });
  assert.equal(proof.run.parameters?.fixturePolicyId, BUSINESS_FIXTURE_POLICY_ID);
  assert.equal(proof.run.metrics.modelCalls, 0);
  assert.equal(proof.run.metrics.valid, 12);
  assert.equal(proof.logicAudit.status, 'checked');
  assert.equal(proof.logicAudit.passed, 12);
  assert.equal(proof.logicAudit.failed, 0);
});
