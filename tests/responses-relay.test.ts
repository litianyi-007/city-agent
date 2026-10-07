import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { compileAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { createBusinessDemoRun, getBusinessDemos } from '../shared/research-demo';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { fingerprint } from '../shared/evidence';
import { compileResponsesRequest, createResponsesRelay, RESPONSES_INPUT_ENVELOPE_TOKENS, RESPONSES_REQUEST_VERSION,
  RESPONSES_RELAY_VERSION, RESPONSES_UPSTREAM_URL } from '../server/research/responses-relay';

const model = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', apiKey: 'offline-responses-fixture-key' };
const prompts = { system: '仅返回冻结问卷的JSON；未知用null，合法零保留。', user: '完成离线居民问卷，不执行任何工具。' };
const contract = compileAnswerContract(getBusinessDemos()[0].task, 'resident-offline', getBusinessDemos()[0].logicRules);
const frozen = compileResponsesRequest({ model, ...prompts, contract, maxOutputTokens: 4096 });
const hash = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; };

function eventsFor(text = '{"offline":true}', usage: any = { input_tokens: 13, output_tokens: 7, total_tokens: 20,
  input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 0 } }) {
  const part = { type: 'output_text', text, annotations: [] };
  const item = { id: 'msg_offline', type: 'message', status: 'completed', role: 'assistant', content: [part] };
  const response = { id: 'resp_offline', object: 'response', model: model.modelId, status: 'completed', error: null, incomplete_details: null, output: [item], usage };
  const halves = [...text], split = Math.floor(halves.length / 2);
  return [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.in_progress', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
    ...[halves.slice(0, split).join(''), halves.slice(split).join('')].map(delta => ({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta })),
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ].map((event, sequence_number) => ({ ...event, sequence_number })) as any[];
}

