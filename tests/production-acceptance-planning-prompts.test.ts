import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ACCEPTANCE_CONTRACT_VERSION, ACCEPTANCE_PLANNING_VERSION, CAMERA_ACCEPTANCE_VERSION, CAMERA_PROMPT_VERSION, CONTRACT_INSTRUCTIONS, CRITERIA_VERSION, HTML_ACCEPTANCE_REVIEW_INSTRUCTIONS, PROMPT_VERSION, TESTER_VALID_JSON_EXAMPLE, codeSchema, contractProfile, outputContractSnapshot, parseVerifiedDecision, planSchema, productSchema, researchSchema, testsSchema, verifierSchema } from '../server/production/contracts.js';
import { phaseVerifierSystemPrompt, productionPhaseRubric } from '../shared/production-verifier-rubric.js';
import type { AcceptanceCheck } from '../server/gate.js';
import { demoChecks } from '../server/production/fixtures.js';

// Pure source-policy/schema regressions. These are synthetic engineering
// fixtures, not a repaired model output, executed Gate or model-quality result.
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const planningRoles = ['researcher', 'project-manager', 'tester'] as const;

test('only the HTML generation/policy versions advance; acceptance schema and ordinal review versions remain unchanged', () => {
  assert.equal(PROMPT_VERSION, 'production-html-v11');
  assert.equal(ACCEPTANCE_PLANNING_VERSION, 'production-acceptance-planning-v1');
  assert.equal(ACCEPTANCE_CONTRACT_VERSION, 'production-acceptance-v3');
  assert.equal(CRITERIA_VERSION, 'verifier-phase-ordinal-v5');
  assert.equal(contractProfile('offline-single-html').promptVersion, PROMPT_VERSION);
  assert.equal(contractProfile('offline-single-html').instructions, CONTRACT_INSTRUCTIONS);
  assert.equal(CAMERA_PROMPT_VERSION, 'production-camera-scene-v7');
  assert.equal(CAMERA_ACCEPTANCE_VERSION, 'production-camera-acceptance-v2');
});

test('all five camera role prompts remain byte-identical and contain no new HTML policy', () => {
  const profile = contractProfile('camera-scene-v1');
  const originalHashes = {
    product: 'f7aee927db01451e745eba24955728cba2488d0e57a55d3e0de1796e771d5387',
    researcher: 'e839fa92a5dc9fb3fe5a0568a96612142a392c193263afb8ee85b9484d78ef70',
    'project-manager': '49ebe0f4654d2af7fe6c1e491461ee7d8e72222cb6e443eaa54776fc8a9db082',
    tester: '2b9b767e36e70bd2a753dbb507f6af6436acef24a0afb8702e52a57b808463b0',
    developer: '92d4338e4b419a6f8993fdb2070f0ae1c41e7a320ef41d9151121b1918f0930d',
  };
  for (const role of Object.keys(originalHashes) as Array<keyof typeof originalHashes>) {
    assert.equal(sha(profile.instructions[role]), originalHashes[role], role);
    assert.equal(profile.instructions[role].includes(ACCEPTANCE_PLANNING_VERSION), false, role);
    assert.equal(profile.instructions[role].includes('acceptanceCapacity'), false, role);
    assert.equal(profile.instructions[role].includes('acceptanceDiagnostic'), false, role);
  }
  assert.equal(sha(CONTRACT_INSTRUCTIONS.product), '5ee931fedd19aa62e02cf1e2ac890242a6ee31a7e86861e0633f82d4d2830f87');
  assert.equal(sha(CONTRACT_INSTRUCTIONS.developer), 'e8e0cbc0889f783d210bca7d60638cfbebbdbee439b4a2cc90214bc4469b4b51');
});

test('HTML planning roles use host capacity facts and preserve original acceptance over a compressed product summary', () => {
  for (const role of planningRoles) {
    const prompt = CONTRACT_INSTRUCTIONS[role];
    assert.match(prompt, /context\.acceptanceCapacity.*同源机器事实/);
    assert.match(prompt, /maxChecks\/maxSteps仍为12项\/每项20步/);
    assert.match(prompt, /以input\.brief和input\.requirement\.acceptance逐条为准/);
    assert.match(prompt, /context\.product\.acceptance只是补充拆解，不能因产品压缩而遗漏原条款/);
    assert.match(prompt, /需求明确指定的全部正负例、状态及边界组合，不擅自扩大范围/);
    assert.match(prompt, /每组独立新页.*独立setup、业务操作和全部必需断言/);
    assert.match(prompt, /步数按该check的steps数组条目计数/);
    assert.match(prompt, /不用跨组状态，不为容量删减必需条款或断言/);
    assert.match(prompt, /容量声明与静态规划不代表覆盖完整或已经执行通过/);
    assert.doesNotMatch(prompt, /HTML-03|费用记录|打印纸|9999\.99|10000\.00|deepseek-flash/);
  }
});

