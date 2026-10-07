import { fingerprint } from './evidence';
import { researchTaskSchema, type ResearchTask } from './research-schema';
import type { Answer } from './survey-engine';
import { validateQuestionnaireLogicRules, type QuestionnaireLogicRule } from './questionnaire-logic';

/** New wire shape, deliberately separate from historical array-answer evidence. */
export const ANSWER_CONTRACT_VERSION = 'resident-answer-object-1.0';
type Schema = Record<string, unknown>;
export interface AnswerContract {
  version: typeof ANSWER_CONTRACT_VERSION;
  residentId: string;
  task: ResearchTask;
  rules: QuestionnaireLogicRule[];
  taskHash: string;
  rulesHash: string;
  schema: Schema;
  schemaHash: string;
}

export function compileAnswerContract(taskInput: ResearchTask, residentId: string, ruleInput: unknown = []): AnswerContract {
  const task = researchTaskSchema.parse(taskInput);
  if (!residentId.trim() || residentId.length > 2000) throw new Error('答卷契约需要明确的居民ID。');
  const rules = validateQuestionnaireLogicRules(task, ruleInput);
  const properties: Record<string, Schema> = Object.create(null);
  for (const question of task.questionnaire.questions) {
    let value: Schema;
    if (question.type === 'single') value = { type: 'string', enum: question.options.map(option => option.id) };
    else if (question.type === 'multiple') {
      const exclusive = [...new Set(rules.flatMap(rule => rule.kind === 'exclusive-options' && rule.questionId === question.id ? rule.exclusiveOptionIds : []))];
      value = { type: 'array', items: { type: 'string', enum: question.options.map(option => option.id) },
        minItems: question.minSelections, maxItems: question.maxSelections, uniqueItems: true,
        // Provider support for these JSON Schema keywords is a separately tested capability.
        ...(exclusive.length ? { not: { minItems: 2, contains: { enum: exclusive } } } : {}) };
    } else if (question.type === 'scale' || question.type === 'number') value = { type: question.type === 'scale' ? 'integer' : 'number', minimum: question.min, maximum: question.max };
    else value = { type: 'string', minLength: 1, maxLength: question.maxLength, pattern: '\\S' };
    properties[question.id] = question.required ? value : { anyOf: [value, { type: 'null' }] };
  }
  const schema = { type: 'object', additionalProperties: false, required: ['residentId', 'answers'], properties: {
    residentId: { type: 'string', enum: [residentId] },
    answers: { type: 'object', additionalProperties: false, required: task.questionnaire.questions.map(question => question.id), properties },
  } };
  return { version: ANSWER_CONTRACT_VERSION, residentId, task, rules, taskHash: fingerprint(task), rulesHash: fingerprint(rules), schema, schemaHash: fingerprint(schema) };
}

/** JSON.parse silently overwrites duplicate keys. Reject them, including escaped aliases. */
function parseUniqueJson(raw: string): unknown {
  if (new TextEncoder().encode(raw).length > 512_000) throw new Error('答卷超过512KB。');
  const parsed: unknown = JSON.parse(raw);
  let index = 0;
  const space = () => { while (/\s/.test(raw[index] ?? '') && index < raw.length) index++; };
  const string = () => {
    const start = index++;
    while (index < raw.length) {
      const character = raw[index++];
      if (character === '\\') index++;
      else if (character === '"') return JSON.parse(raw.slice(start, index)) as string;
    }
    throw new Error('JSON字符串未终止。');
  };
  const visit = (depth: number): void => {
    if (depth > 64) throw new Error('JSON嵌套超过64层。');
    space();
    if (raw[index] === '{') {
      index++; space(); const keys = new Set<string>();
      if (raw[index] === '}') { index++; return; }
      do {
        space(); const key = string();
        if (keys.has(key)) throw new Error(`JSON属性重复：${key}`);
        keys.add(key); space(); index++; visit(depth + 1); space();
        if (raw[index] === '}') { index++; return; }
        index++;
      } while (index < raw.length);
    } else if (raw[index] === '[') {
      index++; space(); if (raw[index] === ']') { index++; return; }
      do { visit(depth + 1); space(); if (raw[index] === ']') { index++; return; } index++; } while (index < raw.length);
    } else if (raw[index] === '"') string();
    else { while (index < raw.length && !/[\s,}\]]/.test(raw[index])) index++; }
  };
  visit(0);
  return parsed;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Exact IDs and explicit nulls; no answer repair, coercion, trimming or fallback. */
export function decodeAnswerContract(contract: AnswerContract, raw: string): Answer[] {
  if (contract.version !== ANSWER_CONTRACT_VERSION || fingerprint(contract.task) !== contract.taskHash || fingerprint(contract.rules) !== contract.rulesHash
    || fingerprint(contract.schema) !== contract.schemaHash) throw new Error('冻结答卷契约已漂移。');
  const expected = compileAnswerContract(contract.task, contract.residentId, contract.rules);
  if (expected.schemaHash !== contract.schemaHash) throw new Error('schema与问卷/居民ID不一致。');
  const envelope = parseUniqueJson(raw);
  if (!object(envelope) || Object.keys(envelope).length !== 2 || !Object.hasOwn(envelope, 'residentId') || !Object.hasOwn(envelope, 'answers')
    || envelope.residentId !== contract.residentId || !object(envelope.answers)) throw new Error('答卷根结构或居民ID不符合新契约。');
  const values = envelope.answers;
  const ids = contract.task.questionnaire.questions.map(question => question.id);
  if (Object.keys(values).length !== ids.length || ids.some(id => !Object.hasOwn(values, id))) throw new Error('全部题目必须显式返回；可选未知用null，不允许漏题或增题。');
  const answers: Answer[] = contract.task.questionnaire.questions.map(question => {
    const value = values[question.id];
    if (value === null && !question.required) return { questionId: question.id, value: null };
    const valid = question.type === 'single' ? typeof value === 'string' && question.options.some(option => option.id === value)
      : question.type === 'multiple' ? Array.isArray(value) && new Set(value).size === value.length && value.length >= question.minSelections && value.length <= question.maxSelections && value.every(id => typeof id === 'string' && question.options.some(option => option.id === id))
      : question.type === 'scale' || question.type === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= question.min && value <= question.max && (question.type !== 'scale' || Number.isInteger(value))
      : typeof value === 'string' && value.trim().length > 0 && [...value].length <= question.maxLength;
    if (!valid) throw new Error(`答卷值违反新契约：${question.id}`);
    return { questionId: question.id, value: value as Answer['value'] };
  });
  for (const rule of contract.rules) {
    if (rule.kind !== 'exclusive-options') continue;
    const value = answers.find(answer => answer.questionId === rule.questionId)!.value;
    if (Array.isArray(value) && value.length > 1 && value.some(id => rule.exclusiveOptionIds.includes(id))) throw new Error(`排他多选违反契约：${rule.questionId}`);
  }
  return answers;
}

/** Migration helper is explicit; never used to silently relabel historical raw evidence. */
export function encodeAnswerContract(residentId: string, answers: Answer[]): string {
  if (new Set(answers.map(answer => answer.questionId)).size !== answers.length) throw new Error('不能编码重复题目ID。');
  return JSON.stringify({ residentId, answers: Object.fromEntries(answers.map(answer => [answer.questionId, answer.value])) });
}
