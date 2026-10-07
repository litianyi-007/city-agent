import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parseJson, parseVerifiedDecision, productSchema, researchSchema } from '../server/production/contracts.js';
import { projectProductionLedger } from '../shared/production-ledger.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Receipt-only regression: original responses are inert data, not a new model
// experiment. No SDK, provider transport, browser or generated code executes.
const directory = new URL('../docs/production/experiments/HTML-02/', import.meta.url);
const runId = '850135e8-7993-424d-8ee2-ee384a7c32fd';
const sourceCommit = 'b6413d472ec25484a36101caff59b00cca5580d3';
const fileHashes = {
  'run.json': 'c67b9ab2b8d0046f6573e541a5f828a16b110bba65c4f4ac9734dbe160bc491c',
  'evidence.json': '390efb68be240ee5420b5cdc197e43afcbef0bf5b3ce6d15c3278a83f34c6cf4',
  'delivery-manifest.json': '9d34160e55da60714f741a9298e298f52f8963f4951d397fdb6a010c4a6984b1',
  'platform-metadata.json': 'edaf5ff7875cdf5217b02216ddd6b90cc49d523890f7363f8b4e24d3fed779cb',
} as const;
const read = (name: keyof typeof fileHashes) => readFileSync(new URL(name, directory));
const json = (name: keyof typeof fileHashes) => JSON.parse(read(name).toString('utf8'));
const load = (): ProductionRun => json('run.json');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => sha(JSON.stringify(value));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
const researchPins = [
  { sha256: '5e8ab59a5e058012e4efb2b45d446d84e771febdaa0c4512e681ee38b0764eca', extraQuotes: [1816, 2695], counts: [12, 11, 6] },
  { sha256: '00419029a489d4b544afd9f592aefb5e86f62d1e9bf3414b2b89b7aac0b490e0', extraQuotes: [1843, 2692], counts: [13, 12, 3] },
  { sha256: '7c00d84f20148a4bdb8f0b0ff165e22553a50cf3271df6307e49a73331f59ddd', extraQuotes: [1891, 2709], counts: [12, 9, 3] },
] as const;

test('HTML-02 preserves four original failed receipts and its independent illustrative, one-dollar attempt', () => {
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(sha(read(name as keyof typeof fileHashes)), expected, name);
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.deepEqual(json('evidence.json'), run);
  assert.equal(run.id, runId); assert.equal(run.status, 'failed'); assert.equal(run.durationMs, 36766);
  assert.equal(run.platformCommit, sourceCommit); assert.equal(run.evidenceKind, 'real-model');
  assert.equal(run.input.mode, 'live'); assert.equal(run.input.capability, 'offline-single-html');
  assert.equal(run.input.requirement.id, 'HTML-02'); assert.equal(run.input.requirement.kind, 'illustrative');
  assert.equal(run.input.candidateCount, 1); assert.equal(run.input.budgetAuthorized, true);
  assert.equal(Object.hasOwn(run.input, 'demoCaseId'), false); assert.equal(Object.hasOwn(run.input, 'cameraBusinessConstraints'), false);
  assert.deepEqual(run.input.limits, { maxCalls: 30, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 1, currency: 'USD' });
  assert.deepEqual(run.interventions, []);
  assert.equal(manifest.runId, runId); assert.equal(manifest.platformCommit, sourceCommit);
  assert.equal(manifest.status, 'failed'); assert.equal(manifest.failure, run.error);
  assert.match(run.error!, /全局自动返修次数耗尽（2\/2）/);
  assert.notEqual(sourceCommit, '967bbba15c92dc07cf40fd2b2f5affebf1493b12', 'This source is not the old v5 publication or HTML01 configuration');
});

