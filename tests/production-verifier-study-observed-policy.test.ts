import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  OBSERVED_STUDY_POLICY_VERSION,
  assertObservedVerifierStudyPlan,
  consumeObservedStudyConsent,
  prepareObservedVerifierStudyPlan,
  type ObservedStudySource,
  type ObservedVerifierStudyPlan,
} from '../server/production/verifier-study-observed-policy.ts';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.ts';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.ts';
import { jevConfigSchema } from '../shared/jev-schema.ts';

type PlanInput = Parameters<typeof prepareObservedVerifierStudyPlan>[0];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Public metadata and synthetic source hashes only. No store, credential,
// model, network, browser or transport is consulted by these policy tests.
const fixture = (executionSource: ObservedStudySource = 'loopback-engineering') => ({
  executionSource,
  configuration: {
    verifier: { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Verifier', role: 'verifier',
      enabled: true, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
      pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } },
    jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true },
  },
  source: { commit: 'a'.repeat(40), clean: true, hashes: { 'server/harness.ts': 'b'.repeat(64) } },
});
const prepare = (extra: Partial<PlanInput> = {}) => prepareObservedVerifierStudyPlan({ ...fixture(), ...extra });
const consentFor = (plan: ObservedVerifierStudyPlan, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), frozenStudySha256: plan.frozenStudySha256,
  status: plan.executionSource === 'real-provider' ? 'granted' : 'engineering-only',
  scope: 'single-new-study-no-auto-resume', approvedAt: new Date().toISOString(),
  estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true,
  ...extra,
});
const assertDeepFrozen = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
};

test('observed plan freezes every nested input and independently binds all 18 complete requests', () => {
  const input = { ...fixture(), poolIds: [...VERIFIER_CHALLENGE_IDS], strategies: ['baseline', 'llm', 'jev-cascade'] as PlanInput['strategies'] };
  const plan = prepareObservedVerifierStudyPlan(input);
  assert.equal(plan.version, OBSERVED_STUDY_POLICY_VERSION);
  assert.equal(plan.executionSource, 'loopback-engineering');
  assert.deepEqual(plan.poolIds, VERIFIER_CHALLENGE_IDS);
  assert.deepEqual(plan.strategies, ['baseline', 'llm', 'jev-cascade']);
  assert.equal(plan.poolBindings.length, 18);
  assert.equal(plan.poolIds.length * plan.strategies.length, 54);
  assert.equal(plan.candidateRandomization, 'not-performed');
  assert.equal(plan.seed, null);
  assert.match(plan.accountingBoundary, /not guaranteed provider bill\/token caps/);
  assert.match(plan.httpBoundary, /not remote receipt or billing confirmation/);
  assertDeepFrozen(plan);
  const { frozenStudySha256, ...body } = plan;
  assert.equal(frozenStudySha256, digest(body));
  assert.equal(plan.configurationSha256, digest(plan.configuration));
  assert.equal(plan.sourceSha256, digest(plan.source));
  assert.equal(plan.limitsSha256, digest({ limits: plan.limits, reservations: plan.reservations }));
  const requests = VERIFIER_CHALLENGE_IDS.map(id => verifierPreparationRequests(id));
  assert.equal(plan.requestSetSha256, digest(requests));
  for (const [index, binding] of plan.poolBindings.entries()) {
    assert.equal(binding.poolId, requests[index].metadata.poolId);
    assert.equal(binding.requestSha256, digest(requests[index]));
    assert.equal(binding.logicalLlmSha256, requests[index].metadata.logicalLlmPromptSha256);
    assert.equal(binding.jevRequestSha256, requests[index].metadata.jevRequestSha256);
  }
  const snapshot = JSON.stringify(plan);
  input.configuration.verifier.modelId = 'mutated';
  input.configuration.verifier.pricing.outputPerMillion = 999;
  input.source.hashes['server/harness.ts'] = 'c'.repeat(64);
  input.poolIds.pop(); input.strategies!.reverse();
  assert.equal(JSON.stringify(plan), snapshot);
  assert.throws(() => { plan.poolBindings[0].requestSha256 = 'd'.repeat(64); }, TypeError);
  assert.throws(() => { plan.configuration.jev.timeoutMs = 1000; }, TypeError);
  assert.doesNotThrow(() => assertObservedVerifierStudyPlan(plan));
});

