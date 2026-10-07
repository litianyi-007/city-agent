import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPopulationPack, getPopulationModel } from '../server/population/service';
import { getResearchTemplates } from '../server/research/templates';
import { getResidentTemplates, residentCreateSchema, residentPublic } from '../server/research/residents';
import { preflightResearchTask } from '../server/research/contract';
import { buildProfiles, checkCoherence, fingerprint, fixtureAnswers, residentPrompt, validateAnswers } from '../shared/survey-engine';
import { executeSurvey, type SurveyExecution } from '../shared/survey-runner';
import { buildAnalysis, samplingReport } from '../shared/survey-analysis';
import { parseSurveyEvidence } from '../src/run-history';

const task = getResearchTemplates()[2]; const pack = getPopulationPack(); const population = getPopulationModel();
const presets = getResidentTemplates().map((input, index) => residentPublic(residentCreateSchema.parse(input), `preset-${index}`, '2026-10-07', false));
const execute = (extra: Partial<SurveyExecution> = {}) => executeSurvey({ task, pack, population, presets: [presets[0]], mode: 'fixture', count: 12, seed: 42, signal: new AbortController().signal, pricing: { currency: 'CNY', inputPerMillion: 11, outputPerMillion: 22, suppliedAt: '2026-10-07', source: 'test' }, call: async () => { throw new Error('fixture must not call'); }, ...extra });
test('same task uses canonical hash across preflight/run and object insertion order', async () => {
  const run = await execute(); assert.equal(run.taskHash, preflightResearchTask(task, pack).taskHash);
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.equal(parseSurveyEvidence(run).id, run.id);
  assert.throws(() => parseSurveyEvidence({ ...run, taskHash: 'forged' }), /指纹/);
  assert.throws(() => parseSurveyEvidence({ ...run, metrics: { ...run.metrics, valid: 999 } }), /汇总/);
  for (const durationMs of [-1, Infinity, NaN]) assert.throws(() => parseSurveyEvidence({ ...run, durationMs }), /耗时/);
  assert.throws(() => parseSurveyEvidence({ ...run, responses: run.responses.map((response, index) => index ? response : { ...response, durationMs: -1 }) }), /耗时/);
});
test('four presets cover all streets, draw new ages rather than cycling twelve fixed people', () => {
  const four = buildProfiles(task, population, presets, 12, 42); assert.equal(new Set(four.map(profile => profile.street)).size, 3);
  const thirty = buildProfiles(task, population, [presets[0]], 30, 42); assert.equal(samplingReport(thirty).uniqueProfiles, 30);
  assert.throws(() => buildProfiles(task, population, presets, 1, 42), /少于/);
});
test('description reaches prompt and declared age/street contradictions do not count as coherent', async () => {
  const input = { ...presets[0], description: '软件工程师，两个孩子；用户假设' };
  const profile = buildProfiles(task, population, [input], 1, 42)[0]; assert.ok(residentPrompt(task, profile).includes('软件工程师'));
  const raw = JSON.parse(fixtureAnswers(task, profile, 42)); raw.answers.find((a: {questionId: string}) => a.questionId === 'age-range').value = 'option-1';
  const answers = validateAnswers(task, profile.id, JSON.stringify(raw)); assert.equal(checkCoherence(task, profile, answers).status, 'contradiction');
  const run = await execute({ mode: 'live', count: 1, call: async () => ({ text: JSON.stringify(raw), inputTokens: 100, outputTokens: 50 }) });
  assert.equal(run.metrics.structurallyValid, 1); assert.equal(run.metrics.valid, 0); assert.equal(run.metrics.contradictions, 1); assert.equal(run.responses[0].answers.length, 15);
  assert.equal(run.pricing?.inputPerMillion, 11); assert.equal(run.metrics.apiCostCny, .0022);
});
test('failed request stops later work with actual failure cause and known zero unstarted tokens', async () => {
  const run = await execute({ mode: 'live', count: 3, call: async () => { throw new Error('mock HTTP401'); } });
  assert.equal(run.metrics.modelCalls, 1); assert.equal(run.metrics.notStarted, 2); assert.equal(run.metrics.inputTokens, null);
  assert.match(run.responses[1].error!, /前序请求失败/); assert.equal(run.responses[1].inputTokens, 0);
});
test('pre-cancel and checkpoint failure never dispatch a paid model request', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  const cancelled = await execute({ mode: 'live', count: 3, signal: controller.signal, call: async () => { calls++; throw new Error('not called'); } });
  assert.equal(cancelled.metrics.notStarted, 3); assert.equal(calls, 0);
  await assert.rejects(execute({ mode: 'live', checkpoint: async () => { throw new Error('storage full'); }, call: async () => { calls++; throw new Error('not called'); } }), /storage/); assert.equal(calls, 0);
});
test('group and paired transitions reconcile and absent comparison configuration remains needs-config', async () => {
  const run = await execute(); const groups = run.analysis!.groups.filter(group => group.field === 'streetName');
  assert.equal(groups.reduce((sum, group) => sum + group.valid, 0), run.metrics.valid);
  for (const comparison of run.analysis!.comparisons) assert.equal(comparison.transitions.reduce((sum, pair) => sum + pair.count, 0), comparison.denominator);
  const noPlan = buildAnalysis({ ...task, comparisons: [] }, run.profiles, run.responses); assert.equal(noPlan.outputs.find(output => output.output === 'price-comparison')?.status, 'needs-config');
});
test('known credentials in questionnaire/persona are rejected before hashes, checkpoints or model calls', async () => {
  let calls = 0; let checkpoints = 0; const secret = 'snapshot-test-secret';
  const context = { knownSecrets: [secret], mode: 'live' as const, count: 1,
    checkpoint: async () => { checkpoints++; }, call: async () => { calls++; throw new Error('must not call'); } };
  await assert.rejects(execute({ ...context, task: { ...task, decisionContext: { ...task.decisionContext, offering: secret } } }), /凭据/);
  await assert.rejects(execute({ ...context, presets: [{ ...presets[0], description: '\\u0073napshot-test-secret' }] }), /凭据/);
  assert.equal(calls, 0); assert.equal(checkpoints, 0);
});
test('injected response and error evidence are redacted before answer parsing or persistence', async () => {
  const secret = 'echo-test-secret'; const profile = buildProfiles(task, population, [presets[0]], 1, 42)[0];
  const valid = JSON.parse(fixtureAnswers(task, profile, 42));
  const freeText = task.questionnaire.questions.find(question => question.type === 'text')!;
  valid.answers.find((answer: { questionId: string }) => answer.questionId === freeText.id).value = secret;
  const raw = JSON.stringify(valid).replace(secret, '\\u0065cho-test-secret');
  const success = await execute({ mode: 'live', count: 1, knownSecrets: [secret], call: async () => ({ text: raw, inputTokens: 1, outputTokens: 1 }) });
  assert.equal(success.responses[0].status, 'valid');
  assert.match(success.responses[0].raw, /REDACTED/);
  assert.equal(JSON.stringify(success).includes(secret), false);
  assert.equal(JSON.stringify(success).includes('\\u0065cho-test-secret'), false);
  parseSurveyEvidence(success);
  const failure = await execute({ mode: 'live', count: 2, knownSecrets: [secret], call: async () => { throw Object.assign(new Error('failed \\u0065cho-test-secret'), { evidence: { text: '{"partial":"\\u0065cho-test-secret', inputTokens: 10, outputTokens: null } }); } });
  assert.match(failure.responses[0].error!, /REDACTED/);
  assert.equal(JSON.stringify(failure).includes(secret), false);
  assert.equal(JSON.stringify(failure).includes('\\u0065cho-test-secret'), false);
  assert.equal(failure.metrics.notStarted, 1);
  parseSurveyEvidence(failure);
});
