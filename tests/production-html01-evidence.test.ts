import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { codeSchema, parseVerifiedDecision, planSchema, productSchema, researchSchema, testsSchema, verifierSchema } from '../server/production/contracts.js';
import { preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Historical receipt checks only: no model, browser, generated-code execution,
// repricing, source migration, or assertion that the repaired page would pass.
const directory = new URL('../docs/production/experiments/HTML-01/', import.meta.url);
const runId = 'fb6e1e6a-d8b8-4f50-80c8-c557793fbddd';
const frozenCommit = '967bbba15c92dc07cf40fd2b2f5affebf1493b12';
const fileHashes = {
  'run.json': '29a46e05b5e50a3585d91c2f4e13846c92023ce84951d6bc80b408660ff4c9f6',
  'evidence.json': '5db19a9a043a53dc8da5c03c935b5859fc259f7fc56d5f4afafe769a123a564a',
  'delivery-manifest.json': '1150074b88b137113821a5dcfae4a9854f96a72552072994b36cb6dc2a0179da',
  'platform-metadata.json': '2b5d66d23aa6ba858485a4418b79f26592973884ee2a55580f31ee3e7f4db8f2',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const loadRun = (): ProductionRun => JSON.parse(read('run.json').toString('utf8'));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => digest(JSON.stringify(value));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test('HTML-01 retains four original receipts and its clean, real-model but illustrative failed attempt without a delivered source', () => {
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(digest(read(name as keyof typeof fileHashes)), expected, `${name}: immutable original bytes`);
  const run = loadRun(); const evidence: ProductionRun = JSON.parse(read('evidence.json').toString('utf8'));
  const metadata = JSON.parse(read('platform-metadata.json').toString('utf8'));
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  assert.deepEqual(evidence, run);
  assert.equal(run.id, runId); assert.equal(run.platformCommit, frozenCommit);
  assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 79544);
  assert.equal(run.evidenceKind, 'real-model'); assert.equal(run.input.mode, 'live');
  assert.equal(run.input.requirement.id, 'HTML-01'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.capability, 'offline-single-html'); assert.equal(run.input.candidateCount, 1);
  assert.equal(Object.hasOwn(run.input, 'demoCaseId'), false); assert.equal(Object.hasOwn(run.input, 'cameraBusinessConstraints'), false);
  assert.equal(run.input.budgetAuthorized, true);
  assert.deepEqual(run.input.limits, { maxCalls: 30, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.equal(metadata.platformCommit, frozenCommit); assert.equal(metadata.build.platformCommit, frozenCommit);
  assert.equal(metadata.build.sourceClean, true); assert.equal(metadata.build.builtAt, '2026-10-07T09:34:31.496Z');
  assert.ok(Date.parse(metadata.build.builtAt) < Date.parse(run.createdAt));
  assert.equal(manifest.platformCommit, frozenCommit); assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error);
  assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(existsSync(new URL('index.html', directory)), false); assert.equal(existsSync(new URL('index.html.txt', directory)), false);
  assert.equal(manifest.promptVersion, 'production-html-v8'); assert.equal(run.frozenContract!.version, 'production-acceptance-v3');
  assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v4'); assert.equal(manifest.jevPolicyVersion, 'jev-candidate-v3');
  assert.equal(run.validationContract!.planningLoopVersion, 'production-planning-loop-v1');
  assert.equal(run.validationContract!.reviewContextVersion, 'production-review-context-v1');
  assert.equal(run.validationContract!.semanticsVersion, 'production-acceptance-semantic-v2');
  assert.equal(run.validationContract!.harnessPromptTransportVersion, 'harness-literal-prompt-v1');
  assert.equal(run.validationContract!.harnessJsonOutputVersion, 'harness-json-output-v1');
  assert.deepEqual(manifest.validationContract, run.validationContract);
});

test('HTML-01 preserves thirteen legal role JSON records, six independent reviews, twenty intents and nineteen observed HTTP attempts', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  const schemas = { product: productSchema, researcher: researchSchema, 'project-manager': planSchema, tester: testsSchema, developer: codeSchema, verifier: verifierSchema };
  assert.equal(run.calls.length, 13); assert.equal(new Set(run.calls.map(call => call.role)).size, 6);
  assert.deepEqual(run.calls.map(call => call.phase), ['product', 'product:verify', 'research', 'research:verify', 'think-design', 'think-design:verify', 'acceptance', 'acceptance:verify', 'implement', 'implement:verify', 'feedback-0', 'feedback-0:verify', 'repair-1']);
  for (const call of run.calls) {
    schemas[call.role].parse(JSON.parse(call.rawOutput));
    assert.equal(call.executionSource, 'harness'); assert.equal(call.promptVersion, 'production-html-v8'); assert.equal(call.error, undefined);
    assert.equal(call.model.provider, 'deepseek'); assert.equal(call.model.modelId, 'deepseek-flash');
    assert.equal(JSON.parse(call.userPrompt).outputContract.version, 'production-output-contract-v1');
    assert.deepEqual(call.responseFormat, { version: 'harness-json-output-v1', mode: 'json-object', evidence: 'wire-observed' });
    assert.deepEqual(call.providerRequests!.responseFormat, call.responseFormat);
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.status, 200); assert.equal(call.providerRequests!.deniedRequests, 0);
    assert.equal(call.providerRequests!.transportComplete, true); assert.equal(call.providerRequests!.protocolComplete, true); assert.equal(call.providerRequests!.complete, true);
  }
  const sources = run.jevCalls!.slice(0, 6); const verifiers = run.calls.filter(call => call.role === 'verifier');
  assert.equal(verifiers.length, 6); assert.deepEqual(sources.map(call => call.evaluation.errorKind), ['arithmetic-drift', 'arithmetic-drift', 'arithmetic-drift', undefined, 'arithmetic-drift', 'arithmetic-drift']);
  assert.deepEqual(sources.map(call => call.evaluation.status), ['error', 'error', 'error', 'uncertain', 'error', 'error']);
  for (const source of sources) {
    const linked = verifiers.filter(call => call.sourceJevCallId === source.id); assert.equal(linked.length, 1);
    const call = linked[0]; const expectedEngine = source.evaluation.status === 'uncertain' ? 'jev-llm-fallback' : 'jev-llm-protocol-fallback';
    assert.equal(call.verificationEngine, expectedEngine);
    const decision = parseVerifiedDecision(JSON.parse(call.rawOutput), source.evaluation.requestSnapshot!.state.candidates.map(candidate => candidate.id));
    assert.equal(decision.decision, 'accept'); assert.equal(source.evaluation.selectedCandidateId, null);
    assert.equal(source.evaluation.providerRequests, 1); assert.equal(source.evaluation.usage.complete, true);
    assert.equal(run.verifications.find(review => review.sourceJevCallId === source.id && review.engine === expectedEngine)!.decision, 'accept');
    if (source.evaluation.status === 'error') { assert.deepEqual(source.evaluation.scores, []); assert.equal(source.evaluation.choice, null); }
  }
  const counts = projectProductionLedger(run).requests;
  assert.equal(counts.callRecords, 13); assert.equal(counts.budgetRecords, 20); assert.equal(counts.harnessInvocations, 13);
  assert.equal(counts.knownHarnessProviderRequests, 13); assert.equal(counts.jevProviderRequests, 6);
  assert.equal(counts.actualProviderRequests, 19); assert.equal(counts.unknownRequestIntents, 0);
  assert.equal(JSON.stringify(run), before, 'Historical projections and parsers do not mutate the run');
});

