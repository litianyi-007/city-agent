import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createResponsesStreamWitness, RESPONSES_STREAM_VERSION } from '../server/research/responses-stream.mjs';

// This fixture constructor is an independent wire oracle, not the parser's validation implementation.
const MODEL = 'city-stream-fixture';
const TEXT = '{"居民":"滨江🍪","answers":{"choice":null,"budget":0}}';
const usage = { input_tokens: 20, output_tokens: 7, total_tokens: 27,
  input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 2 } };
const textPart = (text: string) => ({ type: 'output_text', text, annotations: [] });
const message = (status: string, text: string | null) => ({ id: 'msg_real', type: 'message', role: 'assistant', status,
  content: text === null ? [] : [textPart(text)] });
const response = (status: string, text: string | null) => ({ id: 'resp_real', object: 'response', model: MODEL, status,
  error: null, incomplete_details: null, output: text === null ? [] : [message('completed', text)],
  usage: text === null ? null : structuredClone(usage), created_at: 1720000000, metadata: { purpose: 'offline' }, tools: [],
  reasoning: { effort: null, summary: null }, text: { format: { type: 'json_schema' } } });
function events({ text = TEXT, progress = false, chunks = [text] }: { text?: string; progress?: boolean; chunks?: string[] } = {}): any[] {
  const location = { item_id: 'msg_real', output_index: 0, content_index: 0 };
  const list = [{ type: 'response.created', response: response('in_progress', null) },
    ...(progress ? [{ type: 'response.in_progress', response: response('in_progress', null) }] : []),
    { type: 'response.output_item.added', output_index: 0, item: message('in_progress', null) },
    { type: 'response.content_part.added', ...location, part: textPart('') },
    ...chunks.map(delta => ({ type: 'response.output_text.delta', ...location, delta })),
    { type: 'response.output_text.done', ...location, text, logprobs: [] },
    { type: 'response.content_part.done', ...location, part: textPart(text) },
    { type: 'response.output_item.done', output_index: 0, item: message('completed', text) },
    { type: 'response.completed', response: response('completed', text) }];
  return list.map((event, sequence_number) => ({ ...event, sequence_number }));
}
function wire(list: any[], { newline = '\n', named = true, multiline = false, comments = false } = {}): string {
  return list.map(event => `${comments ? `: heartbeat${newline}id: offline${newline}retry: 100${newline}` : ''}`
    + `${named ? `event: ${event.type}${newline}` : ''}`
    + `${JSON.stringify(event, null, multiline ? 2 : undefined).split('\n').map(line => `data: ${line}`).join(newline)}${newline}${newline}`).join('');
}
function replay(raw: string | Uint8Array, options: { maxBytes?: number; maxEvents?: number; chunkSize?: number } = {}) {
  const witness = createResponsesStreamWitness({ expectedModel: MODEL, maxBytes: options.maxBytes, maxEvents: options.maxEvents });
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  const chunkSize = options.chunkSize ?? (bytes.length || 1);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) witness.observe(bytes.subarray(offset, offset + chunkSize));
  witness.complete(); return witness.snapshot();
}
function mutate(mutator: (list: any[]) => void) { const list = events(); mutator(list); return wire(list); }
function rejected(raw: string, expectedState = 'invalid') {
  const result = replay(raw, { chunkSize: 3 });
  assert.equal(result.state, expectedState, JSON.stringify(result)); assert.equal(result.text, null); assert.equal(result.usage, null);
  return result;
}
function phaseItems(list: any[]) {
  return [list.find(event => event.type === 'response.output_item.added').item,
    list.find(event => event.type === 'response.output_item.done').item,
    list.find(event => event.type === 'response.completed').response.output[0]];
}
function withFinalAnswerPhase(list = events()) {
  for (const item of phaseItems(list)) item.phase = 'final_answer';
  return list;
}

