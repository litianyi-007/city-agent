import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseJson, parseVerifiedDecision, planSchema, productSchema, researchSchema } from '../server/production/contracts.js';
import { diagnoseJsonOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION } from '../server/production/output-diagnostics.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import { PRODUCTION_ROLES, type ProductionRun } from '../shared/production-schema.js';
import { assertNoPublishedSecrets } from '../scripts/production-public-safety.js';

// Immutable receipt verification only: no network, SDK, browser, generated code,
// provider configuration, JSON repair, migration, task launch or paid retry.
const directory = new URL('../docs/production/experiments/HTML-05/', import.meta.url);
const runId = '9a56085f-8a2e-474d-97fd-82f82aaac795';
const sourceCommit = '8928f9aac7a5d6a59615467c851d7e8a7e94c54f';
const bootId = '5eb125c3-87ff-4c8d-aa13-41eac83a74c0';
const bytes = (name: string) => readFileSync(new URL(name, directory));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const load = (): ProductionRun => json('run.json');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => sha(JSON.stringify(value));
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12);
const pmPins = [
  ['a70a9e7553580e119ff7e5116d5865e38ddaf69ebe28b572831a34ffd6d852c1', 2684],
  ['383ea04cc409579416767304e270c041d473fc0f2202a1066b8781fbd944720b', 2831],
  ['5f3347aa43571dd2859ecf358fc082f31bf34adfcfd32bde8cff32ffaa5f8235', 2853],
] as const;

test('HTML05 pins all fifteen public receipts and keeps downloaded bytes distinct from normalized API snapshots', () => {
  assert.equal(sha(bytes('receipt-files.json')), 'b5888db60eaf58f6548b80b1900e4a12e93b1643b81a5fb3ca8f6cd32ea4b5c7');
  const index = json('receipt-files.json');
  assert.equal(index.runId, runId); assert.equal(index.sourceCommit, sourceCommit);
  assert.equal(index.files.length, 15); assert.equal(new Set(index.files.map((f: { name: string }) => f.name)).size, 15);
  for (const file of index.files) {
    const value = bytes(file.name); assert.equal(value.length, file.bytes); assert.equal(sha(value), file.sha256, file.name);
    if (!file.name.endsWith('.png')) assertNoPublishedSecrets(value, file.name);
  }
  assert.equal(index.files.find((f: { name: string }) => f.name === 'evidence.json').origin, 'exact-downloaded-artifact-bytes');
  assert.equal(index.files.find((f: { name: string }) => f.name === 'run.json').origin, 'normalized-api-snapshot');
  assert.deepEqual(json('evidence.json'), load());
  assert.deepEqual(Buffer.concat([bytes('evidence.json'), Buffer.from('\n')]), bytes('run.json'));
  assert.equal(existsSync(new URL('browser-profile/', directory)), false);
});