test('HTML-01 freezes the original tester checks before both developer requests and preserves their exact hash through repair', () => {
  const run = loadRun(); const frozen = run.frozenContract!;
  const tester = run.calls.find(call => call.role === 'tester')!;
  const tests = testsSchema.parse(JSON.parse(tester.rawOutput));
  assert.equal(preflightAcceptanceSemantics(tests.checks, { capability: run.input.capability, brief: run.input.brief, acceptance: run.input.requirement.acceptance }).valid, true);
  assert.equal(tests.checks.length, 4); assert.deepEqual(frozen.checks, tests.checks);
  assert.equal(tester.selected, true); assert.equal(run.calls.filter(call => call.role === 'tester').length, 1);
  assert.equal(frozen.hash, '555cb6dcd506cf17ecfe9f73e4e7ff581e4efed9ea628c81f02ad24aea8d48be');
  assert.equal(frozen.validationContractHash, '59be99387e63dcdc38e0dbccbdfea06199c8afb3bd892c03094f3188bec14822');
  assert.equal(frozen.validationContractHash, jsonHash(run.validationContract));
  assert.equal(frozen.requirementHash, jsonHash({ requirement: run.input.requirement, brief: run.input.brief }));
  assert.equal(frozen.hash, jsonHash({ validationContract: run.validationContract, requirement: run.input.requirement, brief: run.input.brief, checks: tests.checks }));
  assert.ok(Date.parse(tester.finishedAt!) < Date.parse(frozen.frozenAt));
  assert.ok(Date.parse(run.calls.find(call => call.phase === 'acceptance:verify')!.finishedAt!) < Date.parse(frozen.frozenAt));
  for (const developer of run.calls.filter(call => call.role === 'developer')) {
    assert.ok(Date.parse(frozen.frozenAt) < Date.parse(developer.startedAt));
    assert.deepEqual(JSON.parse(developer.userPrompt).context.frozenContract, frozen);
  }
  assert.equal(run.events.filter(event => event.phase === 'freeze').length, 1);
  const manifest = JSON.parse(read('delivery-manifest.json').toString('utf8'));
  assert.deepEqual(manifest.frozenContract, frozen);
});

