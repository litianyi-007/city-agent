import { z } from 'zod';
import { PROVIDERS, type Provider } from '../types.js';
import { researchTaskSchema, type ResearchTask } from './contract.js';
import { createDefaultPersona, residentPersonaSchema, type ResidentPersona } from '../../shared/resident-persona.js';
import { containsKnownSecret } from '../../shared/redaction.js';

/** Check public data before persistence/hashing; never rewrite research semantics. */
export function assertPublicMetadataSafe(value: unknown, knownSecrets: readonly string[] = [], label = '公开配置'): void {
  const serialized = JSON.stringify(value);
  if ([...new Set(knownSecrets.filter(Boolean))].some(secret => containsKnownSecret(serialized, secret))) {
    throw new Error(`${label}包含已配置的模型凭据，请从名称、画像、问卷及其他公开字段移除后再保存；未保存或调用模型。`);
  }
}

export const RESIDENT_TEMPLATES = ['general', 'caregiver', 'cat-buyer', 'dog-buyer', 'custom'] as const;
const connectionUrl = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, 'Base URL 须为不包含凭证、查询参数或片段的 HTTP(S) 地址');

const residentFields = {
  name: z.string().trim().min(1).max(100),
  templateId: z.enum(RESIDENT_TEMPLATES),
  description: z.string().trim().min(1).max(2000),
  population: researchTaskSchema.shape.population,
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(20),
  behaviorNotes: z.string().trim().max(2000),
  persona: residentPersonaSchema.optional(),
  provider: z.enum(PROVIDERS), baseUrl: connectionUrl,
  modelId: z.string().trim().min(1).max(200),
  apiKey: z.string().max(8192).nullable().optional(), enabled: z.boolean(),
};
export const residentCreateSchema = z.object({
  ...residentFields, provider: residentFields.provider.default('deepseek'),
  baseUrl: connectionUrl.default('https://api.deepseek.com'),
  modelId: residentFields.modelId.default('deepseek-flash'),
  enabled: z.boolean().default(true), behaviorNotes: z.string().trim().max(2000).default(''),
  assumptions: residentFields.assumptions.default([]),
}).strict();
export const residentPatchSchema = z.object(residentFields).partial().strict()
  .refine(value => Object.keys(value).length > 0, '修改内容不能为空');
/** Browser/public imports must not accept private connection fields. */
export const residentPublicSchema = residentCreateSchema.omit({ apiKey: true }).extend({
  id: z.string().uuid(), kind: z.literal('resident-agent-preset'), schemaVersion: z.literal('1.0'),
  hasApiKey: z.boolean(), createdAt: z.string().max(80), updatedAt: z.string().max(80),
}).strict();
export type ResidentAgentInput = z.input<typeof residentCreateSchema>;
export type ResidentAgentPatch = z.infer<typeof residentPatchSchema>;
export interface ResidentAgentPublic {
  id: string; kind: 'resident-agent-preset'; schemaVersion: '1.0';
  name: string; templateId: typeof RESIDENT_TEMPLATES[number]; description: string;
  population: ResearchTask['population']; assumptions: string[]; behaviorNotes: string;
  persona?: ResidentPersona;
  provider: Provider; baseUrl: string; modelId: string; enabled: boolean; hasApiKey: boolean;
  createdAt: string; updatedAt: string;
}
export type ResidentAgent = ResidentAgentPublic & { apiKey?: string };

/** Explicit projection: neither a key nor client-supplied verification claims can be persisted as public JSON. */
export function residentPublic(input: z.infer<typeof residentCreateSchema>, id: string, createdAt: string, hasApiKey: boolean): ResidentAgentPublic {
  const value: ResidentAgentPublic = {
    id, kind: 'resident-agent-preset', schemaVersion: '1.0', name: input.name,
    templateId: input.templateId, description: input.description,
    population: input.population, assumptions: input.assumptions, behaviorNotes: input.behaviorNotes,
    ...(input.persona ? { persona: structuredClone(input.persona) } : {}),
    provider: input.provider, baseUrl: input.baseUrl.replace(/\/+$/, ''), modelId: input.modelId,
    enabled: input.enabled, hasApiKey, createdAt, updatedAt: new Date().toISOString(),
  };
  assertPublicMetadataSafe(value, input.apiKey ? [input.apiKey] : [], '人群公开配置');
  return value;
}

export function residentInput(agent: ResidentAgent): ResidentAgentInput {
  return {
    name: agent.name, templateId: agent.templateId, description: agent.description,
    population: agent.population, assumptions: agent.assumptions, behaviorNotes: agent.behaviorNotes,
    ...(agent.persona ? { persona: structuredClone(agent.persona) } : {}),
    provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId,
    enabled: agent.enabled, ...(agent.apiKey ? { apiKey: agent.apiKey } : {}),
  };
}

export function getResidentTemplates(): ResidentAgentInput[] {
  const population = { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' as const };
  const adult = { field: 'age', op: 'gte' as const, value: 18 };
  const templates: ResidentAgentInput[] = [
    { name: '一般成年居民', templateId: 'general', description: '一般成年受访者；职业、收入、家庭阶段和商品偏好均未知。',
      population: { ...population, filters: [adult] }, assumptions: ['18+资格待核验；当前15–59岁统计档不能识别全部成年人。'] },
    { name: '小学生照护者', templateId: 'caregiver', description: '假设参与小学生零食购买或许可的成年照护者；不代替儿童本人表达口味。',
      population: { ...population, filters: [adult, { field: 'caregiver', op: 'eq', value: true }, { field: 'childSchoolStage', op: 'eq', value: 'primary' }] },
      assumptions: ['照护关系、小学在读资格和购买角色为情景设定，当前没有人口观测支持。'] },
    { name: '养猫家庭购买者', templateId: 'cat-buyer', description: '假设为家中猫购买商品的成年受访者；零食与主粮须在问卷中区分。',
      population: { ...population, filters: [adult, { field: 'petOwner', op: 'eq', value: true }, { field: 'ownsCat', op: 'eq', value: true }] },
      assumptions: ['养猫与购买资格为情景设定；不代表真实养猫家庭数量、消费能力或偏好。'] },
    { name: '养犬家庭购买者', templateId: 'dog-buyer', description: '假设为家中犬购买商品的成年受访者；不预设品类和可接受价格。',
      population: { ...population, filters: [adult, { field: 'petOwner', op: 'eq', value: true }, { field: 'ownsDog', op: 'eq', value: true }] },
      assumptions: ['养犬与购买资格为情景设定；可以与养猫、照护者身份重叠。'] },
  ];
  return templates.map(template => ({ ...template, persona: createDefaultPersona() }));
}

export const researchProjectInputSchema = z.object({
  task: researchTaskSchema,
  residentAgentIds: z.array(z.string().uuid()).max(30).refine(ids => new Set(ids).size === ids.length, '预设不能重复'),
}).strict();
export type ResearchProjectInput = z.infer<typeof researchProjectInputSchema>;
export interface ResearchProject extends ResearchProjectInput {
  id: string; stage: 'draft'; createdAt: string; updatedAt: string;
}
