import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { compileAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { getBusinessDemos } from '../shared/research-demo';
import { createExperimentBudget, ExperimentBudgetError } from '../server/research/experiment-budget';
import { runStructuredResponsesHarness, StructuredResponsesError } from '../server/research/structured-responses-harness';

const model = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', apiKey: 'synthetic-responses-canary-key' };
const pricing = { provider: 'deepseek', modelId: model.modelId, currency: 'CNY' as const, inputCnyPerMillionTokens: 2,
  outputCnyPerMillionTokens: 8, sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', checkedAt: '2026-10-08T00:00:00Z' };
function specimen(index = 0) {
  const demo = getBusinessDemos()[index], contract = compileAnswerContract(demo.task, `responses-resident-${index}`, demo.logicRules);
  const answers = demo.task.questionnaire.questions.map(q => ({ questionId: q.id, value: !q.required ? null : q.type === 'single' ? q.options[0].id
    : q.type === 'multiple' ? [q.options[0].id] : q.type === 'text' ? '🍪本地答卷' : q.type === 'scale' ? q.min : 0 }));
  return { contract, answers, raw: encodeAnswerContract(contract.residentId, answers) };
}
function events(text: string, usage: unknown = { input_tokens: 13, output_tokens: 7, total_tokens: 20, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 0 } }) {
  const part = { type: 'output_text', text, annotations: [] }, item = { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [part] };
  const response = { id: 'resp_test', object: 'response', model: model.modelId, status: 'completed', output: [item], error: null, incomplete_details: null, usage };
  const split = Math.floor(text.length / 2);
  return [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.in_progress', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(0, split) },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text.slice(split) },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
}
function wire(packets: ReturnType<typeof events>) { return ': synthetic heartbeat\r\n\r\n' + packets.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\r\n\r\n`).join(''); }
function withFinalAnswerPhase(packets: ReturnType<typeof events>) {
  for (const packet of packets) {
    if (packet.type === 'response.output_item.added' || packet.type === 'response.output_item.done') (packet.item as any).phase = 'final_answer';
    if (packet.type === 'response.completed') (packet.response!.output[0] as any).phase = 'final_answer';
  }
  return packets;
}
function fixture(body: string, options: { budgetCny?: number; pricingModel?: string; fetchError?: boolean; signal?: AbortSignal; abortAtEof?: AbortController } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'city-responses-boundary-test-')), ledgerPath = join(directory, 'ledger.json');
  const guard = createExperimentBudget({ ledgerPath, experimentId: 'offline-responses-candidate', budgetCny: options.budgetCny ?? 5, maxProviderRequests: 24,
    pricing: { ...pricing, modelId: options.pricingModel ?? pricing.modelId } });
  let forwarded = 0;
  const upstreamFetch: typeof fetch = async (url, init) => {
    forwarded++; assert.equal(String(url), 'https://api.deepseek.com/v1/responses'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${model.apiKey}`);
    const request = JSON.parse(String(init?.body)); assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.tools.length, 0);
    if (options.fetchError) throw new Error(`Never expose ${model.apiKey} from a provider error`);
    const bytes = Buffer.from(body);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.subarray(0, 29)); controller.enqueue(bytes.subarray(29, 77)); controller.enqueue(bytes.subarray(77));
      options.abortAtEof?.abort(); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  };
  return { guard, forwarded: () => forwarded, call: (index = 0, requestId = 'resident-1') => runStructuredResponsesHarness({ guard, requestId, purpose: 'resident', model,
    contract: specimen(index).contract, system: '严格按冻结问卷返回JSON；可选未知用null，不执行工具。', user: `受访者${index}完成17/18题问卷。`,
    maxOutputTokens: 4096, signal: options.signal ?? new AbortController().signal, upstreamFetch }),
    ledger: () => JSON.parse(readFileSync(ledgerPath, 'utf8')),
    close() { guard.close(); rmSync(directory, { recursive: true, force: true }); } };
}

