import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { IMPLEMENTATION_EVIDENCE_PROTOCOL_LITERALS, IMPLEMENTATION_EVIDENCE_VERSION, ImplementationEvidenceError, assertImplementationEvidencePolicy, assertImplementationEvidenceScores, buildImplementationEvidenceContract, isImplementationBusinessAssertion, validateImplementationEvidence, type ImplementationEvidence, type ImplementationEvidenceContract, type ImplementationEvidenceInput } from '../shared/production-implementation-evidence.js';
import { productionApiKeySchema, productionRunInputSchema } from '../shared/production-schema.js';
import { implementationEvidenceVerifierSchema, outputContractSnapshot, verifierSchema } from '../server/production/contracts.js';
import { parseImplementationEvidenceDecisionText } from '../server/production/implementation-evidence.js';
import { VerifierDecisionError, parseVerifierDecisionText } from '../server/production/verifier-diagnostics.js';
import { implementationEvidenceVerifierSystemPrompt, phaseVerifierSystemPrompt, productionPhaseRubric } from '../shared/production-verifier-rubric.js';

const anchor = `result.textContent='完成';`;
const source = (count = 1): ImplementationEvidenceInput => ({
  brief: '点击动作后显示完成，不改变原始要求。', acceptance: '返回完成状态，并验证实际业务结果。', productAcceptance: ['点击后精确显示完成'], frozenHash: 'a'.repeat(64),
  checks: [
    { name: '结果', steps: [{ action: 'click', selector: '#act' }, { action: 'assertTextExact', selector: '#result', text: '完成' }] },
    { name: '独立结果', steps: [{ action: 'fill', selector: '#input', value: 'x' }, { action: 'click', selector: '#act' }, { action: 'assertTextExact', selector: '#result', text: '完成' }] },
  ],
  candidates: Array.from({ length: count }, (_, index) => ({ id: `candidate-${index + 1}`, value: { html: `<!doctype html><html><body><script>const result={};${anchor}// unique candidate ${index}\n</script></body></html>` } })),
});
export function evidenceFor(contract: ImplementationEvidenceContract, exactAnchor = anchor, checkIndex = 0, stepIndex = 1): ImplementationEvidence {
  return { version: IMPLEMENTATION_EVIDENCE_VERSION, contractSha256: contract.contractSha256,
    candidates: contract.candidates.map(candidate => ({ ...candidate, clauses: contract.clauses.map(clause => ({ clauseId: clause.id, status: 'supported', implementationRefs: [{ pointer: '/html', exactAnchor }], boundaryRefs: [{ checkIndex, stepIndex }] })) })) };
}
const decisionFor = (evidence: ImplementationEvidence) => ({ decision: 'accept' as const, selectedCandidateId: evidence.candidates[0].candidateId, scores: evidence.candidates.map(candidate => ({ candidateId: candidate.candidateId, score: 4, reason: '静态引用核验，不是执行通过。' })), reason: '最终Gate仍需执行。', implementationEvidence: evidence });
const code = (expected: string) => (error: unknown) => error instanceof ImplementationEvidenceError && error.diagnostic.code === expected && !('cause' in error);

test('policy defaults to legacy and rejects incompatible modes before any evaluator', () => {
  const input = { brief: 'Build result', agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: 'free', source: 'free engineering', acceptance: 'Show exact output' } };
  assert.equal(productionRunInputSchema.parse(input).implementationEvidencePolicy, 'legacy');
  const strict = { ...input, mode: 'live', implementationEvidencePolicy: 'source-bound-v1' };
  assert.equal(productionRunInputSchema.parse(strict).verifierEngine, 'llm-rubric');
  for (const change of [{ mode: 'demo' }, { mode: 'mock-jev' }, { capability: 'camera-scene-v1' }, { verifierEngine: 'jev-cascade' }]) assert.equal(productionRunInputSchema.safeParse({ ...strict, ...change }).success, false);
  assert.doesNotThrow(() => assertImplementationEvidencePolicy({ mode: 'demo', verifierEngine: 'jev-cascade' }));
  assert.throws(() => assertImplementationEvidencePolicy({ mode: 'live', verifierEngine: 'jev-cascade', implementationEvidencePolicy: 'source-bound-v1' }), code('evidence-input-invalid'));
});

