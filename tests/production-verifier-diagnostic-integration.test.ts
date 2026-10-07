import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { PRODUCTION_VERIFIER_DIAGNOSTIC_LITERALS, productionApiKeySchema, productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { VERIFIER_HTML_A_CORPUS } from '../shared/production-verifier-html-corpus-a.js';
import { createProductionService } from '../server/production/index.js';
import { demoChecks, demoHtml } from '../server/production/fixtures.js';
import { hash } from '../server/production/store.js';
import type { runRole, RoleResult } from '../server/harness.js';
import { parseVerifierDecisionText, VERIFIER_DECISION_DIAGNOSTICS_VERSION } from '../server/production/verifier-diagnostics.js';
import { selectVerifierStudy } from '../server/production/verifier-study-strategy.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const response = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 20, usageReported: true, harness: 'Free injected fixture; no external request' });
const defaultRole: typeof runRole = async (_agent, system, prompt) => {
  const data = JSON.parse(prompt);
  if (system.startsWith('你是独立质量Verifier')) return response({ decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 5, reason: 'Injected maximum ordinal score, not measured correctness' })), reason: 'Injected accept; cannot override behavior Gate' });
  if (system.includes('"goal"')) return response({ goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] });
  if (system.includes('"observations"')) return response({ observations: ['Use the supplied goal and freeze exact business boundary assertions.'], constraints: ['No network or host script execution.'], unknowns: [] });
  if (system.includes('"decision"')) return response({ decision: data.context.gate?.passed === false ? 'stop' : 'proceed', summary: 'Injected plan respects actual Gate result', tasks: [{ id: 'implementation', owner: 'developer', description: 'Implement the frozen business contract' }], risks: [] });
  if (system.includes('"checks"')) return response({ checks: demoChecks('create') });
  return response({ html: demoHtml(data.input) });
};
function setup(t: TestContext, roleCall: typeof runRole = defaultRole) {
  const directory = mkdtempSync(path.join(root, '.city-agent-verifier-diagnostic-unit-'));
  const service = createProductionService(directory, { roleCall });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `diagnostic-unit-${agent.role}-not-real`, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } });
  const start = async (brief = 'Build a task list', acceptance = 'Add task and show exact count') => {
    const input = productionRunInputSchema.parse({ mode: 'live', brief, agentIds: service.store.agents().map(agent => agent.id), candidateCount: 1, budgetAuthorized: true, limits: { maxRepairCycles: 0 }, requirement: { id: 'verifier-diagnostic-unit', source: 'Outer-authored FREE engineering fixture, not real business', acceptance, kind: 'illustrative' } });
    const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: service.store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
    service.store.addRun(run, input.agentIds); service.pipeline.start(run);
    const deadline = Date.now() + 30000;
    while (service.pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(service.pipeline.busy, false, 'bounded injected pipeline must stop');
    return service.store.run(run.id)!;
  };
  return { service, start };
}

