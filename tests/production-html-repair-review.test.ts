import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { runRole } from '../server/harness.ts';
import { evaluateJevCandidates } from '../server/production/jev.ts';
import { ProductionPipeline } from '../server/production/pipeline.ts';
import { REVIEW_CONTEXT_PROJECTION_VERSION, type GenerationCodeReference } from '../server/production/review-context.ts';
import { hash, ProductionStore } from '../server/production/store.ts';
import type { JevCandidateContext } from '../shared/jev-schema.ts';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.ts';
import { projectProductionLedger } from '../shared/production-ledger.ts';

const historicalHashes = {
  'run.json': '29a46e05b5e50a3585d91c2f4e13846c92023ce84951d6bc80b408660ff4c9f6',
  'evidence.json': '5db19a9a043a53dc8da5c03c935b5859fc259f7fc56d5f4afafe769a123a564a',
  'delivery-manifest.json': '1150074b88b137113821a5dcfae4a9854f96a72552072994b36cb6dc2a0179da',
  'platform-metadata.json': '2b5d66d23aa6ba858485a4418b79f26592973884ee2a55580f31ee3e7f4db8f2',
} as const;
const historical = () => Object.fromEntries(Object.entries(historicalHashes).map(([name, expected]) => {
  const bytes = readFileSync(new URL(`../docs/production/experiments/HTML-01/${name}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${name}: historical original`);
  return [name, bytes];
})) as Record<keyof typeof historicalHashes, Buffer>;

test('injected HTML repair preserves generator code but binds and deduplicates only its old HTML in identical independent reviews', async t => {
  const originals = historical();
  const source = JSON.parse(originals['run.json'].toString('utf8')) as ProductionRun;
  const sourceBefore = JSON.stringify(source);
  assert.equal(source.status, 'failed');
  assert.equal(source.validationContract!.reviewContextVersion, 'production-review-context-v1');
  assert.equal(REVIEW_CONTEXT_PROJECTION_VERSION, 'production-review-context-v2');
  const raw = (phase: string) => {
    const call = source.calls.find(call => call.phase === phase && call.role !== 'verifier');
    assert.ok(call, `Historical role output exists for ${phase}`);
    return call.rawOutput;
  };
  const previousHtml: string = JSON.parse(raw('implement')).html;
  const repairedHtml: string = JSON.parse(raw('repair-1')).html;
  const frozenChecks = JSON.parse(raw('acceptance')).checks;
  assert.notEqual(previousHtml, repairedHtml, 'The new candidate must not accidentally reuse the old HTML');

  // This test has no browser, native Harness, HTTP server or provider transport.
  // The original broken HTML is only inert engineering data. A Gate stub never
  // certifies that these historical candidates actually implement the business.
  const originalFetch = globalThis.fetch;
  let externalFetches = 0;
  globalThis.fetch = async () => { externalFetches++; throw new Error('HTTP forbidden in injected HTML repair integration'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const worktree = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const prefix = '.city-agent-html-repair-review-';
  const directory = mkdtempSync(path.join(worktree, prefix));
  const store = new ProductionStore(directory);
  let pipeline: ProductionPipeline | undefined;
  t.after(async () => {
    await pipeline?.stop();
    assert.equal(path.dirname(directory), worktree);
    assert.ok(path.basename(directory).startsWith(prefix));
    assert.equal(lstatSync(directory).isDirectory(), true);
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(realpathSync(directory), directory);
    rmSync(directory, { recursive: true, force: true });
  });
  for (const agent of store.agents()) store.patchAgent(agent.id, {
    modelId: agent.role, apiKey: `html-repair-free-engineering-token-${agent.role}`,
    baseUrl: 'https://example.invalid', pricing: { currency: 'USD', inputPerMillion: 0.3, outputPerMillion: 1.2 },
  });
  store.patchJevConfig({ enabled: true, apiKey: 'html-repair-free-engineering-jev-token', minScore: 3, minConfidence: 0.5 });
  const input = productionRunInputSchema.parse({ ...source.input, agentIds: store.agents().map(agent => agent.id), requirement: { ...source.input.requirement, id: 'FREE-HTML-REPAIR-REVIEW', source: 'Injected engineering integration, no model or browser delivery', kind: 'illustrative' } });
  const queued: ProductionRun = {
    id: randomUUID(), input, evidenceKind: 'injected-test', status: 'queued', createdAt: new Date().toISOString(),
    agentSnapshot: store.agents(), jevSnapshot: store.jevConfig(), events: [], calls: [], jevCalls: [], verifications: [], outputs: [],
    gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [],
  };
  store.addRun(queued, input.agentIds);
  const jevContexts: JevCandidateContext[] = [];
  const llmRequests: Array<Record<string, any>> = [];
  const gateHtml: string[] = [];
  let dispatches = 0;
  const roleCall: typeof runRole = async (agent, _system, prompt) => {
    const request = JSON.parse(prompt);
    let text: string;
    if (agent.modelId === 'verifier') {
      llmRequests.push(request);
      text = JSON.stringify({ decision: 'accept', selectedCandidateId: request.candidates[0].id, scores: request.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected oracle only; no actual semantic quality judgment' })), reason: 'Free engineering dispatch, not autonomous delivery evidence' });
    } else if (agent.modelId === 'product') text = raw('product');
    else if (agent.modelId === 'researcher') text = raw('research');
    else if (agent.modelId === 'tester') text = raw('acceptance');
    else if (agent.modelId === 'developer') text = raw(request.context.cycle ? 'repair-1' : 'implement');
    else if (agent.modelId === 'project-manager') {
      text = request.context.gate ? JSON.stringify({ decision: request.context.gate.passed ? 'proceed' : 'revise', summary: 'Follow the injected Gate; preserve all frozen checks', tasks: [{ id: 'bounded-next', owner: 'developer', description: 'Use the shared repair pool without editing frozen acceptance' }], risks: ['Injected Gate pass is not historical HTML quality evidence'] }) : raw('think-design');
    } else throw new Error('Unexpected injected role');
    return { text, inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Injected role output; no native Harness or HTTP' };
  };
  pipeline = new ProductionPipeline(store, {
    roleCall,
    acceptancePreflight: async checks => { assert.deepEqual(checks, frozenChecks); return { valid: true, errors: [] }; },
    gate: async (html, checks) => {
      assert.deepEqual(checks, frozenChecks); gateHtml.push(html);
      const passed = gateHtml.length === 2;
      return { passed, checks: [{ name: 'Injected Gate oracle; not actual browser behavior', passed }], summary: 'Injected first failure / second success for context wiring only' };
    },
    jevCall: async (config, context, signal) => {
      jevContexts.push(structuredClone(context));
      return evaluateJevCandidates(config, context, signal, { fetch: (async (_url, init) => {
        dispatches++;
        const request = JSON.parse(String(init!.body));
        const answers: Record<string, unknown> = {};
        for (const dimension of ['coverage', 'consistency', 'scope']) {
          const id = `c0_${dimension}`;
          const levels: string[] = request.questions[id].criteria;
          answers[id] = { type: 'score', score: 4, legend: Object.fromEntries(levels.map((label, index) => [String(index), label])), probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 }, confidence: 1 };
        }
        // Valid but low-concentration Choice requests exactly one independent
        // LLM review. These are synthetic fetch dispatches, not actual HTTP.
        answers.c0_safe = { type: 'noul', noul: 1 };
        answers.best = { type: 'choice', choice: context.candidates[0].id, probabilities: { [context.candidates[0].id]: 0.55, abstain: 0.45 }, confidence: 0.1 };
        return new Response(JSON.stringify({ model: config.modelId, answers, usage: { input_tokens: 100, output_tokens: 0 } }));
      }) as typeof fetch });
    },
  });
  pipeline.start(store.run(queued.id)!);
  const deadline = Date.now() + 10000;
  while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pipeline.busy, false, 'The bounded injected pipeline must finish');
  const final = store.run(queued.id)!;
  assert.equal(final.status, 'completed', final.error);
  assert.equal(final.evidenceKind, 'injected-test'); assert.equal(final.input.mode, 'live');
  assert.equal(final.input.requirement.kind, 'illustrative'); assert.equal(final.repairs, 1);
  assert.equal(final.repairHistory!.length, 1); assert.equal(final.repairHistory![0].kind, 'gate-repair');
  assert.deepEqual(gateHtml, [previousHtml, repairedHtml]);
  assert.deepEqual(final.gateHistory.map(gate => gate.passed), [false, true]);
  assert.equal(final.calls.length, 16); assert.equal(dispatches, 8); assert.equal(final.jevCalls!.length, 8); assert.equal(llmRequests.length, 8);
  assert.equal(externalFetches, 0); assert.ok(final.calls.every(call => call.executionSource === 'injected'));
  assert.ok(final.jevCalls!.every(call => call.evaluation.status === 'uncertain'));
  const ledger = projectProductionLedger(final);
  assert.equal(ledger.requests.actualProviderRequests, null, 'Injected dispatches do not prove HTTP or free provider spending');
  assert.equal(final.validationContract!.reviewContextVersion, REVIEW_CONTEXT_PROJECTION_VERSION);
  assert.equal(final.frozenContract!.validationContractHash, hash(final.validationContract));
  assert.deepEqual(final.frozenContract!.checks, frozenChecks);

  const prior = final.calls.find(call => call.role === 'developer' && call.phase === 'implement')!;
  const repair = final.calls.find(call => call.role === 'developer' && call.phase === 'repair-1')!;
  assert.equal(prior.selected, true); assert.equal(repair.selected, true);
  assert.equal(prior.rawOutput, raw('implement')); assert.equal(repair.rawOutput, raw('repair-1'));
  const generation = JSON.parse(repair.userPrompt).context;
  assert.equal(generation.feedback.previousHtml, previousHtml, 'The generator retains the exact complete selected prior code');
  assert.deepEqual(generation.feedback.failedGate, final.gateHistory[0]);
  assert.deepEqual(generation.feedback.decision, final.outputs.find(output => output.phase === 'feedback-0')!.value);
  assert.equal(generation.feedback.decision.decision, 'revise');
  assert.equal((final.outputs.find(output => output.phase === 'feedback-1')!.value as { decision: string }).decision, 'proceed');
  assert.deepEqual(generation.frozenContract, final.frozenContract);

  const jev = jevContexts.find(context => context.phase === 'repair-1')!;
  const llm = llmRequests.find(request => request.criteria.phase === 'repair-1')!;
  assert.ok(jev); assert.ok(llm);
  const review = jev.reviewContext as Record<string, any>;
  assert.deepEqual(llm.state.reviewContext, review);
  assert.deepEqual(llm.candidates, jev.candidates);
  assert.deepEqual(jev.candidates, [{ id: repair.candidateId, value: { html: repairedHtml } }]);
  assert.equal(Object.hasOwn(review.feedback, 'previousHtml'), false);
  assert.deepEqual(review.feedback, { failedGate: generation.feedback.failedGate, decision: generation.feedback.decision });
  assert.deepEqual(review.frozenContract, final.frozenContract);
  assert.equal(jev.frozenHash, final.frozenContract!.hash); assert.equal(llm.criteria.frozenHash, final.frozenContract!.hash);
  assert.equal(jev.goal, input.brief); assert.equal(llm.criteria.goal, input.brief);
  assert.equal(jev.acceptance, input.requirement.acceptance); assert.equal(llm.criteria.acceptance, input.requirement.acceptance);
  const reference: GenerationCodeReference = {
    version: REVIEW_CONTEXT_PROJECTION_VERSION, sourceRoleCallIds: [repair.id], sourcePath: 'role-call.userPrompt.context.feedback.previousHtml',
    priorRoleCallId: prior.id, priorCandidateId: prior.candidateId, sha256: hash(previousHtml),
  };
  assert.deepEqual(review.generationCodeReference, reference);
  assert.deepEqual(llm.state.reviewContext.generationCodeReference, reference);
  const retained = { ...review }; delete retained.generationCodeReference; delete retained.reviewContextVersion;
  const expected = structuredClone(generation); delete expected.feedback.previousHtml;
  assert.deepEqual(retained, expected, 'No Gate, PM, complete business, budget or frozen context is summarized or removed');
  for (const context of jevContexts) {
    const independent = llmRequests.find(request => request.criteria.phase === context.phase)!;
    assert.ok(independent); assert.deepEqual(independent.state.reviewContext, context.reviewContext);
    assert.deepEqual(independent.candidates, context.candidates);
  }
  const manifest = JSON.parse(store.readArtifact(final.id, 'delivery-manifest.json'));
  const evidence = JSON.parse(store.readArtifact(final.id, 'evidence.json'));
  assert.equal(manifest.evidenceKind, 'injected-test'); assert.equal(evidence.evidenceKind, 'injected-test');
  assert.equal(manifest.validationContract.reviewContextVersion, 'production-review-context-v2');
  assert.equal(evidence.validationContract.reviewContextVersion, 'production-review-context-v2');
  assert.equal(manifest.validationContractHash, hash(final.validationContract));
  assert.deepEqual(manifest.frozenContract, final.frozenContract);
  assert.equal(manifest.sourceSha256, hash(repairedHtml)); assert.equal(store.readArtifact(final.id, 'index.html'), repairedHtml);
  assert.equal(JSON.stringify(source), sourceBefore); assert.deepEqual(historical(), originals);
  t.diagnostic('Free injected wiring only: eight in-memory Jev dispatches and sixteen injected role records; no provider HTTP, native SDK, generated HTML or browser execution. Historical HTML01 remains failed and all four raw hashes are unchanged.');
});
