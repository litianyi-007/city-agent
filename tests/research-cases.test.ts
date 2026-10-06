import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { getCityProfile } from '../server/city.js';
import { buildCaseHtml, DEMO_CASE_ACCEPTANCE } from '../server/demo-artifact.js';
import { createRunner } from '../server/orchestrator.js';
import { analyzeResearchCase, type ResearchCaseReport } from '../server/research-cases.js';
import { CityStore } from '../server/store.js';
import { hashPopulationPack, type RegionPack } from '../server/population/model.js';
import type { RunInput } from '../server/types.js';

const tasks = [
  { kind: 'school-snacks', task: '我要在滨江区开一家小学生零食店，调研选址与品类。', gap: 'school-current' },
  { kind: 'pet-snacks', task: '已有线上宠物零食销售，要在滨江增加线下网点，推荐区域、价位和猫狗主营方向。', gap: 'pet-orders' },
] as const;

function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-research-case-'));
  const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const read = <T>(id: string, name: string): T => JSON.parse(readFileSync(path.join(store.runDir(id), name), 'utf8')) as T;
  return { store, read };
}

for (const example of tasks) {
  test(`${example.kind} completes all four mock roles and real Chromium while keeping needs-data`, { timeout: 45_000 }, async t => {
    const { store, read } = fixture(t);
    const input: RunInput = { mode: 'demo', task: example.task, agentIds: store.getAgents().map(agent => agent.id), sampleSize: 60, seed: 9 };
    const run = store.createRun(input);
    let modelCalls = 0;
    await createRunner(store, { demoDelayMs: 0, runRole: async () => { modelCalls++; throw new Error('Mock must not call any LLM'); } }).start(run.id, input);
    const finished = store.getRun(run.id)!;
    assert.equal(finished.status, 'completed', finished.error);
    assert.equal(finished.gate?.passed, true, JSON.stringify(finished.gate));
    assert.ok(finished.gate?.checks.every(check => check.passed));
    assert.ok(finished.stages.every(stage => stage.status === 'completed'));
    assert.equal(finished.survey, undefined, 'Inapplicable survey must never appear as this task result');
    assert.equal(modelCalls, 0);
    const report = read<ResearchCaseReport>(run.id, 'case-report.json');
    assert.equal(report.kind, example.kind);
    assert.equal(report.decisionStatus, 'needs-data');
    assert.equal(report.frameFit.surveyApplicable, false);
    assert.equal(report.frameFit.status, 'mismatch');
    assert.ok(report.dataGaps.some(gap => gap.id === example.gap));
    assert.ok(report.hypotheses.length >= 2);
    assert.ok(report.hypotheses.every(hypothesis => hypothesis.provenance === 'generated'));
    assert.ok(report.facts.every(fact => fact.sourceIds.length && fact.sourceIds.every(id => report.sources.some(source => source.id === id))));
    assert.equal(report.facts[0].value, getCityProfile().population);
    const research = read<{ summary: string; evidence: unknown[] }>(run.id, 'research.json');
    assert.match(research.summary, /needs-data/);
    const plan = read<{ tasks: Array<{ role: string }>; acceptanceCriteria: string[] }>(run.id, 'spec.json');
    assert.deepEqual(new Set(plan.tasks.map(task => task.role)), new Set(['product', 'researcher', 'developer', 'tester']));
    assert.ok(plan.acceptanceCriteria.some(criterion => criterion.includes('needs-data')));
    const gaps = read<{ decisionStatus: string; dataGaps: unknown[] }>(run.id, 'data-gaps.json');
    assert.equal(gaps.decisionStatus, 'needs-data');
    assert.equal(gaps.dataGaps.length, report.dataGaps.length);
    assert.equal(read<{ applicability: { applicableToTask: boolean } }>(run.id, 'survey.json').applicability.applicableToTask, false);
    const html = readFileSync(path.join(store.runDir(run.id), 'index.html'), 'utf8');
    assert.equal(html.includes('id="acceptance"'), false);
    assert.equal(html.includes('acceptanceRate'), false);
    assert.equal(html.includes('willingnessToPay'), false);
    const manifest = read<{ realL5Evidence: boolean; modelCalls: number; artifactHashes: Record<string, string>; researchCase: { decisionStatus: string; marketResearchValidated: boolean } }>(run.id, 'manifest.json');
    assert.equal(manifest.realL5Evidence, false);
    assert.equal(manifest.modelCalls, 0);
    assert.equal(manifest.researchCase.decisionStatus, 'needs-data');
    assert.equal(manifest.researchCase.marketResearchValidated, false);
    const snapshot = read<RegionPack>(run.id, 'population-pack.json');
    const population = read<{ population: { datasetHash: string; artifact: string } }>(run.id, 'manifest.json').population;
    assert.equal(population.datasetHash, hashPopulationPack(snapshot));
    assert.equal(population.artifact, 'population-pack.json');
    assert.equal(population.datasetHash, getCityProfile().datasetHash);
    for (const [name, digest] of Object.entries(manifest.artifactHashes)) {
      assert.equal(createHash('sha256').update(readFileSync(path.join(store.runDir(run.id), name))).digest('hex'), digest, name);
    }
  });
}