test('sole actual frontend submission binds the approved eight requirements, source, preflight and boot without a second attempt', () => {
  const run = load(); const receipt = json('ui-receipt.json'); const intent = json('launch-intent.json');
  const auth = json('authorization.json'); const preflight = json('launch-preflight.json');
  const metadata = json('platform-metadata.json'); const launch = json('launch-response.json');
  const proposal = JSON.parse(readFileSync(new URL('../docs/production/proposals/HTML-05/input-proposal.json', import.meta.url), 'utf8'));
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-04/run.json', import.meta.url), 'utf8'));
  assert.equal(run.input.brief, prior.input.brief); assert.equal(run.input.requirement.acceptance, prior.input.requirement.acceptance);
  assert.equal(proposal.budgetAuthorized, false); assert.equal(run.input.budgetAuthorized, true);
  assert.deepEqual(run.input.agentIds, proposal.agentIds); assert.deepEqual(run.input.limits, proposal.limits);
  assert.deepEqual(run.input.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  for (const file of ['input-snapshot.json', 'actual-browser-submit.json']) assert.deepEqual(json(file), run.input);
  assert.equal(auth.userReply, '推进下一步'); assert.match(auth.scope, /Exactly one new HTML-05 actual frontend submission/);
  assert.match(auth.scope, /no automatic retry, rerun or additional experiment/); assert.deepEqual(auth.limits, run.input.limits);
  assert.equal(intent.sourceCommit, sourceCommit); assert.equal(intent.bootId, bootId);
  assert.equal(intent.expectedInputSha256, jsonHash(run.input)); assert.ok(Date.parse(intent.at) < Date.parse(run.createdAt));
  assert.equal(intent.automaticRetryAllowed, false);
  assert.deepEqual(preflight.input, { ...run.input, budgetAuthorized: false });
  assert.equal(preflight.ready, true); assert.equal(preflight.modelRequests, 0); assert.equal(preflight.paidAuthorized, false); assert.equal(preflight.finalGate, null);
  const { reportHash, ...body } = preflight; assert.equal(reportHash, jsonHash(body));
  assert.equal(reportHash, intent.preflightHash); assert.equal(reportHash, receipt.preflightHash);
  assert.equal(preflight.budget.baseCalls, 16); assert.equal(preflight.budget.worstCaseCalls, 28);
  assert.equal(launch.id, runId); assert.deepEqual(launch.input, run.input); assert.equal(launch.status, 'queued'); assert.equal(launch.calls.length, 0);
  assert.equal(receipt.startedThroughActualFrontend, true); assert.equal(receipt.noFulfillmentStubs, true);
  assert.equal(receipt.httpSubmitCount, 1); assert.equal(receipt.observedStartResponses, 1);
  assert.equal(receipt.beforeRunCount, 20); assert.equal(receipt.afterRunCount, 21); assert.equal(receipt.automaticAdditionalRun, false);
  assert.equal(receipt.runId, runId); assert.equal(receipt.terminalStatus, 'failed'); assert.equal(receipt.blockedBrowserExternalRequests, 0);
  assert.deepEqual(metadata.executionIdentity, run.executionIdentity);
  assert.equal(run.executionIdentity!.commit, sourceCommit); assert.equal(run.executionIdentity!.bootId, bootId);
  assert.equal(run.executionIdentity!.ready, true); assert.equal(run.executionIdentity!.sourceClean, true); assert.deepEqual(run.executionIdentity!.issues, []);
  assert.equal(run.executionIdentity!.sourceFiles.length, 110); assert.equal(run.executionIdentity!.sourceFingerprint, jsonHash(run.executionIdentity!.sourceFiles));
  assert.equal(run.executionIdentity!.buildFiles.length, 10); assert.equal(run.executionIdentity!.buildFingerprint, jsonHash({ buildSnapshot: run.executionIdentity!.buildSnapshot, files: run.executionIdentity!.buildFiles }));
  assert.deepEqual(run.agentSnapshot, json('public-agent-configuration.json')); assert.deepEqual(run.agentSnapshot.map(a => a.role), [...PRODUCTION_ROLES]);
  assert.ok(run.agentSnapshot.every(a => a.enabled && a.hasApiKey && a.modelId === 'deepseek-flash' && a.provider === 'deepseek' && !Object.hasOwn(a, 'apiKey')));
});

test('two real upstream Verifiers do not make the three host-empty-pool rejections or business stages successful', () => {
  const run = load();
  assert.deepEqual(run.calls.map(c => c.phase), ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design', 'think-design']);
  assert.equal(run.calls.filter(c => c.role === 'verifier').length, 2);
  for (const [phase, schema] of [['product', productSchema], ['research', researchSchema]] as const) {
    const call = run.calls.find(c => c.phase === phase)!;
    schema.parse(parseJson(call.rawOutput)); assert.equal(call.selected, true);
    const review = run.calls.find(c => c.phase === phase + ':verify')!;
    const decision = parseVerifiedDecision(parseJson(review.rawOutput), [call.candidateId]);
    assert.equal(decision.decision, 'accept'); assert.equal(decision.scores[0].score, 5);
  }
  const hosts = run.verifications.filter(v => v.phase === 'think-design');
  assert.equal(hosts.length, 3); assert.ok(hosts.every(v => v.engine === undefined && v.decision === 'abstain' && v.candidateIds.length === 0 && v.scores.length === 0));
  assert.deepEqual(run.outputs.map(o => o.phase), ['product', 'research']);
  assert.equal(run.input.acceptanceStrategy, 'planned-groups-v1');
  assert.equal(run.input.verifierEngine, 'llm-rubric'); assert.equal(run.input.candidateCount, 1);
  assert.equal(run.input.implementationEvidencePolicy, 'legacy');
  assert.ok(run.calls.every(c => c.promptVersion === 'production-html-grouped-v1'));
  assert.equal(run.validationContract!.outputDiagnosticsVersion, LEGACY_OUTPUT_DIAGNOSTICS_VERSION);
  assert.equal(run.validationContract!.acceptancePlanVersion, 'production-acceptance-plan-v1');
});

test('strict PM schema rejects both exact extra keys and the original trailing JSON without silently removing fields', () => {
  const calls = load().calls.filter(c => c.role === 'project-manager');
  for (const [i, call] of calls.entries()) {
    assert.equal(sha(call.rawOutput), pmPins[i][0]); assert.equal(call.rawOutput.length, pmPins[i][1]);
    assert.notEqual(call.selected, true);
    const schema = JSON.parse(call.userPrompt).outputContract.jsonSchema;
    assert.deepEqual(Object.keys(schema.properties), ['decision', 'summary', 'tasks', 'risks']);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['decision', 'summary', 'tasks', 'risks']);
  }
  for (const [i, key] of ['decision_rationale_note', 'decision_note'].entries()) {
    const parsed = planSchema.safeParse(parseJson(calls[i].rawOutput)); assert.equal(parsed.success, false);
    if (parsed.success) throw new Error('Original extra property was accepted');
    assert.deepEqual(parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path, keys: issue.code === 'unrecognized_keys' ? issue.keys : null })), [{ code: 'unrecognized_keys', path: [], keys: [key] }]);
    assert.equal(calls[i].outputDiagnostic, undefined);
  }
  const last = calls[2]; assert.throws(() => parseJson(last.rawOutput), SyntaxError);
  assert.match(last.error!, /after JSON at position 505/);
  assert.deepEqual(last.outputDiagnostic, diagnoseJsonOutput(last.rawOutput, LEGACY_OUTPUT_DIAGNOSTICS_VERSION));
  assert.equal(last.outputDiagnostic!.position, null); assert.equal(last.outputDiagnostic!.rawPosition, null);
  assert.equal(last.outputDiagnostic!.excerpt.start, 2533); assert.equal(last.outputDiagnostic!.excerpt.end, 2853);
});

