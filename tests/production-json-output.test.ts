import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { HARNESS_JSON_OUTPUT_VERSION, type runRole } from '../server/harness.ts';
import { ProductionPipeline, type ProductionOptions } from '../server/production/pipeline.ts';
import { hash, ProductionStore } from '../server/production/store.ts';
import { demoChecks, demoHtml } from '../server/production/fixtures.ts';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.ts';
import { productionApiKeySchema, productionRunInputSchema, type ProductionRun, type ProductionRunInput, type ProductionRole } from '../shared/production-schema.ts';

function answer(role: ProductionRole, data: any, input: ProductionRunInput): unknown {
  if (role === 'verifier') return { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Free local fixture; not real quality evidence' })), reason: 'Injected oracle only' };
  if (role === 'product') return { goal: input.brief, scope: 'offline-single-html', acceptance: [input.requirement.acceptance], exclusions: ['No network or host scripts'] };
  if (role === 'researcher') return { observations: ['Use supplied task-list requirements'], constraints: ['Offline HTML; immutable acceptance'], unknowns: ['deferred: real model delivery remains unverified'] };
  if (role === 'project-manager') return { decision: data.context.gate?.passed === false ? 'revise' : 'proceed', summary: 'Use the frozen result contract', tasks: [{ id: 'build', owner: 'developer', description: 'Implement and verify all frozen business checks' }], risks: [] };
  if (role === 'tester') return { checks: demoChecks('create') };
  return { html: demoHtml(input) };
}

function setup(t: TestContext, options: ProductionOptions, mode: 'live' | 'demo' = 'live', baseUrl = 'https://example.invalid', mixed = false) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-json-output-unit-')); const store = new ProductionStore(directory);
  for (const [index, agent] of store.agents().entries()) store.patchAgent(agent.id, { provider: mixed ? (['deepseek', 'anthropic', 'openai-compatible'] as const)[index % 3] : 'deepseek', baseUrl, modelId: agent.role, apiKey: `json-output-synthetic-token-${agent.role}`, pricing: { currency: 'USD', inputPerMillion: 0.3, outputPerMillion: 1.2 } });
  const benchmark = PRODUCTION_DEMO_CASES[0]; const input = productionRunInputSchema.parse({ brief: benchmark.brief, mode, ...(mode === 'demo' ? { demoCaseId: benchmark.operation } : {}), agentIds: store.agents().map(agent => agent.id), budgetAuthorized: mode === 'live', requirement: { id: benchmark.id, source: 'Free injected/local-provider engineering fixture; not a real delivery', acceptance: benchmark.acceptance, kind: 'illustrative' } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'queued', createdAt: new Date().toISOString(), evidenceKind: mode === 'demo' ? 'fixture' : 'injected-test', agentSnapshot: store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
  store.addRun(run, input.agentIds);
  const pipeline = new ProductionPipeline(store, { acceptancePreflight: async () => ({ valid: true, errors: [] }), gate: async () => ({ passed: true, checks: [{ name: 'Injected Gate, not browser evidence', passed: true }] }), ...options });
  t.after(async () => { await pipeline.stop(); rmSync(directory, { recursive: true, force: true }); });
  return { store, run, input, pipeline, async execute() { pipeline.start(store.run(run.id)!); const deadline = Date.now() + 90_000; while (pipeline.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(pipeline.busy, false); return store.run(run.id)!; } };
}

function complete(res: ServerResponse, text: string) { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const event of [{ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7 } }]) res.write(`data: ${JSON.stringify(event)}\n\n`); res.end('data: [DONE]\n\n'); }

test('all six actual SDK roles including HTML developer and independent Verifier request native JSON with versioned frozen evidence', { timeout: 90_000 }, async t => {
  const observed: Array<{ model: ProductionRole; body: Record<string, unknown> }> = []; let input!: ProductionRunInput; let handlerError: unknown;
  const server = createServer(async (req, res) => { try { let text = ''; for await (const chunk of req) text += chunk; const body = JSON.parse(text); observed.push({ model: body.model, body }); assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.tools, undefined); const prompt = JSON.parse(body.messages.findLast((message: any) => message.role === 'user').content); complete(res, JSON.stringify(answer(body.model, prompt, input))); } catch (error) { handlerError = error; res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Free fixture failure"}}'); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const baseUrl = `http://127.0.0.1:${address.port}/v1`; let identityChecks = 0;
  // Trusted engineering-only guard for this exact disposable local provider.
  // This is not a ready production boot or an autonomous/model-quality result.
  const fixture = setup(t, { assertExecutionFresh: () => { identityChecks++; assert.equal(new URL(baseUrl).hostname, '127.0.0.1'); assert.equal(new URL(baseUrl).port, String(address.port)); } }, 'live', baseUrl); input = fixture.input; const run = await fixture.execute(); if (handlerError) throw handlerError;
  assert.equal(identityChecks, 12, 'Every local SDK invocation passes the explicit engineering dispatch boundary');
  assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test', 'An injected Gate is not autonomous delivery proof'); assert.equal(observed.length, 12); assert.equal(new Set(observed.map(call => call.model)).size, 6);
  for (const call of run.calls) { assert.equal(call.executionSource, 'harness'); assert.deepEqual(call.responseFormat, { version: HARNESS_JSON_OUTPUT_VERSION, mode: 'json-object', evidence: 'wire-observed' }); assert.equal(call.providerRequests?.requests, 1); assert.equal(call.usage.inputTokens, 13); assert.equal(call.usage.outputTokens, 7); }
  assert.equal(run.validationContract?.harnessJsonOutputVersion, HARNESS_JSON_OUTPUT_VERSION); assert.equal(run.validationContract?.responseFormatPolicy, 'deepseek-json-object-other-prompt-only'); assert.equal(run.frozenContract?.validationContractHash, hash(run.validationContract));
  const manifest = JSON.parse(fixture.store.readArtifact(run.id, 'delivery-manifest.json')); assert.equal(manifest.harnessJsonOutputVersion, HARNESS_JSON_OUTPUT_VERSION); assert.equal(manifest.responseFormats.length, 12); assert.deepEqual(manifest.validationContract, run.validationContract);
  const evidence = JSON.parse(fixture.store.readArtifact(run.id, 'evidence.json')); assert.deepEqual(evidence.calls.map((call: any) => call.responseFormat), run.calls.map(call => call.responseFormat)); assert.equal(JSON.stringify(evidence).includes('json-output-synthetic-token'), false);
});

test('mixed providers explicitly scope native mode to DeepSeek and injected claims cannot become wire evidence', async t => {
  const modes: Array<{ provider: string; responseMode: string | undefined }> = []; let input!: ProductionRunInput;
  const roleCall: typeof runRole = async (agent, _system, prompt, _signal, _event, limits) => { modes.push({ provider: agent.provider, responseMode: limits?.responseMode }); return { text: JSON.stringify(answer(agent.modelId as ProductionRole, JSON.parse(prompt), input)), inputTokens: 13, outputTokens: 7, usageReported: true, harness: 'Injected oracle, zero actual HTTP', providerRequests: { requests: 0, deniedRequests: 0, status: null, transportComplete: false, httpEof: false, protocolComplete: false, inputReported: true, outputReported: true, inputTokens: 13, outputTokens: 7, complete: true, responseFormat: { version: HARNESS_JSON_OUTPUT_VERSION, mode: 'json-object', evidence: 'wire-observed' } } }; };
  const fixture = setup(t, { roleCall }, 'live', 'https://example.invalid', true); input = fixture.input; const run = await fixture.execute(); assert.equal(run.status, 'completed', run.error);
  for (const mode of modes) assert.equal(mode.responseMode, mode.provider === 'deepseek' ? 'json-object' : undefined);
  for (const call of run.calls) { assert.equal(call.responseFormat?.mode, call.model.provider === 'deepseek' ? 'json-object' : 'prompt-only'); assert.equal(call.responseFormat?.evidence, 'requested'); assert.equal(call.providerRequests?.responseFormat, undefined, 'Injected nested native-format claims must not contradict control-plane intent'); }
  assert.ok(modes.some(mode => mode.provider === 'anthropic')); assert.ok(modes.some(mode => mode.provider === 'openai-compatible'));
});

test('Mock format metadata is policy-only and never implies a native request happened', async t => {
  let calls = 0; const fixture = setup(t, { roleCall: async () => { calls++; throw new Error('Mock must never request a model'); } }, 'demo'); const run = await fixture.execute(); assert.equal(run.status, 'completed', run.error); assert.equal(calls, 0);
  for (const call of run.calls) { assert.equal(call.executionSource, 'mock'); assert.equal(call.responseFormat?.evidence, 'not-networked'); assert.equal(call.providerRequests, undefined); }
});

test('native-mode selection does not repair invalid Verifier JSON or relax the final Gate', async t => {
  let input!: ProductionRunInput; let gates = 0; const malformed = '{"reason":"invalid "quote""}';
  const fixture = setup(t, { roleCall: async (agent, _system, prompt, _signal, _event, limits) => { assert.equal(limits?.responseMode, 'json-object'); return { text: agent.modelId === 'verifier' ? malformed : JSON.stringify(answer(agent.modelId as ProductionRole, JSON.parse(prompt), input)), inputTokens: 13, outputTokens: 7, usageReported: true, harness: 'Injected only' }; }, gate: async () => { gates++; return { passed: true, checks: [] }; } }); input = fixture.input; const run = await fixture.execute();
  assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 2); assert.equal(run.calls[1].rawOutput, malformed); assert.equal(run.repairs, 0); assert.equal(run.frozenContract, undefined); assert.equal(gates, 0); assert.match(run.error!, /Verifier 校验失败/); assert.equal(run.artifacts.some(artifact => artifact.name === 'index.html'), false);
});

test('unknown usage still stops before any follow-up role despite JSON mode being requested', async t => {
  const fixture = setup(t, { roleCall: async (_agent, _system, _prompt, _signal, _event, limits) => { assert.equal(limits?.responseMode, 'json-object'); return { text: '{"value":"no authoritative usage"}', inputTokens: 0, outputTokens: 0, usageReported: false, harness: 'Injected missing usage' }; } }); const run = await fixture.execute(); assert.equal(run.status, 'failed'); assert.equal(run.calls.length, 1); assert.equal(run.repairs, 0); assert.equal(run.usage.inputTokens, null); assert.equal(run.usage.estimatedCost, null); assert.equal(run.calls[0].responseFormat?.evidence, 'requested');
});

test('transport metadata is credential-safe and historical CAMERA08 is not migrated', () => {
  // The four long identifiers are reserved explicitly; short field/enum names
  // cannot be valid credentials under the unchanged minimum length of 16.
  for (const value of ['harnessJsonOutputVersion', 'harness-json-output-v1', 'responseFormatPolicy', 'deepseek-json-object-other-prompt-only', 'responseFormat', 'responseFormats', 'json-object', 'prompt-only', 'wire-observed', 'not-networked', 'requested', 'response_format']) assert.equal(productionApiKeySchema.safeParse(value).success, false);
  const file = new URL('../docs/production/experiments/CAMERA-08/run.json', import.meta.url); const bytes = readFileSync(file); const historical = JSON.parse(bytes.toString('utf8')) as ProductionRun;
  assert.equal(historical.status, 'failed'); assert.equal(historical.frozenContract, undefined); assert.equal(historical.validationContract?.harnessJsonOutputVersion, undefined); assert.ok(historical.calls.every(call => call.responseFormat === undefined)); assert.deepEqual(readFileSync(file), bytes);
});

test('new transport literals reject every otherwise-valid credential substring without broadening legacy policy', () => {
  const protectedLiterals = ['harnessJsonOutputVersion', 'harness-json-output-v1', 'responseFormatPolicy', 'deepseek-json-object-other-prompt-only'];
  for (const literal of protectedLiterals) {
    for (let start = 0; start < literal.length; start++) {
      for (let end = start + 16; end <= literal.length; end++) {
        assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false, 'A transport identifier must survive literal credential redaction');
      }
    }
  }
  for (const value of ['synthetic-token-json-mode-0123456789', 'fixture-secret-prefix-abcdefgh', 'normal_A1b2C3d4E5f6G7h8_token']) assert.equal(productionApiKeySchema.safeParse(value).success, true);
});
