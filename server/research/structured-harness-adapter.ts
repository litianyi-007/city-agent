import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { expandAssistantStream } from '@deepseek-ai/dsh-llm';
import { compileAnswerContract, decodeAnswerContract, type AnswerContract } from '../../shared/answer-contract';
import { fingerprint } from '../../shared/evidence';

const ROUTE = 'city-structured-fixture', MODEL = 'city-structured-fixture-model';
const SYSTEM = 'Return the fixed resident answer JSON. Do not call tools.', USER = 'Complete the frozen offline resident answer contract.';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const FIXTURES = ['completed', 'incomplete', 'refusal', 'tool', 'no-terminal', 'http-500', 'terminal-mismatch', 'invalid-usage', 'duplicate-terminal',
  'early-tool', 'early-refusal', 'item-mismatch', 'part-refusal', 'array-impostor', 'created-error', 'second-dispatch'] as const;
export type StructuredHarnessFixture = typeof FIXTURES[number];
export interface StructuredHarnessEvidence {
  scope: 'localhost-fixture-only'; schemaHash: string; bodyHash: string; rawResponseHash: string; requestCount: number;
  observedSchemaHash: string | null; observedBodyHash: string | null; replayState: unknown; stepCount: number; toolCalls: number; toolResults: number;
  assistantMessages: number; contentChunks: number; lastContentChunks: number; invocationCount: number; harnessCompleted: boolean;
  failureStage: 'adapter' | 'decoder' | 'cleanup' | null; failureCode: string | null; cleanupErrors: string[];
}
export class StructuredHarnessFixtureError extends Error {
  constructor(public evidence: StructuredHarnessEvidence) { super(`Offline structured Harness fixture rejected at ${evidence.failureStage ?? 'adapter'}.`); }
}

