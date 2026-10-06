import { researchApi } from './research-client';
import type { SurveyRun } from '../shared/survey-engine';
import type { ResearchProjectInput } from '../server/research/residents';

export async function runLocalSurvey(input: ResearchProjectInput & { mode: 'fixture' | 'live'; count: number; seed: number; assumptionsAccepted: true; pricing: NonNullable<SurveyRun['pricing']> }, signal: AbortSignal, update: (run: SurveyRun) => void): Promise<SurveyRun> {
  const { id } = await researchApi<{ id: string }>('/surveys', 'POST', input);
  const cancel = () => { void researchApi(`/surveys/${id}/cancel`, 'POST', {}).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  try {
    while (true) {
      const run = await researchApi<SurveyRun>(`/surveys/${id}`); update(run);
      if (run.state !== 'running') return run;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { signal.removeEventListener('abort', cancel); }
}
