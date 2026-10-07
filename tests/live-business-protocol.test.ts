import assert from 'node:assert/strict';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { checkLiveQualification, createLiveBusinessProtocol, LIVE_BUSINESS_PROTOCOL, liveResponseStop } from '../shared/live-business-protocol.ts';
import { businessFixtureResponse, getBusinessDemos, type BusinessDemoId } from '../shared/research-demo.ts';
import { buildProfiles, validateAnswers, type Answer, type Profile, type ResponseRecord } from '../shared/survey-engine.ts';
import { executeSurvey } from '../shared/survey-runner.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

const model = { provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' };
const population = getPopulationModel();
const pack = getPopulationPack();

function context(id: BusinessDemoId) {
  const protocol = createLiveBusinessProtocol(id, model);
  const profiles = buildProfiles(protocol.task, population, protocol.presets, 10, 20261007);
  return { protocol, profiles };
}

/** Offline test answers only. This does not call or represent a real model. */
function responseFor(id: BusinessDemoId, profile: Profile, overrides: Record<string, Answer['value']> = {}): ResponseRecord {
  const original = getBusinessDemos().find(demo => demo.id === id)!;
  const envelope = JSON.parse(businessFixtureResponse(profile, original.task, 20261007)) as { residentId: string; answers: Answer[] };
  if (id === 'pet-snacks') overrides = { 'purchase-role': ['purchaser', 'shared'], ...overrides };
  for (const answer of envelope.answers) if (Object.hasOwn(overrides, answer.questionId)) answer.value = overrides[answer.questionId];
  const raw = JSON.stringify(envelope);
  const task = createLiveBusinessProtocol(id, model).task;
  return { residentId: profile.id, status: 'valid', structureValid: true, raw,
    answers: validateAnswers(task, profile.id, raw), durationMs: 1, inputTokens: 100, outputTokens: 50 };
}

test('real-API protocol freezes four five-layer presets with 10 planned profiles allocated 3/3/2/2, not fixture claims', () => {
  for (const id of ['child-snacks', 'pet-snacks'] as const) {
    const { protocol, profiles } = context(id);
    assert.equal(protocol.protocolVersion, LIVE_BUSINESS_PROTOCOL);
    assert.equal(protocol.task.questionnaire.version, LIVE_BUSINESS_PROTOCOL);
    assert.equal(protocol.task.questionnaire.questions.length, id === 'child-snacks' ? 17 : 18);
    assert.match(protocol.task.title, /真实LLM合成测试轮/);
    assert.equal(protocol.task.declarations.some(declaration => declaration.id.includes('fixture')), false);
    assert.equal(JSON.stringify(protocol.task).includes('无模型工程夹具'), false);
    assert.equal(JSON.stringify(protocol.task).includes('fixture'), false);
    assert.equal(protocol.presets.length, 4);
    assert.deepEqual(protocol.presets.map(preset => profiles.filter(profile => profile.presetId === preset.id).length), [3, 3, 2, 2]);
    assert.ok(protocol.presets.every(preset => preset.persona?.provenance === 'assumption' && preset.provider === model.provider && preset.baseUrl === model.baseUrl && preset.modelId === model.modelId && !preset.hasApiKey));
    assert.ok(protocol.presets.every(preset => preset.assumptions.some(text => text.includes('3/3/2/2')) && !preset.assumptions.some(text => text.includes('各覆盖3人'))));
    assert.ok(protocol.task.declarations.some(declaration => declaration.claim.includes('非真人')));
    assert.ok(protocol.task.declarations.some(declaration => declaration.claim.includes('不能据此认证市场需求')));
    // New protocol mutation must not remove the historical fixture's disclosure.
    assert.ok(getBusinessDemos().find(demo => demo.id === id)!.task.declarations.some(declaration => declaration.id.includes('fixture')));
  }
});

test('child qualification requires explicit adult caregiver/primary assumptions and an explicit null child original', () => {
  const { profiles } = context('child-snacks');
  const profile = profiles[0];
  assert.equal(checkLiveQualification('child-snacks', profile, responseFor('child-snacks', profile)).status, 'checked');
  for (const eligibility of ['ineligible', 'unknown']) {
    const report = checkLiveQualification('child-snacks', profile, responseFor('child-snacks', profile, { eligibility }));
    assert.equal(report.status, 'conflict'); assert.match(report.issues.join('\n'), /资格回答/);
  }
  const fabricated = responseFor('child-snacks', profile, { 'child-own-taste': '假造孩子喜欢甜味' });
  assert.equal(checkLiveQualification('child-snacks', profile, fabricated).status, 'conflict');
  const missingOptional = structuredClone(responseFor('child-snacks', profile));
  missingOptional.answers = missingOptional.answers.filter(answer => answer.questionId !== 'child-own-taste');
  assert.equal(checkLiveQualification('child-snacks', profile, missingOptional).status, 'conflict');
  for (const changed of [
    { ...profile, age: 17 },
    { ...profile, attributes: profile.attributes.filter(attribute => attribute.key !== 'caregiver') },
    { ...profile, attributes: profile.attributes.map(attribute => attribute.key === 'childSchoolStage' ? { ...attribute, value: 'secondary' } : attribute) },
  ]) assert.equal(checkLiveQualification('child-snacks', changed, responseFor('child-snacks', profile)).status, 'conflict');
});

test('public live protocol must not spread credentials from a structurally compatible runtime model object', () => {
  const modelWithPrivateField = { ...model, apiKey: 'offline-canary-private-model-key' };
  const protocol = createLiveBusinessProtocol('child-snacks', modelWithPrivateField);
  assert.equal(JSON.stringify(protocol).includes('offline-canary-private-model-key'), false);
  assert.ok(protocol.presets.every(preset => !Object.hasOwn(preset, 'apiKey')));
});

test('pet species and purchasing involvement must agree with explicit owner assumptions, not demographic inference', () => {
  const { profiles } = context('pet-snacks');
  for (const profile of profiles) {
    const record = responseFor('pet-snacks', profile);
    assert.equal(checkLiveQualification('pet-snacks', profile, record).status, 'checked');
    const species = record.answers.find(answer => answer.questionId === 'pet-type')!.value;
    for (const value of ['cat', 'dog', 'both', 'unknown'].filter(value => value !== species)) {
      const report = checkLiveQualification('pet-snacks', profile, responseFor('pet-snacks', profile, { 'pet-type': value }));
      assert.equal(report.status, 'conflict'); assert.match(report.issues.join('\n'), /猫犬资格/);
    }
    for (const role of [['none'], ['unknown'], ['purchaser', 'unknown']]) assert.equal(checkLiveQualification('pet-snacks', profile, responseFor('pet-snacks', profile, { 'purchase-role': role })).status, 'conflict');
    const unknownSpecies = { ...profile, attributes: profile.attributes.filter(attribute => attribute.key !== 'ownsCat') };
    assert.equal(checkLiveQualification('pet-snacks', unknownSpecies, record).status, 'conflict');
    const unqualified = { ...profile, attributes: profile.attributes.map(attribute => attribute.key === 'petPurchaseParticipant' ? { ...attribute, value: false } : attribute) };
    assert.equal(checkLiveQualification('pet-snacks', unqualified, record).status, 'conflict');
  }
});

test('registered quality stop re-parses raw and rejects structural, cross-question, or qualification errors without rewriting', () => {
  const { protocol, profiles } = context('child-snacks'); const profile = profiles[0];
  const valid = responseFor('child-snacks', profile);
  assert.equal(liveResponseStop(protocol, valid, profile), undefined);
  for (const record of [
    { ...valid, raw: '{"partial":' },
    { ...valid, structureValid: false },
    { ...valid, status: 'invalid' as const },
    responseFor('child-snacks', profile, { eligibility: 'unknown' }),
    responseFor('child-snacks', profile, { 'child-own-taste': '未采集却编造的口味' }),
    responseFor('child-snacks', profile, { 'purchase-intent': 'no', 'monthly-budget': 100 }),
  ]) {
    const before = structuredClone(record);
    assert.match(liveResponseStop(protocol, record, profile)!, /预登记质量停止/);
    assert.deepEqual(record, before);
  }
  const inconsistent = responseFor('child-snacks', profile, { 'child-own-taste': '原文中保留假造口味' });
  inconsistent.answers.find(answer => answer.questionId === 'child-own-taste')!.value = null;
  assert.match(liveResponseStop(protocol, inconsistent, profile)!, /预登记质量停止/);
});

test('stopAfterResponse prevents 9 later live-mode offline calls and keeps their not-started evidence', async () => {
  const { protocol } = context('child-snacks'); let calls = 0; let hookCalls = 0; const checkpoints: number[] = [];
  const run = await executeSurvey({
    task: protocol.task, population, pack, presets: protocol.presets, count: 10, seed: 20261007, mode: 'live',
    pricing: { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'offline test only; no real provider' },
    signal: new AbortController().signal,
    call: async profile => { calls++; const record = responseFor('child-snacks', profile, { eligibility: 'unknown' }); return { text: record.raw, inputTokens: 100, outputTokens: 50 }; },
    stopAfterResponse: (record, profile) => { hookCalls++; return liveResponseStop(protocol, record, profile); },
    checkpoint: async run => { checkpoints.push(run.metrics.modelCalls); },
  });
  assert.equal(calls, 1); assert.equal(hookCalls, 1);
  assert.equal(run.mode, 'live'); assert.equal(run.state, 'stopped'); assert.equal(run.metrics.modelCalls, 1);
  assert.equal(run.metrics.planned, 10); assert.equal(run.metrics.notStarted, 9);
  assert.equal(run.responses.length, 10); assert.equal(run.responses[0].answers.find(answer => answer.questionId === 'eligibility')!.value, 'unknown');
  assert.ok(run.responses.slice(1).every(record => record.status === 'not-started' && record.raw === '' && record.inputTokens === 0 && record.outputTokens === 0));
  assert.ok(run.responses.slice(1).every(record => record.error?.includes('不重试')));
  assert.equal(run.parameters?.fixturePolicyId, undefined); assert.equal(run.marketResearchValidated, false);
  assert.ok(checkpoints.every(count => count <= 1));
  assert.equal(parseSurveyEvidence(run).state, 'stopped');
});

test('a passing preregistered quality hook permits 10 distinct offline provider callbacks, without fixture policy', async () => {
  const { protocol } = context('pet-snacks'); const seen = new Set<string>();
  const run = await executeSurvey({
    task: protocol.task, population, pack, presets: protocol.presets, count: 10, seed: 20261007, mode: 'live',
    pricing: { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'offline test only' },
    signal: new AbortController().signal,
    call: async profile => { seen.add(profile.id); const record = responseFor('pet-snacks', profile); return { text: record.raw, inputTokens: 100, outputTokens: 50 }; },
    stopAfterResponse: (record, profile) => liveResponseStop(protocol, record, profile),
  });
  assert.equal(run.state, 'completed'); assert.equal(run.metrics.modelCalls, 10); assert.equal(run.metrics.notStarted, 0); assert.equal(seen.size, 10);
  assert.equal(run.parameters?.fixturePolicyId, undefined);
  assert.equal(parseSurveyEvidence(run).state, 'completed');
});

test('stop hook receives isolated copies and cannot silently rewrite stored response or frozen persona', async () => {
  const { protocol } = context('child-snacks');
  const run = await executeSurvey({
    task: protocol.task, population, pack, presets: protocol.presets, count: 10, seed: 20261007, mode: 'live',
    pricing: { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'offline test only' },
    signal: new AbortController().signal,
    call: async profile => { const record = responseFor('child-snacks', profile); return { text: record.raw, inputTokens: 100, outputTokens: 50 }; },
    stopAfterResponse: (record, profile) => { record.raw = 'forged'; record.answers.length = 0; profile.age = 1; return 'registered-test-stop'; },
  });
  assert.equal(run.metrics.modelCalls, 1); assert.ok(run.profiles[0].age >= 18);
  assert.notEqual(run.responses[0].raw, 'forged'); assert.equal(run.responses[0].answers.length, 17);
  assert.equal(parseSurveyEvidence(run).state, 'stopped');
});

test('a throwing trusted stop hook prevents all later provider callbacks rather than retrying', async () => {
  const { protocol } = context('child-snacks'); let calls = 0;
  await assert.rejects(executeSurvey({
    task: protocol.task, population, pack, presets: protocol.presets, count: 10, seed: 20261007, mode: 'live',
    pricing: { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'offline test only' },
    signal: new AbortController().signal,
    call: async profile => { calls++; const record = responseFor('child-snacks', profile); return { text: record.raw, inputTokens: 100, outputTokens: 50 }; },
    stopAfterResponse: () => { throw new Error('registered-quality-hook-failed'); },
  }), /registered-quality-hook-failed/);
  assert.equal(calls, 1);
});
