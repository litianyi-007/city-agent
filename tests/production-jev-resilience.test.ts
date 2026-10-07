import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { productionApiKeySchema, productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation, type SecretJevConfig } from '../shared/jev-schema.js';
import { createProductionService } from '../server/production/index.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import { codeSchema, contractProfile, OUTPUT_CONTRACT_VERSION, outputContractSnapshot, planSchema, researchSchema, testsSchema, verifierSchema } from '../server/production/contracts.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { runRole, RoleResult } from '../server/harness.js';

const result = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Injected free engineering oracle; no model HTTP' });
const review = (prompt: string, decision: 'accept' | 'abstain' = 'accept') => {
  const data = JSON.parse(prompt);
  return result({ decision, selectedCandidateId: decision === 'accept' ? data.candidates[0].id : null, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: decision === 'accept' ? 4 : 1, reason: 'Explicit injected oracle, not demonstrated model judgment' })), reason: 'Independent fixture decision; immutable Gate' });
};
const roleCall: typeof runRole = async (_agent, system, prompt) => {
  const data = JSON.parse(prompt);
  if (system.startsWith('你是独立质量Verifier')) return review(prompt);
  if (system.includes('"goal"')) return result({ goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] });
  if (system.includes('"observations"')) return result({ observations: ['Implement actual task output and exact count according to supplied acceptance.'], constraints: ['Offline execution and frozen tests only.'], unknowns: ['real model reliability unverified'] });
  if (system.includes('"decision"')) return result({ decision: 'proceed', summary: 'A bounded plan or actual Gate feedback', tasks: [{ id: 'work', owner: 'developer', description: 'Implement the frozen contract' }], risks: [] });
  if (system.includes('"checks"')) return result({ checks: demoChecks('create') });
  return result({ html: demoHtml(data.input) });
};
function evaluation(config: SecretJevConfig, context: JevCandidateContext, status: 'accepted' | 'drift' = 'accepted'): JevEvaluation {
  return { policyVersion: JEV_POLICY_VERSION, status: status === 'drift' ? 'error' : 'accepted', selectedCandidateId: status === 'drift' ? null : context.candidates[0].id, reason: status === 'drift' ? 'Injected trusted derived mean drift' : 'Injected accepted evaluation', ...(status === 'drift' ? { errorKind: 'arithmetic-drift' as const, diagnostics: [{ code: 'score-mean-drift' as const, answerId: 'c0_scope' }] } : {}), requestSnapshot: buildJevCandidateRequest(config.modelId, context), rawResponse: { preservedRawMarker: 'discarded-jev-provider-score-not-authority' }, scores: [], choice: null, usage: { inputTokens: 100, outputTokens: 0, estimatedCost: 0.0000042, currency: 'USD', complete: true }, modelIdRequested: config.modelId, modelIdReturned: config.modelId, httpStatus: null, providerRequests: 0, durationMs: 1 };
}
const driftOnce: NonNullable<ProductionOptions['jevCall']> = async (config, context) => evaluation(config, context, context.phase === 'product' ? 'drift' : 'accepted');
function setup(t: TestContext, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-jev-v3-unit-'));
  const service = createProductionService(directory, { roleCall, jevCall: driftOnce, acceptancePreflight: async () => ({ valid: true, errors: [] }), gate: async () => ({ passed: true, checks: [{ name: 'Injected Gate, not real delivery evidence', passed: true }] }), ...options });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `jev-v3-unit-${agent.role}-not-real-credential`, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } });
  service.store.patchJevConfig({ enabled: true, apiKey: 'jev-v3-unit-credential-not-real', minScore: 3, minConfidence: 0.5 });
  const queue = (overrides: Record<string, unknown> = {}) => {
    const input = productionRunInputSchema.parse({ mode: 'live', verifierEngine: 'jev-cascade', brief: 'Build a reusable task list', budgetAuthorized: true, agentIds: service.store.agents().map(agent => agent.id), requirement: { id: 'v3-unit', source: 'Free injected fixture; not a business requirement', acceptance: 'Add tasks, reject blanks and show exact totals', kind: 'illustrative' }, ...overrides });
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', jevSnapshot: service.store.jevConfig(), agentSnapshot: service.store.agents(), events: [], calls: [], jevCalls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
    service.store.addRun(run, input.agentIds); service.pipeline.start(run); return run.id;
  };
  const wait = async (id: string) => { const deadline = Date.now() + 20000; while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(service.pipeline.busy, false); return service.store.run(id)!; };
  const limits = productionRunInputSchema.parse({ brief: 'Defaults for free unit', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'default', source: 'unit', acceptance: 'unit' } }).limits;
  return { service, queue, wait, limits, start: async (overrides: Record<string, unknown> = {}) => wait(queue(overrides)) };
}

