import childInput from '../data/research/business-child-questionnaire.json';
import petInput from '../data/research/business-pet-questionnaire.json';
import personaInputs from '../data/research/business-personas.json';
import { researchTaskSchema, type ResearchTask } from './research-schema';
import { residentPersonaSchema } from './resident-persona';
import { checkQuestionnaireLogic, validateQuestionnaireLogicRules, QUESTIONNAIRE_LOGIC_VERIFIER_VERSION, type QuestionnaireLogicRule } from './questionnaire-logic';
import { buildBusinessLogicRules } from './registered-questionnaire-logic';
import { fingerprint } from './evidence';
import { executeSurvey } from './survey-runner';
import { validateAnswers, type Answer, type Profile, type SurveyRun } from './survey-engine';
import type { ResidentAgentPublic } from '../server/research/residents';
import type { CompiledPopulation, RegionPack } from '../server/population/model';

export const BUSINESS_DEMO_VERSION = 'business-engineering-proof-1.1';
export const BUSINESS_FIXTURE_POLICY_ID = 'business-consistent-synthetic-v1';
export const BUSINESS_DEMO_NOTICE = '明确synthetic工程夹具：不调用LLM，不是真实调研、人格效度、市场率或经营选址建议。';
export type BusinessDemoId = 'child-snacks' | 'pet-snacks';
export interface BusinessDemo {
  id: BusinessDemoId; title: string; task: ResearchTask; presets: ResidentAgentPublic[];
  logicRules: QuestionnaireLogicRule[]; limitations: string[]; nextEvidence: string[];
}

