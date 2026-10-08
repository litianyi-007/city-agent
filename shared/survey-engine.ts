import { z } from 'zod';
import { fingerprint } from './evidence';
export { fingerprint } from './evidence';
import { researchTaskSchema, type ResearchTask } from './research-schema';
import type { CompiledPopulation } from '../server/population/model';
import type { ResidentAgentPublic } from '../server/research/residents';
import type { RegionPack, auditPack } from '../server/population/model';
import type { SurveyAnalysis, samplingReport } from './survey-analysis';
import { residentPersonaSchema, type ResidentPersona } from './resident-persona';

export const SURVEY_VERSION = 'coverage-survey-2.2-json-contract';
export const RESIDENT_PROMPT_VERSION = 'resident-json-contract-1.1';
export const RESIDENT_SYSTEM_PROMPT = `你是虚拟受访者。只代表本次给定的合成画像回答问卷，不代表滨江真人。
输出契约版本：${RESIDENT_PROMPT_VERSION}。
画像中人口归属为统计约束，细分年龄、职业、家庭和资格为显式假设；未知信息可回答不确定，不编造外部事实。
可选五层人格、成长、教育、当前家庭、工作/收入仅为用户情景假设，不是DNA、遗传、真实测量或人口证据。未知不得补成默认中间值；不得据学历或婚姻自动推断购买意愿。
不能读取其他受访者回答。不得把年龄、性别或街道直接等同于收入、人格或商品偏好。
请仅输出JSON：{"residentId":"给定ID","answers":[{"questionId":"给定题目ID","value":答案}]}。
每题返回一个且仅一个 {"questionId":"实际题目ID","value":答案}，所有字段平铺；不能把 type、single、multiple、label 或解释作为答案包装。题型以本次问卷的 type 为准，不以选项数量猜题型。
single：value 是一个已有选项ID字符串；multiple：value 始终是不重复的已有选项ID数组，即使只选一项、未知或不购买也不能改成字符串。只有问卷确实提供这些ID时，单选未知为 "unknown"，多选未知为 ["unknown"]，多选不购买为 ["none"]；错误的多选 value:"unknown" 或 value:"none" 必须避免。题目中声明为排他的未知/不购买选项不得与其他选项一起选；遵守本题 minSelections、maxSelections 和选项数。
scale：value 是本题范围内的整数；number：value 是本题范围内的有限数字，不用带单位的字符串；text：value 是符合本题长度限制的字符串。不改变或编造选项ID。
可选题缺乏依据或没有采集时 value:null，不能写 "null"、"unknown"、0 或空字符串来伪造数值/原文。null 是未知，不等于0；只有题意和情景明确支持零值才回答0。必答题不能省略/null，使用已有未知选项时仍遵守该题型；不能凭空增加未知选项。
结构化画像已明确的照护/养宠/采购参与资格仅用于核对本情景，不能认证真人身份；不与明确画像资格自相矛盾。儿童本人口味原文未采集时必须null，不把照护者意见或人格设定当作儿童原文。
回答全部必答题，可选题也显式给value（未知为null）；保留实际居民ID和题目ID，不重复、不增题、不改变问卷，不输出Markdown或额外说明。`;
type Scalar = string | number | boolean;
const profileText = z.string().min(1).max(2000).refine(value => value.trim().length > 0, '画像标识不可为空白');
export const profileSchema = z.object({
  id: profileText, presetId: profileText, presetName: profileText,
  street: profileText, streetName: profileText, ageBand: profileText, sex: profileText,
  age: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  attributes: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    value: z.union([z.string().min(1).max(2000), z.number().finite(), z.boolean()]),
    provenance: z.enum(['infer', 'assumption']), evidenceIds: z.array(profileText).max(100),
  }).strict()).max(100),
  description: z.string().max(2000), assumptions: z.array(z.string().max(2000)).max(100), behaviorNotes: z.string().max(2000),
  persona: residentPersonaSchema.optional(),
}).strict();
export interface Profile {
  id: string; presetId: string; presetName: string;
  street: string; streetName: string; ageBand: string; sex: string; age: number;
  attributes: { key: string; value: Scalar; provenance: 'infer' | 'assumption'; evidenceIds: string[] }[];
  description: string; assumptions: string[]; behaviorNotes: string;
  persona?: ResidentPersona;
}
export interface Answer { questionId: string; value: string | string[] | number | null }
export interface ResponseRecord {
  residentId: string; status: 'valid' | 'invalid' | 'failed' | 'not-started'; answers: Answer[];
  raw: string; error?: string; durationMs: number; inputTokens: number | null; outputTokens: number | null;
  structureValid?: boolean; coherence?: ReturnType<typeof checkCoherence>;
}
function rng(seed: number) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
export function matchesPopulationFilter(value: Scalar | undefined, filter: ResearchTask['population']['filters'][number]) {
  if (filter.op === 'eq') return value === filter.value;
  if (filter.op === 'in') return filter.values.includes(value as Scalar);
  if (typeof value !== 'number') return false;
  if (filter.op === 'gte') return value >= filter.value;
  if (filter.op === 'lte') return value <= filter.value;
  return filter.op === 'between' && value >= filter.min && value <= filter.max;
}

