import assert from 'node:assert/strict';
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import test from 'node:test';
import { jevConfigSchema, type JevCandidateContext } from '../shared/jev-schema.ts';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.ts';
import { buildJevCandidateRequest } from '../server/production/jev.ts';
import { prepareVerifierWirePreflight } from '../server/production/verifier-wire-preflight.ts';
import { assertVerifierStudyTransport, createVerifierStudyRedactor, createVerifierStudyTransport, VerifierStudyTransportError, type VerifierStudyTransportOptions } from '../server/production/verifier-study-transport.ts';

const keys = { llmKey: 'synthetic-llm-transport-fixture-not-real', jevKey: 'synthetic-jev-transport-fixture-not-real' };
const configuration = {
  verifier: { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Verifier', role: 'verifier', enabled: true, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true, pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } },
  jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true },
};
const request = verifierPreparationRequests('H01');
const signal = () => new AbortController().signal;
const guards = { assertAuthorized: () => {}, assertFresh: () => {} };
function jevReply(context: JevCandidateContext, options: { usage?: unknown; malformed?: boolean; model?: string } = {}) {
  const envelope = buildJevCandidateRequest('jev-1.13.0', context); const answers: Record<string, unknown> = {};
  for (const [index] of context.candidates.entries()) {
    for (const dimension of ['coverage', 'consistency', 'scope']) answers[`c${index}_${dimension}`] = { type: 'score', score: 4, confidence: 1, probabilities: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 1 }, legend: Object.fromEntries((envelope.questions[`c${index}_${dimension}`].criteria as string[]).map((label, score) => [score, label])) };
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  }
  answers.best = { type: 'choice', choice: context.candidates[0].id, confidence: 1, probabilities: Object.fromEntries([...context.candidates.map((candidate, index) => [candidate.id, index === 0 ? 1 : 0]), ['abstain', 0]]) };
  if (options.malformed) answers.c1_scope = { invalid: true };
  return { model: options.model ?? 'jev-1.13.0', answers, ...(Object.hasOwn(options, 'usage') ? options.usage === undefined ? {} : { usage: options.usage } : { usage: { input_tokens: 101, output_tokens: 7 } }) };
}
const jevFetch: typeof fetch = async () => new Response(JSON.stringify(jevReply(request.snapshot)));
async function withProvider(handler: (response: ServerResponse, body: unknown, request: IncomingMessage) => void, run: (baseUrl: string, closed: () => boolean) => Promise<void>) {
  let handlerError: unknown; let closed = false; let posts = 0;
  const server = createServer(async (req, res) => {
    try { const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
      posts++; assert.equal(posts, 1); assert.equal(req.headers.authorization, `Bearer ${keys.llmKey}`);
      res.once('close', () => { closed = true; }); handler(res, JSON.parse(Buffer.concat(chunks).toString()), req);
    } catch (error) { handlerError = error; res.writeHead(400); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, () => closed); if (handlerError) throw handlerError; }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function stream(response: ServerResponse, kind = 'success', text = '{"fixture":true}') {
  if (kind === 'http400') { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: `${keys.llmKey} ${keys.jevKey}` } })); return; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  if (kind === 'halfcut') { response.end('data: {"choices":'); return; }
  if (kind === 'pending') { response.write(': pending fixture\n\n'); return; }
  const usage = kind === 'missing' ? undefined : kind === 'partial' ? { prompt_tokens: 13 } : kind === 'zero' ? { prompt_tokens: 0, completion_tokens: 0 } : { prompt_tokens: 13, completion_tokens: 7 };
  const content = kind === 'empty' ? '' : kind === 'length' ? '{"partial":' : text;
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: kind === 'length' ? 'length' : 'stop' }], ...(usage ? { usage } : {}) })}\n\n`); response.end('data: [DONE]\n\n');
}
const local = (baseUrl: string, override: Partial<VerifierStudyTransportOptions> = {}) => createVerifierStudyTransport({ configuration: structuredClone(configuration), secrets: { ...keys }, guards, engineering: { llmBaseUrl: baseUrl, jevFetch }, ...override });

test('factory brand rejects forged callbacks and default deny blocks both transports before dispatch', async () => {
  const transport = createVerifierStudyTransport({ configuration, secrets: keys });
  assertVerifierStudyTransport(transport); assert.ok(Object.isFrozen(transport)); assert.ok(Object.isFrozen(transport.publicConfiguration.verifier));
  assert.throws(() => assertVerifierStudyTransport({ ...transport })); assert.throws(() => assertVerifierStudyTransport({ executionSource: 'real-provider', llm: async () => '{}' }));
  for (const call of [() => transport.llm(request.logicalLlm, signal()), () => transport.jev(request.snapshot, signal())]) await assert.rejects(call(), (error: unknown) => {
    assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.text, null); assert.equal(error.result.observation.status, 'denied'); assert.equal(error.result.observation.actualProviderHttpAttempts, 0); assert.equal(error.result.usage.complete, false); return true;
  });
  assert.equal(JSON.stringify(transport.publicConfiguration).includes(keys.llmKey), false);
});

test('strict config, explicit independent secrets, official endpoints and public-contract collisions fail closed', () => {
  assert.throws(() => createVerifierStudyTransport({ configuration: { ...configuration, verifier: { ...configuration.verifier, apiKey: keys.llmKey } }, secrets: keys }));
  assert.throws(() => createVerifierStudyTransport({ configuration: { ...configuration, verifier: { ...configuration.verifier, baseUrl: 'https://attacker.invalid' } }, secrets: keys }), /official/);
  assert.throws(() => createVerifierStudyTransport({ configuration, secrets: { ...keys, llmKey: 'tiny' } }), /credential policy/);
  assert.throws(() => createVerifierStudyTransport({ configuration: { ...configuration, verifier: { ...configuration.verifier, name: keys.jevKey } }, secrets: keys }), /collides/);
  assert.throws(() => createVerifierStudyTransport({ configuration, secrets: { ...keys, llmKey: 'configurationSha256' } }), /collides/);
  assert.throws(() => createVerifierStudyTransport({ configuration: { ...configuration, verifier: { ...configuration.verifier, [keys.llmKey]: 1, [keys.jevKey]: 2 } }, secrets: keys }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message.includes(keys.llmKey), false); assert.equal(error.message.includes(keys.jevKey), false); return true;
  });
  assert.throws(() => local('http://localhost:44444'), /literal loopback/); assert.throws(() => local('https://127.0.0.1:44444'), /literal loopback/);
  assert.throws(() => local('http://127.0.0.1:44444/path'), /literal loopback/);
});

test('two-key exact redaction masks raw and four-level JSON encodings including property names', () => {
  const legacy = { llmKey: 'legacy-model-key-"quote"-\\slash', jevKey: 'legacy-jev-key-"quoted"-\\path' };
  const redact = createVerifierStudyRedactor(legacy); const value: Record<string, unknown> = {};
  for (const key of Object.values(legacy)) { let encoded = key;
    for (let depth = 0; depth <= 4; depth++) { value[encoded] = { echo: encoded, nested: [JSON.stringify({ echoed: encoded })] }; encoded = JSON.stringify(encoded).slice(1, -1); }
  }
  // Different original properties masking to the same name fail closed.
  assert.throws(() => redact(value), /property-name collision/);
  for (const [property, child] of Object.entries(value)) {
    const result = JSON.stringify(redact({ [property]: child }));
    for (const key of Object.values(legacy)) { let encoded = key; for (let depth = 0; depth <= 4; depth++) { assert.equal(result.includes(encoded), false); encoded = JSON.stringify(encoded).slice(1, -1); } }
    assert.match(result, /REDACTED/);
  }
});

test('replacement-created keys and complete JSON serialization residuals fail closed without repeated rewriting', () => {
  const pathological = { llmKey: 'abcdefghijklmnop', jevKey: 'abcdefgh[REDACTED]xy' };
  const redact = createVerifierStudyRedactor(pathological);
  assert.throws(() => redact('abcdefgh' + pathological.llmKey + 'xy'), /redaction residual/);
  assert.throws(() => createVerifierStudyTransport({ configuration, secrets: pathological }), /replacement marker/);
  const numeric = createVerifierStudyRedactor({ llmKey: '1234567890123456', jevKey: keys.jevKey });
  assert.throws(() => numeric({ tokens: 1234567890123456 }), /redaction residual/);
  const array = createVerifierStudyRedactor({ llmKey: '1,2,3,4,5,6,7,8,9,10', jevKey: keys.jevKey });
  assert.throws(() => array({ numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), /redaction residual/);
});

test('actual pinned SDK sends exact full corpus wire and separates fixture POSTs from real usage', { timeout: 45_000 }, async () => {
  let authorized = 0; let fresh = 0;
  await withProvider((res, body, req) => {
    const expected = prepareVerifierWirePreflight(request.logicalLlm, { provider: 'deepseek', upstreamBaseUrl: configuration.verifier.baseUrl, modelId: configuration.verifier.modelId, maxOutputTokens: 4096, timeoutMs: 120000 });
    assert.deepEqual(body, expected.expectedBody); assert.equal(req.url, `${expected.offlineCompatibilityPath}/chat/completions`); stream(res);
  }, async (url, closed) => {
    const transport = local(url, { guards: { assertAuthorized: context => { authorized++; assert.equal(context.engine, 'llm'); assert.equal(context.poolId, 'H01'); assert.equal(context.configurationSha256, transport.configurationSha256); }, assertFresh: () => { fresh++; } } });
    const result = await transport.llm(request.logicalLlm, signal());
    assert.equal(result.text, '{"fixture":true}'); assert.equal(authorized, 1); assert.equal(fresh, 2); assert.equal(closed(), true);
    assert.deepEqual(result.usage, { inputTokens: 13, outputTokens: 7, estimatedCost: 0.0000123, complete: true, currency: 'USD' });
    assert.equal(result.observation.actualProviderHttpAttempts, 0); assert.equal(result.observation.localFixtureHttpAttempts, 1); assert.equal(result.observation.fixtureDispatchKind, 'loopback-http-post'); assert.equal(result.observation.returnedModelId, null);
    assert.equal(result.observation.cleanupAwaited, true); assert.equal(result.observation.responseFormat?.evidence, 'wire-observed');
  });
});

test('missing/partial usage remains unknown while explicit protocol zero is known', { timeout: 100_000 }, async () => {
  for (const kind of ['missing', 'partial', 'zero']) await withProvider(res => stream(res, kind), async url => {
    const result = await local(url).llm(request.logicalLlm, signal());
    assert.equal(result.usage.complete, kind === 'zero'); assert.equal(result.usage.inputTokens, kind === 'zero' ? 0 : null); assert.equal(result.usage.outputTokens, kind === 'zero' ? 0 : null);
    assert.equal(result.usage.estimatedCost, kind === 'zero' ? 0 : null); assert.equal(result.observation.localFixtureHttpAttempts, 1);
  });
});

test('HTTP400, halfcut, empty and length failures preserve observations but never provide a normal answer', { timeout: 120_000 }, async () => {
  for (const kind of ['http400', 'halfcut', 'empty', 'length']) await withProvider(res => stream(res, kind), async url => {
    await assert.rejects(local(url).llm(request.logicalLlm, signal()), (error: unknown) => {
      assert.ok(error instanceof VerifierStudyTransportError); const result = error.result;
      assert.equal(result.text, null); assert.equal(result.observation.status, 'failed'); assert.equal(result.observation.localFixtureHttpAttempts, 1); assert.equal(result.observation.actualProviderHttpAttempts, 0);
      assert.equal(result.observation.cleanupAwaited, true); assert.equal(JSON.stringify(result).includes(keys.llmKey), false); assert.equal(JSON.stringify(result).includes(keys.jevKey), false);
      assert.equal(result.usage.complete, kind === 'length' || kind === 'empty');
      if (kind === 'length' || kind === 'empty') { assert.equal(result.rawOutput, kind === 'length' ? '{"partial":' : ''); assert.equal(result.usage.inputTokens, 13); assert.equal(result.usage.outputTokens, 7); }
      else assert.equal(result.usage.inputTokens, null); return true;
    });
  });
});

test('SDK cancellation awaits provider disconnection; pre-cancel and invalid request never dispatch', { timeout: 45_000 }, async () => {
  const controller = new AbortController();
  await withProvider(res => { stream(res, 'pending'); setTimeout(() => controller.abort(), 20); }, async (url, closed) => {
    const transport = local(url);
    await assert.rejects(transport.llm(request.logicalLlm, controller.signal), (error: unknown) => {
      assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.name, 'AbortError'); assert.equal(error.result.observation.localFixtureHttpAttempts, 1);
      assert.equal(error.result.observation.cleanupAwaited, true); assert.equal(error.result.usage.inputTokens, null); return true;
    });
    assert.equal(closed(), true);
    await assert.rejects(transport.llm(request.logicalLlm, controller.signal), (error: unknown) => { assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.observation.actualProviderHttpAttempts, 0); assert.equal(error.result.observation.localFixtureHttpAttempts, 0); return true; });
    await assert.rejects(transport.llm({ ...request.logicalLlm, userPrompt: request.logicalLlm.userPrompt + ' extra' }, signal()), /fixed 18-pool/);
  });
});

test('cancelling after complete raw wire during SDK teardown retains empty-call usage without a selectable answer', { timeout: 45_000 }, async () => {
  const controller = new AbortController();
  await withProvider(res => { stream(res, 'empty'); setTimeout(() => controller.abort(), 50); }, async (url, closed) => {
    await assert.rejects(local(url).llm(request.logicalLlm, controller.signal), (error: unknown) => {
      assert.ok(error instanceof VerifierStudyTransportError); assert.equal(controller.signal.aborted, true);
      assert.equal(error.result.observation.status, 'cancelled'); assert.equal(error.result.text, null); assert.equal(error.result.rawOutput, '');
      assert.equal(error.result.observation.localFixtureHttpAttempts, 1); assert.equal(error.result.observation.cleanupAwaited, true);
      assert.equal(error.result.usage.complete, true); assert.equal(error.result.usage.inputTokens, 13); assert.equal(error.result.usage.outputTokens, 7); return true;
    });
    assert.equal(closed(), true);
  });
});

test('source guard failing after a completed SDK reply retains known usage and HTTP counts', { timeout: 45_000 }, async () => {
  let fresh = 0;
  await withProvider(res => stream(res), async url => {
    const transport = local(url, { guards: { assertAuthorized: () => {}, assertFresh: () => { if (++fresh === 2) throw new Error(`Drift ${keys.llmKey} ${keys.jevKey}`); } } });
    await assert.rejects(transport.llm(request.logicalLlm, signal()), (error: unknown) => {
      assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.text, null); assert.equal(error.result.rawOutput, '{"fixture":true}'); assert.equal(error.result.usage.inputTokens, 13);
      assert.equal(error.result.observation.localFixtureHttpAttempts, 1); assert.equal(error.result.observation.status, 'failed'); assert.equal(JSON.stringify(error.result).includes(keys.jevKey), false); return true;
    });
  });
});

test('trusted Jev adapter snapshots exact official requests, returned identity and known protocol-error usage', async () => {
  for (const kind of ['accepted', 'missing', 'partial', 'zero', 'protocol-error', 'model-mismatch', 'http400']) {
    let fetches = 0;
    const transport = local('http://127.0.0.1:44444', { engineering: { llmBaseUrl: 'http://127.0.0.1:44444', jevFetch: async (url, init) => {
      fetches++; assert.equal(String(url), 'https://api.typesafe.ai/v1/systemone'); assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), request.jev); assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${keys.jevKey}`);
      const options = kind === 'missing' ? { usage: undefined } : kind === 'partial' ? { usage: { input_tokens: 101 } } : kind === 'zero' ? { usage: { input_tokens: 0, output_tokens: 0 } } : kind === 'protocol-error' ? { malformed: true } : kind === 'model-mismatch' ? { model: 'unexpected-fixture-model' } : {};
      return new Response(JSON.stringify(jevReply(request.snapshot, options)), { status: kind === 'http400' ? 400 : 200 });
    } } });
    const result = await transport.jev(request.snapshot, signal()); assert.equal(fetches, 1); assert.equal(result.observation.actualProviderHttpAttempts, 0); assert.equal(result.observation.localFixtureHttpAttempts, 1);
    assert.equal(result.observation.cleanupAwaited, true); assert.equal(result.observation.fixtureDispatchKind, 'in-memory-fetch'); assert.equal(result.usage.complete, !['missing', 'partial', 'http400'].includes(kind));
    assert.equal(result.status, kind === 'accepted' || kind === 'zero' ? 'accepted' : 'error');
    if (kind === 'protocol-error' || kind === 'model-mismatch') assert.equal(result.usage.inputTokens, 101);
    if (kind === 'model-mismatch') assert.equal(result.observation.returnedModelId, 'unexpected-fixture-model');
    assert.equal(JSON.stringify(result).includes(keys.jevKey), false);
  }
});