test('text and complete raw usage remain private until the full successful EOF, with detached snapshots', () => {
  const raw = wire(events()), witness = createResponsesStreamWitness({ expectedModel: MODEL });
  assert.equal(witness.snapshot().version, RESPONSES_STREAM_VERSION);
  witness.observe(new TextEncoder().encode(raw));
  const pending = witness.snapshot();
  assert.equal(pending.state, 'pending'); assert.equal(pending.text, null); assert.equal(pending.usage, null); assert.equal(pending.rawResponseSha256, null);
  witness.complete(); const snapshot = witness.snapshot();
  assert.equal(snapshot.state, 'reported'); assert.equal(snapshot.responseId, 'resp_real'); assert.equal(snapshot.terminalStatus, 'completed');
  assert.equal(snapshot.text, TEXT); assert.equal(snapshot.eventCount, 8);
  assert.equal(snapshot.rawResponseSha256, createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(snapshot.usage, { inputTokens: 20, outputTokens: 7, totalTokens: 27, cacheReadTokens: 5, reasoningTokens: 2 });
  snapshot.usage!.inputTokens = 999; assert.equal(witness.snapshot().usage!.inputTokens, 20);
  witness.complete(); assert.equal(witness.snapshot().state, 'reported');
});

for (const newline of ['\n', '\r\n', '\r']) {
  for (const named of [true, false]) test(`UTF-8 byte splitting, comments, multiline JSON, optional progress and multiple deltas (${JSON.stringify(newline)}, named=${named})`, () => {
    const chunks = Array.from(TEXT), list = events({ progress: true, chunks }), raw = wire(list, { newline, named, comments: true, multiline: true });
    const result = replay(raw, { chunkSize: 1 });
    assert.equal(result.state, 'reported'); assert.equal(result.text, TEXT); assert.equal(result.eventCount, list.length);
    assert.equal(result.rawResponseSha256, createHash('sha256').update(raw).digest('hex'));
  });
}

for (const newline of ['\n', '\r\n', '\r']) test(`final_answer phase is preserved through every message stage and UTF-8 split (${JSON.stringify(newline)})`, () => {
  const list = withFinalAnswerPhase(events({ progress: true, chunks: Array.from(TEXT) }));
  const raw = wire(list, { newline, comments: true, multiline: true });
  for (const chunkSize of [1, 13, Buffer.byteLength(raw)]) {
    const snapshot = replay(raw, { chunkSize });
    assert.equal(snapshot.state, 'reported'); assert.equal(snapshot.version, 'responses-text-stream-1.1');
    assert.equal(snapshot.text, TEXT); assert.equal(snapshot.eventCount, list.length);
    assert.equal(snapshot.rawResponseSha256, createHash('sha256').update(raw).digest('hex'));
    assert.deepEqual(snapshot.usage, { inputTokens: 20, outputTokens: 7, totalTokens: 27, cacheReadTokens: 5, reasoningTokens: 2 });
  }
});

test('phase compatibility does not expose any text or usage before EOF', () => {
  const witness = createResponsesStreamWitness({ expectedModel: MODEL }), raw = wire(withFinalAnswerPhase());
  witness.observe(new TextEncoder().encode(raw));
  assert.equal(witness.snapshot().state, 'pending'); assert.equal(witness.snapshot().text, null); assert.equal(witness.snapshot().usage, null);
  witness.complete(); assert.equal(witness.snapshot().state, 'reported'); assert.equal(witness.snapshot().text, TEXT);
});

for (const [stage, index] of [['added', 0], ['done', 1], ['terminal', 2]] as const) {
  for (const phase of [null, 'commentary', 'future-phase']) test(`rejects ${stage} message phase ${JSON.stringify(phase)}`, () => {
    const list = withFinalAnswerPhase(); phaseItems(list)[index].phase = phase;
    rejected(wire(list));
  });
  test(`rejects unrelated extra message field alongside allowed phase at ${stage}`, () => {
    const list = withFinalAnswerPhase(); phaseItems(list)[index].future_metadata = null;
    rejected(wire(list));
  });
}

for (const [name, indexes] of [['done removal', [1]], ['terminal removal', [2]], ['both later removals', [1, 2]]] as const) {
  test(`rejects phase presence drift: ${name}`, () => {
    const list = withFinalAnswerPhase(); for (const index of indexes) delete phaseItems(list)[index].phase;
    assert.equal(rejected(wire(list)).reason, 'item-phase-drift');
  });
}
for (const [name, indexes] of [['done addition', [1]], ['terminal addition', [2]], ['both later additions', [1, 2]]] as const) {
  test(`rejects phase presence drift: ${name}`, () => {
    const list = events(); for (const index of indexes) phaseItems(list)[index].phase = 'final_answer';
    assert.equal(rejected(wire(list)).reason, 'item-phase-drift');
  });
}

test('phase accepts only the registered string and cannot appear on content parts or events', () => {
  for (const value of ['', 'FINAL_ANSWER', 0, false, {}, ['final_answer']]) {
    const list = withFinalAnswerPhase(); phaseItems(list)[0].phase = value; rejected(wire(list));
  }
  for (const target of ['part', 'delta']) {
    const list = withFinalAnswerPhase();
    (target === 'part' ? list[2].part : list[3]).phase = 'final_answer'; rejected(wire(list));
  }
});

test('phase duplicate keys and escaped aliases reject before any text or usage release', () => {
  const raw = wire(withFinalAnswerPhase());
  for (const replacement of ['"phase":"final_answer","phase":"final_answer"',
    '"phase":"final_answer","\\u0070hase":"final_answer"']) {
    assert.equal(rejected(raw.replace('"phase":"final_answer"', replacement)).reason, 'duplicate-json-property');
  }
});

test('allowed phase never makes reasoning, tools, refusals, multiple items or terminal drift acceptable', () => {
  for (const attack of [(list: any[]) => { phaseItems(list)[0].type = 'reasoning'; },
    (list: any[]) => { phaseItems(list)[0].type = 'function_call'; },
    (list: any[]) => { list[2].part.type = 'refusal'; },
    (list: any[]) => { list.at(-1).response.output.push(message('completed', TEXT)); },
    (list: any[]) => { list.at(-1).response.output[0].content[0].text += ' '; }]) {
    const list = withFinalAnswerPhase(); attack(list); rejected(wire(list));
  }
});

test('legal zero usage and optional usage details are distinct from missing usage, even with an empty text part', () => {
  const list = events({ text: '', chunks: [] }); list.at(-1).response.usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const result = replay(wire(list)); assert.equal(result.state, 'reported'); assert.equal(result.text, '');
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 });
});

