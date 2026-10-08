import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseJson, parseVerifiedDecision, planSchema, productSchema, researchSchema, testsSchema } from '../server/production/contracts.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';
import type { ProductionLaunchPreflightReport } from '../shared/production-launch-preflight.js';

// Receipt-only regression. Original provider responses are inert JSON data;
// no SDK, transport, browser, generated candidate or repair executes here.
const directory = new URL('../docs/production/experiments/HTML-03/', import.meta.url);
const runId = '271a1ada-37ed-4b28-b5ab-b7cbdc910e97';
const sourceCommit = '2c69fcb721aa84f6a065b9441494834dbf4192fb';
const fileHashes = {
  'run.json': '6d655a48107a0f0837c4f38809c391f61f8e43c09817d154a0f4b97795f507dc',
  'evidence.json': 'ab388d64af1f8018a263f57a67473385aa7da6549c6cb284a5aab6d4a882614c',
  'delivery-manifest.json': 'f5dd37ade31acfea6165b2705b03e132bf92743ae8e64ce10f366bc2394a8c14',
  'launch-preflight.json': '5ceecc7191a4a8b9082d2b99195fd67ee1552be3b55384b762b0aa85db8807e0',
  'platform-metadata.json': 'e6c32011452e576575a4a1da07305a5c6144b247a3a2bb15b0ddc444820682e7',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const json = (name: keyof typeof fileHashes) => JSON.parse(read(name).toString('utf8'));
const load = (): ProductionRun => json('run.json');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => sha(JSON.stringify(value));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
const testerPins = [
  { sha256: 'c4d31c61c23a9fdb234f1a8b7d1679bc1658ec50f582aeefdde8e4ac67a0ba8b', steps: [14, 20, 21, 17, 14, 21, 19, 19, 21], bad: [2, 5, 8], rawLength: 11319 },
  { sha256: 'e0b00b69586a5170978745c8b31297169acef7d38a1e563b19310cba4ab5ac87', steps: [17, 20, 21, 18, 21, 21, 20, 18, 23, 23], bad: [2, 4, 5, 8, 9], rawLength: 13907 },
  { sha256: 'de7f589400cb51518d0dc758c0021edc5116cac2780f13cdc4a03a768b3cad01', steps: [17, 20, 20, 17, 15, 24, 19, 19, 22], bad: [5, 8], rawLength: 11159 },
] as const;
type RecordedChecks = { checks: Array<{ name: string; steps: Array<{ action: string; selector: string; value?: string }> }> };

test('HTML-03 pins all five original receipts and the independent illustrative one-dollar failed attempt', () => {
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(sha(read(name as keyof typeof fileHashes)), expected, name);
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.deepEqual(json('evidence.json'), run);
  assert.equal(run.id, runId); assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 64951);
  assert.equal(run.platformCommit, sourceCommit); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.mode, 'live'); assert.equal(run.input.capability, 'offline-single-html'); assert.equal(run.input.verifierEngine, 'llm-rubric');
  assert.equal(run.input.implementationEvidencePolicy, 'legacy'); assert.equal(run.input.requirement.id, 'HTML-03'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.candidateCount, 1); assert.equal(run.input.budgetAuthorized, true);
  assert.equal(Object.hasOwn(run.input, 'demoCaseId'), false); assert.equal(Object.hasOwn(run.input, 'cameraBusinessConstraints'), false);
  assert.deepEqual(run.input.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(run.interventions, []);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, sourceCommit); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error);
  assert.match(run.error!, /全局自动返修次数耗尽（2\/2）/); assert.match(run.error!, /保留失败，无模板回退/);
});

