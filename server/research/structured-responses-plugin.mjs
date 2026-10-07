// Dormant research candidate: only the bounded parent wrapper registers this adapter.
import { createHash } from 'node:crypto';
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { createResponsesStreamWitness } from './responses-stream.mjs';

export const name = 'city-bounded-responses';
export const inject = ['llm'];
const ROUTE = 'city-bounded-responses';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const fail = code => { throw new LlmError('Bounded Responses adapter rejected the invocation.', code); };

export function apply(ctx, config) {
  if (!config || Object.keys(config).sort().join(',') !== 'body,bodyHash,maxOutputTokens,modelId,port,relayToken,schemaHash'
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || typeof config.relayToken !== 'string' || !/^[a-f0-9-]{36}$/.test(config.relayToken)
    || typeof config.body !== 'string' || Buffer.byteLength(config.body) > 512_000
    || config.modelId !== 'deepseek-flash' || !Number.isSafeInteger(config.maxOutputTokens)
    || config.maxOutputTokens < 128 || config.maxOutputTokens > 12_000) fail('RESPONSES_INVALID_CONFIG');
  const body = JSON.parse(config.body);
  if (hash(config.body) !== config.bodyHash || hash(canonical(body.text?.format?.schema)) !== config.schemaHash
    || body.model !== config.modelId || body.stream !== true || body.max_output_tokens !== config.maxOutputTokens
    || body.tool_choice !== 'none' || !Array.isArray(body.tools) || body.tools.length
    || body.text.format.type !== 'json_schema' || body.text.format.name !== 'resident_answers'
    || !Array.isArray(body.input) || body.input.length !== 2) fail('RESPONSES_CONFIG_DRIFT');
  const frozen = structuredClone(config);
  let consumed = false;
  class FixedAdapter extends LlmAdapter {
    providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, ROUTE); }
    async resolveModel(provider, model) {
      if (provider !== ROUTE || model !== frozen.modelId) fail('RESPONSES_ROUTE_DRIFT');
      return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 65_536 }, defaultMaxTokens: frozen.maxOutputTokens };
    }
    async *stream(options) {
      if (consumed) fail('RESPONSES_SECOND_DISPATCH');
      consumed = true;
      const messages = options.messages.map(message => ({ role: message.role, content: message.content.map(block => {
        if (block.type !== 'text') fail('RESPONSES_NON_TEXT_INPUT');
        return { type: 'input_text', text: block.text };
      }) }));
      if (options.provider !== ROUTE || options.model !== frozen.modelId || options.maxTokens !== frozen.maxOutputTokens
        || options.purpose !== undefined || options.system !== undefined || options.temperature !== undefined || options.stop !== undefined
        || options.reasoningEffort !== undefined || options.tools?.length || canonical(messages) !== canonical(body.input)) fail('RESPONSES_PROMPT_DRIFT');
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
      const response = await fetch(`http://127.0.0.1:${frozen.port}/v1/responses`, { method: 'POST', body: frozen.body, signal, redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${frozen.relayToken}` } });
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream' || !response.body) fail('RESPONSES_HTTP_REJECTED');
      const witness = createResponsesStreamWitness({ expectedModel: frozen.modelId });
      for await (const bytes of response.body) witness.observe(bytes);
      witness.complete(); const result = witness.snapshot();
      if (result.state !== 'reported' || !result.usage || result.text === null || !result.rawResponseSha256) fail('RESPONSES_STREAM_REJECTED');
      // No content leaves the adapter before EOF, semantic terminal and complete usage acceptance.
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: result.text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: result.text } };
      yield { type: 'usage', usage: { inputTokens: result.usage.inputTokens - result.usage.cacheReadTokens,
        cacheReadTokens: result.usage.cacheReadTokens, outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens, reasoningTokens: result.usage.reasoningTokens } };
      yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { version: 'bounded-responses-harness-1.0',
        schemaHash: frozen.schemaHash, bodyHash: frozen.bodyHash, rawResponseHash: result.rawResponseSha256, dispatches: 1 } } };
    }
  }
  ctx.llm.registerAdapter([ROUTE], new FixedAdapter());
}
