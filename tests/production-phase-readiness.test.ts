import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import * as contracts from '../server/production/contracts.js';
import { PHASE_READINESS_VERSION, PHASE_READINESS_PROTOCOL_LITERALS, PHASE_READINESS_REVIEW_INSTRUCTIONS, productionPhaseReadiness } from '../server/production/phase-readiness.js';
import { startupPublicGuardInputs } from '../server/production/startup-public-contract.js';
import { assertPublicCollisionSafe } from '../server/production/public-collision-guard.js';
import { ProductionPipeline } from '../server/production/pipeline.js';
import { ProductionStore, hash } from '../server/production/store.js';
import { ACCEPTANCE_PLAN_VERSION, ACCEPTANCE_GROUP_VERSION, type AcceptancePlan } from '../server/production/acceptance-plan.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import type { AcceptanceCheck } from '../server/gate.js';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const phases = [['product', 'product'], ['researcher', 'research'], ['project-manager', 'think-design'], ['project-manager', 'acceptance-plan'], ['tester', 'acceptance-group-g1'], ['tester', 'acceptance'], ['developer', 'implement'], ['developer', 'repair-1'], ['developer', 'repair-2'], ['project-manager', 'feedback-0'], ['project-manager', 'feedback-1'], ['project-manager', 'feedback-2']] as const;

test('stage policy depends only on exact registered control-plane role/phase, never supplied verdicts', () => {
  for (const [role, phase] of phases) {
    const facts = productionPhaseReadiness(role, phase);
    assert.equal(facts.version, PHASE_READINESS_VERSION);
    assert.equal(facts.source, 'control-plane-stage-policy');
    assert.equal(facts.role, role); assert.equal(facts.phase, phase);
    assert.ok(Object.isFrozen(facts) && Object.isFrozen(facts.requiredNow) && Object.isFrozen(facts.downstreamArtifacts));
    assert.ok(Buffer.byteLength(JSON.stringify(facts)) < 1600);
    assert.equal(Object.hasOwn(facts, 'passed'), false);
    assert.equal(Object.hasOwn(facts, 'decision'), false);
    assert.equal(Object.hasOwn(facts, 'gateExecuted'), false);
    assert.equal(Object.hasOwn(facts, 'acceptanceFrozen'), false);
    assert.match(facts.evidenceBoundary, /not generated\/frozen\/executed\/passed evidence/);
    assert.deepEqual(productionPhaseReadiness(role, phase), facts);
    assert.throws(() => { (facts.requiredNow as string[]).push('fake pass'); }, TypeError);
  }
  assert.match(productionPhaseReadiness('project-manager', 'think-design').proceedAuthorizes!, /Only acceptance-plan.*not implementation, freeze or delivery/);
  assert.match(productionPhaseReadiness('tester', 'acceptance').currentArtifact, /Complete actual checks/);
  assert.match(productionPhaseReadiness('project-manager', 'feedback-0').proceedAuthorizes!, /actual Gate passed.*never overrides it/);
  let observations = 0;
  const malicious = new Proxy({}, { get: () => { observations++; throw new Error('Must not inspect supplied model state'); } });
  for (const [role, phase] of [['verifier', 'think-design'], ['tester', 'think-design'], ['project-manager', 'feedback-3'], ['developer', 'repair-3'], ['tester', 'acceptance-group-g1\n'], ['tester', 'acceptance-group-'], ['product', malicious], [malicious, 'research'], ['researcher', new String('research')]] as unknown[][]) {
    assert.throws(() => productionPhaseReadiness(role as string, phase as string), /Stage readiness unavailable/);
  }
  assert.equal(observations, 0);
  assert.throws(() => (productionPhaseReadiness as (...args: unknown[]) => unknown)('project-manager', 'think-design', { passed: true }), /Stage readiness unavailable/);
});