test('HTML-02 binds startup metadata, source/build fingerprints and clean boot identity without relabeling historical evidence', () => {
  const run = load(); const metadata = json('platform-metadata.json'); const manifest = json('delivery-manifest.json');
  const identity = run.executionIdentity!;
  assert.deepEqual(metadata.executionIdentity, identity); assert.deepEqual(manifest.executionIdentity, identity);
  assert.equal(identity.version, 'production-boot-disk-v1'); assert.equal(identity.bootId, 'f8e6dd51-8943-4db4-83cd-c6ae616f2973');
  assert.equal(identity.commit, sourceCommit); assert.equal(identity.sourceClean, true); assert.equal(identity.ready, true); assert.deepEqual(identity.issues, []);
  assert.equal(metadata.platformCommit, sourceCommit); assert.deepEqual(metadata.build, identity.buildSnapshot);
  assert.deepEqual(identity.buildSnapshot, { platformCommit: sourceCommit, sourceClean: true, builtAt: '2026-10-07T10:35:42.972Z' });
  assert.equal(identity.startedAt, '2026-10-07T10:36:20.245Z');
  assert.ok(Date.parse(identity.buildSnapshot!.builtAt) < Date.parse(identity.startedAt));
  assert.ok(Date.parse(identity.startedAt) < Date.parse(run.createdAt));
  assert.equal(identity.sourceFiles.length, 81); assert.equal(identity.buildFiles.length, 10);
  assert.equal(identity.sourceFingerprint, '49ff55437abf51222d06a139711dbcd844e20a8da5c6a92667d2a4ae37dc6ce0');
  assert.equal(identity.sourceFingerprint, jsonHash(identity.sourceFiles));
  assert.equal(identity.buildFingerprint, 'd22970c1b1e04b8bb8c4256b7279ea0cc2161ed1c9bcfb6d1317fc1f6df940f5');
  assert.equal(identity.buildFingerprint, jsonHash({ buildSnapshot: identity.buildSnapshot, files: identity.buildFiles }));
  assert.match(identity.limitation, /not proof of already-loaded TS module bytes/);
  assert.equal(run.validationContract!.reviewContextVersion, 'production-review-context-v2');
  assert.equal(run.validationContract!.htmlExecutionProfileVersion, 'production-html-execution-v1');
  assert.equal(run.validationContract!.harnessJsonOutputVersion, 'harness-json-output-v1');
  assert.equal(run.validationContract!.harnessPromptTransportVersion, 'harness-literal-prompt-v1');
  assert.equal(run.validationContract!.planningLoopVersion, 'production-planning-loop-v1');
  assert.equal(run.validationContract!.semanticsVersion, 'production-acceptance-semantic-v2');
  assert.deepEqual(manifest.validationContract, run.validationContract); assert.equal(manifest.validationContractHash, jsonHash(run.validationContract));
  assert.equal(manifest.promptVersion, 'production-html-v9'); assert.equal(manifest.verifierVersion, 'verifier-phase-ordinal-v4');
  assert.equal(manifest.jevPolicyVersion, 'jev-candidate-v3'); assert.equal(manifest.repairPolicyVersion, 'production-global-repair-v1');
});

