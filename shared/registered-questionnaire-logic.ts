import { fingerprint } from './evidence';
import { QUESTIONNAIRE_LOGIC_VERIFIER_VERSION, validateQuestionnaireLogicRules, type QuestionnaireLogicRule } from './questionnaire-logic';
import type { ResearchTask } from './research-schema';
import { fixtureAnswers, type Answer, type Profile, type SurveyLogicAudit, type SurveyLogicReport } from './survey-engine';

export type RegisteredBusinessScenario = 'child-snacks' | 'pet-snacks';

/** The same rules the business demo freezes. A task that no longer satisfies them is not silently rewritten. */
export function buildBusinessLogicRules(id: RegisteredBusinessScenario): QuestionnaireLogicRule[] {
  const multipleIds = id === 'child-snacks'
    ? ['purchase-role', 'past-categories', 'permission-factors', 'planned-channels', 'reachable-streets', 'purchase-barriers']
    : ['purchase-role', 'past-snack-categories', 'planned-channels', 'reachable-streets', 'purchase-barriers'];
  const rules: QuestionnaireLogicRule[] = multipleIds.map(questionId => ({ id: `${questionId}-exclusive`, kind: 'exclusive-options', questionId,
    exclusiveOptionIds: questionId === 'reachable-streets' ? ['unknown'] : ['none', 'unknown'] }));
  const then = (suffix: string, whenQuestionId: string, whenValue: Answer['value'], thenQuestionId: string, thenValue: Answer['value']) => rules.push({
    id: suffix, kind: 'conditional-equals', whenQuestionId, whenValue, thenQuestionId, thenValue,
  });
  then('no-purchase-zero-budget', 'purchase-intent', 'no', 'monthly-budget', 0);
  then('unknown-intent-unknown-budget', 'purchase-intent', 'unknown', 'monthly-budget', null);
  then('no-purchase-no-package', 'purchase-intent', 'no', 'package-size', 'none');
  then('no-purchase-no-channel', 'purchase-intent', 'no', 'planned-channels', ['none']);
  then('no-purchase-travel-not-applicable', 'purchase-intent', 'no', 'travel-minutes', null);
  then('no-purchase-no-price', 'purchase-intent', 'no', id === 'child-snacks' ? 'price-per20g' : 'price-per50g', 'none');
  then('zero-past-frequency-no-past-categories', 'past-frequency', 'none', id === 'child-snacks' ? 'past-categories' : 'past-snack-categories', ['none']);
  if (id === 'child-snacks') {
    for (const value of ['not-collected', 'proxy-unverified', 'unknown']) then(`child-no-direct-taste-${value}`, 'child-evidence', value, 'child-own-taste', null);
    then('no-permission-traceability-not-applicable', 'purchase-role', ['none'], 'traceability-importance', null);
  } else {
    then('no-purchase-no-online-handoff', 'purchase-intent', 'no', 'online-handoff', 'none');
    then('delivery-only-travel-not-applicable', 'online-handoff', 'delivery', 'travel-minutes', null);
    then('no-purchase-no-price10-intent', 'purchase-intent', 'no', 'price10-intent', 'no');
    then('no-purchase-no-price20-intent', 'purchase-intent', 'no', 'price20-intent', 'no');
    rules.push({ id: 'cat-only-no-dog-product', kind: 'conditional-excludes', whenQuestionId: 'pet-type', whenValue: 'cat', thenQuestionId: 'past-snack-categories', excludedOptionIds: ['dog-chew'] },
      { id: 'dog-only-no-cat-product', kind: 'conditional-excludes', whenQuestionId: 'pet-type', whenValue: 'dog', thenQuestionId: 'past-snack-categories', excludedOptionIds: ['cat-creamy'] });
  }
  return rules;
}

export function registeredScenarioFor(task: ResearchTask): RegisteredBusinessScenario | null {
  if (task.questionnaire.id === 'business-child-q') return 'child-snacks';
  if (task.questionnaire.id === 'business-pet-q') return 'pet-snacks';
  return null;
}

export function registeredLogicRulesFor(task: ResearchTask): QuestionnaireLogicRule[] {
  const scenario = registeredScenarioFor(task);
  if (!scenario) return [];
  try { return validateQuestionnaireLogicRules(task, buildBusinessLogicRules(scenario)); }
  catch { return []; }
}