const semanticAttacks: Record<string, (list: any[]) => void> = {
  'created model drift': list => { list[0].response.model = 'wrong-model'; },
  'created response error': list => { list[0].response.error = { code: 'oops' }; },
  'created output smuggling': list => { list[0].response.output = [message('completed', TEXT)]; },
  'created tool smuggling': list => { list[0].response.output = [{ type: 'function_call', arguments: '{}' }]; },
  'created usage smuggling': list => { list[0].response.usage = usage; },
  'terminal response ID drift': list => { list.at(-1).response.id = 'other-id'; },
  'terminal model drift': list => { list.at(-1).response.model = 'other-model'; },
  'terminal status incomplete': list => { list.at(-1).response.status = 'incomplete'; },
  'terminal incomplete details': list => { list.at(-1).response.incomplete_details = { reason: 'max_output_tokens' }; },
  'terminal response error': list => { list.at(-1).response.error = { message: 'failed' }; },
  'item added wrong role': list => { list[1].item.role = 'user'; },
  'item added wrong status': list => { list[1].item.status = 'completed'; },
  'item added early text': list => { list[1].item.content = [textPart(TEXT)]; },
  'item added tool': list => { list[1].item.type = 'function_call'; },
  'item added reasoning': list => { list[1].item.type = 'reasoning'; },
  'item ID drift on done': list => { list[6].item.id = 'msg_other'; },
  'terminal item ID drift': list => { list.at(-1).response.output[0].id = 'msg_other'; },
  'item done status drift': list => { list[6].item.status = 'in_progress'; },
  'multiple output items': list => { list.at(-1).response.output.push(message('completed', TEXT)); },
  'multiple item content': list => { list[6].item.content.push(textPart(TEXT)); },
  'missing terminal content': list => { list.at(-1).response.output[0].content = []; },
  'fake array content': list => { list[1].item.content = { length: 0 }; },
  'part added refusal': list => { list[2].part = { type: 'refusal', refusal: 'No' }; },
  'part refusal extra field': list => { list[2].part.refusal = 'No'; },
  'part added nonempty text': list => { list[2].part.text = 'early'; },
  'part added wrong type': list => { list[2].part.type = 'reasoning_text'; },
  'part done text drift': list => { list[5].part.text = 'other'; },
  'annotation not supported': list => { list[5].part.annotations = [{ type: 'url_citation' }]; },
  'part logprobs not array': list => { list[2].part.logprobs = {}; },
  'delta numeric': list => { list[3].delta = 1; },
  'delta wrong item': list => { list[3].item_id = 'wrong'; },
  'delta output index': list => { list[3].output_index = 1; },
  'delta content index': list => { list[3].content_index = 1; },
  'done text drift': list => { list[4].text = 'other'; },
  'terminal text drift': list => { list.at(-1).response.output[0].content[0].text = 'other'; },
  'delta nonempty logprobs': list => { list[3].logprobs = [{ logprob: 0 }]; },
  'done nonempty logprobs': list => { list[4].logprobs = [{}]; },
  'event extra tool field': list => { list[3].tool_calls = []; },
  'skipped lifecycle event': list => { list.splice(5, 1); list.forEach((event, index) => { event.sequence_number = index; }); },
  'out of order lifecycle': list => { [list[4], list[5]] = [list[5], list[4]]; list.forEach((event, index) => { event.sequence_number = index; }); },
  'sequence repeated': list => { list[3].sequence_number = 2; },
  'sequence skipped': list => { list[3].sequence_number = 4; },
  'sequence string': list => { list[3].sequence_number = '3'; },
  'sequence negative': list => { list[0].sequence_number = -1; },
  'duplicate terminal': list => { list.push({ ...list.at(-1), sequence_number: 8 }); },
  'missing terminal output': list => { list.at(-1).response.output = []; },
};
for (const [name, attack] of Object.entries(semanticAttacks)) test(`rejects semantic attack: ${name}`, () => { rejected(mutate(attack)); });

