import type { SurveyResult } from './city.js';
import type { SurveyRun } from '../shared/survey-engine.js';

export const ROLES = ['product', 'developer', 'tester', 'researcher'] as const;
export type Role = (typeof ROLES)[number];
export const PROVIDERS = ['openai-compatible', 'anthropic', 'deepseek'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Public configuration. API keys never appear in this shape. */
export interface AgentPublic {
  id: string;
  name: string;
  role: Role;
  provider: Provider;
  baseUrl: string;
  modelId: string;
  hasApiKey: boolean;
  enabled: boolean;
  temperature?: number;
}

/** Internal-only configuration, returned only when explicitly requested. */
export interface Agent extends AgentPublic {
  apiKey?: string;
}

export interface AgentInput {
  name: string;
  role: Role;
  provider?: Provider;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string | null;
  enabled?: boolean;
  temperature?: number;
}

export type AgentPatch = Partial<AgentInput>;
export type RunMode = 'demo' | 'live';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Stage {
  role: Role;
  status: StageStatus;
  output: string;
  agentId: string;
  attempt: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface RunEvent {
  id: string;
  time: string;
  type: string;
  message: string;
  role?: Role;
}

export interface Artifact {
  name: string;
  /** Path relative to this run's private artifact directory. */
  path: string;
  type: string;
}

export interface GateResult {
  passed: boolean;
  failureKind?: 'infrastructure' | 'timeout';
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  summary?: string;
}

export interface Run {
  id: string;
  task: string;
  mode: RunMode;
  /** Complete submitted settings, including defaults, for reproducible retries. */
  input: NormalizedRunInput;
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  stages: Stage[];
  events: RunEvent[];
  artifacts: Artifact[];
  usage: { inputTokens: number; outputTokens: number; estimatedCost: null; complete?: boolean };
  survey?: SurveyResult;
  questionnaireSurvey?: SurveyRun;
  error?: string;
  gate?: GateResult;
  agentSnapshot: AgentPublic[];
}

export interface RunInput {
  task: string;
  mode: RunMode;
  agentIds: string[];
  product?: string;
  price?: number;
  sampleSize?: number;
  seed?: number;
  researchSurveyId?: string;
}

export type NormalizedRunInput = Required<Omit<RunInput, 'researchSurveyId'>> & Pick<RunInput, 'researchSurveyId'>;

export interface Runner {
  start(runId: string, input: RunInput): void | Promise<void>;
  cancel(runId: string): void | Promise<void>;
}
