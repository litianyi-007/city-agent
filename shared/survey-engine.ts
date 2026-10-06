import { z } from 'zod';
import { fingerprint } from './evidence';
export { fingerprint } from './evidence';
import { researchTaskSchema, type ResearchTask } from './research-schema';
import type { CompiledPopulation } from '../server/population/model';
import type { ResidentAgentPublic } from '../server/research/residents';
import type { RegionPack, auditPack } from '../server/population/model';
import type { SurveyAnalysis, samplingReport } from './survey-analysis';

export const SURVEY_VERSION = 'coverage-survey-2.0';
export const RESIDENT_SYSTEM_PROMPT = `你是虚拟受访者。只代表本次给定的合成画像回答问卷，不代表滨江真人。
画像中人口归属为统计约束，细分年龄、职业、家庭和资格为显式假设；未知信息可回答不确定，不编造外部事实。
不能读取其他受访者回答。不得把年龄、性别或街道直接等同于收入、人格或商品偏好。
请仅输出JSON：{"residentId":"给定ID","answers":[{"questionId":"给定题目ID","value":答案}]}。
单选用选项ID，多选用不重复选项ID数组，量表用整数，数值用有限数值，开放题用字符串；遵守题目范围和选项数。
回答全部必答题，保留题目ID，不改变问卷，不输出Markdown。`;
type Scalar = string | number | boolean;
export interface Profile {
  id: string; presetId: string; presetName: string;
  street: string; streetName: string; ageBand: string; sex: string; age: number;
  attributes: { key: string; value: Scalar; provenance: 'infer' | 'assumption'; evidenceIds: string[] }[];
  description: string; assumptions: string[]; behaviorNotes: string;
}
export interface Answer { questionId: string; value: string | string[] | number | null }
export interface ResponseRecord {
  residentId: string; status: 'valid' | 'invalid' | 'failed' | 'not-started'; answers: Answer[];
  raw: string; error?: string; durationMs: number; inputTokens: number | null; outputTokens: number | null;
  structureValid?: boolean; coherence?: ReturnType<typeof checkCoherence>;
}
function rng(seed: number) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
function matches(value: Scalar | undefined, filter: ResearchTask['population']['filters'][number]) {
  if (filter.op === 'eq') return value === filter.value;
  if (filter.op === 'in') return filter.values.includes(value as Scalar);
  if (typeof value !== 'number') return false;
  if (filter.op === 'gte') return value >= filter.value;
  if (filter.op === 'lte') return value <= filter.value;
  return filter.op === 'between' && value >= filter.min && value <= filter.max;
}

