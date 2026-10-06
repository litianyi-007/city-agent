import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionPackSchema } from '../server/population/model.js';
import { preflightResearchTask, researchTaskSchema, type ResearchTask } from '../server/research/contract.js';
import { getResearchTemplates } from '../server/research/templates.js';

const pack = regionPackSchema.parse(JSON.parse(readFileSync(new URL('../data/population/regions/binjiang-2020.json', import.meta.url), 'utf8')));
const task = () => getResearchTemplates().find(item => item.id === 'ai-membership')!;

test('questionnaire schema rejects duplicate IDs, unbounded or incoherent questions and unknown fields', () => {
  const base = task();
  const invalid: unknown[] = [
    { ...base, surprise: true },
    { ...base, decisionContext: undefined },
    { ...base, decisionContext: { ...base.decisionContext, buyer: ' ' } },
    { ...base, decisionContext: { ...base.decisionContext, channel: 'x'.repeat(1001) } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [base.questionnaire.questions[0], base.questionnaire.questions[0]] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'single', prompt: '选择', required: true, options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'multiple', prompt: '选择', required: true, options: [{ id: 'a', label: 'A' }], minSelections: 2, maxSelections: 1 }] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'multiple', prompt: '选择', required: true, options: [{ id: 'a', label: 'A' }], minSelections: 1, maxSelections: 2 }] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'scale', prompt: '评分', required: true, min: 5, max: 1, minLabel: '低', maxLabel: '高' }] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'number', prompt: '数量', required: true, min: 0, max: Infinity, unit: '次' }] } },
    { ...base, questionnaire: { ...base.questionnaire, questions: [{ id: 'x', type: 'text', prompt: '说明', required: true, maxLength: 2001 }] } },
    { ...base, requestedOutputs: ['synthetic-analysis', 'synthetic-analysis'] },
    { ...base, declarations: [...base.declarations, base.declarations[0]] },
  ];
  for (const candidate of invalid) assert.equal(researchTaskSchema.safeParse(candidate).success, false);
});

test('five bounded question types and all six objectives share one contract', () => {
  for (const objective of ['demand-validation', 'feature-priority', 'price-benefits', 'concept-copy', 'purchase-concerns', 'questionnaire-quality'] as const) {
    const candidate = task(); candidate.objective = objective;
    candidate.questionnaire.questions.push({ id: 'number', type: 'number', prompt: '每周次数', required: true, min: 0, max: 100, unit: '次/周' });
    assert.equal(researchTaskSchema.safeParse(candidate).success, true);
  }
});

test('known historical frame is ready only for preflight and never contains population counts or weights', () => {
  const result = preflightResearchTask(task(), pack);
  assert.equal(result.status, 'ready');
  assert.equal(result.modelCalls, 0);
  assert.equal(result.executorAvailable, false);
  assert.equal(result.marketResearchValidated, false);
  assert.equal(result.semanticValidation, 'not-performed');
  assert.match(result.taskHash, /^[a-f0-9]{64}$/);
  assert.match(result.populationHash, /^[a-f0-9]{64}$/);
  assert.ok(result.warnings.some(warning => warning.includes('infer')));
  assert.equal('population' in result, false);
  assert.equal('weights' in result, false);
  assert.deepEqual(preflightResearchTask(task(), pack), result);
});

test('adult cutoff cannot split 15–59, while complete 60+ remains identifiable', () => {
  const candidate = task();
  candidate.population.filters = [{ field: 'age', op: 'gte', value: 18 }];
  assert.match(preflightResearchTask(candidate, pack).missingEvidence.join('\n'), /年龄精度不足.*15-59/);
  candidate.population.filters.push({ field: 'ageBand', op: 'eq', value: '60+' });
  assert.equal(preflightResearchTask(candidate, pack).status, 'ready');
  candidate.population.filters = [{ field: 'age', op: 'between', min: 6, max: 12 }];
  assert.equal(preflightResearchTask(candidate, pack).status, 'needs-data');
  candidate.population.filters = [{ field: 'age', op: 'gte', value: 60 }, { field: 'age', op: 'lte', value: 59 }];
  assert.match(preflightResearchTask(candidate, pack).missingEvidence.join('\n'), /交集为空/);
});

test('caregiver, pet, occupation, income, household and tenant qualifications are not inferred from margins', () => {
  for (const field of ['caregiver', 'petOwner', 'occupation', 'income', 'familyStage', 'tenant', 'constructor', 'toString']) {
    const candidate = task(); candidate.population.filters = [{ field, op: 'eq', value: true }];
    const result = preflightResearchTask(candidate, pack);
    assert.equal(result.status, 'needs-data');
    assert.ok(result.missingEvidence.some(item => item.includes(field)));
  }
  for (const template of getResearchTemplates().filter(item => item.id !== 'ai-membership')) assert.equal(preflightResearchTask(template, pack).status, 'needs-data');
  const candidate = task(); candidate.population.unit = 'household';
  assert.match(preflightResearchTask(candidate, pack).missingEvidence.join('\n'), /不能将人数换算为户数/);
});