test('derived arithmetic failure has exactly one independent review, source linkage and original raw evidence', async t => {
  const { service, start } = setup(t); const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.repairs, 0);
  const source = run.jevCalls![0]; assert.equal(source.evaluation.status, 'error'); assert.equal(source.evaluation.errorKind, 'arithmetic-drift'); assert.deepEqual(source.evaluation.scores, []); assert.equal(source.evaluation.selectedCandidateId, null);
  const verifierCalls = run.calls.filter(call => call.role === 'verifier'); assert.equal(verifierCalls.length, 1); assert.equal(verifierCalls[0].phase, 'product:verify');
  const independent = JSON.parse(verifierCalls[0].userPrompt); assert.equal(independent.protocolFallback.sourceJevCallId, source.id); assert.deepEqual(independent.protocolFallback.diagnostics, source.evaluation.diagnostics); assert.equal(verifierCalls[0].userPrompt.includes('discarded-jev-provider-score-not-authority'), false);
  assert.deepEqual(independent.candidates, source.evaluation.requestSnapshot!.state.candidates); assert.equal(independent.criteria.minimumOrdinalScore, 3);
  const link = run.verifications.find(item => item.engine === 'jev-llm-protocol-fallback')!; assert.equal(link.sourceJevCallId, source.id); assert.equal(link.decision, 'accept'); assert.equal(run.verifications[0].engine, 'jev'); assert.equal(run.verifications[0].decision, 'abstain');
  const evidence = JSON.parse(service.store.readArtifact(run.id, 'evidence.json')); assert.deepEqual(evidence.jevCalls[0].evaluation, source.evaluation); assert.deepEqual(evidence.verifications, run.verifications);
  const manifest = JSON.parse(service.store.readArtifact(run.id, 'delivery-manifest.json')); assert.equal(manifest.jevPolicyVersion, 'jev-candidate-v3'); assert.equal(manifest.outputContractVersion, OUTPUT_CONTRACT_VERSION);
});

test('all six roles receive actual schema snapshots; Verifier receives its own schema, not the candidate schema', async t => {
  const { start } = setup(t, { jevCall: async (config, context) => evaluation(config, context) }); const run = await start({ verifierEngine: 'llm-rubric' }); assert.equal(run.status, 'completed', run.error);
  const schemas = { product: contractProfile('offline-single-html').productSchema, researcher: researchSchema, 'project-manager': planSchema, tester: testsSchema, developer: codeSchema, verifier: verifierSchema };
  assert.deepEqual(new Set(run.calls.map(call => call.role)), new Set(Object.keys(schemas)));
  for (const call of run.calls) { const request = JSON.parse(call.userPrompt); assert.deepEqual(request.outputContract, outputContractSnapshot(schemas[call.role])); assert.equal(request.input?.outputContract, undefined); assert.match(call.systemPrompt, /顶层outputContract/); }
  const tester = JSON.parse(run.calls.find(call => call.role === 'tester')!.userPrompt).outputContract.jsonSchema; assert.equal(tester.properties.checks.maxItems, 12); assert.equal(tester.additionalProperties, false);
});

