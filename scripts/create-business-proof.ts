import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../shared/evidence.js';
import { BUSINESS_DEMO_VERSION, BUSINESS_DEMO_NOTICE, BUSINESS_FIXTURE_POLICY_ID, createBusinessDemoRun, type BusinessDemoId } from '../shared/research-demo.js';
import { getPopulationPack, getPopulationModel } from '../server/population/service.js';
import { preflightResearchTask } from '../server/research/contract.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registeredFiles = ['data/research/business-child-questionnaire.json', 'data/research/business-pet-questionnaire.json', 'data/research/business-personas.json',
  'shared/research-demo.ts', 'shared/questionnaire-logic.ts', 'scripts/create-business-proof.ts'];

export async function createBusinessProof(input: { scenario?: BusinessDemoId | 'all'; seed?: number; id?: string } = {}) {
  if (Object.keys(input).some(key => !['scenario', 'seed', 'id'].includes(key))) throw new Error('业务自证拒绝模型调用、凭证、输出路径或未知参数。');
  const id = input.id ?? randomUUID(); const seed = input.seed ?? 20261007; const scenario = input.scenario ?? 'all';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('业务自证ID须为UUID，不能是路径。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('seed须是0–2147483647整数。');
  if (!['all', 'child-snacks', 'pet-snacks'].includes(scenario)) throw new Error('场景须为all、child-snacks或pet-snacks。');
  const pack = getPopulationPack(); const population = getPopulationModel();
  const ids: BusinessDemoId[] = scenario === 'all' ? ['child-snacks', 'pet-snacks'] : [scenario];
  const cases = await Promise.all(ids.map(async demoId => {
    const hex = fingerprint({ id, demoId });
    const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const execution = await createBusinessDemoRun({ demoId, population, pack, seed, id: runId });
    const { run, logicAudit } = execution;
    if (run.state !== 'completed' || run.metrics.valid !== 12 || logicAudit.passed !== 12 || run.metrics.modelCalls !== 0 || run.metrics.inputTokens !== 0 || run.metrics.outputTokens !== 0 || run.metrics.apiCostCny !== 0) throw new Error('工程自证断言失败；保留已有产物，不生成通过报告。');
    const promptLinks = run.profiles.map(profile => {
      const user = run.prompt.users.find(item => item.residentId === profile.id)!;
      return { residentId: profile.id, presetId: profile.presetId, personaHash: fingerprint(profile.persona), promptHash: user.hash,
        frozenPersonaMatches: fingerprint(JSON.parse(user.text).resident.persona) === fingerprint(profile.persona),
        rawHash: fingerprint(run.responses.find(response => response.residentId === profile.id)!.raw) };
    });
    if (promptLinks.some(link => !link.frozenPersonaMatches)) throw new Error('画像到Prompt的血缘断言失败。');
    return { ...execution, report: { schemaVersion: '1.0', demoId, proofVersion: BUSINESS_DEMO_VERSION, mode: 'fixture', policyId: BUSINESS_FIXTURE_POLICY_ID,
      notice: BUSINESS_DEMO_NOTICE, questions: run.task.questionnaire.questions.length, planned: 12, structurallyValid: run.metrics.structurallyValid, independentLogicPassed: logicAudit.passed,
      realModelQuality: 'not-tested', realResidentPreferenceValidated: false, personaBehaviorValidated: false, businessRecommendation: 'not-supported', targetPopulationDenominator: null,
      promptLinks, qualificationPreflight: preflightResearchTask(run.task, pack), metrics: run.metrics, sampling: run.sampling,
      hashes: { task: run.taskHash, population: run.populationHash, profiles: run.profileHash, rules: logicAudit.rulesHash, evidence: execution.evidenceHash },
      limitations: run.limitations, nextEvidence: execution.demo.nextEvidence } };
  }));
  const sourceFiles = await Promise.all(registeredFiles.map(async name => {
    const bytes = await readFile(path.join(PROJECT_ROOT, name));
    return { path: name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  const report = { schemaVersion: '1.0', proofVersion: BUSINESS_DEMO_VERSION, id, createdAt: new Date().toISOString(), mode: 'fixture', notice: BUSINESS_DEMO_NOTICE,
    seed, scenarios: ids, countPerScenario: 12, modelCalls: 0, apiCostCny: 0, sourceFiles,
    stableEvidenceHash: fingerprint(cases.map(value => ({ demoId: value.demo.id, evidenceHash: value.evidenceHash }))),
    realModelQuality: 'not-tested', personaBehaviorValidated: false, businessRecommendation: 'not-supported',
    qualificationAndBusinessData: 'needs-data', sourceVerification: 'registered-local-bytes-not-independent-truth-certification' };
  return { id, cases, report };
}

export type BusinessProof = Awaited<ReturnType<typeof createBusinessProof>>;

export function renderBusinessProofReport(proof: BusinessProof): string {
  const sections = proof.cases.map(({ run, report, logicAudit }) => {
    const rows = run.summaries.map(summary => {
      const choices = summary.choices?.map(choice => `${choice.label}=${choice.count}`).join('；');
      const detail = choices ?? (summary.mean !== undefined ? `均值=${summary.mean.toFixed(2)}；${summary.unit}` : '原文/null见raw-responses.json');
      return `| ${summary.questionId} | ${summary.type} | ${summary.denominator}/${run.profiles.length} | ${summary.missing} | ${detail.replaceAll('|', '／')} |`;
    });
    return `## ${run.task.title}

${report.questions}题 × 12合成画像；结构有效 ${run.metrics.structurallyValid}/12，独立跨题规则通过 ${logicAudit.passed}/12。模型调用0、Token0、API费用0；真实模型质量not-tested。具体耗时=${run.durationMs.toFixed(2)}毫秒（不含文件写入与渲染）。

任务指纹 ${run.taskHash}；画像指纹 ${run.profileHash}；规则指纹 ${logicAudit.rulesHash}；稳定证据指纹 ${report.hashes.evidence}。

| 题目 | 类型 | 非null应答分母/计划 | 缺失或null | synthetic工程数表（非市场结果） |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

注意：“不知道”选项计入非null分母，但仍在选项数表中单列；多选计数总和可超过分母。数值均值只用非null应答，不把未知填0。预算0表示明确不考虑购买；本轮不计算真实购买率或总体权重。

资格预检=${report.qualificationPreflight.status}；真实目标分母=null。缺口：${report.qualificationPreflight.missingEvidence.join('；')}。

待补证据：

${report.nextEvidence.map(item => `- ${item}`).join('\n')}

结论边界：

${report.limitations.map(item => `- ${item}`).join('\n')}
`;
  });
  return `# 两业务场景可复现工程自证

${BUSINESS_DEMO_NOTICE}

mode=fixture；policy=${BUSINESS_FIXTURE_POLICY_ID}；seed=${proof.report.seed}；每场景4个五层情景各3人。完整率由显式工程规则保证，不是真实LLM质量或人格贡献。旧persona-proof中的两个预算反例仍保留，本包不改旧实验/问卷/申报Tag。

生成时间=${proof.report.createdAt}；自证ID=${proof.id}。API费用0不含本机计算；不做现实经营建议。sourceFiles与manifest保存原文件SHA-256，哈希证明字节一致，不认证现实真实性。

${sections.join('\n')}

## 逐份追溯

各场景目录中的questionnaire.json是冻结完整问卷；presets.json保留无Key五层assumption；survey-run.json保存每个画像、Prompt和raw；prompts.txt便于阅读；raw-responses.json保留原始JSON和null；statistics.json保留逐题及街道/预设分组；logic-audit.json独立记录登记规则与每份检查。business-proof.json和manifest.json用于定位和复算，不把外部效度标成通过。

稳定证据指纹=${proof.report.stableEvidenceHash}，只含确定性任务/人口/画像/raw/规则与审计verifier版本，不含UUID、运行时间或耗时。manifest字节哈希覆盖实际完整产物，因此另一次运行文件字节可能不同。
`;
}

/** Dedicated output subtree, exclusive create; never overwrites historical evidence or accepts arbitrary paths. */
export async function writeBusinessProof(proof: BusinessProof): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proof.id)) throw new Error('业务自证目录只接受UUID。');
  const base = path.join(PROJECT_ROOT, 'output/business-proof');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = path.join(base, proof.id); await mkdir(directory, { mode: 0o700 });
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const files: { name: string; text: string }[] = [
    { name: 'business-proof.json', text: json({ ...proof.report, cases: proof.cases.map(value => value.report) }) },
    { name: 'proof-report.md', text: renderBusinessProofReport(proof) },
  ];
  for (const value of proof.cases) {
    const { run, logicAudit } = value; const prefix = value.demo.id;
    await mkdir(path.join(directory, prefix), { mode: 0o700 });
    files.push({ name: `${prefix}/questionnaire.json`, text: json(run.task) },
      { name: `${prefix}/presets.json`, text: json(run.presetSnapshots) },
      { name: `${prefix}/survey-run.json`, text: json(run) },
      { name: `${prefix}/logic-audit.json`, text: json(logicAudit) },
      { name: `${prefix}/raw-responses.json`, text: json(run.responses) },
      { name: `${prefix}/statistics.json`, text: json({ summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }) },
      { name: `${prefix}/prompts.txt`, text: `SYSTEM\n${run.prompt.system}\n\n${run.prompt.users.map(user => `RESIDENT ${user.residentId} SHA256 ${user.hash}\n${user.text}`).join('\n\n')}` });
  }
  for (const file of files) await writeFile(path.join(directory, file.name), file.text, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), json({ schemaVersion: '1.0', proofVersion: BUSINESS_DEMO_VERSION, id: proof.id, mode: 'fixture', policyId: BUSINESS_FIXTURE_POLICY_ID,
    modelCalls: 0, notice: BUSINESS_DEMO_NOTICE, files: files.map(file => ({ name: file.name, bytes: Buffer.byteLength(file.text), sha256: createHash('sha256').update(file.text).digest('hex') })) }), { flag: 'wx', mode: 0o600 });
  return directory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^--seed=\d+$/.test(arg) && !/^--scenario=(?:all|child-snacks|pet-snacks)$/.test(arg))) throw new Error('仅支持--seed=整数和--scenario=all|child-snacks|pet-snacks；禁止live、Key、count和自定义输出路径。');
  if (new Set(args.map(arg => arg.split('=')[0])).size !== args.length) throw new Error('参数不能重复。');
  const seed = Number(args.find(arg => arg.startsWith('--seed='))?.split('=')[1] ?? 20261007);
  const scenario = (args.find(arg => arg.startsWith('--scenario='))?.split('=')[1] ?? 'all') as BusinessDemoId | 'all';
  const proof = await createBusinessProof({ seed, scenario }); const directory = await writeBusinessProof(proof);
  console.log(JSON.stringify({ directory, mode: 'fixture', modelCalls: 0, apiCostCny: 0, stableEvidenceHash: proof.report.stableEvidenceHash,
    cases: proof.cases.map(value => ({ id: value.demo.id, questions: value.report.questions, planned: 12, valid: value.run.metrics.valid, logicPassed: value.logicAudit.passed, durationMs: value.run.durationMs })), notice: BUSINESS_DEMO_NOTICE }, null, 2));
}
