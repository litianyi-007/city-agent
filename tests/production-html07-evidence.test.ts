import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionRequestCounts, productionUsageLedger } from '../shared/production-ledger.js';
import { parseJson, planSchema, outputContractSnapshot } from '../server/production/contracts.js';
import { diagnoseJsonOutput } from '../server/production/output-diagnostics.js';
import { diagnoseRoleSchema, pmOutputPolicy } from '../server/production/role-output-policy.js';

const base = new URL('../docs/production/experiments/HTML-07/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, base));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const id = '18b50d49-4cc2-4f63-bcc7-94da50802d91';
const commit = 'c981490cd94bcb753f6b66291ee4319b092f62f8';
const boot = '49679553-a24b-4c68-bcca-24eb9131dcd2';

test('HTML07 immutable byte index covers 18 public receipts, not private profile or a generated product', () => {
  assert.equal(sha(bytes('receipt-files.json')), '8a1a5390bf0f7975ba098edbe5ad5050182bea7c4365e420a3dc496dd2fcf198');
  const index = json('receipt-files.json');
  assert.equal(index.runId, id); assert.equal(index.sourceCommit, commit);
  assert.equal(index.byteEqualityIsNotIndependentAuthenticityProof, true);
  assert.equal(index.files.length, 18); assert.equal(new Set(index.files.map((f: { name: string }) => f.name)).size, 18);
  for (const f of index.files) { assert.equal(bytes(f.name).length, f.bytes); assert.equal(sha(bytes(f.name)), f.sha256); assert.doesNotMatch(f.name, /profile|state\.json|key|\.html$/); }
  for (const name of ['evidence.json', 'delivery-manifest.json']) assert.equal(index.files.find((f: { name: string }) => f.name === name).origin, 'exact-downloaded-artifact-bytes');
  assert.equal(sha(bytes('evidence.json')), '0992bdb9bd31a7a740eeb00df02cd141c9dd20b1e35951d15923eb874a9f4731');
  assert.deepEqual(json('evidence.json'), json('run.json'));
  assert.deepEqual(bytes('run.json'), Buffer.concat([bytes('evidence.json'), Buffer.from('\n')]));
});

test('HTML07 binds explicit new single-run consent, same eight requirements and fresh startup guard', () => {
  const input = json('input-snapshot.json'); const actual = json('actual-browser-submit.json'); const authorization = json('authorization.json');
  const run = json('run.json'); const intent = json('launch-intent.json'); const receipt = json('ui-receipt.json'); const checked = json('authorization-checked.json'); const report = json('launch-preflight.json');
  assert.deepEqual(input, actual); assert.deepEqual(actual, run.input);
  assert.equal(authorization.userReply, '批准仅这一次，采用1 USD限额');
  assert.equal(authorization.referencedProposalCommit, commit); assert.equal(authorization.proposalSha256, sha(bytes('PRE-REGISTRATION.md')));
  assert.equal(checked.approvalSha256, sha(bytes('authorization.json'))); assert.equal(checked.boundedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(intent.expectedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(authorization.singleRunOnly, true); assert.equal(authorization.automaticRetryAllowed, false); assert.equal(authorization.jevRequestsAllowed, false);
  assert.equal(intent.automaticRetryAllowed, false); assert.equal(receipt.automaticAdditionalRun, false);
  assert.deepEqual(actual.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(actual.limits, authorization.limits); assert.equal(actual.budgetAuthorized, true);
  assert.equal(actual.requirement.kind, 'illustrative'); assert.equal(actual.requirement.id, 'HTML-07');
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-06/input-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(actual.brief, prior.brief); assert.equal(actual.requirement.acceptance, prior.requirement.acceptance); assert.deepEqual(actual.agentIds, prior.agentIds);
  assert.equal((actual.requirement.acceptance.match(/^\d\./gm) ?? []).length, 8);
  assert.equal(actual.candidateCount, 1); assert.equal(actual.verifierEngine, 'llm-rubric'); assert.equal(actual.implementationEvidencePolicy, 'legacy');
  assert.equal(actual.acceptanceStrategy, 'planned-groups-v1');
  assert.deepEqual(report.input, { ...actual, budgetAuthorized: false });
  assert.equal(report.ready, true); assert.equal(report.modelRequests, 0); assert.equal(report.paidAuthorized, false); assert.equal(report.finalGate, null);
  assert.deepEqual(report.startupGuard, { version: 'production-startup-public-guard-v1', publicCollisionGuardVersion: 'public-collision-guard-v2', ready: true });
  assert.equal(report.execution.commit, commit); assert.equal(report.execution.fresh, true);
  assert.equal(report.configuration.promptVersion, 'production-html-grouped-v3');
  assert.equal(intent.preflightHash, report.reportHash); assert.equal(receipt.preflightHash, report.reportHash);
  const { reportHash, ...payload } = report; assert.equal(reportHash, sha(JSON.stringify(payload)));
  for (const observation of [receipt, intent]) { assert.equal(observation.sourceCommit, commit); assert.equal(observation.bootId, boot); }
  for (const snapshot of [run, json('launch-response.json')]) { assert.equal(snapshot.id, id); assert.equal(snapshot.platformCommit, commit); assert.equal(snapshot.executionIdentity.bootId, boot); assert.equal(snapshot.executionIdentity.sourceClean, true); }
  assert.equal(json('platform-metadata.json').executionIdentity.ready, true);
  assert.equal(receipt.startedThroughActualFrontend, true); assert.equal(receipt.noFulfillmentStubs, true);
  assert.equal(receipt.httpSubmitCount, 1); assert.equal(receipt.observedStartResponses, 1); assert.equal(receipt.beforeRunCount, 22); assert.equal(receipt.afterRunCount, 23);
  assert.equal(receipt.generatedArtifactEditedByOuterAgent, false); assert.equal(receipt.blockedBrowserExternalRequests, 0);
  assert.ok(Date.parse(intent.at) < Date.parse(run.createdAt));
});

test('HTML07 independently subtotals seven observed Harness HTTP attempts and complete declared-price usage', () => {
  const run = json('run.json') as ProductionRun; const counts = productionRequestCounts(run); const ledger = productionUsageLedger(run);
  for (const name of ['callRecords', 'budgetRecords', 'harnessInvocations', 'actualProviderRequests'] as const) assert.equal(counts[name], 7);
  for (const name of ['jevProviderRequests', 'unknownRequestIntents', 'simulatedStageRecords', 'injectedTestRecords'] as const) assert.equal(counts[name], 0);
  assert.equal(run.evidenceKind, 'real-model'); assert.ok(run.calls.every(c => c.executionSource === 'harness' && c.providerRequests?.status === 200 && c.providerRequests.requests === 1 && c.providerRequests.complete));
  assert.ok(run.calls.every(c => c.providerRequests?.responseFormat?.evidence === 'wire-observed' && c.providerRequests.responseFormat.mode === 'json-object'));
  assert.deepEqual(run.usage, { inputTokens: 37555, outputTokens: 7683, estimatedCost: 0.0204861, currency: 'USD', complete: true });
  assert.equal(ledger.entries, 7); assert.equal(ledger.unknownUsageEntries, 0); assert.equal(ledger.currencyMismatchEntries, 0);
  for (const [field, value] of [['inputTokens', 37555], ['outputTokens', 7683], ['estimatedCost', 0.0204861]] as const) {
    assert.equal(ledger[field].knownSubtotal, value); assert.equal(ledger[field].reportedEntries, 7); assert.equal(ledger[field].unknownEntries, 0);
  }
  assert.equal((37555 * .3 + 7683 * 1.2) / 1e6, run.usage.estimatedCost);
  assert.equal(run.calls.length < run.input.limits.maxCalls, true); assert.equal(37555 + 7683 < run.input.limits.maxTokens, true);
  assert.ok(run.calls.every(c => c.usage.outputTokens! < run.input.limits.maxOutputTokens));
});

test('HTML07 original two research syntax refusals and exact source-bound repair feedback replay without repair', () => {
  const run = json('run.json') as ProductionRun; const calls = run.calls.filter(c => c.phase === 'research');
  assert.equal(calls.length, 3);
  for (const [i, [pin, position]] of [
    ['ac67aedb1db6bc3c20f370392ef88aa659c461582c5e31ca001c03b870917016', 1829],
    ['c946a5b91055848c94e028e85d30372922e05f6261bf3e8ecdd0353deb77ab25', 233],
  ].entries()) {
    const rejected = calls[i]!; assert.equal(sha(rejected.rawOutput), pin); assert.throws(() => parseJson(rejected.rawOutput), SyntaxError);
    assert.deepEqual(diagnoseJsonOutput(rejected.rawOutput), rejected.outputDiagnostic); assert.equal(rejected.outputDiagnostic!.position, position);
    const prompt = JSON.parse(calls[i + 1]!.userPrompt); const feedback = prompt.context.regeneration;
    assert.equal(feedback.attempt, i + 1); assert.equal(feedback.frozenHash, null);
    assert.equal(feedback.rejectedCandidates.length, 1); const prior = feedback.rejectedCandidates[0];
    assert.equal(prior.id, rejected.candidateId); assert.equal(prior.callId, rejected.id); assert.equal(prior.rawOutputSha256, pin);
    assert.equal(prior.rawOutputExcerpt, rejected.rawOutput.slice(0, 2000)); assert.equal(prior.rawOutputTruncated, true);
    assert.deepEqual(prior.outputDiagnostic, rejected.outputDiagnostic);
    assert.equal(prompt.context.repairBudget.used, i + 1); assert.equal(prompt.context.repairBudget.remaining, 1 - i);
  }
  assert.equal(calls[2]!.selected, true); assert.equal(calls[2]!.error, undefined);
  assert.equal(run.repairs, 2); assert.deepEqual(run.repairHistory!.map(h => [h.role, h.phase, h.attempt]), [['researcher', 'research', 1], ['researcher', 'research', 2]]);
  assert.equal(run.verifications.filter(v => v.engine === 'llm-rubric').length, 2);
  assert.equal(run.verifications.filter(v => !v.engine).length, 3);
});

test('HTML07 PM risksNote remains strictly illegal despite empty value and existing correct closed-field guide', () => {
  const run = json('run.json') as ProductionRun; const call = run.calls.find(c => c.phase === 'think-design')!;
  assert.equal(sha(call.rawOutput), '6de257a60d1d723c83f9081b39c48fdf1fee66212e0596581fb24632bcae9414');
  const value = parseJson(call.rawOutput);
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.ok('risksNote' in value); assert.equal(value.risksNote, '');
  assert.deepEqual(Object.keys(value), ['decision', 'summary', 'tasks', 'risks', 'risksNote']);
  const parsed = planSchema.safeParse(value); assert.equal(parsed.success, false);
  if (!parsed.success) { assert.equal(parsed.error.issues.length, 1); assert.equal(parsed.error.issues[0]!.code, 'unrecognized_keys'); }
  const prompt = JSON.parse(call.userPrompt); assert.deepEqual(prompt.outputContract, outputContractSnapshot(planSchema));
  assert.deepEqual(prompt.pmOutputPolicy, pmOutputPolicy(call.phase, prompt.outputContract));
  assert.deepEqual(prompt.pmOutputPolicy.root.allowedFields, ['decision', 'summary', 'tasks', 'risks']);
  assert.equal(prompt.pmOutputPolicy.root.additionalProperties, false); assert.equal(prompt.context.repairBudget.remaining, 0);
  assert.deepEqual(diagnoseRoleSchema(call.rawOutput, planSchema, { role: 'project-manager', phase: call.phase, callId: call.id, candidateId: call.candidateId, outputContractHash: prompt.pmOutputPolicy.outputContractHash }), call.roleSchemaDiagnostic);
  assert.equal(call.selected, undefined); assert.equal(run.calls.filter(c => c.phase === 'think-design:verify').length, 0);
});

test('HTML07 terminal failure is not a delivered product, freeze, Gate or business coverage certificate', () => {
  const run = json('run.json') as ProductionRun; const manifest = json('delivery-manifest.json');
  assert.equal(run.status, 'failed'); assert.match(run.error!, /全局自动返修次数耗尽.*2\/2/);
  assert.equal(run.durationMs, 49631); assert.equal(Date.parse(run.finishedAt!) - Date.parse(run.createdAt), 49881);
  assert.deepEqual(run.outputs.map(o => o.phase), ['product', 'research']);
  assert.deepEqual(run.gateHistory, []); assert.deepEqual(run.interventions, []);
  for (const value of [run.frozenContract, run.gate, run.acceptanceConstruction]) assert.equal(value, undefined);
  assert.equal(run.calls.filter(c => ['developer', 'tester'].includes(c.role)).length, 0);
  assert.deepEqual(run.artifacts.map(a => a.name).sort(), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, id); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error); assert.equal(manifest.durationMs, run.durationMs);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.acceptanceConstruction, null);
  assert.deepEqual(manifest.usage, run.usage); assert.equal(manifest.validationContractHash, sha(JSON.stringify(run.validationContract)));
  assert.equal(manifest.validationContract.publicCollisionGuardVersion, 'public-collision-guard-v2'); assert.equal(manifest.validationContract.startupPublicGuardVersion, 'production-startup-public-guard-v1');
  assert.equal(json('ui-receipt.json').terminalStatus, 'failed');
});