test('each of the two global repairs carries the bound previous failure and never grants an additional paid attempt', () => {
  const run = load(); const calls = run.calls.filter(c => c.role === 'project-manager');
  assert.equal(run.repairs, 2); assert.equal(run.repairHistory!.length, 2); assert.equal(run.repairPolicyVersion, 'production-global-repair-v1');
  for (let i = 1; i < calls.length; i++) {
    const previous = calls[i - 1]; const repair = run.repairHistory![i - 1];
    const context = JSON.parse(calls[i].userPrompt).context;
    const rejected = context.regeneration.rejectedCandidates[0];
    assert.equal(repair.attempt, i); assert.equal(repair.role, 'project-manager'); assert.equal(repair.phase, 'think-design');
    assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.frozenHash, null);
    assert.deepEqual(repair.rejectedCandidateIds, [previous.candidateId]); assert.equal(context.remainingRepairs, 2 - i);
    assert.equal(context.regeneration.reason, repair.reason); assert.equal(rejected.callId, previous.id); assert.equal(rejected.id, previous.candidateId);
    assert.equal(rejected.rawOutputSha256, sha(previous.rawOutput)); assert.equal(rejected.rawOutputExcerpt, previous.rawOutput.slice(0, 2000));
    assert.equal(rejected.rawOutputTruncated, true); assert.equal(rejected.error, previous.error);
  }
  assert.match(run.error!, /全局自动返修次数耗尽（2\/2）/); assert.match(run.error!, /保留失败，无模板回退/);
  assert.deepEqual(run.interventions, []);
});

