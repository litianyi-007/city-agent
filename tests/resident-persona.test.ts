import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDefaultPersona, PERSONA_CATALOG, residentPersonaSchema, summarizePersona } from '../shared/resident-persona';
import { getResidentTemplates, residentCreateSchema, residentInput, residentPublic, residentPatchSchema } from '../server/research/residents';
import { CityStore } from '../server/store';
import { getResearchTemplates } from '../server/research/templates';
import { getPopulationModel } from '../server/population/service';
import { buildProfiles, fingerprint, residentPrompt, SURVEY_VERSION } from '../shared/survey-engine';

test('five-layer default is fresh, explicit unknown, assumption-only and contains no assigned preferences', () => {
  const first = createDefaultPersona();
  assert.deepEqual(residentPersonaSchema.parse(first), first);
  assert.equal(first.provenance, 'assumption');
  for (const trait of PERSONA_CATALOG.bigFive) assert.equal(first.personality[trait.id], null);
  assert.equal(first.upbringing.primaryCaregiving, 'unknown');
  assert.deepEqual(first.upbringing.experiences, []);
  assert.equal(first.education.level, 'unknown');
  assert.equal(first.household.relationship, 'unknown');
  assert.deepEqual(first.household.livingRoles, []);
  assert.equal(first.work.employment, 'unknown');
  assert.equal(first.work.income.basis, 'unknown');
  assert.equal(first.work.income.lower, null);
  assert.equal(first.work.income.upper, null);
  first.personality.openness = 80;
  first.upbringing.experiences = ['urban'];
  const second = createDefaultPersona();
  assert.equal(second.personality.openness, null);
  assert.deepEqual(second.upbringing.experiences, []);
  assert.ok(!('purchasePreference' in first));
  assert.match(summarizePersona(first)[0], /情景假设/);
  assert.match(summarizePersona()[0], /旧预设保持原样/);
});

test('Big Five accepts nullable integer scenario scores and custom descriptions, not forged biological/factual fields', () => {
  const persona = createDefaultPersona();
  persona.personality.openness = 0;
  persona.personality.conscientiousness = 100;
  persona.personality.customTraits = [{ label: '协商习惯', description: '有分歧时先询问理由；不预设消费意愿。' }];
  assert.deepEqual(residentPersonaSchema.parse(persona), persona);
  for (const score of [-1, 101, 50.5, Infinity, NaN, '50']) {
    assert.equal(residentPersonaSchema.safeParse({ ...persona, personality: { ...persona.personality, openness: score } }).success, false);
  }
  for (const field of ['dna', 'DNA', 'gene', 'verified', 'measured', 'populationWeight']) {
    assert.equal(residentPersonaSchema.safeParse({ ...persona, [field]: true }).success, false);
    assert.equal(residentPersonaSchema.safeParse({ ...persona, personality: { ...persona.personality, [field]: true } }).success, false);
  }
  assert.equal(residentPersonaSchema.safeParse({ ...persona, provenance: 'fact' }).success, false);
  assert.equal(residentPersonaSchema.safeParse({ ...persona, personality: { ...persona.personality, customTraits: [{ label: '遗传', description: '设置', verified: true }] } }).success, false);
});

test('upbringing axes coexist; relationship is independent of living arrangements and nonresident caregiving', () => {
  const persona = createDefaultPersona();
  persona.upbringing.primaryCaregiving = 'two-caregivers';
  persona.upbringing.experiences = ['extended-family', 'rural', 'urban', 'relocated', 'boarding', 'single-caregiver-period', 'two-caregivers-period', 'grandparent-care-period'];
  persona.household.relationship = 'single';
  persona.household.livingRoles = ['with-parents', 'caregiver'];
  assert.equal(residentPersonaSchema.safeParse(persona).success, true);
  persona.household.relationship = 'married';
  persona.household.livingRoles = ['living-alone', 'caregiver'];
  assert.equal(residentPersonaSchema.safeParse(persona).success, true, '婚姻不自动等同同住；照护不要求同住');
  persona.household.livingRoles.push('with-children');
  assert.equal(residentPersonaSchema.safeParse(persona).success, false);
  persona.household.livingRoles = [];
  persona.upbringing.experiences = ['urban', 'urban'];
  assert.equal(residentPersonaSchema.safeParse(persona).success, false);
  assert.equal(residentPersonaSchema.safeParse({ ...persona, upbringing: { ...persona.upbringing, primaryCaregiving: ['single-caregiver', 'grandparents'], experiences: [] } }).success, false);
});

test('education and employment do not fabricate income; explicit currency/month/basis and ordered finite range required', () => {
  const persona = createDefaultPersona();
  persona.education.level = 'doctor';
  persona.work.employment = 'unemployed';
  assert.equal(residentPersonaSchema.safeParse(persona).success, true);
  assert.equal(persona.work.income.lower, null);
  persona.work.income = { currency: 'CNY', period: 'month', basis: 'household-disposable', lower: 0, upper: 12000 };
  assert.equal(residentPersonaSchema.safeParse(persona).success, true);
  for (const income of [
    { ...persona.work.income, lower: -1 }, { ...persona.work.income, upper: Infinity },
    { ...persona.work.income, lower: 12001 }, { ...persona.work.income, basis: 'unknown' },
    { ...persona.work.income, currency: 'USD' }, { ...persona.work.income, period: 'year' },
    { ...persona.work.income, verified: true },
  ]) assert.equal(residentPersonaSchema.safeParse({ ...persona, work: { ...persona.work, income } }).success, false);
  persona.work.income = { currency: 'CNY', period: 'month', basis: 'personal-gross', lower: null, upper: 3000 };
  assert.equal(residentPersonaSchema.safeParse(persona).success, true);
  assert.match(summarizePersona(persona).at(-1)!, /个人税前月收入.*下界未知–3000 CNY\/month/);
});