test('pure browser-compatible builder freezes original texts, product clauses, exact checks and current candidate bytes', async () => {
  const input = source(2); const before = structuredClone(input); const contract = await buildImplementationEvidenceContract(input);
  assert.deepEqual(contract, await buildImplementationEvidenceContract(input)); assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.clauses)); assert.ok(Object.isFrozen(contract.candidates[0]));
  assert.deepEqual(contract.clauses.map(clause => clause.id), ['original-brief', 'original-acceptance', 'product-acceptance-1']);
  assert.equal(contract.candidates[0].candidateValueSha256, createHash('sha256').update(JSON.stringify(input.candidates[0].value)).digest('hex'));
  assert.equal(contract.checksSha256, createHash('sha256').update(JSON.stringify(input.checks)).digest('hex'));
  assert.equal(JSON.stringify(contract).includes(input.brief), false, 'manifest references do not duplicate or summarize original text');
  assert.equal((await validateImplementationEvidence(evidenceFor(contract), contract, input)).candidates.length, 2);
});

test('new strict schema and prompt are separate; legacy decisions and all non-implementation prompts remain unchanged', async () => {
  const input = source(); const contract = await buildImplementationEvidenceContract(input); const result = decisionFor(evidenceFor(contract));
  assert.equal(verifierSchema.safeParse(result).success, false); assert.equal(implementationEvidenceVerifierSchema.safeParse(result).success, true);
  const { implementationEvidence: _evidence, ...legacy } = result;
  assert.deepEqual(parseVerifierDecisionText(JSON.stringify(legacy), ['candidate-1']), legacy);
  assert.deepEqual(await parseImplementationEvidenceDecisionText(JSON.stringify(result), contract, input), result);
  const rubric = productionPhaseRubric('implement')!; const oldPrompt = phaseVerifierSystemPrompt(rubric);
  assert.equal(oldPrompt.includes('implementationEvidence'), false);
  const prompt = implementationEvidenceVerifierSystemPrompt(rubric); assert.match(prompt, /不自行计算hash/); assert.match(prompt, /8\.\.160字符/); assert.match(prompt, /宿主只核验身份/);
  for (const phase of ['product', 'research', 'think-design', 'acceptance', 'feedback-0']) assert.throws(() => implementationEvidenceVerifierSystemPrompt(productionPhaseRubric(phase)!));
  assert.throws(() => implementationEvidenceVerifierSystemPrompt(productionPhaseRubric('implement', 'camera-scene-v1')!));
  for (const phase of ['implement', 'repair-0', 'repair-1', 'repair-2']) assert.match(implementationEvidenceVerifierSystemPrompt(productionPhaseRubric(phase)!), /implementation-evidence-verifier-v1/);
  assert.ok(Buffer.byteLength(JSON.stringify(outputContractSnapshot(implementationEvidenceVerifierSchema))) < 32000);
});

for (const target of ['brief', 'acceptance', 'productAcceptance', 'frozenHash', 'checks', 'candidates'] as const) {
  test(`changed ${target} cannot reuse a previously frozen evidence contract`, async () => {
    const input = source(); const contract = await buildImplementationEvidenceContract(input); const changed = structuredClone(input);
    if (target === 'brief' || target === 'acceptance') changed[target] += ' Changed';
    else if (target === 'frozenHash') changed.frozenHash = 'b'.repeat(64);
    else if (target === 'productAcceptance') changed.productAcceptance[0] += ' Changed';
    else if (target === 'checks') changed.checks[0].steps[1].text = 'Changed';
    else changed.candidates[0].value.html += ' Changed';
    await assert.rejects(validateImplementationEvidence(evidenceFor(contract), contract, changed), code('evidence-contract-mismatch'));
  });
}

