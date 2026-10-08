import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionRequestCounts, productionUsageLedger } from '../shared/production-ledger.js';

const base = new URL('../docs/production/experiments/HTML-06/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, base));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const id = '6bd95961-4dca-4378-9d2b-ead8befdb36e';
const commit = 'fba3731f373d690b6792b01beb62f1e7d4337d3a';
const boot = '45b7681c-f1d5-44b6-85d2-2f311871f47e';

test('HTML06 immutable byte index covers public-only exact downloads and normalized observations', () => {
  assert.equal(sha(bytes('receipt-files.json')), '9ad19dab0117b1b6a47238f52b2eff7dd8af40ef6ae6d92f6f903f6aa9932622');
  const index = json('receipt-files.json');
  assert.equal(index.runId, id); assert.equal(index.sourceCommit, commit);
  assert.equal(index.byteEqualityIsNotIndependentAuthenticityProof, true);
  assert.equal(index.files.length, 16); assert.equal(new Set(index.files.map((f: { name: string }) => f.name)).size, 16);
  for (const file of index.files) { assert.equal(bytes(file.name).length, file.bytes); assert.equal(sha(bytes(file.name)), file.sha256); assert.doesNotMatch(file.name, /profile|state\.json|key|\.html$/); }
  for (const name of ['evidence.json', 'delivery-manifest.json']) assert.equal(index.files.find((f: { name: string }) => f.name === name).origin, 'exact-downloaded-artifact-bytes');
  assert.equal(index.files.find((f: { name: string }) => f.name === 'actual-browser-submit.json').origin, 'normalized-observed-browser-request');
  assert.equal(sha(bytes('evidence.json')), '65c0ccb214679b64f4892b55b7b0441583c4f988be59e6b565497557b6de560a');
  assert.deepEqual(json('evidence.json'), json('run.json'));
  assert.deepEqual(bytes('run.json'), Buffer.concat([bytes('evidence.json'), Buffer.from('\n')]));
});

test('HTML06 sole UI launch binds literal bounded assent, unchanged eight requirements and clean boot', () => {
  const input = json('input-snapshot.json'); const actual = json('actual-browser-submit.json'); const authorization = json('authorization.json');
  const run = json('run.json'); const intent = json('launch-intent.json'); const receipt = json('ui-receipt.json'); const checked = json('authorization-checked.json'); const preflight = json('launch-preflight.json');
  assert.deepEqual(input, actual); assert.deepEqual(actual, run.input);
  assert.equal(authorization.userReply, '继续下一步'); assert.match(authorization.basis, /interpreted/); assert.match(authorization.limitation, /not an independent signature/);
  assert.equal(authorization.referencedProposalCommit, commit); assert.equal(checked.approvalSha256, sha(bytes('authorization.json')));
  assert.equal(checked.boundedInputSha256, sha(JSON.stringify(actual))); assert.equal(intent.expectedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(intent.automaticRetryAllowed, false); assert.equal(receipt.automaticAdditionalRun, false);
  assert.deepEqual(actual.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(actual.limits, authorization.limits); assert.equal(actual.budgetAuthorized, true);
  assert.equal(actual.requirement.kind, 'illustrative'); assert.equal(actual.requirement.id, 'HTML-06');
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-05/input-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(actual.brief, prior.brief); assert.equal(actual.requirement.acceptance, prior.requirement.acceptance);
  assert.equal((actual.requirement.acceptance.match(/^\d\./gm) ?? []).length, 8);
  assert.equal(actual.candidateCount, 1); assert.equal(actual.verifierEngine, 'llm-rubric'); assert.equal(actual.implementationEvidencePolicy, 'legacy');
  assert.equal(actual.acceptanceStrategy, 'planned-groups-v1');
  assert.deepEqual(preflight.input, { ...actual, budgetAuthorized: false });
  assert.equal(preflight.ready, true); assert.equal(preflight.modelRequests, 0); assert.equal(preflight.paidAuthorized, false); assert.equal(preflight.finalGate, null);
  assert.equal(preflight.configuration.promptVersion, 'production-html-grouped-v3'); assert.equal(preflight.configuration.acceptanceStepAuditVersion, 'production-acceptance-step-audit-v1');
  // This historical ready report did NOT check full startup guard parity.
  assert.equal(preflight.startupGuard, undefined);
  assert.equal(intent.preflightHash, preflight.reportHash); assert.equal(receipt.preflightHash, preflight.reportHash);
  const { reportHash, ...payload } = preflight; assert.equal(reportHash, sha(JSON.stringify(payload)));
  for (const observation of [receipt, intent]) { assert.equal(observation.sourceCommit, commit); assert.equal(observation.bootId, boot); }
  for (const snapshot of [run, json('launch-response.json')]) { assert.equal(snapshot.id, id); assert.equal(snapshot.platformCommit, commit); assert.equal(snapshot.executionIdentity.bootId, boot); assert.equal(snapshot.executionIdentity.sourceClean, true); }
  assert.equal(json('platform-metadata.json').executionIdentity.ready, true);
  assert.equal(receipt.startedThroughActualFrontend, true); assert.equal(receipt.noFulfillmentStubs, true);
  assert.equal(receipt.httpSubmitCount, 1); assert.equal(receipt.observedStartResponses, 1); assert.equal(receipt.beforeRunCount, 21); assert.equal(receipt.afterRunCount, 22);
  assert.equal(receipt.generatedArtifactEditedByOuterAgent, false); assert.equal(receipt.blockedBrowserExternalRequests, 0);
  assert.ok(Date.parse(intent.at) < Date.parse(run.createdAt));
});

test('HTML06 host startup refusal is zero-call failure, not model quality or autonomous delivery evidence', () => {
  const run = json('run.json') as ProductionRun;
  assert.equal(run.status, 'failed'); assert.equal(run.error, '评估凭据碰撞检查超限，请精简配置');
  assert.equal(run.evidenceKind, 'real-model'); assert.equal(run.input.mode, 'live');
  for (const rows of [run.calls, run.verifications, run.outputs, run.gateHistory, run.repairHistory!, run.interventions]) assert.deepEqual(rows, []);
  assert.equal(run.repairs, 0); assert.equal(run.events.length, 1); assert.equal(run.events[0].phase, 'failed');
  for (const value of [run.acceptanceConstruction, run.frozenContract, run.gate]) assert.equal(value, undefined);
  assert.deepEqual(run.artifacts.map(a => a.name).sort(), ['delivery-manifest.json', 'evidence.json']);
  const counts = productionRequestCounts(run);
  for (const name of ['callRecords', 'budgetRecords', 'harnessInvocations', 'actualProviderRequests', 'jevProviderRequests', 'unknownRequestIntents'] as const) assert.equal(counts[name], 0);
  assert.deepEqual(run.usage, { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true });
  // Empty usage rows have no reported subtotal; not a fabricated provider row.
  const ledger = productionUsageLedger(run); assert.equal(ledger.entries, 0);
  for (const field of ['inputTokens', 'outputTokens', 'estimatedCost'] as const) { assert.equal(ledger[field].knownSubtotal, null); assert.equal(ledger[field].reportedEntries, 0); assert.equal(ledger[field].unknownEntries, 0); }
  assert.equal(run.agentSnapshot.length, 6); assert.ok(run.agentSnapshot.every(a => a.hasApiKey && a.modelId === 'deepseek-flash' && !Object.hasOwn(a, 'apiKey')));
});

test('HTML06 terminal manifest records startup failure, no source/Gate and distinct timing scopes', () => {
  const run = json('run.json'); const manifest = json('delivery-manifest.json');
  assert.equal(run.durationMs, 286); assert.equal(Date.parse(run.finishedAt) - Date.parse(run.createdAt), 536);
  assert.equal(manifest.runId, id); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error); assert.equal(manifest.durationMs, run.durationMs);
  assert.deepEqual(manifest.usage, run.usage); assert.deepEqual(manifest.validationContract, run.validationContract);
  assert.equal(manifest.validationContractHash, sha(JSON.stringify(run.validationContract)));
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.frozenContract, undefined);
  assert.equal(manifest.promptVersion, 'production-html-grouped-v3');
  assert.equal(json('ui-receipt.json').terminalStatus, 'failed');
});