const wireFor = (events = eventsFor(), newline = '\n') => events.map(event => `event: ${event.type}${newline}data: ${JSON.stringify(event)}${newline}${newline}`).join('');
const responseFor = (wire = wireFor()) => new Response(wire, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const createRelay = (overrides: Partial<Parameters<typeof createResponsesRelay>[0]> = {}) => createResponsesRelay({ model, frozenRequest: frozen,
  reservedInputTokens: frozen.bodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS, upstreamFetch: async () => responseFor(), ...overrides });
const post = (relay: Awaited<ReturnType<typeof createResponsesRelay>>, body = frozen.body, token: string = relay.relayToken, path = '/v1/responses', signal?: AbortSignal) =>
  fetch(`${relay.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body, signal });
const assertPrivate = (relay: Awaited<ReturnType<typeof createResponsesRelay>>) => {
  const serialized = JSON.stringify(relay.snapshot());
  for (const privateValue of [model.apiKey, prompts.system, prompts.user, relay.relayToken, '{"offline":true}']) assert.equal(serialized.includes(privateValue), false);
  assert.equal(Object.hasOwn(relay.snapshot().providerWitness, 'text'), false);
  assert.equal(Object.hasOwn(relay.snapshot().providerWitness, 'responseId'), false);
};

test('compiler freezes complete 17/18-question schema and immutable whole-wire metadata without credentials', () => {
  for (const demo of getBusinessDemos()) {
    const compiledContract = compileAnswerContract(demo.task, 'resident-offline', demo.logicRules);
    const before = fingerprint(compiledContract), request = compileResponsesRequest({ model, ...prompts, contract: compiledContract, maxOutputTokens: 4096 });
    const payload = JSON.parse(request.body);
    assert.equal(request.version, RESPONSES_REQUEST_VERSION); assert.equal(Object.isFrozen(request), true);
    assert.equal(request.bodySha256, hash(request.body)); assert.equal(request.bodyUtf8Bytes, Buffer.byteLength(request.body));
    assert.equal(request.schemaHash, compiledContract.schemaHash); assert.equal(fingerprint(compiledContract), before);
    assert.deepEqual(payload.text.format.schema, JSON.parse(JSON.stringify(compiledContract.schema)));
    assert.equal(payload.text.format.schema.properties.answers.required.length, demo.task.questionnaire.questions.length);
    assert.equal(payload.store, false); assert.deepEqual(payload.tools, []); assert.equal(payload.tool_choice, 'none');
    assert.deepEqual(payload.reasoning, { effort: 'none' }); assert.equal(request.body.includes(model.apiKey), false);
  }
});

test('compiler rejects unregistered models, unsupported settings, secret inputs, drift and oversized complete body before listening', async () => {
  const base = { model, ...prompts, contract, maxOutputTokens: 4096 };
  const changedContract = structuredClone(contract); (changedContract.schema.properties as any).residentId.enum = ['wrong']; changedContract.schemaHash = fingerprint(changedContract.schema);
  for (const changed of [{ model: { ...model, provider: 'openai' } }, { model: { ...model, modelId: 'deepseek-other' } },
    { model: { ...model, baseUrl: 'https://api.deepseek.com/v1' } }, { model: { ...model, baseUrl: 'https://api.deepseek.com/?private=1' } },
    { model: { ...model, apiKey: '' } }, { model: { ...model, apiKey: 'key\nheader' } }, { model: { ...model, temperature: 0 } },
    { maxOutputTokens: 0 }, { maxOutputTokens: NaN }, { maxOutputTokens: 4096.5 }, { maxOutputTokens: 12001 },
    { system: '' }, { user: model.apiKey }, { user: [...model.apiKey].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('') },
    { user: 'x'.repeat(512001) }, { contract: changedContract }, { contract: { ...contract, taskHash: 'wrong' } }]) assert.throws(() => compileResponsesRequest({ ...base, ...changed }));
  assert.throws(() => compileResponsesRequest({ ...base, billingOverride: true } as any));
  await assert.rejects(createRelay({ reservedInputTokens: frozen.bodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS - 1 }), /预算/);
  await assert.rejects(createRelay({ frozenRequest: { ...frozen, bodySha256: 'wrong' } }));
  await assert.rejects(createRelay({ frozenRequest: { ...frozen, schemaHash: 'wrong' } }));
  const malformed = frozen.body.replace('"model":', '"model":"other","model":');
  await assert.rejects(createRelay({ frozenRequest: { ...frozen, body: malformed, bodySha256: hash(malformed), bodyUtf8Bytes: Buffer.byteLength(malformed) } }));
  await assert.rejects(createRelay({ signal: AbortSignal.abort() }));
});

test('relay forwards exactly the frozen official request using the provider key, but local authorization is an internal UUID', async () => {
  let calls = 0;
  const mutableModel = { ...model }, mutableFrozen = { ...frozen };
  const wire = wireFor();
  const relay = await createRelay({ model: mutableModel, frozenRequest: mutableFrozen, upstreamFetch: async (url, init) => {
    calls++; assert.equal(String(url), RESPONSES_UPSTREAM_URL); assert.equal(init?.body, frozen.body); assert.equal(init?.redirect, 'error');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` }); return responseFor(wire);
  } });
  mutableModel.apiKey = 'changed-key'; mutableFrozen.body = 'changed-body';
  try {
    assert.equal(new URL(relay.baseUrl).hostname, '127.0.0.1'); assert.notEqual(relay.relayToken, model.apiKey);
    const result = await post(relay); assert.equal(result.status, 200); assert.equal(await result.text(), wire);
    const stats = relay.snapshot();
    assert.equal(stats.relayVersion, RESPONSES_RELAY_VERSION); assert.equal(stats.requestAttempts, 1); assert.equal(stats.forwardedRequests, 1); assert.equal(stats.deniedRequests, 0);
    assert.equal(stats.providerStatus, 200); assert.equal(stats.bodyUtf8Bytes, frozen.bodyUtf8Bytes); assert.equal(stats.receivedBodyUtf8Bytes, frozen.bodyUtf8Bytes);
    assert.equal(stats.forwardedBodySha256, frozen.bodySha256); assert.equal(stats.providerWitness.rawResponseSha256, hash(wire));
    assert.equal(stats.providerWitness.responseIdSha256, hash('resp_offline'));
    assert.equal(stats.responseTextSha256, hash('{"offline":true}')); assert.equal(stats.providerWitness.state, 'reported');
    assert.deepEqual(stats.providerWitness.usage, { inputTokens: 13, outputTokens: 7, totalTokens: 20, cacheReadTokens: 5, reasoningTokens: 0 });
    assertPrivate(relay);
    assert.equal((await post(relay)).status, 409); assert.equal(calls, 1); assert.equal(relay.snapshot().deniedRequests, 1);
  } finally { await relay.close(); await relay.close(); }
});

