import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseJson, parseVerifiedDecision, planSchema, productSchema, researchSchema, testsSchema } from '../server/production/contracts.js';
import { acceptanceCapacityFacts, diagnoseAcceptanceCapacity } from '../server/production/acceptance-diagnostics.js';
import { diagnoseJsonOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION } from '../server/production/output-diagnostics.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Receipt-only checks of one approved attempt. Provider outputs remain inert;
// no SDK, model, browser, candidate code, JSON repair or second launch executes.
const directory = new URL('../docs/production/experiments/HTML-04/', import.meta.url);
const runId = '789f99d1-792f-413e-b509-71da5302eb2f';
const sourceCommit = '19466ab1c75610502ae8ff58a069308781e62151';
const bootId = '107ec4b9-1c3c-4870-b000-754b8e133084';
const fileHashes = {
  'run.json': '48ae00e8bbeb6feeac69fb8820c12ed07463be54d9fb0d991bf8300230cfb86d',
  'evidence.json': 'f7019da587755ffb382f5f9ed8839b4f14301f4d3256d29e47d0e3dc9ba564dd',
  'delivery-manifest.json': 'b317d684c151389842072c51a1cf845ad739b00b738333fc51604f9cadbeb338',
  'platform-metadata.json': '3325f825c0cc33a4a9b3cbc7d71845f44f8b043abebb51935fb731c2f3383960',
  'launch-preflight.json': '4d5377191c95d71f37029a4d64dcbe1744567fc43ce26bbb6c2c644b04bb3fb3',
  'input-snapshot.json': 'e80c122c08d77b518236d8c0d61304ab47a27741cca48e2900084a572bcf3947',
  'authorization.json': 'cd0308a7040508b257c39f27698850c0a8e2caec1e50757f22e538c039da8257',
  'launch-response.json': '16598b18c6646426ab78d0f3b169caded81a7f7f697cb1845f021e0fe4a73702',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const json = (name: keyof typeof fileHashes) => JSON.parse(read(name).toString('utf8'));
const load = (): ProductionRun => json('run.json');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => sha(JSON.stringify(value));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12);
const testerPins = [
  { sha256: '49b39a688d87f9a0e3a6d9a538ae0d73a637a1eb199231d840e9774e3d2d64d1', length: 7084 },
  { sha256: 'e3f9c93757341d47ca1da89de2675fba88699fa67d7c0ef6c0b81820e738d862', length: 10511 },
  { sha256: '7031ce4c1fafa773892a0982e3214e186b1a5476d64284bf2043d236babed64c', length: 10724 },
] as const;
type RecordedChecks = { checks: Array<{ name: string; steps: Array<{ action: string; selector: string; value?: string; text?: string; count?: number }> }> };

test('HTML-04 pins eight receipts and preserves an illustrative failed one-dollar attempt without a deliverable', () => {
  for (const [name, hash] of Object.entries(fileHashes)) assert.equal(sha(read(name as keyof typeof fileHashes)), hash, name);
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.deepEqual(json('evidence.json'), run);
  assert.equal(run.id, runId); assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 64396);
  assert.equal(run.createdAt, '2026-10-08T06:38:38.530Z'); assert.equal(run.finishedAt, '2026-10-08T06:39:43.130Z');
  assert.equal(run.platformCommit, sourceCommit); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.requirement.id, 'HTML-04'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.mode, 'live'); assert.equal(run.input.capability, 'offline-single-html');
  assert.equal(run.input.verifierEngine, 'llm-rubric'); assert.equal(run.input.implementationEvidencePolicy, 'legacy');
  assert.equal(run.input.candidateCount, 1); assert.equal(run.input.budgetAuthorized, true);
  assert.equal(Object.hasOwn(run.input, 'demoCaseId'), false); assert.equal(Object.hasOwn(run.input, 'cameraBusinessConstraints'), false);
  assert.equal(manifest.runId, runId); assert.equal(manifest.status, run.status); assert.equal(manifest.failure, run.error);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.deepEqual(run.interventions, []); assert.deepEqual(run.gateHistory, []);
  assert.equal(Object.hasOwn(run, 'frozenContract'), false); assert.equal(Object.hasOwn(run, 'gate'), false);
  assert.equal(run.calls.some(call => call.role === 'developer'), false);
  assert.match(run.error!, /全局自动返修次数耗尽（2\/2）/); assert.match(run.error!, /保留失败，无模板回退/);
  for (const name of ['index.html', 'index.html.txt', 'scene.json']) assert.equal(existsSync(new URL(name, directory)), false);
});

