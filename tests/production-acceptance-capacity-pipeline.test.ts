import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { createProductionService } from '../server/production/index.js';
import { ACCEPTANCE_DIAGNOSTICS_VERSION, acceptanceCapacityFacts, diagnoseAcceptanceCapacity } from '../server/production/acceptance-diagnostics.js';
import { ACCEPTANCE_PLANNING_VERSION, HTML_ACCEPTANCE_REVIEW_INSTRUCTIONS } from '../server/production/contracts.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import { hash, ProductionStore } from '../server/production/store.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { RoleResult, runRole } from '../server/harness.js';
import { productionApiKeySchema, productionRunInputSchema, PRODUCTION_ACCEPTANCE_POLICY_LITERALS, type ProductionRun } from '../shared/production-schema.js';

// Free injected control-flow tests only. No SDK/provider, browser or generated
// code executes, and fabricated fixture usage never becomes real model data.
const archive = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-03/run.json', import.meta.url), 'utf8')) as ProductionRun;
const rejectedOriginals = archive.calls.filter(call => call.role === 'tester').map(call => call.rawOutput);
const result = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected fixture; no provider transport' });
const injected: typeof runRole = async (_agent, _system, prompt) => {
  const data = JSON.parse(prompt);
  if (data.candidates) return result({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected fixture, not model quality' })), reason: 'Free control-flow fixture' });
  const fields = data.outputContract.jsonSchema.properties;
  if (fields.goal) return result({ goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] });
  if (fields.observations) return result({ observations: ['Use explicit button actions and independent exact list checks.'], constraints: ['Frozen limited offline HTML only.'], unknowns: [] });
  if (fields.decision) return result({ decision: 'proceed', summary: 'Injected plan only.', tasks: [{ id: 'test', owner: 'tester', description: 'Define independent checks under host capacity.' }], risks: [] });
  if (fields.checks) return result({ checks: demoChecks('create') });
  return result({ html: demoHtml(data.input) });
};

function setup(t: TestContext, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-acceptance-capacity-'));
  const service = createProductionService(directory, { roleCall: injected, acceptancePreflight: async () => ({ valid: true, errors: [] }), gate: async () => ({ passed: true, checks: [{ name: 'Injected control-flow Gate, not browser evidence', passed: true }] }), ...options });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `capacity-fixture-${agent.role}-not-a-real-key`, pricing: { inputPerMillion: 0.30, outputPerMillion: 1.20, currency: 'USD' } });
  const start = async () => {
    const input = productionRunInputSchema.parse({ brief: 'Build an offline task list', mode: 'live', budgetAuthorized: true, agentIds: service.store.agents().map(agent => agent.id), requirement: { id: 'free-capacity-fixture', source: 'Self-created injected engineering test', acceptance: 'Add a task and show exact list counts; reject invalid input without modifying valid existing records.', kind: 'illustrative' } });
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: service.store.agents(), calls: [], events: [], outputs: [], verifications: [], jevCalls: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
    service.store.addRun(run, input.agentIds); service.pipeline.start(run);
    const deadline = Date.now() + 15000;
    while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(service.pipeline.busy, false); return service.store.run(run.id)!;
  };
  return { service, start };
}

test('capacity rejection binds raw/call/candidate feedback and only a new valid candidate can freeze', async t => {
  let attempts = 0; let acceptanceReviews = 0;
  const { service, start } = setup(t, { roleCall: async (...args) => {
    const data = JSON.parse(args[2]);
    assert.deepEqual((data.context ?? data.state.reviewContext).acceptanceCapacity, acceptanceCapacityFacts());
    if (!data.candidates && data.outputContract.jsonSchema.properties.checks && ++attempts === 1) return result(rejectedOriginals[0]);
    if (data.candidates && data.criteria.phase === 'acceptance') {
      acceptanceReviews++;
      assert.ok(args[1].endsWith(HTML_ACCEPTANCE_REVIEW_INSTRUCTIONS));
      assert.equal(data.state.reviewContext.regeneration, undefined);
      assert.equal(JSON.stringify(data.state.reviewContext).includes('oversizedStepCheckIndices'), false, 'Previous candidate defects are not transplanted onto current review');
      assert.match(data.criteria.acceptance, /valid existing records/);
    }
    return injected(...args);
  } });
  const run = await start(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test');
  assert.equal(run.repairs, 1); assert.equal(attempts, 2); assert.equal(acceptanceReviews, 1);
  assert.equal(run.validationContract!.acceptanceDiagnosticsVersion, ACCEPTANCE_DIAGNOSTICS_VERSION);
  assert.equal(run.validationContract!.acceptancePlanningVersion, ACCEPTANCE_PLANNING_VERSION);
  const [first, second] = run.calls.filter(call => call.role === 'tester');
  assert.equal(first.rawOutput, rejectedOriginals[0]); assert.notEqual(first.selected, true);
  assert.deepEqual(first.acceptanceDiagnostic, diagnoseAcceptanceCapacity(first.rawOutput));
  const feedback = JSON.parse(second.userPrompt).context.regeneration.rejectedCandidates[0];
  assert.equal(feedback.callId, first.id); assert.equal(feedback.id, first.candidateId);
  assert.equal(feedback.rawOutputSha256, hash(first.rawOutput));
  assert.deepEqual(feedback.acceptanceDiagnostic, first.acceptanceDiagnostic);
  assert.equal(feedback.acceptanceDiagnostic.sourceSha256, feedback.rawOutputSha256);
  assert.deepEqual(feedback.acceptanceDiagnostic.oversizedStepCheckIndices, [2, 5, 8]);
  assert.equal(second.acceptanceDiagnostic, undefined);
  assert.deepEqual(run.frozenContract!.checks, demoChecks('create'));
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1);
  const evidence = JSON.parse(service.store.readArtifact(run.id, 'evidence.json'));
  assert.deepEqual(evidence.calls.find((call: ProductionRun['calls'][number]) => call.id === first.id).acceptanceDiagnostic, first.acceptanceDiagnostic);
  assert.deepEqual(JSON.parse(service.store.readArtifact(run.id, 'delivery-manifest.json')).validationContract, run.validationContract);
});

