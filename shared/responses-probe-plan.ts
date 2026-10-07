import { createHash } from 'node:crypto';
import binjiangInput from '../data/population/regions/binjiang-2020.json';
import { compilePopulation, regionPackSchema, type CompiledPopulation } from '../server/population/model';
import { compileResponsesRequest, type FrozenResponsesRequest } from '../server/research/responses-relay';
import { compileAnswerContract, decodeAnswerContract, type AnswerContract } from './answer-contract';
import { fingerprint } from './evidence';
import { checkLiveQualification } from './live-business-protocol';
import { checkQuestionnaireLogic, type QuestionnaireLogicRule, type QuestionnaireLogicReport } from './questionnaire-logic';
import { getBusinessDemos, type BusinessDemoId } from './research-demo';
import { evaluateBusinessResearchContent } from './research-diagnostics';
import type { ResearchTask } from './research-schema';
import { buildProfiles, validateProfileEligibility, type Answer, type Profile, type ResponseRecord } from './survey-engine';
import type { ResidentAgentPublic } from '../server/research/residents';

export const RESPONSES_PROBE_VERSION = 'responses-schema-probe-1.0';
export const RESPONSES_PROBE_PROMPT_VERSION = 'resident-object-knowledge-boundary-1.1';
export const RESPONSES_PROBE_MODEL = Object.freeze({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' } as const);
export const RESPONSES_PROBE_SCOPE = Object.freeze({
  budgetCny: 1, maxProviderRequests: 2, residentsPerScenario: 1, plannedResidents: 2,
  planningRequests: 0, corsRequests: 0, residentMaxOutputTokens: 3000, timeoutMs: 90_000,
  retries: 0, concurrency: 1, allowModelFallback: false, allowSampleReplacement: false, allowExpansion: false,
  allowLedgerResume: false, protocolVersion: RESPONSES_PROBE_VERSION, promptVersion: RESPONSES_PROBE_PROMPT_VERSION,
  ...RESPONSES_PROBE_MODEL,
} as const);
const SEED = 20261008;
const PREFLIGHT_KEY = 'synthetic-capability-preflight-not-a-provider-key';
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const system = `你是受控的Responses JSON Schema能力探测受访者，不是滨江真人。协议${RESPONSES_PROBE_PROMPT_VERSION}。
仅根据明确给定的合成资格和本轮已提供资料作答；不代表真实人口、消费者或家庭，不提供经营推荐。
五层人格、成长、教育、家庭及工作收入未知，不补成默认值，不从年龄、性别、街道推测偏好或消费能力。
本轮没有消费记录、儿童原文、意向、预算、规格偏好、价位偏好、出行或渠道资料。未提供的行为/态度题必须保持未知；不能把缺资料当0、不购买或中等倾向。
明确合成资格及许可/采购角色可据画像回答，不能把这些资格假设当真实身份。儿童直接口味未采集必须null；宠物问卷仅辅助零食，不是主粮或医疗。
研究者提供了零食定义，不等于观察到受访者已理解该定义；没有受访者确认记录时，主观理解题保持未知，不能将你阅读题干的理解当作受访者自报。
resident.street只是居住地背景分组，不是出行、店铺可达范围或消费选址观测。没有mobility观测时，可达街道题保持未知；不从住址、宠物种类或角色补出可达范围。
只输出完整JSON对象：{"residentId":"给定ID","answers":{"实际题目ID":答案}}。answers不是数组，不加type/label包装、解释或Markdown。
保留全部实际题目ID，每题唯一，含所有可选题，不增题不漏题。single是已有选项ID；multiple始终是不重复选项ID数组，未知为["unknown"]，未知排他。
未提供资料的单选用已有"unknown"，多选用["unknown"]；可选number/scale/text用JSON null，不用字符串"null"、0或空串替代未知。
遵守完整schema和另册跨题规则。不得修题、删约束、编造品牌/偏好/预算/真实网点，亦不输出市场份额或猫粮/狗粮主营结论。`;

export interface ResponsesProbeCase {
  version: typeof RESPONSES_PROBE_VERSION;
  id: BusinessDemoId;
  requestId: string;
  purpose: 'schema-capability-probe';
  task: ResearchTask;
  preset: ResidentAgentPublic;
  profile: Profile;
  logicRules: QuestionnaireLogicRule[];
  qualificationProtocol: { version: 'live-qualification-1.0'; checks: string[] };
  contract: AnswerContract;
  system: string;
  user: string;
  promptHash: string;
  frozenRequest: FrozenResponsesRequest;
  sourceQuestionnaireHash: string;
  sourceRulesHash: string;
  sourcePresetHash: string;
  populationHash: string;
  profileHash: string;
  knowledgeBoundary: { knownAnswers: Answer[]; unknownQuestionIds: string[]; meaning: string };
  knowledgeBoundaryHash: string;
  seed: number;
}

/** Pure, deterministic construction. The caller must independently verify built-in population source files. */
export function createResponsesProbeCases(population?: CompiledPopulation): ResponsesProbeCase[] {
  const builtIn = compilePopulation(regionPackSchema.parse(structuredClone(binjiangInput)));
  if (population && fingerprint(population) !== fingerprint(builtIn)) throw new Error('Capability probe requires the exact registered Binjiang population snapshot.');
  const frame = population ?? builtIn;
  return getBusinessDemos().map(demo => {
    const original = structuredClone(demo.task), task = structuredClone(original);
    task.id = `responses-probe-${demo.id}-1`;
    task.title = `${demo.id === 'child-snacks' ? '小学生成年照护者' : '宠物零食采购者'}：完整问卷Schema能力探测`;
    task.requestedOutputs = ['questionnaire-review'];
    task.declarations = task.declarations.filter(item => !item.id.includes('fixture'));
    task.declarations.push({ id: 'responses-probe-boundary', provenance: 'assumption', sourceIds: [], observationIds: [],
      claim: '仅一个固定合成资格槽位的真实API能力探测；不使用规则夹具生成实网答卷，未知消费信息必须保持未知，不认证真人或偏好。' });
    // The all-unknown five-layer context reduces stereotyping; role is an explicit qualification, not a preference.
    const originalPreset = demo.presets[1], preset = structuredClone(originalPreset);
    Object.assign(preset, RESPONSES_PROBE_MODEL);
    const roleField = demo.id === 'child-snacks' ? 'childPurchaseRole' : 'petPurchaseRole';
    const role = demo.id === 'child-snacks' ? 'permission' : 'purchaser';
    preset.population.filters.push({ field: roleField, op: 'eq', value: role });
    preset.assumptions = preset.assumptions.filter(text => !text.includes('四情景'));
    preset.assumptions.push('本次只有1个固定合成资格槽位，不是覆盖样本或滨江总体占比；未提供消费历史或偏好。',
      `${roleField}=${role}仅为明确合成资格角色，不推断购买意向、价位或消费记录。`);
    preset.behaviorNotes = '资格与许可/采购角色已显式给定；全部消费行为、态度、预算、偏好、出行及可达范围未知，不据五层或人口属性补造。';
    const profile = buildProfiles(task, frame, [preset], 1, SEED)[0];
    profile.id = `probe-${demo.id}-001`;
    validateProfileEligibility(task, profile, frame, preset);
    const knownAnswers: Answer[] = demo.id === 'child-snacks'
      ? [{ questionId: 'eligibility', value: 'eligible' }, { questionId: 'purchase-role', value: ['permission'] }, { questionId: 'child-evidence', value: 'not-collected' }]
      : [{ questionId: 'pet-type', value: 'dog' }, { questionId: 'purchase-role', value: ['purchaser'] }];
    const known = new Set(knownAnswers.map(answer => answer.questionId));
    const unknownQuestionIds = task.questionnaire.questions.filter(question => !known.has(question.id)).map(question => question.id);
    const knowledgeBoundary = { knownAnswers, unknownQuestionIds,
      meaning: '明确合成资格与角色可回答；定义仅为任务说明，不替代受访者理解确认。理解、消费出行及其余缺少观察的行为/态度/数值/原文保持typed unknown/null，不是偏好调查。' };
    const user = JSON.stringify({ protocolVersion: RESPONSES_PROBE_VERSION, resident: profile, decisionContext: task.decisionContext,
      questionnaire: task.questionnaire, registeredLogicRules: demo.logicRules,
      availableInputs: { qualificationOnly: true, selectedRoleAttribute: roleField, childOriginalCollected: false,
        petSnackDefinitionProvided: demo.id === 'pet-snacks', petSnackUnderstandingObserved: false,
        mobilityObservationsProvided: false, unobservedQuestionIds: unknownQuestionIds,
        instruction: '只知道画像中显式资格及角色。提供定义不代表已有受访者理解确认；居住街道不代表已有消费可达观测。这些主观/出行题及其余行为态度题没有观察资料，保持typed unknown；开放题同样没有受访者原文，保持null。' } });
    const contract = compileAnswerContract(task, profile.id, demo.logicRules);
    const frozenRequest = compileResponsesRequest({ model: { ...RESPONSES_PROBE_MODEL, apiKey: PREFLIGHT_KEY }, system, user, contract,
      maxOutputTokens: RESPONSES_PROBE_SCOPE.residentMaxOutputTokens });
    return { version: RESPONSES_PROBE_VERSION, id: demo.id, requestId: `capability.${demo.id}.001`, purpose: 'schema-capability-probe',
      task, preset, profile, logicRules: structuredClone(demo.logicRules),
      qualificationProtocol: { version: 'live-qualification-1.0', checks: demo.id === 'child-snacks'
        ? ['adult-caregiver-primary-assumptions', 'eligibility-agrees-with-profile', 'child-own-taste-null']
        : ['adult-owner-purchase-assumptions', 'pet-type-agrees-with-ownsCat-ownsDog', 'purchase-role-agrees-with-participation'] },
      contract, system, user, promptHash: fingerprint({ system, user }), frozenRequest,
      sourceQuestionnaireHash: fingerprint(original.questionnaire), sourceRulesHash: fingerprint(demo.logicRules), sourcePresetHash: fingerprint(originalPreset),
      populationHash: frame.datasetHash, profileHash: fingerprint(profile), knowledgeBoundary, knowledgeBoundaryHash: fingerprint(knowledgeBoundary), seed: SEED };
  });
}

// Separate compiler-keyword oracle; does not call the decoder, legacy validator, or a model.
function conforms(schema: any, value: any): boolean {
  if (schema.anyOf && !schema.anyOf.some((child: any) => conforms(child, value))) return false;
  if (schema.not && conforms(schema.not, value)) return false;
  if (schema.enum && !schema.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.type === 'null' && value !== null || schema.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))
    || schema.type === 'string' && typeof value !== 'string' || schema.type === 'array' && !Array.isArray(value)
    || schema.type === 'integer' && !Number.isInteger(value) || schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some((key: string) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, key) && !conforms(child, value[key])) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems
      || schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length
      || schema.items && !value.every(item => conforms(schema.items, item)) || schema.contains && !value.some(item => conforms(schema.contains, item))) return false;
  }
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) return false;
  if (typeof value === 'string' && (schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength
    || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  return true;
}

export interface ResponsesProbeEvaluation {
  version: typeof RESPONSES_PROBE_VERSION;
  scenarioId: BusinessDemoId;
  nativeRaw: string;
  nativeRawSha256: string;
  structure: { status: 'checked' | 'conflict'; decoderAccepted: boolean; independentSchemaOracleAccepted: boolean };
  answers: Answer[] | null;
  arrayProjection: { version: 'explicit-native-object-to-array-projection-1.0'; meaning: string; rawSha256: string; record: ResponseRecord } | null;
  logic: QuestionnaireLogicReport | null;
  qualification: ReturnType<typeof checkLiveQualification> | null;
  knowledgeBoundary: { status: 'checked' | 'conflict' | 'not-evaluated'; issues: { questionId: string; code: string }[] };
  content: ReturnType<typeof evaluateBusinessResearchContent> | null;
  passed: boolean;
  requestAcceptance: 'requires-transport-evidence';
  keywordExecution: 'unknown';
  marketResearchValidated: false;
  personaContributionValidated: false;
}

/** Audit native provider text without repair. A separately labelled array projection enables old read-only audits. */
export function evaluateResponsesProbeAnswer(probe: ResponsesProbeCase, nativeRaw: string): ResponsesProbeEvaluation {
  const expected = createResponsesProbeCases().find(item => item.id === probe.id);
  if (!expected || fingerprint(probe) !== fingerprint(expected)) throw new Error('Frozen Responses capability case drifted; no evaluation admitted.');
  if (typeof nativeRaw !== 'string') throw new Error('Native Responses answer must be text.');
  let oracleAccepted = false, answers: Answer[] | null = null;
  try { oracleAccepted = Buffer.byteLength(nativeRaw) <= 512_000 && conforms(probe.contract.schema, JSON.parse(nativeRaw)); } catch { /* Static conflict only. */ }
  try { answers = decodeAnswerContract(probe.contract, nativeRaw); } catch { /* Preserve native text; no repair and no private parser error. */ }
  const result: ResponsesProbeEvaluation = { version: RESPONSES_PROBE_VERSION, scenarioId: probe.id, nativeRaw, nativeRawSha256: sha(nativeRaw),
    structure: { status: answers && oracleAccepted ? 'checked' : 'conflict', decoderAccepted: answers !== null, independentSchemaOracleAccepted: oracleAccepted },
    answers, arrayProjection: null, logic: null, qualification: null, knowledgeBoundary: { status: 'not-evaluated', issues: [] }, content: null,
    passed: false, requestAcceptance: 'requires-transport-evidence', keywordExecution: 'unknown', marketResearchValidated: false, personaContributionValidated: false };
  if (!answers || !oracleAccepted) return result;
  const raw = JSON.stringify({ residentId: probe.profile.id, answers });
  const record: ResponseRecord = { residentId: probe.profile.id, status: 'valid', structureValid: true, answers,
    raw, durationMs: 0, inputTokens: null, outputTokens: null };
  result.arrayProjection = { version: 'explicit-native-object-to-array-projection-1.0',
    meaning: '明确的native object→legacy array转换，仅供旧资格/逻辑审计；不是模型原文，duration=0和usage=null为无调用数据的投影占位，不是运行/收费证据。', rawSha256: sha(raw), record };
  result.logic = checkQuestionnaireLogic(probe.task, answers, probe.logicRules);
  result.qualification = checkLiveQualification(probe.id, probe.profile, record);
  const values = new Map(answers.map(answer => [answer.questionId, answer.value])), issues: { questionId: string; code: string }[] = [];
  for (const known of probe.knowledgeBoundary.knownAnswers) if (fingerprint(values.get(known.questionId)) !== fingerprint(known.value)) issues.push({ questionId: known.questionId, code: 'explicit-known-input-drift' });
  for (const id of probe.knowledgeBoundary.unknownQuestionIds) {
    const question = probe.task.questionnaire.questions.find(item => item.id === id)!;
    const unknown = !question.required ? null : question.type === 'multiple' ? ['unknown'] : 'unknown';
    if (fingerprint(values.get(id)) !== fingerprint(unknown)) issues.push({ questionId: id, code: 'unprovided-observation-filled' });
  }
  result.knowledgeBoundary = { status: issues.length ? 'conflict' : 'checked', issues };
  result.content = evaluateBusinessResearchContent(probe.id, probe.task, answers);
  result.passed = result.logic.status === 'checked' && result.qualification.status === 'checked' && result.knowledgeBoundary.status === 'checked';
  return result;
}