test('approved input, free preflight, API launch and boot bind the same source without reusing old business outputs', () => {
  const run = load(); const preflight = json('launch-preflight.json'); const auth = json('authorization.json');
  const metadata = json('platform-metadata.json'); const launch = json('launch-response.json');
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-03/run.json', import.meta.url), 'utf8')) as ProductionRun;
  assert.equal(run.input.brief, prior.input.brief); assert.equal(run.input.requirement.acceptance, prior.input.requirement.acceptance);
  assert.deepEqual(run.input.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(json('input-snapshot.json'), run.input);
  assert.deepEqual(preflight.input, { ...run.input, budgetAuthorized: false });
  assert.equal(preflight.ready, true); assert.equal(preflight.paidAuthorized, false); assert.equal(preflight.modelRequests, 0); assert.equal(preflight.finalGate, null);
  const { reportHash, ...body } = preflight; assert.equal(reportHash, '488381b84197d3e66da2e33864a965a2e259e315fceb82e511d94a768fd6ac92'); assert.equal(reportHash, jsonHash(body));
  assert.deepEqual(preflight.issues, []); assert.ok(preflight.warnings.some((warning: { code: string }) => warning.code === 'token-envelope-exceeds-budget'));
  assert.equal(auth.answer, '批准仅这一次，采用1 USD限额'); assert.equal(auth.allowAdditionalExperiment, false);
  assert.equal(auth.preflightReportHash, reportHash); assert.equal(auth.platformCommit, sourceCommit); assert.equal(auth.bootId, bootId); assert.deepEqual(auth.limits, run.input.limits);
  assert.match(auth.launchInterface, /^native-service-api;/); assert.match(auth.launchInterface, /not a UI recording/);
  assert.equal(launch.httpStatus, 202); assert.equal(launch.run.status, 'queued'); assert.equal(launch.run.id, runId); assert.equal(launch.run.calls.length, 0); assert.deepEqual(launch.run.input, run.input);
  assert.deepEqual(metadata.executionIdentity, run.executionIdentity); assert.deepEqual(json('delivery-manifest.json').executionIdentity, run.executionIdentity);
  const identity = run.executionIdentity!; assert.equal(identity.commit, sourceCommit); assert.equal(identity.bootId, bootId);
  assert.equal(identity.sourceClean, true); assert.equal(identity.ready, true); assert.deepEqual(identity.issues, []);
  assert.equal(preflight.execution.fresh, true); assert.equal(preflight.execution.bootId, bootId); assert.equal(preflight.execution.commit, sourceCommit);
  assert.equal(identity.sourceFiles.length, 109); assert.equal(identity.sourceFingerprint, jsonHash(identity.sourceFiles));
  assert.equal(identity.buildFiles.length, 10); assert.equal(identity.buildFingerprint, jsonHash({ buildSnapshot: identity.buildSnapshot, files: identity.buildFiles }));
  assert.deepEqual(metadata.build, { platformCommit: sourceCommit, sourceClean: true, builtAt: '2026-10-08T06:30:53.447Z' });
  assert.deepEqual(preflight.models, run.agentSnapshot); assert.equal(new Set(run.agentSnapshot.map(agent => agent.role)).size, 6);
  assert.ok(run.agentSnapshot.every(agent => agent.provider === 'deepseek' && agent.modelId === 'deepseek-flash' && agent.hasApiKey && agent.enabled && agent.pricing?.inputPerMillion === 0.3 && agent.pricing.outputPerMillion === 1.2 && !Object.hasOwn(agent, 'apiKey')));
});

test('four actual Verifiers distinguish accepted upstream stages from a legal but coverage-rejected tester', () => {
  const run = load(); assert.deepEqual(run.calls.map(call => call.phase), ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design:verify', 'acceptance', 'acceptance:verify', 'acceptance', 'acceptance']);
  for (const [phase, schema] of [['product', productSchema], ['research', researchSchema], ['think-design', planSchema]] as const) {
    const candidate = run.calls.find(call => call.phase === phase)!; const review = run.calls.find(call => call.phase === `${phase}:verify`)!;
    schema.parse(parseJson(candidate.rawOutput)); assert.equal(candidate.selected, true);
    const decision = parseVerifiedDecision(parseJson(review.rawOutput), [candidate.candidateId]); assert.equal(decision.decision, 'accept'); assert.equal(decision.scores[0].score, 4);
  }
  const first = run.calls.filter(call => call.role === 'tester')[0]; const checks = testsSchema.parse(parseJson(first.rawOutput));
  assert.deepEqual(checks.checks.map(check => check.steps.length), [10, 14, 19, 15, 12, 19, 7, 20]);
  assert.equal(first.error, undefined); assert.notEqual(first.selected, true); assert.equal(first.acceptanceDiagnostic, undefined);
  const verifier = run.calls.find(call => call.phase === 'acceptance:verify')!;
  const decision = parseVerifiedDecision(parseJson(verifier.rawOutput), [first.candidateId]);
  assert.equal(decision.decision, 'abstain'); assert.equal(decision.selectedCandidateId, null); assert.equal(decision.scores[0].score, 2);
  const prompt = JSON.parse(verifier.userPrompt); assert.equal(prompt.criteria.acceptance, run.input.requirement.acceptance);
  assert.deepEqual(prompt.state.reviewContext.acceptanceCapacity, acceptanceCapacityFacts()); assert.ok(verifier.systemPrompt.includes('check名称、自评、schema合法或容量声明不构成覆盖证据'));
  assert.equal(run.calls.filter(call => call.role === 'verifier').length, 4);
  const host = run.verifications.filter(review => review.phase === 'acceptance' && review.engine === undefined);
  assert.equal(host.length, 2); assert.ok(host.every(review => review.decision === 'abstain' && review.candidateIds.length === 0 && review.scores.length === 0));
});

test('first regeneration preserves an invalid JSON quote and exact UTF16 syntax feedback without host repair', () => {
  const run = load(); const call = run.calls.filter(item => item.role === 'tester')[1];
  assert.equal(sha(call.rawOutput), testerPins[1].sha256); assert.equal(call.rawOutput.length, testerPins[1].length);
  assert.throws(() => parseJson(call.rawOutput), SyntaxError);
  assert.equal(call.rawOutput.slice(3589, 3606).includes('"count":2"'), true);
  assert.deepEqual(call.outputDiagnostic, diagnoseJsonOutput(call.rawOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION));
  assert.equal(call.outputDiagnostic!.kind, 'json-syntax'); assert.equal(call.outputDiagnostic!.positionUnit, 'utf16-code-unit');
  assert.equal(call.outputDiagnostic!.position, 3604); assert.equal(call.outputDiagnostic!.rawPosition, 3604);
  assert.equal(call.acceptanceDiagnostic, undefined); assert.notEqual(call.selected, true);
  assert.match(call.error!, /JSON at position 3604/);
});

test('last candidate preserves capacity rejection with no remaining call to consume the new diagnostic', () => {
  const run = load(); const call = run.calls.filter(item => item.role === 'tester')[2]; const value = parseJson(call.rawOutput) as RecordedChecks;
  assert.equal(sha(call.rawOutput), testerPins[2].sha256); assert.equal(call.rawOutput.length, testerPins[2].length);
  assert.deepEqual(value.checks.map(check => check.steps.length), [12, 21, 22, 19, 15, 21, 20, 14, 22]);
  const parsed = testsSchema.safeParse(value); assert.equal(parsed.success, false); if (parsed.success) throw new Error('Original failed candidate was accepted');
  assert.deepEqual(parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path, max: issue.code === 'too_big' ? issue.maximum : null })), [1, 2, 5, 8].map(index => ({ code: 'too_big', path: ['checks', index, 'steps'], max: 20 })));
  assert.deepEqual(call.acceptanceDiagnostic, diagnoseAcceptanceCapacity(call.rawOutput));
  assert.deepEqual(call.acceptanceDiagnostic!.oversizedStepCheckIndices, [1, 2, 5, 8]);
  assert.equal(call.acceptanceDiagnostic!.sourceSha256, sha(call.rawOutput)); assert.equal(call.acceptanceDiagnostic!.checkCount, 9);
  assert.equal(run.calls.at(-1)!.id, call.id); assert.equal(run.repairs, 2); assert.notEqual(call.selected, true);
  assert.equal(call.error, `候选契约拒绝：${parsed.error.message}`);
  assert.equal(run.calls.some(next => JSON.stringify(JSON.parse(next.userPrompt).context?.regeneration ?? null).includes('oversizedStepCheckIndices')), false);
});