test('three original capacity failures consume only two shared repairs and never trigger a tester evaluator, developer or Gate', async t => {
  let attempts = 0; let preflights = 0; let gates = 0;
  const { start } = setup(t, { roleCall: async (...args) => {
    const data = JSON.parse(args[2]);
    if (!data.candidates && data.outputContract.jsonSchema.properties.checks) return result(rejectedOriginals[attempts++]);
    return injected(...args);
  }, acceptancePreflight: async () => { preflights++; return { valid: true, errors: [] }; }, gate: async () => { gates++; return { passed: true, checks: [] }; } });
  const run = await start(); assert.equal(run.status, 'failed'); assert.equal(attempts, 3); assert.equal(run.repairs, 2);
  assert.equal(preflights, 0); assert.equal(gates, 0); assert.equal(run.frozenContract, undefined);
  assert.equal(run.calls.filter(call => call.role === 'verifier').length, 3); assert.equal(run.calls.some(call => call.phase === 'acceptance:verify' || call.role === 'developer'), false);
  assert.deepEqual(run.calls.filter(call => call.role === 'tester').map(call => call.rawOutput), rejectedOriginals);
  assert.ok(run.calls.filter(call => call.role === 'tester').every(call => call.acceptanceDiagnostic && call.selected !== true));
  assert.equal(run.verifications.filter(review => review.phase === 'acceptance' && review.decision === 'abstain').length, 3);
  assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

test('legally shaped but coverage-rejected candidates must be regenerated or fail, never freeze from a score claim', async t => {
  let coverageReviews = 0;
  const { start } = setup(t, { roleCall: async (...args) => {
    const data = JSON.parse(args[2]);
    if (data.candidates && data.criteria.phase === 'acceptance') {
      coverageReviews++; assert.ok(args[1].includes('负例只改变目标变量'));
      assert.match(data.criteria.acceptance, /valid existing records/);
      return result({ decision: 'abstain', selectedCandidateId: null, scores: [{ candidateId: data.candidates[0].id, score: 1, reason: 'Injected incomplete negative-state coverage verdict; not a real semantic Oracle' }], reason: 'Required states omitted in this deliberate fixture verdict' });
    }
    return injected(...args);
  } });
  const run = await start(); assert.equal(run.status, 'failed'); assert.equal(coverageReviews, 3); assert.equal(run.repairs, 2);
  assert.equal(run.frozenContract, undefined); assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.ok(run.calls.filter(call => call.role === 'tester').every(call => !call.acceptanceDiagnostic));
  assert.deepEqual(run.verifications.filter(review => review.phase === 'acceptance').map(review => review.decision), ['abstain', 'abstain', 'abstain']);
});

test('every new protocol credential-length substring is refused for Agent and Jev settings without exporting a credential', t => {
  const { service } = setup(t); const agent = service.store.agents()[0];
  for (const literal of PRODUCTION_ACCEPTANCE_POLICY_LITERALS) for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) {
    const syntheticCollision = literal.slice(start, end);
    assert.equal(productionApiKeySchema.safeParse(syntheticCollision).success, false);
    assert.throws(() => service.store.patchAgent(agent.id, { apiKey: syntheticCollision }));
    assert.throws(() => service.store.patchJevConfig({ apiKey: syntheticCollision }));
  }
});

test('a retained synthetic legacy credential collision stops before any role request and leaves a failed attempt', async t => {
  let roleRequests = 0; const { service, start } = setup(t, { roleCall: async (...args) => { roleRequests++; return injected(...args); } });
  // Test-only authenticated legacy state, never a real store migration/read.
  const legacy = service.store as unknown as { encrypt(secret: string): string; state: { agents: Array<{ secret?: string }> } };
  legacy.state.agents[0].secret = legacy.encrypt('oversizedStepCheckIndices');
  const run = await start(); assert.equal(run.status, 'failed'); assert.match(run.error!, /凭据.*冲突/);
  assert.equal(roleRequests, 0); assert.equal(run.calls.length, 0); assert.equal(run.repairs, 0);
  assert.equal(run.frozenContract, undefined); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
  assert.equal(service.store.readArtifact(run.id, 'evidence.json').includes('oversizedStepCheckIndices'), false);
});