test('all seven observed requests have known measured tokens and declared cost, not supplier invoice or ROI evidence', () => {
  const run = load(); const ledger = projectProductionLedger(run); const manifest = json('delivery-manifest.json');
  assert.equal(ledger.requests.callRecords, 7); assert.equal(ledger.requests.harnessInvocations, 7); assert.equal(ledger.requests.actualProviderRequests, 7);
  assert.equal(ledger.requests.unknownRequestIntents, 0); assert.equal(ledger.requests.injectedTestRecords, 0); assert.equal(ledger.requests.simulatedStageRecords, 0);
  assert.equal(run.jevCalls?.length ?? 0, 0);
  let input = 0; let output = 0; let cost = 0;
  for (const call of run.calls) {
    assert.equal(call.executionSource, 'harness'); assert.ok(call.finishedAt);
    assert.equal(call.promptHash, jsonHash({ system: call.systemPrompt, prompt: call.userPrompt }));
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.deniedRequests, 0); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.protocolComplete, true); assert.equal(call.providerRequests!.httpEof, false);
    assert.equal(call.responseFormat!.mode, 'json-object'); assert.equal(call.responseFormat!.evidence, 'wire-observed');
    assert.equal(call.usage.inputTokens, call.providerRequests!.inputTokens); assert.equal(call.usage.outputTokens, call.providerRequests!.outputTokens);
    input += call.usage.inputTokens!; output += call.usage.outputTokens!;
    near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.3 + call.usage.outputTokens! * 1.2) / 1e6);
    cost += call.usage.estimatedCost!;
  }
  assert.equal(input, 42130); assert.equal(output, 7806); assert.equal(input + output, 49936); near(cost, 0.0220062);
  assert.deepEqual(run.usage, { inputTokens: input, outputTokens: output, estimatedCost: cost, currency: 'USD', complete: true });
  assert.equal(ledger.usage.unknownUsageEntries, 0); assert.equal(ledger.usage.entries, 7);
  assert.deepEqual(manifest.usage, run.usage); assert.equal(manifest.durationMs, 52563);
});

test('terminal manifest and evidence preserve a failed no-delivery result with no planned group, frozen contract or Gate', () => {
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.equal(run.id, runId); assert.equal(run.status, 'failed'); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.createdAt, '2026-10-08T08:48:29.211Z'); assert.equal(run.finishedAt, '2026-10-08T08:49:21.992Z'); assert.equal(run.durationMs, 52563);
  assert.equal(run.acceptanceConstruction, undefined); assert.equal(run.frozenContract, undefined); assert.equal(run.gate, undefined); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.calls.some(c => ['tester', 'developer'].includes(c.role) || c.phase === 'acceptance-plan'), false);
  assert.deepEqual(run.artifacts.map(a => a.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, runId); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.acceptanceConstruction, null);
  assert.deepEqual(manifest.executionIdentity, run.executionIdentity); assert.deepEqual(manifest.models, run.agentSnapshot);
  assert.equal(manifest.validationContractHash, jsonHash(run.validationContract)); assert.deepEqual(manifest.validationContract, run.validationContract);
  for (const name of ['index.html', 'index.html.txt', 'scene.json', 'acceptance-plan.json', 'gate.json']) assert.equal(existsSync(new URL(name, directory)), false);
});
