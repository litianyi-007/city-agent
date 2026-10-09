import { auditPack, hashPopulationPack, type CompiledPopulation, type RegionPack } from '../server/population/model';
import type { ResidentAgentPublic } from '../server/research/residents';
import type { ResearchTask } from './research-schema';
import { HASH_ALGORITHM, fingerprint } from './evidence';
import { containsKnownSecret, redactKnownSecret } from './redaction';
import { buildAnalysis, samplingReport } from './survey-analysis';
import { checkQuestionnaireLogic } from './questionnaire-logic';
import { registeredLogicRulesFor, surveyLogicAudit } from './registered-questionnaire-logic';
import { buildProfiles, checkCoherence, fixtureAnswers, residentPrompt, RESIDENT_PROMPT_VERSION, RESIDENT_SYSTEM_PROMPT, summarize, SURVEY_VERSION, validateAnswers, validateProfileEligibility, type Profile, type ResponseRecord, type SurveyRun } from './survey-engine';

export interface SurveyExecution {
  task: ResearchTask; population: CompiledPopulation; pack: RegionPack; presets: ResidentAgentPublic[]; count: number; seed: number; mode: 'fixture' | 'live';
  pricing: { currency: 'CNY'; inputPerMillion: number | null; outputPerMillion: number | null; suppliedAt: string; source: string };
  signal: AbortSignal;
  call: (profile: Profile, system: string, user: string, signal: AbortSignal) => Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  progress?: (text: string) => void;
  checkpoint?: (run: SurveyRun) => Promise<void>;
  frozenProfiles?: Profile[]; exposure?: 'full' | 'no-persona' | 'demographics-only'; experiment?: { id: string; arm: string };
  id?: string;
  /** Control-plane only: never included in the run, prompt, checkpoint or export. */
  knownSecrets?: readonly string[];
  /** Trusted in-process engineering hook; never populated from an HTTP/body or evidence import. Fixture only. */
  fixtureResponse?: (profile: Profile, task: ResearchTask, seed: number) => string;
  fixturePolicyId?: string;
  /** Trusted pre-registered experiment hook, never accepted from an HTTP body. Does not rewrite answers. */
  stopAfterResponse?: (response: ResponseRecord, profile: Profile) => string | undefined;
}
export function assertSurveyInputsSafe(value: unknown, secrets: readonly string[] = []): void {
  const serialized = JSON.stringify(value);
  if (secrets.filter(Boolean).some(secret => containsKnownSecret(serialized, secret))) throw new Error('问卷或画像包含模型凭据，请移除后再运行；尚未保存运行或调用模型。');
}
export async function executeSurvey(input: SurveyExecution): Promise<SurveyRun> {
  if (input.fixtureResponse !== undefined || input.fixturePolicyId !== undefined) {
    if (input.mode !== 'fixture' || typeof input.fixtureResponse !== 'function' || typeof input.fixturePolicyId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.fixturePolicyId)) throw new Error('工程夹具注入须仅用于fixture模式，并成对提供函数与有效policy ID。');
  }
  assertSurveyInputsSafe({ task: input.task, presets: input.presets, frozenProfiles: input.frozenProfiles, pricing: input.pricing, experiment: input.experiment }, input.knownSecrets);
  const startedAt = new Date().toISOString(); const started = performance.now();
  // Also run frame/count/seed/output validation for frozen inputs, before any checkpoint or request.
  const generated = buildProfiles(input.task, input.population, input.presets, input.count, input.seed);
  if (new Set(input.presets.map(preset => preset.id)).size !== input.presets.length) throw new Error('冻结预设ID不能重复。');
  const profiles = input.frozenProfiles ? structuredClone(input.frozenProfiles) : generated;
  if (profiles.length !== input.count || new Set(profiles.map(profile => profile.id)).size !== profiles.length) throw new Error('冻结画像数量须与count一致，ID不能重复。');
  for (const profile of profiles) {
    const preset = input.presets.find(item => item.id === profile.presetId);
    if (!preset) throw new Error('冻结画像缺少对应预设。');
    validateProfileEligibility(input.task, profile, input.population, preset);
    if (fingerprint(profile.persona ?? null) !== fingerprint(preset.persona ?? null)) throw new Error('冻结画像的五层设定与所选预设不一致。');
  }
  const task = structuredClone(input.task); const presets = structuredClone(input.presets); const exposure = input.exposure ?? 'full';
  const logicRules = registeredLogicRulesFor(task);
  const safeText = (text: string) => (input.knownSecrets ?? []).filter(Boolean).reduce((value, secret) => redactKnownSecret(value, secret), text);
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
      parameters: { residentPromptVersion: RESIDENT_PROMPT_VERSION, maxOutputTokens: 3000, timeoutMs: 90000, retries: 0, concurrency: 1, temperature: null, providerSeed: null, answerCache: false, reasoning: presets.every(agent => agent.provider === 'deepseek') ? 'DeepSeek thinking disabled' : 'DeepSeek disabled; others provider default', ...(input.fixturePolicyId ? { fixturePolicyId: input.fixturePolicyId } : {}) },
      timingBasis: '从构建画像之前到当前统计/分析完成；包含模型等待与诊断，不含渲染、持久化及导出；running记录为部分进度。',
      pricing: { ...input.pricing },
      prompt: { system: RESIDENT_SYSTEM_PROMPT, systemHash: fingerprint(RESIDENT_SYSTEM_PROMPT), users },
      logicAudit: surveyLogicAudit(task, responses),
      metrics: { planned: profiles.length, valid: responses.filter(response => response.status === 'valid').length, structurallyValid: responses.filter(response => response.structureValid).length, contradictions: responses.filter(response => response.coherence?.status === 'contradiction' || response.logic?.status === 'conflict').length,
        failed: responses.filter(response => ['failed', 'invalid'].includes(response.status)).length, notStarted: profiles.length - responses.filter(response => response.status !== 'not-started').length,
        modelCalls: calls, inputTokens, outputTokens, apiCostCny: input.mode === 'fixture' ? 0 : oneModel && inputTokens !== null && outputTokens !== null && input.pricing.inputPerMillion !== null && input.pricing.outputPerMillion !== null ? (inputTokens * input.pricing.inputPerMillion + outputTokens * input.pricing.outputPerMillion) / 1e6 : null,
        pricingBasis: input.mode === 'fixture' ? '没有API请求，API费用为0；不含本机计算成本。' : '按证据包 pricing 中用户提供的CNY/百万Token单价估算；多模型或usage/单价缺失保持未知，最终以账单为准。' },
      limitations: ['合成实验不代表滨江真人市场偏好。', '覆盖抽样没有总体权重；细分年龄、资格、画像说明和行为为显式假设。', '人口联合采用独立性推断；结构审计不是外部效度证明。', '自洽仅覆盖已登记硬规则；未做真人校准或完整人格效度验证。', input.mode === 'fixture' ? '本次是规则工程夹具，未调用LLM。' : '本次使用配置接口；模型身份未独立认证。', ...(input.fixturePolicyId ? [`本次使用显式工程夹具policy ${input.fixturePolicyId}；规则生成不计真实模型质量或人格行为效度。`] : []), ...(exposure === 'full' ? [] : ['本次为属性消融；硬规则诊断对照冻结画像，但模型没有看到被消融的属性。'])], marketResearchValidated: false };
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
      if (input.mode === 'fixture') { raw = safeText(input.fixtureResponse ? input.fixtureResponse(profile, task, input.seed) : fixtureAnswers(task, profile, input.seed)); await new Promise(resolve => setTimeout(resolve, 10)); }
      else { calls++; inFlight = true; await input.checkpoint?.(run('running')); const result = await input.call(profile, RESIDENT_SYSTEM_PROMPT, users[index].text, input.signal); raw = safeText(result.text); usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens }; inFlight = false; }
      try {
        const answers = validateAnswers(task, profile.id, raw); const coherence = checkCoherence(task, profile, answers, { recordExclusivePasses: true });
        const logic = logicRules.length ? checkQuestionnaireLogic(task, answers, logicRules) : undefined;
        const exclusiveIssue = coherence.issues.find(issue => issue.severity === 'error' && issue.ruleId.endsWith('-exclusive-options'));
        const logicConflict = logic?.status === 'conflict';
        const contradicted = coherence.status === 'contradiction' || logicConflict;
        responses.push({ residentId: profile.id, status: exposure === 'full' && contradicted ? 'invalid' : 'valid', structureValid: true, answers, coherence, ...(logic ? { logic } : {}), raw, ...(contradicted ? { error: coherence.status === 'contradiction' ? exclusiveIssue?.message ?? '违反已登记画像约束；保留原始答卷和诊断。' : logic?.issues[0]?.message ?? '回答违反显式登记的跨题条件；保留原文，不自动修正。' } : {}), durationMs: performance.now() - began, ...usage });
      } catch (error) { responses.push({ residentId: profile.id, status: 'invalid', structureValid: false, answers: [], raw, error: (error as Error).message, durationMs: performance.now() - began, ...usage }); }
    } catch (error) {
      inFlight = false;
      // Harness exposes only sanitized evidence; no credentials or provider objects.
      const evidence = (error as { evidence?: { text: string; inputTokens: number | null; outputTokens: number | null } }).evidence;
      if (evidence) { raw = safeText(evidence.text); usage = { inputTokens: evidence.inputTokens, outputTokens: evidence.outputTokens }; }
      const message = safeText((error as Error).message);
      stopped = input.signal.aborted ? '用户取消。' : `前序请求失败，停止后续调度：${message}`;
      responses.push({ residentId: profile.id, status: 'failed', answers: [], raw, error: message, durationMs: performance.now() - began, ...usage });
    }
    const recorded = responses[responses.length - 1];
    if (!stopped && input.stopAfterResponse && recorded) {
      const reason = input.stopAfterResponse(structuredClone(recorded), structuredClone(profile));
      if (reason) stopped = safeText(reason).slice(0, 2000);
    }
    await input.checkpoint?.(run('running'));
  }
  return run(input.signal.aborted ? 'cancelled' : stopped ? 'stopped' : 'completed');
}