for (const index of [0, 1]) test(`real DSH candidate carries ${index ? 18 : 17} schema with multi-delta CRLF, null/0, full cache-inclusive budget`, { timeout: 45_000 }, async () => {
  const data = specimen(index), f = fixture(wire(events(data.raw)));
  try {
    const result = await f.call(index); assert.deepEqual(result.answers, data.answers); assert.equal(result.raw, data.raw);
    assert.equal(result.inputTokens, 13); assert.equal(result.outputTokens, 7); assert.equal(f.forwarded(), 1);
    assert.equal(result.evidence.stepCount, 1); assert.equal(result.evidence.toolCalls, 0); assert.equal(result.evidence.toolResults, 0);
    assert.equal(result.evidence.assistantMessages, 1); assert.ok(result.evidence.contentChunks > 0); assert.deepEqual(result.evidence.cleanupErrors, []);
    assert.equal(result.evidence.transport?.providerWitness.state, 'reported');
    assert.equal(result.evidence.transport?.bodyUtf8Bytes, f.ledger().reservations[0].promptUtf8Bytes);
    assert.equal(f.ledger().state, 'active'); assert.deepEqual(f.ledger().reservations[0].usage, { inputTokens: 13, outputTokens: 7 });
    assert.ok(!JSON.stringify(result.evidence).includes(model.apiKey)); assert.ok(!JSON.stringify(f.ledger()).includes(model.apiKey));
  } finally { f.close(); }
});

test('real DSH candidate accepts final_answer phase only after full EOF and complete schema/usage gates', { timeout: 45_000 }, async () => {
  const data = specimen(), f = fixture(wire(withFinalAnswerPhase(events(data.raw))));
  try {
    const result = await f.call(); assert.equal(result.raw, data.raw); assert.deepEqual(result.answers, data.answers);
    assert.equal(f.forwarded(), 1); assert.equal(result.evidence.assistantMessages, 1);
    assert.equal(result.evidence.toolCalls, 0); assert.equal(result.evidence.toolResults, 0);
    assert.equal(result.evidence.transport?.providerWitness.version, 'responses-text-stream-1.1');
    assert.equal(result.evidence.transport?.providerWitness.state, 'reported');
    assert.deepEqual(f.ledger().reservations[0].usage, { inputTokens: 13, outputTokens: 7 });
    assert.equal(f.ledger().state, 'active'); assert.equal(f.ledger().knownUsageRequestCount, 1);
  } finally { f.close(); }
});

test('real DSH phase disappearance rejects content, retains reserve and blocks another dispatch', { timeout: 45_000 }, async () => {
  const packets = withFinalAnswerPhase(events(specimen().raw)); delete (packets[8].item as any).phase;
  const f = fixture(wire(packets));
  try {
    await assert.rejects(f.call(), error => {
      assert.ok(error instanceof StructuredResponsesError); assert.equal(error.evidence.assistantMessages, 0); assert.equal(error.evidence.contentChunks, 0);
      assert.equal(error.evidence.transport?.providerWitness.state, 'invalid');
      assert.equal(error.evidence.transport?.providerWitness.reason, 'item-phase-drift'); return true;
    });
    const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.usageStatus, 'incomplete');
    assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny); assert.equal(f.forwarded(), 1);
    await assert.rejects(f.call(0, 'phase-retry'), error => error instanceof ExperimentBudgetError && error.code === 'halted');
    assert.equal(f.forwarded(), 1);
  } finally { f.close(); }
});

test('real DSH complete legitimate zero is distinguishable from missing usage', { timeout: 45_000 }, async () => {
  const f = fixture(wire(events(specimen().raw, { input_tokens: 0, output_tokens: 0, total_tokens: 0 })));
  try { const result = await f.call(); assert.equal(result.inputTokens, 0); assert.equal(result.outputTokens, 0);
    assert.equal(f.ledger().state, 'active'); assert.equal(f.ledger().knownUsageRequestCount, 1); } finally { f.close(); }
});