test('region, period, unknown categories and contradictory intersections cannot pass preflight', () => {
  const candidates: ResearchTask[] = [];
  const region = task(); region.population.regionCode = 'another-city'; candidates.push(region);
  const period = task(); period.population.period = '2026-09-23'; candidates.push(period);
  for (const field of ['street', 'sex', 'ageBand']) { const item = task(); item.population.filters = [{ field, op: 'eq', value: 'unknown' }]; candidates.push(item); }
  const contradiction = task(); contradiction.population.filters = [{ field: 'street', op: 'eq', value: 'xixing' }, { field: 'street', op: 'eq', value: 'puyan' }]; candidates.push(contradiction);
  for (const candidate of candidates) assert.equal(preflightResearchTask(candidate, pack).status, 'needs-data');
  const valid = task(); valid.population.filters = [{ field: 'street', op: 'in', values: ['xixing', 'puyan'] }, { field: 'sex', op: 'eq', value: 'female' }];
  assert.equal(preflightResearchTask(valid, pack).status, 'ready');
});

test('registered reference IDs do not verify a client fact claim, and false references remain missing', () => {
  const candidate = task();
  const observation = pack.observations[0];
  candidate.declarations = [{ id: 'unverified', claim: '这里的宠物零食需求很高', provenance: 'fact', sourceIds: [observation.sourceId], observationIds: [observation.id] }];
  assert.match(preflightResearchTask(candidate, pack).missingEvidence.join('\n'), /客户端自报/);
  candidate.declarations[0].sourceIds = ['invented-source'];
  candidate.declarations[0].observationIds.push('invented-observation');
  const report = preflightResearchTask(candidate, pack);
  assert.match(report.missingEvidence.join('\n'), /未登记来源/);
  assert.match(report.missingEvidence.join('\n'), /未登记观测/);
  assert.match(report.missingEvidence.join('\n'), /来源不对应/);
  candidate.declarations[0] = { id: 'assumption', claim: '假设愿意购买', provenance: 'assumption', sourceIds: [], observationIds: [] };
  assert.equal(preflightResearchTask(candidate, pack).status, 'ready');
  assert.ok(preflightResearchTask(candidate, pack).warnings.some(item => item.includes('不会补齐')));
});

test('unseen tool-rental scenario uses data configuration without any case branch', () => {
  const unseen = task();
  unseen.id = 'unseen-tool-rental'; unseen.title = '社区共享工具租赁'; unseen.objective = 'demand-validation';
  unseen.decisionContext = { offering: '短时共享工具租赁概念', buyer: '潜在租借者，尚未验证', endUser: '工具使用者，暂设与租借者相同', channel: '假设社区自提服务' };
  unseen.questionnaire.questions = [{ id: 'need', type: 'text', prompt: '需要借用哪些工具以及为什么？', required: true, maxLength: 1000 }];
  unseen.validationRules = []; unseen.comparisons = [];
  unseen.declarations = [];
  const report = preflightResearchTask(unseen, pack);
  assert.equal(report.status, 'ready');
  assert.equal('kind' in report, false);
  const originalHash = report.taskHash;
  unseen.questionnaire.questions[0].prompt = '什么情况下不愿借用工具？';
  assert.notEqual(preflightResearchTask(unseen, pack).taskHash, originalHash);
});

test('unsupported location, forecast and software outputs do not masquerade as completed research', () => {
  const candidate = task();
  candidate.requestedOutputs = ['questionnaire-review', 'site-recommendation', 'market-forecast', 'deploy', 'backend-service'];
  const report = preflightResearchTask(candidate, pack);
  assert.equal(report.status, 'unsupported');
  assert.deepEqual(report.allowedOutputs, ['questionnaire-review']);
  assert.equal(report.executorAvailable, false);
});

test('templates preserve 15 membership questions, three plans, top-three features and numeric payment', () => {
  const templates = getResearchTemplates();
  assert.equal(templates.length, 3);
  const membership = templates.find(item => item.id === 'ai-membership')!;
  assert.equal(membership.questionnaire.questions.length, 15);
  const plans = membership.questionnaire.questions.find(question => question.id === 'version-choice');
  assert.ok(plans?.type === 'single');
  assert.ok(plans.options.some(item => item.label.includes('基础AI + 5GB')));
  assert.ok(plans.options.some(item => item.label.includes('19元/月') && item.label.includes('100GB')));
  assert.ok(plans.options.some(item => item.label.includes('39元/月') && item.label.includes('5人') && item.label.includes('500GB')));
  const top = membership.questionnaire.questions.find(question => question.id === 'top-features');
  assert.ok(top?.type === 'multiple');
  assert.equal(top.maxSelections, 3);
  assert.equal(membership.questionnaire.questions.find(question => question.id === 'max-monthly-payment')?.type, 'number');
  assert.deepEqual(new Set(membership.questionnaire.questions.map(question => question.type)), new Set(['single', 'multiple', 'scale', 'number', 'text']));
  assert.equal(membership.questionnaire.questions.some(question => question.id === 'price-9'), false);
  templates[0].title = 'mutated';
  assert.notEqual(getResearchTemplates()[0].title, 'mutated');
});