test('HTML-01 legal frozen tests retain concrete business coverage gaps and selector/text mismatches, not a claim of successful behavior', () => {
  const run = loadRun(); const tests = testsSchema.parse(JSON.parse(run.calls.find(call => call.role === 'tester')!.rawOutput));
  const [initial, added, completed, removed] = tests.checks;
  assert.deepEqual(initial.steps, [{ action: 'assertCount', selector: '#todo-list li', count: 0 }, { action: 'assertTextExact', selector: '#total-count', text: '总数:0' }, { action: 'assertTextExact', selector: '#done-count', text: '已完成:0' }]);
  assert.ok(added.steps.some(step => step.action === 'assertCount' && step.selector === '#todo-list li' && step.count === 1));
  assert.ok(added.steps.some(step => step.action === 'assertValue' && step.selector === '#task-input' && step.value === ''));
  assert.ok(added.steps.some(step => step.action === 'assertTextExact' && step.selector === '#todo-list li.todo-text' && step.text === '准备发布'));
  assert.ok(completed.steps.some(step => step.action === 'assertTextExact' && step.selector === '#todo-list li' && step.text === '准备发布 ✓'));
  assert.equal(completed.steps.some(step => step.action === 'assertTextExact' && step.selector === '#total-count' && step.text === '总数:1'), false, 'Completion does not independently check that total stays one');
  const completedClick = completed.steps.findIndex(step => step.action === 'click' && step.selector === '#todo-list li .toggle-btn');
  assert.equal(completed.steps.slice(completedClick + 1).some(step => step.action === 'assertCount' && step.selector === '#todo-list li' && step.count === 1), false, 'List count one is asserted before completion, not after it');
  assert.ok(removed.steps.some(step => step.action === 'assertCount' && step.selector === '#todo-list li' && step.count === 0));
  assert.ok(removed.steps.some(step => step.action === 'assertTextExact' && step.selector === '#done-count' && step.text === '已完成:0'));
  assert.equal(tests.checks.flatMap(check => check.steps).some(step => String(step.action) === 'reload'), false, 'No same-page refresh/reset execution was recorded');
  const developers = run.calls.filter(call => call.role === 'developer');
  for (const call of developers) {
    const html = codeSchema.parse(JSON.parse(call.rawOutput)).html;
    assert.match(html, /<form[^>]*id="composer"/); assert.match(html, /id="add-btn" type="submit"/);
    assert.match(html, /form\.addEventListener\("submit"/);
    assert.match(html, /textSpan\.className = "todo-text"/);
    assert.match(html, /toggleBtn\.textContent = task\.completed \? "取消完成" : "完成"/);
    assert.match(html, /deleteBtn\.textContent = "删除"/);
    assert.match(html, /li\.appendChild\(textSpan\);\s*li\.appendChild\(toggleBtn\);\s*li\.appendChild\(deleteBtn\)/);
    // Static source facts: li.todo-text is not the generated span.todo-text;
    // li also contains visible control labels, unlike its frozen exact text.
    // This does NOT execute HTML or infer that a repaired page was tested.
  }
  const first = codeSchema.parse(JSON.parse(developers[0].rawOutput)).html;
  const repaired = codeSchema.parse(JSON.parse(developers[1].rawOutput)).html;
  assert.equal(first.includes('li.classList.add("todo-text")'), false);
  assert.match(repaired, /if \(task\.completed\) \{\s*li\.classList\.add\("todo-text"\);\s*\}/, 'Repair only sets the li class when complete, not in the add-state assertion');
});

test('HTML-01 retains the failed first Gate and one genuine developer repair without modifying tests or claiming a second Gate', () => {
  const run = loadRun(); const initial = run.calls.find(call => call.phase === 'implement')!; const repaired = run.calls.find(call => call.phase === 'repair-1')!;
  assert.equal(run.gateHistory.length, 1); assert.deepEqual(run.gateHistory[0], run.gate); assert.equal(run.gate!.passed, false);
  assert.equal(run.gate!.failureKind, undefined); assert.deepEqual(run.gate!.checks.map(check => check.passed), [true, true, false, false, false]);
  assert.equal(run.gate!.checks[2].detail, '#todo-list li 元素数量不等于 1'); assert.equal(run.gate!.checks[3].detail, '#todo-list li 元素数量不等于 1');
  assert.match(run.gate!.checks[4].detail!, /waiting for locator\('#todo-list li \.toggle-btn'\)/);
  assert.equal(planSchema.parse(JSON.parse(run.calls.find(call => call.phase === 'feedback-0')!.rawOutput)).decision, 'revise');
  assert.equal(run.repairs, 1); assert.equal(run.repairPolicyVersion, 'production-global-repair-v1'); assert.equal(run.repairHistory!.length, 1);
  const history = run.repairHistory![0]; assert.equal(history.kind, 'gate-repair'); assert.equal(history.role, 'developer'); assert.equal(history.attempt, 1);
  assert.equal(history.phase, 'repair-1'); assert.equal(history.frozenHash, run.frozenContract!.hash); assert.deepEqual(history.rejectedCandidateIds, [initial.candidateId]);
  const context = JSON.parse(repaired.userPrompt).context;
  assert.deepEqual(context.feedback.failedGate, run.gate); assert.equal(context.feedback.previousHtml, JSON.parse(initial.rawOutput).html);
  assert.deepEqual(context.feedback.decision, JSON.parse(run.calls.find(call => call.phase === 'feedback-0')!.rawOutput));
  assert.equal(context.remainingRepairs, 1); assert.equal(context.repairBudget.used, 1);
  assert.equal(digest(JSON.parse(initial.rawOutput).html), '2236075d1145a21b45a5c206663ea729431319d3271e9ec925c9f361dc8a6a5d');
  assert.equal(digest(JSON.parse(repaired.rawOutput).html), 'a5ebe74bf855f4bed7865fd9c50cc9a54413955860789f85e9393f78353e82c4');
  assert.notEqual(repaired.rawOutput, initial.rawOutput); assert.notEqual(repaired.selected, true);
  assert.equal(run.outputs.some(output => output.phase === 'repair-1'), false);
  assert.equal(run.events.filter(event => event.phase === 'test').length, 1);
  assert.equal(run.calls.some(call => call.phase === 'repair-1:verify' || call.phase === 'feedback-1'), false);
});

test('HTML-01 full repair evidence exceeds the single-question capacity cap and stops before any Jev POST, fallback or second Gate', () => {
  const run = loadRun(); const entry = run.jevCalls!.at(-1)!; const evaluation = entry.evaluation; const request = evaluation.requestSnapshot!;
  const repaired = run.calls.at(-1)!;
  assert.equal(run.jevCalls!.length, 7); assert.equal(entry.phase, 'repair-1');
  assert.equal(evaluation.policyVersion, 'jev-candidate-v3'); assert.equal(evaluation.errorKind, 'fatal'); assert.equal(evaluation.status, 'error');
  assert.match(evaluation.error!, /context byte limits; evidence was not truncated/);
  assert.equal(evaluation.selectedCandidateId, null); assert.deepEqual(evaluation.scores, []); assert.equal(evaluation.choice, null);
  assert.equal(evaluation.providerRequests, 0); assert.equal(evaluation.httpStatus, null); assert.equal(evaluation.modelIdReturned, null); assert.equal(evaluation.rawResponse, null);
  assert.deepEqual(evaluation.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  assert.equal(request.state.requestLayoutVersion, 'jev-request-layout-v2');
  assert.deepEqual(request.state.candidates, [{ id: repaired.candidateId, value: JSON.parse(repaired.rawOutput) }], 'Whole current candidate is retained');
  const reviewContext = request.state.reviewContext as Record<string, unknown>;
  assert.deepEqual(reviewContext.feedback, JSON.parse(repaired.userPrompt).context.feedback);
  assert.deepEqual(reviewContext.frozenContract, run.frozenContract);
  assert.equal(bytes(request), 36452); assert.ok(bytes(request) < 64000);
  assert.equal(bytes(request.state), 33420);
  const maximumQuestion = Math.max(...Object.values(request.questions).map(question => bytes(question)));
  assert.equal(maximumQuestion, 647); assert.equal(bytes(request.state) + maximumQuestion, 34067); assert.ok(bytes(request.state) + maximumQuestion > 32000);
  assert.equal(bytes(reviewContext), 22513); assert.equal(bytes(reviewContext.feedback), 9688);
  assert.equal(bytes((reviewContext.feedback as { previousHtml: string }).previousHtml), 7190);
  assert.equal(run.calls.some(call => call.sourceJevCallId === entry.id), false, 'Fatal capacity failure is not an uncertain/arithmetic fallback');
  assert.match(run.error!, /用量未知或非法/); assert.equal(run.gateHistory.length, 1);
});

test('HTML-01 unknown aggregate stays unknown while all nineteen reported entries subtotal 87975/10098 tokens and $0.028835172', () => {
  const run = loadRun(); const before = JSON.stringify(run);
  assert.deepEqual(run.usage, { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false });
  const usage = projectProductionLedger(run).usage;
  assert.equal(usage.entries, 20); assert.equal(usage.unknownUsageEntries, 1); assert.equal(usage.currencyMismatchEntries, 0);
  assert.deepEqual(usage.inputTokens, { knownSubtotal: 87975, reportedEntries: 19, unknownEntries: 1, overflow: false });
  assert.deepEqual(usage.outputTokens, { knownSubtotal: 10098, reportedEntries: 19, unknownEntries: 1, overflow: false });
  assert.equal(usage.estimatedCost.reportedEntries, 19); assert.equal(usage.estimatedCost.unknownEntries, 1); near(usage.estimatedCost.knownSubtotal!, 0.028835172);
  near(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0), 0.0274485);
  near(run.jevCalls!.slice(0, -1).reduce((sum, call) => sum + call.evaluation.usage.estimatedCost!, 0), 0.001386672);
  for (const call of run.calls) near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.30 + call.usage.outputTokens! * 1.20) / 1e6);
  for (const call of run.jevCalls!.slice(0, -1)) near(call.evaluation.usage.estimatedCost!, call.evaluation.usage.inputTokens! * 0.042 / 1e6);
  assert.deepEqual(JSON.parse(read('delivery-manifest.json').toString('utf8')).usage, run.usage);
  assert.equal(JSON.stringify(run), before, 'Known subtotal neither backfills an unknown total nor certifies an invoice');
});