test('both-key provider echoes are masked in LLM text, Jev raw body and returned model/property names', { timeout: 45_000 }, async () => {
  await withProvider(res => stream(res, 'success', JSON.stringify({ [keys.jevKey]: keys.llmKey, nested: JSON.stringify({ [keys.llmKey]: keys.jevKey }) })), async url => {
    const result = await local(url).llm(request.logicalLlm, signal());
    assert.equal(JSON.stringify(result).includes(keys.llmKey), false); assert.equal(JSON.stringify(result).includes(keys.jevKey), false); assert.match(result.text, /REDACTED/);
  });
  const transport = local('http://127.0.0.1:44444', { engineering: { llmBaseUrl: 'http://127.0.0.1:44444', jevFetch: async () => new Response(JSON.stringify({ ...jevReply(request.snapshot), model: keys.llmKey, [keys.jevKey]: JSON.stringify({ [keys.llmKey]: keys.jevKey }) })) } });
  const result = await transport.jev(request.snapshot, signal());
  assert.equal(result.status, 'error'); assert.equal(JSON.stringify(result).includes(keys.llmKey), false); assert.equal(JSON.stringify(result).includes(keys.jevKey), false);
});

test('trusted Jev stream cancellation awaits reader cancellation and unknown usage remains null', async () => {
  const controller = new AbortController(); let cancelled = false;
  const transport = local('http://127.0.0.1:44444', { engineering: { llmBaseUrl: 'http://127.0.0.1:44444', jevFetch: async () => new Response(new ReadableStream({ start(output) { output.enqueue(new TextEncoder().encode('{"partial":')); setTimeout(() => controller.abort(), 20); }, async cancel() { await new Promise(resolve => setTimeout(resolve, 25)); cancelled = true; } })) } });
  await assert.rejects(transport.jev(request.snapshot, controller.signal), (error: unknown) => {
    assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.observation.status, 'cancelled'); assert.equal(error.result.observation.localFixtureHttpAttempts, 1); assert.equal(error.result.usage.inputTokens, null); return true;
  });
  assert.equal(cancelled, true);
});