test('plan brand rejects copied, rehashed, serialized and inherited reconstruction across restart', () => {
  const plan = prepare();
  for (const copy of [structuredClone(plan), JSON.parse(JSON.stringify(plan)), { ...plan }, Object.create(plan)]) {
    assert.throws(() => assertObservedVerifierStudyPlan(copy), /trusted preparation factory/);
    assert.throws(() => consumeObservedStudyConsent(copy, consentFor(plan)), /trusted preparation factory/);
  }
  const forged = structuredClone(plan);
  forged.executionSource = 'real-provider';
  const { frozenStudySha256: _oldHash, ...body } = forged;
  forged.frozenStudySha256 = digest(body);
  assert.throws(() => assertObservedVerifierStudyPlan(forged), /trusted preparation factory/);
  const next = prepare();
  assert.notEqual(next.planId, plan.planId);
  assert.notEqual(next.frozenStudySha256, plan.frozenStudySha256);
  assert.throws(() => consumeObservedStudyConsent(next, consentFor(plan)), /wrong-freeze/);
});

test('real-provider plan requires clean source and the exact fixed full A/B/C order', () => {
  const real = fixture('real-provider');
  const plan = prepareObservedVerifierStudyPlan(real);
  assert.equal(plan.executionSource, 'real-provider');
  assert.deepEqual(plan.poolIds, VERIFIER_CHALLENGE_IDS);
  const schedules: Partial<PlanInput>[] = [
    { poolIds: [...VERIFIER_CHALLENGE_IDS].slice(0, -1) },
    { poolIds: [...VERIFIER_CHALLENGE_IDS].reverse() },
    { strategies: ['baseline', 'llm'] },
    { strategies: ['llm', 'baseline', 'jev-cascade'] },
    { source: { ...real.source, clean: false } },
  ];
  for (const extra of schedules) assert.throws(() => prepareObservedVerifierStudyPlan({ ...fixture('real-provider'), ...extra }), /complete fixed 18-pool/);
  const subset = prepare({ poolIds: [VERIFIER_CHALLENGE_IDS[0]], strategies: ['jev-cascade'], source: { ...real.source, clean: false } });
  assert.equal(subset.executionSource, 'loopback-engineering');
  assert.deepEqual(subset.poolIds, [VERIFIER_CHALLENGE_IDS[0]]);
  assert.deepEqual(subset.strategies, ['jev-cascade']);
  for (const extra of [
    { poolIds: [] }, { poolIds: [VERIFIER_CHALLENGE_IDS[0], VERIFIER_CHALLENGE_IDS[0]] },
    { poolIds: ['not-a-fixed-pool'] }, { strategies: [] }, { strategies: ['llm', 'llm'] }, { strategies: ['unknown'] },
  ]) assert.throws(() => prepare(extra as Partial<PlanInput>));
  for (const change of [
    (input: ReturnType<typeof fixture>) => { input.configuration.verifier.hasApiKey = false; },
    (input: ReturnType<typeof fixture>) => { input.configuration.jev.hasApiKey = false; },
    (input: ReturnType<typeof fixture>) => { input.configuration.jev.enabled = false; },
    (input: ReturnType<typeof fixture>) => { input.configuration.jev.maxRequests = 17; },
  ]) {
    const input = fixture('real-provider'); change(input);
    assert.throws(() => prepareObservedVerifierStudyPlan(input));
  }
});

