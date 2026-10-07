// Bounded, text-only Responses SSE witness. It neither performs I/O nor releases partial text.
import { createHash } from 'node:crypto';

export const RESPONSES_STREAM_VERSION = 'responses-text-stream-1.1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 2000;
const has = (value, key) => Object.hasOwn(value, key);
const shape = (value, required, optional = []) => object(value) && required.every(key => has(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

// JSON.parse silently overwrites aliases such as "type" and "\u0074ype". Scan every object first.
function uniqueJson(raw) {
  let at = 0;
  const white = () => { while (/\s/u.test(raw[at] ?? '') && at < raw.length) at++; };
  const string = () => {
    if (raw[at] !== '"') throw new Error('invalid-json');
    const start = at++;
    while (at < raw.length) {
      const char = raw[at++];
      if (char === '"') return JSON.parse(raw.slice(start, at));
      if (char === '\\') at++;
      else if (char.charCodeAt(0) < 32) throw new Error('invalid-json');
    }
    throw new Error('invalid-json');
  };
  const value = depth => {
    if (depth > 64) throw new Error('json-depth-limit');
    white();
    if (raw[at] === '{') {
      at++; white(); const seen = new Set();
      if (raw[at] === '}') { at++; return; }
      for (;;) {
        white(); const key = string();
        if (seen.has(key)) throw new Error('duplicate-json-property');
        seen.add(key); white();
        if (raw[at++] !== ':') throw new Error('invalid-json');
        value(depth + 1); white();
        if (raw[at] === '}') { at++; return; }
        if (raw[at++] !== ',') throw new Error('invalid-json');
      }
    }
    if (raw[at] === '[') {
      at++; white();
      if (raw[at] === ']') { at++; return; }
      for (;;) {
        value(depth + 1); white();
        if (raw[at] === ']') { at++; return; }
        if (raw[at++] !== ',') throw new Error('invalid-json');
      }
    }
    if (raw[at] === '"') { string(); return; }
    const start = at;
    while (at < raw.length && !/[\s,}\]]/u.test(raw[at])) at++;
    if (at === start) throw new Error('invalid-json');
    JSON.parse(raw.slice(start, at));
  };
  value(0); white();
  if (at !== raw.length) throw new Error('invalid-json');
  return JSON.parse(raw);
}

function readUsage(value) {
  if (value === undefined || value === null) return null;
  if (!shape(value, ['input_tokens', 'output_tokens', 'total_tokens'], ['input_tokens_details', 'output_tokens_details'])) throw new Error('invalid-usage');
  const input = value.input_tokens, output = value.output_tokens, total = value.total_tokens;
  if (![input, output, total].every(count) || !Number.isSafeInteger(input + output) || input + output !== total) throw new Error('invalid-usage');
  const details = (detail, key) => {
    if (detail === undefined) return 0;
    if (!shape(detail, [key]) || !count(detail[key])) throw new Error('invalid-usage-details');
    return detail[key];
  };
  const cached = details(value.input_tokens_details, 'cached_tokens');
  const reasoning = details(value.output_tokens_details, 'reasoning_tokens');
  if (cached > input || reasoning > output) throw new Error('usage-details-out-of-range');
  return { inputTokens: input, outputTokens: output, totalTokens: total, cacheReadTokens: cached, reasoningTokens: reasoning };
}