/** Coverage sampling for engineering experiments, deliberately without population weights. */
export function buildProfiles(taskInput: ResearchTask, model: CompiledPopulation, presets: ResidentAgentPublic[], count: number, seed: number): Profile[] {
  const task = researchTaskSchema.parse(taskInput);
  if (!Number.isInteger(count) || count < 1 || count > 30 || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('样本数须为1–30，seed须为0–2147483647的整数。');
  if (!presets.length || presets.some(preset => !preset.enabled)) throw new Error('请选择已启用的人群预设。');
  if (count < presets.length) throw new Error('受访者数不得少于所选预设数，否则部分预设没有样本。');
  if (task.population.regionCode !== model.region.code || task.population.period !== model.period || task.population.unit !== 'person') throw new Error('当前执行只支持登记滨江历史个人框。');
  if (task.requestedOutputs.some(value => ['site-recommendation', 'market-forecast', 'deploy', 'backend-service'].includes(value))) throw new Error('当前问卷执行不支持真实选址、预测、部署或后端服务输出。');
  const random = rng(seed);
  const plans = presets.map(preset => {
    if (preset.population.regionCode !== task.population.regionCode || preset.population.period !== task.population.period || preset.population.unit !== 'person') throw new Error('人群预设与问卷统计框不一致。');
    const filters = [...task.population.filters, ...preset.population.filters];
    const draw = (cell: CompiledPopulation['cells'][number]) => {
      const band = model.ageBands.find(item => item.id === cell.ageBand)!;
      // 60+ has no public upper limit. A finite generation limit is an explicit scenario assumption.
      let minAge = band.minAge; let maxAge = band.maxAge ?? 90;
      for (const filter of filters.filter(filter => filter.field === 'age')) {
        if (filter.op === 'gte') minAge = Math.max(minAge, filter.value);
        if (filter.op === 'lte') maxAge = Math.min(maxAge, filter.value);
        if (filter.op === 'between') { minAge = Math.max(minAge, filter.min); maxAge = Math.min(maxAge, filter.max); }
      }
      if (minAge > maxAge) return null;
      const base: Record<string, Scalar> = { street: cell.areaCode, ageBand: cell.ageBand, sex: cell.sex };
      for (let attempt = 0; attempt < 200; attempt++) {
        const attributes: Record<string, Scalar> = { ...base, age: Math.ceil(minAge) + Math.floor(random() * (Math.floor(maxAge) - Math.ceil(minAge) + 1)) };
        for (const filter of filters) {
          if (['street', 'ageBand', 'sex', 'age'].includes(filter.field)) continue;
          const value = filter.op === 'eq' ? filter.value : filter.op === 'in' ? filter.values[Math.floor(random() * filter.values.length)] : filter.op === 'between' ? filter.min : filter.value;
          if (!(filter.field in attributes)) (attributes as Record<string, Scalar>)[filter.field] = value;
        }
        if (filters.every(filter => matches((attributes as Record<string, Scalar>)[filter.field], filter))) return attributes;
      }
      return null;
    };
    const candidates = model.cells.filter(cell => cell.eligible && cell.population > 0 && draw(cell) !== null);
    if (!candidates.length) throw new Error(`预设“${preset.name}”的条件交集为空或无法形成合成画像。`);
    return { preset, candidates, draw };
  });
  const cellCounts = new Map<string, number>(); const streetCounts = new Map<string, number>(); const seen = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const plan = plans[index % plans.length];
    const ranked = plan.candidates.map(cell => ({ cell, tie: random() })).sort((a, b) =>
      (cellCounts.get(a.cell.id) ?? 0) - (cellCounts.get(b.cell.id) ?? 0) || (streetCounts.get(a.cell.areaCode) ?? 0) - (streetCounts.get(b.cell.areaCode) ?? 0) || a.tie - b.tie);
    const cell = ranked[0].cell;
    let attributes = plan.draw(cell)!;
    for (let attempt = 0; attempt < 100 && seen.has(fingerprint({ attributes, description: plan.preset.description, behaviorNotes: plan.preset.behaviorNotes })); attempt++) attributes = plan.draw(cell)!;
    seen.add(fingerprint({ attributes, description: plan.preset.description, behaviorNotes: plan.preset.behaviorNotes }));
    cellCounts.set(cell.id, (cellCounts.get(cell.id) ?? 0) + 1); streetCounts.set(cell.areaCode, (streetCounts.get(cell.areaCode) ?? 0) + 1);
    const { street, ageBand, sex, age } = attributes;
    return { id: `resident-${String(index + 1).padStart(3, '0')}`, presetId: plan.preset.id, presetName: plan.preset.name,
      street: String(street), streetName: model.areas.find(area => area.code === street)!.name, ageBand: String(ageBand), sex: String(sex), age: Number(age),
      attributes: Object.entries(attributes).map(([key, value]) => ({ key, value, provenance: ['street', 'ageBand', 'sex'].includes(key) ? 'infer' as const : 'assumption' as const, evidenceIds: ['street', 'ageBand', 'sex'].includes(key) ? cell.evidenceIds : [] })),
      description: plan.preset.description,
      assumptions: [...plan.preset.assumptions, '画像说明与行为均为用户情景假设，不是人口事实；与明确年龄/街道冲突时以结构化画像为准。', '具体年龄为年龄档内的情景赋值；60+生成上限90岁不是人口事实。', '覆盖抽样无人口权重；预设资格不能赋予总体代表性。'], behaviorNotes: plan.preset.behaviorNotes };
  });
}
export function residentPrompt(task: ResearchTask, profile: Profile, exposure: 'full' | 'no-persona' | 'demographics-only' = 'full') {
  const resident = exposure === 'full' ? profile : exposure === 'no-persona' ? { id: profile.id } : { id: profile.id, street: profile.street, streetName: profile.streetName, age: profile.age, ageBand: profile.ageBand, sex: profile.sex };
  return JSON.stringify({ schemaVersion: '1.0', exposure, resident, decisionContext: task.decisionContext, questionnaire: task.questionnaire });
}
export function checkCoherence(task: ResearchTask, profile: Profile, answers: Answer[]) {
  const issues: { ruleId: string; questionId: string; severity: 'error' | 'unknown'; message: string }[] = []; let checked = 0;
  for (const rule of task.validationRules ?? []) {
    const answer = answers.find(item => item.questionId === rule.questionId);
    const choice = rule.choices.find(item => item.optionId === answer?.value);
    if (!answer || answer.value === null) continue;
    if (!choice || choice.unknown) { issues.push({ ruleId: rule.id, questionId: rule.questionId, severity: 'unknown', message: '选项未声明可检查的画像约束或回答不确定。' }); continue; }
    checked++;
    const value = profile[rule.field];
    if (choice.equals !== undefined && value !== choice.equals || choice.min !== undefined && (typeof value !== 'number' || value < choice.min) || choice.max !== undefined && (typeof value !== 'number' || value > choice.max)) issues.push({ ruleId: rule.id, questionId: rule.questionId, severity: 'error', message: `回答与画像 ${rule.field}=${value} 矛盾。` });
  }
  return { status: !(task.validationRules?.length) ? 'not-configured' : issues.some(issue => issue.severity === 'error') ? 'contradiction' : issues.length ? 'partial' : 'checked', checked, issues, scope: '仅执行问卷JSON预登记的硬约束；不自动理解职业、家庭或开放题语义，不以消费刻板印象判错。' };
}
const answerEnvelope = z.object({ residentId: z.string(), answers: z.array(z.object({ questionId: z.string(), value: z.union([z.string(), z.array(z.string()), z.number().finite(), z.null()]) }).strict()).max(50) }).strict();
export function validateAnswers(task: ResearchTask, profileId: string, raw: string): Answer[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const result = answerEnvelope.parse(JSON.parse(trimmed));
  if (result.residentId !== profileId || new Set(result.answers.map(answer => answer.questionId)).size !== result.answers.length) throw new Error('答卷居民ID错误或题目ID重复。');
  const questions = new Map(task.questionnaire.questions.map(question => [question.id, question]));
  if (result.answers.some(answer => !questions.has(answer.questionId))) throw new Error('答卷包含未知题目。');
  for (const question of task.questionnaire.questions) {
    const answer = result.answers.find(answer => answer.questionId === question.id);
    if (!answer || answer.value === null) { if (question.required) throw new Error(`必答题缺失：${question.id}`); continue; }
    const value = answer.value;
    const valid = question.type === 'single' ? typeof value === 'string' && question.options.some(option => option.id === value)
      : question.type === 'multiple' ? Array.isArray(value) && new Set(value).size === value.length && value.length >= question.minSelections && value.length <= question.maxSelections && value.every(id => question.options.some(option => option.id === id))
      : question.type === 'scale' ? typeof value === 'number' && Number.isInteger(value) && value >= question.min && value <= question.max
      : question.type === 'number' ? typeof value === 'number' && value >= question.min && value <= question.max
      : typeof value === 'string' && value.length > 0 && value.length <= question.maxLength;
    if (!valid) throw new Error(`答卷值违反题目契约：${question.id}`);
  }
  return result.answers;
}
export function fixtureAnswers(task: ResearchTask, profile: Profile, seed: number): string {
  const random = rng(seed + Number(profile.id.split('-').at(-1)) * 997);
  return JSON.stringify({ residentId: profile.id, answers: task.questionnaire.questions.map(question => {
    let value: Answer['value'];
    if (question.type === 'single') {
      let index = Math.floor(random() * question.options.length);
      if (question.id === 'street') index = ['xixing', 'changhe', 'puyan'].indexOf(profile.street);
      if (question.id === 'age-range') index = profile.age < 18 ? 1 : profile.age < 30 ? 2 : profile.age < 45 ? 3 : profile.age < 60 ? 4 : 5;
      value = question.options[Math.max(0, Math.min(index, question.options.length - 1))].id;
    } else if (question.type === 'multiple') {
      const ids = question.options.map(option => ({ id: option.id, order: random() })).sort((a, b) => a.order - b.order).map(option => option.id);
      value = ids.slice(0, question.minSelections + Math.floor(random() * (question.maxSelections - question.minSelections + 1)));
    } else if (question.type === 'scale') value = question.min + Math.floor(random() * (question.max - question.min + 1));
    else if (question.type === 'number') value = Math.min(question.max, Math.max(question.min, Math.round((question.min + random() * (question.max - question.min)) * 100) / 100));
    else value = '工程演示答卷：此文本验证开放题保留与回查，不表达真实消费偏好。'.slice(0, question.maxLength);
    return { questionId: question.id, value };
  }) });
}
export function summarize(task: ResearchTask, records: ResponseRecord[]) {
  const valid = records.filter(record => record.status === 'valid');
  return task.questionnaire.questions.map(question => {
    const values = valid.map(record => record.answers.find(answer => answer.questionId === question.id)?.value).filter(value => value !== undefined && value !== null);
    const denominator = values.length;
    const choices = 'options' in question ? question.options.map(option => ({ id: option.id, label: option.label,
      count: values.filter(value => Array.isArray(value) ? value.includes(option.id) : value === option.id).length })) : undefined;
    const numbers = values.filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
    return { questionId: question.id, prompt: question.prompt, type: question.type, denominator, missing: records.length - denominator,
      ...(choices ? { choices } : {}), ...(numbers.length ? { mean: numbers.reduce((a, b) => a + b, 0) / numbers.length, median: numbers.length % 2 ? numbers[Math.floor(numbers.length / 2)] : (numbers[numbers.length / 2 - 1] + numbers[numbers.length / 2]) / 2, unit: question.type === 'number' ? question.unit : '分' } : {}) };
  });
}
export interface SurveyRun {
  id: string; version: string; mode: 'fixture' | 'live'; startedAt: string; durationMs: number;
  task: ResearchTask; taskHash: string; populationHash: string; seed: number;
  profiles: Profile[]; profileHash: string; responses: ResponseRecord[];
  summaries: ReturnType<typeof summarize>; models: { presetId: string; provider: string; baseUrl: string; modelId: string }[];
  prompt: { system: string; systemHash: string; users: { residentId: string; text: string; hash: string }[] };
  metrics: { planned: number; valid: number; failed: number; notStarted: number; modelCalls: number; inputTokens: number | null; outputTokens: number | null; apiCostCny: number | null; pricingBasis: string; structurallyValid?: number; contradictions?: number };
  limitations: string[]; marketResearchValidated: false;
  state?: 'running' | 'completed' | 'cancelled' | 'stopped'; hashAlgorithm?: string;
  populationSnapshot?: RegionPack; populationAudit?: ReturnType<typeof auditPack>;
  pricing?: { currency: 'CNY'; inputPerMillion: number | null; outputPerMillion: number | null; suppliedAt: string; source: string };
  timingBasis?: string; parameters?: { maxOutputTokens: number; timeoutMs: number; retries: number; concurrency: number; temperature: null; providerSeed: null; answerCache: false; reasoning?: string };
  presetSnapshots?: Omit<ResidentAgentPublic, 'hasApiKey'>[];
  sampling?: ReturnType<typeof samplingReport>; analysis?: SurveyAnalysis;
  exposure?: 'full' | 'no-persona' | 'demographics-only'; experiment?: { id: string; arm: string };
}
