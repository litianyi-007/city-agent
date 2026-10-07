import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { getBusinessDemos } from '../shared/research-demo';
import { runStructuredHarnessAdapterFixture, StructuredHarnessFixtureError } from '../server/research/structured-harness-adapter';

function specimen(index = 0) {
  const demo = getBusinessDemos()[index], contract = compileAnswerContract(demo.task, `resident-structured-${index}`, demo.logicRules);
  const answers = demo.task.questionnaire.questions.map(question => ({ questionId: question.id, value: question.type === 'single' ? question.options[0].id
    : question.type === 'multiple' ? [question.options[0].id] : question.type === 'number' ? 0 : question.type === 'scale' ? question.min : '🍪离线原文' }));
  const optionalText = demo.task.questionnaire.questions.find(question => question.type === 'text' && !question.required)!;
  answers.find(answer => answer.questionId === optionalText.id)!.value = null as any;
  return { contract, answers, raw: encodeAnswerContract(contract.residentId, answers) };
}

for (const index of [0, 1]) {
  test(`actual DSH custom adapter carries full ${index === 0 ? 17 : 18}-question schema, wire hashes, null and zero in one tool-free step`, { timeout: 45_000 }, async () => {
    const { contract, answers, raw } = specimen(index);
    const result = await runStructuredHarnessAdapterFixture({ contract, responseText: raw });
    assert.equal(result.raw, raw); assert.deepEqual(result.answers, answers);
    assert.equal(result.answers.length, index === 0 ? 17 : 18);
    assert.ok(result.answers.some(answer => answer.value === null)); assert.ok(result.answers.some(answer => answer.value === 0));
    const evidence = result.evidence;
    assert.equal(evidence.scope, 'localhost-fixture-only'); assert.equal(evidence.harnessCompleted, true); assert.equal(evidence.failureStage, null);
    assert.equal(evidence.requestCount, 1); assert.equal(evidence.stepCount, 1); assert.equal(evidence.toolCalls, 0); assert.equal(evidence.toolResults, 0);
    assert.equal(evidence.invocationCount, 1); assert.ok(evidence.contentChunks > 0); assert.equal(evidence.failureCode, null); assert.deepEqual(evidence.cleanupErrors, []);
    assert.equal(evidence.schemaHash, contract.schemaHash); assert.equal(evidence.observedSchemaHash, contract.schemaHash);
    assert.equal(evidence.observedBodyHash, evidence.bodyHash);
    assert.deepEqual(evidence.replayState, { response: { version: 'structured-harness-fixture-1.0', schemaHash: contract.schemaHash,
      bodyHash: evidence.bodyHash, rawResponseHash: evidence.rawResponseHash, dispatches: 1 } });
  });
}

for (const fixture of ['incomplete', 'refusal', 'tool', 'no-terminal', 'http-500', 'terminal-mismatch', 'invalid-usage', 'duplicate-terminal',
  'early-tool', 'early-refusal', 'item-mismatch', 'part-refusal', 'array-impostor', 'created-error'] as const) {
  test(`actual DSH custom adapter rejects ${fixture} before committing text, tools or a second request`, { timeout: 45_000 }, async () => {
    const { contract, raw } = specimen();
    await assert.rejects(runStructuredHarnessAdapterFixture({ contract, responseText: raw, fixture }), error => {
      assert.ok(error instanceof StructuredHarnessFixtureError); const evidence = error.evidence;
      assert.equal(evidence.failureStage, 'adapter'); assert.equal(evidence.harnessCompleted, false);
      assert.equal(evidence.requestCount, 1); assert.equal(evidence.stepCount, 1); assert.equal(evidence.assistantMessages, 0);
      assert.equal(evidence.invocationCount, 1); assert.equal(evidence.contentChunks, 0); assert.equal(evidence.lastContentChunks, 0);
      assert.match(evidence.failureCode!, /^OFFLINE_/); assert.deepEqual(evidence.cleanupErrors, []);
      assert.equal(evidence.toolCalls, 0); assert.equal(evidence.toolResults, 0); assert.equal(evidence.observedBodyHash, evidence.bodyHash);
      assert.equal(evidence.observedSchemaHash, contract.schemaHash); return true;
    });
  });
}

test('actual DSH second invocation fails consumed guard before another request or output chunk', { timeout: 45_000 }, async () => {
  const { contract, raw } = specimen();
  await assert.rejects(runStructuredHarnessAdapterFixture({ contract, responseText: raw, fixture: 'second-dispatch' }), error => {
    assert.ok(error instanceof StructuredHarnessFixtureError); const evidence = error.evidence;
    assert.equal(evidence.failureStage, 'adapter'); assert.equal(evidence.failureCode, 'OFFLINE_SECOND_DISPATCH');
    assert.equal(evidence.invocationCount, 2); assert.equal(evidence.stepCount, 2); assert.equal(evidence.requestCount, 1);
    assert.equal(evidence.harnessCompleted, false); assert.equal(evidence.assistantMessages, 1); // Only the first, fully checked invocation committed text.
    assert.ok(evidence.contentChunks > 0); assert.equal(evidence.lastContentChunks, 0); assert.equal(evidence.toolCalls, 0); assert.equal(evidence.toolResults, 0);
    assert.deepEqual(evidence.cleanupErrors, []); return true;
  });
});

test('actual SDK completion is not answer acceptance: missing/extra IDs, scalar multiple and duplicate raw keys fail decoder', { timeout: 45_000 }, async () => {
  const { contract, raw } = specimen();
  const envelope = JSON.parse(raw);
  const mutations = [
    (value: any) => { delete value.answers['child-own-taste']; },
    (value: any) => { value.answers.extra = null; },
    (value: any) => { value.answers['planned-channels'] = 'online'; },
  ];
  const raws = mutations.map(mutate => { const value = structuredClone(envelope); mutate(value); return JSON.stringify(value); });
  raws.push(raw.replace('"residentId":', '"residentId":"duplicate","residentId":'));
  for (const responseText of raws) await assert.rejects(runStructuredHarnessAdapterFixture({ contract, responseText }), error => {
    assert.ok(error instanceof StructuredHarnessFixtureError); assert.equal(error.evidence.failureStage, 'decoder');
    assert.equal(error.evidence.failureCode, 'ANSWER_CONTRACT_REJECTED'); assert.deepEqual(error.evidence.cleanupErrors, []);
    assert.equal(error.evidence.harnessCompleted, true); assert.equal(error.evidence.requestCount, 1); assert.equal(error.evidence.toolResults, 0); return true;
  });
});

test('offline structured Harness rejects drift and arbitrary endpoint/key options before launch', async () => {
  const { contract, raw } = specimen(); const changed = structuredClone(contract); changed.schema = {};
  await assert.rejects(runStructuredHarnessAdapterFixture({ contract: changed, responseText: raw }), /drifted/);
  await assert.rejects(runStructuredHarnessAdapterFixture({ contract, responseText: raw, endpoint: 'https:\/\/example.com', apiKey: 'not-used' } as any), /unknown options/);
});
