import { createHash } from 'node:crypto';

export const REVIEW_CONTEXT_PROJECTION_VERSION = 'production-review-context-v2' as const;

export interface GenerationFeedbackReference {
  version: typeof REVIEW_CONTEXT_PROJECTION_VERSION;
  sourceRoleCallIds: string[];
  sourcePath: 'role-call.userPrompt.context.regeneration';
  sha256: string;
  rejectedCandidateIds: string[];
}

export interface ProductionReviewContextProjection {
  version: typeof REVIEW_CONTEXT_PROJECTION_VERSION;
  reviewContext: Record<string, unknown>;
  generationFeedbackReference: GenerationFeedbackReference | null;
  generationCodeReference: GenerationCodeReference | null;
}

export interface PriorImplementationBinding { sourceRoleCallId: string; sourceCandidateId: string; sha256: string; }
export interface GenerationCodeReference {
  version: typeof REVIEW_CONTEXT_PROJECTION_VERSION;
  sourceRoleCallIds: string[];
  sourcePath: 'role-call.userPrompt.context.feedback.previousHtml';
  priorRoleCallId: string;
  priorCandidateId: string;
  sha256: string;
}

const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Reject non-JSON values instead of silently dropping them during hashing. */
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && !record(value)) || ancestors.has(value)) throw new Error('Production review context must contain only acyclic JSON data');
  ancestors.add(value);
  for (const item of Object.values(value)) assertJson(item, ancestors);
  ancestors.delete(value);
}

/**
 * Current-candidate verification is not the original role's regeneration task.
 * Exclude only control-plane prior generation feedback and, when independently
 * bound to a selected prior developer call, its duplicate previous HTML.
 * Its exact original remains in each source role call's userPrompt and the run
 * ledger. A reference binds that original; no business context is summarized,
 * encoded, truncated or moved out of the independent review.
 *
 * Source call IDs must be supplied by the control plane, never by candidates.
 * This pure projection neither verifies their existence nor mutates the ledger.
 */
export function projectProductionReviewContext(generationContext: Record<string, unknown>, sourceRoleCallIds: string[] = [], priorImplementation?: PriorImplementationBinding): ProductionReviewContextProjection {
  if (!record(generationContext)) throw new Error('Production generation context must be a JSON object');
  if (Object.hasOwn(generationContext, 'generationFeedbackReference') || Object.hasOwn(generationContext, 'generationCodeReference')) throw new Error('Production review provenance is reserved for the control plane');
  assertJson(generationContext);
  const reviewContext = structuredClone(generationContext);
  let generationCodeReference: GenerationCodeReference | null = null;
  if (priorImplementation) {
    const feedback = generationContext.feedback;
    if (!record(feedback) || typeof feedback.previousHtml !== 'string' || !safeId(priorImplementation.sourceRoleCallId) || !safeId(priorImplementation.sourceCandidateId) || !/^[a-f0-9]{64}$/.test(priorImplementation.sha256)) throw new Error('Prior implementation has invalid bound provenance');
    if (!sourceRoleCallIds.length || sourceRoleCallIds.length > 2 || sourceRoleCallIds.some(id => !safeId(id) || id === priorImplementation.sourceRoleCallId) || new Set(sourceRoleCallIds).size !== sourceRoleCallIds.length) throw new Error('Prior implementation requires actual current source role call IDs');
    const sha256 = createHash('sha256').update(feedback.previousHtml, 'utf8').digest('hex');
    if (sha256 !== priorImplementation.sha256) throw new Error('Prior implementation bytes differ from their control-plane binding');
    generationCodeReference = { version: REVIEW_CONTEXT_PROJECTION_VERSION, sourceRoleCallIds: [...sourceRoleCallIds], sourcePath: 'role-call.userPrompt.context.feedback.previousHtml', priorRoleCallId: priorImplementation.sourceRoleCallId, priorCandidateId: priorImplementation.sourceCandidateId, sha256 };
    delete (reviewContext.feedback as Record<string, unknown>).previousHtml;
    reviewContext.generationCodeReference = structuredClone(generationCodeReference);
  }
  if (!Object.hasOwn(generationContext, 'regeneration')) return { version: REVIEW_CONTEXT_PROJECTION_VERSION, reviewContext, generationFeedbackReference: null, generationCodeReference };

  const feedback = generationContext.regeneration;
  if (!record(feedback) || !Array.isArray(feedback.rejectedCandidateIds) || feedback.rejectedCandidateIds.length < 1 || feedback.rejectedCandidateIds.length > 2 || feedback.rejectedCandidateIds.some(id => !safeId(id)) || new Set(feedback.rejectedCandidateIds).size !== feedback.rejectedCandidateIds.length) throw new Error('Production regeneration feedback has invalid rejected candidate provenance');
  if (!Array.isArray(sourceRoleCallIds) || sourceRoleCallIds.length < 1 || sourceRoleCallIds.length > 2 || sourceRoleCallIds.some(id => !safeId(id)) || new Set(sourceRoleCallIds).size !== sourceRoleCallIds.length) throw new Error('Production regeneration review requires actual source role call IDs');

  const generationFeedbackReference: GenerationFeedbackReference = {
    version: REVIEW_CONTEXT_PROJECTION_VERSION,
    sourceRoleCallIds: [...sourceRoleCallIds],
    sourcePath: 'role-call.userPrompt.context.regeneration',
    sha256: createHash('sha256').update(JSON.stringify(feedback), 'utf8').digest('hex'),
    rejectedCandidateIds: [...feedback.rejectedCandidateIds],
  };
  delete reviewContext.regeneration;
  reviewContext.generationFeedbackReference = structuredClone(generationFeedbackReference);
  return { version: REVIEW_CONTEXT_PROJECTION_VERSION, reviewContext, generationFeedbackReference, generationCodeReference };
}
