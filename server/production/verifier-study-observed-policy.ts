import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { VERIFIER_CHALLENGE_IDS, type VerifierChallengePoolId } from '../../shared/production-verifier-challenge-corpus.js';
import { verifierStudyPublicConfiguration } from './verifier-study-preflight.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import { prepareVerifierWirePreflight } from './verifier-wire-preflight.js';
import type { VerifierStudyStrategy } from './verifier-study-strategy.js';

export const OBSERVED_STUDY_POLICY_VERSION = 'verifier-study-observed-policy-v1' as const;
export type ObservedStudySource = 'real-provider' | 'loopback-engineering';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceSchema = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), clean: z.boolean(),
  hashes: z.record(z.string().regex(/^[A-Za-z0-9_./-]+$/).refine(value => !value.split('/').some(part => ['.', '..', ''].includes(part))), z.string().regex(/^[a-f0-9]{64}$/))
    .refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 100),
}).strict();
const limitsSchema = z.object({ maxCalls: z.number().int().min(0).max(54).default(54),
  maxInputTokens: z.number().int().min(0).max(3_391_488).default(3_391_488),
  maxObservedOutputTokens: z.number().int().min(0).max(221_184).default(221_184),
  maxEstimatedCostUsd: z.number().finite().nonnegative().max(1).default(1),
  maxDurationMs: z.number().int().min(1).max(1_800_000).default(1_800_000),
  oracleTimeoutMs: z.number().int().min(1).max(120_000).default(120_000),
  llmTimeoutMs: z.number().int().min(1).max(120_000).default(120_000),
  jevTimeoutMs: z.number().int().min(1).max(30_000).default(30_000),
}).strict();
const plans = new WeakSet<object>();
function immutable<T>(value: T): T { const result = structuredClone(value); const visit = (item: unknown) => { if (item && typeof item === 'object') { Object.values(item).forEach(visit); Object.freeze(item); } }; visit(result); return result; }

/** Pure new configuration version. Defaults here are explicit NEW proposed
 * limits, never defaults substituted for a missing public model snapshot. */