test('valid independent abstention regenerates only the original role and remains within global repair budget', async t => {
  let reviews = 0; let products = 0; const { start } = setup(t, { roleCall: async (...args) => { if (args[1].startsWith('你是独立质量Verifier')) { reviews++; return review(args[2], 'abstain'); } return roleCall(...args); }, jevCall: async (config, context) => evaluation(config, context, context.phase === 'product' && ++products === 1 ? 'drift' : 'accepted') });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(reviews, 1); assert.equal(run.calls.filter(call => call.role === 'product').length, 2); assert.equal(run.repairs, 1); assert.equal(run.repairHistory![0].role, 'product'); assert.equal(run.repairHistory![0].kind, 'stage-regeneration');
  assert.deepEqual(run.jevCalls!.slice(0, 2).map(call => call.evaluation.status), ['error', 'accepted']); assert.notEqual(run.jevCalls![0].evaluation.requestSnapshot!.state.candidates[0].id, run.jevCalls![1].evaluation.requestSnapshot!.state.candidates[0].id);
});

test('persistent protocol fallback abstention exhausts two shared repairs without a second review of any response', async t => {
  const { start } = setup(t, { roleCall: async (...args) => args[1].startsWith('你是独立质量Verifier') ? review(args[2], 'abstain') : roleCall(...args) }); const run = await start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.calls.filter(call => call.role === 'product').length, 3); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 3); assert.equal(run.jevCalls!.length, 3); assert.equal(run.gateHistory.length, 0);
  const sourceIds = run.verifications.filter(review => review.engine === 'jev-llm-protocol-fallback').map(review => review.sourceJevCallId); assert.equal(new Set(sourceIds).size, 3); for (const call of run.jevCalls!) assert.equal(sourceIds.filter(id => id === call.id).length, 1);
});

test('invalid independent protocol or forced below-threshold acceptance is fatal with no second Verifier', async t => {
  for (const kind of ['json', 'foreign-id', 'low-score'] as const) {
    const { start } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier')) return roleCall(...args); if (kind === 'json') return result('{invalid verifier JSON'); const data = JSON.parse(args[2]); return result({ decision: 'accept', selectedCandidateId: kind === 'foreign-id' ? 'foreign-candidate' : data.candidates[0].id, scores: [{ candidateId: data.candidates[0].id, score: kind === 'low-score' ? 2 : 4, reason: 'Invalid injected review' }], reason: 'must fail closed' }); } });
    const run = await start(); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 0); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 1); assert.equal(run.jevCalls!.length, 1); assert.equal(run.outputs.length, 0);
    const rejection = run.verifications.at(-1)!; assert.equal(rejection.engine, 'jev-llm-protocol-fallback'); assert.equal(rejection.sourceJevCallId, run.jevCalls![0].id); assert.equal(rejection.selectedCandidateId, null);
  }
});

test('fatal Jev protocol, unknown usage or cancellation never trigger arithmetic fallback', async t => {
  for (const kind of ['fatal', 'unknown', 'cancel'] as const) {
    const fixture = setup(t, { jevCall: async (config, context, signal) => { const value = evaluation(config, context, 'drift'); if (kind === 'fatal') return { ...value, errorKind: 'fatal', reason: 'arithmetic-drift is only forged error text' }; if (kind === 'unknown') return { ...value, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } }; fixture.service.pipeline.cancel(fixture.service.store.runs()[0].id); signal.throwIfAborted(); return value; } });
    const run = await fixture.start(); assert.equal(run.status, kind === 'cancel' ? 'cancelled' : 'failed'); assert.equal(run.repairs, 0); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 0); assert.equal(run.jevCalls!.length, 1);
  }
});

