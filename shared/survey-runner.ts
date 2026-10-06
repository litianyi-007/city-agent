import { auditPack, hashPopulationPack, type CompiledPopulation, type RegionPack } from '../server/population/model';
import type { ResidentAgentPublic } from '../server/research/residents';
import type { ResearchTask } from './research-schema';
import { HASH_ALGORITHM, fingerprint } from './evidence';
import { buildAnalysis, samplingReport } from './survey-analysis';
import { buildProfiles, checkCoherence, fixtureAnswers, residentPrompt, RESIDENT_SYSTEM_PROMPT, summarize, SURVEY_VERSION, validateAnswers, type Profile, type ResponseRecord, type SurveyRun } from './survey-engine';

export interface SurveyExecution {
  task: ResearchTask; population: CompiledPopulation; pack: RegionPack; presets: ResidentAgentPublic[]; count: number; seed: number; mode: 'fixture' | 'live';
  pricing: { currency: 'CNY'; inputPerMillion: number | null; outputPerMillion: number | null; suppliedAt: string; source: string };
  signal: AbortSignal;
  call: (profile: Profile, system: string, user: string, signal: AbortSignal) => Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  progress?: (text: string) => void;
  checkpoint?: (run: SurveyRun) => Promise<void>;
  frozenProfiles?: Profile[]; exposure?: 'full' | 'no-persona' | 'demographics-only'; experiment?: { id: string; arm: string };
  id?: string;
}
export async function executeSurvey(input: SurveyExecution): Promise<SurveyRun> {
  const startedAt = new Date().toISOString(); const started = performance.now();
  const profiles = input.frozenProfiles ? structuredClone(input.frozenProfiles) : buildProfiles(input.task, input.population, input.presets, input.count, input.seed);
  const task = structuredClone(input.task); const presets = structuredClone(input.presets); const exposure = input.exposure ?? 'full';
  const users = profiles.map(profile => ({ residentId: profile.id, text: residentPrompt(task, profile, exposure), hash: fingerprint(residentPrompt(task, profile, exposure)) }));
  const responses: ResponseRecord[] = []; let calls = 0; let inFlight = false; let stopped = ''; const id = input.id ?? crypto.randomUUID();
  const run = (state: 'running' | 'completed' | 'cancelled' | 'stopped'): SurveyRun => {
    const sums = (field: 'inputTokens' | 'outputTokens') => responses.some(response => response[field] === null) ? null : responses.reduce((sum, response) => sum + response[field]!, 0);
    const inputTokens = inFlight ? null : sums('inputTokens'); const outputTokens = inFlight ? null : sums('outputTokens');
    const analysis = buildAnalysis(task, profiles, responses); const summaries = summarize(task, responses);
    const oneModel = new Set(presets.map(agent => `${agent.provider}:${agent.modelId}:${agent.baseUrl}`)).size === 1;
    return { id, version: SURVEY_VERSION, mode: input.mode, state, startedAt, durationMs: performance.now() - started,
      task, taskHash: fingerprint(task), populationHash: input.population.datasetHash, hashAlgorithm: HASH_ALGORITHM,
      populationSnapshot: input.pack, populationAudit: auditPack(input.pack), seed: input.seed, profiles, profileHash: fingerprint(profiles), responses: [...responses], summaries, analysis,
      sampling: samplingReport(profiles), exposure, experiment: input.experiment,
      presetSnapshots: presets.map(({ hasApiKey: _hasApiKey, ...publicPreset }) => publicPreset),
      models: presets.map(agent => ({ presetId: agent.id, provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId })),
      parameters: { maxOutputTokens: 3000, timeoutMs: 90000, retries: 0, concurrency: 1, temperature: null, providerSeed: null, answerCache: false, reasoning: presets.every(agent => agent.provider === 'deepseek') ? 'DeepSeek thinking disabled' : 'DeepSeek disabled; others provider default' },
      timingBasis: '从构建画像之前到当前统计/分析完成；包含模型等待与诊断，不含渲染、持久化及导出；running记录为部分进度。',
      pricing: { ...input.pricing },
      prompt: { system: RESIDENT_SYSTEM_PROMPT, systemHash: fingerprint(RESIDENT_SYSTEM_PROMPT), users },
      metrics: { planned: profiles.length, valid: responses.filter(response => response.status === 'valid').length, structurallyValid: responses.filter(response => response.structureValid).length, contradictions: responses.filter(response => response.coherence?.status === 'contradiction').length,
        failed: responses.filter(response => ['failed', 'invalid'].includes(response.status)).length, notStarted: profiles.length - responses.filter(response => response.status !== 'not-started').length,
        modelCalls: calls, inputTokens, outputTokens, apiCostCny: input.mode === 'fixture' ? 0 : oneModel && inputTokens !== null && outputTokens !== null && input.pricing.inputPerMillion !== null && input.pricing.outputPerMillion !== null ? (inputTokens * input.pricing.inputPerMillion + outputTokens * input.pricing.outputPerMillion) / 1e6 : null,
        pricingBasis: input.mode === 'fixture' ? '没有API请求，API费用为0；不含本机计算成本。' : '按证据包 pricing 中用户提供的CNY/百万Token单价估算；多模型或usage/单价缺失保持未知，最终以账单为准。' },
      limitations: ['合成实验不代表滨江真人市场偏好。', '覆盖抽样没有总体权重；细分年龄、资格、画像说明和行为为显式假设。', '人口联合采用独立性推断；结构审计不是外部效度证明。', '自洽仅覆盖已登记硬规则；未做真人校准或完整人格效度验证。', input.mode === 'fixture' ? '本次是规则工程夹具，未调用LLM。' : '本次使用配置接口；模型身份未独立认证。', ...(exposure === 'full' ? [] : ['本次为属性消融；硬规则诊断对照冻结画像，但模型没有看到被消融的属性。'])], marketResearchValidated: false };
  };
  if (hashPopulationPack(input.pack) !== input.population.datasetHash) throw new Error('人口快照与编译模型指纹不一致。');
  await input.checkpoint?.(run('running'));
  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    if (input.signal.aborted || stopped) {
      responses.push({ residentId: profile.id, status: 'not-started', answers: [], raw: '', error: stopped || '用户取消，未发请求。', durationMs: 0, inputTokens: 0, outputTokens: 0 }); continue;
    }
    input.progress?.(`${input.mode === 'fixture' ? '规则演示' : '模型作答'} ${index + 1}/${profiles.length} · ${profile.streetName} · ${profile.presetName}`);
    const began = performance.now(); let raw = ''; let usage: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: input.mode === 'fixture' ? 0 : null, outputTokens: input.mode === 'fixture' ? 0 : null };
    try {
      if (input.mode === 'fixture') { raw = fixtureAnswers(task, profile, input.seed); await new Promise(resolve => setTimeout(resolve, 10)); }
      else { calls++; inFlight = true; await input.checkpoint?.(run('running')); const result = await input.call(profile, RESIDENT_SYSTEM_PROMPT, users[index].text, input.signal); raw = result.text; usage = result; inFlight = false; }
      try {
        const answers = validateAnswers(task, profile.id, raw); const coherence = checkCoherence(task, profile, answers);
        responses.push({ residentId: profile.id, status: exposure === 'full' && coherence.status === 'contradiction' ? 'invalid' : 'valid', structureValid: true, answers, coherence, raw, ...(coherence.status === 'contradiction' ? { error: '违反已登记画像约束；保留原始答卷和诊断。' } : {}), durationMs: performance.now() - began, ...usage });
      } catch (error) { responses.push({ residentId: profile.id, status: 'invalid', structureValid: false, answers: [], raw, error: (error as Error).message, durationMs: performance.now() - began, ...usage }); }
    } catch (error) {
      inFlight = false;
      // Harness exposes only sanitized evidence; no credentials or provider objects.
      const evidence = (error as { evidence?: { text: string; inputTokens: number | null; outputTokens: number | null } }).evidence;
      if (evidence) { raw = evidence.text; usage = evidence; }
      stopped = input.signal.aborted ? '用户取消。' : `前序请求失败，停止后续调度：${(error as Error).message}`;
      responses.push({ residentId: profile.id, status: 'failed', answers: [], raw, error: (error as Error).message, durationMs: performance.now() - began, ...usage });
    }
    await input.checkpoint?.(run('running'));
  }
  return run(input.signal.aborted ? 'cancelled' : stopped ? 'stopped' : 'completed');
}
