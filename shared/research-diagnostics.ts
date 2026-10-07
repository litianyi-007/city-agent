import { fingerprint } from './evidence';
import { checkQuestionnaireLogic, validateQuestionnaireLogicRules, type QuestionnaireLogicRule } from './questionnaire-logic';
import type { BusinessDemoId } from './research-demo';
import type { ResearchTask } from './research-schema';
import { validateAnswers, type Answer, type Profile, type SurveyRun } from './survey-engine';

export const RESEARCH_DIAGNOSTICS_VERSION = 'research-diagnostics-1.0';
export type ResearchDiagnosticState = 'not-started' | 'structure-blocked' | 'checked' | 'unknown';
type EvaluationStatus = 'checked' | 'conflict' | 'not-evaluated';
interface Evaluation { status: EvaluationStatus; reasons: string[]; issues: string[] }
const unevaluated = (reason: string): Evaluation => ({ status: 'not-evaluated', reasons: [reason], issues: [] });
const unknownValue = (value: Answer['value'] | undefined) => value === undefined || value === null
  || typeof value === 'string' && ['unknown', '不知道', '不确定', '未知'].includes(value.trim())
  || Array.isArray(value) && value.length === 1 && value[0] === 'unknown';
function assertScenario(scenarioId: BusinessDemoId, task: ResearchTask) {
  if (!['child-snacks', 'pet-snacks'].includes(scenarioId)
    || task.questionnaire.id !== (scenarioId === 'child-snacks' ? 'business-child-q' : 'business-pet-q')) throw new Error('诊断场景与冻结问卷不一致；不能借另一场景解释受访者单位。');
}

/** The supplied answers are generated scenario material. This API accepts no observation attestation. */
export function evaluateBusinessResearchContent(scenarioId: BusinessDemoId, task: ResearchTask, answers: Answer[]) {
  assertScenario(scenarioId, task);
  const values = new Map(answers.map(answer => [answer.questionId, answer.value]));
  const administrative = new Set(['eligibility', 'pet-type', 'purchase-role', 'child-evidence', 'snack-boundary', 'needed-evidence']);
  const questions = task.questionnaire.questions.map(question => {
    const value = values.get(question.id); const unknown = unknownValue(value);
    const unreachable = scenarioId === 'child-snacks' && question.id === 'child-own-taste';
    const scenarioDefined = ['eligibility', 'pet-type', 'purchase-role', 'snack-boundary', 'child-evidence'].includes(question.id);
    return { questionId: question.id, valueState: value === undefined ? 'missing' as const : unknown ? 'unknown' as const : 'known' as const,
      source: unknown ? 'unknown' as const : scenarioDefined ? 'scenario-assumption' as const : 'scenario-generated' as const,
      knowledge: unreachable ? 'unreachable-this-protocol' as const : scenarioDefined ? 'scenario-defined' as const : 'reachable-input-not-provided' as const,
      gap: unreachable ? 'child-original-not-collected' : scenarioDefined ? null : 'input-observation-absent',
      pastBehavior: ['past-frequency', 'past-categories', 'past-snack-categories'].includes(question.id),
      unsupportedOriginal: unreachable && !unknown,
      businessMeasure: !administrative.has(question.id) && !unreachable };
  });
  const measured = questions.filter(question => question.businessMeasure);
  const known = measured.filter(question => question.valueState === 'known').length;
  return { status: known === 0 ? 'information-insufficient' as const : 'scenario-information-present' as const,
    businessQuestions: measured.length, knownBusinessQuestions: known, unknownBusinessQuestions: measured.length - known,
    questions, realWorldSufficiency: 'not-supported' as const, nonUnknownQuota: null,
    scope: '只描述合成答卷的内容覆盖；合法未知不判错，任何非未知答案也不认证消费者事实。人格、教育、收入不补消费历史或偏好。',
    unavailableOutputs: scenarioId === 'child-snacks'
      ? ['direct-child-taste', 'target-population-rate', 'site-recommendation', 'sales-forecast']
      : ['main-food-demand', 'target-population-rate', 'site-recommendation', 'sales-forecast'] };
}
export type BusinessResearchContent = ReturnType<typeof evaluateBusinessResearchContent>;