test('new v5 replaces contradictory pre-stage demands and independently rejects fabricated capacity and genuine blockers', () => {
  assert.equal(contracts.PHASE_READY_GROUPED_PROMPT_VERSION, 'production-html-grouped-v5');
  const research = contracts.PHASE_READY_GROUPED_CONTRACT_INSTRUCTIONS.researcher;
  const pm = contracts.PHASE_READY_GROUPED_CONTRACT_INSTRUCTIONS['project-manager'];
  assert.equal(research.includes('在现有observations/constraints中简述验收分组、逐组setup/操作/断言步数及合计'), false);
  assert.equal(pm.includes('研发前不能仅复述上限'), false);
  assert.equal(pm.includes(contracts.STEP_AUDIT_PLANNING_INSTRUCTIONS), false);
  assert.match(research, /当前必要blocking和后续deferred/);
  assert.match(pm, /proceed.*控制面进入本角色acceptance-plan.*tester定义具体CSS\/checks/);
  assert.match(pm, /tasks\.owner仍仅用outputContract允许的角色/);
  assert.match(pm, /这不是批准立即研发、冻结或交付/);
  assert.match(pm, /实质设计缺口用revise.*真正不支持\/必要blocking用stop/);
  assert.match(pm, /该revise链路只重生成产品、研究员与本决策/);
  assert.match(pm, /不得将未生成steps的估计写成实际核算达标/);
  assert.match(pm, /若context\.gate存在.*不能重新分组、改写冻结checks或要求重新冻结/);
  assert.match(PHASE_READINESS_REVIEW_INSTRUCTIONS, /确定漏计独立setup、必需断言或原容量不可达/);
  assert.match(PHASE_READINESS_REVIEW_INSTRUCTIONS, /真实业务遗漏、范围缺口或必要blocking未解决.*低于3且abstain/);
  assert.match(PHASE_READINESS_REVIEW_INSTRUCTIONS, /acceptance必须直接核对全部真实steps/);
  assert.match(PHASE_READINESS_REVIEW_INSTRUCTIONS, /不强制接受候选.*不覆盖最终Gate/);
  assert.equal(contracts.PHASE_READY_ACCEPTANCE_PLAN_INSTRUCTIONS, contracts.OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS);
  assert.equal(contracts.PHASE_READY_ACCEPTANCE_GROUP_INSTRUCTIONS, contracts.OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS);
  assert.equal(contracts.PHASE_READY_CONSTRUCTION_REVIEW_INSTRUCTIONS, contracts.OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS);
  for (const role of ['product', 'tester', 'developer'] as const) assert.equal(contracts.PHASE_READY_GROUPED_CONTRACT_INSTRUCTIONS[role], contracts.OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS[role]);
});