test('unknown fields, credentials, source traversal and incomplete public snapshots fail closed', () => {
  assert.throws(() => prepareObservedVerifierStudyPlan({ ...fixture(), authorization: true } as PlanInput), /Unsupported/);
  assert.throws(() => prepareObservedVerifierStudyPlan({ ...fixture(), executionSource: 'injected-test' } as unknown as PlanInput), /Invalid observed/);
  const unknownConfiguration = fixture();
  Object.assign(unknownConfiguration.configuration, { apiKey: 'synthetic-extra-field-not-a-real-key' });
  assert.throws(() => prepareObservedVerifierStudyPlan(unknownConfiguration));
  for (const key of ['apiKey', 'authorization']) {
    const input = fixture(); Object.assign(input.configuration.verifier, { [key]: 'synthetic-extra-field-not-a-real-key' });
    assert.throws(() => prepareObservedVerifierStudyPlan(input));
  }
  for (const key of ['modelId', 'baseUrl', 'pricing', 'hasApiKey']) {
    const input = fixture(); delete (input.configuration.verifier as Record<string, unknown>)[key];
    assert.throws(() => prepareObservedVerifierStudyPlan(input), /Incomplete/);
    (input.configuration.verifier as Record<string, unknown>)[key] = undefined;
    assert.throws(() => prepareObservedVerifierStudyPlan(input), /Incomplete/);
  }
  for (const source of [
    { ...fixture().source, key: 'synthetic-extra-field-not-a-real-key' },
    { ...fixture().source, commit: 'not-a-commit' },
    { ...fixture().source, clean: 'true' },
    { ...fixture().source, hashes: {} },
    { ...fixture().source, hashes: { '../server/harness.ts': 'b'.repeat(64) } },
    { ...fixture().source, hashes: { '/server/harness.ts': 'b'.repeat(64) } },
    { ...fixture().source, hashes: { 'server//harness.ts': 'b'.repeat(64) } },
    { ...fixture().source, hashes: { 'server/./harness.ts': 'b'.repeat(64) } },
    { ...fixture().source, hashes: { 'server/harness.ts': 'not-a-hash' } },
    { ...fixture().source, hashes: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`source-${index}.ts`, 'b'.repeat(64)])) },
  ]) assert.throws(() => prepare({ source }));
  assert.throws(() => prepare({ limits: { extra: 1 } as PlanInput['limits'] }));
});

test('study budget defaults bind 1 USD, 30 minutes and the fixed engine context/output reservations', () => {
  const plan = prepare();
  assert.equal(plan.limits.maxCalls, 54);
  assert.equal(plan.limits.maxDurationMs, 1_800_000);
  assert.equal(plan.limits.maxEstimatedCostUsd, 1);
  assert.equal(plan.limits.maxInputTokens, 36 * 61_440 + 18 * 65_536);
  assert.equal(plan.limits.maxObservedOutputTokens, 54 * 4096);
  assert.equal(plan.reservations.llm.inputTokens, 61_440);
  assert.equal(plan.reservations.llm.outputTokens, 4096);
  assert.equal(plan.reservations.llm.inputTokens + plan.reservations.llm.outputTokens, 65_536);
  assert.equal(plan.reservations.llm.timeoutMs, 120_000);
  assert.equal(plan.reservations.jev.inputTokens, 65_536);
  assert.equal(plan.reservations.jev.outputTokens, 4096);
  assert.equal(plan.reservations.jev.timeoutMs, 30_000);
  assert.match(plan.reservations.llm.outputPolicy, /vendor-request-max_tokens-4096/);
  assert.match(plan.reservations.jev.outputPolicy, /post-response-observation-stop-only/);
  assert.match(plan.reservations.jev.outputPolicy, /vendor-output-limit-unknown/);
  assert.ok(Math.abs(plan.reservations.llm.estimatedCostUsd - (61_440 * 0.3 + 4096 * 1.2) / 1_000_000) < 1e-14);
  assert.ok(Math.abs(plan.reservations.jev.estimatedCostUsd - 65_536 * 0.042 / 1_000_000) < 1e-14);
  const estimate = 36 * plan.reservations.llm.estimatedCostUsd + 18 * plan.reservations.jev.estimatedCostUsd;
  assert.ok(Math.abs(estimate - 0.890044416) < 1e-12);
  // The observed boundary does not imply a vendor cap or truncate usage at 4096.
  assert.equal(plan.reservations.jev.outputTokens, 4096);
  assert.equal(4097 > plan.reservations.jev.outputTokens, true);
});