test('Jev property collision cannot be hidden by existing one-key sanitizer or silently overwrite evidence', async () => {
  for (const pair of [[keys.llmKey, keys.jevKey], [keys.jevKey, '[REDACTED]']]) {
    const transport = local('http://127.0.0.1:44444', { engineering: { llmBaseUrl: 'http://127.0.0.1:44444', jevFetch: async () => new Response(JSON.stringify({ ...jevReply(request.snapshot), [pair[0]]: 'first', [pair[1]]: 'second' })) } });
    await assert.rejects(transport.jev(request.snapshot, signal()), (error: unknown) => {
      assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.text, null); assert.equal(error.result.usage.inputTokens, 101);
      assert.match(error.message, /property-name collision/); assert.equal(error.result.observation.localFixtureHttpAttempts, 1); assert.equal(JSON.stringify(error.result).includes(keys.llmKey), false); assert.equal(JSON.stringify(error.result).includes(keys.jevKey), false); return true;
    });
  }
});

test('async permission checks deny before dispatch and rejected permission promises are safely consumed', async () => {
  const transport = local('http://127.0.0.1:44444', { guards: { assertAuthorized: async () => { throw new Error(`${keys.llmKey} ${keys.jevKey}`); }, assertFresh: () => {} } });
  await assert.rejects(transport.llm(request.logicalLlm, signal()), (error: unknown) => {
    assert.ok(error instanceof VerifierStudyTransportError); assert.equal(error.result.observation.localFixtureHttpAttempts, 0); assert.equal(error.result.observation.status, 'denied'); return true;
  });
  await new Promise(resolve => setImmediate(resolve));
});
