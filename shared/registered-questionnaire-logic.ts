import { fingerprint } from './evidence';
import { QUESTIONNAIRE_LOGIC_VERIFIER_VERSION, validateQuestionnaireLogicRules, type QuestionnaireLogicRule } from './questionnaire-logic';
import type { ResearchTask } from './research-schema';
import type { SurveyLogicAudit, SurveyLogicReport } from './survey-engine';
import type { Answer } from './survey-engine';

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