test('candidate and clause sets must match completely, uniquely and with exact current hashes', async () => {
  const input = source(2); const contract = await buildImplementationEvidenceContract(input);
  for (const mutate of [
    (proof: ImplementationEvidence) => { proof.candidates.pop(); },
    (proof: ImplementationEvidence) => { proof.candidates[1].candidateId = proof.candidates[0].candidateId; },
    (proof: ImplementationEvidence) => { proof.candidates[1].candidateId = 'foreign'; },
  ]) { const proof = evidenceFor(contract); mutate(proof); await assert.rejects(validateImplementationEvidence(proof, contract, input), code('evidence-candidate-coverage')); }
  const wrongHash = evidenceFor(contract); wrongHash.candidates[0].candidateValueSha256 = '0'.repeat(64);
  await assert.rejects(validateImplementationEvidence(wrongHash, contract, input), code('evidence-candidate-binding'));
  const duplicate = evidenceFor(contract); duplicate.candidates[0].clauses[1].clauseId = duplicate.candidates[0].clauses[0].clauseId;
  await assert.rejects(validateImplementationEvidence(duplicate, contract, input), code('evidence-clause-coverage'));
  const missing = evidenceFor(contract); missing.candidates[0].clauses.pop();
  await assert.rejects(validateImplementationEvidence(missing, contract, input), code('evidence-response-structure'));
});

test('short exact anchors reject absent/ambiguous text and unauthorized pointers, without copying it into diagnostics', async () => {
  const input = source(); const contract = await buildImplementationEvidenceContract(input);
  const bad = evidenceFor(contract); bad.candidates[0].clauses[0].implementationRefs[0].exactAnchor = 'untrusted-provider-secret-path';
  await assert.rejects(validateImplementationEvidence(bad, contract, input), error => { assert.ok(code('evidence-anchor-mismatch')(error)); assert.equal(JSON.stringify(error).includes('untrusted-provider'), false); return true; });
  const ambiguous = source(); ambiguous.candidates[0].value.html += anchor; const other = await buildImplementationEvidenceContract(ambiguous);
  await assert.rejects(validateImplementationEvidence(evidenceFor(other), other, ambiguous), code('evidence-anchor-mismatch'));
  const pointer = evidenceFor(contract) as any; pointer.candidates[0].clauses[0].implementationRefs[0].pointer = '/../../private';
  await assert.rejects(validateImplementationEvidence(pointer, contract, input), code('evidence-response-structure'));
  const none = evidenceFor(contract); none.candidates[0].clauses[0].implementationRefs = [];
  await assert.rejects(validateImplementationEvidence(none, contract, input), code('evidence-required-missing'));
});

test('boundary refs must address frozen independent exact/count/changed assertions, not input echo or mere visibility', async () => {
  const input = source(); const contract = await buildImplementationEvidenceContract(input);
  for (const [checkIndex, stepIndex] of [[11, 1], [0, 0], [0, 19], [1, 0]]) await assert.rejects(validateImplementationEvidence(evidenceFor(contract, anchor, checkIndex, stepIndex), contract, input), code('evidence-boundary-mismatch'));
  assert.equal(isImplementationBusinessAssertion({ name: 'input echo', steps: [{ action: 'fill', selector: '#x', value: 'x' }, { action: 'assertTextExact', selector: '#x', text: 'x' }] }, 1), false);
  assert.equal(isImplementationBusinessAssertion({ name: 'value echo', steps: [{ action: 'click', selector: '#x' }, { action: 'assertValue', selector: '#input', value: 'x' }] }, 1), false);
  assert.equal(isImplementationBusinessAssertion({ name: 'visible', steps: [{ action: 'click', selector: '#x' }, { action: 'assertVisible', selector: '#result' }] }, 1), false);
  assert.equal(isImplementationBusinessAssertion({ name: 'change', steps: [{ action: 'assertChanged', selector: '#result', after: { action: 'click', selector: '#update' } }] }, 0), true);
  assert.equal(isImplementationBusinessAssertion({ name: 'fill change', steps: [{ action: 'assertChanged', selector: '#result', after: { action: 'fill', selector: '#input', value: 'x' } }] }, 0), false);
  const duplicate = evidenceFor(contract); duplicate.candidates[0].clauses[0].boundaryRefs.push({ checkIndex: 0, stepIndex: 1 });
  await assert.rejects(validateImplementationEvidence(duplicate, contract, input), code('evidence-boundary-mismatch'));
});

