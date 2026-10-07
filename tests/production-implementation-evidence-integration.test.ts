import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { runRole, RoleResult } from '../server/harness.ts';
import { ProductionPipeline, type ProductionOptions } from '../server/production/pipeline.ts';
import { ProductionStore, hash } from '../server/production/store.ts';
import { implementationEvidenceVerifierSchema, outputContractSnapshot, verifierSchema } from '../server/production/contracts.ts';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.ts';
import { IMPLEMENTATION_EVIDENCE_VERSION, IMPLEMENTATION_EVIDENCE_VERIFIER_PROFILE, ImplementationEvidenceError, type ImplementationEvidenceContract } from '../shared/production-implementation-evidence.ts';
import { VERIFIER_HTML_A_CORPUS } from '../shared/production-verifier-html-corpus-a.ts';
import { VERIFIER_HTML_B_CORPUS } from '../shared/production-verifier-html-corpus-b.ts';

const html = `<!doctype html><html><head><title>免费注入计数夹具</title></head><body><button id="add">添加</button><output id="count">0</output><script>let total=0;document.getElementById('add').addEventListener('click',()=>{total++;document.getElementById('count').textContent=String(total);});</script></body></html>`;
const anchor = `document.getElementById('count').textContent=String(total);`;
const checks = [
  { name: '点击显示真实结果', steps: [{ action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#count', text: '1' }] },
  { name: '独立新页面同样结果', steps: [{ action: 'click', selector: '#add' }, { action: 'assertTextExact', selector: '#count', text: '1' }] },
];
const response = (value: unknown): RoleResult => ({ text: typeof value === 'string' ? value : JSON.stringify(value), inputTokens: 100, outputTokens: 20, usageReported: true, harness: 'FREE engineering injection, no provider HTTP/model' });
const proofFor = (contract: ImplementationEvidenceContract, exactAnchor: string, checkIndex: number, stepIndex: number) => ({
  version: IMPLEMENTATION_EVIDENCE_VERSION, contractSha256: contract.contractSha256,
  candidates: contract.candidates.map(candidate => ({ ...candidate, clauses: contract.clauses.map(clause => ({ clauseId: clause.id, status: 'supported', implementationRefs: [{ pointer: '/html', exactAnchor }], boundaryRefs: [{ checkIndex, stepIndex }] })) })),
});
type Scenario = { brief?: string; acceptance?: string; html?: string; checks?: unknown; anchor?: string; boundaryCheck?: number; boundaryStep?: number; mutate?: (answer: any, prompt: any) => unknown; pmProceedOnFailedGate?: boolean; legacy?: boolean; candidateCount?: 1 | 2; repair?: boolean; };
async function fixture(t: TestContext, scenario: Scenario = {}, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-implementation-evidence-'));
  const store = new ProductionStore(directory); const verifierPrompts: any[] = []; const generationPrompts: any[] = [];
  const beforeFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External HTTP forbidden in free evidence integration'); };
  const roleCall: typeof runRole = async (agent, system, prompt) => {
    const data = JSON.parse(prompt);
    if (data.candidates) {
      verifierPrompts.push(data);
      const answer: any = { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 5, reason: 'Injected static review, not business execution proof' })), reason: 'Never override actual Gate' };
      const contract = data.criteria.implementationEvidenceContract;
      if (contract) answer.implementationEvidence = proofFor(contract, scenario.anchor ?? anchor, scenario.boundaryCheck ?? 0, scenario.boundaryStep ?? 1);
      return response(contract && scenario.mutate ? scenario.mutate(answer, data) : answer);
    }
    generationPrompts.push({ role: agent.modelId, data, system });
    if (agent.modelId === 'product') return response({ goal: data.input.brief, scope: 'offline-single-html', acceptance: [data.input.requirement.acceptance], exclusions: [] });
    if (agent.modelId === 'researcher') return response({ observations: ['Use exact frozen business checks and keep implementation unexecuted until Gate'], constraints: ['Offline HTML, no network or host execution'], unknowns: [] });
    if (agent.modelId === 'project-manager') return response({ decision: data.context.gate?.passed === false ? scenario.pmProceedOnFailedGate ? 'proceed' : scenario.repair ? 'revise' : 'stop' : 'proceed', summary: 'Follow actual frozen Gate without weakening it', tasks: [{ id: 'next', owner: 'developer', description: 'Respect original requirement and frozen assertions' }], risks: [] });
    if (agent.modelId === 'tester') return response({ checks: scenario.checks ?? checks });
    if (agent.modelId === 'developer') return response({ html: scenario.html ?? html });
    throw new Error('Unexpected injected role');
  };
  const pipeline = new ProductionPipeline(store, { roleCall, acceptancePreflight: async () => ({ valid: true, errors: [] }), ...options });
  t.after(async () => { await pipeline.stop(); globalThis.fetch = beforeFetch; rmSync(directory, { recursive: true, force: true }); });
  // Synthetic per-test credentials only; no user config/state or actual Key is read.
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://example.invalid', apiKey: `free-evidence-fixture-${agent.role}`, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } });
  const input = productionRunInputSchema.parse({ mode: 'live', brief: scenario.brief ?? '点击添加后显示实际计数结果', implementationEvidencePolicy: scenario.legacy ? 'legacy' : 'source-bound-v1', candidateCount: scenario.candidateCount ?? 1, budgetAuthorized: true, agentIds: store.agents().map(agent => agent.id), limits: { maxCalls: 40, maxRepairCycles: 2 }, requirement: { id: 'FREE-EVIDENCE', source: 'Outer-authored free integration; not real business', acceptance: scenario.acceptance ?? '独立页面点击一次，精确显示数量1', kind: 'illustrative' } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const execute = async () => { pipeline.start(store.run(run.id)!); const deadline = Date.now() + 45000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(pipeline.busy, false, 'bounded free pipeline'); return store.run(run.id)!; };
  return { store, pipeline, run, execute, verifierPrompts, generationPrompts };
}

test('new live/injected profile requires evidence only at implementation and passes actual frozen browser Gate without extra calls', { timeout: 60000 }, async t => {
  const { store, execute, verifierPrompts, generationPrompts } = await fixture(t);
  const run = await execute(); assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test');
  assert.equal(run.calls.length, 12); assert.equal(run.repairs, 0); assert.equal(run.gate!.passed, true); assert.deepEqual(run.frozenContract!.checks, checks);
  assert.equal(run.calls.every(call => call.executionSource === 'injected'), true); assert.equal(run.jevCalls?.length ?? 0, 0);
  assert.equal(run.verifications.filter(review => review.implementationEvidence).length, 1);
  const implementation = run.verifications.find(review => review.phase === 'implement')!;
  assert.equal(implementation.implementationEvidence!.contractSha256, implementation.implementationEvidenceContract!.contractSha256);
  for (const prompt of verifierPrompts) assert.deepEqual(prompt.outputContract, outputContractSnapshot(prompt.criteria.phase === 'implement' ? implementationEvidenceVerifierSchema : verifierSchema));
  for (const prompt of generationPrompts) assert.equal(JSON.stringify(prompt.data.outputContract).includes('implementationEvidence'), false);
  assert.match(generationPrompts.find(prompt => prompt.role === 'tester')!.system, /仍只输出checks/);
  assert.equal(run.calls.find(call => call.phase === 'implement:verify')!.promptVersion, IMPLEMENTATION_EVIDENCE_VERIFIER_PROFILE);
  assert.equal(run.validationContract!.implementationEvidenceVersion, IMPLEMENTATION_EVIDENCE_VERSION);
  const manifest = JSON.parse(store.readArtifact(run.id, 'delivery-manifest.json'));
  assert.equal(manifest.implementationEvidencePolicy, 'source-bound-v1'); assert.equal(manifest.implementationEvidence.length, 1);
  assert.deepEqual(manifest.implementationEvidence[0].evidence, implementation.implementationEvidence);
  assert.deepEqual(manifest.implementationEvidence[0].contract, implementation.implementationEvidenceContract);
  assert.match(manifest.implementationEvidenceBoundary, /not semantic correctness/);
});

for (const scenario of [
  { name: 'missing entire proof', expected: 'evidence-response-structure', mutate: (answer: any) => { delete answer.implementationEvidence; return answer; } },
  { name: 'wrong anchor', expected: 'evidence-anchor-mismatch', mutate: (answer: any) => { answer.implementationEvidence.candidates[0].clauses[0].implementationRefs[0].exactAnchor = 'untrusted-provider-private-path'; return answer; } },
  { name: 'stale contract', expected: 'evidence-contract-mismatch', mutate: (answer: any) => { answer.implementationEvidence.contractSha256 = '0'.repeat(64); return answer; } },
  { name: 'missing clause coverage', expected: 'evidence-response-structure', mutate: (answer: any) => { answer.implementationEvidence.candidates[0].clauses.pop(); return answer; } },
  { name: 'invalid boundary ref', expected: 'evidence-boundary-mismatch', mutate: (answer: any) => { answer.implementationEvidence.candidates[0].clauses[0].boundaryRefs[0].stepIndex = 0; return answer; } },
  { name: 'unsupported row with score5', expected: 'evidence-score-conflict', mutate: (answer: any) => { answer.implementationEvidence.candidates[0].clauses[0].status = 'missing'; return answer; } },
]) test(`strict ${scenario.name} stops without retry, regeneration, Gate or copied provider diagnostic`, async t => {
  let gateCalls = 0; const { store, execute } = await fixture(t, { mutate: scenario.mutate }, { gate: async () => { gateCalls++; return { passed: true, checks: [] }; } });
  const run = await execute(); assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 10); assert.equal(run.repairs, 0); assert.equal(gateCalls, 0);
  const review = run.verifications.find(item => item.phase === 'implement')!; const call = run.calls.find(item => item.phase === 'implement:verify')!;
  assert.equal(call.implementationEvidenceDiagnostic!.code, scenario.expected); assert.deepEqual(review.implementationEvidenceDiagnostic, call.implementationEvidenceDiagnostic);
  assert.equal(JSON.stringify(call.implementationEvidenceDiagnostic).includes('untrusted-provider'), false); assert.equal(run.error!.includes('untrusted-provider'), false);
  assert.equal(review.selectedCandidateId, null); assert.equal(run.outputs.some(output => output.phase === 'implement'), false); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
  const manifest = JSON.parse(store.readArtifact(run.id, 'delivery-manifest.json')); assert.deepEqual(manifest.implementationEvidence[0].diagnostic, call.implementationEvidenceDiagnostic);
});

test('repair gets a fresh evidence binding while frozen source/checks and the shared two-repair cap remain immutable', async t => {
  let gates = 0; const { store, execute } = await fixture(t, { repair: true }, { gate: async () => ({ passed: ++gates === 2, checks: [{ name: 'Injected Gate, not browser evidence', passed: gates === 2 }] }) });
  const run = await execute(); assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 1); assert.equal(run.calls.length, 16); assert.equal(gates, 2);
  const reviews = run.verifications.filter(review => review.implementationEvidenceContract);
  assert.deepEqual(reviews.map(review => review.phase), ['implement', 'repair-1']);
  assert.notEqual(reviews[0].implementationEvidenceContract!.contractSha256, reviews[1].implementationEvidenceContract!.contractSha256);
  assert.equal(reviews[0].implementationEvidenceContract!.checksSha256, reviews[1].implementationEvidenceContract!.checksSha256);
  assert.equal(reviews[0].implementationEvidenceContract!.sourceSha256, reviews[1].implementationEvidenceContract!.sourceSha256);
  assert.equal(reviews[0].implementationEvidenceContract!.frozenHash, run.frozenContract!.hash);
  assert.equal(reviews[1].implementationEvidenceContract!.frozenHash, run.frozenContract!.hash);
  assert.deepEqual(run.frozenContract!.checks, checks);
  assert.equal(JSON.parse(store.readArtifact(run.id, 'delivery-manifest.json')).implementationEvidence.length, 2);
});