test('boot/source/build identities and the zero-request, unauthorised preflight remain separate from paid execution and final Gate', () => {
  const run = load(); const metadata = json('platform-metadata.json'); const manifest = json('delivery-manifest.json');
  const preflight = json('launch-preflight.json') as ProductionLaunchPreflightReport; const identity = run.executionIdentity!;
  assert.deepEqual(metadata.executionIdentity, identity); assert.deepEqual(manifest.executionIdentity, identity);
  assert.equal(identity.version, 'production-boot-disk-v1'); assert.equal(identity.bootId, 'f29bf2e6-e86a-4969-941c-b9f8e982da5a');
  assert.equal(identity.commit, sourceCommit); assert.equal(identity.sourceClean, true); assert.equal(identity.ready, true); assert.deepEqual(identity.issues, []);
  assert.equal(identity.startedAt, '2026-10-08T04:45:10.186Z');
  assert.deepEqual(identity.buildSnapshot, { platformCommit: sourceCommit, sourceClean: true, builtAt: '2026-10-08T04:44:45.768Z' });
  assert.deepEqual(metadata.build, identity.buildSnapshot); assert.equal(metadata.platformCommit, sourceCommit);
  assert.ok(Date.parse(identity.buildSnapshot!.builtAt) < Date.parse(identity.startedAt)); assert.ok(Date.parse(identity.startedAt) < Date.parse(run.createdAt));
  assert.equal(identity.sourceFiles.length, 108); assert.equal(identity.buildFiles.length, 10);
  assert.equal(identity.sourceFingerprint, '2fc08e7e134f1fc1f6f7226ee6a7d2f2a545ed0b52c7e3eecf9cb099c0b22935');
  assert.equal(identity.sourceFingerprint, jsonHash(identity.sourceFiles));
  assert.equal(identity.buildFingerprint, '2e3d8c0fb99ae8ba87fa915f0ae43734acd94d9f1cbbb1e25da382170ed663f8');
  assert.equal(identity.buildFingerprint, jsonHash({ buildSnapshot: identity.buildSnapshot, files: identity.buildFiles }));
  assert.equal(preflight.version, 'production-launch-preflight-v1'); assert.equal(preflight.ready, true);
  assert.equal(preflight.paidAuthorized, false); assert.equal(preflight.modelRequests, 0); assert.equal(preflight.finalGate, null);
  assert.equal(Object.hasOwn(preflight, 'usage'), false, 'Positive reservation estimates are not preflight billing or model usage');
  assert.deepEqual(preflight.input, { ...run.input, budgetAuthorized: false }); assert.deepEqual(preflight.models, run.agentSnapshot);
  assert.deepEqual(preflight.execution, { bootId: identity.bootId, startedAt: identity.startedAt, commit: sourceCommit, sourceClean: true, sourceFingerprint: identity.sourceFingerprint, buildFingerprint: identity.buildFingerprint, buildSnapshot: identity.buildSnapshot, ready: true, fresh: true });
  const { reportHash, ...body } = preflight;
  assert.equal(reportHash, 'fbab32afd35595c707748335719a3375199d3e804aa1eb47d4b15e7c49d68712'); assert.equal(reportHash, jsonHash(body));
  assert.deepEqual(preflight.issues, []); assert.ok(preflight.warnings.some(warning => warning.code === 'acceptance-not-frozen')); assert.ok(preflight.warnings.some(warning => warning.code === 'token-envelope-exceeds-budget'));
  assert.equal(preflight.budget.baseCalls, 12); assert.equal(preflight.budget.worstCaseCalls, 24); assert.equal(preflight.budget.firstRequest.totalTokens, 71536);
  near(preflight.budget.firstRequest.estimatedCost!, 0.0268608); near(preflight.budget.envelope.worstCaseEstimatedCost!, 0.6446592);
  assert.deepEqual(manifest.validationContract, run.validationContract); assert.equal(manifest.validationContractHash, jsonHash(run.validationContract));
  assert.equal(manifest.promptVersion, 'production-html-v10'); assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v5'); assert.equal(manifest.jevPolicyVersion, 'jev-candidate-v4');
});

