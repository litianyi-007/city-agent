import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { researchTaskSchema } from '../shared/research-schema.js';
import { residentPersonaSchema } from '../shared/resident-persona.js';
import { executeSurvey } from '../shared/survey-runner.js';
import { fingerprint } from '../shared/evidence.js';
import { getPopulationPack, getPopulationModel } from '../server/population/service.js';
import { preflightResearchTask } from '../server/research/contract.js';
import { residentCreateSchema, residentPublic } from '../server/research/residents.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PERSONA_PROOF_VERSION = 'five-layer-fixture-proof-1.0';
const NOTICE = '工程规则夹具；没有LLM调用，不是真实居民偏好、人格效度或经营建议。';
const layerQuestions = {
  personality: 'personality-context', upbringing: 'upbringing-context', education: 'education-context',
  household: 'household-context', work: 'occupation-context',
} as const;

export async function createPersonaProof({ count = 12, seed = 20261007, id = randomUUID() }: { count?: number; seed?: number; id?: string } = {}) {
  if (!Number.isInteger(count) || count < 4 || count > 30) throw new Error('工程自证样本数须为4–30；默认12，不升级真实30人验收。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('seed须为0–2147483647整数。');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('自证ID须为UUID。');
  const taskBytes = await readFile(path.join(PROJECT_ROOT, 'data/research/persona-proof-questionnaire.json'));
  const presetBytes = await readFile(path.join(PROJECT_ROOT, 'data/research/persona-proof-presets.json'));
  const task = researchTaskSchema.parse(JSON.parse(taskBytes.toString('utf8')));
  const inputs: unknown = JSON.parse(presetBytes.toString('utf8'));
  if (!Array.isArray(inputs) || inputs.length !== 4) throw new Error('自证预设须为已登记的4份情景。');
  const createdAt = new Date().toISOString();
  const presets = inputs.map((raw, index) => {
    const input = residentCreateSchema.parse(raw);
    if (input.apiKey !== undefined && input.apiKey !== null) throw new Error('工程自证拒绝包含API Key的预设文件。');
    if (input.modelId !== 'fixture-no-model') throw new Error('工程自证仅接受fixture-no-model标识，避免冒充模型实测。');
    if (!input.persona) throw new Error('工程自证须明确包含五层画像，包括未知层。');
    residentPersonaSchema.parse(input.persona);
    return residentPublic(input, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, createdAt, false);
  });
  const pack = getPopulationPack(); const population = getPopulationModel();
  const run = await executeSurvey({
    id, mode: 'fixture', task, presets, pack, population, count, seed,
    pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: createdAt, source: '没有供应商请求；API费用为0，不含本机计算成本。' },
    signal: new AbortController().signal, experiment: { id, arm: 'five-layer-fixture-no-llm' },
    call: async () => { throw new Error('安全停止：工程自证不允许任何模型调用。'); },
  });
  const promptLinks = run.profiles.map(profile => {
    const prompt = run.prompt.users.find(user => user.residentId === profile.id);
    const decoded = prompt ? JSON.parse(prompt.text) : null;
    return { residentId: profile.id, presetId: profile.presetId, personaHash: fingerprint(profile.persona), promptHash: prompt?.hash ?? null,
      matchesFrozenPersona: Boolean(decoded?.resident?.persona) && fingerprint(decoded.resident.persona) === fingerprint(profile.persona) };
  });
  if (run.metrics.modelCalls !== 0 || promptLinks.some(link => !link.matchesFrozenPersona)) throw new Error('自证失败：调用数或画像→Prompt血缘不符。');
  const report = {
    schemaVersion: '1.0', proofVersion: PERSONA_PROOF_VERSION, id, createdAt, mode: 'fixture', notice: NOTICE,
    modelCalls: 0, realResidentPreferenceValidated: false, personaBehaviorValidated: false, marketResearchValidated: false,
    sourceFiles: [
      { path: 'data/research/persona-proof-questionnaire.json', sha256: createHash('sha256').update(taskBytes).digest('hex') },
      { path: 'data/research/persona-proof-presets.json', sha256: createHash('sha256').update(presetBytes).digest('hex') },
    ],
    taskHash: run.taskHash, populationHash: run.populationHash, profilesHash: run.profileHash,
    surveyVersion: run.version, personaSchemaVersion: '1.0', personaProvenance: 'assumption',
    questions: { total: task.questionnaire.questions.length, required: task.questionnaire.questions.filter(question => question.required).length,
      types: [...new Set(task.questionnaire.questions.map(question => question.type))], layerQuestions },
    promptLinks, metrics: run.metrics, sampling: run.sampling,
    qualificationPreflight: preflightResearchTask(task, pack),
    capabilityChecks: { fiveLayersInFrozenProfilesAndPrompts: true, questionnaireParsed: true, individualResponsesRetained: run.responses.length === count,
      deterministicStatisticsAvailable: true, unknownLayersRetained: run.profiles.some(profile => profile.persona?.work.employment === 'unknown'),
      realModelQuality: 'not-tested', externalValidity: 'not-validated' },
    limitations: [NOTICE, 'fixtureAnswers根据seed生成合法答卷，不根据五层画像推导消费偏好；完整率由工程规则保证。',
      '猫狗人数来自预设轮转，不是滨江养宠比例；人口历史框不提供目标购买者分母。',
      '价格和品类选项分布只验证数表与追溯能力，不支持选址、主营、定价、主粮或利润结论。',
      '五层画像均为情景假设，不是DNA、测量人格或真实成长/家庭/教育/工作记录。',
      '没有声明式职业/家庭/跨题规则，不把JSON通过当语义自洽盲评通过。',
      '此自证不升级S03的真实10→30人完整率，也不升级S04或S13。'],
  };
  return { run, report };
}

