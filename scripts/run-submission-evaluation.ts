import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fingerprint, type SurveyRun } from '../shared/survey-engine';
import { researchTaskSchema, type ResearchTask } from '../shared/research-schema';

// Explicit, bounded real experiment. Credentials stay in the local service.
const base = 'http://127.0.0.1:4310'; const directory = 'output/real-evaluation'; mkdirSync(directory, { recursive: true });
const priorAttempts = existsSync(`${directory}/attempts`) ? readdirSync(`${directory}/attempts`).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(`${directory}/attempts/${name}`, 'utf8')) as SurveyRun) : [];
const api = async <T>(path: string, body?: unknown): Promise<T> => { const response = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined); const value = await response.json(); if (!response.ok) throw new Error(`本机接口${response.status}: ${value.error}`); return value as T; };
const catalog = await api<{ templates: ResearchTask[] }>('/api/research/templates');
const agents = await api<{ id: string; templateId: string; hasApiKey: boolean; modelId: string }[]>('/api/research/resident-agents');
const general = agents.find(agent => agent.templateId === 'general' && agent.hasApiKey)!;
if (!general) throw new Error('请在本机页面配置成年居民Key。');
const runs: { arm: string; run: SurveyRun }[] = []; const experimentId = randomUUID(); let reserved = 0;
const pricing = { currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, suppliedAt: new Date().toISOString(), source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/；Flash高峰与全输入缓存未命中的保守估算，不是账单；无法分离缓存时不宣称精确费用。' };
async function run(arm: string, task: ResearchTask, ids: string[], count: number, frozenFromRunId?: string, exposure: 'full' | 'no-persona' | 'demographics-only' = 'full') {
  // Bound even a full 65536-token input plus the 3000-token output per request.
  reserved += count * (65536 * 2 + 3000 * 8) / 1e6;
  if (reserved > 15) throw new Error('保守调用预留超过15元，停止新增实验。');
  const { id } = await api<{ id: string }>('/api/research/surveys', { task: researchTaskSchema.parse(task), residentAgentIds: ids, mode: 'live', count, seed: 42, assumptionsAccepted: true, pricing, frozenFromRunId, exposure, experiment: { id: experimentId, arm } });
  console.log(`START ${arm}: ${count}画像 ${id}`);
  let value: SurveyRun;
  do { await new Promise(resolve => setTimeout(resolve, 1000)); value = await api<SurveyRun>(`/api/research/surveys/${id}`); } while (value.state === 'running');
  runs.push({ arm, run: value });
  mkdirSync(`${directory}/attempts`, { recursive: true });
  writeFileSync(`${directory}/attempts/${value.id}.json`, JSON.stringify(value, null, 2));
  writeFileSync(`${directory}/${arm}.json`, JSON.stringify(value, null, 2));
  console.log(JSON.stringify({ arm, state: value.state, durationMs: value.durationMs, ...value.metrics }));
  if (value.state !== 'completed') throw new Error(`${arm}停止：${value.responses.find(response => response.status === 'failed')?.error}`);
  return value;
}
const task = catalog.templates[2];
const baseline = await run('baseline-12', task, [general.id], 12);
for (let repeat = 1; repeat <= 5; repeat++) await run(`repeat-${repeat}`, task, [general.id], 3, baseline.id);
const changed = structuredClone(task);
changed.decisionContext.offering = changed.decisionContext.offering.replace('标准版19元/月', '标准版29元/月');
const choice = changed.questionnaire.questions.find(question => question.id === 'version-choice')!;
if (choice.type !== 'single') throw new Error('price plan requires single choice');
choice.options[1].label = choice.options[1].label.replace('19元/月', '29元/月');
// Remove within-answer followups from BOTH arms so the isolated experiment cannot mix two price setups.
const pairedIds = new Set((task.comparisons ?? []).map(comparison => comparison.changedQuestionId));
const controlled = (input: ResearchTask) => ({ ...input, comparisons: [], requestedOutputs: input.requestedOutputs.filter(output => output !== 'price-comparison'), questionnaire: { ...input.questionnaire, questions: input.questionnaire.questions.filter(question => !pairedIds.has(question.id)) } });
await run('controlled-price-19', controlled(task), [general.id], 3, baseline.id);
await run('controlled-price-29', controlled(changed), [general.id], 3, baseline.id);
await run('no-persona', task, [general.id], 3, baseline.id, 'no-persona');
await run('demographics-only', task, [general.id], 3, baseline.id, 'demographics-only');
const caregiver = agents.find(agent => agent.templateId === 'caregiver' && agent.hasApiKey)!;
const cats = agents.find(agent => agent.templateId === 'cat-buyer' && agent.hasApiKey)!;
const dogs = agents.find(agent => agent.templateId === 'dog-buyer' && agent.hasApiKey)!;
if (caregiver) await run('caregiver-snacks', catalog.templates[0], [caregiver.id], 3);
if (cats && dogs) await run('pet-snacks', catalog.templates[1], [cats.id, dogs.id], 4);
const unseen: ResearchTask = { ...task, id: 'unseen-tool-rental', title: '未见配置：社区工具租借', objective: 'demand-validation', validationRules: [], comparisons: [], requestedOutputs: ['synthetic-analysis', 'group-comparison', 'hypothesis-report'], declarations: [],
  decisionContext: { offering: '社区工具租借，电钻10元/天，押金100元；这是待测概念。', buyer: '假设成年潜在租借者', endUser: '与购买者相同，未验证', channel: '社区自提，位置尚未核验' }, questionnaire: { id: 'unseen-tool-v1', version: '1', questions: [ { id: 'need', type: 'single', prompt: '在此假设设定下，你会考虑租用吗？', required: true, options: [{ id: 'yes', label: '会' }, { id: 'no', label: '不会' }, { id: 'unknown', label: '不确定' }] }, { id: 'reason', type: 'text', prompt: '说明你的考虑或还需要的信息。', required: true, maxLength: 1000 } ] } };
await run('unseen-tool', unseen, [general.id], 3);
const repetitions = runs.filter(item => item.arm.startsWith('repeat-'));
const stability = baseline.profiles.slice(0, 3).map(profile => {
  const values = repetitions.map(item => item.run.responses.find(response => response.residentId === profile.id)?.answers.find(answer => answer.questionId === 'version-choice')?.value ?? null);
  return { residentId: profile.id, values, largestAgreement: Math.max(...[...new Set(values)].filter(value => value !== null).map(value => values.filter(other => other === value).length), 0), diagnosticTarget: '五次新会话中至少4次同核心选项仅为诊断目标，不代表真实有效' };
});
const summary = { experimentId, preparedAt: new Date().toISOString(), realModelRequests: runs.reduce((sum, item) => sum + item.run.metrics.modelCalls, 0), inputTokens: runs.reduce((sum, item) => sum + (item.run.metrics.inputTokens ?? 0), 0), outputTokens: runs.reduce((sum, item) => sum + (item.run.metrics.outputTokens ?? 0), 0), usageComplete: runs.every(item => item.run.metrics.inputTokens !== null && item.run.metrics.outputTokens !== null), conservativeApiCostCny: runs.every(item => item.run.metrics.apiCostCny !== null) ? runs.reduce((sum, item) => sum + item.run.metrics.apiCostCny!, 0) : null, reservedUpperBoundCny: reserved,
  baseline: { id: baseline.id, taskHash: baseline.taskHash, populationHash: baseline.populationHash, valid: baseline.metrics.valid, planned: baseline.metrics.planned, sampling: baseline.sampling, audit: baseline.populationAudit }, stability,
  priceExperiment: { arms: ['controlled-price-19', 'controlled-price-29'], frozenProfileHash: fingerprint(baseline.profiles.slice(0, 3)), manipulation: '仅修改标准版月价的商品描述与同一选择题选项，双方删除问卷内价格/权益追问；其他题、模型、画像和参数相同。', inferentialLimit: '3画像配对探索；不做总体显著性或真实市场因果声明' },
  priorAttempts: { count: priorAttempts.length, modelCalls: priorAttempts.reduce((sum, run) => sum + run.metrics.modelCalls, 0), artifact: 'prior-attempts.json', errata: '首轮SDK inputTokens未含cacheReadTokens/cacheWriteTokens，是未缓存输入量，不是总输入；其总Token和全量费用未知。保留原始记录，当前批次已修正缓存输入计数；重跑是记账修正后的新实验，不挑选成功结果。截断调用最初丢失usage亦保留为未知。' },
  runs: runs.map(item => ({ arm: item.arm, id: item.run.id, taskHash: item.run.taskHash, profileHash: item.run.profileHash, metrics: item.run.metrics, summaries: item.run.summaries, exposure: item.run.exposure })), limitations: ['没有真人基线；仅证明本次合成问卷与诊断实际运行。', '职业、家庭、开放题语义尚未全面盲评。', '无画像/人口画像的差异不证明哪一组更真实。', '养宠、照护情景没有总体分母；学校问卷不代替儿童口味，也不提供真实店址。', '所有供应商身份为配置selector，未独立认证底层权重。'] };
writeFileSync(`${directory}/evaluation-summary.json`, JSON.stringify(summary, null, 2));
mkdirSync('public/submission', { recursive: true });
writeFileSync('public/submission/live-run.json', JSON.stringify(baseline, null, 2));
writeFileSync('public/submission/evaluation-summary.json', JSON.stringify(summary, null, 2));
writeFileSync('public/submission/experiment-runs.json', JSON.stringify(runs, null, 2));
writeFileSync('public/submission/prior-attempts.json', JSON.stringify({ errata: summary.priorAttempts.errata, runs: priorAttempts }, null, 2));
console.log('COMPLETE', JSON.stringify({ requests: summary.realModelRequests, conservativeApiCostCny: summary.conservativeApiCostCny, output: directory }));
