import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { z } from 'zod';
import type { AcceptanceCheck } from '../gate.js';
import { testsSchema } from './contracts.js';
import { acceptancePlanHash, composeAcceptanceGroups, type AcceptanceGroup, type AcceptancePlan } from './acceptance-plan.js';

export const ACCEPTANCE_STEP_AUDIT_VERSION = 'production-acceptance-step-audit-v1' as const;
export interface AcceptanceStepAuditGroupSource {
  groupId: string;
  sourceCallId: string;
  sourceCandidateId: string;
  rawOutputSha256: string;
  valueSha256: string;
  value: AcceptanceGroup;
}
export interface AcceptanceStepAuditInput {
  plan: AcceptancePlan;
  planHash: string;
  attemptId: string;
  compositeCandidateId: string;
  checks: AcceptanceCheck[];
  groups: AcceptanceStepAuditGroupSource[];
}
export interface AcceptanceStepAuditSlot {
  groupId: string;
  checkId: string;
  obligationIds: string[];
  checkIndex: number;
  stepBudget: number;
  actualStepCount: number;
  actionKinds: AcceptanceCheck['steps'][number]['action'][];
  assertionIndices: number[];
  /** Only assertTextExact/assertCount action kinds, not semantic correctness. */
  exactAssertionIndices: number[];
  operations: Array<{ stepIndex: number; action: 'fill' | 'click'; embedded: boolean }>;
}
export interface AcceptanceStepAudit {
  version: typeof ACCEPTANCE_STEP_AUDIT_VERSION;
  planHash: string;
  attemptId: string;
  compositeCandidateId: string;
  checksSha256: string;
  sourceGroups: Array<Omit<AcceptanceStepAuditGroupSource, 'value'>>;
  slots: AcceptanceStepAuditSlot[];
}

const messages = { identity: 'Step audit identity rejected', source: 'Step audit source binding rejected', checks: 'Step audit checks binding rejected' } as const;
function reject(kind: keyof typeof messages): never { throw new Error(messages[kind]); }
// Same byte definition as production/store.hash for JSON values, without
// importing the stateful store or sorting/normalizing model property order.
const hashProductionValue = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const hashSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const inputSchema = z.object({
  plan: z.unknown(), planHash: hashSchema, attemptId: z.uuid(), compositeCandidateId: z.uuid(), checks: z.unknown(),
  groups: z.array(z.object({ groupId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), sourceCallId: z.uuid(), sourceCandidateId: z.uuid(), rawOutputSha256: hashSchema, valueSha256: hashSchema, value: z.unknown() }).strict()).min(1).max(3),
}).strict();

/** Bound the whole pure input before schema work/serialization. No getters,
 * toJSON, symbols, proxies, cycles or dropped non-JSON values are permitted. */
function assertJsonData(value: unknown): void {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 16) return reject('identity');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 6000) reject('identity'); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item)) return reject('identity');
    const array = Array.isArray(item); const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return reject('identity');
    const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 10000) return reject('identity');
    ancestors.add(item);
    for (const key of keys) {
      if (typeof key !== 'string') return reject('identity');
      if (array && key === 'length') continue;
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || array && !/^(0|[1-9][0-9]*)$/.test(key)) return reject('identity');
      visit(descriptor.value, depth + 1);
    }
    if (array && keys.length !== (item as unknown[]).length + 1) return reject('identity');
    ancestors.delete(item);
  };
  visit(value, 0);
}

/** Exact step-array facts only. This neither executes checks, proves setup or
 * business coverage, accepts a candidate, repairs JSON nor changes any Gate.
 * The pipeline must independently bind rawOutputSha256 to actual source calls;
 * this pure input carries hashes, not raw response bytes or origin proof. */
export function buildAcceptanceStepAudit(input: AcceptanceStepAuditInput): AcceptanceStepAudit {
  assertJsonData(input);
  if (!inputSchema.safeParse(input).success) return reject('identity');
  try { if (acceptancePlanHash(input.plan) !== input.planHash) return reject('source'); }
  catch { return reject('source'); }
  if (input.groups.length !== input.plan.groups.length) return reject('source');
  const callIds = new Set<string>(); const candidateIds = new Set<string>(); const rawHashes = new Set<string>();
  for (const [index, source] of input.groups.entries()) {
    if (source.groupId !== input.plan.groups[index]!.id || callIds.has(source.sourceCallId) || candidateIds.has(source.sourceCandidateId) || rawHashes.has(source.rawOutputSha256)
      || source.sourceCandidateId === input.compositeCandidateId || source.sourceCallId === input.compositeCandidateId) return reject('source');
    callIds.add(source.sourceCallId); candidateIds.add(source.sourceCandidateId); rawHashes.add(source.rawOutputSha256);
    if (!source.value || source.value.planHash !== input.planHash || source.value.attemptId !== input.attemptId || source.value.groupId !== source.groupId || hashProductionValue(source.value) !== source.valueSha256) return reject('source');
  }
  let composed: AcceptanceCheck[];
  try { composed = composeAcceptanceGroups(input.plan, input.planHash, input.groups.map(source => source.value), input.attemptId); }
  catch { return reject('checks'); }
  const validation = testsSchema.safeParse({ checks: input.checks });
  if (!validation.success || !isDeepStrictEqual(validation.data.checks, input.checks) || !isDeepStrictEqual(composed, input.checks) || hashProductionValue(composed) !== hashProductionValue(input.checks)) return reject('checks');
  const slots: AcceptanceStepAuditSlot[] = []; let checkIndex = 0;
  for (const group of input.plan.groups) for (const slot of group.checks) {
    const check = input.checks[checkIndex]!;
    const facts: AcceptanceStepAuditSlot = { groupId: group.id, checkId: slot.id, obligationIds: [...slot.obligationIds], checkIndex, stepBudget: slot.stepBudget,
      actualStepCount: check.steps.length, actionKinds: check.steps.map(step => step.action), assertionIndices: [], exactAssertionIndices: [], operations: [] };
    check.steps.forEach((step, stepIndex) => {
      if (step.action === 'fill' || step.action === 'click') facts.operations.push({ stepIndex, action: step.action, embedded: false });
      else {
        facts.assertionIndices.push(stepIndex);
        if (step.action === 'assertTextExact' || step.action === 'assertCount') facts.exactAssertionIndices.push(stepIndex);
        if (step.action === 'assertChanged') facts.operations.push({ stepIndex, action: step.after.action, embedded: true });
      }
    });
    slots.push(facts); checkIndex++;
  }
  return { version: ACCEPTANCE_STEP_AUDIT_VERSION, planHash: input.planHash, attemptId: input.attemptId, compositeCandidateId: input.compositeCandidateId,
    checksSha256: hashProductionValue(input.checks), sourceGroups: input.groups.map(({ groupId, sourceCallId, sourceCandidateId, rawOutputSha256, valueSha256 }) => ({ groupId, sourceCallId, sourceCandidateId, rawOutputSha256, valueSha256 })), slots };
}