function qualification(scenarioId: BusinessDemoId, profile: Profile, answers: Answer[]): Evaluation {
  const values = new Map(answers.map(answer => [answer.questionId, answer.value]));
  const attrs = new Map(profile.attributes.map(attribute => [attribute.key, attribute.value]));
  const issues: string[] = []; const reasons: string[] = [];
  if (attrs.size !== profile.attributes.length) return unevaluated('duplicate-profile-attribute');
  if (!Number.isFinite(profile.age)) reasons.push('adult-age-input-missing');
  else if (profile.age < 18) issues.push('画像明确年龄不满足成年资格。');
  const attribute = (key: string, expected: string | boolean) => {
    if (!attrs.has(key)) reasons.push(`qualification-input-missing:${key}`);
    else if (attrs.get(key) !== expected) issues.push(`画像明确属性不满足情景资格：${key}。`);
  };
  if (scenarioId === 'child-snacks') {
    attribute('caregiver', true); attribute('childSchoolStage', 'primary');
    const eligibility = values.get('eligibility');
    if (unknownValue(eligibility)) reasons.push('qualification-answer-unknown:eligibility');
    else if (eligibility !== 'eligible') issues.push('资格回答与明确照护小学假设不一致。');
    if (!values.has('child-own-taste')) reasons.push('child-original-not-explicit');
    else if (values.get('child-own-taste') !== null) issues.push('本轮未采集儿童原文，不能用生成文本代替儿童本人口味。');
  } else {
    attribute('petOwner', true); attribute('petPurchaseParticipant', true);
    const cat = attrs.get('ownsCat'); const dog = attrs.get('ownsDog');
    if (typeof cat !== 'boolean' || typeof dog !== 'boolean') reasons.push('qualification-input-missing:pet-species');
    else {
      const expected = cat && dog ? 'both' : cat ? 'cat' : dog ? 'dog' : null;
      if (!expected) issues.push('画像明确属性未满足猫犬养宠资格。');
      else if (unknownValue(values.get('pet-type'))) reasons.push('qualification-answer-unknown:pet-type');
      else if (values.get('pet-type') !== expected) issues.push('猫犬资格回答与画像明确属性不一致。');
    }
    const role = values.get('purchase-role');
    if (unknownValue(role)) reasons.push('qualification-answer-unknown:purchase-role');
    else if (!Array.isArray(role) || !role.some(value => ['purchaser', 'decision', 'shared'].includes(value)) || role.some(value => ['none', 'unknown'].includes(value))) issues.push('采购参与回答与明确参与假设不一致。');
  }
  return { status: issues.length ? 'conflict' : reasons.length ? 'not-evaluated' : 'checked', reasons, issues };
}

export interface BusinessResearchDiagnosticOptions { scenarioId: BusinessDemoId; logicRules: QuestionnaireLogicRule[] }
interface DiagnosticRecord {
  plannedIndex: number; residentId: string; state: ResearchDiagnosticState; reasons: string[];
  sourceStatus: SurveyRun['responses'][number]['status'] | null;
  structure: { rawStructureValid: boolean | null; answersMatchRaw: boolean | null; sourceFlagConsistent: boolean | null; missingOptionalQuestionIds: string[]; issues: string[] };
  logic: Evaluation & { report?: ReturnType<typeof checkQuestionnaireLogic> };
  qualification: Evaluation; content: BusinessResearchContent | { status: 'not-evaluated'; reasons: string[] }; passed: boolean;
}

