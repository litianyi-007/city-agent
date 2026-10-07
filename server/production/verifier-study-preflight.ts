import { createHash } from 'node:crypto';
import { z } from 'zod';
import { productionAgentInputSchema } from '../../shared/production-schema.js';
import { JEV_ENDPOINT, jevConfigSchema } from '../../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS } from '../../shared/production-verifier-challenge-corpus.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import { prepareVerifierWirePreflight, type captureVerifierWirePreflight } from './verifier-wire-preflight.js';

export const VERIFIER_STUDY_PREFLIGHT_VERSION = 'verifier-study-free-proposal-v1';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const publicAgentSchema = productionAgentInputSchema.omit({ apiKey: true }).extend({
  id: z.string().uuid(), hasApiKey: z.boolean(), role: z.literal('verifier'),
  provider: z.literal('deepseek'), enabled: z.literal(true),
}).strict();
const publicJevSchema = jevConfigSchema.extend({ hasApiKey: z.boolean() }).strict();
const sourceSchema = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), clean: z.boolean(),
  hashes: z.record(z.string().regex(/^[A-Za-z0-9_./-]+$/), z.string().regex(/^[a-f0-9]{64}$/)).refine(value => Object.keys(value).length > 0),
}).strict();
export type VerifierWireCapture = Awaited<ReturnType<typeof captureVerifierWirePreflight>>;
export const STUDY_PROPOSED_OUTPUT_TOKENS = 4096;
export const STUDY_PROPOSED_LLM_TIMEOUT_MS = 120_000;

export function verifierStudyPublicConfiguration(input: { verifier: unknown; jev: unknown }) {
  const requireKeys = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object' || keys.some(key => !Object.hasOwn(value, key) || (value as Record<string, unknown>)[key] === undefined)) throw new Error('Incomplete public configuration; defaults are not a frozen snapshot');
  };
  requireKeys(input.verifier, ['id', 'name', 'role', 'provider', 'baseUrl', 'modelId', 'enabled', 'hasApiKey', 'pricing']);
  requireKeys(input.jev, ['enabled', 'modelId', 'minConfidence', 'minScore', 'inputPerMillion', 'outputPerMillion', 'currency', 'maxRequests', 'timeoutMs', 'hasApiKey']);
  const verifier = publicAgentSchema.parse(input.verifier); const jev = publicJevSchema.parse(input.jev);
  if (!verifier.pricing || verifier.pricing.currency !== 'USD' || jev.outputPerMillion !== 0) throw new Error('Explicit USD rates and the validated free-output Jev policy are required');
  if (jev.minConfidence !== 0.5 || jev.minScore !== 3) throw new Error('Current study strategy fixes Jev thresholds at 0.5/3; do not silently substitute page settings');
  return { verifier, jev };
}
function immutable<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (item: unknown) => { if (item && typeof item === 'object') { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } };
  freeze(copied); return copied;
}

/** Credential-free FREE preparation. Never imports a secret store or provides
 * a live execution/authorization path. The proposal remains blocked even after
 * local captures pass: provider token bounds, consent and live adapter are NOT
 * established by loopback SDK evidence. */