for (const category of ['json-syntax', 'zod-structure', 'candidate-ids', 'selected-id', 'minimum-score'] as const) {
  test(`actual production chain persists ${category} diagnosis and stops without second review or regeneration`, async t => {
    const { service, start } = setup(t, async (...args) => {
      if (!args[1].startsWith('你是独立质量Verifier')) return defaultRole(...args);
      const data = JSON.parse(args[2]); const id = data.candidates[0].id;
      const valid = { decision: 'accept', selectedCandidateId: id, scores: [{ candidateId: id, score: 5, reason: 'Free fixture' }], reason: 'Free fixture' };
      if (category === 'json-syntax') return response('{"decision":"accept","reason":"unescaped "quote""}');
      if (category === 'zod-structure') return response({ ...valid, 'arbitrary-unknown-field': 'untrusted provider text' });
      if (category === 'candidate-ids') return response({ ...valid, scores: [{ ...valid.scores[0], candidateId: 'foreign-id' }] });
      if (category === 'selected-id') return response({ ...valid, selectedCandidateId: null });
      return response({ ...valid, scores: [{ ...valid.scores[0], score: 2 }] });
    });
    const run = await start();
    assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 2); assert.equal(run.repairs, 0);
    const call = run.calls[1]; assert.equal(call.role, 'verifier'); assert.equal(call.verifierDiagnostic!.category, category);
    assert.equal(call.verifierDiagnostic!.source!.sourceSha256, hash(call.rawOutput));
    assert.deepEqual(run.verifications[0].verifierDiagnostic, call.verifierDiagnostic);
    assert.equal(run.validationContract!.verifierDiagnosticsVersion, VERIFIER_DECISION_DIAGNOSTICS_VERSION);
    assert.equal(run.gateHistory.length, 0); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
    assert.ok(call.error); assert.ok(run.error!.includes(call.error));
    assert.equal(run.verifications[0].selectedCandidateId, null);
    assert.equal(JSON.stringify(call.verifierDiagnostic).includes('arbitrary-unknown-field'), false);
    assert.equal(JSON.stringify(run).includes('diagnostic-unit-product-not-real'), false);
    const reloaded = service.store.run(run.id)!; assert.deepEqual(reloaded.calls[1].verifierDiagnostic, call.verifierDiagnostic);
  });
}

test('inclusive threshold defect fails actual frozen Gate despite maximum Verifier ratings', { timeout: 60000 }, async t => {
  const pool = VERIFIER_HTML_A_CORPUS.find(item => item.id === 'H02')!;
  const before = hash(pool); const candidate = pool.candidates[0];
  const { start } = setup(t, async (...args) => {
    const system = args[1];
    if (!system.startsWith('你是独立质量Verifier') && system.includes('"checks"')) return response({ checks: pool.checks });
    if (!system.startsWith('你是独立质量Verifier') && system.includes('"html"')) return response(candidate.value);
    return defaultRole(...args);
  });
  const run = await start(pool.goal, pool.acceptance);
  assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.status, 'failed', run.error);
  assert.equal(run.repairs, 0); assert.equal(run.gateHistory.length, 1); assert.equal(run.gate!.passed, false);
  const boundary = run.gate!.checks.find(check => check.name === '达到整单阈值即九折')!;
  assert.equal(boundary.passed, false); assert.match(boundary.detail!, /文本不精确等于/);
  assert.deepEqual(run.frozenContract!.checks, pool.checks); assert.equal(hash(pool), before);
  assert.equal(run.verifications.find(review => review.phase === 'implement')!.scores[0].score, 5);
  assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

test('all-bad study abstention does not manufacture a selected artifact or invoke Jev/Oracle', async () => {
  const request = verifierPreparationRequests('H02'); let reviews = 0;
  const actual = await selectVerifierStudy('llm', request, { llm: async () => {
    reviews++; return JSON.stringify({ decision: 'abstain', selectedCandidateId: null, scores: request.snapshot.candidates.map(candidate => ({ candidateId: candidate.id, score: 1, reason: 'Injected all-bad pool, not a model judgment' })), reason: 'No acceptable candidate' });
  }, jev: async () => { throw new Error('No Jev allowed'); } }, new AbortController().signal);
  assert.equal(reviews, 1); assert.equal(actual.decision, 'abstain'); assert.equal(actual.selectedCandidateId, null);
  assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 0 });
});

test('new diagnostic literal metadata cannot collide with a configured credential substring', () => {
  for (const literal of PRODUCTION_VERIFIER_DIAGNOSTIC_LITERALS) {
    for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false);
  }
  const escaped = { decision: 'accept', selectedCandidateId: 'a', scores: [{ candidateId: 'a', score: 5, reason: 'Literal "quote", slash \\, newline\n and tab\t' }], reason: 'Legal JSON escaping' };
  assert.deepEqual(parseVerifierDecisionText(JSON.stringify(escaped), ['a']), escaped);
});
