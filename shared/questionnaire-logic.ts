import { z } from 'zod';
import { fingerprint } from './evidence';
import type { ResearchTask } from './research-schema';
import { validateAnswers, type Answer } from './survey-engine';

export const QUESTIONNAIRE_LOGIC_VERIFIER_VERSION = 'explicit-questionnaire-logic-1.1';

const id = z.string().trim().min(1).max(80);
// Check whitespace-only values without normalizing frozen rule/answer text.
const nonemptyText = z.string().refine(value => value.trim().length > 0, '规则文本值不能为空或只有空白。');
const answerValue = z.union([nonemptyText, z.array(nonemptyText), z.number().finite(), z.null()]);
export const questionnaireLogicRuleSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('exclusive-options'), questionId: id, exclusiveOptionIds: z.array(id).min(1).max(30) }).strict(),
  z.object({ id, kind: z.literal('conditional-equals'), whenQuestionId: id, whenValue: answerValue, thenQuestionId: id, thenValue: answerValue }).strict(),
  z.object({ id, kind: z.literal('conditional-excludes'), whenQuestionId: id, whenValue: answerValue, thenQuestionId: id, excludedOptionIds: z.array(id).min(1).max(30) }).strict(),
]);
export type QuestionnaireLogicRule = z.infer<typeof questionnaireLogicRuleSchema>;

/** Explicit, local rules only: no language/model inference and no change to survey-engine's coherence metric. */
export function validateQuestionnaireLogicRules(task: ResearchTask, input: unknown): QuestionnaireLogicRule[] {
  const rules = z.array(questionnaireLogicRuleSchema).max(100).parse(input);
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('跨题规则ID不能重复。');
  const question = (questionId: string) => {
    const found = task.questionnaire.questions.find(item => item.id === questionId);
    if (!found) throw new Error(`跨题规则引用不存在的题目：${questionId}`);
    return found;
  };
  const supports = (questionId: string, value: Answer['value']) => {
    const item = question(questionId);
    if (value === null) return !item.required;
    if (item.type === 'single') return typeof value === 'string' && item.options.some(option => option.id === value);
    if (item.type === 'multiple') return Array.isArray(value) && value.length >= item.minSelections && value.length <= item.maxSelections && new Set(value).size === value.length && value.every(id => item.options.some(option => option.id === id));
    if (item.type === 'number' || item.type === 'scale') return typeof value === 'number' && value >= item.min && value <= item.max && (item.type !== 'scale' || Number.isInteger(value));
    return typeof value === 'string' && value.length > 0 && value.length <= item.maxLength;
  };
  for (const rule of rules) {
    if (rule.kind === 'exclusive-options') {
      const item = question(rule.questionId);
      if (item.type !== 'multiple' || new Set(rule.exclusiveOptionIds).size !== rule.exclusiveOptionIds.length || rule.exclusiveOptionIds.some(id => !item.options.some(option => option.id === id))) throw new Error(`互斥规则须引用多选题的唯一有效选项：${rule.id}`);
    } else {
      if (!supports(rule.whenQuestionId, rule.whenValue)) throw new Error(`条件规则前件不符合题目契约：${rule.id}`);
      if (rule.kind === 'conditional-equals') {
        if (!supports(rule.thenQuestionId, rule.thenValue)) throw new Error(`条件规则后件不符合题目契约：${rule.id}`);
      } else {
        const item = question(rule.thenQuestionId);
        if (!('options' in item) || new Set(rule.excludedOptionIds).size !== rule.excludedOptionIds.length || rule.excludedOptionIds.some(id => !item.options.some(option => option.id === id))) throw new Error(`排除规则须引用唯一有效选项：${rule.id}`);
      }
    }
  }
  return rules;
}

export function checkQuestionnaireLogic(task: ResearchTask, answers: Answer[], inputRules: unknown) {
  const rules = validateQuestionnaireLogicRules(task, inputRules);
  const issues: { ruleId: string; questionId: string; message: string }[] = [];
  let answerStructureValid = false;
  try {
    validateAnswers(task, 'logic-check', JSON.stringify({ residentId: 'logic-check', answers }));
    answerStructureValid = true;
  } catch (error) {
    issues.push({ ruleId: 'answer-structure', questionId: 'questionnaire', message: `答题结构无法复核：${(error as Error).message}` });
  }
  const values = new Map((answerStructureValid ? answers : []).map(answer => [answer.questionId, answer.value]));
  const equal = (left: Answer['value'] | undefined, right: Answer['value']) => Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every(item => right.includes(item)) : left === right;
  let checked = 0; let skipped = 0;
  for (const rule of rules) {
    if (!answerStructureValid) { skipped++; continue; }
    if (rule.kind === 'exclusive-options') {
      const value = values.get(rule.questionId);
      if (value === undefined || value === null) { skipped++; continue; }
      checked++;
      if (!Array.isArray(value) || value.length > 1 && rule.exclusiveOptionIds.some(id => value.includes(id))) issues.push({ ruleId: rule.id, questionId: rule.questionId, message: '“无/未知”等排他选项不能与其他选择同时出现。' });
    } else {
      if (!equal(values.get(rule.whenQuestionId), rule.whenValue)) { skipped++; continue; }
      checked++;
      const value = values.get(rule.thenQuestionId);
      if (rule.kind === 'conditional-equals' ? !equal(value, rule.thenValue) : Array.isArray(value) ? value.some(id => rule.excludedOptionIds.includes(id)) : typeof value === 'string' && rule.excludedOptionIds.includes(value)) issues.push({ ruleId: rule.id, questionId: rule.thenQuestionId, message: '回答违反显式登记的跨题条件；保留原文，不自动修正。' });
    }
  }
  return { schemaVersion: '1.0' as const, verifierVersion: QUESTIONNAIRE_LOGIC_VERIFIER_VERSION,
    status: !rules.length ? 'not-evaluated' as const : issues.length ? 'conflict' as const : checked === 0 ? 'not-evaluated' as const : 'checked' as const,
    answerStructureValid, rulesHash: fingerprint(rules), registered: rules.length, checked, skipped, issues,
    scope: '仅检查另册登记的互斥/条件规则；不是通用语义理解、人格效度或真实模型质量，不升级survey.metrics.valid。' };
}

export type QuestionnaireLogicReport = ReturnType<typeof checkQuestionnaireLogic>;