const sameAnswer = (left: Answer['value'] | undefined, right: Answer['value']) => Array.isArray(left) && Array.isArray(right)
  ? left.length === right.length && left.every(item => right.includes(item)) : left === right;

function repairExcludedSelection(task: ResearchTask, questionId: string, value: Answer['value'], excluded: readonly string[]): Answer['value'] | undefined {
  const question = task.questionnaire.questions.find(item => item.id === questionId);
  if (!question || !('options' in question)) return undefined;
  if (Array.isArray(value)) {
    if (question.type !== 'multiple') return undefined;
    const next = value.filter(id => !excluded.includes(id));
    if (next.length === value.length) return undefined;
    const exclusive = new Set(question.options.filter(option => option.id === 'none' || option.id === 'unknown').map(option => option.id));
    for (const option of question.options) {
      if (next.length >= question.minSelections) break;
      if (excluded.includes(option.id) || exclusive.has(option.id) || next.includes(option.id)) continue;
      next.push(option.id);
    }
    let repaired = next;
    if (repaired.length < question.minSelections) {
      const solo = question.options.find(option => !excluded.includes(option.id));
      repaired = solo ? [solo.id] : repaired;
    }
    if (repaired.length > 1 && repaired.some(id => exclusive.has(id))) repaired = [repaired.find(id => exclusive.has(id))!];
    return repaired.slice(0, question.maxSelections);
  }
  if (typeof value === 'string' && excluded.includes(value)) return question.options.find(option => !excluded.includes(option.id))?.id;
  return undefined;
}

/** Default 工程演示 answers already obey the registered cross-question rules. Injected fixture responses are not rewritten. */
export function registeredFixtureAnswers(task: ResearchTask, profile: Profile, seed: number): string {
  const raw = fixtureAnswers(task, profile, seed);
  const rules = registeredLogicRulesFor(task);
  if (!rules.length) return raw;
  const parsed = JSON.parse(raw) as { residentId: string; answers: Answer[] };
  const byId = new Map(parsed.answers.map(answer => [answer.questionId, answer]));
  let changed = false;
  for (let pass = 0; pass < 8; pass++) {
    let passChanged = false;
    for (const rule of rules) {
      if (rule.kind === 'exclusive-options') {
        const answer = byId.get(rule.questionId);
        const value = answer?.value;
        if (!Array.isArray(value) || value.length < 2 || !rule.exclusiveOptionIds.some(id => value.includes(id))) continue;
        const kept = value.find(id => rule.exclusiveOptionIds.includes(id));
        if (!kept || !answer) continue;
        answer.value = [kept];
        passChanged = true;
      } else if (!sameAnswer(byId.get(rule.whenQuestionId)?.value, rule.whenValue)) continue;
      else if (rule.kind === 'conditional-equals') {
        const answer = byId.get(rule.thenQuestionId);
        if (!answer || sameAnswer(answer.value, rule.thenValue)) continue;
        answer.value = Array.isArray(rule.thenValue) ? [...rule.thenValue] : rule.thenValue;
        passChanged = true;
      } else {
        const answer = byId.get(rule.thenQuestionId);
        if (!answer) continue;
        const repaired = repairExcludedSelection(task, rule.thenQuestionId, answer.value, rule.excludedOptionIds);
        if (repaired === undefined || sameAnswer(answer.value, repaired)) continue;
        answer.value = repaired;
        passChanged = true;
      }
    }
    changed = changed || passChanged;
    if (!passChanged) break;
  }
  return changed ? JSON.stringify(parsed) : raw;
}

export function surveyLogicAudit(task: ResearchTask, responses: { residentId: string; logic?: SurveyLogicReport }[]): SurveyLogicAudit {
  const rules = registeredLogicRulesFor(task);
  const records = responses.map(response => ({
    residentId: response.residentId,
    status: response.logic?.status ?? 'not-applicable' as const,
    report: response.logic ?? null,
  }));
  const sawCheck = records.some(record => record.status === 'checked' || record.status === 'conflict');
  return {
    schemaVersion: '1.0', verifierVersion: QUESTIONNAIRE_LOGIC_VERIFIER_VERSION,
    status: !rules.length || !sawCheck ? 'not-evaluated' : records.some(record => record.status === 'conflict') ? 'conflict' : 'checked',
    rules, rulesHash: fingerprint(rules), registered: rules.length, records,
  };
}