function wireFor(text: string, fixture: StructuredHarnessFixture): string {
  const part = { type: 'output_text', text, annotations: [] }, item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [part] };
  const response = { id: 'resp_fixture', object: 'response', model: MODEL, status: 'completed', output: [item], error: null, incomplete_details: null,
    usage: { input_tokens: 13, output_tokens: 7, total_tokens: 20, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events: any[] = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  if (fixture === 'incomplete') { events[7].type = 'response.incomplete'; events[7].response = { ...response, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }; }
  if (fixture === 'refusal') { events[3] = { type: 'response.refusal.delta', delta: 'Fixture refusal.' }; }
  if (fixture === 'tool') { events[1].item = { type: 'function_call', name: 'persistent_bash', call_id: 'tool_fixture', arguments: '{"command":"never execute"}' }; }
  if (fixture === 'no-terminal') events.pop();
  if (fixture === 'terminal-mismatch') events[7].response = { ...response, output: [{ ...item, content: [{ ...part, text: text + ' ' }] }] };
  if (fixture === 'invalid-usage') events[7].response = { ...response, usage: { ...response.usage, total_tokens: 999 } };
  if (fixture === 'duplicate-terminal') events.push(events[7]);
  if (fixture === 'early-tool') events[0].response = { ...events[0].response, output: [{ type: 'function_call', name: 'persistent_bash' }] };
  if (fixture === 'early-refusal') events[1].item = { ...events[1].item, content: [{ type: 'refusal', refusal: 'Never publish text.' }] };
  if (fixture === 'item-mismatch') events[1].item = { ...events[1].item, id: 'wrong_message' };
  if (fixture === 'part-refusal') events[2].part = { ...events[2].part, refusal: 'Never publish text.' };
  if (fixture === 'array-impostor') events[7].response = { ...response, output: { 0: item, length: 1 } };
  if (fixture === 'created-error') events[0].response = { ...events[0].response, error: { code: 'fixture_failure' } };
  return fixture === 'http-500' ? '{"error":{"message":"Offline fixture failure"}}' : events.map((event, sequence_number) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join('');
}

/** Owns the fixture, fake response and child; accepts no endpoint, API key, arbitrary prompt or production adapter registration. */
export async function runStructuredHarnessAdapterFixture(input: { contract: AnswerContract; responseText: string; fixture?: StructuredHarnessFixture }) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Structured Harness fixture requires Node 22.');
  if (Object.keys(input).some(key => !['contract', 'responseText', 'fixture'].includes(key))) throw new Error('Offline Harness fixture refuses unknown options.');
  const fixture = input.fixture ?? 'completed', contract = structuredClone(input.contract);
  if (!FIXTURES.includes(fixture)
    || Buffer.byteLength(input.responseText) > 64_000) throw new Error('Invalid or oversized offline fixture.');
  const expected = compileAnswerContract(contract.task, contract.residentId, contract.rules);
  if (contract.version !== expected.version || fingerprint(contract.task) !== contract.taskHash || fingerprint(contract.rules) !== contract.rulesHash
    || fingerprint(contract.schema) !== contract.schemaHash || expected.schemaHash !== contract.schemaHash) throw new Error('Frozen answer contract drifted before offline Harness start.');
  const body = JSON.stringify({ model: MODEL, input: [{ role: 'system', content: [{ type: 'input_text', text: SYSTEM }] }, { role: 'user', content: [{ type: 'input_text', text: USER }] }],
    stream: true, max_output_tokens: 4096, reasoning: { effort: 'none' }, store: false, tools: [], tool_choice: 'none', text: { format: { type: 'json_schema', name: 'resident_answers', schema: contract.schema } } });
  if (Buffer.byteLength(body) > 128_000) throw new Error('Offline request exceeds 128KB.');
  const wire = wireFor(input.responseText, fixture), fixtureToken = randomUUID();
  const evidence: StructuredHarnessEvidence = { scope: 'localhost-fixture-only', schemaHash: contract.schemaHash, bodyHash: hash(body), rawResponseHash: hash(wire), requestCount: 0,
    observedSchemaHash: null, observedBodyHash: null, replayState: null, stepCount: 0, toolCalls: 0, toolResults: 0, assistantMessages: 0, contentChunks: 0,
    lastContentChunks: 0, invocationCount: 0, harnessCompleted: false, failureStage: 'adapter', failureCode: 'OFFLINE_SDK_FAILURE', cleanupErrors: [] };
  const server = createServer(async (request, response) => {
    evidence.requestCount++;
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 128_000) throw new Error('Oversized request.'); chunks.push(chunk); }
      const rawBytes = Buffer.concat(chunks), raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes), observed = JSON.parse(raw);
      evidence.observedBodyHash = hash(rawBytes); evidence.observedSchemaHash = fingerprint(observed.text?.format?.schema);
      if (evidence.requestCount !== 1 || request.method !== 'POST' || request.url !== '/v1/responses' || request.headers['x-city-fixture-token'] !== fixtureToken
        || request.headers['x-city-body-sha256'] !== evidence.bodyHash || request.headers['x-city-schema-sha256'] !== contract.schemaHash
        || !request.headers['user-agent']?.startsWith('deepseek-harness/') || raw !== body) throw new Error('Offline wire contract drift.');
      response.writeHead(fixture === 'http-500' ? 500 : 200, { 'content-type': fixture === 'http-500' ? 'application/json' : 'text/event-stream' }); response.end(wire);
    } catch { response.writeHead(400, { 'content-type': 'application/json' }); response.end('{"error":{"message":"Offline wire rejected"}}'); }
  });
  let workspace: string | undefined, harness: DeepSeekHarness | undefined;
  let outcome: { raw: string; answers: ReturnType<typeof decodeAnswerContract>; evidence: StructuredHarnessEvidence } | undefined, primaryError: StructuredHarnessFixtureError | undefined;
  const record = (result: Awaited<ReturnType<DeepSeekHarness['run']>>) => {
    evidence.stepCount += result.events.filter(event => event.type === 'step/start').length;
    evidence.toolCalls += result.events.filter(event => event.type === 'tool/call').length; evidence.toolResults += result.events.filter(event => event.type === 'tool/result').length;
    const messages = result.events.filter(event => event.type === 'assistant/message'); evidence.assistantMessages += messages.length;
    if (messages.length) evidence.replayState = messages[0].data.message.source.replayState ?? null;
    evidence.lastContentChunks = result.events.flatMap(event => event.type === 'assistant/message' || event.type === 'assistant/attempt'
      ? expandAssistantStream(event.data.stream).filter(({ chunk }) => chunk.type !== 'usage' && chunk.type !== 'finish') : []).length;
    evidence.contentChunks += evidence.lastContentChunks;
    const end = [...result.events].reverse().find(event => event.type === 'turn/end'); evidence.harnessCompleted = end?.type === 'turn/end' && end.data.reason.kind === 'completed';
    evidence.failureCode = end?.type === 'turn/end' && end.data.reason.kind === 'error' ? end.data.reason.error.code : 'OFFLINE_SDK_NON_COMPLETION';
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Offline server failed.');
    workspace = await mkdtemp(join(tmpdir(), 'city-structured-harness-')); const patchPath = join(workspace, 'structured.patch.yml');
    const patch = [...['persistent-bash', 'persistent-pwsh', 'terminal-bash', 'terminal-pwsh', 'pty', 'subprocess', 'sandbox', 'sandbox-policy', 'llm-deepseek', 'llm-retry'].map(id => ({ id, disabled: true })),
      { id: 'system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: SYSTEM } },
      { insert: [{ id: 'city-structured-offline', name: fileURLToPath(new URL('./structured-harness-adapter-plugin.mjs', import.meta.url)),
        config: { port: address.port, fixtureToken, body, bodyHash: evidence.bodyHash, schemaHash: contract.schemaHash } }] }];
    await writeFile(patchPath, JSON.stringify(patch), { mode: 0o600 });
    harness = new DeepSeekHarness({ profile: 'sdk-minimal', patches: [patchPath], cwd: workspace, processCwd: workspace, dshHome: join(workspace, 'home'), env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
      provider: ROUTE, model: MODEL, maxTokens: 4096, initializeTimeoutMs: 30_000, requestTimeoutMs: 30_000, shutdownTimeoutMs: 500, disposeEofGraceMs: 500, disposeGraceMs: 1000 });
    evidence.invocationCount++; const result = await harness.run(USER); record(result);
    if (!evidence.harnessCompleted || evidence.requestCount !== 1 || evidence.stepCount !== 1 || evidence.toolCalls || evidence.toolResults || evidence.assistantMessages !== 1) throw new StructuredHarnessFixtureError(evidence);
    const replay = { response: { version: 'structured-harness-fixture-1.0', schemaHash: contract.schemaHash, bodyHash: evidence.bodyHash, rawResponseHash: evidence.rawResponseHash, dispatches: 1 } };
    evidence.failureCode = 'OFFLINE_WIRE_HASH_MISMATCH';
    if (evidence.observedSchemaHash !== contract.schemaHash || evidence.observedBodyHash !== evidence.bodyHash || fingerprint(evidence.replayState) !== fingerprint(replay)) throw new StructuredHarnessFixtureError(evidence);
    if (fixture === 'second-dispatch') { evidence.invocationCount++; record(await harness.run(USER)); throw new StructuredHarnessFixtureError(evidence); }
    evidence.failureStage = 'decoder'; evidence.failureCode = 'ANSWER_CONTRACT_REJECTED'; const answers = decodeAnswerContract(contract, result.finalResponse);
    evidence.failureStage = null; evidence.failureCode = null; outcome = { raw: result.finalResponse, answers, evidence };
  } catch (error) { primaryError = error instanceof StructuredHarnessFixtureError ? error : new StructuredHarnessFixtureError(evidence); }
  // Attempt every owned cleanup independently; a cleanup failure must not replace the primary rejection.
  try { await harness?.close(); } catch { evidence.cleanupErrors.push('child-close'); }
  try { server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch { evidence.cleanupErrors.push('fixture-close'); }
  try { if (workspace) await rm(workspace, { recursive: true, force: true }); } catch { evidence.cleanupErrors.push('workspace-remove'); }
  if (primaryError) throw primaryError;
  if (evidence.cleanupErrors.length) { evidence.failureStage = 'cleanup'; evidence.failureCode = 'OFFLINE_CLEANUP_FAILURE'; throw new StructuredHarnessFixtureError(evidence); }
  return outcome!;
}