test('every v1-v4 prompt export and unchanged schemas keep their pre-change hashes', () => {
  const expected = {
    CONTRACT_INSTRUCTIONS: '785a706c7c1410bf24da0e87df64e56ec9544e370f24ee4d038a47140914da33',
    GROUPED_CONTRACT_INSTRUCTIONS: '61e48d77c829f9aa488a9f3d9c83af3ac540e8a392d6ebe9f6908e6d51b1cd86',
    GROUPED_ACCEPTANCE_PLAN_INSTRUCTIONS: '3962a6e0974bb558fa296f780e492d1bd3c1c90a64e64c8b75777ab4e028c3ab',
    GROUPED_ACCEPTANCE_GROUP_INSTRUCTIONS: '78050dbf7612b533b813fb59ba1e602f9940303a995e343bc788214ad312d231',
    STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS: '1833391798be639bad4dfcb5fde0778b2f5d44b8fb8b59e42d818315157753c3',
    STEP_AUDITED_ACCEPTANCE_PLAN_INSTRUCTIONS: '85a29440c3baf51820ceeaf43566a54821d13b558642d97726f0478ef16a912c',
    STEP_AUDITED_ACCEPTANCE_GROUP_INSTRUCTIONS: 'f186069f992d8273aad5fcafc6b5843a2260013282d10eaedc51838cdafd704c',
    STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS: 'f394f30d964c3d8ffd855757d899052489fd09fedeaa147d2a111ad3e2e5ef03',
    OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS: '5969ba7fc8aad4f8e98c9c04270958a7014f5784fff19c00bcc08baddb491d7f',
    OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS: '3a515f512d706265cb4546251d77151ef09a274d2ea8b6beba901167d056451d',
    OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS: 'f186069f992d8273aad5fcafc6b5843a2260013282d10eaedc51838cdafd704c',
    OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS: 'f394f30d964c3d8ffd855757d899052489fd09fedeaa147d2a111ad3e2e5ef03',
  };
  for (const [name, expectedHash] of Object.entries(expected)) assert.equal(sha(contracts[name as keyof typeof contracts]), expectedHash, name);
  assert.equal(sha(contracts.outputContractSnapshot(contracts.planSchema)), 'd5d48fc592c108c98225cdadbe952e439a030b90e0218c66ca7d8604fe910f96');
  assert.equal(sha(contracts.outputContractSnapshot(contracts.testsSchema)), 'a51e8da7c3f698165c82366c50d885e6d829894985e2a084064b8a5eb5e8f661');
  assert.equal(sha(contracts.outputContractSnapshot(contracts.verifierSchema)), 'c07ff638d2e87266b5da1545df1589d60fb09ce8a37c2915700f2585dab1d86b');
  for (const capability of ['offline-single-html', 'camera-scene-v1'] as const) assert.ok(!JSON.stringify(contracts.contractProfile(capability)).includes(PHASE_READINESS_VERSION));
});

test('unchanged final check schema still rejects a thirteenth check and twenty-first step without rewriting either fixture', () => {
  const check = checkFixture('c-add');
  while (check.steps.length < 20) check.steps.push({ action: 'assertCount', selector: '.item', count: 1 });
  const maximum = { checks: Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(check), name: `Structural-only capacity fixture ${index}` })) };
  const original = JSON.stringify(maximum);
  assert.equal(contracts.testsSchema.safeParse(maximum).success, true);
  assert.equal(contracts.testsSchema.safeParse({ checks: [...maximum.checks, structuredClone(check)] }).success, false);
  const overflow = structuredClone(maximum); overflow.checks[0].steps.push({ action: 'assertCount', selector: '.item', count: 1 });
  assert.equal(contracts.testsSchema.safeParse(overflow).success, false);
  assert.equal(overflow.checks[0].steps.length, 21); assert.equal(JSON.stringify(maximum), original);
});