test('Jev/new-policy combinations are refused at schema/API boundary and direct pipeline start before any injected callback', async t => {
  let callbacks = 0; const { pipeline, run } = await fixture(t, {}, { roleCall: async () => { callbacks++; throw new Error('Must not be called'); }, jevCall: async () => { callbacks++; throw new Error('Must not be called'); } });
  const incompatible = { ...run.input, verifierEngine: 'jev-cascade' as const };
  assert.equal(productionRunInputSchema.safeParse(incompatible).success, false);
  run.input = incompatible;
  assert.throws(() => pipeline.start(run), error => error instanceof ImplementationEvidenceError && error.diagnostic.code === 'evidence-input-invalid');
  assert.equal(callbacks, 0); assert.equal(pipeline.busy, false); assert.equal(run.calls.length, 0);
});

test('legacy injected chain keeps its four-field schema, no evidence records and original call count', async t => {
  const { execute, verifierPrompts, store } = await fixture(t, { legacy: true }, { gate: async () => ({ passed: true, checks: [{ name: 'Injected legacy Gate', passed: true }] }) });
  const run = await execute(); assert.equal(run.status, 'completed', run.error); assert.equal(run.calls.length, 12);
  assert.equal(run.verifications.some(review => review.implementationEvidenceContract), false);
  assert.equal(run.validationContract!.implementationEvidenceVersion, undefined);
  for (const prompt of verifierPrompts) assert.deepEqual(prompt.outputContract, outputContractSnapshot(verifierSchema));
  assert.equal(JSON.parse(store.readArtifact(run.id, 'delivery-manifest.json')).implementationEvidence, undefined);
});