/** Returns new snapshots; no key, network, public publishing or mutable shared preset registry. */
export function getBusinessDemos(): BusinessDemo[] {
  return (['child-snacks', 'pet-snacks'] as const).map(id => {
    const task = researchTaskSchema.parse(structuredClone(id === 'child-snacks' ? childInput : petInput));
    const presets: ResidentAgentPublic[] = personaInputs.map((source, index) => {
      const filters = structuredClone(task.population.filters);
      if (index === 2) filters.push({ field: 'age', op: 'gte', value: 60 });
      const petType = ['cat', 'dog', 'both', 'cat'][index];
      if (id === 'pet-snacks') filters.push({ field: 'ownsCat', op: 'eq', value: petType !== 'dog' }, { field: 'ownsDog', op: 'eq', value: petType !== 'cat' });
      const qualifier = id === 'child-snacks' ? '小学生照护者' : petType === 'cat' ? '养猫采购参与者' : petType === 'dog' ? '养犬采购参与者' : '猫犬共同采购参与者';
      return { id: `10000000-0000-4000-8000-${String((id === 'child-snacks' ? 1 : 2) * 100 + index + 1).padStart(12, '0')}`,
        kind: 'resident-agent-preset', schemaVersion: '1.0', name: `${qualifier} · ${source.label}`,
        templateId: id === 'child-snacks' ? 'caregiver' : petType === 'cat' ? 'cat-buyer' : petType === 'dog' ? 'dog-buyer' : 'custom',
        description: source.description, population: { ...structuredClone(task.population), filters },
        assumptions: [id === 'child-snacks' ? '成年、照护及小学在读资格是显式假设，未采集儿童直接回答。' : '成年、养猫/犬及采购参与资格是显式假设，不是滨江真实养宠比例。',
          '四情景各覆盖3人只是工程分配，无目标总体权重、联合微观人口或消费证据。', '五层均为assumption，不是DNA或真实经历/人格量表。', ...(index === 2 ? ['60+及退休分别为显式情景，不是年龄推出职业。'] : [])],
        behaviorNotes: '不预填购买意向、口味、商品品类、价格、品牌或位置；未知保留未知。',
        persona: residentPersonaSchema.parse(structuredClone(source.persona)),
        provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'fixture-no-model', enabled: true, hasApiKey: false,
        createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' };
    });
    const rules = validateQuestionnaireLogicRules(task, buildBusinessLogicRules(id));
    return { id, title: task.title, task, presets, logicRules: rules,
      limitations: [BUSINESS_DEMO_NOTICE, '回答情景由seed及resident序号轮转，与五层人格、教育、家庭和收入无因果关系；不能把规则答案回显当人格贡献。',
        '12/12工程结构通过由夹具保证，不升级真实模型完整率、语义质量、稳健性或外部效度门限。',
        '人口锚点是2020历史统计框；18+和目标资格没有分母，不能外推到2026真实居民。',
        id === 'child-snacks' ? '只模拟成年照护者购买/许可；child-own-taste全部null，孩子本人口味未知。' : '仅宠物辅助零食；不推断猫粮/狗粮等主粮、疗效或猫狗市场占比。',
        '跨题logicAudit另册检查，不改survey-engine默认valid/contradictions，也不宣称自动理解所有题意。',
        '网点、主营、市场率与盈利均not-supported；缺业务证据时不生成推荐。'],
      nextEvidence: ['同地域/边界/时点的目标资格与分母、合法真实问卷和抽样框', '候选点经纬度/边界、租金、客流时段、竞争及经营/学校周边规则',
        id === 'child-snacks' ? '独立儿童本人研究的监护同意、年龄适用问卷、口味原文及许可/购买人角色链接' : '猫犬资格及零食购买者分母、匿名化线上订单密度、50克规格真实报价与履约成本', '真人留出验证、重复实验、失败及未知记录；不得以合成数据验证自身'] };
  });
}

/** Synthetic cases, not a model/provider and not a personality-to-preference function. */
export function businessFixtureResponse(profile: Profile, task: ResearchTask, seed: number): string {
  const id: BusinessDemoId = task.id === 'business-child-snacks' ? 'child-snacks' : task.id === 'business-pet-snacks' ? 'pet-snacks' : (() => { throw new Error('工程策略只支持登记的两个业务问卷。'); })();
  const index = Number(profile.id.match(/^resident-(\d+)$/)?.[1]);
  if (!Number.isInteger(index) || index < 1) throw new Error('业务工程画像ID须是resident序号。');
  // Rotate cases across each block of four, so a preset does not always echo one canned purchase answer.
  const caseIndex = (index - 1 + Math.floor((index - 1) / 4) + seed % 4) % 4;
  const intent = ['yes', 'maybe', 'no', 'unknown'][caseIndex];
  const unknown = caseIndex === 3; const no = caseIndex === 2;
  const attribute = (key: string) => profile.attributes.find(item => item.key === key)?.value;
  const cat = attribute('ownsCat') === true; const dog = attribute('ownsDog') === true;
  const pet = cat && dog ? 'both' : cat ? 'cat' : dog ? 'dog' : 'unknown';
  const values: Record<string, Answer['value']> = {
    'purchase-role': unknown ? ['unknown'] : caseIndex === 1 ? [id === 'child-snacks' ? 'permission' : 'decision'] : ['purchaser', 'shared'],
    'past-frequency': unknown ? 'unknown' : no ? 'none' : id === 'child-snacks' ? 'four-eight' : 'one-two',
    'purchase-intent': intent,
    'monthly-budget': no ? 0 : unknown || caseIndex === 1 ? null : id === 'child-snacks' ? 80 : 120,
    'package-size': no ? 'none' : unknown ? 'unknown' : id === 'child-snacks' ? 'g20' : 'g50',
    'planned-channels': no ? ['none'] : unknown ? ['unknown'] : ['online', 'pickup'],
    'travel-minutes': no || unknown ? null : 15,
    'reachable-streets': unknown ? ['unknown'] : [profile.street],
    'traceability-importance': unknown ? null : caseIndex === 1 ? 5 : 4,
    'purchase-barriers': unknown ? ['unknown'] : caseIndex === 1 ? [id === 'child-snacks' ? 'allergen' : 'suitability', 'price'] : ['freshness'],
    'needed-evidence': unknown ? null : 'synthetic工程答卷：仍需独立真实资料与目标资格，不提供开店/主营结论。',
  };
  if (id === 'child-snacks') Object.assign(values, {
    eligibility: 'eligible', 'child-evidence': 'not-collected', 'child-own-taste': null,
    'past-categories': no ? ['none'] : unknown ? ['unknown'] : ['grain', 'fruit'],
    'permission-factors': unknown ? ['unknown'] : ['ingredients', 'school-rules'],
    'price-per20g': no ? 'none' : unknown ? 'unknown' : 'three-six',
  });
  else Object.assign(values, {
    'pet-type': pet, 'snack-boundary': unknown ? 'unknown' : 'understood',
    'past-snack-categories': no ? ['none'] : unknown ? ['unknown'] : cat && !dog ? ['cat-creamy', 'freeze-dried'] : dog && !cat ? ['dog-chew', 'training'] : ['freeze-dried', 'training'],
    'price-per50g': no ? 'none' : unknown ? 'unknown' : 'ten-twenty',
    'online-handoff': no ? 'none' : unknown ? 'unknown' : 'both',
    'price10-intent': no ? 'no' : unknown ? 'unknown' : caseIndex === 1 ? 'maybe' : 'yes',
    'price20-intent': no ? 'no' : unknown ? 'unknown' : 'maybe',
  });
  if (task.questionnaire.questions.some(question => !(question.id in values))) throw new Error('业务问卷已变化，须更新显式夹具策略，不能自动补答。');
  return JSON.stringify({ residentId: profile.id, answers: task.questionnaire.questions.map(question => ({ questionId: question.id, value: values[question.id] })) });
}

export function auditBusinessDemoRun(run: SurveyRun, rules: QuestionnaireLogicRule[]) {
  validateQuestionnaireLogicRules(run.task, rules);
  const profileCounts = new Map<string, number>(); const responseCounts = new Map<string, number>();
  for (const profile of run.profiles) profileCounts.set(profile.id, (profileCounts.get(profile.id) ?? 0) + 1);
  for (const response of run.responses) responseCounts.set(response.residentId, (responseCounts.get(response.residentId) ?? 0) + 1);
  const mappingIssues: string[] = [];
  if (run.profiles.length === 0) mappingIssues.push('没有冻结画像，无法建立计划分母。');
  if (run.metrics.planned !== run.profiles.length) mappingIssues.push('metrics.planned与冻结画像分母不一致。');
  if (run.responses.length !== run.profiles.length) mappingIssues.push('答卷数量与冻结画像计划分母不一致。');
  for (const [id, count] of profileCounts) {
    if (count !== 1) mappingIssues.push(`冻结画像ID重复：${id}`);
    if (!responseCounts.has(id)) mappingIssues.push(`缺少计划画像的答卷：${id}`);
  }
  for (const [id, count] of responseCounts) {
    if (count !== 1) mappingIssues.push(`答卷居民ID重复：${id}`);
    if (!profileCounts.has(id)) mappingIssues.push(`答卷不属于冻结画像：${id}`);
  }
  const records = run.responses.map(response => {
    const errors: string[] = []; let parsed: Answer[] = []; let rawStructureValid = false; let answersMatchRaw = false;
    try {
      parsed = validateAnswers(run.task, response.residentId, response.raw); rawStructureValid = true;
      answersMatchRaw = fingerprint(parsed) === fingerprint(response.answers);
      if (!answersMatchRaw) errors.push('answers与原始raw复算不一致。');
    } catch (error) { errors.push(`原始raw无法通过答题结构复核：${(error as Error).message}`); }
    if (response.structureValid !== undefined && response.structureValid !== rawStructureValid) errors.push('结构标记与原始raw复算不一致。');
    if (response.status !== 'valid') errors.push(`上游答卷状态为${response.status}，不计独立审计通过。`);
    const mapped = profileCounts.get(response.residentId) === 1 && responseCounts.get(response.residentId) === 1;
    if (!mapped) errors.push('居民ID缺失、重复或归属不正确。');
    const report = checkQuestionnaireLogic(run.task, parsed, rules);
    const structureValid = rawStructureValid && answersMatchRaw && !errors.length;
    return { residentId: response.residentId, structureValid, rawStructureValid, answersMatchRaw, mapped, sourceStatus: response.status, errors, report,
      passed: mapped && structureValid && report.status === 'checked' };
  });
  const individuallyPassed = records.filter(record => record.passed).length;
  // A complete-batch acceptance count is unavailable when its resident denominator is inconsistent.
  const completeDenominator = mappingIssues.length === 0;
  const passed = completeDenominator ? individuallyPassed : 0;
  const hasConflict = mappingIssues.length > 0 || records.some(record => !record.structureValid || record.report.status === 'conflict');
  return { schemaVersion: '1.0' as const, verifierVersion: QUESTIONNAIRE_LOGIC_VERIFIER_VERSION,
    status: hasConflict ? 'conflict' as const : !records.length || !rules.length || records.some(record => record.report.status === 'not-evaluated') ? 'not-evaluated' as const : 'checked' as const,
    scope: '独立的登记跨题规则审计；不升级survey默认valid，不证明真实模型质量/人格效度。',
    rules: structuredClone(rules), rulesHash: fingerprint(rules), planned: run.profiles.length, evaluated: records.length,
    passed, individuallyPassed, completeDenominator, failed: Math.max(0, run.profiles.length - passed), notEvaluated: records.filter(record => record.report.status === 'not-evaluated').length,
    mappingIssues, records };
}

export async function createBusinessDemoRun(input: { demoId: BusinessDemoId; population: CompiledPopulation; pack: RegionPack; seed?: number; id?: string; signal?: AbortSignal }) {
  if (Object.keys(input).some(key => !['demoId', 'population', 'pack', 'seed', 'id', 'signal'].includes(key))) throw new Error('业务工程入口拒绝模型模式、凭证或未知参数。');
  const demo = getBusinessDemos().find(item => item.id === input.demoId);
  if (!demo) throw new Error('业务工程场景不存在。');
  const seed = input.seed ?? 20261007;
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('seed须是0–2147483647整数。');
  if (input.id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new Error('运行ID须为UUID。');
  const run = await executeSurvey({ id: input.id, mode: 'fixture', task: demo.task, presets: demo.presets, pack: input.pack, population: input.population, count: 12, seed,
    pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: new Date().toISOString(), source: 'synthetic工程演示，无供应商调用，API费用0；不含本机计算。' },
    signal: input.signal ?? new AbortController().signal, experiment: { id: BUSINESS_DEMO_VERSION, arm: demo.id },
    fixtureResponse: businessFixtureResponse, fixturePolicyId: BUSINESS_FIXTURE_POLICY_ID,
    call: async () => { throw new Error('安全停止：业务工程演示禁止调用真实模型。'); },
  });
  const logicAudit = auditBusinessDemoRun(run, demo.logicRules);
  // Extend the frozen limitations only; independent audit is not relabelled as the engine's semantic metric.
  run.limitations = [...run.limitations, ...demo.limitations];
  return { run, logicAudit, demo: { id: demo.id, title: demo.title, notice: BUSINESS_DEMO_NOTICE, nextEvidence: demo.nextEvidence },
    evidenceHash: fingerprint({ taskHash: run.taskHash, populationHash: run.populationHash, profilesHash: run.profileHash, rawResponses: run.responses.map(response => ({ residentId: response.residentId, raw: response.raw })), rulesHash: logicAudit.rulesHash, verifierVersion: logicAudit.verifierVersion }) };
}

export type BusinessDemoExecution = Awaited<ReturnType<typeof createBusinessDemoRun>>;
