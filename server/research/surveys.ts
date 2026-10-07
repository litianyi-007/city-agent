import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CityStore, StoreError } from '../store.js';
import { runRole, HARNESS_NAME } from '../harness.js';
import { getPopulationModel, getPopulationPack } from '../population/service.js';
import { researchProjectInputSchema } from './residents.js';
import { buildProfiles, fingerprint } from '../../shared/survey-engine.js';
import { assertSurveyInputsSafe, executeSurvey } from '../../shared/survey-runner.js';

export const surveyInputSchema = researchProjectInputSchema.extend({
  mode: z.enum(['fixture', 'live']), count: z.number().int().min(1).max(30), seed: z.number().int().min(0).max(2147483647), assumptionsAccepted: z.literal(true),
  pricing: z.object({ currency: z.literal('CNY'), inputPerMillion: z.number().finite().min(0).nullable(), outputPerMillion: z.number().finite().min(0).nullable(), suppliedAt: z.string().max(80), source: z.string().max(500) }).strict(),
  frozenFromRunId: z.string().uuid().optional(), exposure: z.enum(['full', 'no-persona', 'demographics-only']).optional(), experiment: z.object({ id: z.string().max(80), arm: z.string().max(80) }).strict().optional(),
}).strict();
export function createSurveyService(store: CityStore, model = runRole) {
  const active = new Map<string, AbortController>();
  return {
    start(body: unknown) {
      const input = surveyInputSchema.parse(body);
      if (active.size) throw new StoreError('已有问卷正在运行，请完成或取消后再开始。', 409);
      if (input.mode === 'live' && input.count > 12) throw new StoreError('首批真实模型最多12人。');
      const selected = input.residentAgentIds.map(id => {
        const agent = store.getResidentAgent(id, true);
        if (!agent?.enabled || input.mode === 'live' && !agent.apiKey) throw new StoreError('所选预设未启用或缺少Key。');
        return agent;
      });
      const population = getPopulationModel(); const pack = getPopulationPack();
      buildProfiles(input.task, population, selected, input.count, input.seed);
      const source = input.frozenFromRunId ? store.listSurveyRuns().find(run => run.id === input.frozenFromRunId) : undefined;
      if (input.frozenFromRunId && (!source || source.state !== 'completed' || source.models.length !== selected.length || source.profiles.length < input.count || source.seed !== input.seed || source.populationHash !== population.datasetHash || fingerprint(source.task.population) !== fingerprint(input.task.population) || source.models.some(model => !selected.some(agent => agent.id === model.presetId && agent.modelId === model.modelId && agent.provider === model.provider && agent.baseUrl === model.baseUrl)))) throw new StoreError('冻结实验的来源、人口、样本数、seed或模型配置不一致。');
      if (source && source.profiles.slice(0, input.count).some(profile => fingerprint(profile.persona ?? null) !== fingerprint(selected.find(agent => agent.id === profile.presetId)?.persona ?? null))) throw new StoreError('冻结画像的五层设定与当前预设不一致；请使用原预设或另立新画像实验。');
      const publicPresets = selected.map(({ apiKey: _key, ...agent }) => agent);
      const knownSecrets = selected.flatMap(agent => agent.apiKey ? [agent.apiKey] : []);
      assertSurveyInputsSafe({ task: input.task, presets: publicPresets, frozenProfiles: source?.profiles.slice(0, input.count), pricing: input.pricing, experiment: input.experiment }, knownSecrets);
      const id = randomUUID(); const controller = new AbortController(); active.set(id, controller);
      void executeSurvey({ ...input, id, population, pack, presets: publicPresets, knownSecrets, frozenProfiles: source?.profiles.slice(0, input.count), signal: controller.signal,
        checkpoint: async run => { run.limitations.push(`本机居民通过 ${HARNESS_NAME} 执行；此问卷调用不等于研发四角色交付。`); store.saveSurveyRun(run); },
        call: async (profile, system, user, signal) => {
          const agent = selected.find(agent => agent.id === profile.presetId)!;
          const result = await model({ provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId, apiKey: agent.apiKey! }, system, user, signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true });
          return { text: result.text, inputTokens: result.usageReported === false ? null : result.inputTokens, outputTokens: result.usageReported === false ? null : result.outputTokens };
        },
      }).then(run => { run.limitations.push(`本机居民通过 ${HARNESS_NAME} 执行。`); store.saveSurveyRun(run); }).catch(() => {
        const latest = store.listSurveyRuns().find(run => run.id === id);
        if (latest) { latest.state = 'stopped'; latest.limitations.push('运行异常停止，保留已完成快照；不会自动重试。'); store.saveSurveyRun(latest); }
      }).finally(() => active.delete(id));
      return { id };
    },
    cancel(id: string) { const controller = active.get(id); if (!controller) throw new StoreError('此问卷没有正在运行的请求。', 409); controller.abort(); },
  };
}
