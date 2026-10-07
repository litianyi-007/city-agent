import { getBusinessDemos, type BusinessDemoId } from './research-demo';
import { researchTaskSchema } from './research-schema';
import { checkQuestionnaireLogic } from './questionnaire-logic';
import { validateAnswers, type Profile, type ResponseRecord } from './survey-engine';
import { fingerprint } from './evidence';
import type { ResidentAgentPublic } from '../server/research/residents';

export const LIVE_BUSINESS_PROTOCOL = 'live-business-smoke-1.0';
export const LIVE_BUSINESS_CONTRACT_PROTOCOL = 'live-business-smoke-1.1';
export function createLiveBusinessProtocol(id: BusinessDemoId, model: Pick<ResidentAgentPublic, 'provider' | 'baseUrl' | 'modelId'>) {
  const original = getBusinessDemos().find(demo => demo.id === id)!;
  const task = structuredClone(original.task);
  task.id = `live-${id}-review-1`;
  task.title = id === 'child-snacks' ? '小学照护者零食调查：真实LLM合成测试轮' : '宠物零食调查：真实LLM合成测试轮';
  task.questionnaire.version = LIVE_BUSINESS_PROTOCOL;
  task.declarations = task.declarations.filter(item => !item.id.includes('fixture'));
  task.declarations.push({ id: 'live-test-boundary', claim: '使用真实API独立作答，不使用规则夹具；受访者仍为合成居民，非真人，不能据此认证市场需求或五层贡献。', provenance: 'assumption', sourceIds: [], observationIds: [] });
  task.decisionContext.offering += ' 本轮真实模型作答；未知可用相应选项或null。所有题目均返回questionId与value，未采集的儿童原文必须null，不得补造。';
  const presets = original.presets.map(preset => ({ ...preset, provider: model.provider, baseUrl: model.baseUrl, modelId: model.modelId, assumptions: preset.assumptions.map(text => text.includes('四情景各覆盖3人')
    ? '四情景按10个计划画像覆盖(3/3/2/2)，不是总体占比；真实API作答不是真人研究。' : text), hasApiKey: false }));
  return { id, protocolVersion: LIVE_BUSINESS_PROTOCOL, task: researchTaskSchema.parse(task), presets, logicRules: original.logicRules,
    qualificationProtocol: { version: 'live-qualification-1.0', checks: id === 'child-snacks'
      ? ['adult-caregiver-primary-assumptions', 'eligibility-agrees-with-profile', 'child-own-taste-null']
      : ['adult-owner-purchase-assumptions', 'pet-type-agrees-with-ownsCat-ownsDog', 'purchase-role-agrees-with-participation'] },
    sourceQuestionnaireHash: fingerprint(original.task), sourceRulesHash: fingerprint(original.logicRules) };
}
/** A separate protocol for the new authorization; never relabel or rewrite v1.0 evidence. */
export function createLiveBusinessContractProtocol(id: BusinessDemoId, model: Pick<ResidentAgentPublic, 'provider' | 'baseUrl' | 'modelId'>) {
  const protocol = createLiveBusinessProtocol(id, model);
  protocol.protocolVersion = LIVE_BUSINESS_CONTRACT_PROTOCOL;
  protocol.task.id = `live-${id}-review-2`;
  protocol.task.questionnaire.version = LIVE_BUSINESS_CONTRACT_PROTOCOL;
  // The 17/18 questions, eligibility and logical gates stay the same; only generation instructions change.
  return { ...protocol, task: researchTaskSchema.parse(protocol.task) };
}
export function checkLiveQualification(id: BusinessDemoId, profile: Profile, response: ResponseRecord) {
  const values = new Map(response.answers.map(answer => [answer.questionId, answer.value]));
  const attrs = new Map(profile.attributes.map(item => [item.key, item.value]));
  const issues: string[] = [];
  if (!response.structureValid || response.status !== 'valid') issues.push('答卷结构/状态未通过，不算资格核对通过。');
  if (profile.age < 18) issues.push('画像未满足成年资格。');
  if (id === 'child-snacks') {
    if (attrs.get('caregiver') !== true || attrs.get('childSchoolStage') !== 'primary') issues.push('画像缺少明确照护/小学资格假设。');
    if (values.get('eligibility') !== 'eligible') issues.push('资格回答未与明确照护小学假设一致；不替换样本。');
    if (values.get('child-own-taste') !== null) issues.push('未采集儿童原文，应明确null；不事后修补。');
  } else {
    if (attrs.get('petOwner') !== true || attrs.get('petPurchaseParticipant') !== true) issues.push('画像缺少明确养宠/采购参与假设。');
    const cat = attrs.get('ownsCat'); const dog = attrs.get('ownsDog');
    const expected = cat === true && dog === true ? 'both' : cat === true && dog === false ? 'cat' : cat === false && dog === true ? 'dog' : undefined;
    if (!expected || values.get('pet-type') !== expected) issues.push('猫犬资格回答与画像明确属性不一致。');
    const role = values.get('purchase-role');
    if (!Array.isArray(role) || !role.some(value => ['purchaser', 'decision', 'shared'].includes(value)) || role.some(value => ['none', 'unknown'].includes(value))) issues.push('采购参与回答未与已赋资格一致。');
  }
  return { residentId: profile.id, protocolVersion: 'live-qualification-1.0', status: issues.length ? 'conflict' : 'checked', issues,
    scope: '只核对已明确赋予的合成资格，不认证真实身份/人口代表性/市场效度。' };
}
export function liveResponseStop(protocol: ReturnType<typeof createLiveBusinessProtocol>, response: ResponseRecord, profile: Profile): string | undefined {
  try {
    const answers = validateAnswers(protocol.task, profile.id, response.raw);
    const logic = checkQuestionnaireLogic(protocol.task, answers, protocol.logicRules);
    const qualification = checkLiveQualification(protocol.id, profile, { ...response, answers });
    if (response.status !== 'valid' || logic.status !== 'checked' || qualification.status !== 'checked') return '预登记质量停止：本份结构、登记跨题或资格检查未通过；余下保留not-started，不重试。';
  } catch { return '预登记质量停止：原始答卷不能完整复核；余下保留not-started，不重试。'; }
}