export function createResponsesStreamWitness({ expectedModel, maxBytes = 512_000, maxEvents = 8192 } = {}) {
  if (!identifier(expectedModel) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000
    || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 32768) throw new TypeError('Invalid Responses witness configuration');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const rawHash = createHash('sha256');
  let state = 'pending', reason, eof = false, byteCount = 0, rawResponseSha256 = null, hashTruncated = false;
  let eventCount = 0, responseId = null, terminalStatus = null, itemId = null, itemPhasePresent = null;
  let line = '', afterCR = false, eventName = null, data = [], stage = 'start', progress = false;
  let finalText = '', terminalUsage = null;
  const invalid = code => { if (state !== 'invalid' && state !== 'transport-failed') { state = 'invalid'; reason = code; } };
  const reject = code => { throw new Error(code); };
  const location = event => {
    if (event.output_index !== 0 || event.content_index !== 0 || event.item_id !== itemId) reject('content-identity-drift');
  };
  const part = (value, text) => {
    if (!shape(value, ['type', 'text', 'annotations'], ['logprobs']) || value.type !== 'output_text' || value.text !== text
      || !Array.isArray(value.annotations) || value.annotations.length !== 0 || has(value, 'logprobs') && (!Array.isArray(value.logprobs) || value.logprobs.length !== 0)) reject('unsupported-or-inconsistent-content');
  };
  const message = (value, status, text) => {
    if (!shape(value, ['id', 'type', 'role', 'status', 'content'], ['phase']) || !identifier(value.id) || value.type !== 'message'
      || value.role !== 'assistant' || value.status !== status || !Array.isArray(value.content)) reject('unsupported-output-item');
    if (itemId !== null && value.id !== itemId) reject('item-identity-drift');
    // Only an explicitly final answer can use phase. Bind its presence at added;
    // omission and addition later are drift, never a reason to infer completion.
    const phasePresent = has(value, 'phase');
    if (phasePresent && value.phase !== 'final_answer') reject('unsupported-item-phase');
    if (itemPhasePresent !== null && phasePresent !== itemPhasePresent) reject('item-phase-drift');
    if (text === null) { if (value.content.length !== 0) reject('early-content-output'); }
    else { if (value.content.length !== 1) reject('multiple-or-missing-content'); part(value.content[0], text); }
  };
  const response = (value, terminal = false) => {
    if (!object(value) || !identifier(value.id) || value.object !== 'response' || value.model !== expectedModel
      || value.status !== (terminal ? 'completed' : 'in_progress') || value.error !== null || value.incomplete_details !== null
      || !Array.isArray(value.output) || responseId !== null && value.id !== responseId) reject('response-identity-or-status-drift');
    if (!terminal) {
      if (value.output.length !== 0 || value.usage !== null) reject('early-response-output-or-usage');
    } else {
      if (value.output.length !== 1) reject('multiple-or-missing-output-item');
      message(value.output[0], 'completed', finalText);
      terminalUsage = readUsage(value.usage);
    }
  };
  const consume = () => {
    const suppliedName = eventName, content = data.join('\n');
    eventName = null; data = [];
    if (!content) { if (suppliedName !== null) reject('empty-sse-event'); return; }
    if (stage === 'terminal') reject('event-after-terminal');
    const event = uniqueJson(content);
    eventCount++;
    if (eventCount > maxEvents) reject('event-limit');
    if (!object(event) || typeof event.type !== 'string' || suppliedName !== null && suppliedName !== event.type
      || event.sequence_number !== eventCount - 1 || !count(event.sequence_number)) reject('event-identity-or-sequence-drift');
    const base = ['type', 'sequence_number'];
    const requireShape = (required, optional = []) => { if (!shape(event, [...base, ...required], optional)) reject('unsupported-event-shape'); };
    if (event.type === 'response.created') {
      requireShape(['response']); if (stage !== 'start') reject('event-order');
      response(event.response); responseId = event.response.id; stage = 'created';
    } else if (event.type === 'response.in_progress') {
      requireShape(['response']); if (stage !== 'created' || progress) reject('event-order');
      response(event.response); progress = true;
    } else if (event.type === 'response.output_item.added') {
      requireShape(['output_index', 'item']); if (stage !== 'created' || event.output_index !== 0) reject('event-order-or-output-index');
      message(event.item, 'in_progress', null); itemId = event.item.id; itemPhasePresent = has(event.item, 'phase'); stage = 'item';
    } else if (event.type === 'response.content_part.added') {
      requireShape(['item_id', 'output_index', 'content_index', 'part']); if (stage !== 'item') reject('event-order');
      location(event); part(event.part, ''); stage = 'text';
    } else if (event.type === 'response.output_text.delta') {
      requireShape(['item_id', 'output_index', 'content_index', 'delta'], ['logprobs']); if (stage !== 'text') reject('event-order');
      location(event); if (typeof event.delta !== 'string' || has(event, 'logprobs') && (!Array.isArray(event.logprobs) || event.logprobs.length)) reject('unsupported-text-delta');
      finalText += event.delta;
    } else if (event.type === 'response.output_text.done') {
      requireShape(['item_id', 'output_index', 'content_index', 'text'], ['logprobs']); if (stage !== 'text') reject('event-order');
      location(event); if (event.text !== finalText || has(event, 'logprobs') && (!Array.isArray(event.logprobs) || event.logprobs.length)) reject('terminal-text-drift');
      stage = 'text-done';
    } else if (event.type === 'response.content_part.done') {
      requireShape(['item_id', 'output_index', 'content_index', 'part']); if (stage !== 'text-done') reject('event-order');
      location(event); part(event.part, finalText); stage = 'part-done';
    } else if (event.type === 'response.output_item.done') {
      requireShape(['output_index', 'item']); if (stage !== 'part-done' || event.output_index !== 0) reject('event-order-or-output-index');
      message(event.item, 'completed', finalText); stage = 'item-done';
    } else if (event.type === 'response.completed') {
      requireShape(['response']); if (stage !== 'item-done') reject('event-order');
      response(event.response, true); terminalStatus = 'completed'; stage = 'terminal';
    } else reject('unsupported-response-event');
  };
  const consumeLine = () => {
    const value = line; line = '';
    if (value === '') { consume(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':'), name = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (name === 'data') data.push(content);
    else if (name === 'event') {
      if (eventName !== null || !content || content.includes('\0')) reject('invalid-sse-event-name');
      eventName = content;
    }
    // Standard SSE id/retry/unknown fields do not create semantic response events.
  };
  const decoded = value => {
    for (const char of value) {
      if (afterCR) { afterCR = false; if (char === '\n') continue; }
      if (char === '\r') { consumeLine(); afterCR = true; }
      else if (char === '\n') consumeLine();
      else line += char;
    }
  };
  return {
    observe(chunk) {
      if (eof) { invalid('bytes-after-eof'); rawResponseSha256 = null; return; }
      try {
        if (!(chunk instanceof Uint8Array)) reject('invalid-byte-chunk');
        byteCount += chunk.byteLength;
        if (byteCount > maxBytes) { hashTruncated = true; reject('byte-limit'); }
        rawHash.update(chunk);
        // Invalid/failed is sticky, but the hash must still cover every bounded byte received to EOF.
        if (state === 'pending') decoded(decoder.decode(chunk, { stream: true }));
      } catch (error) { invalid(error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : 'invalid-utf8-or-json'); }
    },
    complete() {
      if (eof) return;
      eof = true;
      try {
        if (state === 'pending') {
          decoded(decoder.decode());
          if (line.length || data.length || eventName !== null) reject('incomplete-sse-frame');
          if (stage !== 'terminal') { state = 'missing'; reason = 'missing-terminal'; }
          else if (terminalUsage === null) { state = 'missing'; reason = 'missing-usage'; }
          else state = 'reported';
        }
      } catch (error) { invalid(error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : 'invalid-utf8-or-json'); }
      rawResponseSha256 = hashTruncated ? null : rawHash.digest('hex');
    },
    fail(code = 'transport-failed') {
      if (state === 'invalid' || state === 'transport-failed') return;
      state = 'transport-failed'; reason = typeof code === 'string' && /^[a-z0-9-]{1,128}$/.test(code) ? code : 'transport-failed';
    },
    snapshot() {
      return { version: RESPONSES_STREAM_VERSION, state, ...(reason ? { reason } : {}), responseId, rawResponseSha256, eventCount,
        terminalStatus, text: state === 'reported' ? finalText : null, usage: state === 'reported' ? { ...terminalUsage } : null };
    },
  };
}