test('AND age filters respect full bands, discrete ages, incompatible values and bounded operations', () => {
  const candidate = task();
  candidate.population.filters = [{ field: 'age', op: 'between', min: 15, max: 59 }];
  assert.equal(preflightResearchTask(candidate, pack).status, 'ready');
  candidate.population.filters = [{ field: 'age', op: 'in', values: [18, 19] }];
  assert.equal(preflightResearchTask(candidate, pack).status, 'needs-data');
  candidate.population.filters.push({ field: 'age', op: 'gte', value: 20 });
  assert.match(preflightResearchTask(candidate, pack).missingEvidence.join('\n'), /交集为空/);
  for (const filter of [{ field: 'age', op: 'eq', value: '18' }, { field: 'sex', op: 'eq', value: true }, { field: 'street', op: 'gte', value: 1 }] as const) {
    candidate.population.filters = [filter];
    assert.equal(preflightResearchTask(candidate, pack).status, 'needs-data');
  }
  for (const filter of [
    { field: '__proto__', op: 'eq', value: true },
    { field: 'age', op: 'between', min: 50, max: 10 },
    { field: 'age', op: 'in', values: [] },
    { field: 'age', op: 'in', values: Array.from({ length: 33 }, (_, index) => index) },
    { field: 'ageBand', op: 'in', values: ['60+', '60+'] },
    { field: 'age', op: 'or', values: [18, 19] },
  ]) assert.equal(researchTaskSchema.safeParse({ ...candidate, population: { ...candidate.population, filters: [filter] } }).success, false);
});

test('preflight audits the supplied snapshot and does not mutate tasks or population evidence', () => {
  const candidate = task();
  const before = structuredClone(candidate);
  const originalPack = structuredClone(pack);
  preflightResearchTask(candidate, pack);
  assert.deepEqual(candidate, before);
  assert.deepEqual(pack, originalPack);
  const broken = structuredClone(pack);
  broken.observations.find(row => row.areaCode === pack.region.code && row.dimension === 'total')!.value++;
  assert.equal(preflightResearchTask(candidate, broken).status, 'needs-data');
  assert.match(preflightResearchTask(candidate, broken).missingEvidence.join('\n'), /人口包审计未通过/);
});

test('a recorded zero marginal prevents an empty target frame from being marked ready', () => {
  const rows = [
    { id: 'region-total', areaCode: 'test', dimension: 'total', value: 10 },
    { id: 'area-total', areaCode: 'a', dimension: 'total', value: 10 },
    { id: 'area-young', areaCode: 'a', dimension: 'age', ageBand: '0-17', value: 0 },
    { id: 'area-adult', areaCode: 'a', dimension: 'age', ageBand: '18+', value: 10 },
    { id: 'area-female', areaCode: 'a', dimension: 'sex', sex: 'female', value: 0 },
    { id: 'area-male', areaCode: 'a', dimension: 'sex', sex: 'male', value: 10 },
  ];
  const zeroPack = regionPackSchema.parse({
    schemaVersion: '1.0', id: 'zero-test', version: '1', region: { code: 'test', name: '合成单测区域', level: 'custom', boundaryVersion: 'test' },
    period: '2020-11-01', populationBasis: '常住人口', areas: [{ code: 'a', name: 'A' }],
    ageBands: [{ id: '0-17', label: '0–17', minAge: 0, maxAge: 17 }, { id: '18+', label: '18+', minAge: 18, maxAge: null }],
    sexCategories: [{ id: 'female', label: '女' }, { id: 'male', label: '男' }],
    sources: [{ id: 'test-source', title: '合成测试来源，非真实人口', publisher: 'test', url: 'https://example.com/test', landingUrl: 'https://example.com/test', publishedAt: null, retrievedAt: '2026-09-23', sha256: '0'.repeat(64), bytes: 0, localPath: 'unused-test.txt' }],
    observations: rows.map(row => ({ ...row, sourceId: 'test-source', locator: { table: 'test', row: row.id, column: 'count' }, period: '2020-11-01', populationBasis: '常住人口', boundaryVersion: 'test', provenance: 'fact' })),
    limitations: ['合成测试夹具'], method: { jointStrategy: 'independence', eligibleAgeBandIds: ['18+'], note: 'test' },
  });
  const candidate = task(); candidate.population = { regionCode: 'test', period: zeroPack.period, unit: 'person', filters: [{ field: 'sex', op: 'eq', value: 'female' }] };
  const report = preflightResearchTask(candidate, zeroPack);
  assert.equal(report.status, 'needs-data');
  assert.match(report.missingEvidence.join('\n'), /空目标框/);
  assert.equal(report.missingEvidence.some(item => item.includes('人口包审计未通过')), false);
});