test('all three original research candidates fail JSON parsing at extra quotes after array terminators despite native JSON request metadata', () => {
  const run = load(); const candidates = run.calls.filter(call => call.role === 'researcher');
  assert.equal(candidates.length, 3);
  for (const [index, call] of candidates.entries()) {
    const pin = researchPins[index];
    assert.equal(sha(call.rawOutput), pin.sha256); assert.ok(call.rawOutput.startsWith('{')); assert.ok(call.rawOutput.endsWith('}'));
    assert.throws(() => parseJson(call.rawOutput), error => error instanceof SyntaxError && error.message.includes(`position ${pin.extraQuotes[0]}`));
    assert.match(call.error!, new RegExp(`position ${pin.extraQuotes[0]}`)); assert.notEqual(call.selected, true);
    const markers = [...call.rawOutput.matchAll(/\]","(constraints|unknowns)":\[/g)];
    assert.deepEqual(markers.map(marker => marker.index! + 1), [...pin.extraQuotes]);
    assert.deepEqual(markers.map(marker => marker[1]), ['constraints', 'unknowns']);
    const contract = JSON.parse(call.userPrompt).outputContract;
    assert.equal(contract.version, 'production-output-contract-v1');
    assert.equal(contract.jsonSchema.properties.observations.maxItems, 12);
    assert.equal(contract.jsonSchema.additionalProperties, false);
    assert.equal(call.promptVersion, 'production-html-v9');
    assert.deepEqual(call.responseFormat, { version: 'harness-json-output-v1', mode: 'json-object', evidence: 'wire-observed' });
    assert.equal(call.providerRequests!.protocolComplete, true); assert.equal(call.providerRequests!.httpEof, false);
    // Observed request mode / protocol completion do not certify valid response
    // JSON. They do not by themselves establish provider fault or truncation.
  }
});

test('a strictly in-memory delimiter diagnosis reveals a separate 13-observation violation without accepting or rewriting the raw candidates', () => {
  const run = load(); const before = JSON.stringify(run);
  for (const [index, call] of run.calls.filter(call => call.role === 'researcher').entries()) {
    // This is a counterfactual static diagnostic, NOT a platform repair,
    // fallback or new output. Only the original malformed bytes are evidence.
    const diagnostic = JSON.parse(call.rawOutput.replace(/\]","(constraints|unknowns)":\[/g, '],"$1":['));
    assert.deepEqual([diagnostic.observations.length, diagnostic.constraints.length, diagnostic.unknowns.length], [...researchPins[index].counts]);
    const result = researchSchema.safeParse(diagnostic);
    assert.equal(result.success, index !== 1);
    if (!result.success) assert.ok(result.error.issues.some(issue => issue.code === 'too_big' && issue.path.join('.') === 'observations' && issue.maximum === 12));
    assert.throws(() => JSON.parse(call.rawOutput), SyntaxError);
    assert.equal(sha(call.rawOutput), researchPins[index].sha256); assert.notEqual(call.selected, true);
  }
  assert.equal(JSON.stringify(run), before); assert.equal(run.outputs.some(output => output.role === 'researcher'), false);
});

test('research regenerations use the original role and the shared two-repair pool, then stop without a third repair or any research evaluator', () => {
  const run = load(); const candidates = run.calls.filter(call => call.role === 'researcher');
  assert.equal(run.repairs, 2); assert.equal(run.repairHistory!.length, 2);
  for (const [index, repair] of run.repairHistory!.entries()) {
    assert.equal(repair.kind, 'stage-regeneration'); assert.equal(repair.role, 'researcher'); assert.equal(repair.phase, 'research');
    assert.equal(repair.attempt, index + 1); assert.equal(repair.frozenHash, null);
    assert.deepEqual(repair.rejectedCandidateIds, [candidates[index].candidateId]);
  }
  for (const [index, call] of candidates.entries()) {
    const context = JSON.parse(call.userPrompt).context;
    assert.equal(context.remainingRepairs, 2 - index);
    assert.deepEqual(context.repairBudget, { policyVersion: 'production-global-repair-v1', used: index, remaining: 2 - index, limit: 2 });
    if (index === 0) assert.equal(context.regeneration, undefined);
    else {
      const previous = candidates[index - 1]; const feedback = context.regeneration;
      assert.equal(feedback.attempt, index); assert.equal(feedback.frozenHash, null);
      assert.deepEqual(feedback.rejectedCandidateIds, [previous.candidateId]);
      assert.equal(feedback.rejectedCandidates[0].callId, previous.id);
      assert.equal(feedback.rejectedCandidates[0].rawOutputSha256, sha(previous.rawOutput));
      assert.equal(feedback.rejectedCandidates[0].rawOutputExcerpt, previous.rawOutput.slice(0, 2000));
      assert.equal(feedback.rejectedCandidates[0].rawOutputTruncated, true, 'Only feedback excerpts are bounded; complete failed output remains in the call ledger');
    }
  }
  const rejected = run.verifications.filter(review => review.phase === 'research');
  assert.equal(rejected.length, 3);
  for (const review of rejected) { assert.deepEqual(review.candidateIds, []); assert.equal(review.selectedCandidateId, null); assert.equal(review.decision, 'abstain'); assert.deepEqual(review.scores, []); assert.equal(review.engine, undefined); }
  assert.equal(run.jevCalls!.some(call => call.phase === 'research'), false);
  assert.equal(run.calls.some(call => call.phase === 'research:verify'), false);
  assert.equal(run.events.filter(event => event.phase === 'stage-regeneration').length, 2);
});

test('only product reaches an independent LLM review after its one discarded Jev arithmetic response; no downstream Gate or source exists', () => {
  const run = load(); const manifest = json('delivery-manifest.json');
  assert.deepEqual(run.calls.map(call => call.phase), ['product', 'product:verify', 'research', 'research', 'research']);
  assert.deepEqual(run.outputs.map(output => output.phase), ['product']);
  const product = run.calls[0]; const verifier = run.calls[1];
  productSchema.parse(JSON.parse(product.rawOutput));
  const decision = parseVerifiedDecision(JSON.parse(verifier.rawOutput), [product.candidateId]);
  assert.equal(decision.decision, 'accept'); assert.equal(product.selected, true);
  assert.equal(run.jevCalls!.length, 1); const source = run.jevCalls![0];
  assert.equal(source.phase, 'product'); assert.equal(source.evaluation.status, 'error'); assert.equal(source.evaluation.errorKind, 'arithmetic-drift');
  assert.equal(source.evaluation.selectedCandidateId, null); assert.deepEqual(source.evaluation.scores, []); assert.equal(source.evaluation.choice, null);
  assert.equal(verifier.verificationEngine, 'jev-llm-protocol-fallback'); assert.equal(verifier.sourceJevCallId, source.id);
  assert.equal(run.calls.filter(call => call.role === 'verifier').length, 1);
  assert.equal(Object.hasOwn(run, 'frozenContract'), false); assert.equal(Object.hasOwn(run, 'gate'), false); assert.deepEqual(run.gateHistory, []);
  assert.equal(run.events.some(event => ['freeze', 'test', 'delivery'].includes(event.phase)), false);
  assert.equal(Object.hasOwn(manifest, 'frozenContract'), false); assert.equal(manifest.source, null); assert.equal(manifest.sourceSha256, null);
  assert.deepEqual(run.artifacts.map(artifact => artifact.name), ['delivery-manifest.json', 'evidence.json']);
  assert.equal(existsSync(new URL('index.html', directory)), false); assert.equal(existsSync(new URL('index.html.txt', directory)), false);
  assert.equal(existsSync(new URL('scene.json', directory)), false);
});

test('HTML-02 reports six actual HTTP attempts and complete nonzero usage, without converting absent stages into unknown calls or zero-filled costs', () => {
  const run = load(); const before = JSON.stringify(run); const ledger = projectProductionLedger(run);
  assert.deepEqual(run.usage, { inputTokens: 19546, outputTokens: 5448, estimatedCost: 0.01130511, currency: 'USD', complete: true });
  assert.equal(ledger.requests.callRecords, 5); assert.equal(ledger.requests.budgetRecords, 6);
  assert.equal(ledger.requests.harnessInvocations, 5); assert.equal(ledger.requests.knownHarnessProviderRequests, 5);
  assert.equal(ledger.requests.jevProviderRequests, 1); assert.equal(ledger.requests.actualProviderRequests, 6); assert.equal(ledger.requests.unknownRequestIntents, 0);
  assert.equal(ledger.usage.entries, 6); assert.equal(ledger.usage.unknownUsageEntries, 0);
  assert.deepEqual(ledger.usage.inputTokens, { knownSubtotal: 19546, reportedEntries: 6, unknownEntries: 0, overflow: false });
  assert.deepEqual(ledger.usage.outputTokens, { knownSubtotal: 5448, reportedEntries: 6, unknownEntries: 0, overflow: false });
  near(ledger.usage.estimatedCost.knownSubtotal!, 0.01130511);
  for (const call of run.calls) {
    assert.equal(call.executionSource, 'harness'); assert.equal(call.model.modelId, 'deepseek-flash');
    assert.equal(call.providerRequests!.requests, 1); assert.equal(call.providerRequests!.deniedRequests, 0); assert.equal(call.providerRequests!.status, 200);
    assert.equal(call.providerRequests!.complete, true); assert.equal(call.providerRequests!.inputReported, true); assert.equal(call.providerRequests!.outputReported, true);
    assert.deepEqual(call.providerRequests!.responseFormat, call.responseFormat);
    near(call.usage.estimatedCost!, (call.usage.inputTokens! * 0.30 + call.usage.outputTokens! * 1.20) / 1e6);
  }
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.inputTokens!, 0), 16041);
  assert.equal(run.calls.reduce((sum, call) => sum + call.usage.outputTokens!, 0), 5288);
  near(run.calls.reduce((sum, call) => sum + call.usage.estimatedCost!, 0), 0.0111579);
  const evaluation = run.jevCalls![0].evaluation;
  assert.equal(evaluation.providerRequests, 1); assert.equal(evaluation.httpStatus, 200); assert.equal(evaluation.usage.complete, true);
  assert.equal(evaluation.usage.inputTokens, 3505); assert.equal(evaluation.usage.outputTokens, 160);
  near(evaluation.usage.estimatedCost!, 0.00014721);
  assert.deepEqual(json('delivery-manifest.json').usage, run.usage);
  assert.equal(JSON.stringify(run), before);
  for (const [name, expected] of Object.entries(fileHashes)) assert.equal(sha(read(name as keyof typeof fileHashes)), expected, `${name}: unchanged after analysis`);
});