export function prepareVerifierStudyProposal(input: {
  verifier: unknown; jev: unknown; source: unknown;
  captures: Array<{ poolId: string; result: VerifierWireCapture }>;
}) {
  if (Object.keys(input).sort().join(',') !== 'captures,jev,source,verifier') throw new Error('Unknown proposal fields; credentials/authorization are not accepted');
  const { verifier, jev } = verifierStudyPublicConfiguration(input);
  const source = sourceSchema.parse(input.source);
  if (input.captures.length !== VERIFIER_CHALLENGE_IDS.length || new Set(input.captures.map(item => item.poolId)).size !== VERIFIER_CHALLENGE_IDS.length
    || input.captures.some(item => !VERIFIER_CHALLENGE_IDS.includes(item.poolId as typeof VERIFIER_CHALLENGE_IDS[number]))) throw new Error('Exactly the 18 fixed, unique corpus pools are required');
  const options = { provider: 'deepseek' as const, upstreamBaseUrl: verifier.baseUrl, modelId: verifier.modelId,
    maxOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS, timeoutMs: STUDY_PROPOSED_LLM_TIMEOUT_MS };
  const invocationIds = new Set<string>();
  const pools = VERIFIER_CHALLENGE_IDS.map(poolId => {
    const requests = verifierPreparationRequests(poolId); const expected = prepareVerifierWirePreflight(requests.logicalLlm, options);
    const capture = input.captures.find(item => item.poolId === poolId)!.result;
    const wireKeys = ['body', 'bodyUtf8', 'bodySha256', 'bodyBytes', 'bodyCanonicalSha256', 'validated', 'exactLiteralMessages'];
    if (!capture?.wire || Object.keys(capture.wire).length !== wireKeys.length || Object.keys(capture.wire).some(key => !wireKeys.includes(key))) throw new Error('Unknown/missing retained wire fields; secret metadata is not accepted');
    if (!capture || capture.status !== 'completed' || capture.scenario !== 'success' || capture.wire?.validated !== true || capture.wire.exactLiteralMessages !== true
      || !z.string().uuid().safeParse(capture.invocationId).success
      || capture.logicalPromptSha256 !== requests.metadata.logicalLlmPromptSha256
      || capture.expectedBodyCanonicalSha256 !== expected.expectedBodyCanonicalSha256
      || capture.wire.bodyCanonicalSha256 !== expected.expectedBodyCanonicalSha256
      || digest(capture.configuration) !== digest(expected.configuration)
      || capture.wire.bodySha256 !== createHash('sha256').update(capture.wire.bodyUtf8).digest('hex')
      || capture.wire.bodyBytes !== Buffer.byteLength(capture.wire.bodyUtf8, 'utf8')
      || capture.wire.bodyUtf8 !== JSON.stringify(capture.wire.body)
      || capture.wire.bodyBytes !== expected.expectedBodyBytes
      || JSON.stringify(JSON.parse(capture.wire.bodyUtf8)) !== JSON.stringify(capture.wire.body)
      || capture.transport.localProviderPosts !== 1 || capture.transport.externalProviderPosts !== 0 || capture.transport.fixtureServerClosed !== true
      || capture.transport.providerResponseDestroyedAfterCleanup !== true || invocationIds.has(capture.invocationId)) throw new Error(`Incomplete, altered or reused loopback evidence: ${poolId}`);
    // Revalidate the retained complete body, rather than trusting its claimed hash.
    const body = capture.wire.body;
    if (JSON.stringify(body.messages) !== JSON.stringify(expected.expectedBody.messages)
      || digest(body) !== digest(JSON.parse(capture.wire.bodyUtf8))) throw new Error('Retained full request differs from literal prompt');
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
    if (canonical(body) !== canonical(expected.expectedBody)) throw new Error('Unexpected provider parameter or request alteration');
    invocationIds.add(capture.invocationId);
    if (requests.metadata.jevPerQuestionBytes > 32_000 || requests.metadata.jevTotalBytes > 64_000) throw new Error('Jev local byte precheck failed');
    const llmInputReservation = expected.reservation.inputTokens;
    const jevInputEngineeringReservation = bytes(requests.jev) + 1024;
    const llmEstimatedReservation = (llmInputReservation * verifier.pricing!.inputPerMillion + STUDY_PROPOSED_OUTPUT_TOKENS * verifier.pricing!.outputPerMillion) / 1_000_000;
    const jevEstimatedReservation = jevInputEngineeringReservation * jev.inputPerMillion / 1_000_000;
    return { poolId, requests, invocationId: capture.invocationId, wire: {
      body: capture.wire.body, bodyUtf8: capture.wire.bodyUtf8, bodySha256: capture.wire.bodySha256,
      bodyBytes: capture.wire.bodyBytes, bodyCanonicalSha256: capture.wire.bodyCanonicalSha256,
      validated: capture.wire.validated, exactLiteralMessages: capture.wire.exactLiteralMessages },
      candidateOrder: requests.metadata.candidates.map(candidate => candidate.id),
      reservations: { llmInputTokens: llmInputReservation, llmOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS,
        jevInputEngineeringTokens: jevInputEngineeringReservation, jevOutputTokens: null,
        llmEstimatedCostUsd: llmEstimatedReservation, jevEstimatedCostUsd: jevEstimatedReservation,
        method: 'Complete UTF-8 serialized request bytes + 1024 overhead. Planning surrogate, not tokenizer/billing proof.' } };
  });
  const llmInputCeiling = 65536 - STUDY_PROPOSED_OUTPUT_TOKENS;
  const llmReservationCost = (llmInputCeiling * verifier.pricing!.inputPerMillion + STUDY_PROPOSED_OUTPUT_TOKENS * verifier.pricing!.outputPerMillion) / 1_000_000;
  const jevInputCeiling = 65536;
  const jevReservationCost = jevInputCeiling * jev.inputPerMillion / 1_000_000;
  const ceilingEstimate = 36 * llmReservationCost + 18 * jevReservationCost;
  const blockers = ['paid-study-consent-not-granted', 'real-study-adapter-not-implemented',
    'provider-tokenizer-and-billable-input-upper-bound-not-verified', 'jev-output-token-upper-bound-not-verified'];
  if (!source.clean) blockers.push('source-worktree-dirty');
  if (!verifier.hasApiKey || !jev.enabled || !jev.hasApiKey) blockers.push('page-configuration-incomplete');
  if (jev.maxRequests < 18) blockers.push('jev-configured-request-limit-below-18');
  const proposal = { version: VERIFIER_STUDY_PREFLIGHT_VERSION, status: 'fee-unapproved-proposal' as const,
    readyForPaidExecution: false, authorization: null, blockers, source,
    models: { verifier, jev: { endpoint: JEV_ENDPOINT, ...jev }, wireOptions: options,
      omittedParameters: { temperature: 'provider-default/unknown; not configurable in locked Harness', top_p: 'provider-default/unknown', seed: 'provider-default/unknown' },
      responseIdentity: 'unknown until real response; fixed model ID does not freeze provider weights',
      credentialEvidence: 'hasApiKey is configuration presence only, not authenticated availability' },
    configurationSha256: digest({ verifier, jev, options }),
    ordering: { pools: [...VERIFIER_CHALLENGE_IDS], strategies: ['baseline', 'llm', 'jev-cascade'],
      schedule: pools.flatMap(pool => ['baseline', 'llm', 'jev-cascade'].map(strategy => ({ poolId: pool.poolId, strategy }))),
      candidateRandomization: 'not-performed', seed: null, policy: 'Existing source candidate order retained; no claim of randomization. All blind decisions before all Oracles.' },
    pools, requestSetSha256: digest(pools.map(pool => pool.requests)),
    fullWireSetSha256: digest(pools.map(pool => ({ poolId: pool.poolId, wire: pool.wire }))),
    proposedLimits: { intentMax: 54, llmIntentMax: 36, jevIntentMax: 18, proposedHttpAttemptMax: 54,
      retryMax: 0, candidateRepairsMax: 0, cachePolicy: 'bypass-new-session-per-call',
      llmOutputTokens: STUDY_PROPOSED_OUTPUT_TOKENS, llmInputCeiling, jevInputCeiling, jevOutputTokenCeiling: null,
      llmTimeoutMs: STUDY_PROPOSED_LLM_TIMEOUT_MS, jevTimeoutMs: jev.timeoutMs, oracleTimeoutMs: 120_000, wholeBatchTimeoutMs: 1_800_000,
      wholeBatchRequestedCostUsd: Math.max(1, Math.ceil(ceilingEstimate * 100) / 100),
      engineeringCeilingEstimateUsd: ceilingEstimate,
      wholeBatchByteSurrogateEstimateUsd: pools.reduce((sum, pool) => sum + 2 * pool.reservations.llmEstimatedCostUsd + pool.reservations.jevEstimatedCostUsd, 0),
      maxPoolByteSurrogateEstimateUsd: Math.max(...pools.map(pool => 2 * pool.reservations.llmEstimatedCostUsd + pool.reservations.jevEstimatedCostUsd)),
      boundStatus: 'proposal-only-not-validated-billing-or-token-hard-cap',
      timePolicy: '30-minute whole-batch stop may leave scheduled items not-started; no promise of completing all 54 intents.' },
    decisionRules: { minimumLlmScore: 3, minimumJevScore: jev.minScore, minimumJevConcentration: jev.minConfidence,
      jevUpgradeMax: 1, independentFallbackPrompt: 'exact same B prompt/config, no Jev opinion or Oracle answer',
      stop: ['unknown/invalid usage', 'fatal protocol error', 'cancellation/deadline', 'configuration/source/hash drift', 'ledger write failure', 'reservation/actual budget exceeded'],
      resumption: 'No automatic paid replay; new explicitly authorized operation required.' },
    effectCriteria: { quality: 'Report paired good/bad/abstain/protocol-error/unknown results; no presumption that Jev wins.',
      cost: 'Claim cheaper only with complete observed usage, same frozen challenge set and total C cost below B; unknown total cannot establish savings.',
      sampleBoundary: '18 hand-authored pools, not real business requirements or autonomous product deliveries.' },
    evidence: { source: 'offline-sdk-loopback-fixture', externalProviderHttpAttempts: 0,
      localProviderHttpAttempts: 18, actualProviderCost: 0, actualModelUsage: null, actualModelQualityEffect: null,
      feeBoundary: 'Known zero external provider fee for this free CLI only; machine/outer development costs not measured.' } };
  return immutable({ ...proposal, proposalSha256: digest(proposal) });
}
