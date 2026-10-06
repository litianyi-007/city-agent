import { z } from 'zod';

const id = z.string().trim().min(1).max(80);
const scalar = z.union([z.string().trim().min(1).max(200), z.number().finite().min(-1e9).max(1e9), z.boolean()]);
const field = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/);
const filterSchema = z.discriminatedUnion('op', [
  z.object({ field, op: z.literal('eq'), value: scalar }).strict(),
  z.object({ field, op: z.literal('in'), values: z.array(scalar).min(1).max(32) }).strict(),
  z.object({ field, op: z.enum(['gte', 'lte']), value: z.number().finite().min(-1e9).max(1e9) }).strict(),
  z.object({ field, op: z.literal('between'), min: z.number().finite().min(-1e9).max(1e9), max: z.number().finite().min(-1e9).max(1e9) }).strict(),
]).superRefine((filter, ctx) => {
  if (filter.op === 'between' && filter.min > filter.max) ctx.addIssue({ code: 'custom', path: ['max'], message: '筛选下界不能大于上界' });
  if (filter.op === 'in' && new Set(filter.values.map(value => JSON.stringify(value))).size !== filter.values.length) ctx.addIssue({ code: 'custom', path: ['values'], message: '筛选值不能重复' });
});
const option = z.object({ id, label: z.string().trim().min(1).max(300) }).strict();
const questionBase = { id, prompt: z.string().trim().min(1).max(2000), required: z.boolean() };
const questionSchema = z.discriminatedUnion('type', [
  z.object({ ...questionBase, type: z.literal('single'), options: z.array(option).min(2).max(30) }).strict(),
  z.object({ ...questionBase, type: z.literal('multiple'), options: z.array(option).min(1).max(30), minSelections: z.number().int().min(0).max(30), maxSelections: z.number().int().min(1).max(30) }).strict(),
  z.object({ ...questionBase, type: z.literal('scale'), min: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100), minLabel: z.string().trim().min(1).max(200), maxLabel: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...questionBase, type: z.literal('number'), min: z.number().finite().min(-1e9).max(1e9), max: z.number().finite().min(-1e9).max(1e9), unit: z.string().trim().min(1).max(80) }).strict(),
  z.object({ ...questionBase, type: z.literal('text'), maxLength: z.number().int().min(1).max(2000) }).strict(),
]).superRefine((question, ctx) => {
  if ('options' in question && new Set(question.options.map(item => item.id)).size !== question.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: '同一题的选项 ID 必须唯一' });
  if (question.type === 'multiple' && (question.minSelections > question.maxSelections || question.maxSelections > question.options.length || (question.required && question.minSelections === 0))) ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: '多选上下界必须与选项数及必答要求一致' });
  if ((question.type === 'scale' || question.type === 'number') && question.min >= question.max) ctx.addIssue({ code: 'custom', path: ['max'], message: '题目下界必须小于上界' });
});

export const researchTaskSchema = z.object({
  schemaVersion: z.literal('1.0'), id, title: z.string().trim().min(1).max(200),
  objective: z.enum(['demand-validation', 'feature-priority', 'price-benefits', 'concept-copy', 'purchase-concerns', 'questionnaire-quality']),
  decisionContext: z.object({
    offering: z.string().trim().min(1).max(1000), buyer: z.string().trim().min(1).max(1000),
    endUser: z.string().trim().min(1).max(1000), channel: z.string().trim().min(1).max(1000),
  }).strict(),
  population: z.object({ regionCode: id, period: z.string().trim().min(1).max(80), unit: z.enum(['person', 'household']), filters: z.array(filterSchema).max(24) }).strict(),
  questionnaire: z.object({ id, version: id, questions: z.array(questionSchema).min(1).max(50) }).strict(),
  declarations: z.array(z.object({
    id, claim: z.string().trim().min(1).max(2000), provenance: z.enum(['fact', 'infer', 'assumption', 'generated']),
    sourceIds: z.array(id).max(20), observationIds: z.array(z.string().trim().min(1).max(200)).max(30),
  }).strict()).max(30),
  requestedOutputs: z.array(z.enum(['questionnaire-review', 'synthetic-analysis', 'group-comparison', 'price-comparison', 'hypothesis-report', 'site-recommendation', 'market-forecast', 'deploy', 'backend-service'])).min(1).max(9),
  validationRules: z.array(z.object({
    id, questionId: id, field: z.enum(['age', 'street', 'sex']),
    choices: z.array(z.object({ optionId: id, equals: scalar.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), unknown: z.boolean().optional() }).strict()).min(1).max(30),
  }).strict()).max(30).optional(),
  comparisons: z.array(z.object({ id, label: z.string().trim().min(1).max(300), kind: z.enum(['price', 'benefit', 'other']), baselineQuestionId: id, changedQuestionId: id }).strict()).max(10).optional(),
}).strict().superRefine((task, ctx) => {
  const unique = (values: string[], path: string[]) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path, message: 'ID 或输出项不能重复' });
  };
  unique(task.questionnaire.questions.map(question => question.id), ['questionnaire', 'questions']);
  unique(task.declarations.map(declaration => declaration.id), ['declarations']);
  unique(task.requestedOutputs, ['requestedOutputs']);
  unique((task.validationRules ?? []).map(rule => rule.id), ['validationRules']);
  unique((task.comparisons ?? []).map(item => item.id), ['comparisons']);
  for (const [index, rule] of (task.validationRules ?? []).entries()) {
    const question = task.questionnaire.questions.find(item => item.id === rule.questionId);
    if (!question || question.type !== 'single' || rule.choices.some(choice => !question.options.some(option => option.id === choice.optionId))) ctx.addIssue({ code: 'custom', path: ['validationRules', index], message: '画像规则必须引用存在的单选题和选项；编辑题目后请同步规则 JSON' });
    if (new Set(rule.choices.map(choice => choice.optionId)).size !== rule.choices.length || rule.choices.some(choice => !choice.unknown && choice.equals === undefined && choice.min === undefined && choice.max === undefined || choice.min !== undefined && choice.max !== undefined && choice.min > choice.max)) ctx.addIssue({ code: 'custom', path: ['validationRules', index], message: '画像规则的选项不能重复，且须提供有效约束或 unknown' });
  }
  for (const [index, comparison] of (task.comparisons ?? []).entries()) {
    if (comparison.baselineQuestionId === comparison.changedQuestionId || [comparison.baselineQuestionId, comparison.changedQuestionId].some(qid => task.questionnaire.questions.find(question => question.id === qid)?.type !== 'single')) ctx.addIssue({ code: 'custom', path: ['comparisons', index], message: '配对比较须引用两个不同的单选题' });
  }
  task.declarations.forEach((declaration, index) => {
    for (const key of ['sourceIds', 'observationIds'] as const) if (new Set(declaration[key]).size !== declaration[key].length) ctx.addIssue({ code: 'custom', path: ['declarations', index, key], message: '引用 ID 不能重复' });
  });
});

export type ResearchTask = z.infer<typeof researchTaskSchema>;
