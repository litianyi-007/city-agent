import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprint } from '../shared/evidence.ts';
import { assertTrialRequest, CONTRACT_TRIAL_AUTHORIZATION_ID, CONTRACT_TRIAL_MODEL, CONTRACT_TRIAL_SCOPE, validateTrialAuthorization, validateTrialRegistration } from '../shared/live-trial-authorization.ts';

function context() {
  const requests = ['child-snacks', 'pet-snacks'].flatMap(scenario => [
    ...Array.from({ length: 10 }, (_, index) => ({ requestId: `${scenario}.resident-${String(index + 1).padStart(3, '0')}`, scenario, purpose: 'resident', maxOutputTokens: 3000 })),
    { requestId: `planning.${scenario}`, scenario, purpose: 'planning', maxOutputTokens: 6000 },
    { requestId: `cors.${scenario}`, scenario, purpose: 'browser-cors', maxOutputTokens: 3000 },
  ]).map(request => { const systemPrompt = `system:${request.purpose}`; const userPrompt = `user:${request.requestId}`;
    return { ...request, systemPrompt, userPrompt, promptHash: fingerprint({ system: systemPrompt, user: userPrompt }) }; });
  const plan = { schemaVersion: 'live-business-plan-1.1', id: '2176d31a-7b3d-4ee0-89bc-d253db6c4862', authorizationId: CONTRACT_TRIAL_AUTHORIZATION_ID, scope: { ...CONTRACT_TRIAL_SCOPE }, model: { ...CONTRACT_TRIAL_MODEL }, requests, immutableExtraEvidence: { seed: 20261007 } };
  const approval = { schemaVersion: 'live-trial-approval-1.0', authorizationId: CONTRACT_TRIAL_AUTHORIZATION_ID, status: 'approved', approvedAt: '2026-10-07T01:00:00.000Z', confirmationReference: 'offline test receipt; not an actual user approval', scope: { ...CONTRACT_TRIAL_SCOPE } };
  const binding = { schemaVersion: 'live-trial-plan-authorization-1.0', authorizationId: CONTRACT_TRIAL_AUTHORIZATION_ID, approvalHash: fingerprint(approval), planHash: fingerprint(plan), authorizedAt: '2026-10-07T01:01:00.000Z' };
  return { plan, approval, binding };
}

test('exact independently-created approval and binding admit 20+2+2 frozen requests without I/O', () => {
  const { plan, approval, binding } = context();
  assert.equal(validateTrialAuthorization(approval, binding, plan).plan.requests.length, 24);
  const request = plan.requests[0];
  assert.equal(assertTrialRequest(plan, { requestId: request.requestId, purpose: 'resident', model: CONTRACT_TRIAL_MODEL,
    system: request.systemPrompt, user: request.userPrompt, maxOutputTokens: 3000 }).requestId, request.requestId);
});
test('missing, pending, wrong or broadened approval cannot authorize a new trial', () => {
  const { plan, approval, binding } = context();
  for (const value of [undefined, null, {}, { ...approval, status: 'pending' }, { ...approval, authorizationId: 'approved-2026-10-07-cny5-24' },
    { ...approval, scope: { ...approval.scope, budgetCny: 6 } }, { ...approval, scope: { ...approval.scope, maxProviderRequests: 25 } },
    { ...approval, scope: { ...approval.scope, allowExpansion: true } }, { ...approval, extraApproval: true }]) assert.throws(() => validateTrialAuthorization(value, binding, plan));
});
test('binding rejects altered source/plan evidence and approval even when request map remains valid', () => {
  const { plan, approval, binding } = context();
  assert.throws(() => validateTrialAuthorization(approval, binding, { ...plan, immutableExtraEvidence: { seed: 42 } }), /hash/);
  assert.throws(() => validateTrialAuthorization({ ...approval, confirmationReference: 'changed' }, binding, plan), /hash/);
  assert.throws(() => validateTrialAuthorization(approval, { ...binding, authorizedAt: '2026-10-07T00:59:00.000Z' }, plan), /早于/);
});
test('request admission rejects arbitrary IDs, duplicate residents, absent CORS, caps and rehashed prompt drift', () => {
  const { plan } = context();
  for (const mutate of [
    (value: typeof plan) => { value.requests.pop(); },
    (value: typeof plan) => { value.requests[1].requestId = value.requests[0].requestId; },
    (value: typeof plan) => { value.requests[0].requestId = 'arbitrary.resident-011'; },
    (value: typeof plan) => { value.requests[0].maxOutputTokens = 6000; },
    (value: typeof plan) => { value.requests[0].userPrompt = 'drift'; },
  ]) { const copy = structuredClone(plan); mutate(copy); assert.throws(() => validateTrialRegistration(copy)); }
});
test('outgoing transport must match registered prompt/model/purpose/cap, not just registered ID', () => {
  const { plan } = context(); const request = plan.requests[0];
  const input = { requestId: request.requestId, purpose: 'resident' as const, model: CONTRACT_TRIAL_MODEL, system: request.systemPrompt, user: request.userPrompt, maxOutputTokens: 3000 };
  for (const changed of [ { requestId: 'child-snacks.resident-011' }, { purpose: 'planning' as const }, { maxOutputTokens: 6000 }, { user: `${input.user}\nextra` },
    { model: { ...CONTRACT_TRIAL_MODEL, modelId: 'deepseek-pro' } }, { model: { ...CONTRACT_TRIAL_MODEL, apiKey: 'not-public-config' } } ]) assert.throws(() => assertTrialRequest(plan, { ...input, ...changed }), /出站请求/);
});
