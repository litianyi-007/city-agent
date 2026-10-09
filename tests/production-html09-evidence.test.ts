import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionRequestCounts, productionUsageLedger } from '../shared/production-ledger.js';
import { parseJson, planSchema, PHASE_READY_GROUPED_PROMPT_VERSION } from '../server/production/contracts.js';
import { acceptancePlanSchema, parseAcceptancePlan } from '../server/production/acceptance-plan.js';
import { assertNoPublishedSecrets } from '../scripts/production-public-safety.js';

// Immutable receipts only: no provider, credentials, browser or generated code.
const base = new URL('../docs/production/experiments/HTML-09/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, base));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const run = () => json('run.json') as ProductionRun;
const id = '9f37b05e-3900-45c2-8dad-0bf82eb03ae7';
const commit = 'c74d723a4dd5e5f3830d5446ace559f1df713f77';
const boot = '8482bed9-3eb7-49c8-b980-e911296dda6c';

test('HTML09 preserves seventeen byte-indexed originals and the failed downloaded evidence', () => {
  assert.equal(sha(bytes('receipt-files.json')), '2dbef1bee12382fb53f950f0b38fa1759b12b8353212c3bb7aef754d23675fa7');
  const index = json('receipt-files.json');
  assert.equal(index.runId, id); assert.equal(index.sourceCommit, commit);
  assert.equal(index.files.length, 17); assert.equal(index.byteEqualityIsNotIndependentAuthenticityProof, true);
  for (const file of index.files) {
    assert.equal(bytes(file.name).length, file.bytes); assert.equal(sha(bytes(file.name)), file.sha256);
    assert.doesNotMatch(file.name, /profile|state\.json|key|\.html$/);
    if (!file.name.endsWith('.png')) assertNoPublishedSecrets(bytes(file.name), file.name);
  }
  assert.equal(sha(bytes('evidence.json')), '1e1ef47a07626fb42670866c478d2124460dcdbcf1238d37af02a40d98fa6c0e');
  assert.deepEqual(run(), json('evidence.json'));
});

test('HTML09 records contextual user consent without inventing a different verbatim approval', () => {
  const input = json('input-snapshot.json'); const actual = json('actual-browser-submit.json');
  const consent = json('authorization.json'); const checked = json('authorization-checked.json');
  const intent = json('launch-intent.json'); const receipt = json('ui-receipt.json'); const snapshot = run();
  assert.equal(consent.userReply, '推进下一步'); assert.match(consent.basis, /not a verbatim structured approval reply/);
  assert.equal(consent.referencedProposalCommit, commit); assert.equal(consent.proposalSha256, sha(bytes('PRE-REGISTRATION.md')));
  assert.equal(checked.approvalSha256, sha(bytes('authorization.json')));
  assert.deepEqual(actual, input); assert.deepEqual(actual, snapshot.input);
  assert.equal(checked.boundedInputSha256, sha(JSON.stringify(actual))); assert.equal(intent.expectedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(consent.singleRunOnly, true); assert.equal(consent.automaticRetryAllowed, false);
  assert.equal(consent.jevRequestsAllowed, false); assert.equal(consent.generatedArtifactManualEditsAllowed, false);
  assert.deepEqual(input.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(input.limits, consent.limits); assert.equal(input.requirement.kind, 'illustrative');
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-08/input-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(input.brief, prior.brief); assert.equal(input.requirement.acceptance, prior.requirement.acceptance);
  assert.equal(receipt.startedThroughActualFrontend, true); assert.equal(receipt.noFulfillmentStubs, true);
  assert.equal(receipt.httpSubmitCount, 1); assert.equal(receipt.observedStartResponses, 1);
  assert.equal(receipt.beforeRunCount, 24); assert.equal(receipt.afterRunCount, 25);
  assert.equal(receipt.generatedArtifactEditedByOuterAgent, false); assert.equal(receipt.automaticAdditionalRun, false);
  for (const value of [receipt, intent]) { assert.equal(value.sourceCommit, commit); assert.equal(value.bootId, boot); }
  assert.ok(Date.parse(checked.checkedAt) < Date.parse(intent.at)); assert.ok(Date.parse(intent.at) < Date.parse(snapshot.createdAt));
  const driver = bytes('ui-driver.mjs.txt').toString('utf8');
  assert.doesNotMatch(driver, /\.fulfill\s*\(/); assert.match(driver, /Never replay an issued or ambiguous submission/);
  assert.equal(driver.split("getByRole('button', { name: '启动真实生产', exact: true }).click()").length - 1, 1);
});

test('HTML09 frozen v5 preflight was ready but never granted success or a second run', () => {
  const report = json('launch-preflight.json'); const snapshot = run();
  assert.equal(report.ready, true); assert.equal(report.paidAuthorized, false); assert.equal(report.modelRequests, 0); assert.equal(report.finalGate, null);
  assert.equal(report.configuration.promptVersion, PHASE_READY_GROUPED_PROMPT_VERSION);
  assert.equal(report.configuration.phaseReadinessVersion, 'production-phase-readiness-v1');
  assert.equal(report.configuration.acceptanceSourceDiagnosticsVersion, undefined, 'v6 is not retroactively attached to v5');
  assert.equal(report.execution.commit, commit); assert.equal(report.execution.bootId, boot);
  assert.equal(report.execution.sourceClean, true); assert.equal(report.execution.fresh, true); assert.equal(report.startupGuard.ready, true);
  const { reportHash, ...payload } = report; assert.equal(reportHash, sha(JSON.stringify(payload)));
  assert.equal(json('launch-intent.json').preflightHash, reportHash);
  assert.deepEqual(report.input, { ...snapshot.input, budgetAuthorized: false });
  assert.deepEqual(report.models, snapshot.agentSnapshot);
  for (const model of report.models) {
    assert.equal(model.provider, 'deepseek'); assert.equal(model.modelId, 'deepseek-flash'); assert.equal(model.hasApiKey, true);
    assert.equal(Object.hasOwn(model, 'apiKey'), false); assert.deepEqual(model.pricing, { inputPerMillion: .3, outputPerMillion: 1.2, currency: 'USD' });
  }
});

test('HTML09 independent ledger reports nine actual requests, known usage and declared-price estimate', () => {
  const snapshot = run(); const counts = productionRequestCounts(snapshot); const ledger = productionUsageLedger(snapshot);
  for (const field of ['callRecords', 'budgetRecords', 'harnessInvocations', 'actualProviderRequests'] as const) assert.equal(counts[field], 9);
  for (const field of ['jevProviderRequests', 'unknownRequestIntents', 'simulatedStageRecords', 'injectedTestRecords'] as const) assert.equal(counts[field], 0);
  assert.equal(snapshot.evidenceKind, 'real-model');
  assert.deepEqual(snapshot.usage, { inputTokens: 60282, outputTokens: 13291, estimatedCost: .0340338, currency: 'USD', complete: true });
  assert.equal(ledger.unknownUsageEntries, 0); assert.equal(ledger.currencyMismatchEntries, 0);
  assert.equal(ledger.inputTokens.knownSubtotal, 60282); assert.equal(ledger.outputTokens.knownSubtotal, 13291);
  assert.equal(snapshot.usage.inputTokens! + snapshot.usage.outputTokens!, 73573);
  // Integer cents avoid an irrelevant IEEE-754 difference from regrouping the
  // same declared rates. Never change or round the archived run/ledger amount.
  assert.equal(ledger.estimatedCost.knownSubtotal, (60282 * 30 + 13291 * 120) / 1e8);
  for (const call of snapshot.calls) {
    assert.equal(call.executionSource, 'harness'); assert.equal(call.promptVersion, PHASE_READY_GROUPED_PROMPT_VERSION);
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.protocolComplete, true);
  }
  assert.equal(snapshot.durationMs, 69090); assert.equal(Date.parse(snapshot.finishedAt!) - Date.parse(snapshot.createdAt), 69273);
});

test('HTML09 PM releases construction once, but all three illegal quotes remain rejected and no delivery is counted', () => {
  const snapshot = run(); const pm = snapshot.calls.find(call => call.phase === 'think-design')!;
  assert.equal(planSchema.parse(parseJson(pm.rawOutput)).decision, 'proceed');
  const plans = snapshot.calls.filter(call => call.phase === 'acceptance-plan'); assert.equal(plans.length, 3);
  for (const call of plans) {
    const plan = acceptancePlanSchema.parse(parseJson(call.rawOutput)); assert.equal(call.selected, undefined);
    const invalid = plan.obligations.flatMap((o, index) => (o.source === 'brief' ? snapshot.input.brief : snapshot.input.requirement.acceptance).includes(o.quote) ? [] : [index]);
    assert.deepEqual(invalid, [6]); assert.equal(plan.obligations[6]!.source, 'acceptance');
    assert.throws(() => parseAcceptancePlan(plan, { brief: snapshot.input.brief, acceptance: snapshot.input.requirement.acceptance }), /plan-source-quote/);
    assert.match(call.error!, /plan-source-quote/); assert.equal(call.acceptanceSourceDiagnostic, undefined);
  }
  assert.equal(snapshot.calls.filter(call => call.role === 'verifier').length, 3);
  assert.equal(snapshot.verifications.filter(review => review.engine === 'llm-rubric').length, 3);
  assert.equal(snapshot.calls.some(call => call.role === 'tester' || call.role === 'developer'), false);
  assert.equal(snapshot.status, 'failed'); assert.equal(snapshot.repairs, 2); assert.equal(snapshot.repairHistory!.length, 2);
  assert.deepEqual(snapshot.interventions, []); assert.equal(snapshot.frozenContract, undefined); assert.equal(snapshot.gate, undefined);
  assert.deepEqual(snapshot.gateHistory, []); assert.equal(snapshot.acceptanceConstruction, undefined);
  const manifest = json('delivery-manifest.json'); assert.equal(manifest.status, 'failed'); assert.deepEqual(manifest.usage, snapshot.usage);
});
