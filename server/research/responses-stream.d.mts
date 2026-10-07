export declare const RESPONSES_STREAM_VERSION: 'responses-text-stream-1.1';
export interface ResponsesStreamUsage {
  /** The complete input count, including cache hits; adapters may explicitly split it. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}
export interface ResponsesStreamSnapshot {
  version: typeof RESPONSES_STREAM_VERSION;
  state: 'pending' | 'reported' | 'missing' | 'invalid' | 'transport-failed';
  reason?: string;
  responseId: string | null;
  /** Hash of all observed bounded bytes after complete(); null before EOF, on overflow, or on post-EOF bytes. */
  rawResponseSha256: string | null;
  eventCount: number;
  terminalStatus: string | null;
  text: string | null;
  usage: ResponsesStreamUsage | null;
}
/** Text-only subset: message phase is absent at every stage or consistently final_answer; no commentary/reasoning/tool output. */
export declare function createResponsesStreamWitness(options: {
  expectedModel: string;
  maxBytes?: number;
  maxEvents?: number;
}): {
  observe(chunk: Uint8Array): void;
  complete(): void;
  fail(reason?: string): void;
  snapshot(): ResponsesStreamSnapshot;
};
