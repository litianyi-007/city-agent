import assert from 'node:assert/strict';
import test from 'node:test';
import { probeOfflineResponsesCapability } from '../server/research/structured-capability';
import { compileAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { getBusinessDemos } from '../shared/research-demo';
import { fingerprint } from '../shared/evidence';

function specimen() {
  const demo = getBusinessDemos()[0];
  const contract = compileAnswerContract(demo.task, 'resident-offline', demo.logicRules);
  const answers = demo.task.questionnaire.questions.map(q => ({ questionId: q.id,
    value: q.required ? q.type === 'single' ? q.options[0].id : q.type === 'multiple' ? [q.options[0].id] : q.type === 'scale' || q.type === 'number' ? q.min : '离线原文' : null }));
  const number = demo.task.questionnaire.questions.find(q => q.type === 'number');
  if (number) answers.find(answer => answer.questionId === number.id)!.value = 0;
  return { contract, raw: encodeAnswerContract(contract.residentId, answers) };
}

test('actual fixed DSH SDK can select Responses but attempted profile schema fields do not reach wire', { timeout: 45_000 }, async () => {
  const { contract, raw } = specimen();
  const evidence = await probeOfflineResponsesCapability({ mode: 'harness-profile', schema: contract.schema, responseText: raw });
  assert.equal(evidence.scope, 'localhost-fixture-only');
  assert.equal(evidence.completed, true, evidence.failure ?? undefined);
  assert.equal(evidence.requestCount, 1);
  assert.equal(evidence.requests[0].path, '/v1/responses');
  const body = evidence.requests[0].body;
  assert.equal(body.model, 'city-responses-fixture');
  assert.equal(body.stream, true);
  assert.equal(body.max_output_tokens, 512);
  assert.equal(body.tools, undefined);
  assert.equal(body.text, undefined);
  assert.equal(body.samplingParams, undefined);
  assert.equal((body.input as { role: string }[])[0].role, 'system');
  assert.equal(evidence.schemaHash, contract.schemaHash);
  assert.equal(evidence.observedSchemaHash, null);
  assert.match(evidence.bodyHash!, /^[a-f0-9]{64}$/);
  assert.match(evidence.rawResponseHash, /^[a-f0-9]{64}$/);
  assert.equal(evidence.text, raw);
  assert.equal(evidence.toolCallEvents, 0);
  assert.equal(evidence.toolResultEvents, 0);
  assert.equal(evidence.failure, null);
});

test('installed pi-ai onPayload transmits frozen full schema unchanged; fixture does not prove provider enforcement', { timeout: 15_000 }, async () => {
  const { contract, raw } = specimen();
  const evidence = await probeOfflineResponsesCapability({ mode: 'pi-on-payload', schema: contract.schema, responseText: raw });
  assert.equal(evidence.completed, true, evidence.failure ?? undefined);
  assert.equal(evidence.requestCount, 1);
  assert.equal(evidence.schemaHash, contract.schemaHash);
  assert.equal(evidence.observedSchemaHash, contract.schemaHash);
  assert.deepEqual((evidence.requests[0].body.text as any).format, { type: 'json_schema', name: 'city_answer_probe', schema: JSON.parse(JSON.stringify(contract.schema)) });
  assert.equal(evidence.requests[0].body.tool_choice, 'none');
  assert.equal(evidence.requests[0].body.tools, undefined);
  assert.equal(evidence.text, raw);
  assert.equal(evidence.toolCallEvents, 0);
  assert.equal(evidence.toolResultEvents, 0);
  assert.equal(fingerprint(contract.schema), contract.schemaHash);
});

test('full second business schema, nullable answers and legal zero are transport bytes, not model-generation evidence', async () => {
  const demo = getBusinessDemos()[1];
  const contract = compileAnswerContract(demo.task, 'resident-offline-2', demo.logicRules);
  const raw = '{"residentId":"resident-offline-2","answers":{"nullable":null,"zero":0}}';
  const evidence = await probeOfflineResponsesCapability({ mode: 'pi-on-payload', schema: contract.schema, responseText: raw });
  assert.equal(evidence.observedSchemaHash, contract.schemaHash);
  // The fixture intentionally does no schema validation: passing transport is not conformance.
  assert.equal(evidence.text, raw);
  assert.equal(evidence.completed, true);
});

for (const fixture of ['http-500', 'no-terminal', 'incomplete'] as const) {
  for (const mode of ['harness-profile', 'pi-on-payload'] as const) {
    test(`${mode} ${fixture} does not complete or trigger a second local request`, { timeout: 45_000 }, async () => {
      const evidence = await probeOfflineResponsesCapability({ mode, schema: { type: 'object' }, responseText: '{"partial":true}', fixture });
      assert.equal(evidence.requestCount, 1);
      assert.equal(evidence.completed, false);
      assert.ok(evidence.failure);
      assert.equal(evidence.toolResultEvents, 0);
      assert.equal(evidence.limits.retries, 0);
    });
  }
}

test('offline capability probe rejects unbounded input before starting a server or child', async () => {
  await assert.rejects(probeOfflineResponsesCapability({ mode: 'harness-profile', schema: {}, responseText: 'x'.repeat(128_001) }), /128KB/);
});
