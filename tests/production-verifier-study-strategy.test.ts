import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { jevConfigSchema, type JevCandidateContext, type JevEvaluation } from '../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { selectVerifierStudy, VERIFIER_STUDY_STRATEGY_VERSION, type VerifierStudyPorts, type VerifierStudyRequests } from '../server/production/verifier-study-strategy.js';

const signal = () => new AbortController().signal;
const preparation = (id: typeof VERIFIER_CHALLENGE_IDS[number] = 'H01') => verifierPreparationRequests(id);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unused: VerifierStudyPorts = { llm: async () => { throw new Error('Unexpected free engineering LLM callback'); }, jev: async () => { throw new Error('Unexpected free engineering Jev callback'); } };
function decision(request: VerifierStudyRequests, scores = [3, 4], selected = request.snapshot.candidates[1].id, abstain = false) {
  return JSON.stringify({ decision: abstain ? 'abstain' : 'accept', selectedCandidateId: abstain ? null : selected,
    scores: request.snapshot.candidates.map((candidate, index) => ({ candidateId: candidate.id, score: scores[index], reason: 'Injected engineering verdict, not a measured model judgment' })), reason: 'Injected free protocol case' });
}
const config = { ...jevConfigSchema.parse({ enabled: true }), apiKey: 'verifier-study-engineering-fixture-not-real' };
function wireBody(context: JevCandidateContext, kind: 'accepted' | 'rejected' | 'uncertain' | 'drift' | 'late-fatal' = 'accepted') {
  const request = buildJevCandidateRequest(config.modelId, context);
  const answers: Record<string, any> = {};
  const value = kind === 'rejected' ? 0 : 4;
  for (const [index] of context.candidates.entries()) {
    for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c${index}_${dimension}`] = {
      type: 'score', score: value, confidence: 1,
      probabilities: Object.fromEntries([0, 1, 2, 3, 4].map(level => [String(level), level === value ? 1 : 0])),
      legend: Object.fromEntries((request.questions[`c${index}_${dimension}`].criteria as string[]).map((label, level) => [String(level), label])),
    };
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  }
  const chosen = kind === 'rejected' || kind === 'uncertain' ? 'abstain' : context.candidates[0].id;
  answers.best = { type: 'choice', choice: chosen, confidence: 1, probabilities: Object.fromEntries([...context.candidates.map(candidate => [candidate.id, candidate.id === chosen ? 1 : 0]), ['abstain', chosen === 'abstain' ? 1 : 0]]) };
  if (kind === 'drift' || kind === 'late-fatal') answers.c0_coverage.score = 3;
  if (kind === 'late-fatal') answers.c1_scope.legend['4'] = 'Provider cannot redefine a frozen rubric';
  return { model: config.modelId, answers, usage: { input_tokens: 101, output_tokens: 7 } };
}
const trustedJev = (kind: Parameters<typeof wireBody>[1] = 'accepted', inspect?: (evaluation: JevEvaluation) => void): VerifierStudyPorts['jev'] => async (context, abort) => {
  const evaluation = await evaluateJevCandidates(config, context, abort, { fetch: async () => new Response(JSON.stringify(wireBody(context, kind)), { status: 200 }) });
  inspect?.(evaluation); return evaluation;
};

test('baseline checks every strict artifact without dispatch or Oracle access across all 18 pools', async () => {
  for (const poolId of VERIFIER_CHALLENGE_IDS) {
    const request = preparation(poolId); const before = hash(request);
    const actual = await selectVerifierStudy('baseline', request, unused, signal());
    assert.equal(actual.version, VERIFIER_STUDY_STRATEGY_VERSION); assert.equal(actual.decision, 'accept');
    assert.equal(actual.selectedCandidateId, request.snapshot.candidates[0].id); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 0 });
    assert.equal(actual.requestBinding!.inputSha256, before); assert.equal(hash(request), before);
  }
});

test('strict HTML/scene schema rejects any malformed scheduled candidate before either callback, without filtering', async () => {
  for (const poolId of ['H01', 'C13'] as const) {
    const request: any = structuredClone(preparation(poolId));
    if (poolId === 'H01') request.snapshot.candidates[1].value.html = '<html>Incomplete</html>';
    else request.snapshot.candidates[1].value.scene.objects[0].escape = 'forbidden';
    const actual = await selectVerifierStudy('jev-cascade', request, unused, signal());
    assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'preflight'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 0 });
  }
});

test('single independent LLM selects the highest qualifying ordinal score and receives cloned frozen logical input', async () => {
  const request = preparation(); let calls = 0;
  const actual = await selectVerifierStudy('llm', request, { ...unused, llm: async logical => {
    calls++; assert.notEqual(logical, request.logicalLlm); assert.ok(Object.isFrozen(logical)); assert.deepEqual(logical, request.logicalLlm);
    return decision(request);
  } }, signal());
  assert.equal(calls, 1); assert.equal(actual.decision, 'accept'); assert.equal(actual.selectedCandidateId, request.snapshot.candidates[1].id);
  assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 0 }); assert.equal(actual.engine, 'llm');
});

test('missing IDs, foreign IDs, duplicate scores, below-minimum or not-highest choices fail without retry', async () => {
  const request = preparation(); const valid = JSON.parse(decision(request));
  for (const value of [
    { ...valid, scores: valid.scores.slice(0, 1) }, { ...valid, selectedCandidateId: 'foreign' },
    { ...valid, scores: [valid.scores[0], valid.scores[0]] },
    JSON.parse(decision(request, [1, 2])), JSON.parse(decision(request, [3, 4], request.snapshot.candidates[0].id)),
    { ...valid, decision: 'abstain' }, { ...valid, goldAnswer: 'not allowed' },
  ]) {
    let calls = 0; const actual = await selectVerifierStudy('llm', request, { ...unused, llm: async () => { calls++; return JSON.stringify(value); } }, signal());
    assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'protocol'); assert.equal(calls, 1); assert.equal(actual.selectedCandidateId, null);
  }
});

test('all-bad business pool can legitimately abstain; structural validity does not become automatic acceptance', async () => {
  const request = preparation('H02'); const actual = await selectVerifierStudy('llm', request, { ...unused, llm: async () => decision(request, [1, 1], undefined, true) }, signal());
  assert.equal(actual.decision, 'abstain'); assert.equal(actual.selectedCandidateId, null); assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 0 });
});

test('trusted Jev accepted/rejected paths make exactly one callback and never call LLM', async () => {
  for (const kind of ['accepted', 'rejected'] as const) {
    const request = preparation(); const actual = await selectVerifierStudy('jev-cascade', request, { ...unused, jev: trustedJev(kind) }, signal());
    assert.equal(actual.decision, kind === 'accepted' ? 'accept' : 'abstain'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 1 }); assert.equal(actual.fallbackKind, null);
    assert.equal(actual.jevSummary!.usage.complete, true); assert.equal(actual.selectedCandidateId, kind === 'accepted' ? request.snapshot.candidates[0].id : null);
  }
});

test('uncertain and trusted arithmetic errors each upgrade once with exactly the independent B prompt, without opinions', async () => {
  for (const kind of ['uncertain', 'drift'] as const) {
    const request = preparation(); let calls = 0;
    const actual = await selectVerifierStudy('jev-cascade', request, { jev: trustedJev(kind, evaluation => {
      assert.equal(evaluation.status, kind === 'uncertain' ? 'uncertain' : 'error');
      if (kind === 'drift') { assert.equal(evaluation.errorKind, 'arithmetic-drift'); assert.deepEqual(evaluation.diagnostics, [{ code: 'score-mean-drift', answerId: 'c0_coverage' }]); }
    }), llm: async logical => { calls++; assert.deepEqual(logical, request.logicalLlm); assert.equal(logical.userPrompt.includes('score-mean-drift'), false); return decision(request); } }, signal());
    assert.equal(actual.decision, 'accept'); assert.equal(calls, 1); assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 1 });
    assert.equal(actual.engine, kind === 'uncertain' ? 'jev-llm-fallback' : 'jev-llm-protocol-fallback');
  }
});

test('early arithmetic defect cannot mask a later fatal frozen-legend error or trigger fallback', async () => {
  const actual = await selectVerifierStudy('jev-cascade', preparation(), { ...unused, jev: trustedJev('late-fatal', evaluation => {
    assert.equal(evaluation.errorKind, 'fatal'); assert.match(evaluation.error!, /legend differs/); assert.equal(evaluation.diagnostics, undefined);
  }) }, signal());
  assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'protocol'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 1 });
});

test('unknown Jev usage, foreign selected ID, mismatched request and empty arithmetic diagnostics fail closed', async () => {
  for (const mode of ['unknown', 'foreign', 'request', 'diagnostics'] as const) {
    const actual = await selectVerifierStudy('jev-cascade', preparation(), { ...unused, jev: async (context, abort) => {
      const evaluation = await trustedJev(mode === 'diagnostics' || mode === 'unknown' ? 'drift' : 'accepted')(context, abort);
      if (mode === 'unknown') evaluation.usage = { inputTokens: null, outputTokens: null, estimatedCost: null, complete: false, currency: 'USD' };
      if (mode === 'foreign') evaluation.selectedCandidateId = 'foreign';
      if (mode === 'request') evaluation.requestSnapshot!.state.goal += ' Changed after response';
      if (mode === 'diagnostics') evaluation.diagnostics = [];
      return evaluation;
    } }, signal());
    assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, mode === 'unknown' ? 'unknown-usage' : mode === 'request' ? 'integrity' : 'protocol');
    assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 1 });
  }
});

test('fallback protocol failure or transport error cannot receive a second independent review', async () => {
  for (const kind of ['invalid', 'transport'] as const) {
    const actual = await selectVerifierStudy('jev-cascade', preparation(), { jev: trustedJev('uncertain'), llm: async () => {
      if (kind === 'transport') throw new Error('Injected fatal callback'); return '{broken';
    } }, signal());
    assert.equal(actual.decision, 'error'); assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 1 });
    assert.equal(actual.failureCode, kind === 'invalid' ? 'protocol' : 'transport');
  }
});

test('same repeated input independently invokes new LLM and Jev callbacks; no global result cache exists', async () => {
  const request = preparation(); let llmCalls = 0; let jevCalls = 0;
  const ports: VerifierStudyPorts = { llm: async () => { llmCalls++; return decision(request); }, jev: async (...args) => { jevCalls++; return trustedJev('uncertain')(...args); } };
  for (let repeat = 0; repeat < 3; repeat++) assert.equal((await selectVerifierStudy('jev-cascade', request, ports, signal())).decision, 'accept');
  assert.equal(llmCalls, 3); assert.equal(jevCalls, 3);
});

test('pre-abort, pending cancellation and timeout stop even an uncooperative port without upgrade', async () => {
  const prior = new AbortController(); prior.abort();
  const before = await selectVerifierStudy('jev-cascade', preparation(), unused, prior.signal);
  assert.equal(before.failureCode, 'cancelled'); assert.deepEqual(before.callbackCounts, { llm: 0, jev: 0 });
  for (const engine of ['llm', 'jev-cascade'] as const) {
    const controller = new AbortController(); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    const never = async () => { entered(); return new Promise<any>(() => {}); };
    const pending = selectVerifierStudy(engine, preparation(), { llm: never, jev: never }, controller.signal);
    await ready; controller.abort(); const cancelled = await pending;
    assert.equal(cancelled.failureCode, 'cancelled'); assert.deepEqual(cancelled.callbackCounts, engine === 'llm' ? { llm: 1, jev: 0 } : { llm: 0, jev: 1 });
    const timed = new AbortController();
    const timer = setTimeout(() => timed.abort(new DOMException('Injected request deadline', 'TimeoutError')), 15);
    try {
      const timeout = await selectVerifierStudy(engine, preparation(), { llm: never, jev: never }, timed.signal);
      assert.equal(timeout.failureCode, 'timeout'); assert.equal(timeout.decision, 'error');
    } finally { clearTimeout(timer); }
  }
});

test('cloned deeply frozen candidate context and after-callback input hash prevent mutation or subsequent review', async () => {
  const request = structuredClone(preparation());
  const actual = await selectVerifierStudy('jev-cascade', request, { ...unused, jev: async (context, abort) => {
    assert.notEqual(context, request.snapshot); assert.ok(Object.isFrozen(context.candidates[0].value));
    assert.throws(() => { (context.candidates[0].value as { html: string }).html = 'Mutated'; }, TypeError);
    const evaluation = await trustedJev('uncertain')(context, abort);
    (request.snapshot.candidates[0].value as { html: string }).html += '\n<!-- external input mutation -->'; return evaluation;
  } }, signal());
  assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'integrity'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 1 });
});

test('altered logical review context or artifact bytes cannot dispatch by updating only one preparation hash', async () => {
  const request = structuredClone(preparation()); const prompt = JSON.parse(request.logicalLlm.userPrompt);
  prompt.candidates[0].value.html += '\n<!-- split context -->'; request.logicalLlm.userPrompt = JSON.stringify(prompt);
  request.metadata.logicalLlmPromptSha256 = hash(request.logicalLlm);
  const actual = await selectVerifierStudy('llm', request, unused, signal());
  assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'integrity'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 0 });
});

test('extra gold labels or previous strategy/Oracle results cannot be injected into request fields', async () => {
  for (const location of ['criteria', 'state', 'context', 'jev-question'] as const) {
    const request: any = structuredClone(preparation()); const prompt = JSON.parse(request.logicalLlm.userPrompt);
    if (location === 'criteria') prompt.criteria.goldLabel = 'known-correct';
    if (location === 'state') prompt.state.previousStrategy = 'selected-known-correct';
    if (location === 'context') {
      request.snapshot.reviewContext.oracleResults = [{ passed: true }]; prompt.state.reviewContext = request.snapshot.reviewContext;
      request.jev.state.reviewContext = request.snapshot.reviewContext;
    }
    if (location === 'jev-question') request.jev.questions.best.goldLabel = 'known-correct';
    request.logicalLlm.userPrompt = JSON.stringify(prompt);
    request.metadata.logicalLlmPromptSha256 = hash(request.logicalLlm); request.metadata.jevRequestSha256 = hash(request.jev);
    const actual = await selectVerifierStudy('jev-cascade', request, unused, signal());
    assert.equal(actual.decision, 'error'); assert.equal(actual.failureCode, 'integrity'); assert.deepEqual(actual.callbackCounts, { llm: 0, jev: 0 });
  }
});

test('oversized requests/responses are refused without truncating candidates or attempting another callback', async () => {
  const request = preparation();
  const actual = await selectVerifierStudy('llm', request, { ...unused, llm: async () => 'x'.repeat(32001) }, signal());
  assert.equal(actual.failureCode, 'protocol'); assert.deepEqual(actual.callbackCounts, { llm: 1, jev: 0 });
  const oversized: any = structuredClone(request); oversized.logicalLlm.userPrompt += 'x'.repeat(250001);
  const rejected = await selectVerifierStudy('llm', oversized, unused, signal());
  assert.equal(rejected.failureCode, 'preflight'); assert.deepEqual(rejected.callbackCounts, { llm: 0, jev: 0 });
});
