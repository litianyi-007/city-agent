import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';
import { acceptanceCheckSchema, type AcceptanceCheck } from '../gate.js';

export const ACCEPTANCE_PLAN_VERSION = 'production-acceptance-plan-v1' as const;
export const ACCEPTANCE_GROUP_VERSION = 'production-acceptance-group-v1' as const;
export const ACCEPTANCE_CONSTRUCTION_VERSION = 'production-acceptance-construction-v1' as const;

const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const statement = z.string().min(1).max(240);
const obligationSchema = z.object({ id: safeId, source: z.enum(['brief', 'acceptance']), quote: statement, scenario: statement, expected: statement }).strict();
const slotSchema = z.object({ id: safeId, obligationIds: z.array(safeId).min(1).max(24), setup: statement, exercise: statement, assertions: statement, stepBudget: z.number().int().min(1).max(20) }).strict();
const groupSchema = z.object({ id: safeId, checks: z.array(slotSchema).min(1).max(4) }).strict();

/** Structural declarations only. Quotes/references do not prove complete
 * semantic coverage, independent setup, correct assertions or a passed Gate. */
export const acceptancePlanSchema = z.object({
  version: z.literal(ACCEPTANCE_PLAN_VERSION),
  obligations: z.array(obligationSchema).min(1).max(24),
  groups: z.array(groupSchema).min(1).max(3),
}).strict().superRefine((plan, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const obligationIds = new Set(plan.obligations.map(item => item.id));
  if (obligationIds.size !== plan.obligations.length) issue('Duplicate obligation ID');
  if (new Set(plan.groups.map(group => group.id)).size !== plan.groups.length) issue('Duplicate group ID');
  const slots = plan.groups.flatMap(group => group.checks);
  if (slots.length < 2 || slots.length > 12) issue('Acceptance slot count must be between 2 and 12');
  if (new Set(slots.map(slot => slot.id)).size !== slots.length) issue('Duplicate check ID');
  const referenced = new Set<string>();
  for (const slot of slots) {
    if (new Set(slot.obligationIds).size !== slot.obligationIds.length) issue('Duplicate obligation reference');
    for (const id of slot.obligationIds) {
      if (!obligationIds.has(id)) issue('Unknown obligation reference');
      referenced.add(id);
    }
  }
  if (plan.obligations.some(item => !referenced.has(item.id))) issue('Unreferenced obligation');
  if (!plan.obligations.some(item => item.source === 'brief') || !plan.obligations.some(item => item.source === 'acceptance')) issue('Both original sources must be referenced');
});

export type AcceptancePlan = z.infer<typeof acceptancePlanSchema>;
export type AcceptancePlanObligation = AcceptancePlan['obligations'][number];
export type AcceptancePlanGroup = AcceptancePlan['groups'][number];
export type AcceptancePlanSlot = AcceptancePlanGroup['checks'][number];
export interface AcceptancePlanSource { brief: string; acceptance: string; }
export interface AcceptanceGroup {
  version: typeof ACCEPTANCE_GROUP_VERSION;
  planHash: string;
  groupId: string;
  attemptId: string;
  checks: Array<{ checkId: string; check: AcceptanceCheck }>;
}

export const ACCEPTANCE_PLAN_ERROR_CODES = ['plan-structure', 'plan-source-quote', 'plan-binding', 'group-structure', 'group-order', 'non-json-input'] as const;
export type AcceptancePlanErrorCode = typeof ACCEPTANCE_PLAN_ERROR_CODES[number];
/** Fixed diagnostics only: no provider text, unknown key, path or cause. */
export class AcceptancePlanError extends Error {
  readonly code: AcceptancePlanErrorCode;
  constructor(code: AcceptancePlanErrorCode) {
    super(`Acceptance construction rejected: ${code}`);
    this.name = 'AcceptancePlanError';
    this.code = code;
  }
}
export const ACCEPTANCE_PLAN_DIAGNOSTIC_LITERALS = Object.freeze([
  ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_CONSTRUCTION_VERSION,
  'AcceptancePlanError', ...ACCEPTANCE_PLAN_ERROR_CODES,
  ...ACCEPTANCE_PLAN_ERROR_CODES.map(code => `Acceptance construction rejected: ${code}`),
  'Duplicate obligation ID', 'Duplicate group ID', 'Acceptance slot count must be between 2 and 12',
  'Duplicate check ID', 'Duplicate obligation reference', 'Unknown obligation reference',
  'Unreferenced obligation', 'Both original sources must be referenced',
  'Acceptance check must preserve original values', 'Acceptance checks must match planned slots',
  'Acceptance check exceeds its planned step budget', 'Acceptance input must be bounded JSON data',
]);
function reject(code: AcceptancePlanErrorCode): never { throw new AcceptancePlanError(code); }

/** Avoid coercion, getters, Proxy traps and JSON.stringify silently dropping
 * non-JSON fields. These resource bounds exceed every legal plan/group shape. */