/** Separate, read-only audit of the existing raw contract. Never rewrites historical flags or metrics. */
export function diagnoseBusinessResearchRun(run: SurveyRun, options: BusinessResearchDiagnosticOptions) {
  assertScenario(options.scenarioId, run.task);
  const rules = validateQuestionnaireLogicRules(run.task, options.logicRules);
  const profileCounts = new Map<string, number>(); const responseIndices = new Map<string, number[]>();
  run.profiles.forEach(profile => profileCounts.set(profile.id, (profileCounts.get(profile.id) ?? 0) + 1));
  run.responses.forEach((response, index) => responseIndices.set(response.residentId, [...(responseIndices.get(response.residentId) ?? []), index]));
  const mappingIssues: { code: string; residentId?: string; count?: number }[] = [];
  if (!run.profiles.length) mappingIssues.push({ code: 'no-frozen-planned-profiles' });
  if (run.metrics.planned !== run.profiles.length) mappingIssues.push({ code: 'recorded-planned-mismatch' });
  for (const [residentId, count] of profileCounts) {
    if (count !== 1) mappingIssues.push({ code: 'duplicate-profile-id', residentId, count });
    if (!responseIndices.has(residentId)) mappingIssues.push({ code: 'missing-response', residentId });
  }
  for (const [residentId, indices] of responseIndices) {
    if (indices.length !== 1) mappingIssues.push({ code: 'duplicate-response-id', residentId, count: indices.length });
    if (!profileCounts.has(residentId)) mappingIssues.push({ code: 'orphan-response', residentId, count: indices.length });
  }
  const records: DiagnosticRecord[] = run.profiles.map((profile, plannedIndex) => {
    const indices = responseIndices.get(profile.id) ?? []; const response = indices.length === 1 ? run.responses[indices[0]] : undefined;
    const record: DiagnosticRecord = { plannedIndex, residentId: profile.id, state: 'unknown', reasons: [], sourceStatus: response?.status ?? null,
      structure: { rawStructureValid: null, answersMatchRaw: null, sourceFlagConsistent: null, missingOptionalQuestionIds: [], issues: [] },
      logic: unevaluated('mapping-unavailable'), qualification: unevaluated('mapping-unavailable'), content: { status: 'not-evaluated', reasons: ['mapping-unavailable'] }, passed: false };
    const stop = (state: ResearchDiagnosticState, reasons: string[]) => {
      record.state = state; record.reasons = reasons;
      record.logic = unevaluated(reasons[0]); record.qualification = unevaluated(reasons[0]);
      record.content = { status: 'not-evaluated', reasons: [...reasons] }; return record;
    };
    if (profileCounts.get(profile.id) !== 1) return stop('unknown', ['duplicate-profile-id']);
    if (indices.length > 1) return stop('unknown', ['duplicate-response-id']);
    if (!response) return stop('unknown', ['missing-response']);
    if (response.status === 'not-started') {
      if (response.raw !== '' || response.answers.length || response.structureValid === true) return stop('structure-blocked', ['not-started-record-inconsistent']);
      return stop('not-started', ['request-not-started']);
    }
    if (response.status === 'failed' && !response.raw.trim()) return stop('unknown', ['request-failed-no-raw']);
    let parsed: Answer[];
    try {
      parsed = validateAnswers(run.task, profile.id, response.raw); record.structure.rawStructureValid = true;
      record.structure.answersMatchRaw = fingerprint(parsed) === fingerprint(response.answers);
      record.structure.sourceFlagConsistent = response.structureValid === undefined ? null : response.structureValid === true;
      record.structure.missingOptionalQuestionIds = run.task.questionnaire.questions.filter(question => !question.required && !parsed.some(answer => answer.questionId === question.id)).map(question => question.id);
      if (!record.structure.answersMatchRaw) record.structure.issues.push('stored-answers-raw-mismatch');
      if (record.structure.sourceFlagConsistent === false) record.structure.issues.push('stored-structure-flag-raw-mismatch');
    } catch (error) {
      record.structure.rawStructureValid = false;
      record.structure.sourceFlagConsistent = response.structureValid === undefined ? null : response.structureValid === false;
      record.structure.issues.push(`raw-contract-invalid:${(error as Error).message}`);
      if (record.structure.sourceFlagConsistent === false) record.structure.issues.push('stored-structure-flag-raw-mismatch');
      return stop('structure-blocked', ['raw-contract-invalid']);
    }
    if (response.status !== 'valid') record.structure.issues.push('source-status-not-valid');
    if (record.structure.issues.length) return stop('structure-blocked', [...record.structure.issues]);
    const logic = checkQuestionnaireLogic(run.task, parsed, rules);
    record.state = 'checked';
    record.logic = { status: logic.status, reasons: logic.status === 'not-evaluated' ? [rules.length ? 'no-applicable-registered-rule' : 'no-registered-rules'] : [], issues: logic.issues.map(issue => issue.message), report: logic };
    record.qualification = qualification(options.scenarioId, profile, parsed);
    record.content = evaluateBusinessResearchContent(options.scenarioId, run.task, parsed);
    record.passed = record.logic.status === 'checked' && record.qualification.status === 'checked';
    return record;
  });
  const countEvaluations = (key: 'logic' | 'qualification') => ({ checked: records.filter(record => record[key].status === 'checked').length,
    conflict: records.filter(record => record[key].status === 'conflict').length, notEvaluated: records.filter(record => record[key].status === 'not-evaluated').length });
  const completeDenominator = mappingIssues.length === 0; const individuallyPassed = records.filter(record => record.passed).length;
  return { version: RESEARCH_DIAGNOSTICS_VERSION, sourceRunId: run.id, sourceRunVersion: run.version,
    scenarioId: options.scenarioId, rulesHash: fingerprint(rules), evidenceHash: fingerprint({ task: run.task, profiles: run.profiles, responses: run.responses }),
    planned: run.profiles.length, recordedPlanned: run.metrics.planned, completeDenominator, mappingIssues,
    denominatorUnits: { planned: 'frozen-synthetic-person-slots', realQualifiedPeople: null, uniqueHouseholds: null, uniqueSelectedChildren: null,
      directlySurveyedChildren: options.scenarioId === 'child-snacks' ? 0 : null },
    records, orphans: run.responses.flatMap((response, responseIndex) => profileCounts.has(response.residentId) ? [] : [{ responseIndex, residentId: response.residentId, sourceStatus: response.status }]),
    summary: { notStarted: records.filter(record => record.state === 'not-started').length, structureBlocked: records.filter(record => record.state === 'structure-blocked').length,
      checked: records.filter(record => record.state === 'checked').length, unknown: records.filter(record => record.state === 'unknown').length,
      logic: countEvaluations('logic'), qualification: countEvaluations('qualification'), individuallyPassed,
      acceptedAgainstPlanned: completeDenominator ? individuallyPassed : null,
      content: { informationInsufficient: records.filter(record => record.content.status === 'information-insufficient').length,
        scenarioInformationPresent: records.filter(record => record.content.status === 'scenario-information-present').length,
        notEvaluated: records.filter(record => record.content.status === 'not-evaluated').length } },
    timing: { recordedExecutionMs: run.durationMs, recordedTimingBasis: run.timingBasis ?? null,
      interpretation: 'executeSurvey计时含构建画像、模型等待、运行内统计/诊断和此前checkpoint等待；不含返回后的审计、最后持久化、导出或渲染。此新审计耗时未计入旧durationMs。' },
    marketResearchValidated: false as const, personaContributionValidated: false as const,
    scope: '独立新版只读诊断；checked表示已评估而非通过。不补分、不修raw、不升级历史valid或失败，不认证真人身份、偏好、市场率或选址。' };
}
export type BusinessResearchDiagnostics = ReturnType<typeof diagnoseBusinessResearchRun>;