for (const failure of ['missing-usage', 'invalid-usage', 'early-tool', 'terminal-drift', 'after-terminal', 'duplicate-json', 'socket-error', 'secret-echo'] as const) {
  test(`real DSH candidate ${failure} publishes no content, retains reserve, blocks next call`, { timeout: 45_000 }, async () => {
    const data = specimen(), packets = events(data.raw);
    if (failure === 'missing-usage') packets[9].response!.usage = null;
    if (failure === 'invalid-usage') packets[9].response!.usage = { input_tokens: 13, output_tokens: 7, total_tokens: 21 };
    if (failure === 'early-tool') (packets[2] as any).item = { type: 'function_call', name: 'persistent_bash', call_id: 'never', arguments: '{}' };
    if (failure === 'terminal-drift') (packets[9] as any).response.output[0].content[0].text = data.raw + ' ';
    if (failure === 'after-terminal') packets.push(packets[9]);
    let body = wire(packets);
    if (failure === 'duplicate-json') body = body.replace('"sequence_number":0', '"sequence_number":0,"sequence_number":0');
    if (failure === 'secret-echo') {
      const value = JSON.parse(data.raw), textQuestion = data.contract.task.questionnaire.questions.find(q => q.type === 'text')!;
      value.answers[textQuestion.id] = model.apiKey; body = wire(events(JSON.stringify(value)));
      assert.ok(body.includes(model.apiKey), 'The canary must really exist on the provider wire.');
    }
    const f = fixture(body, { fetchError: failure === 'socket-error' });
    try {
      await assert.rejects(f.call(), error => {
        assert.ok(error instanceof StructuredResponsesError); assert.equal(error.evidence.contentChunks, 0);
        assert.equal(error.evidence.assistantMessages, 0); assert.equal(error.evidence.toolCalls, 0); assert.equal(error.evidence.toolResults, 0);
        assert.ok(!JSON.stringify(error.evidence).includes(model.apiKey)); assert.ok(!error.message.includes(model.apiKey)); return true;
      });
      const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.usageStatus, 'incomplete');
      assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny); assert.equal(f.forwarded(), 1);
      await assert.rejects(f.call(0, 'resident-2'), error => error instanceof ExperimentBudgetError && error.code === 'halted'); assert.equal(f.forwarded(), 1);
    } finally { f.close(); }
  });
}

test('valid provider terminal with incomplete answer IDs still fails decoder and retains failed-call reservation', { timeout: 45_000 }, async () => {
  const value = JSON.parse(specimen().raw); delete value.answers['child-own-taste']; const f = fixture(wire(events(JSON.stringify(value))));
  try { await assert.rejects(f.call(), error => error instanceof StructuredResponsesError && error.code === 'RESPONSES_ANSWER_CONTRACT_REJECTED');
    const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.knownUsageRequestCount, 1);
    assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny); } finally { f.close(); }
});

test('wrong model ledger, insufficient full-schema budget and pre-cancel all stop before upstream', async () => {
  const cancelled = new AbortController(); cancelled.abort(new Error(model.apiKey));
  for (const options of [{ pricingModel: 'different-model' }, { budgetCny: 0 }, { signal: cancelled.signal }]) {
    const f = fixture(wire(events(specimen().raw)), options);
    try { await assert.rejects(f.call(), error => { assert.ok(error instanceof Error); assert.ok(!error.message.includes(model.apiKey)); return true; }); assert.equal(f.forwarded(), 0); } finally { f.close(); }
  }
});

test('a configured key pasted as request ID is rejected before any ledger write or child launch', async () => {
  const f = fixture(wire(events(specimen().raw)));
  try { await assert.rejects(f.call(0, model.apiKey)); assert.equal(f.forwarded(), 0); assert.equal(f.ledger().requestCount, 0);
    assert.ok(!JSON.stringify(f.ledger()).includes(model.apiKey)); } finally { f.close(); }
});

test('cancel at EOF cannot settle success or release the reservation', { timeout: 45_000 }, async () => {
  const cancellation = new AbortController(); const f = fixture(wire(events(specimen().raw)), { signal: cancellation.signal, abortAtEof: cancellation });
  try { await assert.rejects(f.call()); assert.equal(f.forwarded(), 1); const ledger = f.ledger(); assert.equal(ledger.state, 'halted');
    assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny); } finally { f.close(); }
});

test('reservation stays pending during owned cleanup; cleanup failure preserves it and does not hide its canary', { timeout: 45_000 }, async () => {
  const f = fixture(wire(events(specimen().raw))), originalClose = DeepSeekHarness.prototype.close;
  DeepSeekHarness.prototype.close = async function () {
    assert.equal(f.guard.snapshot().reservations[0].state, 'reserved');
    assert.throws(() => f.guard.reserve({ requestId: 'concurrent-intruder', purpose: 'resident', inputText: '{}', maxOutputTokens: 4096 }),
      error => error instanceof ExperimentBudgetError && error.code === 'pending-request');
    await originalClose.call(this); throw new Error(`synthetic cleanup ${model.apiKey}`);
  };
  try {
    await assert.rejects(f.call(), error => {
      assert.ok(error instanceof StructuredResponsesError); assert.equal(error.code, 'RESPONSES_CLEANUP_FAILED');
      assert.deepEqual(error.evidence.cleanupErrors, ['child-close']); assert.ok(!error.message.includes(model.apiKey)); return true;
    });
    const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.knownUsageRequestCount, 1);
    assert.equal(ledger.requestCount, 1); assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny);
    assert.equal(f.forwarded(), 1);
  } finally { DeepSeekHarness.prototype.close = originalClose; f.close(); }
});