test('school evidence remains the supplied historical age group and task text cannot inject markup', () => {
  const malicious = '小学生零食店 </script><script>window.injected=true</script><img src=x onerror="window.injected=true">';
  const city = getCityProfile();
  const report = analyzeResearchCase(malicious, city);
  for (const street of city.streets) {
    const fact = report.facts.find(item => item.id === `${street.id}-age5-14`)!;
    assert.equal(fact.value, street.ageGroups.find(age => age.id === '5-14')!.population);
    assert.match(fact.useLimit, /不是小学生/);
  }
  assert.match(report.frameFit.reason, /15 岁及以上.*不适用/);
  const html = buildCaseHtml(report);
  assert.equal(html.includes(malicious), false);
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(Buffer.byteLength(html, 'utf8') < 500_000);
  assert.equal(analyzeResearchCase('普通商品价格模拟', city).kind, 'generic');
  assert.equal(analyzeResearchCase('小学生和宠物的混合场景', city).kind, 'generic');
});

test('live case roles receive readiness constraints, retry false completion, and cannot weaken fixed browser checks', { timeout: 45_000 }, async t => {
  const { store, read } = fixture(t);
  for (const agent of store.getAgents()) store.updateAgent(agent.id, { apiKey: `${agent.role}-local-fixture-key`, modelId: agent.role });
  const input: RunInput = { task: tasks[1].task, mode: 'live', agentIds: store.getAgents().map(agent => agent.id), sampleSize: 30 };
  const run = store.createRun(input);
  const roles: string[] = [];
  let researcherCalls = 0;
  await createRunner(store, { runRole: async (config, system, user) => {
    roles.push(config.modelId);
    assert.ok(system.includes('decisionStatus 必须保持 needs-data'));
    const context = JSON.parse(user.split('\n上次输出的结构校验错误：')[0]) as { caseReadiness: ResearchCaseReport; survey?: unknown; checks?: unknown[] };
    assert.equal(context.caseReadiness.kind, 'pet-snacks');
    assert.equal(context.caseReadiness.frameFit.surveyApplicable, false);
    assert.equal(context.survey, undefined);
    let output: unknown;
    if (config.modelId === 'product') {
      output = { title: '宠物网点条件研究', goal: input.task, scope: 'static-web-app', tasks: context.caseReadiness.roleTasks,
        acceptanceCriteria: ['保留 needs-data', '条件假设可交互切换'], limitations: context.caseReadiness.limitations };
    } else if (config.modelId === 'researcher') {
      researcherCalls++;
      output = { summary: researcherCalls === 1 ? '市场研究已经完成' : 'needs-data：没有真实养宠、线上业务与价格证据，仅形成条件方案。',
        evidence: [{ claim: '历史人口背景', provenance: 'fact', sourceIds: [getCityProfile().sources[0].id] }], risks: ['人口数据不能推断猫狗购买偏好'] };
    } else if (config.modelId === 'tester') {
      output = { checks: DEMO_CASE_ACCEPTANCE.slice(0, 2) };
    } else {
      assert.equal(config.modelId, 'developer');
      assert.deepEqual(context.checks?.slice(0, DEMO_CASE_ACCEPTANCE.length), DEMO_CASE_ACCEPTANCE);
      output = { html: buildCaseHtml(context.caseReadiness), notes: 'Local test model fixture; no external model quality claim.' };
    }
    return { text: JSON.stringify(output), inputTokens: 1, outputTokens: 1, harness: 'local-test-fixture' };
  } }).start(run.id, input);
  const finished = store.getRun(run.id)!;
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.gate?.passed, true, JSON.stringify(finished.gate));
  assert.equal(researcherCalls, 2, 'Research completion claims must be rejected and retried');
  assert.deepEqual(new Set(roles), new Set(['product', 'researcher', 'tester', 'developer']));
  assert.equal(read<ResearchCaseReport>(run.id, 'case-report.json').decisionStatus, 'needs-data');
  assert.equal(read<{ researchCase: { marketResearchValidated: boolean } }>(run.id, 'manifest.json').researchCase.marketResearchValidated, false);
  assert.ok(finished.events.some(event => event.message.includes('商业决策仍为 needs-data')));
});