test('bad JSON, auth, path, exact bytes and nested drift consume the first attempt with no corrected retry', async () => {
  const payload = JSON.parse(frozen.body);
  const attacks: { body?: string; token?: string; path?: string; method?: string }[] = [
    { body: '{bad-json' }, { token: model.apiKey }, { path: '/responses' }, { path: '/v1/responses?extra=1' }, { method: 'GET' },
    { body: frozen.body + ' ' }, { body: frozen.body.replace(prompts.user, '同长度也不允许替换输入') },
    { body: frozen.body.replace('"model":', '"\\u006dodel":"different","model":') },
    ...[{ ...payload, tools: [{ type: 'function', name: 'host' }] }, { ...payload, temperature: 0 }, { ...payload, max_output_tokens: 4097 },
      { ...payload, text: { ...payload.text, unregistered: 'x'.repeat(100_000) } }, { ...payload, input: [...payload.input, payload.input[1]] }].map(body => ({ body: JSON.stringify(body) })),
  ];
  for (const attack of attacks) {
    let calls = 0; const relay = await createRelay({ reservedInputTokens: 1_000_000, upstreamFetch: async () => { calls++; return responseFor(); } });
    try {
      const first = attack.method ? await fetch(`${relay.baseUrl}/v1/responses`, { method: attack.method, headers: { Authorization: `Bearer ${relay.relayToken}` } })
        : await post(relay, attack.body ?? frozen.body, attack.token ?? relay.relayToken, attack.path);
      assert.equal(first.status, 409); await first.text();
      const second = await post(relay); assert.equal(second.status, 409); await second.text();
      assert.equal(calls, 0); assert.equal(relay.snapshot().requestAttempts, 2); assert.equal(relay.snapshot().deniedRequests, 2);
      assert.equal(relay.snapshot().forwardedRequests, 0); assertPrivate(relay);
    } finally { await relay.close(); }
  }
});

test('full received bytes enforce both exact reservation and absolute 512KB ceiling', async () => {
  for (const [reservedInputTokens, body] of [[frozen.bodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS, frozen.body + ' '], [1_000_000, 'x'.repeat(512001)]] as const) {
    let calls = 0; const relay = await createRelay({ reservedInputTokens, upstreamFetch: async () => { calls++; return responseFor(); } });
    try { const result = await post(relay, body); assert.equal(result.status, 409); await result.text(); assert.equal(calls, 0); assert.equal((await post(relay)).status, 409); }
    finally { await relay.close(); }
  }
});

