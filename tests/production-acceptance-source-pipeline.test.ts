import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { runGate, preflightAcceptanceChecks, type AcceptanceCheck } from '../server/gate.js';
import { ProductionPipeline } from '../server/production/pipeline.js';
import { ProductionStore, hash } from '../server/production/store.js';
import { ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_GROUP_VERSION, acceptancePlanSchema, parseAcceptancePlan, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION, diagnoseAcceptanceSource } from '../server/production/acceptance-source-diagnostics.js';
import { SOURCE_BOUND_GROUPED_PROMPT_VERSION, SOURCE_BOUND_ACCEPTANCE_PLAN_INSTRUCTIONS, SOURCE_QUOTE_INSTRUCTIONS } from '../server/production/contracts.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';

// FREE injected engineering only. All six-role and Verifier outputs, usage and
// verdicts are fixtures, never model-quality or autonomous-delivery evidence.
// Only the named final Gate uses Chromium on this handwritten test HTML.
const brief = 'Build an offline list with exact item addition.';
const acceptance = 'Adding an item shows exact text and count. Empty input must not add a record.';
const source = { brief, acceptance };
function planFixture(): AcceptancePlan {
  return { version: ACCEPTANCE_PLAN_VERSION,
    obligations: [
      { id: 'add', source: 'brief', quote: 'offline list', scenario: 'Independent positive state.', expected: 'Exact item text and count.' },
      { id: 'empty', source: 'acceptance', quote: 'Empty input must not add a record.', scenario: 'Independent empty state.', expected: 'No record and a warning.' },
    ],
    groups: ['add', 'empty'].map(id => ({ id, checks: [{ id: `c-${id}`, obligationIds: [id], setup: 'Independent fresh page.',
      exercise: 'Fill and click the explicit add button.', assertions: 'Check exact business result and count.', stepBudget: 4 }] })),
  };
}
function checkFixture(id: string): AcceptanceCheck {
  const empty = id === 'c-empty';
  return { name: `Test-owned source-binding ${id}`, steps: [
    { action: 'fill', selector: '#input', value: empty ? '' : 'Example item' }, { action: 'click', selector: '#add' },
    { action: 'assertCount', selector: '.item', count: empty ? 0 : 1 },
    { action: 'assertTextExact', selector: empty ? '#warning' : '.item .label', text: empty ? 'Required' : 'Example item' },
  ] };
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Free source-binding fixture</title></head><body>
<h1>Test-authored offline list</h1><label>Item<input id="input"></label><button id="add">Add</button><p id="warning"></p><ul id="items"></ul>
<script>document.getElementById('add').onclick=()=>{const input=document.getElementById('input'),warning=document.getElementById('warning');
if(!input.value.trim()){warning.textContent='Required';return;}const row=document.createElement('li'),label=document.createElement('span');
row.className='item';label.className='label';label.textContent=input.value;row.append(label);document.getElementById('items').append(row);input.value='';warning.textContent='';};</script></body></html>`;
type Capture = { phase: string; data: any; system: string };
function fixture(t: TestContext, options: { badPlans: number; realGate?: boolean; failedGate?: boolean } = { badPlans: 1 }) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-source-pipeline-'));
  const store = new ProductionStore(directory);
  for (const agent of store.agents()) store.patchAgent(agent.id, { apiKey: `group-fixture-${agent.role}-never-a-real-key`,
    pricing: { inputPerMillion: .30, outputPerMillion: 1.20, currency: 'USD' } });
  const input = productionRunInputSchema.parse({ brief, capability: 'offline-single-html', mode: 'live', verifierEngine: 'llm-rubric',
    implementationEvidencePolicy: 'legacy', acceptanceStrategy: 'planned-groups-v1', candidateCount: 1, budgetAuthorized: true,
    agentIds: store.agents().map(agent => agent.id), requirement: { id: 'FREE-SOURCE-BINDING', source: 'Test-authored injected requirement; not real business or model evidence', acceptance, kind: 'illustrative' },
    limits: { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1 } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test',
    agentSnapshot: store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const captures: Capture[] = []; let planCalls = 0; let gates = 0;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP allowed in free source-binding fixtures'); });
  const pipeline = new ProductionPipeline(store, {
    roleCall: async (_agent, system, prompt) => {
      const data = JSON.parse(prompt); const phase = data.candidates ? `${data.criteria.phase}:verify` : data.context.phaseReadiness.phase;
      captures.push({ phase, data, system }); let value: unknown;
      if (data.candidates) value = { decision: 'accept', selectedCandidateId: data.candidates[0].id,
        scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected Oracle; not model-quality evidence.' })), reason: 'Test verdict only; frozen Gate remains mandatory.' };
      else if (phase === 'product') value = { goal: brief, scope: 'offline-single-html', acceptance: [acceptance], exclusions: [] };
      else if (phase === 'research') value = { observations: ['Use actual visible business result nodes.'], constraints: ['Offline and fixed Gate limits.'], unknowns: [] };
      else if (phase === 'think-design' || phase.startsWith('feedback-')) value = {
        decision: phase.startsWith('feedback-') && options.failedGate ? 'revise' : 'proceed', summary: 'Injected feasibility or Gate feedback decision only.',
        tasks: [{ id: 'test', owner: 'tester', description: 'Construct exact checks before implementation; never override Gate.' }], risks: [],
      };
      else if (phase === 'acceptance-plan') {
        planCalls++; const candidate = planFixture();
        if (planCalls <= options.badPlans) candidate.obligations[1]!.quote = 'Empty input must not add a record!';
        value = candidate;
      } else if (phase.startsWith('acceptance-group-')) value = { version: ACCEPTANCE_GROUP_VERSION, planHash: data.context.acceptancePlanHash,
        attemptId: data.context.constructionAttemptId, groupId: data.context.plannedGroup.id,
        checks: data.context.plannedGroup.checks.map((slot: { id: string }) => ({ checkId: slot.id, check: checkFixture(slot.id) })),
      };
      else if (phase === 'implement') { assert.ok(store.run(run.id)!.frozenContract); value = { html }; }
      else throw new Error(`Unexpected injected source-binding phase ${phase}`);
      return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Injected source-binding fixture, never a model request' };
    },
    acceptancePreflight: async (checks, signal) => options.realGate ? preflightAcceptanceChecks(checks, signal) : { valid: true, errors: [] },
    gate: async (code, checks, signal) => {
      gates++; assert.equal(code, html); assert.deepEqual(checks, store.run(run.id)!.frozenContract!.checks);
      if (options.realGate) return runGate(code, checks, signal);
      return { passed: !options.failedGate, checks: [{ name: 'Injected Gate only; not browser evidence', passed: !options.failedGate }] };
    },
    jevCall: async () => { throw new Error('No Jev request allowed in free source-binding fixtures'); },
  });
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  return { store, captures, start: async () => {
    pipeline.start(store.run(run.id)!); const deadline = Date.now() + 20000;
    while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(pipeline.busy, false, 'Free fixture must terminate');
    const saved = store.run(run.id)!;
    assert.equal(saved.evidenceKind, 'injected-test');
    assert.ok(saved.calls.every(call => call.executionSource === 'injected' && !call.providerRequests));
    assert.ok(saved.calls.length <= 24); assert.ok(saved.repairs <= 2);
    return saved;
  }, gates: () => gates };
}
const plans = (run: ProductionRun) => run.calls.filter(call => call.phase === 'acceptance-plan');
function assertNoDelivery(run: ProductionRun) {
  assert.equal(run.status, 'failed'); assert.equal(run.frozenContract, undefined); assert.equal(run.gateHistory.length, 0);
  assert.equal(run.calls.some(call => call.role === 'tester' || call.role === 'developer'), false);
  assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
}

for (const badPlans of [1, 2]) test(`${badPlans} bad source quote(s) regenerate complete plans within the original shared budget then execute frozen Chromium Gate`, async t => {
  const f = fixture(t, { badPlans, realGate: true }); const run = await f.start();
  assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, badPlans); assert.equal(run.calls.length, 15 + badPlans);
  assert.equal(plans(run).length, badPlans + 1); assert.equal(new Set(plans(run).map(call => call.candidateId)).size, badPlans + 1);
  assert.equal(run.validationContract!.acceptanceSourceDiagnosticsVersion, ACCEPTANCE_SOURCE_DIAGNOSTICS_VERSION);
  assert.ok(run.calls.every(call => call.promptVersion === SOURCE_BOUND_GROUPED_PROMPT_VERSION));
  const captures = f.captures.filter(capture => capture.phase === 'acceptance-plan');
  for (let i = 0; i < badPlans; i++) {
    const call = plans(run)[i]!; const capture = captures[i]!; const regenerated = captures[i + 1]!;
    const outputContractHash = hash(capture.data.outputContract); const diagnostic = call.acceptanceSourceDiagnostic!;
    assert.equal(capture.system.includes(SOURCE_BOUND_ACCEPTANCE_PLAN_INSTRUCTIONS), true);
    assert.equal(capture.system.includes(SOURCE_QUOTE_INSTRUCTIONS), true);
    assert.equal(diagnostic.callId, call.id); assert.equal(diagnostic.candidateId, call.candidateId);
    assert.equal(diagnostic.sourceSha256, hash(call.rawOutput)); assert.equal(diagnostic.outputContractHash, outputContractHash);
    assert.deepEqual(diagnostic.materials, { briefSha256: hash(brief), acceptanceSha256: hash(acceptance) });
    assert.deepEqual(diagnostic.mismatches, [{ obligationIndex: 1, source: 'acceptance' }]);
    assert.deepEqual(diagnostic, diagnoseAcceptanceSource(call.rawOutput, source, { callId: call.id, candidateId: call.candidateId, outputContractHash }));
    assert.equal(call.roleSchemaDiagnostic, undefined); assert.notEqual(call.selected, true);
    assert.equal(acceptancePlanSchema.safeParse(JSON.parse(call.rawOutput)).success, true);
    assert.throws(() => parseAcceptancePlan(JSON.parse(call.rawOutput), source), /plan-source-quote/);
    assert.deepEqual(regenerated.data.context.regeneration.rejectedCandidates[0].acceptanceSourceDiagnostic, diagnostic);
    assert.equal(regenerated.data.context.regeneration.rejectedCandidates[0].rawOutputSha256, hash(call.rawOutput));
    assert.equal(regenerated.data.context.remainingRepairs, 2 - (i + 1));
    assert.equal(regenerated.data.input.brief, brief); assert.equal(regenerated.data.input.requirement.acceptance, acceptance);
  }
  const valid = plans(run).at(-1)!;
  assert.equal(valid.selected, true); assert.equal(valid.acceptanceSourceDiagnostic, undefined);
  assert.deepEqual(parseAcceptancePlan(JSON.parse(valid.rawOutput), source), planFixture());
  assert.equal(run.calls.filter(call => call.phase === 'acceptance-plan:verify').length, 1, 'No Oracle request for malformed source pools');
  assert.equal(run.calls.filter(call => call.role === 'tester').length, 2);
  assert.equal(run.calls.filter(call => call.role === 'developer').length, 1);
  assert.equal(f.gates(), 1); assert.equal(run.gateHistory.length, 1); assert.equal(run.gate!.passed, true);
  assert.equal(run.gate!.checks.length, 3, 'Real Chromium page check plus two actual business checks');
  assert.deepEqual(run.frozenContract!.checks, [checkFixture('c-add'), checkFixture('c-empty')]);
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1);
  assert.ok(run.calls.findIndex(call => call.phase === 'implement') > run.calls.findIndex(call => call.phase === 'acceptance:verify'));
  assert.equal(f.store.readArtifact(run.id, 'index.html'), html);
  t.diagnostic('Free injected roles/Verifier plus real controlled Chromium on hand-written HTML; not a real-model delivery or paid experiment.');
});

test('three source-mismatched plans stop after exactly two shared repairs without tester, development or Gate', async t => {
  const f = fixture(t, { badPlans: 3 }); const run = await f.start(); assertNoDelivery(run);
  assert.equal(plans(run).length, 3); assert.equal(run.repairs, 2); assert.equal(run.calls.length, 9); assert.equal(f.gates(), 0);
  assert.equal(run.calls.some(call => call.phase === 'acceptance-plan:verify'), false);
  assert.ok(plans(run).every(call => call.acceptanceSourceDiagnostic?.mismatchCount === 1 && !call.selected));
  assert.match(run.error!, /全局自动返修次数耗尽/); assert.match(run.error!, /plan-source-quote/);
});

test('two source repairs do not replenish the shared allowance after a failed Gate', async t => {
  const f = fixture(t, { badPlans: 2, failedGate: true }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(f.gates(), 1); assert.equal(run.gate!.passed, false);
  assert.match(run.error!, /全局自动返修次数耗尽/); assert.equal(run.calls.some(call => call.phase === 'repair-1'), false);
  assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

for (const kind of ['call-id', 'raw-hash', 'materials-hash', 'output-contract-hash', 'mismatch-index', 'deleted-diagnostic', 'changed-raw'] as const) {
  test(`source-call ${kind} tampering is fatal before a second planning or downstream role call`, async t => {
    const f = fixture(t); let changed = false; const save = f.store.save.bind(f.store);
    t.mock.method(f.store, 'save', (run: ProductionRun) => {
      const call = plans(run)[0];
      if (!changed && call?.acceptanceSourceDiagnostic) {
        changed = true; const diagnostic = structuredClone(call.acceptanceSourceDiagnostic);
        if (kind === 'deleted-diagnostic') delete call.acceptanceSourceDiagnostic;
        else if (kind === 'changed-raw') call.rawOutput += ' ';
        else call.acceptanceSourceDiagnostic = {
          ...diagnostic,
          ...(kind === 'call-id' ? { callId: randomUUID() } : {}),
          ...(kind === 'raw-hash' ? { sourceSha256: '0'.repeat(64) } : {}),
          ...(kind === 'materials-hash' ? { materials: { ...diagnostic.materials, acceptanceSha256: '0'.repeat(64) } } : {}),
          ...(kind === 'output-contract-hash' ? { outputContractHash: '0'.repeat(64) } : {}),
          ...(kind === 'mismatch-index' ? { mismatches: [{ obligationIndex: 0, source: 'brief' }] } : {}),
        };
      }
      save(run);
    });
    const run = await f.start(); assertNoDelivery(run); assert.equal(changed, true);
    assert.equal(plans(run).length, 1); assert.equal(run.calls.length, 7); assert.equal(f.gates(), 0);
    assert.match(run.error!, /Acceptance source diagnostic binding rejected/);
    assert.equal(f.captures.filter(capture => capture.phase === 'acceptance-plan').length, 1);
  });
}

for (const kind of ['diagnostic-copy', 'raw-sha-copy'] as const) test(`rejection feedback ${kind} tampering stops before the next role dispatch`, async t => {
  const f = fixture(t); let changed = false; const sanitize = f.store.sanitize.bind(f.store);
  t.mock.method(f.store, 'sanitize', (value: unknown, runId?: string) => {
    const candidate = value as { regeneration?: { rejectedCandidates?: Array<{ acceptanceSourceDiagnostic?: unknown; rawOutputSha256: string }> } } | null;
    const feedback = candidate?.regeneration?.rejectedCandidates?.[0];
    if (!changed && feedback?.acceptanceSourceDiagnostic) {
      changed = true;
      if (kind === 'diagnostic-copy') feedback.acceptanceSourceDiagnostic = {};
      else feedback.rawOutputSha256 = '0'.repeat(64);
    }
    return sanitize(value, runId);
  });
  const run = await f.start(); assertNoDelivery(run); assert.equal(changed, true); assert.equal(plans(run).length, 1);
  assert.equal(run.calls.length, 7); assert.equal(f.gates(), 0);
  assert.match(run.error!, /项目经理拒绝反馈与真实调用血缘不一致/);
});