/** Internal frozen-frame consistency only; not a certification of a real resident or qualification. */
export function validateProfileEligibility(task: ResearchTask, profile: Profile, model: CompiledPopulation, preset?: Pick<ResidentAgentPublic, 'population'>): void {
  profileSchema.parse(profile);
  const compatible = (frame: ResearchTask['population']) => frame.regionCode === model.region.code && frame.period === model.period && frame.unit === 'person';
  if (!compatible(task.population) || preset && !compatible(researchTaskSchema.shape.population.parse(preset.population))) throw new Error('画像、问卷或冻结预设的人口框不一致。');
  const area = model.areas.find(item => item.code === profile.street);
  const band = model.ageBands.find(item => item.id === profile.ageBand);
  const cell = model.cells.find(item => item.areaCode === profile.street && item.ageBand === profile.ageBand && item.sex === profile.sex);
  if (!area || profile.streetName !== area.name || !band || profile.age < band.minAge || band.maxAge !== null && profile.age > band.maxAge
    || !cell || !cell.eligible || cell.population <= 0) throw new Error('画像年龄、街道、性别或人口单元不符合冻结人口快照。');
  const attributes = new Map(profile.attributes.map(attribute => [attribute.key, attribute]));
  if (attributes.size !== profile.attributes.length) throw new Error('画像属性不能重复。');
  for (const field of ['street', 'ageBand', 'sex', 'age'] as const) {
    if (attributes.get(field)?.value !== profile[field]) throw new Error(`画像 ${field} 与属性镜像不一致。`);
  }
  const evidence = [...cell.evidenceIds].sort();
  for (const attribute of profile.attributes) {
    if (new Set(attribute.evidenceIds).size !== attribute.evidenceIds.length) throw new Error('画像属性证据引用不能重复。');
    if (['street', 'ageBand', 'sex'].includes(attribute.key)) {
      if (attribute.provenance !== 'infer' || fingerprint([...attribute.evidenceIds].sort()) !== fingerprint(evidence)) throw new Error('人口归属属性须保留推断标记与冻结单元的证据链。');
    } else if (attribute.provenance !== 'assumption' || attribute.evidenceIds.length) throw new Error('具体年龄与其他资格属性必须保留为无人口证据的情景假设，不得升级为事实或推断。');
  }
  const values = Object.fromEntries(profile.attributes.map(attribute => [attribute.key, attribute.value]));
  if (![...task.population.filters, ...(preset?.population.filters ?? [])].every(filter => matchesPopulationFilter(values[filter.field], filter))) throw new Error('画像不满足问卷与冻结预设的资格筛选交集；未知资格不能充当已满足。');
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
    const persona = preset.persona ? residentPersonaSchema.parse(preset.persona) : undefined;
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
        if (filters.every(filter => matchesPopulationFilter((attributes as Record<string, Scalar>)[filter.field], filter))) return attributes;
      }
      return null;
    };
    const candidates = model.cells.filter(cell => cell.eligible && cell.population > 0 && draw(cell) !== null);
    if (!candidates.length) throw new Error(`预设“${preset.name}”的条件交集为空或无法形成合成画像。`);
    return { preset, persona, candidates, draw };
  });
  const cellCounts = new Map<string, number>(); const streetCounts = new Map<string, number>(); const seen = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const plan = plans[index % plans.length];
    const ranked = plan.candidates.map(cell => ({ cell, tie: random() })).sort((a, b) =>
      (cellCounts.get(a.cell.id) ?? 0) - (cellCounts.get(b.cell.id) ?? 0) || (streetCounts.get(a.cell.areaCode) ?? 0) - (streetCounts.get(b.cell.areaCode) ?? 0) || a.tie - b.tie);
    const cell = ranked[0].cell;
    let attributes = plan.draw(cell)!;
    for (let attempt = 0; attempt < 100 && seen.has(fingerprint({ attributes, description: plan.preset.description, behaviorNotes: plan.preset.behaviorNotes, persona: plan.persona })); attempt++) attributes = plan.draw(cell)!;
    seen.add(fingerprint({ attributes, description: plan.preset.description, behaviorNotes: plan.preset.behaviorNotes, persona: plan.persona }));
    cellCounts.set(cell.id, (cellCounts.get(cell.id) ?? 0) + 1); streetCounts.set(cell.areaCode, (streetCounts.get(cell.areaCode) ?? 0) + 1);
    const { street, ageBand, sex, age } = attributes;
    return { id: `resident-${String(index + 1).padStart(3, '0')}`, presetId: plan.preset.id, presetName: plan.preset.name,
      street: String(street), streetName: model.areas.find(area => area.code === street)!.name, ageBand: String(ageBand), sex: String(sex), age: Number(age),
      attributes: Object.entries(attributes).map(([key, value]) => ({ key, value, provenance: ['street', 'ageBand', 'sex'].includes(key) ? 'infer' as const : 'assumption' as const, evidenceIds: ['street', 'ageBand', 'sex'].includes(key) ? cell.evidenceIds : [] })),
      description: plan.preset.description,
      ...(plan.persona ? { persona: structuredClone(plan.persona) } : {}),
      assumptions: [...plan.preset.assumptions, '画像说明与行为均为用户情景假设，不是人口事实；与明确年龄/街道冲突时以结构化画像为准。', '具体年龄为年龄档内的情景赋值；60+生成上限90岁不是人口事实。', '覆盖抽样无人口权重；预设资格不能赋予总体代表性。'], behaviorNotes: plan.preset.behaviorNotes };
  });
}
export function residentPrompt(task: ResearchTask, profile: Profile, exposure: 'full' | 'no-persona' | 'demographics-only' = 'full') {
  const resident = exposure === 'full' ? profile : exposure === 'no-persona' ? { id: profile.id } : { id: profile.id, street: profile.street, streetName: profile.streetName, age: profile.age, ageBand: profile.ageBand, sex: profile.sex };
  return JSON.stringify({ schemaVersion: '1.0', exposure, resident, decisionContext: task.decisionContext, questionnaire: task.questionnaire });
}
/** Prompt text is the questionnaire's declaration. Option ids stay none/unknown; labels vary. */
function declaredExclusiveOptionIds(question: ResearchTask['questionnaire']['questions'][number]): string[] {
  if (question.type !== 'multiple' || !/排他|不能与其他/.test(question.prompt)) return [];
  return question.options.filter(option => option.id === 'none' || option.id === 'unknown').map(option => option.id);
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
  for (const question of task.questionnaire.questions) {
    const exclusive = declaredExclusiveOptionIds(question);
    if (!exclusive.length) continue;
    const value = answers.find(item => item.questionId === question.id)?.value;
    if (!Array.isArray(value) || value.length < 2 || !exclusive.some(id => value.includes(id))) continue;
    checked++;
    issues.push({ ruleId: `${question.id}-exclusive-options`, questionId: question.id, severity: 'error', message: '“无/未知”等排他选项不能与其他选择同时出现。' });
  }
  const status = issues.some(issue => issue.severity === 'error') ? 'contradiction' : !(task.validationRules?.length) ? 'not-configured' : issues.length ? 'partial' : 'checked';
  return { status, checked, issues, scope: '仅执行问卷JSON预登记的硬约束；不自动理解职业、家庭或开放题语义，不以消费刻板印象判错。' };
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
      : typeof value === 'string' && value.trim().length > 0 && value.length <= question.maxLength;
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
      const exclusive = declaredExclusiveOptionIds(question);
      if (!exclusive.length) {
        const ids = question.options.map(option => ({ id: option.id, order: random() })).sort((a, b) => a.order - b.order).map(option => option.id);
        value = ids.slice(0, question.minSelections + Math.floor(random() * (question.maxSelections - question.minSelections + 1)));
      } else {
        const ordinary = question.options.filter(option => !exclusive.includes(option.id));
        const solo = question.minSelections <= 1 && ordinary.length > 0 && random() < exclusive.length / question.options.length;
        if (solo || ordinary.length < question.minSelections) value = [exclusive[Math.floor(random() * exclusive.length)]];
        else {
          const ids = ordinary.map(option => ({ id: option.id, order: random() })).sort((a, b) => a.order - b.order).map(option => option.id);
          const upper = Math.min(question.maxSelections, ids.length);
          value = ids.slice(0, question.minSelections + Math.floor(random() * (upper - question.minSelections + 1)));
        }
      }
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
  timingBasis?: string; parameters?: { maxOutputTokens: number; timeoutMs: number; retries: number; concurrency: number; temperature: null; providerSeed: null; answerCache: false; reasoning?: string; fixturePolicyId?: string; residentPromptVersion?: string };
  presetSnapshots?: Omit<ResidentAgentPublic, 'hasApiKey'>[];
  sampling?: ReturnType<typeof samplingReport>; analysis?: SurveyAnalysis;
  exposure?: 'full' | 'no-persona' | 'demographics-only'; experiment?: { id: string; arm: string };
}