test('legal zero usage and full business responses survive UTF-8 one-byte chunks and multiple text deltas', async () => {
  for (const demo of getBusinessDemos()) {
    const { run } = await createBusinessDemoRun({ demoId: demo.id, population: getPopulationModel(), pack: getPopulationPack() });
    const record = run.responses[0], raw = encodeAnswerContract(record.residentId, record.answers);
    const ownFrozen = compileResponsesRequest({ model, ...prompts, contract: compileAnswerContract(run.task, record.residentId, demo.logicRules), maxOutputTokens: 4096 });
    const wire = wireFor(eventsFor(raw, { input_tokens: 0, output_tokens: 0, total_tokens: 0 }), '\r\n');
    const bytes = Buffer.from(wire);
    const relay = await createRelay({ frozenRequest: ownFrozen, reservedInputTokens: ownFrozen.bodyUtf8Bytes + RESPONSES_INPUT_ENVELOPE_TOKENS,
      upstreamFetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }),
        { headers: { 'content-type': 'text/event-stream' } }) });
    try {
      const result = await post(relay, ownFrozen.body); assert.equal(result.status, 200); assert.equal(await result.text(), wire);
      assert.equal(relay.snapshot().responseTextSha256, hash(raw)); assert.equal(relay.snapshot().providerWitness.rawResponseSha256, hash(wire));
      assert.deepEqual(relay.snapshot().providerWitness.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 });
    } finally { await relay.close(); }
  }
});

