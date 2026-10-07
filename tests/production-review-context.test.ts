import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectProductionReviewContext, REVIEW_CONTEXT_PROJECTION_VERSION } from '../server/production/review-context.ts';
import type { ProductionRun } from '../shared/production-schema.ts';

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('projection removes only prior control-plane regeneration and preserves complete business context and source objects', () => {
  const generationContext = { product: { goal: 'Keep ALL original requirements', regeneration: 'This nested business field must stay' }, research: { unknowns: ['Physical device not verified'] }, plan: { tasks: ['implement', 'test'] }, knownPlatform: { verified: false }, coverageContract: { owners: ['schema', 'CSS', 'mandatory'] }, frozenHash: 'immutable', remainingRepairs: 1, repairBudget: { used: 1, remaining: 1 }, regeneration: { rejectedCandidateIds: ['previous-candidate'], reason: 'Malformed previous output', rejectedCandidates: [{ rawOutputExcerpt: '{{cwd}} / 中文 / original bytes' }] } };
  const original = JSON.stringify(generationContext);
  const projection = projectProductionReviewContext(generationContext, ['current-role-call']);
  assert.equal(projection.version, REVIEW_CONTEXT_PROJECTION_VERSION);
  assert.equal(Object.hasOwn(projection.reviewContext, 'regeneration'), false);
  assert.deepEqual(projection.generationFeedbackReference, { version: REVIEW_CONTEXT_PROJECTION_VERSION, sourceRoleCallIds: ['current-role-call'], sourcePath: 'role-call.userPrompt.context.regeneration', sha256: sha256(JSON.stringify(generationContext.regeneration)), rejectedCandidateIds: ['previous-candidate'] });
  const withoutFeedback = { ...generationContext } as Record<string, unknown>; delete withoutFeedback.regeneration;
  const withoutReference = { ...projection.reviewContext }; delete withoutReference.generationFeedbackReference;
  assert.deepEqual(withoutReference, withoutFeedback);
  assert.equal(JSON.stringify(withoutReference), JSON.stringify(withoutFeedback), 'Every retained JSON field remains in original order and bytes');
  (projection.reviewContext.product as { goal: string }).goal = 'Changed projection only';
  projection.generationFeedbackReference!.rejectedCandidateIds[0] = 'Changed return metadata only';
  assert.equal(JSON.stringify(generationContext), original);
  assert.deepEqual((projection.reviewContext.generationFeedbackReference as { rejectedCandidateIds: string[] }).rejectedCandidateIds, ['previous-candidate']);
});

test('without regeneration the complete context is unchanged, and shared references do not alias the original', () => {
  const context = { goal: 'No prior rejection', nested: { regeneration: 'Business text, not control-plane feedback' }, gate: { checks: ['frozen'] } };
  const projection = projectProductionReviewContext(context);
  assert.equal(projection.generationFeedbackReference, null);
  assert.equal(JSON.stringify(projection.reviewContext), JSON.stringify(context));
  (projection.reviewContext.gate as { checks: string[] }).checks.push('projection only');
  assert.deepEqual(context.gate.checks, ['frozen']);
});

test('invalid or ambiguous provenance and non-JSON contexts fail closed instead of silently dropping fields', () => {
  const feedback = { regeneration: { rejectedCandidateIds: ['rejected'] } };
  assert.throws(() => projectProductionReviewContext(feedback), /source role call IDs/);
  assert.throws(() => projectProductionReviewContext(feedback, ['same', 'same']), /source role call IDs/);
  assert.throws(() => projectProductionReviewContext({ regeneration: { rejectedCandidateIds: [] } }, ['source']), /rejected candidate provenance/);
  assert.throws(() => projectProductionReviewContext({ regeneration: null }, ['source']), /rejected candidate provenance/);
  assert.throws(() => projectProductionReviewContext({ generationFeedbackReference: {} }), /reserved/);
  assert.throws(() => projectProductionReviewContext({ discarded: undefined }), /acyclic JSON/);
  assert.throws(() => projectProductionReviewContext({ invalid: Number.POSITIVE_INFINITY }), /acyclic JSON/);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.throws(() => projectProductionReviewContext(circular), /acyclic JSON/);
});

test('CAMERA06 accepted-correction counterfactual review fits existing caps without changing candidate, business data or historical bytes', t => {
  const historicalPath = new URL('../docs/production/experiments/CAMERA-06/run.json', import.meta.url);
  const originalBytes = readFileSync(historicalPath);
  assert.equal(sha256(originalBytes), '3c231fc1f30932899d93488948ed6d381d9bf10d4d02fbdd95d7b2b680960394');
  const run = JSON.parse(originalBytes.toString('utf8')) as ProductionRun;
  const originalRequest = run.jevCalls!.find(call => call.phase === 'acceptance')!.evaluation.requestSnapshot!;
  const sourceCall = run.calls.find(call => call.role === 'tester' && call.phase === 'acceptance' && !call.error)!;
  const generationContext = originalRequest.state.reviewContext as Record<string, unknown>;
  assert.deepEqual(JSON.parse(sourceCall.userPrompt).context, generationContext, 'Reference points to the actual corrected tester generation input');
  const projection = projectProductionReviewContext(generationContext, [sourceCall.id]);
  const request = structuredClone(originalRequest); request.state.reviewContext = projection.reviewContext;
  const perQuestionBefore = Math.max(...Object.values(originalRequest.questions).map(question => size(originalRequest.state) + size(question)));
  const perQuestionAfter = Math.max(...Object.values(request.questions).map(question => size(request.state) + size(question)));
  assert.equal(size(originalRequest), 36436); assert.equal(perQuestionBefore, 33774);
  assert.ok(perQuestionAfter <= 32000, `Projected state + largest question ${perQuestionAfter} exceeds unchanged 32000 cap`);
  assert.ok(size(request) <= 64000, 'Complete projected request still uses the original 64000 cap');
  assert.equal(JSON.stringify(request.state.candidates), JSON.stringify(originalRequest.state.candidates));
  for (const key of Object.keys(originalRequest.state).filter(key => key !== 'reviewContext')) assert.equal(JSON.stringify((request.state as unknown as Record<string, unknown>)[key]), JSON.stringify((originalRequest.state as unknown as Record<string, unknown>)[key]));
  for (const [key, value] of Object.entries(generationContext).filter(([key]) => key !== 'regeneration')) assert.equal(JSON.stringify(projection.reviewContext[key]), JSON.stringify(value));
  assert.equal(projection.generationFeedbackReference!.sha256, sha256(JSON.stringify(generationContext.regeneration)));
  assert.deepEqual(readFileSync(historicalPath), originalBytes);
  t.diagnostic(`Free counterfactual only: original total=${size(originalRequest)}, maxPerQuestion=${perQuestionBefore}; projected total=${size(request)}, state=${size(request.state)}, maxPerQuestion=${perQuestionAfter}, 32000 margin=${32000 - perQuestionAfter}. No HTTP/model/browser/real credentials; not a successful historical run or a claim of lossless removal of business content.`);
});