test('negative-case planning isolates the target variable and restores valid other fields after successful input clearing', () => {
  for (const role of planningRoles) {
    const prompt = CONTRACT_INSTRUCTIONS[role];
    assert.match(prompt, /负例每次只改变目标变量，其它字段与前置状态必须有效/);
    assert.match(prompt, /成功操作清空输入后，下一负例先重新fill其它必需字段的合法值/);
    assert.match(prompt, /避免其它无效字段掩盖被测规则/);
    assert.match(prompt, /按原要求断言相关业务内容、数量、状态与统计的不变或指定变化/);
    assert.match(prompt, /不能只看到提示就认为规则被验证/);
  }
});

test('research and PM give bounded planning inside their existing fields without pretending a future freeze has happened', () => {
  assert.match(CONTRACT_INSTRUCTIONS.researcher, /在现有observations\/constraints中简述验收分组、逐组setup\/操作\/断言步数及合计的可达性依据/);
  assert.match(CONTRACT_INSTRUCTIONS.researcher, /研究只给可执行规划，不生成checks、代码、已冻结或已执行声明，不新增输出字段/);
  const pm = CONTRACT_INSTRUCTIONS['project-manager'];
  assert.match(pm, /研发前不能仅复述上限/);
  assert.match(pm, /在现有summary\/tasks中说明组数和逐组步数依据/);
  assert.match(pm, /tester负责定义并经宿主校验冻结checks、核对容量和完整覆盖/);
  assert.match(pm, /任务书不是已完成冻结/);
  assert.match(pm, /规划缺口用revise.*必需blocking条件用stop，不改需求或门限/);
  assert.match(pm, /若context\.gate存在，仅按已有frozenContract、实际Gate和剩余预算/);
  assert.match(pm, /不能重新分组、改写冻结checks或要求重新冻结/);
});

test('Tester uses diagnostic counts as evidence of refusal, not an automatic repair or extra output fields', () => {
  const prompt = CONTRACT_INSTRUCTIONS.tester;
  assert.match(prompt, /顶层仅checks，每项仅name\/steps/);
  assert.match(prompt, /先自主分组并逐项核对完整步骤数量，再只返回完整checks/);
  assert.match(prompt, /不新增容量或覆盖字段，不输出规划过程/);
  assert.match(prompt, /context\.regeneration\.rejectedCandidates\[\]\.acceptanceDiagnostic/);
  assert.match(prompt, /checkCount\/stepCounts\/oversizedStepCheckIndices与sourceSha256仅定位前一原文的容量拒绝/);
  assert.match(prompt, /不是修好或接受的答案/);
  assert.match(prompt, /自行重新组织完整新候选，独立setup与全部必需断言仍须保留/);
  assert.match(prompt, /宿主不会删步、拆改旧checks、修JSON、增加返修或放宽上限/);
});

test('the HTML acceptance-review suffix audits original clauses, independent setup, confounds and counts without replacing the four-field Verifier or Gate', () => {
  const rules = HTML_ACCEPTANCE_REVIEW_INSTRUCTIONS;
  assert.match(rules, /逐条对照criteria\.goal与criteria\.acceptance中的原始brief和验收要求/);
  assert.match(rules, /product\.acceptance不能授权压缩或遗漏原条款/);
  assert.match(rules, /全部正负例、状态与边界组合.*实际操作和精确业务结果断言/);
  assert.match(rules, /check名称、自评、schema合法或容量声明不构成覆盖证据/);
  assert.match(rules, /每项须独立新页setup，不依赖其它check/);
  assert.match(rules, /state\.reviewContext\.acceptanceCapacity的maxChecks\/maxSteps/);
  assert.match(rules, /负例只改变目标变量，其它字段与前置状态有效/);
  assert.match(rules, /成功清空后须重填合法其它字段.*遗留错误提示/);
  assert.match(rules, /必需条款遗漏、负例混淆或容量不合格的候选必须低于3分/);
  assert.match(rules, /全部不合格或证据不足时abstain/);
  assert.match(rules, /不要求未来研发或虚构已执行/);
  assert.match(rules, /decision\/selectedCandidateId\/scores\/reason严格四字段/);
  assert.match(rules, /最低3分与最高分规则不变/);
  assert.match(rules, /不能替代或覆盖最终冻结行为Gate/);
  const base = phaseVerifierSystemPrompt(productionPhaseRubric('acceptance', 'offline-single-html')!);
  assert.equal(base.includes(ACCEPTANCE_PLANNING_VERSION), false, 'Pipeline must opt into the HTML acceptance suffix, not mutate the shared legacy rubric');
  assert.equal(phaseVerifierSystemPrompt(productionPhaseRubric('acceptance', 'camera-scene-v1')!).includes(ACCEPTANCE_PLANNING_VERSION), false);
});