test('both repairs bind actual rejected candidates and syntax feedback within the shared two-repair budget', () => {
  const run = load(); const calls = run.calls.filter(call => call.role === 'tester');
  assert.equal(run.repairHistory!.length, 2); assert.equal(run.repairPolicyVersion, 'production-global-repair-v1');
  for (const [index, call] of calls.entries()) {
    assert.equal(sha(call.rawOutput), testerPins[index].sha256); assert.equal(call.rawOutput.length, testerPins[index].length);
    const prompt = JSON.parse(call.userPrompt); assert.deepEqual(prompt.input, run.input);
    assert.deepEqual(prompt.context.acceptanceCapacity, acceptanceCapacityFacts()); assert.equal(call.promptVersion, 'production-html-v11');
    assert.equal(prompt.outputContract.jsonSchema.properties.checks.maxItems, 12); assert.equal(prompt.outputContract.jsonSchema.properties.checks.items.properties.steps.maxItems, 20);
    assert.equal(prompt.context.remainingRepairs, 2 - index);
    if (index === 0) { assert.equal(prompt.context.regeneration, undefined); continue; }
    const previous = calls[index - 1]; const repair = run.repairHistory![index - 1]; const rejected = prompt.context.regeneration.rejectedCandidates[0];
    assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.role, 'tester'); assert.equal(repair.frozenHash, null);
    assert.equal(repair.attempt, index); assert.deepEqual(repair.rejectedCandidateIds, [previous.candidateId]);
    assert.equal(rejected.callId, previous.id); assert.equal(rejected.id, previous.candidateId); assert.equal(rejected.rawOutputSha256, sha(previous.rawOutput));
    assert.equal(rejected.rawOutputExcerpt, previous.rawOutput.slice(0, 2000)); assert.equal(rejected.rawOutputTruncated, true);
    assert.deepEqual(rejected.outputDiagnostic, previous.outputDiagnostic); assert.equal(rejected.acceptanceDiagnostic, undefined);
    assert.equal(prompt.context.regeneration.reason, repair.reason);
  }
  assert.match(run.repairHistory![0].reason, /Verifier 弃权/); assert.match(run.repairHistory![1].reason, /JSON at position 3604/);
});

