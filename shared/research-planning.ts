import { z } from 'zod';
import { researchTaskSchema, type ResearchTask } from './research-schema.js';

const boundedText = z.string().trim().min(1).max(2000);
const notes = z.array(boundedText).max(30);

/** Only user intent and an explicit statistical frame; no credentials or resident execution. */
export const researchPlanningInputSchema = z.object({
  request: z.string().trim().min(1).max(8000),
  population: z.object({
    regionCode: z.string().trim().min(1).max(80),
    period: z.string().trim().min(1).max(80),
    unit: z.enum(['person', 'household']),
  }).strict(),
  context: z.string().trim().max(4000).optional(),
  maxQuestions: z.number().int().min(1).max(20).default(12),
}).strict();

/** The task has exactly the same structural contract as manually authored questionnaires. */
export const researchPlanningModelOutputSchema = z.object({
  task: researchTaskSchema,
  assumptions: notes,
  clarifications: notes,
  dataGaps: notes,
}).strict();

export type ResearchPlanningInput = z.infer<typeof researchPlanningInputSchema>;
export type ResearchPlanningModelOutput = z.infer<typeof researchPlanningModelOutputSchema>;

export interface ResearchPlanningEvidence {
  schemaVersion: '1.0';
  plannerVersion: string;
  execution: 'harness' | 'injected-runner';
  state: 'requesting' | 'candidate' | 'failed' | 'cancelled' | 'timed-out';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  modelCalls: number;
  model: { provider: string; baseUrl: string; modelId: string; temperature?: number };
  modelConfigHash: string;
  input: ResearchPlanningInput;
  inputHash: string;
  systemPrompt: string;
  userPrompt: string;
  promptHash: string;
  rawResponse: string;
  responseHash: string;
  inputTokens: number | null;
  outputTokens: number | null;
  usageStatus: 'reported' | 'unknown';
  cost: null;
  costStatus: 'unknown';
  harness: string;
  limits: { timeoutMs: number; maxOutputTokens: number; maxQuestions: number };
  error?: string;
}

export interface ResearchPlanningResult extends ResearchPlanningModelOutput {
  schemaVersion: '1.0';
  status: 'candidate';
  candidate: true;
  semanticValidation: 'not-performed';
  marketResearchValidated: false;
  residentCalls: 0;
  limitations: string[];
  evidence: ResearchPlanningEvidence;
  task: ResearchTask;
}
