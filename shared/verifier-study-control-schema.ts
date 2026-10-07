import { z } from 'zod';
import { JEV_MODEL_ID } from './jev-schema.js';

export const verifierStudyExecutionSourceSchema = z.enum(['loopback-engineering', 'real-provider']);
export const verifierStudyPrepareRequestSchema = z.object({
  executionSource: verifierStudyExecutionSourceSchema,
  verifierAgentId: z.string().uuid().optional(),
}).strict();
export const verifierStudyStartRequestSchema = z.object({
  preparationId: z.string().uuid(),
  estimatedBillingOnlyAcknowledged: z.literal(true),
  jevOutputObservationOnlyAcknowledged: z.literal(true),
}).strict();
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cost = z.number().finite().nonnegative();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const strategy = z.enum(['baseline', 'llm', 'jev-cascade']);
const reservation = z.object({
  inputTokens: nonnegativeInteger, outputTokens: nonnegativeInteger,
  timeoutMs: z.number().int().positive(), estimatedCostUsd: cost, outputPolicy: z.string(),
}).strict();
// Public snapshots require explicit fields: no creation defaults, credential,
// secret identity hash, filesystem path or private source metadata is accepted.
export const verifierStudyPublicPlanSchema = z.object({
  version: z.string(),
  configuration: z.object({
    verifier: z.object({
      id: z.string().uuid(), name: z.string(), role: z.literal('verifier'),
      enabled: z.boolean(), provider: z.literal('deepseek'), baseUrl: z.string().url(),
      modelId: z.string().min(1), hasApiKey: z.boolean(),
      pricing: z.object({ inputPerMillion: cost, outputPerMillion: cost, currency: z.literal('USD') }).strict(),
    }).strict(),
    jev: z.object({
      enabled: z.boolean(), modelId: z.literal(JEV_MODEL_ID), minConfidence: z.number().finite().min(0).max(1),
      minScore: z.number().finite().min(0).max(4), inputPerMillion: cost, outputPerMillion: cost,
      currency: z.literal('USD'), maxRequests: z.number().int().min(1).max(24),
      timeoutMs: z.number().int().min(1000).max(30000), hasApiKey: z.boolean(),
    }).strict(),
  }).strict(),
  limits: z.object({
    maxCalls: nonnegativeInteger, maxInputTokens: nonnegativeInteger,
    maxObservedOutputTokens: nonnegativeInteger, maxEstimatedCostUsd: cost,
    maxDurationMs: z.number().int().positive(), oracleTimeoutMs: z.number().int().positive(),
    llmTimeoutMs: z.number().int().positive(), jevTimeoutMs: z.number().int().positive(),
  }).strict(),
  reservations: z.object({ llm: reservation, jev: reservation }).strict(),
  poolIds: z.array(z.string().min(1)).min(1).max(18), strategies: z.array(strategy).min(1).max(3),
  accountingBoundary: z.string(), httpBoundary: z.string(), candidateRandomization: z.string(),
}).strict();
export const verifierStudyPreparationSchema = z.object({
  id: z.string().uuid(), executionSource: verifierStudyExecutionSourceSchema,
  frozenStudySha256: sha256, expiresAt: z.string().datetime(), plan: verifierStudyPublicPlanSchema,
}).strict();
const strategySummary = z.object({
  strategy, planned: nonnegativeInteger, attempted: nonnegativeInteger, accepted: nonnegativeInteger,
  abstained: nonnegativeInteger, errors: nonnegativeInteger, notStarted: nonnegativeInteger,
  selectedOraclePass: nonnegativeInteger, selectedOracleFail: nonnegativeInteger, selectedOracleUnknown: nonnegativeInteger,
}).strict();
export const verifierStudySummarySchema = z.object({
  version: z.literal('verifier-study-observed-v1'), runId: z.string().uuid(),
  executionSource: verifierStudyExecutionSourceSchema, cachePolicy: z.literal('bypass'),
  status: z.enum(['completed', 'failed', 'cancelled']), reason: z.string().nullable(),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), durationMs: nonnegativeInteger,
  plannedDecisions: nonnegativeInteger, attemptedDecisions: nonnegativeInteger, notStartedDecisions: nonnegativeInteger,
  plannedOracles: nonnegativeInteger, attemptedOracles: nonnegativeInteger, completedOracles: nonnegativeInteger,
  callbackIntents: nonnegativeInteger, actualProviderHttpAttempts: nonnegativeInteger.nullable(),
  localFixtureHttpAttempts: nonnegativeInteger.nullable(),
  actualModelUsage: z.object({ inputTokens: nonnegativeInteger, outputTokens: nonnegativeInteger, estimatedCostUsd: cost }).strict().nullable(),
  usage: z.object({
    complete: z.boolean(), knownInputTokens: nonnegativeInteger, knownOutputTokens: nonnegativeInteger,
    knownEstimatedCost: cost, currency: z.literal('USD'), unknownCalls: nonnegativeInteger,
    scope: z.enum(['observed-provider-declared-rate-estimate-not-bill', 'loopback-fixture-accounting-not-model-measurement']),
  }).strict(),
  byStrategy: z.array(strategySummary).max(3), ledgerTerminalPersisted: z.boolean(),
}).strict();
export const verifierStudyPublicRunSchema = z.object({
  id: z.string().uuid(), status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  executionSource: verifierStudyExecutionSourceSchema, bootId: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/), frozenStudySha256: sha256,
  createdAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  progress: z.object({
    ledgerEvents: nonnegativeInteger.nullable(), decisions: nonnegativeInteger.nullable(),
    calls: nonnegativeInteger.nullable(), oracles: nonnegativeInteger.nullable(),
  }).strict(),
  summary: verifierStudySummarySchema.nullable(), error: z.string().nullable(),
}).strict();
export const verifierStudyRunListSchema = z.array(verifierStudyPublicRunSchema);
export type VerifierStudyExecutionSource = z.infer<typeof verifierStudyExecutionSourceSchema>;
export type VerifierStudyPrepareRequest = z.infer<typeof verifierStudyPrepareRequestSchema>;
export type VerifierStudyStartRequest = z.infer<typeof verifierStudyStartRequestSchema>;
export type VerifierStudyPublicPlan = z.infer<typeof verifierStudyPublicPlanSchema>;
export type VerifierStudyPreparation = z.infer<typeof verifierStudyPreparationSchema>;
export type VerifierStudyPublicRun = z.infer<typeof verifierStudyPublicRunSchema>;
export type VerifierStudyPublicSummary = z.infer<typeof verifierStudySummarySchema>;
