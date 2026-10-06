import { researchTaskSchema, type ResearchTask } from '../shared/research-schema';
import type { ResearchProjectInput } from '../server/research/residents';

export function readResearchDraft(task: ResearchTask | null, filters: string, declarations: string, residentAgentIds: string[]): ResearchProjectInput {
  if (!task) throw new Error('问卷尚未加载。');
  let parsed: unknown;
  try { parsed = { ...task, population: { ...task.population, filters: JSON.parse(filters) }, declarations: JSON.parse(declarations) }; }
  catch { throw new Error('人口筛选或证据声明不是有效 JSON，请检查高级配置。'); }
  const result = researchTaskSchema.safeParse(parsed);
  if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join('.') || '问卷'}：${issue.message}`).join('；'));
  return { task: result.data, residentAgentIds: [...residentAgentIds] };
}

/** A blank draft may be incomplete, but must not silently inherit a template's research target. */
export function createBlankResearchTask(population: ResearchTask['population'], id: string): ResearchTask {
  return {
    schemaVersion: '1.0', id: `task-${id}`, title: '新调查', objective: 'questionnaire-quality',
    decisionContext: { offering: '', buyer: '', endUser: '', channel: '' },
    population: { ...population, unit: 'person', filters: [] },
    questionnaire: { id: `questionnaire-${id}`, version: '1', questions: [{ id: 'question-1', type: 'text', prompt: '', required: true, maxLength: 1000 }] },
    declarations: [], requestedOutputs: ['questionnaire-review'],
  };
}