test('limits may shrink but cannot increase this study exposure or the frozen Jev page timeout', () => {
  const reduced = prepare({ limits: { maxCalls: 0, maxInputTokens: 0, maxObservedOutputTokens: 0,
    maxEstimatedCostUsd: 0, maxDurationMs: 1, oracleTimeoutMs: 1, llmTimeoutMs: 1, jevTimeoutMs: 1 } });
  assert.equal(reduced.limits.maxCalls, 0);
  assert.equal(reduced.reservations.llm.timeoutMs, 1);
  assert.equal(reduced.reservations.jev.timeoutMs, 1);
  for (const limits of [
    { maxCalls: 55 }, { maxCalls: -1 }, { maxCalls: 1.5 },
    { maxInputTokens: 3_391_489 }, { maxObservedOutputTokens: 221_185 },
    { maxEstimatedCostUsd: 1.000001 }, { maxEstimatedCostUsd: Number.NaN }, { maxEstimatedCostUsd: Number.POSITIVE_INFINITY },
    { maxDurationMs: 1_800_001 }, { maxDurationMs: 0 },
    { oracleTimeoutMs: 120_001 }, { llmTimeoutMs: 120_001 }, { jevTimeoutMs: 30_001 },
  ]) assert.throws(() => prepare({ limits }));
  const short = fixture(); short.configuration.jev.timeoutMs = 10_000;
  assert.throws(() => prepareObservedVerifierStudyPlan(short), /exceeds its frozen page setting/);
  const plan = prepareObservedVerifierStudyPlan({ ...short, limits: { jevTimeoutMs: 10_000 } });
  assert.equal(plan.reservations.jev.timeoutMs, 10_000);
  assert.equal(plan.configuration.jev.timeoutMs, 10_000);
  const priced = fixture(); priced.configuration.jev.outputPerMillion = 0.1;
  assert.throws(() => prepareObservedVerifierStudyPlan(priced), /free-output Jev policy/);
});

test('consent is exact-freeze, source-specific, fresh, explicitly acknowledged and single use', () => {
  const plan = prepare();
  const valid = consentFor(plan);
  const result = consumeObservedStudyConsent(plan, valid);
  assert.deepEqual(result, valid); assertDeepFrozen(result);
  assert.throws(() => consumeObservedStudyConsent(plan, structuredClone(valid)), /reused/);
  for (const change of [
    { frozenStudySha256: 'c'.repeat(64) }, { status: 'granted' },
    { approvedAt: new Date(Date.now() + 60_000).toISOString() },
    { approvedAt: new Date(Date.now() - 7_200_000).toISOString() },
    { estimatedBillingOnlyAcknowledged: false }, { estimatedBillingOnlyAcknowledged: 'true' },
    { jevOutputObservationOnlyAcknowledged: false }, { jevOutputObservationOnlyAcknowledged: 1 },
    { scope: 'resume-previous-study' }, { id: 'not-a-uuid' },
    { apiKey: 'synthetic-extra-field-not-a-real-key' }, { approvedAt: 'not-a-date' },
  ]) assert.throws(() => consumeObservedStudyConsent(plan, consentFor(plan, change)));
  const real = prepareObservedVerifierStudyPlan(fixture('real-provider'));
  assert.throws(() => consumeObservedStudyConsent(real, consentFor(real, { status: 'engineering-only' })), /wrong-freeze/);
  const grant = consumeObservedStudyConsent(real, consentFor(real));
  assert.equal(grant.status, 'granted');
  assert.equal(grant.frozenStudySha256, real.frozenStudySha256);
  assert.match(grant.scope, /no-auto-resume/);
});

test('changing models, prices, source, limits or deadline creates a new consent boundary', () => {
  const original = prepare();
  const before = consentFor(original);
  const variations: PlanInput[] = [];
  const model = fixture(); model.configuration.verifier.modelId = 'different-model-id'; variations.push(model);
  const price = fixture(); price.configuration.verifier.pricing.inputPerMillion = 0.15; variations.push(price);
  const source = fixture(); source.source.hashes['server/harness.ts'] = 'e'.repeat(64); variations.push(source);
  variations.push({ ...fixture(), limits: { maxCalls: 1 } });
  variations.push({ ...fixture(), limits: { maxDurationMs: 1000 } });
  for (const input of variations) {
    const changed = prepareObservedVerifierStudyPlan(input);
    assert.notEqual(changed.frozenStudySha256, original.frozenStudySha256);
    assert.throws(() => consumeObservedStudyConsent(changed, before), /wrong-freeze/);
  }
  assert.doesNotThrow(() => consumeObservedStudyConsent(original, before));
});