test('unknown independent Verifier usage stops with all paid-intent records preserved and no regeneration', async t => {
  const { start } = setup(t, { roleCall: async (...args) => { const output = await roleCall(...args); return args[1].startsWith('你是独立质量Verifier') ? { ...output, usageReported: false } : output; } });
  const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /unknown/); assert.equal(run.repairs, 0); assert.equal(run.calls.length, 2); assert.equal(run.jevCalls!.length, 1); assert.equal(run.usage.complete, false); assert.equal(run.usage.estimatedCost, null);
});

test('cancellation closes a pending independent Verifier without another request or repair', async t => {
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }); let aborted = false;
  const { service, queue, wait } = setup(t, { roleCall: async (...args) => { if (!args[1].startsWith('你是独立质量Verifier')) return roleCall(...args); entered(); return new Promise((_resolve, reject) => args[3].addEventListener('abort', () => { aborted = true; reject(new DOMException('Cancelled independent verifier', 'AbortError')); }, { once: true })); } });
  const id = queue(); await ready; service.pipeline.cancel(id); const run = await wait(id); assert.equal(aborted, true); assert.equal(run.status, 'cancelled'); assert.equal(run.repairs, 0); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 1); assert.equal(run.jevCalls!.length, 1); assert.equal(run.interventions.length, 1);
});

test('protocol fallback consumes original Token, cost and request budgets, not extra allowances', async t => {
  const tokens = setup(t, { jevCall: async (config, context) => ({ ...evaluation(config, context, 'drift'), usage: { inputTokens: 1000, outputTokens: 0, estimatedCost: 0.000042, currency: 'USD', complete: true } }) });
  const tokenRun = await tokens.start({ limits: { ...tokens.limits, maxTokens: 72000 } }); assert.equal(tokenRun.status, 'failed'); assert.match(tokenRun.error!, /Token 预算/); assert.equal(tokenRun.calls.length, 1); assert.equal(tokenRun.jevCalls!.length, 1); assert.equal(tokenRun.repairs, 0);
  const cost = setup(t); const verifier = cost.service.store.agents().find(agent => agent.role === 'verifier')!; cost.service.store.patchAgent(verifier.id, { pricing: { inputPerMillion: 100, outputPerMillion: 100, currency: 'USD' } });
  const costRun = await cost.start({ limits: { ...cost.limits, maxCost: 0.2 } }); assert.equal(costRun.status, 'failed'); assert.match(costRun.error!, /费用预算/); assert.equal(costRun.calls.length, 1); assert.equal(costRun.jevCalls!.length, 1); assert.equal(costRun.repairs, 0);
  const requests = setup(t, { jevCall: async (config, context) => evaluation(config, context, context.phase.startsWith('feedback-') ? 'drift' : 'accepted') });
  const requestRun = await requests.start({ limits: { ...requests.limits, maxCalls: 12 } }); assert.equal(requestRun.status, 'failed'); assert.match(requestRun.error!, /请求次数预算/); assert.equal(requestRun.calls.length + requestRun.jevCalls!.length, 12); assert.equal(requestRun.calls.filter(call => call.role === 'verifier').length, 0); assert.equal(requestRun.repairs, 0); assert.equal(requestRun.gateHistory.length, 1);
});

test('arithmetic drift cannot synthesize LLM fallback in mock-jev mode and new protocol labels cannot be credentials', async t => {
  const { start } = setup(t); const run = await start({ mode: 'mock-jev', demoCaseId: 'create' }); assert.equal(run.status, 'failed'); assert.equal(run.calls.filter(call => call.role === 'verifier').length, 0); assert.equal(run.repairs, 0); assert.equal(run.jevCalls!.length, 1);
  for (const label of ['jev-candidate-v3', 'production-output-contract-v1', 'production-output-contract-v9', 'jev-llm-protocol-fallback', 'score-concentration-drift', 'choice-concentration-drift', 'arithmetic-drift', 'additionalProperties', 'outputContractVersion', 'jevPolicyVersion', 'protocolFallback', 'sourceJevCallId', 'verificationEngine', 'jev-llm-fallback']) assert.equal(productionApiKeySchema.safeParse(label).success, false, 'protocol metadata must not become a redaction secret');
});