test('three original Tester responses are valid JSON but fail only the unchanged twenty-step schema limit', () => {
  const run = load(); const before = JSON.stringify(run); const candidates = run.calls.filter(call => call.role === 'tester');
  assert.equal(candidates.length, 3);
  for (const [index, call] of candidates.entries()) {
    const pin = testerPins[index]; const value = parseJson(call.rawOutput) as RecordedChecks;
    assert.equal(sha(call.rawOutput), pin.sha256); assert.equal(call.rawOutput.length, pin.rawLength);
    assert.deepEqual(JSON.parse(call.rawOutput), value); assert.deepEqual(value.checks.map(check => check.steps.length), [...pin.steps]);
    assert.ok(value.checks.length >= 2 && value.checks.length <= 12); assert.notEqual(call.selected, true);
    const result = testsSchema.safeParse(value); assert.equal(result.success, false);
    if (result.success) throw new Error('Original failed Tester response unexpectedly accepted');
    assert.deepEqual(result.error.issues.map(issue => ({ code: issue.code, path: issue.path, maximum: issue.code === 'too_big' ? issue.maximum : null })), pin.bad.map(check => ({ code: 'too_big', path: ['checks', check, 'steps'], maximum: 20 })));
    assert.equal(call.error, `候选契约拒绝：${result.error.message}`); assert.equal(Object.hasOwn(call, 'outputDiagnostic'), false);
    const prompt = JSON.parse(call.userPrompt); const contract = prompt.outputContract;
    assert.deepEqual(prompt.input, run.input); assert.equal(contract.version, 'production-output-contract-v1');
    assert.equal(contract.jsonSchema.properties.checks.maxItems, 12); assert.equal(contract.jsonSchema.properties.checks.items.properties.steps.maxItems, 20); assert.equal(contract.jsonSchema.additionalProperties, false);
    assert.equal(call.promptVersion, 'production-html-v10'); assert.ok(call.systemPrompt.includes('每项1–20步'));
    assert.deepEqual(call.responseFormat, { version: 'harness-json-output-v1', mode: 'json-object', evidence: 'wire-observed' });
    for (const bad of pin.bad) {
      assert.ok(call.rawOutput.indexOf(value.checks[bad]!.name) >= 2000);
      assert.equal(call.rawOutput.slice(0, 2000).includes(value.checks[bad]!.name), false, 'Feedback prefix contains none of the failed check bodies');
    }
  }
  assert.equal(JSON.stringify(run), before, 'Static diagnosis never clips steps or creates an accepted candidate');
});

test('two regenerations retain complete original errors, source hashes and explicit truncated excerpts in the shared repair pool', () => {
  const run = load(); const candidates = run.calls.filter(call => call.role === 'tester');
  assert.equal(run.repairs, 2); assert.equal(run.repairPolicyVersion, 'production-global-repair-v1'); assert.equal(run.repairHistory!.length, 2);
  for (const [index, repair] of run.repairHistory!.entries()) {
    assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.role, 'tester'); assert.equal(repair.phase, 'acceptance'); assert.equal(repair.attempt, index + 1); assert.equal(repair.frozenHash, null);
    assert.deepEqual(repair.rejectedCandidateIds, [candidates[index]!.candidateId]);
  }
  for (const [index, call] of candidates.entries()) {
    const context = JSON.parse(call.userPrompt).context;
    assert.equal(context.remainingRepairs, 2 - index); assert.deepEqual(context.repairBudget, { policyVersion: 'production-global-repair-v1', used: index, remaining: 2 - index, limit: 2 });
    if (index === 0) { assert.equal(context.regeneration, undefined); continue; }
    const previous = candidates[index - 1]!; const feedback = context.regeneration; const rejected = feedback.rejectedCandidates[0];
    assert.equal(feedback.attempt, index); assert.equal(feedback.frozenHash, null); assert.equal(feedback.reason, run.repairHistory![index - 1]!.reason);
    assert.deepEqual(feedback.rejectedCandidateIds, [previous.candidateId]); assert.equal(feedback.rejectedCandidates.length, 1);
    assert.equal(rejected.id, previous.candidateId); assert.equal(rejected.callId, previous.id); assert.equal(rejected.error, previous.error);
    assert.equal(rejected.error.length, index === 1 ? 660 : 1094); assert.equal(rejected.rawOutputSha256, sha(previous.rawOutput));
    assert.equal(rejected.rawOutputExcerpt, previous.rawOutput.slice(0, 2000)); assert.equal(rejected.rawOutputExcerpt.length, 2000); assert.equal(rejected.rawOutputTruncated, true);
    assert.equal(feedback.reason.length, index === 1 ? 690 : 1030);
  }
  assert.equal(run.events.filter(event => event.phase === 'stage-regeneration').length, 2);
  assert.equal(run.events.filter(event => event.phase === 'failed').length, 1);
});