test('no successful header or text escapes until EOF and complete semantic/usage evidence passes', async () => {
  const ready = deferred<void>(), finish = deferred<void>(), wire = wireFor();
  const relay = await createRelay({ upstreamFetch: async () => new Response(new ReadableStream<Uint8Array>({ async start(controller) {
    controller.enqueue(Buffer.from(wire)); ready.resolve(); await finish.promise; controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }) });
  let headersReleased = false;
  const pending = post(relay).then(response => { headersReleased = true; return response; });
  try {
    await ready.promise; await tick(); await tick();
    assert.equal(headersReleased, false); assert.equal(relay.snapshot().providerWitness.state, 'pending'); assert.equal(relay.snapshot().responseTextSha256, null);
    finish.resolve(); const result = await pending; assert.equal(result.status, 200); assert.equal(await result.text(), wire);
  } finally { finish.resolve(); await relay.close(); }
});

test('missing, contradictory, truncated, refusal and tool responses yield only sanitized failure and never retry', async () => {
  const absent = eventsFor(); delete absent.at(-1).response.usage;
  const wrongTotal = eventsFor(); wrongTotal.at(-1).response.usage.total_tokens = 999;
  const refusal = eventsFor(); refusal[3].part = { type: 'refusal', refusal: `private-${model.apiKey}` };
  const tool = eventsFor(); tool[0].response.output = [{ type: 'function_call', name: 'host-tool' }];
  for (const wire of [wireFor(eventsFor(undefined, null)), wireFor(absent), wireFor(wrongTotal), wireFor(eventsFor().slice(0, -1)), wireFor(refusal), wireFor(tool), wireFor().slice(0, -1)]) {
    let calls = 0; const relay = await createRelay({ upstreamFetch: async () => { calls++; return responseFor(wire); } });
    try {
      const result = await post(relay); assert.equal(result.status, 502); const text = await result.text();
      assert.equal(text.includes(model.apiKey), false); assert.equal(text.includes('offline'), false);
      assert.notEqual(relay.snapshot().providerWitness.state, 'reported'); assert.equal(relay.snapshot().providerWitness.usage, null); assert.equal(relay.snapshot().responseTextSha256, null);
      assertPrivate(relay); assert.equal((await post(relay)).status, 409); assert.equal(calls, 1);
    } finally { await relay.close(); }
  }
});

test('provider HTTP/non-SSE, secret echoes and transport errors never forward raw content', async () => {
  const secretIdentity = eventsFor(); for (const event of secretIdentity) if (event.response) event.response.id = model.apiKey;
  const escapedKey = [...model.apiKey].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const earlySecretUpstreamFetch = async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(Buffer.from(wireFor(secretIdentity.slice(0, 1)))); controller.enqueue(Buffer.of(0xff)); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  for (const upstreamFetch of [async () => new Response(`private ${model.apiKey}`, { status: 401 }),
    async () => new Response('{"offline":true}', { headers: { 'content-type': 'application/json' } }),
    async () => responseFor(wireFor(eventsFor(JSON.stringify({ echo: model.apiKey })))),
    async () => responseFor(wireFor(eventsFor(JSON.stringify({ echo: [...model.apiKey].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('') })))),
    async () => responseFor(wireFor(secretIdentity)),
    async () => responseFor(wireFor(secretIdentity).replaceAll(model.apiKey, escapedKey)),
    earlySecretUpstreamFetch,
    async () => { throw new Error(`private error ${model.apiKey}`); }]) {
    const relay = await createRelay({ upstreamFetch });
    try {
      const result = await post(relay); assert.equal(result.status, 502); const raw = await result.text(); assert.equal(raw.includes(model.apiKey), false);
      assert.notEqual(relay.snapshot().providerWitness.state, 'reported'); assert.equal(relay.snapshot().providerWitness.usage, null); assert.equal(relay.snapshot().responseTextSha256, null);
      if (upstreamFetch === earlySecretUpstreamFetch) assert.equal(relay.snapshot().providerWitness.responseIdSha256, hash(model.apiKey));
      assertPrivate(relay);
    } finally { await relay.close(); }
  }
});

test('a concurrent second attempt prevents the charged first request from returning successful text', async () => {
  const ready = deferred<void>(), finish = deferred<void>(); let calls = 0;
  const relay = await createRelay({ upstreamFetch: async () => { calls++; ready.resolve(); await finish.promise; return responseFor(); } });
  const first = post(relay);
  try {
    await ready.promise; const second = await post(relay); assert.equal(second.status, 409); await second.text(); finish.resolve();
    const result = await first; assert.equal(result.status, 502); await result.text();
    assert.equal(calls, 1); assert.equal(relay.snapshot().requestAttempts, 2); assert.equal(relay.snapshot().deniedRequests, 1);
    assert.equal(relay.snapshot().providerWitness.reason, 'invocation-policy-violated'); assert.equal(relay.snapshot().responseTextSha256, null);
  } finally { finish.resolve(); await relay.close(); }
});

test('external cancellation, client cancellation and close terminate pending readers and transports without hanging', async () => {
  for (const kind of ['external', 'client', 'close'] as const) {
    const ready = deferred<void>(), external = new AbortController(), client = new AbortController();
    const relay = await createRelay({ signal: external.signal, upstreamFetch: async () => { ready.resolve();
      // An injected transport ignoring AbortSignal must not retain an owned server/task.
      return kind === 'close' ? await new Promise<Response>(() => {}) : new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from(wireFor(eventsFor().slice(0, 3)))); } }),
        { headers: { 'content-type': 'text/event-stream' } });
    } });
    const pending = post(relay, frozen.body, relay.relayToken, '/v1/responses', client.signal).then(async result => ({ status: result.status, body: await result.text() }), () => ({ status: 0, body: '' }));
    try {
      await ready.promise;
      if (kind === 'external') external.abort(); else if (kind === 'client') client.abort(); else await relay.close();
      const result = await pending; assert.ok([0, 502].includes(result.status));
      await relay.close();
      assert.equal(relay.snapshot().forwardedRequests, 1); assert.equal(relay.snapshot().providerWitness.state, 'transport-failed'); assert.equal(relay.snapshot().responseTextSha256, null);
    } finally { await relay.close(); }
  }
});

test('an oversized upstream response fails closed with no SDK-visible partial result', async () => {
  const relay = await createRelay({ upstreamFetch: async () => responseFor('x'.repeat(512_001)) });
  try {
    const result = await post(relay); assert.equal(result.status, 502); assert.equal((await result.text()).includes('xxx'), false);
    assert.equal(relay.snapshot().providerWitness.state, 'invalid'); assert.equal(relay.snapshot().providerWitness.reason, 'response-size-limit');
    assert.equal(relay.snapshot().providerWitness.rawResponseSha256, null);
    assert.equal(relay.snapshot().responseTextSha256, null);
  } finally { await relay.close(); }
});