test('candidate names and legal capacities cannot stand in for the original five-negative-by-two-state coverage', () => {
  const run = load(); const first = parseJson(run.calls.filter(call => call.role === 'tester')[0].rawOutput) as RecordedChecks;
  assert.match(run.input.requirement.acceptance, /分别在空列表及已有有效记录的状态下核对/);
  const negative = first.checks[5]; assert.match(negative.name, /两态/);
  assert.deepEqual(negative.steps.filter(step => step.action === 'fill' && step.selector === '#amountInput').map(step => step.value), ['-1', '0', '', '1.234', '10000.00']);
  assert.ok(negative.steps.filter(step => step.action === 'assertCount').every(step => step.count === 0));
  assert.equal(negative.steps.some(step => step.action === 'assertVisible' || step.selector === '#message'), false);
  assert.equal(first.checks[6].steps.some(step => step.action === 'assertVisible' || step.selector === '#message'), false);
  const last = parseJson(run.calls.filter(call => call.role === 'tester')[2].rawOutput) as RecordedChecks;
  const amounts = (index: number) => last.checks[index].steps.filter(step => step.action === 'fill' && step.selector === '#amountInput').map(step => step.value);
  assert.deepEqual(amounts(5), ['-1', '0', '', '1.234']); assert.deepEqual(amounts(6), ['5.55', '10000.00', '-1']);
  assert.deepEqual(['-1', '0', '', '1.234', '10000.00'].filter(value => !amounts(5).includes(value)), ['10000.00']);
  assert.deepEqual(['-1', '0', '', '1.234', '10000.00'].filter(value => !amounts(6).includes(value)), ['0', '', '1.234']);
  assert.equal(run.frozenContract, undefined, 'Static replay does not freeze or repair any historical answer');
});

