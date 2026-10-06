import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CityStore } from '../server/store';
import { createRunner } from '../server/orchestrator';
import { createSurveyService } from '../server/research/surveys';
import { getResearchTemplates } from '../server/research/templates';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { executeSurvey } from '../shared/survey-runner';

test('frozen questionnaire feeds four roles and system Gate without legacy price formula', { timeout: 30_000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-survey-delivery-test-')); const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = await executeSurvey({ task: getResearchTemplates()[2], population: getPopulationModel(), pack: getPopulationPack(), presets: [store.getResidentAgents()[0]], count: 12, seed: 42, mode: 'fixture', signal: new AbortController().signal, pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: '', source: 'test' }, call: async () => { throw new Error('not called'); } });
  store.saveSurveyRun(source);
  for (const agent of store.getAgents()) store.updateAgent(agent.id, { apiKey: 'fixture-key', modelId: 'test-model' });
  assert.throws(() => store.createRun({ task: 'test', mode: 'demo', agentIds: store.getAgents().map(agent => agent.id), researchSurveyId: source.id }), /真实模式/);
  const run = store.createRun({ task: '小学附近的问卷结果展示（不能靠关键词切换数据）', mode: 'live', agentIds: store.getAgents().map(agent => agent.id), researchSurveyId: source.id });
  source.metrics.valid = 999; assert.equal(run.questionnaireSurvey?.metrics.valid, 12);
  let calls = 0;
  await createRunner(store, { runRole: async (_agent, system, user) => {
    calls++; const context = JSON.parse(user); assert.ok(context.questionnaire); assert.equal(context.survey, undefined); assert.equal(context.surveyInput, undefined);
    let value: unknown;
    if (system.includes('当前的角色是产品经理')) value = { title: 'test', goal: 'test', scope: 'static-web-app', tasks: ['product', 'researcher', 'developer', 'tester'].map(role => ({ role, objective: 'test', deliverable: 'test' })), acceptanceCriteria: ['a', 'b'], limitations: [] };
    else if (system.includes('当前的角色是研究员')) value = { summary: '合成实验', evidence: [{ claim: '合成答卷', provenance: 'generated', sourceIds: [] }], risks: ['非真人'] };
    else if (system.includes('当前的角色是测试工程师')) value = { checks: [ { name: 'title', steps: [{ action: 'assertVisible', selector: 'h1' }] }, { name: '切换', steps: [{ action: 'assertChanged', selector: '#group-summary', after: { action: 'click', selector: '#next-group' } }] } ] };
    else value = { html: `<!doctype html><html><head><title>问卷</title></head><body><h1>问卷</h1><p id="run-id">${run.questionnaireSurvey!.id}</p><p id="valid-count">12</p><p id="simulation-notice">合成而非真人</p><p id="group-summary">西兴4</p><button id="next-group">切换</button><script>document.querySelector('#next-group').onclick=()=>document.querySelector('#group-summary').textContent='长河4'</script></body></html>` };
    return { text: JSON.stringify(value), inputTokens: 10, outputTokens: 20, harness: 'test' };
  } }).start(run.id, run.input);
  const completed = store.getRun(run.id)!; assert.equal(completed.status, 'completed', completed.error); assert.equal(calls, 4); assert.equal(completed.survey, undefined);
  assert.equal(completed.gate?.passed, true); assert.ok(completed.artifacts.some(artifact => artifact.name === 'questionnaire-survey.json')); assert.equal(completed.artifacts.some(artifact => artifact.name === 'survey.json'), false);
  const manifest = JSON.parse(readFileSync(path.join(store.runDir(run.id), 'manifest.json'), 'utf8')); assert.equal(manifest.questionnaire.runId, run.questionnaireSurvey!.id); assert.equal(manifest.realL5Evidence, false);
});

test('survey API service checkpoints failure usage, never leaks keys and stops later calls', { timeout: 10_000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'city-survey-service-test-')); const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const preset = store.getResidentAgents()[0]; store.updateResidentAgent(preset.id, { apiKey: 'do-not-leak' }); let calls = 0;
  const service = createSurveyService(store, async () => { calls++; throw Object.assign(new Error('truncated'), { evidence: { text: '{partial', inputTokens: 123, outputTokens: 3000 } }); });
  const { id } = service.start({ task: getResearchTemplates()[2], residentAgentIds: [preset.id], mode: 'live', count: 3, seed: 42, assumptionsAccepted: true, pricing: { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: '', source: 'test' } });
  assert.throws(() => service.start({}), /./);
  for (let tick = 0; tick < 100 && store.listSurveyRuns().find(run => run.id === id)?.state === 'running'; tick++) await new Promise(resolve => setTimeout(resolve, 10));
  const run = store.listSurveyRuns().find(run => run.id === id)!; assert.equal(run.state, 'stopped'); assert.equal(calls, 1); assert.equal(run.metrics.inputTokens, 123); assert.equal(run.metrics.notStarted, 2); assert.equal(run.responses[0].raw, '{partial'); assert.equal(JSON.stringify(run).includes('do-not-leak'), false);
});
