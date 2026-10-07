import { z } from 'zod';
import { productionApiKeySchema } from './production-schema.js';
import type { ProductionPhaseRubric } from './production-verifier-rubric.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL_ID = 'jev-1.13.0';
export const JEV_POLICY_VERSION = 'jev-candidate-v3';
export const jevConfigSchema = z.object({
  enabled: z.boolean().default(false),
  modelId: z.literal(JEV_MODEL_ID).default(JEV_MODEL_ID),
  minConfidence: z.number().finite().min(0).max(1).default(0.5),
  minScore: z.number().finite().min(0).max(4).default(3),
  inputPerMillion: z.number().finite().nonnegative().max(10000).default(0.042),
  outputPerMillion: z.number().finite().nonnegative().max(10000).default(0),
  currency: z.literal('USD').default('USD'),
  maxRequests: z.number().int().min(1).max(24).default(24),
  timeoutMs: z.number().int().min(1000).max(30000).default(30000),
}).strict();
export const jevConfigPatchSchema = jevConfigSchema.partial().extend({ apiKey: productionApiKeySchema.nullable().optional() }).strict().refine(value => !value.apiKey || value.apiKey !== JEV_ENDPOINT && value.apiKey !== JEV_MODEL_ID, 'API Key 不得与 Jev 模型或服务地址相同');
export type JevConfig = z.infer<typeof jevConfigSchema>;
export type JevPublicConfig = JevConfig & { hasApiKey: boolean };
export type SecretJevConfig = JevConfig & { apiKey?: string; hasApiKey?: boolean };
export const DEFAULT_JEV_CONFIG: JevConfig = jevConfigSchema.parse({});
export interface JevCandidateContext { phase: string; goal: string; acceptance: string | string[]; frozenHash: string | null; candidates: Array<{ id: string; value: unknown }>; capability?: 'offline-single-html' | 'camera-scene-v1'; reviewContext?: unknown; }
export type JevDimension = 'coverage' | 'consistency' | 'scope';
export interface JevScoreAnswer { score: number; probabilities: Record<string, number>; confidence: number; legend: Record<string, string>; }
export interface JevCandidateScore { candidateId: string; dimensions: Record<JevDimension, JevScoreAnswer>; meanScore: number; minimumScore: number; scopeProbability: number; scopeCertainty: number; qualified: boolean; stronglyRejected: boolean; }
export interface JevChoiceAnswer { choice: string; probabilities: Record<string, number>; confidence: number; }
export interface JevRequestSnapshot { model: string; state: JevCandidateContext & { requestLayoutVersion?: string; trustBoundary: string; phaseReview?: ProductionPhaseRubric }; questions: Record<string, { type: 'score' | 'choice' | 'noul'; instructions: string; criteria?: string[] | Record<string, string> }>; }
export interface JevEvaluation {
  policyVersion: string;
  status: 'accepted' | 'uncertain' | 'rejected' | 'error';
  selectedCandidateId: string | null;
  reason: string;
  requestSnapshot: JevRequestSnapshot | null;
  rawResponse: unknown | null;
  scores: JevCandidateScore[];
  choice: JevChoiceAnswer | null;
  usage: { inputTokens: number | null; outputTokens: number | null; estimatedCost: number | null; currency: 'USD'; complete: boolean };
  modelIdRequested: string;
  modelIdReturned: string | null;
  httpStatus: number | null;
  providerRequests: number;
  durationMs: number;
  error?: string;
  /** Assigned only by the trusted protocol validator, never provider error text. */
  errorKind?: 'arithmetic-drift' | 'fatal';
  diagnostics?: Array<{ code: 'score-mean-drift' | 'score-concentration-drift' | 'choice-concentration-drift'; answerId: string }>;
}
