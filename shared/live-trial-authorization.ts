import { z } from 'zod';
import { fingerprint } from './evidence';

/** One user-approved trial, not a user-selectable CLI authorization namespace. */
export const CONTRACT_TRIAL_AUTHORIZATION_ID = 'approved-2026-10-07-contract11-cny5-24';
export const CONTRACT_TRIAL_MODEL = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' } as const;
export const CONTRACT_TRIAL_SCOPE = {
  budgetCny: 5, maxProviderRequests: 24, residentsPerScenario: 10, plannedResidents: 20,
  planningRequests: 2, corsRequests: 2, ...CONTRACT_TRIAL_MODEL,
  protocolVersion: 'live-business-smoke-1.1', residentPromptVersion: 'resident-json-contract-1.1',
  plannerVersion: 'candidate-planner-1.1', retries: 0, concurrency: 1,
  allowModelFallback: false, allowSampleReplacement: false, allowExpansion: false,
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({
  budgetCny: z.literal(5), maxProviderRequests: z.literal(24), residentsPerScenario: z.literal(10), plannedResidents: z.literal(20),
  planningRequests: z.literal(2), corsRequests: z.literal(2), provider: z.literal('deepseek'),
  baseUrl: z.literal('https://api.deepseek.com'), modelId: z.literal('deepseek-flash'),
  protocolVersion: z.literal('live-business-smoke-1.1'), residentPromptVersion: z.literal('resident-json-contract-1.1'),
  plannerVersion: z.literal('candidate-planner-1.1'), retries: z.literal(0), concurrency: z.literal(1),
  allowModelFallback: z.literal(false), allowSampleReplacement: z.literal(false), allowExpansion: z.literal(false),
}).strict();
export const trialApprovalSchema = z.object({
  schemaVersion: z.literal('live-trial-approval-1.0'), authorizationId: z.literal(CONTRACT_TRIAL_AUTHORIZATION_ID),
  status: z.literal('approved'), approvedAt: z.string().datetime(), confirmationReference: z.string().trim().min(1).max(2000),
  scope: scopeSchema,
}).strict();
export const trialPlanAuthorizationSchema = z.object({
  schemaVersion: z.literal('live-trial-plan-authorization-1.0'), authorizationId: z.literal(CONTRACT_TRIAL_AUTHORIZATION_ID),
  approvalHash: hash, planHash: hash, authorizedAt: z.string().datetime(),
}).strict();
export const trialRequestSchema = z.object({
  requestId: z.string(), scenario: z.enum(['child-snacks', 'pet-snacks']), purpose: z.enum(['resident', 'planning', 'browser-cors']),
  maxOutputTokens: z.union([z.literal(3000), z.literal(6000)]), systemPrompt: z.string().min(1), userPrompt: z.string().min(1), promptHash: hash,
}).strict();
export type TrialRequest = z.infer<typeof trialRequestSchema>;
export interface TrialRegistration {
  schemaVersion: 'live-business-plan-1.1'; id: string; authorizationId: typeof CONTRACT_TRIAL_AUTHORIZATION_ID;
  scope: typeof CONTRACT_TRIAL_SCOPE; model: typeof CONTRACT_TRIAL_MODEL; requests: TrialRequest[];
  [field: string]: unknown;
}

/** Validates the frozen 20+2+2 request admission map without performing any I/O. */
export function validateTrialRegistration(input: unknown): TrialRegistration {
  const plan = z.object({
    schemaVersion: z.literal('live-business-plan-1.1'), id: z.string().uuid(), authorizationId: z.literal(CONTRACT_TRIAL_AUTHORIZATION_ID),
    scope: scopeSchema, model: z.object({ provider: z.literal('deepseek'), baseUrl: z.literal('https://api.deepseek.com'), modelId: z.literal('deepseek-flash') }).strict(),
    requests: z.array(trialRequestSchema).length(24),
  }).passthrough().parse(input) as TrialRegistration;
  const expected = ['child-snacks', 'pet-snacks'].flatMap(scenario => [
    ...Array.from({ length: 10 }, (_, index) => ({ requestId: `${scenario}.resident-${String(index + 1).padStart(3, '0')}`, scenario, purpose: 'resident', cap: 3000 })),
    { requestId: `planning.${scenario}`, scenario, purpose: 'planning', cap: 6000 },
    { requestId: `cors.${scenario}`, scenario, purpose: 'browser-cors', cap: 3000 },
  ]);
  if (new Set(plan.requests.map(request => request.requestId)).size !== 24) throw new Error('冻结请求ID重复，不允许扩充或替换。');
  for (const request of plan.requests) {
    const registered = expected.find(value => value.requestId === request.requestId);
    if (!registered || registered.scenario !== request.scenario || registered.purpose !== request.purpose || registered.cap !== request.maxOutputTokens) throw new Error('冻结请求范围或输出上限不是批准的20+2+2。');
    if (request.promptHash !== fingerprint({ system: request.systemPrompt, user: request.userPrompt })) throw new Error('冻结请求Prompt hash与原文不一致。');
  }
  return plan;
}

/** Requires an explicit, independently-created receipt and binding for this exact immutable plan. */
export function validateTrialAuthorization(approvalInput: unknown, bindingInput: unknown, planInput: unknown) {
  const approval = trialApprovalSchema.parse(approvalInput);
  const binding = trialPlanAuthorizationSchema.parse(bindingInput);
  const plan = validateTrialRegistration(planInput);
  if (binding.approvalHash !== fingerprint(approval) || binding.planHash !== fingerprint(planInput)) throw new Error('审批或冻结计划hash不匹配；不授权任何请求。');
  if (Date.parse(binding.authorizedAt) < Date.parse(approval.approvedAt)) throw new Error('计划绑定时间早于批准时间。');
  return { approval, binding, plan };
}

/** Called before reservation/transport. It never repairs prompts or broadens registered scope. */
export function assertTrialRequest(planInput: unknown, input: { requestId: string; purpose: TrialRequest['purpose']; model: unknown; system: string; user: string; maxOutputTokens: number }): TrialRequest {
  const plan = validateTrialRegistration(planInput);
  const registered = plan.requests.find(request => request.requestId === input.requestId);
  if (!registered || registered.purpose !== input.purpose || registered.maxOutputTokens !== input.maxOutputTokens
    || fingerprint(input.model) !== fingerprint(plan.model) || registered.promptHash !== fingerprint({ system: input.system, user: input.user })) throw new Error('出站请求不符合已批准的冻结Prompt、模型、用途或上限。');
  return registered;
}