test('credentials cannot rename actual control-plane rubric fields or redact the native JSON Schema dialect URI', async t => {
  const { service, start } = setup(t); const agent = service.store.agents().find(item => item.role === 'verifier')!;
  for (const collision of ['minimumOrdinalScore', 'verificationBoundary', 'expectedArtifact', 'evidenceBoundary', 'https://json-schema.org/draft/2020-12/schema']) {
    assert.equal(productionApiKeySchema.safeParse(collision).success, false, 'the supported credential shape must not collide with the actual protocol');
    assert.throws(() => service.store.patchAgent(agent.id, { apiKey: collision }), /平台协议字段/);
    assert.throws(() => service.store.patchJevConfig({ apiKey: collision }), /平台协议字段/);
    assert.equal(service.store.agents().find(item => item.id === agent.id)!.hasApiKey, true, 'a rejected change must not clear the existing synthetic credential');
  }
  const run = await start({ verifierEngine: 'llm-rubric' }); assert.equal(run.status, 'completed', run.error);
  for (const call of run.calls) { const request = JSON.parse(call.userPrompt); assert.equal(request.outputContract.jsonSchema.$schema, 'https://json-schema.org/draft/2020-12/schema'); if (call.role === 'verifier') { assert.equal(request.criteria.minimumOrdinalScore, 3); assert.equal(typeof request.criteria.phaseReview.expectedArtifact, 'string'); assert.equal(typeof request.criteria.phaseReview.evidenceBoundary, 'string'); assert.ok(request.state.reviewContext.knownPlatform.verificationBoundary); } }
});

test('both fallback engines preserve structured failed-attempt source links without fabricating a model decision', async t => {
  for (const kind of ['drift', 'uncertain'] as const) for (const failure of ['unknown', 'transport', 'cancel'] as const) {
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const fixture = setup(t, { jevCall: async (config, context) => { const value = evaluation(config, context, 'drift'); return kind === 'drift' ? value : { ...value, status: 'uncertain', errorKind: undefined, diagnostics: undefined }; }, roleCall: async (...args) => {
      if (!args[1].startsWith('你是独立质量Verifier')) return roleCall(...args);
      if (failure === 'transport') throw new Error('Injected review HTTP/auth failure, never a model abstention');
      if (failure === 'unknown') return { ...review(args[2]), usageReported: false };
      entered(); return new Promise((_resolve, reject) => args[3].addEventListener('abort', () => reject(new DOMException('Cancelled actual review attempt', 'AbortError')), { once: true }));
    } });
    const id = fixture.queue(); if (failure === 'cancel') { await ready; fixture.service.pipeline.cancel(id); }
    const run = await fixture.wait(id); assert.equal(run.status, failure === 'cancel' ? 'cancelled' : 'failed'); assert.equal(run.repairs, 0); assert.equal(run.verifications.length, 1, 'only the original Jev decision exists; do not synthesize a fallback abstention'); assert.equal(run.verifications[0].engine, 'jev');
    const calls = run.calls.filter(call => call.role === 'verifier'); assert.equal(calls.length, 1); assert.equal(calls[0].verificationEngine, kind === 'drift' ? 'jev-llm-protocol-fallback' : 'jev-llm-fallback'); assert.equal(calls[0].sourceJevCallId, run.jevCalls![0].id); assert.ok(calls[0].error); assert.ok(calls[0].finishedAt);
    const evidence = JSON.parse(fixture.service.store.readArtifact(id, 'evidence.json')); const saved = evidence.calls.find((call: { id: string }) => call.id === calls[0].id); assert.equal(saved.verificationEngine, calls[0].verificationEngine); assert.equal(saved.sourceJevCallId, calls[0].sourceJevCallId); assert.equal(evidence.verifications.length, 1);
  }
});
