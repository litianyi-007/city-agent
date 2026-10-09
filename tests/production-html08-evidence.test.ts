import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { ProductionRun } from '../shared/production-schema.js';
import { PRODUCTION_ROLES } from '../shared/production-schema.js';
import { productionRequestCounts, productionUsageLedger } from '../shared/production-ledger.js';
import { contractProfile, outputContractSnapshot, parseJson, planSchema, researchSchema } from '../server/production/contracts.js';
import { outputEnvelopePolicy } from '../server/production/output-envelope.js';
import { pmOutputPolicy } from '../server/production/role-output-policy.js';
import { parseVerifierDecisionText } from '../server/production/verifier-diagnostics.js';

// Receipt-only regression: no browser, service, SDK, generated-code execution,
// credentials or provider requests. Green tests preserve this failed attempt.
const base = new URL('../docs/production/experiments/HTML-08/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, base));
const json = (name: string) => JSON.parse(bytes(name).toString('utf8'));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const run = () => json('run.json') as ProductionRun;
const id = '966fc3b9-1308-4e19-832f-ea4960fb07f2';
const commit = 'f21256f8fe280b619c295ec17842fdc941b36545';
const boot = 'e46b7f26-3512-4d33-aaa4-04d4b5449491';

test('HTML08 immutable byte index preserves 18 public receipts and exact failed artifacts', () => {
  assert.equal(sha(bytes('receipt-files.json')), '06d926e8793cd2cf259e33477099854bd53a2febbb666d2b5c31d2e71c217b01');
  const index = json('receipt-files.json');
  assert.equal(index.runId, id); assert.equal(index.sourceCommit, commit);
  assert.equal(index.byteEqualityIsNotIndependentAuthenticityProof, true);
  assert.equal(index.files.length, 18);
  assert.equal(new Set(index.files.map((f: { name: string }) => f.name)).size, 18);
  for (const file of index.files) {
    assert.equal(bytes(file.name).length, file.bytes);
    assert.equal(sha(bytes(file.name)), file.sha256);
    assert.doesNotMatch(file.name, /profile|state\.json|key|\.html$/);
  }
  for (const name of ['evidence.json', 'delivery-manifest.json']) {
    assert.equal(index.files.find((file: { name: string }) => file.name === name).origin, 'exact-downloaded-artifact-bytes');
  }
  assert.equal(sha(bytes('evidence.json')), '72205008b98605c0f764b3ecae4e8613eadc8ea2ea41d5b7497fcad9b5097e31');
  assert.deepEqual(json('run.json'), json('evidence.json'));
  assert.deepEqual(bytes('run.json'), Buffer.concat([bytes('evidence.json'), Buffer.from('\n')]));
});

test('HTML08 binds this single authorization to the original eight requirements and actual one-click UI submission', () => {
  const input = json('input-snapshot.json'); const actual = json('actual-browser-submit.json');
  const authorization = json('authorization.json'); const checked = json('authorization-checked.json');
  const intent = json('launch-intent.json'); const receipt = json('ui-receipt.json'); const snapshot = run();
  assert.deepEqual(actual, input); assert.deepEqual(actual, snapshot.input);
  assert.equal(authorization.userReply, '批准仅这一次，采用1 USD限额');
  assert.equal(authorization.referencedProposalCommit, commit);
  assert.equal(authorization.proposalSha256, sha(bytes('PRE-REGISTRATION.md')));
  assert.equal(checked.approvalSha256, sha(bytes('authorization.json')));
  assert.equal(checked.boundedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(intent.expectedInputSha256, sha(JSON.stringify(actual)));
  assert.equal(authorization.singleRunOnly, true); assert.equal(checked.singleRunOnly, true);
  assert.equal(authorization.automaticRetryAllowed, false); assert.equal(intent.automaticRetryAllowed, false);
  assert.equal(authorization.generatedArtifactManualEditsAllowed, false); assert.equal(authorization.jevRequestsAllowed, false);
  assert.equal(receipt.automaticAdditionalRun, false); assert.equal(receipt.generatedArtifactEditedByOuterAgent, false);
  assert.deepEqual(actual.limits, { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(actual.limits, authorization.limits); assert.equal(actual.budgetAuthorized, true);
  assert.equal(actual.requirement.id, 'HTML-08'); assert.equal(actual.requirement.kind, 'illustrative');
  const prior = JSON.parse(readFileSync(new URL('../docs/production/experiments/HTML-07/input-snapshot.json', import.meta.url), 'utf8'));
  assert.equal(actual.brief, prior.brief); assert.equal(actual.requirement.acceptance, prior.requirement.acceptance);
  assert.deepEqual(actual.agentIds, prior.agentIds);
  assert.equal((actual.requirement.acceptance.match(/^\d\./gm) ?? []).length, 8);
  assert.equal(actual.mode, 'live'); assert.equal(actual.capability, 'offline-single-html');
  assert.equal(actual.verifierEngine, 'llm-rubric'); assert.equal(actual.candidateCount, 1);
  assert.equal(actual.implementationEvidencePolicy, 'legacy'); assert.equal(actual.acceptanceStrategy, 'planned-groups-v1');
  assert.equal(receipt.startedThroughActualFrontend, true); assert.equal(receipt.noFulfillmentStubs, true);
  assert.equal(receipt.httpSubmitCount, 1); assert.equal(receipt.observedStartResponses, 1);
  assert.equal(receipt.beforeRunCount, 23); assert.equal(receipt.afterRunCount, 24);
  assert.equal(receipt.blockedBrowserExternalRequests, 0);
  for (const value of [receipt, intent]) { assert.equal(value.sourceCommit, commit); assert.equal(value.bootId, boot); }
  assert.ok(Date.parse(authorization.recordedAt) < Date.parse(checked.checkedAt));
  assert.ok(Date.parse(checked.checkedAt) < Date.parse(intent.at));
  assert.ok(Date.parse(intent.at) < Date.parse(snapshot.createdAt));
  const driver = bytes('ui-driver.mjs.txt').toString('utf8');
  assert.match(driver, /Never replay an issued or ambiguous submission/);
  assert.match(driver, /flag: 'wx'/); assert.doesNotMatch(driver, /\.fulfill\s*\(/);
  assert.equal(driver.split("getByRole('button', { name: '启动真实生产', exact: true }).click()").length - 1, 1);
});

test('HTML08 free preflight and actual run bind clean v4 execution plus exact six public model snapshots', () => {
  const report = json('launch-preflight.json'); const snapshot = run(); const models = json('public-agent-configuration.json');
  const receipt = json('ui-receipt.json'); const intent = json('launch-intent.json');
  assert.deepEqual(report.input, { ...snapshot.input, budgetAuthorized: false });
  assert.equal(report.ready, true); assert.equal(report.paidAuthorized, false);
  assert.equal(report.modelRequests, 0); assert.equal(report.finalGate, null);
  assert.deepEqual(report.configuration, {
    promptVersion: 'production-html-grouped-v4', pmOutputPolicyVersion: 'production-pm-output-policy-v1',
    roleSchemaDiagnosticsVersion: 'production-role-schema-diagnostics-v1', acceptanceStepAuditVersion: 'production-acceptance-step-audit-v1',
    acceptanceReviewProjectionVersion: 'production-acceptance-review-projection-v1', outputEnvelopeVersion: 'production-output-envelope-v1',
  });
  assert.deepEqual(report.startupGuard, { version: 'production-startup-public-guard-v1', publicCollisionGuardVersion: 'public-collision-guard-v2', ready: true });
  const { reportHash, ...payload } = report; assert.equal(reportHash, sha(JSON.stringify(payload)));
  assert.equal(intent.preflightHash, reportHash); assert.equal(receipt.preflightHash, reportHash);
  assert.equal(report.execution.fresh, true); assert.equal(report.execution.ready, true);
  assert.equal(report.execution.commit, commit); assert.equal(report.execution.bootId, boot);
  assert.equal(report.execution.sourceClean, true); assert.equal(report.execution.buildSnapshot.platformCommit, commit);
  assert.equal(report.budget.baseCalls, 16); assert.equal(report.budget.worstCaseCalls, 28);
  assert.ok(report.budget.worstCaseCalls > snapshot.input.limits.maxCalls, 'Reservation envelope is not a promise of completion');
  assert.equal(models.length, 6); assert.deepEqual(models.map((m: { role: string }) => m.role), [...PRODUCTION_ROLES]);
  assert.deepEqual(report.models, models); assert.deepEqual(snapshot.agentSnapshot, models);
  for (const model of models) {
    assert.equal(model.provider, 'deepseek'); assert.equal(model.modelId, 'deepseek-flash');
    assert.equal(model.baseUrl, 'https://api.deepseek.com'); assert.equal(model.hasApiKey, true);
    assert.equal(Object.hasOwn(model, 'apiKey'), false);
    assert.deepEqual(model.pricing, { inputPerMillion: .3, outputPerMillion: 1.2, currency: 'USD' });
  }
  for (const value of [snapshot, json('launch-response.json')]) {
    assert.equal(value.id, id); assert.equal(value.platformCommit, commit);
    assert.equal(value.executionIdentity.bootId, boot); assert.equal(value.executionIdentity.sourceClean, true);
  }
  assert.equal(snapshot.validationContract!.outputEnvelopeVersion, 'production-output-envelope-v1');
});

test('HTML08 independently subtotals 18 observed Harness HTTP attempts and all declared-price usage', () => {
  const snapshot = run(); const counts = productionRequestCounts(snapshot); const ledger = productionUsageLedger(snapshot);
  for (const field of ['callRecords', 'budgetRecords', 'harnessInvocations', 'actualProviderRequests'] as const) assert.equal(counts[field], 18);
  for (const field of ['jevProviderRequests', 'unknownRequestIntents', 'simulatedStageRecords', 'injectedTestRecords'] as const) assert.equal(counts[field], 0);
  assert.equal(snapshot.evidenceKind, 'real-model'); assert.equal(snapshot.calls.length, 18);
  for (const call of snapshot.calls) {
    assert.equal(call.executionSource, 'harness'); assert.equal(call.providerRequests!.requests, 1);
    assert.equal(call.providerRequests!.deniedRequests, 0); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.protocolComplete, true);
    assert.equal(call.providerRequests!.inputTokens, call.usage.inputTokens);
    assert.equal(call.providerRequests!.outputTokens, call.usage.outputTokens);
    assert.equal(call.responseFormat!.evidence, 'wire-observed'); assert.equal(call.responseFormat!.mode, 'json-object');
    assert.equal(call.promptVersion, 'production-html-grouped-v4'); assert.equal(call.error, undefined);
    assert.ok(call.usage.outputTokens! < 6000);
  }
  assert.deepEqual(snapshot.usage, { inputTokens: 166317, outputTokens: 13317, estimatedCost: .0658755, currency: 'USD', complete: true });
  assert.equal(ledger.entries, 18); assert.equal(ledger.unknownUsageEntries, 0); assert.equal(ledger.currencyMismatchEntries, 0);
  for (const [field, expected] of [['inputTokens', 166317], ['outputTokens', 13317], ['estimatedCost', .0658755]] as const) {
    assert.equal(ledger[field].knownSubtotal, expected); assert.equal(ledger[field].reportedEntries, 18);
    assert.equal(ledger[field].unknownEntries, 0);
  }
  assert.equal((166317 * .3 + 13317 * 1.2) / 1e6, snapshot.usage.estimatedCost);
  assert.equal(166317 + 13317, 179634);
  assert.ok(179634 < snapshot.input.limits.maxTokens); assert.ok(snapshot.calls.length < snapshot.input.limits.maxCalls);
  assert.ok(snapshot.usage.estimatedCost! < 1); assert.ok(snapshot.durationMs! < 600000);
});

test('HTML08 all nine original role outputs are valid closed schemas, with six source-derived envelopes, not delivery proof', () => {
  const snapshot = run(); const roles = snapshot.calls.filter(c => c.role !== 'verifier');
  assert.equal(roles.length, 9); assert.ok(snapshot.calls.every(c => parseJson(c.rawOutput) !== undefined));
  for (const call of roles) {
    assert.equal(call.selected, true); assert.equal(call.outputDiagnostic, undefined);
    assert.equal(call.roleSchemaDiagnostic, undefined);
    const schema = call.role === 'product' ? contractProfile('offline-single-html').productSchema : call.role === 'researcher' ? researchSchema : planSchema;
    const value = schema.parse(parseJson(call.rawOutput)); const prompt = JSON.parse(call.userPrompt);
    assert.deepEqual(prompt.outputContract, outputContractSnapshot(schema));
    assert.equal(call.promptHash, sha(JSON.stringify({ system: call.systemPrompt, prompt: call.userPrompt })));
    assert.deepEqual(snapshot.outputs.find(output => output.selectedCandidateId === call.candidateId)!.value, value);
    if (call.role === 'product') { assert.equal(prompt.outputEnvelope, undefined); continue; }
    assert.ok(call.role === 'researcher' || call.role === 'project-manager');
    assert.deepEqual(prompt.outputEnvelope, outputEnvelopePolicy(call.role, call.phase, prompt.outputContract));
    assert.equal(prompt.outputEnvelope.outputContractHash, sha(JSON.stringify(prompt.outputContract)));
    assert.equal(prompt.outputEnvelope.root.additionalProperties, false);
    if (call.role === 'project-manager') {
      assert.deepEqual(prompt.pmOutputPolicy, pmOutputPolicy(call.phase, prompt.outputContract));
      assert.deepEqual(prompt.outputEnvelope.root.allowedFields, ['decision', 'summary', 'tasks', 'risks']);
    } else assert.deepEqual(prompt.outputEnvelope.root.allowedFields, ['observations', 'constraints', 'unknowns']);
  }
  assert.equal(roles.filter(c => c.role === 'researcher' || c.role === 'project-manager').length, 6);
});

test('HTML08 nine paid static Verifier accepts select stage candidates but do not change three PM revise decisions', () => {
  const snapshot = run(); const reviews = snapshot.calls.filter(c => c.role === 'verifier');
  assert.equal(reviews.length, 9); assert.equal(snapshot.verifications.length, 9);
  for (const call of reviews) {
    const prompt = JSON.parse(call.userPrompt);
    const candidateIds = prompt.candidates.map((candidate: { id: string }) => candidate.id);
    assert.equal(candidateIds.length, 1);
    const decision = parseVerifierDecisionText(call.rawOutput, candidateIds);
    assert.equal(decision.decision, 'accept'); assert.equal(decision.selectedCandidateId, candidateIds[0]);
    const source = snapshot.calls.find(c => c.candidateId === candidateIds[0])!;
    assert.equal(source.selected, true); assert.notEqual(source.role, 'verifier');
    assert.deepEqual(prompt.candidates[0].value, parseJson(source.rawOutput));
    if (call.phase === 'think-design:verify') assert.equal(planSchema.parse(parseJson(source.rawOutput)).decision, 'revise');
  }
  assert.deepEqual(snapshot.verifications.map(v => v.scores[0]!.score), [4, 4, 4, 4, 5, 4, 4, 4, 4]);
  assert.ok(snapshot.verifications.every(v => v.engine === 'llm-rubric' && v.decision === 'accept'));
});

test('HTML08 two shared replans preserve exact prior sources and only repeat product research and PM before exhaustion', () => {
  const snapshot = run(); const stages = ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design:verify'];
  assert.deepEqual(snapshot.calls.map(c => c.phase), [...stages, ...stages, ...stages]);
  assert.equal(snapshot.repairs, 2); assert.equal(snapshot.repairHistory!.length, 2);
  const pms = snapshot.calls.filter(c => c.role === 'project-manager');
  assert.equal(pms.length, 3);
  for (const call of pms) {
    const value = planSchema.parse(parseJson(call.rawOutput));
    assert.equal(value.decision, 'revise'); assert.match(value.summary, /具体化|具体/);
    assert.ok(value.tasks.some(task => task.owner === 'tester' && /steps|核算/.test(task.description)));
    assert.ok(value.tasks.some(task => task.owner === 'product' && /CSS|选择器/.test(task.description)));
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const repair = snapshot.repairHistory![attempt - 1]!; const priorOffset = (attempt - 1) * 6;
    const priorProduct = parseJson(snapshot.calls[priorOffset]!.rawOutput);
    const priorResearch = parseJson(snapshot.calls[priorOffset + 2]!.rawOutput);
    const priorPM = snapshot.calls[priorOffset + 4]!; const priorPlan = parseJson(priorPM.rawOutput);
    assert.equal(repair.role, 'project-manager'); assert.equal(repair.phase, 'think-design');
    assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.attempt, attempt);
    assert.equal(repair.frozenHash, null); assert.deepEqual(repair.rejectedCandidateIds, [priorPM.candidateId]);
    for (const index of [attempt * 6, attempt * 6 + 2, attempt * 6 + 4]) {
      const context = JSON.parse(snapshot.calls[index]!.userPrompt).context; const regeneration = context.regeneration;
      assert.equal(regeneration.attempt, attempt); assert.equal(regeneration.reason, repair.reason);
      assert.equal(regeneration.frozenHash, null); assert.equal(regeneration.policyVersion, snapshot.repairPolicyVersion);
      assert.match(regeneration.instruction, /Do not develop or freeze acceptance until the project manager proceeds/);
      assert.equal(regeneration.planningFeedback.sourceRoleCallId, priorPM.id);
      assert.equal(regeneration.planningFeedback.sourceCandidateId, priorPM.candidateId);
      assert.equal(regeneration.planningFeedback.repairId, repair.id);
      assert.deepEqual(regeneration.planningFeedback.previous, { product: priorProduct, research: priorResearch, plan: priorPlan });
      assert.equal(context.planningReviewContext.sourceRoleCallId, priorPM.id);
      assert.deepEqual(context.planningReviewContext.priorResearch, priorResearch);
      assert.deepEqual(context.planningReviewContext.priorPlan, priorPlan);
      assert.equal(context.repairBudget.used, attempt); assert.equal(context.repairBudget.remaining, 2 - attempt);
    }
  }
});

test('HTML08 preserves deferred future DOM and unsupported capacity prose without inventing actual steps or coverage', () => {
  const snapshot = run(); const researches = snapshot.calls.filter(c => c.role === 'researcher');
  for (const call of researches) {
    const value = researchSchema.parse(parseJson(call.rawOutput));
    assert.ok(value.unknowns.some(unknown => /deferred:.*选择器/.test(unknown)));
  }
  for (const call of researches.slice(1)) {
    const value = researchSchema.parse(parseJson(call.rawOutput)); const prose = value.observations.join('\n');
    assert.match(prose, /G8[^\n]*约11步/); assert.match(prose, /G9[^\n]*约13步/);
    assert.match(prose, /每个负例独立fill被测金额并在.*click后立即断言条目数.*总额.*小计不变/);
  }
  // The prose does not contain actual steps. This literal layout counterexample
  // assumes five separate fill + click + count + total + subtotal entries each:
  // 25 already exceeds 20, before setup, prompt or unchanged-content assertions.
  // It is NOT a proof that every alternative complete legal layout is impossible.
  assert.equal(5 * (1 + 1 + 1 + 1 + 1), 25);
  assert.ok(25 > 20);
  assert.equal(snapshot.acceptanceConstruction, undefined); assert.equal(snapshot.frozenContract, undefined);
});

test('HTML08 failed planning is not a generated product, frozen contract, actual Gate or complete good delivery', () => {
  const snapshot = run(); const manifest = json('delivery-manifest.json');
  assert.equal(snapshot.status, 'failed'); assert.match(snapshot.error!, /全局自动返修次数耗尽.*2\/2.*研发前规划revise/);
  assert.equal(snapshot.durationMs, 102991);
  assert.equal(Date.parse(snapshot.finishedAt!) - Date.parse(snapshot.createdAt), 103209);
  assert.deepEqual(snapshot.gateHistory, []);
  assert.deepEqual(snapshot.interventions, [], 'Only the run intervention ledger, not proof of zero outer development work');
  assert.equal(snapshot.calls.filter(c => c.role === 'tester' || c.role === 'developer').length, 0);
  for (const value of [snapshot.frozenContract, snapshot.gate, snapshot.acceptanceConstruction]) assert.equal(value, undefined);
  assert.deepEqual(snapshot.outputs.map(o => o.phase), ['product', 'research', 'think-design', 'product', 'research', 'think-design', 'product', 'research', 'think-design']);
  assert.deepEqual(snapshot.artifacts.map(a => a.name).sort(), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(manifest.runId, id); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, snapshot.error);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null); assert.equal(manifest.acceptanceConstruction, null);
  assert.deepEqual(manifest.usage, snapshot.usage); assert.equal(manifest.durationMs, snapshot.durationMs);
  assert.equal(manifest.promptVersion, 'production-html-grouped-v4');
  assert.equal(manifest.validationContractHash, sha(JSON.stringify(snapshot.validationContract)));
  assert.equal(manifest.validationContract.outputEnvelopeVersion, 'production-output-envelope-v1');
  assert.equal(json('ui-receipt.json').terminalStatus, 'failed');
});