function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
test('complete startup facts, verifier suffix and v5 instructions fit unchanged six-distinct-length credential work limits', () => {
  const key = randomBytes(32);
  const credentials = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'].map(role => encrypt(key, `group-fixture-${role}-never-a-real-key`));
  const inputs = startupPublicGuardInputs({ capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' });
  const instructions = inputs.filter((value): value is { instructions: string } => Object.hasOwn(value as object, 'instructions')).map(value => value.instructions);
  assert.deepEqual(instructions, [...Object.values(contracts.PHASE_READY_GROUPED_CONTRACT_INSTRUCTIONS), contracts.PHASE_READY_ACCEPTANCE_PLAN_INSTRUCTIONS, contracts.PHASE_READY_ACCEPTANCE_GROUP_INSTRUCTIONS, contracts.PHASE_READY_CONSTRUCTION_REVIEW_INSTRUCTIONS, PHASE_READINESS_REVIEW_INSTRUCTIONS]);
  assert.ok(inputs.some(value => Object.hasOwn(value as object, 'phaseReadinessProtocolLiterals')));
  assert.ok(inputs.filter(value => Object.hasOwn(value as object, 'phaseReadiness')).length >= phases.length);
  for (const value of inputs) assert.doesNotThrow(() => assertPublicCollisionSafe(value, key, credentials));
  for (const capability of ['camera-scene-v1', 'offline-single-html'] as const) assert.equal(JSON.stringify(startupPublicGuardInputs({ capability })).includes(PHASE_READINESS_VERSION), false);
  for (const tail of [PHASE_READINESS_VERSION.slice(-16), PHASE_READINESS_REVIEW_INSTRUCTIONS.slice(-16), productionPhaseReadiness('project-manager', 'think-design').proceedAuthorizes!.slice(-16)]) {
    const retainedHistory = encrypt(key, tail);
    assert.throws(() => { for (const value of inputs) assertPublicCollisionSafe(value, key, [retainedHistory]); }, /凭据与评估公开契约冲突/);
  }
  assert.ok(PHASE_READINESS_PROTOCOL_LITERALS.includes('Stage readiness unavailable'));
});

const brief = 'Build an offline list with exact item addition.';
const acceptance = 'Adding an item shows exact text and count. Empty input must not add a record.';
function planFixture(): AcceptancePlan {
  return { version: ACCEPTANCE_PLAN_VERSION,
    obligations: [{ id: 'add', source: 'brief', quote: 'offline list', scenario: 'Independent add state.', expected: 'Exact new item and count.' }, { id: 'empty', source: 'acceptance', quote: 'Empty input must not add a record.', scenario: 'Independent empty state.', expected: 'No record and an error.' }],
    groups: [{ id: 'positive', checks: [{ id: 'c-add', obligationIds: ['add'], setup: 'Independent empty page.', exercise: 'Fill and click add.', assertions: 'Exact business text and actual item count.', stepBudget: 4 }] }, { id: 'negative', checks: [{ id: 'c-empty', obligationIds: ['empty'], setup: 'Independent empty page.', exercise: 'Empty input then click add.', assertions: 'Exact warning and zero records.', stepBudget: 4 }] }] };
}
function checkFixture(id: string): AcceptanceCheck {
  const empty = id === 'c-empty';
  return { name: `Test-owned ${id}`, steps: [{ action: 'fill', selector: '#input', value: empty ? '' : 'Example item' }, { action: 'click', selector: '#add' }, { action: 'assertCount', selector: '.item', count: empty ? 0 : 1 }, { action: 'assertTextExact', selector: empty ? '#warning' : '.item .label', text: empty ? 'Required' : 'Example item' }] };
}
interface FixtureOptions { pm?: 'proceed' | 'revise' | 'stop'; gatePassed?: boolean; forgedPmField?: boolean; overflowSteps?: boolean; preservedBlocker?: boolean; unknownResearchUsage?: boolean; cancelResearch?: boolean; maxCalls?: number; }
function fixture(t: TestContext, options: FixtureOptions = {}) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-phase-readiness-'));
  let shutdown = async () => {};
  t.after(async () => { await shutdown(); rmSync(directory, { recursive: true, force: true }); });
  const store = new ProductionStore(directory);
  for (const agent of store.agents()) store.patchAgent(agent.id, { modelId: agent.role, baseUrl: 'https://example.invalid', apiKey: `group-fixture-${agent.role}-never-a-real-key`, pricing: { inputPerMillion: .30, outputPerMillion: 1.20, currency: 'USD' } });
  const input = productionRunInputSchema.parse({ brief, capability: 'offline-single-html', mode: 'live', verifierEngine: 'llm-rubric', implementationEvidencePolicy: 'legacy', acceptanceStrategy: 'planned-groups-v1', candidateCount: 1, budgetAuthorized: true, agentIds: store.agents().map(agent => agent.id), requirement: { id: 'FREE-PHASE-READINESS', source: 'Test-authored injected control-flow fixture, not real business/model evidence', acceptance, kind: 'illustrative' }, limits: { maxCalls: options.maxCalls ?? 24, maxTokens: 500000, maxOutputTokens: 6000, maxCost: 1, maxDurationMs: 600000, maxRepairCycles: 2 } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const captures: Array<{ phase: string; system: string; data: any }> = [];
  let gateCalls = 0; let pmCalls = 0; let researcherCalls = 0;
  let researchEntered!: () => void;
  const pendingResearch = new Promise<void>(resolve => { researchEntered = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No HTTP allowed in injected readiness fixtures'); };
  const pipeline = new ProductionPipeline(store, {
    roleCall: async (agent, system, prompt, signal) => {
      const data = JSON.parse(prompt); const role = agent.modelId;
      const phase = role === 'verifier' ? `${data.criteria.phase}:verify` : data.context.phaseReadiness.phase;
      captures.push({ phase, system, data });
      let value: unknown;
      if (role === 'verifier') {
        assert.ok(system.includes(PHASE_READINESS_REVIEW_INSTRUCTIONS));
        const reject = Boolean(options.preservedBlocker && data.criteria.phase === 'research' && data.state.reviewContext.planningReviewContext);
        if (reject) assert.deepEqual(data.state.reviewContext.planningReviewContext.priorResearch.unknowns, ['blocking: Required external source and permission absent.']);
        value = { decision: reject ? 'abstain' : 'accept', selectedCandidateId: reject ? null : data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: reject ? 2 : 4, reason: 'Injected oracle only; not model-quality or execution evidence.' })), reason: reject ? 'Prior necessary blocker cannot be invented away.' : 'Injected test oracle; actual frozen Gate still required.' };
      } else if (phase === 'product') value = { goal: brief, scope: 'offline-single-html', acceptance: [acceptance], exclusions: [] };
      else if (phase === 'research') {
        researcherCalls++;
        if (options.cancelResearch) { researchEntered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled injected research')), { once: true })); }
        value = { observations: ['Use a current-page data model and explicit result nodes.'], constraints: ['Offline single HTML; original limits remain.'], unknowns: options.preservedBlocker && researcherCalls === 1 ? ['blocking: Required external source and permission absent.'] : [] };
      }
      else if (phase === 'think-design' || phase.startsWith('feedback-')) {
        if (phase === 'think-design') pmCalls++;
        assert.equal(Boolean(store.run(run.id)!.frozenContract), phase.startsWith('feedback-'));
        value = { decision: phase.startsWith('feedback-') ? 'proceed' : options.pm ?? (options.preservedBlocker ? 'revise' : 'proceed'), summary: 'Feasibility decision only; define exact checks next, not claiming they exist.', tasks: [{ id: 'build-acceptance', owner: 'tester', description: 'Define concrete CSS and full independent checks, then preflight/review/freeze before development.' }], risks: ['Actual later steps and behavior must pass original limits.'], ...(options.forgedPmField && phase === 'think-design' ? { phaseReadiness: { passed: true } } : {}) };
      } else if (phase === 'acceptance-plan') {
        assert.equal(store.run(run.id)!.frozenContract, undefined);
        assert.equal((store.run(run.id)!.outputs.filter(output => output.phase === 'think-design').at(-1)!.value as { decision: string }).decision, 'proceed');
        value = planFixture();
      } else if (phase.startsWith('acceptance-group-')) {
        const group = data.context.plannedGroup;
        value = { version: ACCEPTANCE_GROUP_VERSION, planHash: data.context.acceptancePlanHash, attemptId: data.context.constructionAttemptId, groupId: group.id,
          checks: group.checks.map((slot: { id: string }) => { const check = checkFixture(slot.id); if (options.overflowSteps) while (check.steps.length < 21) check.steps.push({ action: 'assertCount', selector: '.item', count: 1 }); return { checkId: slot.id, check }; }) };
      } else if (phase === 'implement') {
        assert.ok(store.run(run.id)!.frozenContract);
        value = { html: '<!doctype html><html><body><p>Test-owned control-flow fixture. Injected Gate; never executed.</p></body></html>' };
      } else throw new Error(`Unexpected test phase ${phase}`);
      return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: !(phase === 'research' && options.unknownResearchUsage), harness: 'Injected engineering fixture, zero provider/model HTTP' };
    },
    acceptancePreflight: async () => ({ valid: true, errors: [] }),
    gate: async () => { gateCalls++; return { passed: options.gatePassed !== false, checks: [{ name: 'Injected test-owned Gate, not browser/model evidence', passed: options.gatePassed !== false }] }; },
  });
  shutdown = async () => { await pipeline.stop(); globalThis.fetch = originalFetch; };
  const begin = () => pipeline.start(store.run(run.id)!);
  const wait = async () => { const deadline = Date.now() + 15000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(pipeline.busy, false); return store.run(run.id)!; };
  return { captures, store, begin, wait, pendingResearch, cancel: () => pipeline.cancel(run.id), start: async () => { begin(); return wait(); }, counts: () => ({ pmCalls, researcherCalls, gateCalls }) };
}

test('future checks absent at think-design permits an explicit PM proceed, but development waits for independent construction and freeze', async t => {
  const f = fixture(t); const run = await f.start();
  assert.equal(run.status, 'completed', run.error); assert.equal(run.repairs, 0); assert.equal(run.calls.length, 15);
  assert.equal(run.evidenceKind, 'injected-test'); assert.ok(run.calls.every(call => call.executionSource === 'injected' && !call.providerRequests));
  assert.equal((run.validationContract as any).phaseReadinessVersion, PHASE_READINESS_VERSION);
  assert.ok(run.calls.every(call => call.promptVersion === contracts.PHASE_READY_GROUPED_PROMPT_VERSION));
  const pm = f.captures.find(capture => capture.phase === 'think-design')!;
  const review = f.captures.find(capture => capture.phase === 'think-design:verify')!;
  assert.equal(pm.data.context.frozenContract, undefined);
  assert.deepEqual(pm.data.context.phaseReadiness, review.data.state.reviewContext.phaseReadiness);
  assert.equal(pm.data.context.phaseReadiness.proceedAuthorizes, productionPhaseReadiness('project-manager', 'think-design').proceedAuthorizes);
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1);
  assert.ok(run.calls.findIndex(call => call.phase === 'implement') > run.calls.findIndex(call => call.phase === 'acceptance:verify'));
  assert.equal(run.frozenContract!.validationContractHash, hash(run.validationContract));
  assert.equal(JSON.parse(f.store.readArtifact(run.id, 'delivery-manifest.json')).validationContract.phaseReadinessVersion, PHASE_READINESS_VERSION);
  const completeReview = f.captures.find(capture => capture.phase === 'acceptance:verify')!;
  assert.equal(completeReview.data.state.reviewContext.phaseReadiness.currentArtifact, productionPhaseReadiness('tester', 'acceptance').currentArtifact);
  assert.deepEqual(completeReview.data.candidates[0].value.checks, run.frozenContract!.checks);
  t.diagnostic('Free injected control-flow test only: no real model, browser execution or autonomous-delivery success.');
});

test('a genuine PM revise is never rewritten to proceed; all three negative plans and exactly two shared repairs remain', async t => {
  const f = fixture(t, { pm: 'revise' }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(f.counts().pmCalls, 3);
  assert.match(run.error!, /全局自动返修次数耗尽/);
  assert.deepEqual(run.outputs.filter(output => output.phase === 'think-design').map(output => (output.value as { decision: string }).decision), ['revise', 'revise', 'revise']);
  assert.equal(run.frozenContract, undefined); assert.equal(run.acceptanceConstruction, undefined); assert.equal(f.counts().gateCalls, 0);
  assert.ok(!run.calls.some(call => call.role === 'tester' || call.role === 'developer'));
  assert.ok(f.captures.filter(capture => capture.phase === 'think-design:verify').every(capture => capture.data.state.reviewContext.phaseReadiness.proceedAuthorizes === productionPhaseReadiness('project-manager', 'think-design').proceedAuthorizes));
});

test('PM stop is terminal without repair, construction, freeze or implementation', async t => {
  const f = fixture(t, { pm: 'stop' }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /项目经理stop/); assert.equal(run.repairs, 0); assert.equal(f.counts().pmCalls, 1);
  assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0); assert.equal(run.calls.length, 6);
});

test('a candidate cannot smuggle a readiness pass into strict PM output', async t => {
  const f = fixture(t, { forgedPmField: true }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(f.counts().pmCalls, 3);
  assert.equal(run.calls.filter(call => call.phase === 'think-design:verify').length, 0);
  assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
  assert.ok(run.calls.filter(call => call.phase === 'think-design').every(call => call.error && call.rawOutput.includes('"passed":true')));
});

test('future-stage policy never admits actual twenty-one-step fragments or bypasses original budgets', async t => {
  const f = fixture(t, { overflowSteps: true }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2);
  const rejected = run.calls.filter(call => call.phase === 'acceptance-group-positive');
  assert.equal(rejected.length, 3); assert.ok(rejected.every(call => JSON.parse(call.rawOutput).checks[0].check.steps.length === 21));
  assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
  assert.equal(run.calls.some(call => call.role === 'developer' || call.phase === 'acceptance:verify'), false);
  assert.equal(run.input.limits.maxCalls, 24); assert.equal(run.input.limits.maxRepairCycles, 2);
});

test('original necessary external blockers remain intact for independent research review after replanning', async t => {
  const f = fixture(t, { preservedBlocker: true }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().gateCalls, 0);
  const reviews = f.captures.filter(capture => capture.phase === 'research:verify' && capture.data.state.reviewContext.planningReviewContext);
  assert.equal(reviews.length, 2);
  assert.ok(reviews.every(capture => capture.data.state.reviewContext.planningReviewContext.priorResearch.unknowns[0].startsWith('blocking:')));
  assert.ok(!run.calls.some(call => call.role === 'tester' || call.role === 'developer'));
  t.diagnostic('Injected oracle checks provenance delivery, not real-model semantic classification.');
});

test('the actual failed Gate still rejects PM proceed despite any stage readiness policy', async t => {
  const f = fixture(t, { gatePassed: false }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /项目经理试图在Gate失败时交付/);
  assert.equal(run.gate!.passed, false); assert.equal(f.counts().gateCalls, 1); assert.equal(run.repairs, 0);
  assert.ok(run.frozenContract); assert.equal(run.calls.filter(call => call.phase === 'repair-1').length, 0);
});

test('new planning guidance never increases the explicitly configured logical-call budget', async t => {
  const f = fixture(t, { maxCalls: 12, pm: 'revise' }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /请求次数预算耗尽/);
  assert.equal(run.calls.length, 12); assert.equal(run.repairs, 2); assert.equal(run.frozenContract, undefined);
  assert.equal(run.calls.some(call => call.role === 'tester' || call.role === 'developer'), false);
  assert.equal(f.counts().gateCalls, 0);
});

test('unknown research usage stops before any PM or subsequent Verifier, retaining unknown rather than zero', async t => {
  const f = fixture(t, { unknownResearchUsage: true }); const run = await f.start();
  assert.equal(run.status, 'failed'); assert.match(run.error!, /usage.*unknown/);
  assert.equal(run.calls.length, 3); assert.equal(run.repairs, 0); assert.equal(run.frozenContract, undefined);
  assert.equal(run.usage.inputTokens, null); assert.equal(run.usage.outputTokens, null); assert.equal(run.usage.estimatedCost, null);
  assert.equal(f.counts().pmCalls, 0); assert.equal(f.counts().gateCalls, 0);
});

test('cancel aborts pending research and never releases PM, test construction or execution', async t => {
  const f = fixture(t, { cancelResearch: true }); f.begin(); await f.pendingResearch; f.cancel(); const run = await f.wait();
  assert.equal(run.status, 'cancelled'); assert.equal(run.interventions.length, 1); assert.equal(run.repairs, 0);
  assert.equal(run.calls.length, 3); assert.equal(run.frozenContract, undefined); assert.equal(f.counts().pmCalls, 0); assert.equal(f.counts().gateCalls, 0);
  assert.equal(run.usage.estimatedCost, null);
});