test('ten observed Harness HTTP attempts have complete measured usage, versions and declared cost, not invoice evidence', () => {
  const run = load(); const before = JSON.stringify(run); const ledger = projectProductionLedger(run); const manifest = json('delivery-manifest.json');
  assert.equal(ledger.requests.callRecords, 10); assert.equal(ledger.requests.budgetRecords, 10); assert.equal(ledger.requests.harnessInvocations, 10);
  assert.equal(ledger.requests.actualProviderRequests, 10); assert.equal(ledger.requests.unknownRequestIntents, 0);
  assert.equal(ledger.requests.simulatedStageRecords, 0); assert.equal(ledger.requests.injectedTestRecords, 0); assert.equal(run.jevCalls?.length ?? 0, 0);
  let input = 0; let output = 0; let cost = 0;
  for (const call of run.calls) {
    assert.equal(call.executionSource, 'harness'); assert.ok(call.finishedAt); assert.equal(call.promptHash, jsonHash({ system: call.systemPrompt, prompt: call.userPrompt }));
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.deniedRequests, 0); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.protocolComplete, true); assert.equal(call.providerRequests!.httpEof, false);
    assert.equal(call.responseFormat!.evidence, 'wire-observed'); assert.equal(call.responseFormat!.mode, 'json-object');
    assert.equal(call.usage.inputTokens, call.providerRequests!.inputTokens); assert.equal(call.usage.outputTokens, call.providerRequests!.outputTokens);
    near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.3 + call.usage.outputTokens! * 1.2) / 1e6);
    input += call.usage.inputTokens!; output += call.usage.outputTokens!; cost += call.usage.estimatedCost!;
  }
  assert.equal(input, 69479); assert.equal(output, 12588); assert.equal(input + output, 82067); near(cost, 0.0359493);
  assert.equal(run.usage.complete, true); assert.equal(run.usage.inputTokens, input); assert.equal(run.usage.outputTokens, output); near(run.usage.estimatedCost!, cost);
  assert.equal(ledger.usage.unknownUsageEntries, 0); assert.equal(ledger.usage.entries, 10);
  assert.deepEqual(manifest.usage, run.usage); assert.equal(manifest.durationMs, run.durationMs);
  assert.equal(manifest.promptVersion, 'production-html-v11'); assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v5');
  assert.deepEqual(manifest.validationContract, run.validationContract); assert.equal(manifest.validationContractHash, jsonHash(run.validationContract));
  assert.equal(run.validationContract!.acceptanceDiagnosticsVersion, 'production-acceptance-diagnostics-v1');
  assert.equal(run.validationContract!.acceptancePlanningVersion, 'production-acceptance-planning-v1');
  assert.equal(JSON.stringify(run), before, 'Read-only receipt verification never rewrites usage or candidates');
});