test('new templates have independent unknown layers; legacy inputs remain absent and public/input projections preserve deep copies', () => {
  const templates = getResidentTemplates();
  assert.equal(templates.length, 4);
  for (const template of templates) assert.deepEqual(template.persona, createDefaultPersona());
  templates[0].persona!.personality.openness = 80;
  assert.equal(templates[1].persona!.personality.openness, null);
  const { persona: _persona, ...legacy } = templates[0];
  const legacyInput = residentCreateSchema.parse(legacy);
  assert.equal(legacyInput.persona, undefined);
  const legacyPublic = residentPublic(legacyInput, 'legacy', '2026-10-07', false);
  assert.ok(!('persona' in legacyPublic));
  assert.ok(!('persona' in residentInput(legacyPublic)));
  const parsed = residentCreateSchema.parse(templates[0]);
  const projected = residentPublic(parsed, 'new', '2026-10-07', false);
  assert.deepEqual(projected.persona, parsed.persona);
  projected.persona!.personality.openness = 20;
  assert.equal(parsed.persona!.personality.openness, 80);
  const projectedInput = residentInput(projected);
  projectedInput.persona!.personality.openness = 10;
  assert.equal(projected.persona!.personality.openness, 20);
  assert.equal(residentPatchSchema.safeParse({ persona: { ...createDefaultPersona(), verified: true } }).success, false);
});

test('persona CRUD, clone and reopen preserve configuration without updating saved legacy rows', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-agent-persona-store-'));
  let store = new CityStore(directory);
  try {
    const persona = createDefaultPersona();
    persona.education.level = 'other';
    persona.education.customDetail = '情景中的非学历学习经历';
    persona.personality.customTraits = [{ label: '求证习惯', description: '购买前询问信息来源。' }];
    const source = store.createResidentAgent({ ...getResidentTemplates()[0], name: '五层配置', persona });
    const copy = store.cloneResidentAgent(source.id);
    assert.notEqual(copy.id, source.id);
    assert.deepEqual(copy.persona, source.persona);
    const updatedPersona = structuredClone(persona);
    updatedPersona.education.customDetail = '修改后的情景';
    store.updateResidentAgent(source.id, { persona: updatedPersona });
    assert.deepEqual(store.getResidentAgent(copy.id)?.persona, persona);
    const { persona: _persona, ...legacyInput } = getResidentTemplates()[0];
    const legacy = store.createResidentAgent({ ...legacyInput, name: '旧版无五层' });
    assert.ok(!('persona' in legacy));
    store.close();
    store = new CityStore(directory);
    assert.deepEqual(store.getResidentAgent(source.id)?.persona, updatedPersona);
    assert.deepEqual(store.getResidentAgent(copy.id)?.persona, persona);
    assert.ok(!('persona' in store.getResidentAgent(legacy.id)!));
    assert.throws(() => store.updateResidentAgent(source.id, { persona: { ...persona, verified: true } } as never));
    assert.deepEqual(store.getResidentAgent(source.id)?.persona, updatedPersona);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('profiles freeze full persona and include it in hashes/prompts; ablations omit all layers and sampling does not infer weights or eligibility', () => {
  const task = getResearchTemplates()[2];
  const input = residentCreateSchema.parse(getResidentTemplates()[0]);
  input.persona!.personality.openness = 65;
  input.persona!.upbringing.customExperiences = [{ label: '特定场景标记', description: 'scenario-marker-private-layer' }];
  input.persona!.work.income = { currency: 'CNY', period: 'month', basis: 'personal-gross', lower: 2000, upper: 5000 };
  const preset = residentPublic(input, 'preset', '2026-10-07', false);
  const model = getPopulationModel();
  const profiles = buildProfiles(task, model, [preset], 12, 42);
  assert.deepEqual(profiles[0].persona, preset.persona);
  const without = { ...preset }; delete without.persona;
  const legacyProfiles = buildProfiles(task, model, [without], 12, 42);
  const sampling = (profile: typeof profiles[number]) => ({ street: profile.street, ageBand: profile.ageBand, sex: profile.sex, age: profile.age, attributes: profile.attributes });
  assert.deepEqual(profiles.map(sampling), legacyProfiles.map(sampling));
  assert.notEqual(fingerprint(profiles), fingerprint(legacyProfiles));
  assert.ok(profiles.every(profile => !('weight' in profile) && !profile.attributes.some(attribute => attribute.key === 'income' || attribute.key === 'openness')));
  const full = JSON.parse(residentPrompt(task, profiles[0]));
  assert.deepEqual(full.resident.persona, preset.persona);
  for (const exposure of ['no-persona', 'demographics-only'] as const) {
    const prompt = residentPrompt(task, profiles[0], exposure);
    assert.ok(!prompt.includes('scenario-marker-private-layer'));
    assert.ok(!('persona' in JSON.parse(prompt).resident));
    assert.equal(prompt, residentPrompt(task, legacyProfiles[0], exposure));
  }
  profiles[0].persona!.personality.openness = 1;
  assert.equal(profiles[1].persona!.personality.openness, 65);
  assert.equal(preset.persona!.personality.openness, 65);
  assert.equal(SURVEY_VERSION, 'coverage-survey-2.4-logic-audit');
});