test('every original output schema remains byte-identical; plans, checks and Verifier cannot add policy metadata', () => {
  const schemas = { product: productSchema, research: researchSchema, plan: planSchema, tests: testsSchema, code: codeSchema, verifier: verifierSchema };
  const originalHashes = {
    product: '64e7191630fd69ae0bd3c1721bfdedbea60272957b59a479738e84be65414d7a',
    research: '49614ee389d06becd0edc3557df3e5cb3279be4b2e8933b6c889150caf15c2c7',
    plan: 'd5d48fc592c108c98225cdadbe952e439a030b90e0218c66ca7d8604fe910f96',
    tests: 'a51e8da7c3f698165c82366c50d885e6d829894985e2a084064b8a5eb5e8f661',
    code: '6307cbaab7818a887c4c406b5ff352f26c8dc87d14bdc1128e78bbdc2c9d1cbe',
    verifier: 'c07ff638d2e87266b5da1545df1589d60fb09ce8a37c2915700f2585dab1d86b',
  };
  for (const key of Object.keys(schemas) as Array<keyof typeof schemas>) assert.equal(sha(JSON.stringify(outputContractSnapshot(schemas[key]))), originalHashes[key], key);
  const research = { observations: ['Actionable generic design'], constraints: ['Known offline limit'], unknowns: [] };
  const plan = { decision: 'proceed', summary: 'Planning only', tasks: [{ id: 'freeze', owner: 'tester', description: 'Define complete independent checks before development' }], risks: [] };
  assert.equal(researchSchema.safeParse(research).success, true);
  assert.equal(planSchema.safeParse(plan).success, true);
  assert.equal(researchSchema.safeParse({ ...research, acceptanceCapacity: {} }).success, false);
  assert.equal(planSchema.safeParse({ ...plan, capacityPlan: [] }).success, false);
  const checks = JSON.parse(TESTER_VALID_JSON_EXAMPLE);
  assert.equal(testsSchema.safeParse(checks).success, true);
  assert.equal(testsSchema.safeParse({ ...checks, coverage: [] }).success, false);
});

test('inclusive twelve-check and twenty-step limits hold exactly without trimming or rewriting fixtures', () => {
  const steps: AcceptanceCheck['steps'] = [
    { action: 'fill', selector: '#field', value: 'valid' },
    { action: 'click', selector: '#submit' },
    { action: 'assertTextExact', selector: '#business-result', text: 'expected' },
    ...Array.from({ length: 17 }, (): AcceptanceCheck['steps'][number] => ({ action: 'assertCount', selector: '#items > li', count: 0 })),
  ];
  const fixture = { checks: Array.from({ length: 12 }, (_, i) => ({ name: `Generic synthetic capacity ${i}`, steps: structuredClone(steps) })) };
  const before = JSON.stringify(fixture);
  assert.equal(testsSchema.safeParse(fixture).success, true);
  assert.equal(testsSchema.safeParse({ checks: [...fixture.checks, { name: 'Thirteenth synthetic check', steps }] }).success, false);
  const overflow = structuredClone(fixture); overflow.checks[0].steps.push({ action: 'assertCount', selector: '#items > li', count: 0 });
  const result = testsSchema.safeParse(overflow);
  assert.equal(result.success, false);
  if (result.success) throw new Error('Twenty-one steps unexpectedly accepted');
  assert.ok(result.error.issues.some(issue => issue.code === 'too_big' && JSON.stringify(issue.path) === JSON.stringify(['checks', 0, 'steps'])));
  assert.equal(overflow.checks[0].steps.length, 21);
  assert.equal(JSON.stringify(fixture), before);
});

test('ordinary Mock checks and the unchanged minimum/highest/strict four-field decision rules remain compatible', () => {
  for (const id of ['create', 'feature', 'bugfix'] as const) assert.equal(testsSchema.safeParse({ checks: demoChecks(id) }).success, true, id);
  const decision = { decision: 'accept', selectedCandidateId: 'a', scores: [{ candidateId: 'a', score: 3, reason: 'r'.repeat(1000) }], reason: 'r'.repeat(1500) };
  assert.equal(parseVerifiedDecision(decision, ['a']).decision, 'accept');
  assert.equal(verifierSchema.safeParse({ ...decision, capacityPlan: {} }).success, false);
  assert.equal(verifierSchema.safeParse({ ...decision, reason: 'r'.repeat(1501) }).success, false);
  assert.throws(() => parseVerifiedDecision({ ...decision, scores: [{ ...decision.scores[0], score: 2 }] }, ['a']));
  assert.throws(() => parseVerifiedDecision({ ...decision, scores: [decision.scores[0], { candidateId: 'b', score: 4, reason: 'higher' }] }, ['a', 'b']));
  assert.equal(parseVerifiedDecision({ ...decision, decision: 'abstain', selectedCandidateId: null }, ['a']).decision, 'abstain');
});