test('only product/research/planning receive three real Verifier calls; acceptance abstentions are host structural records with no freeze or delivery source', () => {
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.deepEqual(run.calls.map(call => call.phase), ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design:verify', 'acceptance', 'acceptance', 'acceptance']);
  assert.deepEqual(run.outputs.map(output => output.phase), ['product', 'research', 'think-design']);
  for (const [phase, schema] of [['product', productSchema], ['research', researchSchema], ['think-design', planSchema]] as const) {
    const candidate = run.calls.find(call => call.phase === phase)!; const verifier = run.calls.find(call => call.phase === `${phase}:verify`)!;
    schema.parse(parseJson(candidate.rawOutput)); assert.equal(candidate.selected, true);
    assert.equal(parseVerifiedDecision(parseJson(verifier.rawOutput), [candidate.candidateId]).decision, 'accept'); assert.equal(verifier.role, 'verifier'); assert.equal(verifier.verificationEngine, 'llm-rubric');
  }
  assert.equal(run.calls.filter(call => call.role === 'verifier').length, 3); assert.equal(run.calls.some(call => call.phase === 'acceptance:verify'), false);
  const rejected = run.verifications.filter(review => review.phase === 'acceptance'); assert.equal(rejected.length, 3);
  for (const review of rejected) { assert.deepEqual(review.candidateIds, []); assert.equal(review.selectedCandidateId, null); assert.equal(review.decision, 'abstain'); assert.deepEqual(review.scores, []); assert.equal(review.engine, undefined); }
  assert.equal(run.jevCalls?.length ?? 0, 0); assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.equal(Object.hasOwn(run, 'frozenContract'), false); assert.equal(Object.hasOwn(run, 'gate'), false); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.events.some(event => ['freeze', 'test', 'delivery'].includes(event.phase)), false);
  assert.equal(Object.hasOwn(manifest, 'frozenContract'), false); assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  for (const name of ['index.html', 'index.html.txt', 'scene.json']) assert.equal(existsSync(new URL(name, directory)), false);
});

test('static invalid-amount fill coverage remains incomplete in existing-record checks, not an executed Gate or new success', () => {
  const run = load(); assert.match(run.input.requirement.acceptance, /分别在空列表及已有有效记录的状态下核对/);
  const candidates = run.calls.filter(call => call.role === 'tester');
  const expected = [['10.10', '-1', '10000.00'], ['5.55', '10000.00', ''], ['5.55', '0', '10000.00']];
  const missing = [['0', '', '1.234'], ['-1', '0', '1.234'], ['-1', '', '1.234']];
  for (const [index, call] of candidates.entries()) {
    const value = JSON.parse(call.rawOutput) as RecordedChecks; const existing = value.checks[6]!;
    assert.match(existing.name, /已有有效记录/);
    const amounts = existing.steps.filter(step => step.action === 'fill' && step.selector === '#amount-input').map(step => step.value);
    assert.deepEqual(amounts, expected[index]); assert.deepEqual(['-1', '0', '', '1.234', '10000.00'].filter(amount => !amounts.includes(amount)), missing[index]);
    assert.equal(testsSchema.safeParse(value).success, false); assert.equal(sha(call.rawOutput), testerPins[index].sha256);
  }
});

test('receipt accounting contains nine tracked HTTP attempts with complete measured usage and no preflight fee entry or hidden acceptance evaluator', () => {
  const run = load(); const before = JSON.stringify(run); const ledger = projectProductionLedger(run);
  assert.deepEqual(run.usage, { inputTokens: 57698, outputTokens: 14718, estimatedCost: 0.034971, currency: 'USD', complete: true });
  assert.equal(ledger.requests.callRecords, 9); assert.equal(ledger.requests.budgetRecords, 9); assert.equal(ledger.requests.harnessInvocations, 9);
  assert.equal(ledger.requests.knownHarnessProviderRequests, 9); assert.equal(ledger.requests.jevProviderRequests, 0); assert.equal(ledger.requests.actualProviderRequests, 9); assert.equal(ledger.requests.unknownRequestIntents, 0);
  assert.equal(ledger.usage.entries, 9); assert.equal(ledger.usage.unknownUsageEntries, 0);
  assert.deepEqual(ledger.usage.inputTokens, { knownSubtotal: 57698, reportedEntries: 9, unknownEntries: 0, overflow: false });
  assert.deepEqual(ledger.usage.outputTokens, { knownSubtotal: 14718, reportedEntries: 9, unknownEntries: 0, overflow: false }); near(ledger.usage.estimatedCost.knownSubtotal!, 0.034971);
  for (const call of run.calls) {
    assert.equal(call.executionSource, 'harness'); assert.equal(call.model.modelId, 'deepseek-flash');
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.deniedRequests, 0); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true);
    assert.deepEqual(call.providerRequests!.responseFormat, call.responseFormat); near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.30 + call.usage.outputTokens! * 1.20) / 1e6);
  }
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.inputTokens!, 0), 57698); assert.equal(run.calls.reduce((sum, call) => sum + call.usage.outputTokens!, 0), 14718);
  near(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0), 0.034971); assert.deepEqual(json('delivery-manifest.json').usage, run.usage);
  assert.equal(JSON.stringify(run), before);
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(sha(read(name as keyof typeof fileHashes)), expected, `${name}: unchanged after analysis`);
});