test('late cancel after valid SDK output but during cleanup is not a successful settlement', { timeout: 45_000 }, async () => {
  const cancellation = new AbortController(), f = fixture(wire(events(specimen().raw)), { signal: cancellation.signal });
  const originalClose = DeepSeekHarness.prototype.close;
  DeepSeekHarness.prototype.close = async function () { await originalClose.call(this); cancellation.abort(); };
  try {
    await assert.rejects(f.call(), error => error instanceof StructuredResponsesError && error.code === 'RESPONSES_CANCELLED');
    const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.reservations[0].outcome, 'cancelled');
    assert.equal(ledger.knownUsageRequestCount, 1); assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny);
  } finally { DeepSeekHarness.prototype.close = originalClose; f.close(); }
});

test('a denied second request during SDK shutdown is captured by final sealed evidence and halts the ledger', { timeout: 45_000 }, async () => {
  const f = fixture(wire(events(specimen().raw))), originalClose = DeepSeekHarness.prototype.close;
  DeepSeekHarness.prototype.close = async function () {
    // Test-only fault injection: read solely this synthetic invocation's owned patch, never search other temp homes.
    const client = (this as unknown as { client: { options: { patches: string[] } } }).client;
    const patch = JSON.parse(readFileSync(client.options.patches[0], 'utf8'));
    const config = patch.find((item: { insert?: unknown[] }) => item.insert).insert[0].config;
    const late = await fetch(`http://127.0.0.1:${config.port}/v1/responses`, { method: 'POST', body: config.body,
      headers: { authorization: `Bearer ${config.relayToken}`, 'content-type': 'application/json' } });
    assert.equal(late.status, 409); await originalClose.call(this);
  };
  try {
    await assert.rejects(f.call(), error => {
      assert.ok(error instanceof StructuredResponsesError); assert.equal(error.code, 'RESPONSES_FINAL_WITNESS_CHANGED');
      assert.equal(error.evidence.transport?.requestAttempts, 2); assert.equal(error.evidence.transport?.deniedRequests, 1);
      assert.equal(error.evidence.transport?.forwardedRequests, 1); return true;
    });
    const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(f.forwarded(), 1);
    assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny);
    await assert.rejects(f.call(0, 'after-late-attempt'), error => error instanceof ExperimentBudgetError && error.code === 'halted');
  } finally { DeepSeekHarness.prototype.close = originalClose; f.close(); }
});

test('parent rejects independently injected SDK total/cache/reasoning/text/replay drift despite a valid wire', { timeout: 45_000 }, async () => {
  const originalRun = DeepSeekHarness.prototype.run;
  for (const field of ['total', 'cache', 'reasoning', 'text', 'replay'] as const) {
    const f = fixture(wire(events(specimen().raw)));
    DeepSeekHarness.prototype.run = async function (...args) {
      const result = await originalRun.apply(this, args), message = result.events.find(event => event.type === 'assistant/message');
      assert.ok(message && message.type === 'assistant/message');
      assert.ok(message.data.usage); const sdkUsage = message.data.usage;
      if (field === 'total') sdkUsage.totalTokens = 999;
      if (field === 'cache') { sdkUsage.inputTokens = 9; sdkUsage.cacheReadTokens = 4; }
      if (field === 'reasoning') sdkUsage.reasoningTokens = 1;
      if (field === 'text') result.finalResponse += ' ';
      if (field === 'replay') message.data.message.source.replayState = { response: { rawResponseHash: 'forged' } };
      return result;
    };
    try {
      await assert.rejects(f.call(), error => error instanceof StructuredResponsesError && ['RESPONSES_SDK_USAGE_MISMATCH', 'RESPONSES_REPLAY_MISMATCH'].includes(error.code));
      const ledger = f.ledger(); assert.equal(ledger.state, 'halted'); assert.equal(ledger.usageStatus, 'incomplete');
      assert.equal(ledger.committedNanoCny, ledger.reservations[0].reservationNanoCny); assert.equal(f.forwarded(), 1);
    } finally { DeepSeekHarness.prototype.run = originalRun; f.close(); }
  }
});