test('honest missing/contradicted rows permit bounded abstention, never qualifying scores or a silently repaired accept', async () => {
  const input = source(); const contract = await buildImplementationEvidenceContract(input);
  for (const status of ['missing', 'contradicted'] as const) {
    const proof = evidenceFor(contract); proof.candidates[0].clauses[0] = { ...proof.candidates[0].clauses[0], status, implementationRefs: [], boundaryRefs: [] };
    assert.equal((await validateImplementationEvidence(proof, contract, input)).candidates[0].clauses[0].status, status);
    assert.throws(() => assertImplementationEvidenceScores(proof, [{ candidateId: 'candidate-1', score: 5 }]), code('evidence-score-conflict'));
    const abstain = { ...decisionFor(proof), decision: 'abstain', selectedCandidateId: null, scores: [{ candidateId: 'candidate-1', score: 2, reason: '必需证据缺失' }] };
    assert.equal((await parseImplementationEvidenceDecisionText(JSON.stringify(abstain), contract, input)).decision, 'abstain');
  }
});

test('existing minimum/highest scores, bounded JSON, decoded duplicate keys and escaping all remain enforced', async () => {
  const input = source(2); const contract = await buildImplementationEvidenceContract(input); const proof = evidenceFor(contract);
  const low = decisionFor(proof); low.scores[0].score = 2;
  await assert.rejects(parseImplementationEvidenceDecisionText(JSON.stringify(low), contract, input), error => error instanceof VerifierDecisionError && error.diagnostic.code === 'selected-score-below-minimum');
  const notBest = decisionFor(proof); notBest.scores[1].score = 5;
  await assert.rejects(parseImplementationEvidenceDecisionText(JSON.stringify(notBest), contract, input), error => error instanceof VerifierDecisionError && error.diagnostic.code === 'selected-score-not-highest');
  const escaped = decisionFor(proof); escaped.reason = '引号"、反斜杠\\、换行\n、制表\t、回车\r、控制字符\u0000';
  assert.equal((await parseImplementationEvidenceDecisionText(JSON.stringify(escaped), contract, input)).reason, escaped.reason);
  const duplicate = JSON.stringify(escaped).replace('"contractSha256":', '"contractSha256":"' + contract.contractSha256 + '","\\u0063ontractSha256":');
  await assert.rejects(parseImplementationEvidenceDecisionText(duplicate, contract, input), error => error instanceof VerifierDecisionError && error.diagnostic.code === 'duplicate-json-key');
  await assert.rejects(parseImplementationEvidenceDecisionText('{"arbitrary-provider-path":"secret",', contract, input), error => error instanceof VerifierDecisionError && error.diagnostic.code === 'invalid-json' && !JSON.stringify(error).includes('arbitrary-provider'));
  await assert.rejects(parseImplementationEvidenceDecisionText(' '.repeat(32001), contract, input), error => error instanceof VerifierDecisionError && error.diagnostic.code === 'response-too-large');
  await assert.rejects(parseImplementationEvidenceDecisionText(JSON.stringify({ ...escaped, 'malicious-unknown-key': 'provider body' }), contract, input), error => code('evidence-response-structure')(error) && !JSON.stringify(error).includes('malicious'));
});

test('arbitrary/deep/cyclic source steps and oversized proof are refused by bounded fixed diagnostics', async () => {
  const bad = source(); const cycle: any = {}; cycle.next = cycle; bad.checks[0].steps[0].provider = cycle;
  await assert.rejects(buildImplementationEvidenceContract(bad), code('evidence-input-invalid'));
  const input = source(2); input.productAcceptance = Array.from({ length: 12 }, (_, index) => `Original requirement ${index}`); const contract = await buildImplementationEvidenceContract(input);
  const oversized = evidenceFor(contract);
  for (const candidate of oversized.candidates) for (const clause of candidate.clauses) {
    clause.implementationRefs = [{ pointer: '/html', exactAnchor: 'x'.repeat(160) }, { pointer: '/html', exactAnchor: 'y'.repeat(160) }];
    clause.boundaryRefs = [{ checkIndex: 0, stepIndex: 1 }, { checkIndex: 1, stepIndex: 1 }, { checkIndex: 2, stepIndex: 1 }];
  }
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 16000);
  await assert.rejects(validateImplementationEvidence(oversized, contract, input), code('evidence-response-structure'));
});

test('new deterministic protocol metadata cannot collide with any configured credential substring', () => {
  for (const literal of IMPLEMENTATION_EVIDENCE_PROTOCOL_LITERALS) for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false, literal.slice(start, end));
});