export function prepareObservedVerifierStudyPlan(input: {
  executionSource: ObservedStudySource; configuration: { verifier: unknown; jev: unknown }; source: unknown;
  poolIds?: VerifierChallengePoolId[]; strategies?: VerifierStudyStrategy[]; limits?: z.input<typeof limitsSchema>;
}) {
  if (Object.keys(input).some(key => !['executionSource', 'configuration', 'source', 'poolIds', 'strategies', 'limits'].includes(key))) throw new Error('Unsupported observed study plan field');
  if (!input.configuration || Object.keys(input.configuration).sort().join(',') !== 'jev,verifier') throw new Error('Unsupported observed configuration fields');
  if (!['real-provider', 'loopback-engineering'].includes(input.executionSource)) throw new Error('Invalid observed study evidence source');
  const configuration = verifierStudyPublicConfiguration(input.configuration); const source = sourceSchema.parse(input.source);
  const poolIds = input.poolIds ?? [...VERIFIER_CHALLENGE_IDS]; const strategies = input.strategies ?? ['baseline', 'llm', 'jev-cascade'];
  if (!poolIds.length || poolIds.length > 18 || new Set(poolIds).size !== poolIds.length || poolIds.some(id => !VERIFIER_CHALLENGE_IDS.includes(id))) throw new Error('Invalid fixed observed study pool schedule');
  if (!strategies.length || strategies.length > 3 || new Set(strategies).size !== strategies.length || strategies.some(value => !['baseline', 'llm', 'jev-cascade'].includes(value))) throw new Error('Invalid observed strategy schedule');
  if (input.executionSource === 'real-provider' && (JSON.stringify(poolIds) !== JSON.stringify(VERIFIER_CHALLENGE_IDS)
    || JSON.stringify(strategies) !== JSON.stringify(['baseline', 'llm', 'jev-cascade']) || !source.clean
    || !configuration.verifier.hasApiKey || !configuration.jev.enabled || !configuration.jev.hasApiKey || configuration.jev.maxRequests < 18)) throw new Error('Paid study requires the complete fixed 18-pool A/B/C schedule, complete settings and clean source');
  const limits = limitsSchema.parse(input.limits ?? {});
  // Jev page timeout is part of configuration; never silently increase it.
  if (limits.jevTimeoutMs > configuration.jev.timeoutMs) throw new Error('Observed Jev deadline exceeds its frozen page setting');
  const reservations = {
    llm: { inputTokens: 61_440, outputTokens: 4096, timeoutMs: limits.llmTimeoutMs,
      estimatedCostUsd: (61_440 * configuration.verifier.pricing!.inputPerMillion + 4096 * configuration.verifier.pricing!.outputPerMillion) / 1_000_000,
      outputPolicy: 'vendor-request-max_tokens-4096-and-observed-stop' },
    jev: { inputTokens: 65_536, outputTokens: 4096, timeoutMs: limits.jevTimeoutMs,
      estimatedCostUsd: 65_536 * configuration.jev.inputPerMillion / 1_000_000,
      outputPolicy: '4096-post-response-observation-stop-only; vendor-output-limit-unknown' },
  };
  const requests = poolIds.map(id => verifierPreparationRequests(id));
  requests.forEach(request => prepareVerifierWirePreflight(request.logicalLlm, { provider: 'deepseek', upstreamBaseUrl: configuration.verifier.baseUrl,
    modelId: configuration.verifier.modelId, maxOutputTokens: 4096, timeoutMs: 120_000 }));
  const plan = { version: OBSERVED_STUDY_POLICY_VERSION, planId: randomUUID(), executionSource: input.executionSource,
    configuration, configurationSha256: hash(configuration), source, sourceSha256: hash(source), poolIds, strategies, limits, reservations,
    limitsSha256: hash({ limits, reservations }), requestSetSha256: hash(requests),
    poolBindings: requests.map(request => ({ poolId: request.metadata.poolId, requestSha256: hash(request),
      logicalLlmSha256: request.metadata.logicalLlmPromptSha256, jevRequestSha256: request.metadata.jevRequestSha256 })),
    consentScope: 'single-new-study-no-auto-resume', candidateRandomization: 'not-performed', seed: null,
    accountingBoundary: 'Declared-rate estimates and engineering reservations, not guaranteed provider bill/token caps. Observed overrun is retained and stops subsequent requests.',
    httpBoundary: 'Observed proxy/fetch dispatch attempts, not remote receipt or billing confirmation. In-flight missing observation remains unknown.',
  };
  const frozen = immutable({ ...plan, frozenStudySha256: hash(plan) }); plans.add(frozen); return frozen;
}
export type ObservedVerifierStudyPlan = ReturnType<typeof prepareObservedVerifierStudyPlan>;
export function assertObservedVerifierStudyPlan(value: ObservedVerifierStudyPlan) {
  if (!plans.has(value)) throw new Error('Observed study requires a fresh immutable plan from the trusted preparation factory');
  const { frozenStudySha256, ...body } = value;
  if (hash(body) !== frozenStudySha256) throw new Error('Observed study freeze hash changed');
}
const consentSchema = z.object({ id: z.string().uuid(), frozenStudySha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['granted', 'engineering-only']), scope: z.literal('single-new-study-no-auto-resume'), approvedAt: z.string().datetime(),
  estimatedBillingOnlyAcknowledged: z.literal(true), jevOutputObservationOnlyAcknowledged: z.literal(true),
}).strict();
export type ObservedStudyConsent = z.infer<typeof consentSchema>;
const consumed = new Set<string>();
export function consumeObservedStudyConsent(plan: ObservedVerifierStudyPlan, input: unknown) {
  assertObservedVerifierStudyPlan(plan); const consent = consentSchema.parse(input);
  if (consent.frozenStudySha256 !== plan.frozenStudySha256 || consent.status !== (plan.executionSource === 'real-provider' ? 'granted' : 'engineering-only')
    || Date.parse(consent.approvedAt) > Date.now() || Date.now() - Date.parse(consent.approvedAt) > 3_600_000 || consumed.has(consent.id)) throw new Error('Missing, stale, reused or wrong-freeze study consent');
  consumed.add(consent.id); return immutable(consent);
}