for (const pool of [VERIFIER_HTML_A_CORPUS.find(item => item.id === 'H02')!, VERIFIER_HTML_B_CORPUS.find(item => item.id === 'H10')!]) {
  test(`${pool.id}: valid source references and score5 cannot override actual failed business Gate or PM proceed`, { timeout: 60000 }, async t => {
    const before = hash(pool); const exactAnchor = pool.id === 'H02' ? 'const total=p*q;' : 'items=items.filter(value=>value.name!==item.name);';
    const { execute } = await fixture(t, { brief: pool.goal, acceptance: pool.acceptance, html: pool.candidates[0].value.html, checks: pool.checks, anchor: exactAnchor, boundaryCheck: pool.id === 'H02' ? 0 : 1, boundaryStep: pool.id === 'H02' ? 3 : 9, pmProceedOnFailedGate: true });
    const run = await execute(); assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 12, run.error); assert.equal(run.gateHistory.length, 1, run.error);
    assert.equal(run.gate!.passed, false); assert.equal(run.repairs, 0); assert.match(run.error!, /Gate失败时交付/);
    assert.equal(run.verifications.find(review => review.phase === 'implement')!.implementationEvidence!.candidates[0].clauses.every(clause => clause.status === 'supported'), true);
    assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false); assert.deepEqual(run.frozenContract!.checks, pool.checks); assert.equal(hash(pool), before);
  });
}