for (const type of ['response.refusal.delta', 'response.failed', 'response.incomplete', 'response.cancelled', 'response.function_call_arguments.delta',
  'response.reasoning_text.delta', 'response.reasoning_summary_text.done', 'response.output_text.annotation.added', 'error']) {
  test(`rejects unsupported lifecycle ${type}`, () => { rejected(mutate(list => { list[3].type = type; })); });
}

const usageAttacks: Record<string, any> = {
  'missing input': { output_tokens: 7, total_tokens: 7 },
  'missing output': { input_tokens: 20, total_tokens: 20 },
  'missing total': { input_tokens: 20, output_tokens: 7 },
  'inconsistent total': { input_tokens: 20, output_tokens: 7, total_tokens: 28 },
  'negative input': { input_tokens: -1, output_tokens: 8, total_tokens: 7 },
  'fractional input': { input_tokens: 0.5, output_tokens: 1, total_tokens: 1.5 },
  'string input': { input_tokens: '20', output_tokens: 7, total_tokens: 27 },
  'unsafe integer': { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
  'unsafe sum': { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, total_tokens: Number.MAX_SAFE_INTEGER + 1 },
  'chat aliases': { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
  'extra aliases': { ...usage, prompt_tokens: 20 },
  'null details': { ...usage, input_tokens_details: null },
  'missing cached count': { ...usage, input_tokens_details: {} },
  'cache larger than input': { ...usage, input_tokens_details: { cached_tokens: 21 } },
  'negative cached count': { ...usage, input_tokens_details: { cached_tokens: -1 } },
  'cache alternate counter': { ...usage, input_tokens_details: { cached_tokens: 5, audio_tokens: 0 } },
  'null output details': { ...usage, output_tokens_details: null },
  'reasoning larger than output': { ...usage, output_tokens_details: { reasoning_tokens: 8 } },
  'fractional reasoning': { ...usage, output_tokens_details: { reasoning_tokens: 1.5 } },
};
for (const [name, invalidUsage] of Object.entries(usageAttacks)) test(`rejects usage attack: ${name}`, () => {
  rejected(mutate(list => { list.at(-1).response.usage = invalidUsage; }));
});

test('completed without a usage record is missing, never zero or successful text', () => {
  for (const remove of [true, false]) {
    const raw = mutate(list => { if (remove) delete list.at(-1).response.usage; else list.at(-1).response.usage = null; });
    const result = rejected(raw, 'missing'); assert.equal(result.reason, 'missing-usage');
  }
});

test('missing lifecycle terminal and truncated frames/UTF-8 fail closed', () => {
  assert.equal(rejected(wire(events().slice(0, -1)), 'missing').reason, 'missing-terminal');
  for (const raw of [wire(events()).slice(0, -1), wire(events()).slice(0, -5), 'data: {"type":', '\ndata: []\n\n']) rejected(raw);
  const raw = new TextEncoder().encode(wire(events())), bad = new Uint8Array([...raw, 0xe4]);
  assert.equal(replay(bad).state, 'invalid');
});

test('duplicate JSON keys and escaped aliases are rejected in every nesting level', () => {
  for (const [from, replacement] of [
    ['"type":"response.created"', '"type":"response.created","\\u0074ype":"response.created"'],
    ['"model":"city-stream-fixture"', '"model":"wrong","model":"city-stream-fixture"'],
    ['"input_tokens":20', '"input_tokens":999,"\\u0069nput_tokens":20'],
    ['"cached_tokens":5', '"cached_tokens":5,"cached_tokens":5'],
  ]) assert.equal(rejected(wire(events()).replace(from, replacement)).reason, 'duplicate-json-property');
});

test('SSE event name mismatch, duplicate event fields, DONE sentinel and post-terminal events reject', () => {
  const raw = wire(events());
  rejected(raw.replace('event: response.created', 'event: response.completed'));
  rejected(raw.replace('event: response.created', 'event: response.created\nevent: response.created'));
  rejected(raw + 'data: [DONE]\n\n');
  rejected(raw + 'data: {"type":"response.created","sequence_number":8}\n\n');
  rejected(raw + 'event: response.completed\n\n');
  assert.equal(replay(raw + ': final heartbeat\n\n').state, 'reported');
});

test('depth, total byte and event caps are enforced at exact boundaries', () => {
  const raw = wire(events()), bytes = Buffer.byteLength(raw);
  assert.equal(replay(raw, { maxBytes: bytes, maxEvents: 8 }).state, 'reported');
  const oversized = replay(raw, { maxBytes: bytes - 1 });
  assert.equal(oversized.reason, 'byte-limit'); assert.equal(oversized.rawResponseSha256, null);
  assert.equal(replay(raw, { maxEvents: 7 }).reason, 'event-limit');
  const list = events(); list[0].response.metadata.deep = JSON.parse(`${'['.repeat(65)}0${']'.repeat(65)}`);
  assert.equal(replay(wire(list)).reason, 'json-depth-limit');
});

test('invalid and failed streams retain full bounded raw-byte hashes independent of chunking, never a prefix hash', () => {
  const raw = `data: invalid-json\n\n${wire(events())}`;
  const expected = createHash('sha256').update(raw).digest('hex');
  for (const chunkSize of [1, 3, Buffer.byteLength(raw)]) {
    const result = replay(raw, { chunkSize }); assert.equal(result.state, 'invalid'); assert.equal(result.rawResponseSha256, expected);
  }
  const afterTerminal = `${wire(events())}data: invalid-json\n\n`;
  for (const chunkSize of [1, 7, Buffer.byteLength(afterTerminal)]) assert.equal(replay(afterTerminal, { chunkSize }).rawResponseSha256,
    createHash('sha256').update(afterTerminal).digest('hex'));
  const failed = createResponsesStreamWitness({ expectedModel: MODEL }); failed.fail('network-reset');
  failed.observe(new TextEncoder().encode(raw)); failed.complete();
  assert.equal(failed.snapshot().rawResponseSha256, expected); assert.equal(failed.snapshot().state, 'transport-failed');
});

test('invalid is sticky; cancellation before or after receipt clears all releasable text', () => {
  const witness = createResponsesStreamWitness({ expectedModel: MODEL });
  witness.observe(new TextEncoder().encode('data: nope\n\n')); witness.observe(new TextEncoder().encode(wire(events()))); witness.fail('abort'); witness.complete();
  assert.equal(witness.snapshot().state, 'invalid'); assert.equal(witness.snapshot().text, null);
  for (const alreadyCompleted of [false, true]) {
    const cancelled = createResponsesStreamWitness({ expectedModel: MODEL }); cancelled.observe(new TextEncoder().encode(wire(events())));
    if (alreadyCompleted) cancelled.complete();
    cancelled.fail('request-aborted'); cancelled.complete(); const result = cancelled.snapshot();
    assert.equal(result.state, 'transport-failed'); assert.equal(result.text, null); assert.equal(result.usage, null);
  }
});

test('bytes after EOF revoke success; observation never throws on malformed chunks or invalid UTF-8', () => {
  const witness = createResponsesStreamWitness({ expectedModel: MODEL }); witness.observe(new TextEncoder().encode(wire(events()))); witness.complete();
  witness.observe(new Uint8Array([10])); assert.equal(witness.snapshot().state, 'invalid'); assert.equal(witness.snapshot().rawResponseSha256, null);
  for (const chunk of [null, 'not-bytes', new Uint8Array([0xff])] as any[]) {
    const invalid = createResponsesStreamWitness({ expectedModel: MODEL }); assert.doesNotThrow(() => invalid.observe(chunk));
    invalid.complete(); assert.equal(invalid.snapshot().state, 'invalid');
  }
  assert.throws(() => createResponsesStreamWitness({ expectedModel: '' }), /configuration/);
  assert.throws(() => createResponsesStreamWitness({ expectedModel: MODEL, maxEvents: 0 }), /configuration/);
});

test('optional in-progress response is checked independently and cannot repeat or move after content', () => {
  for (const mutateProgress of [(list: any[]) => { list[1].response.id = 'other'; }, (list: any[]) => { list[1].response.output = [message('completed', TEXT)]; },
    (list: any[]) => { list.splice(2, 0, structuredClone(list[1])); list.forEach((event, index) => { event.sequence_number = index; }); },
    (list: any[]) => { const [progress] = list.splice(1, 1); list.splice(3, 0, progress); list.forEach((event, index) => { event.sequence_number = index; }); }]) {
    const list = events({ progress: true }); mutateProgress(list); rejected(wire(list));
  }
});