function assertJsonData(value: unknown): void {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 16) reject('non-json-input');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 6000) reject('non-json-input'); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item)) reject('non-json-input');
    const prototype = Object.getPrototypeOf(item);
    const array = Array.isArray(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject('non-json-input');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 10000) reject('non-json-input');
    ancestors.add(item);
    for (const key of keys) {
      if (typeof key !== 'string') reject('non-json-input');
      if (array && key === 'length') continue;
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject('non-json-input');
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) reject('non-json-input');
      visit(descriptor.value, depth + 1);
    }
    if (array && keys.length !== (item as unknown[]).length + 1) reject('non-json-input');
    ancestors.delete(item);
  };
  visit(value, 0);
}

function validPlan(value: unknown): AcceptancePlan {
  assertJsonData(value);
  if (!acceptancePlanSchema.safeParse(value).success) return reject('plan-structure');
  // Preserve original key order and values, not Zod's schema-ordered copy.
  return JSON.parse(JSON.stringify(value)) as AcceptancePlan;
}

/** Exact substring binding only; never infer that quotes exhaust requirements. */
export function parseAcceptancePlan(value: unknown, source: AcceptancePlanSource): AcceptancePlan {
  const plan = validPlan(value);
  assertJsonData(source);
  if (typeof source.brief !== 'string' || typeof source.acceptance !== 'string') return reject('plan-source-quote');
  if (plan.obligations.some(item => !source[item.source].includes(item.quote))) return reject('plan-source-quote');
  return plan;
}

/** Hash the exact validated JSON value, without trimming, sorting or rewriting. */
export function acceptancePlanHash(plan: AcceptancePlan): string {
  return createHash('sha256').update(JSON.stringify(validPlan(plan)), 'utf8').digest('hex');
}

function boundGroup(plan: AcceptancePlan, planHash: string, groupId: string, attemptId: string): AcceptancePlanGroup {
  const validated = validPlan(plan);
  if (typeof planHash !== 'string' || !/^[a-f0-9]{64}$/.test(planHash) || acceptancePlanHash(validated) !== planHash
    || typeof groupId !== 'string' || typeof attemptId !== 'string' || !z.uuid().safeParse(attemptId).success) return reject('plan-binding');
  const group = validated.groups.find(item => item.id === groupId);
  if (!group) return reject('plan-binding');
  return group;
}

// Gate's existing name/selector .trim() is not permission to repair candidates.
// Reject normalization before parsing, while retaining its exact JSON schema.
function originalCheckSchema(stepBudget: number) {
  const schema = acceptanceCheckSchema.extend({ steps: acceptanceCheckSchema.shape.steps.max(stepBudget) });
  return z.preprocess((value, ctx) => {
    try {
      assertJsonData(value);
      const parsed = schema.safeParse(value);
      if (parsed.success && !isDeepStrictEqual(value, parsed.data)) ctx.addIssue({ code: 'custom', message: 'Acceptance check must preserve original values' });
      return value;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Acceptance input must be bounded JSON data' });
      return z.NEVER;
    }
  }, schema);
}

/** Dynamic output contract: exact host plan/round binding, slot order and
 * quantity. A valid group still proves no behavior or cross-check setup. */
export function acceptanceGroupSchema(plan: AcceptancePlan, planHash: string, groupId: string, attemptId: string) {
  const group = boundGroup(plan, planHash, groupId, attemptId);
  const slots = group.checks.map(slot => z.object({ checkId: z.literal(slot.id), check: originalCheckSchema(slot.stepBudget) }).strict());
  const schema = z.object({
    version: z.literal(ACCEPTANCE_GROUP_VERSION), planHash: z.literal(planHash), groupId: z.literal(groupId), attemptId: z.literal(attemptId),
    checks: z.tuple(slots as [typeof slots[number], ...typeof slots[number][]]),
  }).strict();
  return z.preprocess((value, ctx) => {
    try { assertJsonData(value); return value; }
    catch { ctx.addIssue({ code: 'custom', message: 'Acceptance input must be bounded JSON data' }); return z.NEVER; }
  }, schema);
}

/** Safe parser for runtime use. Zod details must not enter public diagnostics. */
export function parseAcceptanceGroup(value: unknown, plan: AcceptancePlan, planHash: string, groupId: string, attemptId: string): AcceptanceGroup {
  assertJsonData(value);
  if (!acceptanceGroupSchema(plan, planHash, groupId, attemptId).safeParse(value).success) return reject('group-structure');
  return JSON.parse(JSON.stringify(value)) as AcceptanceGroup;
}

/** Composition strips only binding wrappers in preregistered order. No sort,
 * clipping, step changes, JSON repair, semantic acceptance or Gate execution. */
export function composeAcceptanceGroups(plan: AcceptancePlan, planHash: string, groups: unknown, attemptId: string): AcceptanceCheck[] {
  const validated = validPlan(plan);
  assertJsonData(groups);
  if (!Array.isArray(groups) || groups.length !== validated.groups.length) return reject('group-order');
  const checks: AcceptanceCheck[] = [];
  for (const [index, group] of validated.groups.entries()) {
    const parsed = parseAcceptanceGroup(groups[index], validated, planHash, group.id, attemptId);
    checks.push(...parsed.checks.map(item => item.check));
  }
  return checks;
}
