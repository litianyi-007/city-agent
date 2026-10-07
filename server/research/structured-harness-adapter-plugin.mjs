// Research-only Cordis plugin. Only the sibling localhost fixture wrapper loads it.
import { createHash } from 'node:crypto';
import { LlmAdapter, LlmError, attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';

export const name = 'city-offline-structured-adapter';
export const inject = ['llm'];
const ROUTE = 'city-structured-fixture';
const MODEL = 'city-structured-fixture-model';
const MAX_BYTES = 512_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const fail = code => { throw new LlmError(`Offline structured adapter rejected: ${code}`, code); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;
const textPart = (part, text) => keys(part, 'annotations,text,type') && part.type === 'output_text' && part.text === text && Array.isArray(part.annotations) && part.annotations.length === 0;
const message = (item, status, content) => keys(item, 'content,id,role,status,type') && item.type === 'message' && item.id === 'msg_fixture'
  && item.role === 'assistant' && item.status === status && Array.isArray(item.content) && item.content.length === content;
const responseShape = response => keys(response, 'error,id,incomplete_details,model,object,output,status,usage') && response.object === 'response'
  && response.id === 'resp_fixture' && response.model === MODEL && response.error === null && response.incomplete_details === null && Array.isArray(response.output);

function readTerminal(wire) {
  if (!wire.endsWith('\n\n')) fail('OFFLINE_INCOMPLETE_SSE');
  const frames = wire.slice(0, -2).split('\n\n');
  let text = '', terminal, createdId;
  const expected = ['response.created', 'response.output_item.added', 'response.content_part.added', 'response.output_text.delta',
    'response.output_text.done', 'response.content_part.done', 'response.output_item.done', 'response.completed'];
  const fields = ['response,sequence_number,type', 'item,output_index,sequence_number,type', 'content_index,item_id,output_index,part,sequence_number,type',
    'content_index,delta,item_id,output_index,sequence_number,type', 'content_index,item_id,output_index,sequence_number,text,type',
    'content_index,item_id,output_index,part,sequence_number,type', 'item,output_index,sequence_number,type', 'response,sequence_number,type'];
  for (const [index, frame] of frames.entries()) {
    const lines = frame.split('\n');
    if (lines.length !== 2 || !lines[0].startsWith('event: ') || !lines[1].startsWith('data: ')) fail('OFFLINE_INVALID_SSE');
    const event = JSON.parse(lines[1].slice(6));
    if (lines[0].slice(7) !== event.type || event.sequence_number !== index) fail('OFFLINE_EVENT_DRIFT');
    if (event.type.includes('refusal')) fail('OFFLINE_REFUSAL');
    if (event.type.includes('function_call') || event.type.includes('custom_tool')) fail('OFFLINE_TOOL_OUTPUT');
    if (event.type === 'response.incomplete' || event.type === 'response.failed') fail('OFFLINE_RESPONSE_NOT_COMPLETED');
    if (event.type !== expected[index] || terminal) fail('OFFLINE_EVENT_ORDER');
    if (!keys(event, fields[index])) fail('OFFLINE_EVENT_SHAPE');
    if (index === 0) {
      if (!responseShape(event.response) || event.response.status !== 'in_progress' || event.response.output.length !== 0) fail('OFFLINE_RESPONSE_IDENTITY');
      createdId = event.response.id;
    }
    if ([1, 6].includes(index) && (event.output_index !== 0 || !message(event.item, index === 1 ? 'in_progress' : 'completed', index === 1 ? 0 : 1))) fail('OFFLINE_TOOL_OUTPUT');
    if ([2, 5].includes(index) && !textPart(event.part, index === 2 ? '' : text)) fail('OFFLINE_REFUSAL');
    if ([2, 3, 4, 5].includes(index) && (event.output_index !== 0 || event.content_index !== 0 || event.item_id !== 'msg_fixture')) fail('OFFLINE_CONTENT_DRIFT');
    if (index === 3) { if (typeof event.delta !== 'string') fail('OFFLINE_INVALID_TEXT'); text = event.delta; }
    if (index === 4 && event.text !== text || index === 5 && event.part.text !== text) fail('OFFLINE_TEXT_DRIFT');
    if (index === 6 && !textPart(event.item.content[0], text)) fail('OFFLINE_TEXT_DRIFT');
    if (index === 7) terminal = event.response;
  }
  if (frames.length !== expected.length || !responseShape(terminal) || terminal.status !== 'completed' || terminal.id !== createdId || terminal.output.length !== 1) fail('OFFLINE_MISSING_TERMINAL');
  const item = terminal.output[0], part = item.content?.[0];
  if (!message(item, 'completed', 1) || !textPart(part, text) || !text.trim()) fail('OFFLINE_TERMINAL_TEXT');
  const usage = terminal.usage, cached = usage?.input_tokens_details?.cached_tokens, reasoning = usage?.output_tokens_details?.reasoning_tokens;
  if (!keys(usage, 'input_tokens,input_tokens_details,output_tokens,output_tokens_details,total_tokens') || !keys(usage.input_tokens_details, 'cached_tokens')
    || !keys(usage.output_tokens_details, 'reasoning_tokens') || ![usage.input_tokens, usage.output_tokens, usage.total_tokens, cached, reasoning].every(count)
    || usage.input_tokens + usage.output_tokens !== usage.total_tokens || cached > usage.input_tokens || reasoning > usage.output_tokens) fail('OFFLINE_INVALID_USAGE');
  return { text, usage: { inputTokens: usage.input_tokens - cached, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens, cacheReadTokens: cached, reasoningTokens: reasoning } };
}

export function apply(ctx, config) {
  if (Object.keys(config).sort().join(',') !== 'body,bodyHash,fixtureToken,port,schemaHash' || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || !/^[a-f0-9-]{36}$/.test(config.fixtureToken) || typeof config.body !== 'string' || Buffer.byteLength(config.body) > MAX_BYTES) fail('OFFLINE_INVALID_CONFIG');
  const body = JSON.parse(config.body);
  if (hash(config.body) !== config.bodyHash || hash(canonical(body.text?.format?.schema)) !== config.schemaHash || body.model !== MODEL
    || body.stream !== true || body.max_output_tokens !== 4096 || body.tool_choice !== 'none' || body.tools?.length !== 0
    || body.text.format.type !== 'json_schema' || body.text.format.name !== 'resident_answers') fail('OFFLINE_CONTRACT_DRIFT');
  const frozen = JSON.parse(JSON.stringify(config));
  let consumed = false;
  class FixedAdapter extends LlmAdapter {
    providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'city-offline-structured-adapter'); }
    resolveModel(provider, model) {
      if (provider !== ROUTE || model !== MODEL) fail('OFFLINE_ROUTE_DRIFT');
      return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 65_536 }, defaultMaxTokens: 4096 });
    }
    async *stream(options) {
      if (consumed) fail('OFFLINE_SECOND_DISPATCH');
      consumed = true; // Set before the first await: concurrent or recovery dispatch cannot send again.
      const messages = options.messages.map(message => ({ role: message.role, content: message.content.map(block => {
        if (block.type !== 'text') fail('OFFLINE_NON_TEXT_INPUT');
        return { type: 'input_text', text: block.text };
      }) }));
      if (options.provider !== ROUTE || options.model !== MODEL || options.maxTokens !== 4096 || options.purpose !== undefined || options.system !== undefined
        || options.temperature !== undefined || options.stop !== undefined || options.reasoningEffort !== undefined || options.tools?.length
        || canonical(messages) !== canonical(body.input)) fail('OFFLINE_REQUEST_DRIFT');
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
      const response = await fetch(`http://127.0.0.1:${frozen.port}/v1/responses`, { method: 'POST', body: frozen.body, signal, redirect: 'error',
        headers: { ...attributionHeaders(), 'content-type': 'application/json', 'x-city-fixture-token': frozen.fixtureToken,
          'x-city-body-sha256': frozen.bodyHash, 'x-city-schema-sha256': frozen.schemaHash } });
      if (response.status !== 200 || response.headers.get('content-type') !== 'text/event-stream' || !response.body) fail('OFFLINE_HTTP_FAILURE');
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > MAX_BYTES) fail('OFFLINE_RESPONSE_TOO_LARGE'); chunks.push(chunk); }
      const rawBytes = Buffer.concat(chunks), wire = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
      const result = readTerminal(wire); // No block is published until the full terminal is accepted.
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: result.text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: result.text } };
      yield { type: 'usage', usage: result.usage };
      yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { version: 'structured-harness-fixture-1.0',
        schemaHash: frozen.schemaHash, bodyHash: frozen.bodyHash, rawResponseHash: hash(rawBytes), dispatches: 1 } } };
    }
  }
  ctx.llm.registerAdapter([ROUTE], new FixedAdapter());
}