export function renderPersonaProofReport(proof: Awaited<ReturnType<typeof createPersonaProof>>): string {
  const { run, report } = proof;
  const lines = run.summaries.map(summary => {
    const question = run.task.questionnaire.questions.find(item => item.id === summary.questionId)!;
    const choices = summary.choices?.map(choice => `${choice.label}=${choice.count}`).join('；');
    const detail = choices ?? (summary.mean !== undefined ? `均值=${summary.mean.toFixed(2)}；单位=${summary.unit ?? '量表分'}` : '逐份开放原文见survey-run.json');
    return `| ${question.id} | ${question.type} | ${summary.denominator} | ${detail.replaceAll('|', '／')} |`;
  });
  return `# 五层画像与问卷工程自证结果

${NOTICE}

运行ID：${run.id}。mode=fixture；模型调用=0；API费用=0（不含本机计算）。人格行为效度、真实偏好和市场校准均未验证。

本次${run.profiles.length}个合成画像回答${report.questions.total}题，${run.metrics.valid}/${run.metrics.planned}份工程答卷有效。五层设定原样进入各自冻结Prompt；画像、原文、统计、来源和哈希可回查。所有价格/品类/网点分布来自seeded规则，不是调研发现。

## 逐题工程统计

| 题目 | 题型 | 有效应答分母 | 夹具结果 |
| --- | --- | --- | --- |
${lines.join('\n')}

## 如何复核

questionnaire.json给出完整问卷；presets.json包含4份无Key的五层假设；survey-run.json保存每画像、Prompt、答卷、失败分母与分析；persona-proof.json逐画像对照personaHash与promptHash；manifest.json登记附件字节SHA-256。

## 结论边界

${report.limitations.map(item => `- ${item}`).join('\n')}

下一步真实调用需重新填Key、确认预算并冻结配置。未知usage/成本保持unknown；另存新实验，不覆盖这个夹具或旧申报证据。
`;
}

export async function writePersonaProof(proof: Awaited<ReturnType<typeof createPersonaProof>>) {
  const base = path.join(PROJECT_ROOT, 'output/persona-proof');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = path.join(base, proof.run.id);
  await mkdir(directory, { mode: 0o700 });
  const files = [
    { name: 'questionnaire.json', text: JSON.stringify(proof.run.task, null, 2) },
    { name: 'presets.json', text: JSON.stringify(proof.run.presetSnapshots, null, 2) },
    { name: 'survey-run.json', text: JSON.stringify(proof.run, null, 2) },
    { name: 'persona-proof.json', text: JSON.stringify(proof.report, null, 2) },
    { name: 'proof-report.md', text: renderPersonaProofReport(proof) },
  ];
  for (const file of files) await writeFile(path.join(directory, file.name), file.text, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    schemaVersion: '1.0', proofVersion: PERSONA_PROOF_VERSION, id: proof.run.id, mode: 'fixture', modelCalls: 0,
    notice: NOTICE, files: files.map(file => ({ name: file.name, bytes: Buffer.byteLength(file.text), sha256: createHash('sha256').update(file.text).digest('hex') })),
  }, null, 2), { flag: 'wx', mode: 0o600 });
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^--(?:count|seed)=\d+$/.test(arg))) throw new Error('只支持 --count=4..30 和 --seed=整数；本脚本拒绝live模式或凭证。');
  if (new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('参数不能重复。');
  const value = (name: string, fallback: number) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  const proof = await createPersonaProof({ count: value('count', 12), seed: value('seed', 20261007) });
  const directory = await writePersonaProof(proof);
  console.log(JSON.stringify({ directory, mode: 'fixture', modelCalls: 0, planned: proof.run.metrics.planned, valid: proof.run.metrics.valid, notice: NOTICE }, null, 2));
}
