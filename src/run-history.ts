import { fingerprint, residentPrompt, validateAnswers, checkCoherence, summarize, type SurveyRun } from '../shared/survey-engine';
import { buildAnalysis } from '../shared/survey-analysis';
import { researchTaskSchema } from '../shared/research-schema';
import { hashPopulationPack, regionPackSchema } from '../server/population/model';

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
  if (run.version !== 'coverage-survey-2.0' || run.hashAlgorithm !== 'sha256-canonical-json-v1') throw new Error('仅导入v2证据；旧版样例保留为原始附件，不自动升级实验结论。');
  if (fingerprint(run.task) !== run.taskHash || fingerprint(run.profiles) !== run.profileHash || !run.populationSnapshot || hashPopulationPack(regionPackSchema.parse(run.populationSnapshot)) !== run.populationHash) throw new Error('证据指纹不一致，拒绝导入。');
  if (!run.prompt || fingerprint(run.prompt.system) !== run.prompt.systemHash || run.prompt.users.some(user => fingerprint(user.text) !== user.hash)) throw new Error('Prompt指纹不一致，拒绝导入。');
  if (!Array.isArray(run.prompt.users) || run.prompt.users.length !== run.profiles.length || new Set(run.profiles.map(profile => profile.id)).size !== run.profiles.length || new Set(run.responses.map(response => response.residentId)).size !== run.responses.length) throw new Error('画像/答卷映射重复或缺失。');
  for (const profile of run.profiles) {
    if (run.prompt.users.find(user => user.residentId === profile.id)?.text !== residentPrompt(run.task, profile, run.exposure ?? 'full')) throw new Error('Prompt与冻结画像/问卷不一致。');
  }
  for (const response of run.responses) {
    const profile = run.profiles.find(profile => profile.id === response.residentId);
    if (!profile || !['valid', 'invalid', 'failed', 'not-started'].includes(response.status)) throw new Error('答卷归属或状态不合法。');
    if (response.structureValid || response.status === 'valid') {
      const parsed = validateAnswers(run.task, response.residentId, response.raw);
      const coherence = checkCoherence(run.task, profile, parsed);
      if (fingerprint(parsed) !== fingerprint(response.answers) || fingerprint(coherence) !== fingerprint(response.coherence) || response.status === 'valid' && (run.exposure ?? 'full') === 'full' && coherence.status === 'contradiction') throw new Error('答卷、状态或硬约束诊断不一致。');
    }
  }
  if (run.metrics.planned !== run.profiles.length || run.metrics.valid !== run.responses.filter(response => response.status === 'valid').length || fingerprint(run.summaries) !== fingerprint(summarize(run.task, run.responses)) || fingerprint(run.analysis) !== fingerprint(buildAnalysis(run.task, run.profiles, run.responses))) throw new Error('汇总不一致；导入不会信任未经复算的统计。');
  const forbidden = (value: unknown): boolean => !!value && typeof value === 'object' && Object.entries(value).some(([key, child]) => /^(apiKey|authorization|secret|secrets)$/i.test(key) || forbidden(child));
  if (forbidden(run)) throw new Error('证据包含密钥字段，拒绝保存。');
  return run;
}
