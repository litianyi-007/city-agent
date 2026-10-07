import { fingerprint, residentPrompt, RESIDENT_PROMPT_VERSION, RESIDENT_SYSTEM_PROMPT, validateAnswers, validateProfileEligibility, checkCoherence, summarize, type SurveyRun } from '../shared/survey-engine';
import { buildAnalysis, samplingReport } from '../shared/survey-analysis';
import { researchTaskSchema } from '../shared/research-schema';
import { auditPack, compilePopulation, hashPopulationPack, regionPackSchema } from '../server/population/model';
import { residentPersonaSchema } from '../shared/resident-persona';

/** Verifier version is independent of the frozen evidence's original execution version. */
export const EVIDENCE_VERIFIER_VERSION = 'survey-evidence-verifier-1.1';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('city-agent-evidence-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器证据库不可用；请立即导出运行，不要离开页面。'));
  });
}
export async function saveSurveyRun(run: SurveyRun): Promise<void> {
  const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('runs', 'readwrite'); tx.objectStore('runs').put(run);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('运行自动保存失败（可能空间不足）；已停止后续调用，请立即导出。'));
  }); } finally { db.close(); }
}
export async function listSurveyRuns(): Promise<SurveyRun[]> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('runs').objectStore('runs').getAll();
    request.onsuccess = () => resolve((request.result as SurveyRun[]).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    request.onerror = () => reject(new Error('无法读取历史运行；现有数据不会自动清除。'));
  }); } finally { db.close(); }
}
export function parseSurveyEvidence(input: unknown): SurveyRun {
  if (!input || typeof input !== 'object') throw new Error('证据包不是对象。');
  const run = input as SurveyRun;
  if (typeof run.id !== 'string' || typeof run.startedAt !== 'string' || !['fixture', 'live'].includes(run.mode) || !Array.isArray(run.profiles) || run.profiles.length < 1 || run.profiles.length > 30 || !Array.isArray(run.responses) || !Array.isArray(run.summaries) || !run.metrics || !Array.isArray(run.limitations)) throw new Error('证据包结构无效。');
  researchTaskSchema.parse(run.task);
  if (!['coverage-survey-2.0', 'coverage-survey-2.1-persona-layers', 'coverage-survey-2.2-json-contract'].includes(run.version) || run.hashAlgorithm !== 'sha256-canonical-json-v1') throw new Error('仅导入已登记v2证据；旧版样例保留为原始附件，不自动升级实验结论。');
  if (fingerprint(run.task) !== run.taskHash || fingerprint(run.profiles) !== run.profileHash || !run.populationSnapshot || hashPopulationPack(regionPackSchema.parse(run.populationSnapshot)) !== run.populationHash) throw new Error('证据指纹不一致，拒绝导入。');
  const population = compilePopulation(run.populationSnapshot);
  if (!run.prompt || fingerprint(run.prompt.system) !== run.prompt.systemHash || run.prompt.users.some(user => fingerprint(user.text) !== user.hash)) throw new Error('Prompt指纹不一致，拒绝导入。');
  if (run.version === 'coverage-survey-2.2-json-contract' && (run.parameters?.residentPromptVersion !== RESIDENT_PROMPT_VERSION || run.prompt.system !== RESIDENT_SYSTEM_PROMPT)) throw new Error('2.2答卷须保留登记的居民Prompt版本与完整system契约；不自动升级旧Prompt。');
  if (!Array.isArray(run.prompt.users) || run.prompt.users.length !== run.profiles.length || new Set(run.profiles.map(profile => profile.id)).size !== run.profiles.length || new Set(run.responses.map(response => response.residentId)).size !== run.responses.length) throw new Error('画像/答卷映射重复或缺失。');
  if (run.presetSnapshots !== undefined && (!Array.isArray(run.presetSnapshots) || new Set(run.presetSnapshots.map(preset => preset.id)).size !== run.presetSnapshots.length)) throw new Error('冻结人群预设重复或格式无效。');
  for (const profile of run.profiles) {
    const preset = run.presetSnapshots?.find(item => item.id === profile.presetId);
    if (run.presetSnapshots !== undefined && !preset) throw new Error('画像缺少对应的冻结人群预设。');
    validateProfileEligibility(run.task, profile, population, preset);
    if (profile.persona !== undefined) residentPersonaSchema.parse(profile.persona);
    if (['coverage-survey-2.1-persona-layers', 'coverage-survey-2.2-json-contract'].includes(run.version)) {
      if (!preset || fingerprint(profile.persona ?? null) !== fingerprint(preset.persona ?? null)) throw new Error('五层画像与冻结预设快照不一致，拒绝导入。');
    }
    if (run.prompt.users.find(user => user.residentId === profile.id)?.text !== residentPrompt(run.task, profile, run.exposure ?? 'full')) throw new Error('Prompt与冻结画像/问卷不一致。');
  }
  let structurallyValid = 0; let contradictions = 0;
  for (const preset of run.presetSnapshots ?? []) if (preset.persona !== undefined) residentPersonaSchema.parse(preset.persona);
  for (const response of run.responses) {
    const profile = run.profiles.find(profile => profile.id === response.residentId);
    if (!profile || !['valid', 'invalid', 'failed', 'not-started'].includes(response.status)) throw new Error('答卷归属或状态不合法。');
    if (response.structureValid !== undefined && typeof response.structureValid !== 'boolean') throw new Error('结构诊断标记必须为布尔值。');
    if (['failed', 'not-started'].includes(response.status) && (response.structureValid === true || response.coherence !== undefined)) throw new Error('失败或未启动答卷不能声明已完成的结构或硬约束诊断。');
    if (response.status === 'valid' || response.status === 'invalid') {
      let parsed: ReturnType<typeof validateAnswers> | undefined;
      try { parsed = validateAnswers(run.task, response.residentId, response.raw); } catch { /* Retain an invalid raw response without normalizing or rewriting it. */ }
      if (response.structureValid !== undefined && response.structureValid !== Boolean(parsed) || response.status === 'valid' && !parsed) throw new Error('答卷结构诊断与原文不一致。');
      if (!parsed) continue;
      structurallyValid++;
      const coherence = checkCoherence(run.task, profile, parsed);
      if (coherence.status === 'contradiction') contradictions++;
      if (fingerprint(parsed) !== fingerprint(response.answers) || fingerprint(coherence) !== fingerprint(response.coherence) || response.status === 'valid' && (run.exposure ?? 'full') === 'full' && coherence.status === 'contradiction') throw new Error('答卷、状态或硬约束诊断不一致。');
    }
  }
  if (run.metrics.planned !== run.profiles.length || run.metrics.valid !== run.responses.filter(response => response.status === 'valid').length || fingerprint(run.summaries) !== fingerprint(summarize(run.task, run.responses)) || fingerprint(run.analysis) !== fingerprint(buildAnalysis(run.task, run.profiles, run.responses))) throw new Error('汇总不一致；导入不会信任未经复算的统计。');
  if (run.sampling !== undefined && fingerprint(run.sampling) !== fingerprint(samplingReport(run.profiles))
    || run.metrics.structurallyValid !== undefined && run.metrics.structurallyValid !== structurallyValid
    || run.metrics.contradictions !== undefined && run.metrics.contradictions !== contradictions
    || run.populationAudit !== undefined && fingerprint(run.populationAudit) !== fingerprint(auditPack(run.populationSnapshot))) throw new Error('覆盖、结构有效、矛盾或人口审计统计不一致；已有派生指标必须复算，旧版缺失字段不自动补写。');
  const nonnegativeInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const usageValue = (value: unknown) => value === null || nonnegativeInteger(value);
  const durationValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if ((run.state === undefined ? run.version !== 'coverage-survey-2.0' : !['running', 'completed', 'cancelled', 'stopped'].includes(run.state)) || !Number.isFinite(Date.parse(run.startedAt)) || !durationValue(run.durationMs)
    || run.responses.some(response => !durationValue(response.durationMs))) throw new Error('运行状态、时间或耗时账本不合法。');
  if (!nonnegativeInteger(run.metrics.modelCalls) || !usageValue(run.metrics.inputTokens) || !usageValue(run.metrics.outputTokens)
    || !(run.metrics.apiCostCny === null || typeof run.metrics.apiCostCny === 'number' && Number.isFinite(run.metrics.apiCostCny) && run.metrics.apiCostCny >= 0)
    || run.responses.some(response => !usageValue(response.inputTokens) || !usageValue(response.outputTokens))) throw new Error('调用/Token/费用账本必须为非负有限整数或明确未知；费用为非负有限数或null。');
  const started = run.responses.filter(response => response.status !== 'not-started').length;
  const inFlight = run.mode === 'live' && run.state === 'running' && run.metrics.modelCalls === started + 1;
  if (run.mode === 'fixture' ? run.metrics.modelCalls !== 0 : run.metrics.modelCalls !== started && !inFlight) throw new Error('模型调用数与逐画像请求账本不一致。');
  for (const field of ['inputTokens', 'outputTokens'] as const) {
    const total = inFlight || run.responses.some(response => response[field] === null) ? null : run.responses.reduce((sum, response) => sum + response[field]!, 0);
    if (total !== run.metrics[field] || run.mode === 'fixture' && total !== 0 || run.responses.some(response => response.status === 'not-started' && response[field] !== 0)) throw new Error('Token汇总与逐画像已知/未知账本不一致；未启动请求不得计费，未知不填零。');
  }
  if (run.metrics.failed !== run.responses.filter(response => ['failed', 'invalid'].includes(response.status)).length || run.metrics.notStarted !== run.profiles.length - started) throw new Error('失败/未启动分母账本不一致。');
  const oneModel = new Set(run.models.map(model => `${model.provider}:${model.modelId}:${model.baseUrl}`)).size === 1;
  const price = run.pricing;
  if (price && (price.currency !== 'CNY' || typeof price.suppliedAt !== 'string' || typeof price.source !== 'string'
    || [price.inputPerMillion, price.outputPerMillion].some(value => value !== null && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)))) throw new Error('计价必须明确为CNY，包含来源/提供时点，单价为非负有限或明确未知。');
  const cost = run.mode === 'fixture' ? 0 : oneModel && run.metrics.inputTokens !== null && run.metrics.outputTokens !== null && price?.inputPerMillion !== null && price?.inputPerMillion !== undefined && price.outputPerMillion !== null
    ? (run.metrics.inputTokens * price.inputPerMillion + run.metrics.outputTokens * price.outputPerMillion) / 1e6 : null;
  if (cost === null ? run.metrics.apiCostCny !== null : run.metrics.apiCostCny === null || Math.abs(run.metrics.apiCostCny - cost) > 1e-9) throw new Error('费用账本与usage/单价/模型范围不一致；未知费用不得填零。');
  const forbidden = (value: unknown): boolean => !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => /^(apiKey|authorization|secret|secrets)$/i.test(key) || forbidden(child));
  if (forbidden(run)) throw new Error('证据包含密钥字段，拒绝保存。');
  return run;
}

/** The wrapper describes the current check, never mutates or upgrades frozen raw evidence. */
export function parseSurveyEvidenceWithVerification(input: unknown) {
  const run = parseSurveyEvidence(input);
  return { run, verification: {
    verifierVersion: EVIDENCE_VERIFIER_VERSION, originalSurveyVersion: run.version,
    populationAndTaskScope: 'internally-checked',
    frozenPresetScope: run.presetSnapshots ? 'internally-checked' : 'not-available-legacy',
    derivedStatistics: 'recomputed-present-fields', rawResponsesModified: false,
    sourceAndExecutionAuthenticity: 'not-independently-attested',
    limitations: run.presetSnapshots ? [] : ['旧2.0缺冻结预设快照；可只读复核人口/task，不能声称已核验预设资格或升级完整率资格门限。'],
  } };
}
