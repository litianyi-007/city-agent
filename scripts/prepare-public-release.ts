import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertPublicText, PUBLIC_REVIEW_FILES, PUBLIC_LIVE_PROOF_FILES, PUBLISHED_DEMO_URL, verifyPublicSubmission } from '../shared/publishing-contract';
import { parseSurveyEvidence } from '../src/run-history';
import { auditBusinessDemoRun } from '../shared/research-demo';
import { checkLiveQualification } from '../shared/live-business-protocol';
import { fingerprint } from '../shared/evidence';
import type { ExperimentBudgetLedger } from '../server/research/experiment-budget';

// Public projection only. No Key/store access, model calls, Git writes or publication.
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
if (args.length !== 2 || args.some(arg => !new RegExp(`^--(?:id=${uuid}|live=output/live-proof/${uuid})$`).test(arg))) throw new Error('仅接受--id=新UUID和--live=output/live-proof/<UUID>。');
const id = args.find(arg => arg.startsWith('--id='))?.slice(5); const live = args.find(arg => arg.startsWith('--live='))?.slice(7);
if (!id || !live) throw new Error('需一个--id和一个--live。');
const original = path.join(root, 'public/submission-next');
const liveDirectory = path.join(root, live);
const directory = path.join(root, 'output/release-candidate', id, 'submission-next');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const json = async (directory: string, filename: string) => JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
const sourceManifest = await json(original, 'manifest.json');
const report = await json(liveDirectory, 'report.json');
const ledger: ExperimentBudgetLedger = await json(liveDirectory, 'budget-ledger.json');
const projected: Record<string, Buffer> = {};
const projectionRecords: { name: string; sourceSha256: string; publicSha256: string; modified: boolean; reasons: string[] }[] = [];

function projectText(filename: string, text: string): { text: string; reasons: string[] } {
  const reasons: string[] = [];
  const beforePaths = text;
  for (const workspace of ['city-agent-virtual-society', 'city-agent-autonomous-production', 'city-agent']) {
    text = text.replace(new RegExp(`/Users/[^/]+/Documents/Code/_ai-goods/${workspace}/`, 'g'), 'repo:/');
  }
  text = text.replace(/\/Users\/[A-Za-z0-9._-]+\/(?:[^\s\n"'<>\])]+\/?)+/g, '[local-path-withheld]');
  if (text !== beforePaths) reasons.push('本机路径转repo-relative或移除；原件未修改');
  const beforeInternal = text;
  text = text.replace(/\[([^\]]+)\]\(https?:\/\/docs\.popo\.netease\.com[^)\s]*\)/g, '$1（内部来源未公开）')
    .replace(/<a\b[^>]*href=["']https?:\/\/docs\.popo\.netease\.com[^"']*["'][^>]*>([\s\S]*?)<\/a>/g, '$1（内部来源未公开）')
    .replace(/https?:\/\/docs\.popo\.netease\.com[^\s"'<>)]*/g, 'internal-source-not-published')
    .replaceAll('docs.popo.netease.com', 'internal-source-not-published');
  if (text !== beforeInternal) reasons.push('移除内部文档地址；来源原件SHA-256保留');
  if (filename.startsWith('methods/') && filename.endsWith('.md')) {
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label: string, target: string) => {
      if (/^(?:https?:|mailto:|#)/.test(target)) return whole;
      const basename = path.posix.basename(target.split('#')[0]);
      const alias: Record<string, string> = { 'METHODOLOGY.md': 'population-methodology.md', 'RESIDENT-CONSTRUCTION-METHOD.md': 'resident-construction.md',
        'BUSINESS-PROOF.md': 'business-proof.md', 'EVALUATION-NEXT.md': 'evaluation-next.md', 'PERSONA-PROOF.md': 'old-persona-proof.md', 'JUDGE-QUICKSTART.md': 'judge-quickstart.md' };
      if (alias[basename]) return `[${label}](${alias[basename]})`;
      if (PUBLIC_REVIEW_FILES.includes(path.posix.normalize(path.posix.join('methods', target.split('#')[0])) as never)) return whole;
      reasons.push('未随包源文件链接改为源码相对说明');
      return `${label}（源码相对路径：\`${target.replace(/^repo:\//, '')}\`；需源码包）`;
    });
    // These are archived method snapshots, not the current experiment ledger.
    text = '> 公开投影说明：本方法正文保留候选阶段的时间口径；新增真实LLM测试轮请看[最新总账](../live-proof/report.md)。正文中的“本轮/未执行”不覆盖新增总账。\n\n' + text;
    reasons.push('增加历史方法时间口径提示，不回填旧统计');
  }
  assertPublicText(filename, text);
  return { text, reasons: [...new Set(reasons)] };
}

async function readRegistered(directory: string, name: string): Promise<Buffer> {
  const filename = path.join(directory, name);
  if ((await lstat(filename)).isSymbolicLink() || !(await realpath(filename)).startsWith(directory + path.sep)) throw new Error(`附件路径越界/符号链接：${name}`);
  return readFile(filename);
}
const originalNames = sourceManifest.files?.map((file: { name: string }) => file.name);
if (!Array.isArray(originalNames) || originalNames.length !== PUBLIC_REVIEW_FILES.length || new Set(originalNames).size !== PUBLIC_REVIEW_FILES.length
  || originalNames.some((name: string) => !PUBLIC_REVIEW_FILES.includes(name as never))) throw new Error('原候选必须是登记53项附件，不接受任意文件。');
for (const file of sourceManifest.files) {
  const bytes = await readRegistered(original, file.name);
  if (file.bytes !== bytes.length || file.sha256 !== hash(bytes)) throw new Error(`原候选字节不一致：${file.name}`);
  if (file.name === 'project-materials.pdf') continue; // The original 15-page candidate remains untouched; create a new PDF below.
  const result = /\.(md|html|json|txt|vtt)$/.test(file.name) ? projectText(file.name, bytes.toString('utf8')) : { text: undefined, reasons: [] };
  const publicBytes = result.text === undefined ? bytes : Buffer.from(result.text);
  projected[file.name] = publicBytes;
  projectionRecords.push({ name: file.name, sourceSha256: hash(bytes), publicSha256: hash(publicBytes), modified: !bytes.equals(publicBytes), reasons: result.reasons });
}
for (const publicName of PUBLIC_LIVE_PROOF_FILES) {
  const filename = publicName.slice('live-proof/'.length); const bytes = await readRegistered(liveDirectory, filename);
  const result = projectText(publicName, bytes.toString('utf8'));
  const publicBytes = Buffer.from(result.text); projected[publicName] = publicBytes;
  projectionRecords.push({ name: publicName, sourceSha256: hash(bytes), publicSha256: hash(publicBytes), modified: !bytes.equals(publicBytes), reasons: result.reasons });
}

const integer = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}必须为非负整数，不能默认0。`); return value;
};
const same = (actual: unknown, expected: unknown, label: string) => { if (fingerprint(actual) !== fingerprint(expected)) throw new Error(`真实轮总账/镜像不一致：${label}`); };
const near = (actual: unknown, expected: number, label: string) => { if (typeof actual !== 'number' || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-9) throw new Error(`真实轮费用不一致：${label}`); };
const plan = await json(liveDirectory, 'plan.json');
const pricing = await json(liveDirectory, 'pricing-source.json');
if (report.schemaVersion !== 'live-business-report-1.0' || report.id !== path.basename(liveDirectory) || report.execution !== 'real-api-synthetic-residents' || report.mockUsed !== false
  || report.budgetCny !== 5 || report.maximumCalls !== 24 || report.marketResearchValidated !== false || report.personaContributionValidated !== false
  || report.providerBillingIndependentlyVerified !== false || report.thirtyResidentGate !== 'not-run') throw new Error('真实轮身份、调用方式、预算或效度边界不符合登记。');
same(report.model, { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' }, '模型selector');
same(report.planHash, fingerprint(plan), '预登记planHash'); same(report.authorizationId, ledger.experimentId, '授权身份');
if (ledger.schemaVersion !== 'experiment-budget-1.0' || ledger.budgetCny !== 5 || ledger.maxProviderRequests !== 24 || ledger.budgetNanoCny !== 5_000_000_000
  || !Array.isArray(ledger.reservations) || ledger.reservations.some(entry => entry.state === 'reserved')) throw new Error('真实轮预算未冻结或存在未完成预留。');
same(ledger.pricing.provider, report.model.provider, '计价provider'); same(ledger.pricing.modelId, report.model.modelId, '计价model');
same(ledger.pricing.inputCnyPerMillionTokens, pricing.peakCacheMissInputPerMillion, '输入价格'); same(ledger.pricing.outputCnyPerMillionTokens, pricing.peakOutputPerMillion, '输出价格');
if (new Set(ledger.reservations.map(entry => entry.requestId)).size !== ledger.reservations.length || new Set(ledger.reservations.map(entry => entry.reservationId)).size !== ledger.reservations.length) throw new Error('预算请求/预留身份重复。');
integer(ledger.requestCount, '请求数'); same(ledger.requestCount, ledger.reservations.length, '请求分母'); same(report.realModelCalls, ledger.requestCount, '全部真实调用');
if (ledger.requestCount < 1 || ledger.requestCount > 24 || ledger.committedCny > 5) throw new Error('真实轮没有任何实际授权请求，或超过授权上限。');
let knownInput = 0; let knownOutput = 0; let knownNanoCost = 0; let committedNano = 0;
for (const entry of ledger.reservations) {
  committedNano += integer(entry.committedNanoCny, '逐次承诺预留');
  if (entry.usage) {
    knownInput += integer(entry.usage.inputTokens, '输入Token'); knownOutput += integer(entry.usage.outputTokens, '输出Token');
    const cost = entry.usage.inputTokens * ledger.inputNanoCnyPerToken + entry.usage.outputTokens * ledger.outputNanoCnyPerToken;
    same(entry.actualNanoCny, cost, '逐次保守估价'); knownNanoCost += cost;
  } else if (entry.actualNanoCny !== undefined) throw new Error('缺失usage不能宣称已知费用。');
}
same(report.knownInputTokens, knownInput, '已报告输入Token'); same(report.knownOutputTokens, knownOutput, '已报告输出Token');
same(ledger.committedNanoCny, committedNano, '总承诺预留nano'); near(ledger.committedCny, committedNano / 1e9, '总承诺预留CNY');
near(ledger.knownUsageCostCny, knownNanoCost / 1e9, '总已知保守费用'); near(report.conservativeCostCny, knownNanoCost / 1e9, '报告费用'); near(report.committedCostCny, committedNano / 1e9, '报告预留');
same(report.usageStatus, ledger.usageStatus, 'usage状态'); same(report.budgetState, ledger.state, '预算状态'); same(report.budgetStopReason, ledger.stopReason ?? null, '预算停止原因');
same(report.authorizedRequestAttempts, ledger.requestCount, '授权尝试'); same(report.modelResponsesWithKnownUsage, ledger.knownUsageRequestCount, '已知usage响应');
same(report.successfulKnownUsageRequests, ledger.reservations.filter(entry => entry.outcome === 'succeeded' && entry.state === 'settled').length, '成功已知usage响应');
if (typeof report.requestCountMeaning !== 'string' || !report.requestCountMeaning.trim()) throw new Error('缺少调用次数边界说明。');
if (!Array.isArray(report.cases) || report.cases.length !== 2 || new Set(report.cases.map((item: { id: string }) => item.id)).size !== 2) throw new Error('两场景完整计划分母缺失/重复。');
const cases = [];
for (const scenario of ['child-snacks', 'pet-snacks'] as const) {
  const run = parseSurveyEvidence(await json(liveDirectory, `${scenario}/survey-run.json`));
  const item = report.cases.find((value: { id: string }) => value.id === scenario);
  const frozenPlan = plan.cases.find((value: { id: string }) => value.id === scenario);
  if (!item || !frozenPlan || run.mode !== 'live' || run.profiles.length !== 10 || run.task.questionnaire.questions.length !== (scenario === 'child-snacks' ? 17 : 18)
    || run.experiment?.id !== report.id || run.experiment?.arm !== scenario || run.parameters?.fixturePolicyId) throw new Error('真实场景、问卷、独立运行或无夹具条件不一致。');
  same(run.id, item.runId, `${scenario}runID`); same(run.task, frozenPlan.task, `${scenario}预登记问卷`); same(run.profiles, frozenPlan.profiles, `${scenario}预登记画像`);
  same(run.presetSnapshots, frozenPlan.presets.map(({ hasApiKey: _hasApiKey, ...publicPreset }: { hasApiKey?: boolean; [key: string]: unknown }) => publicPreset), `${scenario}预登记公开预设（仅剔除hasApiKey标志）`);
  same(run.metrics, item.metrics, `${scenario}metrics`);
  const audit = auditBusinessDemoRun(run, frozenPlan.rules); same(await json(liveDirectory, `${scenario}/logic-audit.json`), audit, `${scenario}跨题审计`);
  const rows = run.profiles.map(profile => checkLiveQualification(scenario, profile, run.responses.find(response => response.residentId === profile.id)!));
  const qualification = { protocol: frozenPlan.qualificationProtocol, planned: 10, checked: rows.filter(row => row.status === 'checked').length, rows };
  same(await json(liveDirectory, `${scenario}/qualification-audit.json`), qualification, `${scenario}资格审计`);
  const completeValid = run.responses.filter(response => response.status === 'valid' && qualification.rows.find(row => row.residentId === response.residentId)?.status === 'checked'
    && audit.records.find(row => row.residentId === response.residentId)?.passed).length;
  for (const [name, expected] of [['questionnaire.json', run.task], ['presets.json', run.presetSnapshots], ['raw-responses.json', run.responses],
    ['statistics.json', { summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }]] as const) same(await json(liveDirectory, `${scenario}/${name}`), expected, `${scenario}/${name}`);
  const promptText = `SYSTEM\n${run.prompt.system}\n\n${run.prompt.users.map(user => `RESIDENT ${user.residentId} SHA256 ${user.hash}\n${user.text}`).join('\n\n')}`;
  same(await readFile(path.join(liveDirectory, scenario, 'prompts.txt'), 'utf8'), promptText, `${scenario}可读Prompt`);
  same(item.planned, 10, `${scenario}计划`); same(item.started, run.metrics.modelCalls, `${scenario}已请求`);
  same(item.structurallyValid, run.metrics.structurallyValid, `${scenario}结构`); same(item.logicPassed, audit.passed, `${scenario}跨题`);
  same(item.qualificationPassed, qualification.checked, `${scenario}资格`); same(item.completeValid, completeValid, `${scenario}联合通过`);
  same(item.notStarted, run.metrics.notStarted, `${scenario}未启动`); same(item.failed, run.metrics.failed, `${scenario}失败`);
  same(item.qualityTargetMet, completeValid === 10 && audit.passed === 10 && qualification.checked === 10, `${scenario}10人门限`);
  same(ledger.reservations.filter(entry => entry.purpose === 'resident' && entry.requestId.startsWith(`${scenario}.`)).length, run.metrics.modelCalls, `${scenario}居民ledger`);
  cases.push({ id: scenario, item, run, audit, qualification });
}
same(report.plannedResidents, cases.reduce((total, value) => total + value.run.profiles.length, 0), '全部计划居民');
const plannerChild = await json(liveDirectory, 'planning-child.json'); const plannerPet = await json(liveDirectory, 'planning-pet.json'); const cors = await json(liveDirectory, 'cors-checks.json');
if (!Array.isArray(report.transport)) throw new Error('缺少真实传输记录。');
const confirmedRequests = report.transport.reduce((total: number, value: { forwardedRequests: number }) => total + integer(value.forwardedRequests, '确认上游次数'), 0)
  + (Array.isArray(cors.checks) ? cors.checks : []).filter((value: { status?: number | null }) => value.status !== null && value.status !== undefined).length;
same(report.providerRequestsConfirmed, confirmedRequests, '确认上游请求');
if (confirmedRequests > ledger.requestCount || report.transport.some((value: { forwardedRequests: number; deniedRequests: number }) => value.forwardedRequests > 1)) throw new Error('单请求传输次数或全部确认请求超过授权。');
const planning = [{ id: 'child-snacks', value: plannerChild }, { id: 'pet-snacks', value: plannerPet }];
for (const row of planning) {
  const count = ledger.reservations.filter(entry => entry.requestId === `planning.${row.id}`).length;
  const stated = row.value.evidence?.modelCalls ?? row.value.modelCalls;
  if (stated !== count) throw new Error('自然规划候选与独立ledger调用数不一致。');
  if (row.value.status === 'candidate' && row.value.controlledExecution?.candidateNotApplied !== true) throw new Error('自然规划不能伪称已应用到实际问卷。');
}

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (target: string, label: string) => `<a href="${esc(target)}">${esc(label)}</a>`;
const table = (headers: string[], rows: unknown[][]) => `<table class="small"><thead><tr>${headers.map(value => `<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const page = (title: string, content: string) => `<section class="sheet"><div class="eyebrow">CITY AGENT / 公开评审发布版</div><h2>${esc(title)}</h2>${content}</section>`;
const names = { 'child-snacks': '小学照护者 · 17题', 'pet-snacks': '宠物采购者 · 18题' };
const qualityMet = cases.every(value => value.item.qualityTargetMet === true);
const money = (value: number | null) => value === null ? '未知' : `¥${value.toFixed(6)}`;
const registeredToFreezeSeconds = (Date.parse(report.generatedAt) - Date.parse(plan.registeredAt)) / 1000;
if (!Number.isFinite(registeredToFreezeSeconds) || registeredToFreezeSeconds < 0) throw new Error('真实轮登记/冻结时间不合法。');
const cover = page('City Agent：可追溯的虚拟社会调查', `
  <div class="hero">人口证据 × 五层情景居民<br/>真实LLM调查测试轮与工程夹具分账</div>
  <h3>${qualityMet ? '真实测试已执行；首批登记工程质量门限满足，外部效度未验证' : '真实测试已执行；首批质量门限未通过，不扩样、不伪装成功'}</h3>
  <div class="entrance"><strong>项目体验入口</strong><p>${link(PUBLISHED_DEMO_URL, PUBLISHED_DEMO_URL)}</p><p>${link('project-materials.pdf', '完整申报PDF')} · ${link('live-proof/report.md', '新增真实测试轮')} · ${link('demo-next.mp4', '4分33秒实际UI录屏')}</p><p>公开评审发布版；待部署后核验公网。无需Key可看来源、旧实验、零费用工程示例；真实新请求需要自行配置Key和明确预算。完整Harness及规划执行在本机。</p></div>
  <p>本次授权API尝试 ${integer(report.realModelCalls, '授权尝试')} 次；确认上游请求${integer(report.providerRequestsConfirmed, '确认上游请求')}，有已报告usage的响应${integer(report.modelResponsesWithKnownUsage, '已报告usage响应')}，不使用mock规则回答。受访者仍是合成居民，不是滨江真人。每场景计划10人，失败/未启动保留在分母。</p>
  ${table(['重点验收材料', '可追溯交付'], [['来源、人群与角色构建', '官方统计原件；五层假设与未知；画像、资格、Prompt冻结'], ['问卷及结果自证', '两套固定17/18题真实LLM测试轮；另列12人规则夹具与历史负例'], ['技术及业务数据', 'Harness、模型、抽样、参数、Token和保守费用；unknown不填0'], ['体验、视频、创新与价值', '公开入口、安装指南、4:33实际UI录屏、补采与假设压力测试']])}
  <aside>本版生成${esc(new Date().toISOString())}；原15页候选与旧Tag保持不动。不是比赛正式提交回执。源码固定ref、上线可达性以独立发布记录为准；录屏是之前零费用UI演示，不冒充此次付费API实录。</aside>`);
const liveSummary = page('新增重点：真实LLM虚拟社会调查测试轮', `
  <p>执行：${esc(report.execution)}；mockUsed=false；模型${esc(report.model.provider)} / ${esc(report.model.modelId)}；Base URL ${esc(report.model.baseUrl)}；${esc(report.harness)}。每个画像独立请求，不能看其他答卷；共享模型仍可能相关。</p>
  ${table(['场景', '计划', '请求', '未启动', '结构/计划', '跨题/计划', '资格/计划', '联合/计划'], cases.map(value => [names[value.id], 10, value.item.started, value.item.notStarted, `${value.item.structurallyValid}/10`, `${value.item.logicPassed}/10`, `${value.item.qualificationPassed}/10`, `${value.item.completeValid}/10`]))}
  ${table(['场景', '结构失败/无效', '居民调用耗时', '输入 / 输出Token', '居民保守费用', '10人门限'], cases.map(value => [names[value.id], value.item.failed, `${(value.run.durationMs / 1000).toFixed(2)}秒`, `${value.run.metrics.inputTokens ?? '未知'} / ${value.run.metrics.outputTokens ?? '未知'}`, money(value.run.metrics.apiCostCny), value.item.qualityTargetMet ? '满足' : '未满足']))}
  <p>全部居民、规划与CORS授权尝试合计${report.realModelCalls}/24；确认上游请求${report.providerRequestsConfirmed}；已知usage响应${report.modelResponsesWithKnownUsage}。授权预留次数不等于全部成功发出；${esc(report.requestCountMeaning)}。已报告输入${knownInput}、输出${knownOutput}，合计${knownInput + knownOutput}Token（usage=${esc(report.usageStatus)}；缺失部分不作0）。已报告用量保守估价${money(report.conservativeCostCny)}；承诺预留${money(report.committedCostCny)}；授权总上限¥5。预算状态=${esc(report.budgetState)}；停止原因=${esc(report.budgetStopReason ?? '无')}。</p>
  <p>登记到证据冻结${registeredToFreezeSeconds.toFixed(2)}秒，包含居民、规划与浏览器检查，不是纯模型推理时间。单价按已核验官方高峰非缓存输入${esc(pricing.peakCacheMissInputPerMillion)}/输出${esc(pricing.peakOutputPerMillion)}元/百万Token；不计缓存/谷价优惠，不是供应商账单。</p>
  <h3>抽样、Prompt与停止规则</h3><p>seed=${esc(plan.seed)}；四情景覆盖3/3/2/2，无总体权重。居民maxOutputTokens=${esc(plan.residentMaxOutputTokens)}，timeout=${esc(plan.timeoutMs)}ms，concurrency=${esc(plan.concurrency)}，retries=0，answerCache=false，temperature/providerSeed未设置，thinking disabled。所有五层为assumption，儿童本人原文未采集时必须null。</p>
  <p>首份结构、登记跨题或资格冲突停止该场景；预算/usage/网络/存储不确定停止后续授权请求。不补答、不替换居民、不重试、不换模型、不充值；未通过10/10时不得自动扩30人。</p>
  <aside>结构失败/无效数量与跨题冲突是不同口径；上表全部以10个预登记画像为分母。真实API验证模型工程质量，不证明真实消费者偏好、五层贡献或选址。${link('live-proof/budget-ledger.json', '逐次预留/结算')} · ${link('live-proof/plan.json', '预登记协议')} · ${link('live-proof/pricing-source.json', '定价来源')}</aside>`);
const failures = cases.map(value => {
  const started = value.run.responses.filter(response => response.status !== 'not-started');
  const issues = started.flatMap(response => {
    const logic = value.audit.records.find(row => row.residentId === response.residentId);
    const qualification = value.qualification.rows.find(row => row.residentId === response.residentId);
    const messages = [response.error, ...(logic?.errors ?? []), ...(logic?.report.issues ?? []).map(issue => issue.message), ...(qualification?.issues ?? [])].filter(Boolean);
    return messages.length ? [`${response.residentId}：${messages.join('；')}`] : [];
  });
  return `<li>${esc(names[value.id])}：${issues.length ? esc(issues.slice(0, 2).join(' | ').slice(0, 430)) : '已启动答卷没有登记硬冲突；完整原文仍逐份保留。'} ${link(`live-proof/${value.id}/raw-responses.json`, 'raw原文')} · ${link(`live-proof/${value.id}/logic-audit.json`, '全部规则问题')}。</li>`;
}).join('');
const globalNames = ['report.json', 'report.md', 'plan.json', 'budget-ledger.json', 'pricing-source.json', 'planning-child.json', 'planning-pet.json', 'cors-checks.json'];
const caseNames = ['questionnaire.json', 'presets.json', 'survey-run.json', 'logic-audit.json', 'qualification-audit.json', 'raw-responses.json', 'statistics.json', 'prompts.txt'];
const liveTrace = page('自然规划候选、负结果与24项真实轮附件', `
  <p>自然语言规划请求与实际固定问卷分列：规划候选不自动替换本次17/18题问卷，也不认证现实选址或人格有效性。</p>
  ${table(['自然语言规划', '实际状态', '边界/失败'], planning.map(row => [names[row.id as keyof typeof names], row.value.status ?? row.value.state ?? '未知', row.value.status === 'candidate' ? '候选未自动应用；语义/市场效度未验。' : String(row.value.error ?? row.value.reason ?? '见完整证据').slice(0, 280)]))}
  ${table(['浏览器检查', '结果 / HTTP / finishReason', '分母与能力边界'], (Array.isArray(cors.checks) ? cors.checks : [cors]).map((value: any) => [value.id ? names[value.id as keyof typeof names] : '未执行', `${value.state ?? '未知'} / ${value.status ?? '未知'} / ${value.finishReason ?? '未知'}`, '实际Pages origin协议/CORS；重复首画像，不计独立居民，不等于新版页面全流程。']))}
  <h3>负结果不修补</h3><ul>${failures}</ul>
  <h3>全部真实轮附件（独立于夹具与历史实验）</h3><p>${globalNames.map(name => link(`live-proof/${name}`, name)).join(' · ')}</p>
  ${cases.map(value => `<p><strong>${esc(names[value.id])}：</strong>${caseNames.map(name => link(`live-proof/${value.id}/${name}`, name.replace('.json', ''))).join(' · ')}</p>`).join('')}
  <aside>下文“规则夹具”各12人问卷/结果与新真实LLM的10人计划独立分账；不将24名夹具居民混入真实样本。不计算真人置信区间/猫犬市场占比/儿童口味，不据此输出主营价位或铺位建议。所有规划失败、未知usage、未启动与原文均保留。</aside>`);

let html = projected['index.html'].toString('utf8');
html = html.replaceAll('候选申报补充版', '公开评审发布版').replaceAll('新版候选申报材料', '公开评审申报材料')
  .replace(/<section class="sheet">[\s\S]*?<\/section>/, `${cover}\n${liveSummary}\n${liveTrace}`)
  .replaceAll('本轮自证总账', '规则夹具自证总账')
  .replaceAll('当前没有新增付费模型调用，也没有30人真实完整率实验、异构稳健性、五层消融或真人/交易留出结果。尚未验证的不能以工程12/12代替。', '新增真实LLM首批测试轮见前页与live-proof：未通过、未启动均保留。30人完整率、异构稳健性、五层消融和真人/交易留出仍未执行，不能以夹具12/12代替。')
  .replaceAll('未执行新付费批次；live API当前最多12', '首批真实轮见前页；30人未执行，live API当前最多12')
  .replaceAll('待用户确认；不移动旧Tag', '用户已批准公开评审发布；待部署后核验，不移动旧Tag')
  .replaceAll('该ZIP是未公开候选快照，不把本地分支当成已发布GitHub版本；正式发布后补固定ref。', '安装源码以本次独立发布记录的固定Git ref/源码快照为准；不把本地工作树当成已公开版本。')
  .replaceAll('材料生成不代表正式提交。PDF附件链接指向未发布的候选/submission-next，当前公网不能据此打开新附件；请用随附ZIP中的index.html相对打开，或待发布后统一复验。旧公开入口和本地候选有明确版本差异；正式现场审查应选择同一固定版本的源码、Demo、材料与录屏，不混用新材料和旧功能。', '材料生成不是正式比赛提交回执。公开评审版附件指向/submission-next，待部署后统一核验；离线ZIP的index.html可相对打开。旧Tag/旧submission与原15页候选保留；评审须对齐独立发布记录中的源码、Demo、材料与录屏版本。');
// Label all old fixture sections so their zero-calls/12-person results cannot be read as the new live cohort.
html = html.replace(/<h2>([^<]*(?:小学|宠物)[^<]*(?:问卷|结果)[^<]*)<\/h2>/g, '<h2>规则夹具工程示例：$1</h2>');
assertPublicText('index.html', html);
const browser = await chromium.launch();
let pdfBytes: Buffer;
try {
  const tab = await browser.newPage(); await tab.route('**/*', route => route.abort());
  await tab.setContent(html, { waitUntil: 'load' });
  await tab.evaluate(() => {
    document.querySelectorAll('.sheet').forEach((section, index) => { const heading = section.querySelector('.eyebrow'); if (heading) heading.textContent = `CITY AGENT / 公开评审发布版 · ${String(index + 1).padStart(2, '0')}`; });
  });
  html = await tab.content(); projected['index.html'] = Buffer.from(html);
  // A base only for PDF annotations: online links and offline HTML links remain explicit.
  await tab.evaluate(() => { const base = document.createElement('base'); base.href = 'https://litianyi-007.github.io/city-agent/submission-next/'; document.head.prepend(base); });
  pdfBytes = await tab.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font:8px Arial;width:100%;text-align:center;color:#637888">CITY AGENT · PUBLIC REVIEW · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
} finally { await browser.close(); }
projected['project-materials.pdf'] = pdfBytes;
const toMarkdown = (input: string) => input.replace(/<style>[\s\S]*?<\/style>|<head>[\s\S]*?<\/head>/g, '')
  .replace(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/g, (_match, header: string) => `<tr>${header}</tr>\n| ${Array((header.match(/<th>/g) ?? []).length).fill('---').join(' | ')} |\n`)
  .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '[$2]($1)').replace(/<h2>/g, '\n\n## ').replace(/<h3>/g, '\n\n### ').replace(/<li>/g, '\n- ')
  .replace(/<\/p>|<\/aside>|<\/table>/g, '\n\n').replace(/<br\/?\s*>/g, '\n').replace(/<tr>/g, '\n| ').replace(/<\/t[hd]>/g, ' | ').replace(/<[^>]*>/g, '')
  .replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
projected['project-materials.md'] = Buffer.from(`# City Agent：公开评审申报材料\n\n体验入口：${PUBLISHED_DEMO_URL}\n\n${toMarkdown(html)}`);
const generatedAt = new Date().toISOString();
const recordChanges = new Map(projectionRecords.map(record => [record.name, record]));
for (const name of ['index.html', 'project-materials.md']) {
  const record = recordChanges.get(name)!; record.publicSha256 = hash(projected[name]); record.modified = true; record.reasons.push('公开阶段状态与新增真实轮内容，旧阶段原件保持不动');
}
const originalPdf = await readRegistered(original, 'project-materials.pdf');
projectionRecords.push({ name: 'project-materials.pdf', sourceSha256: hash(originalPdf), publicSha256: hash(pdfBytes), modified: true, reasons: ['新建公开评审PDF，显眼新增真实轮与失败数据；原15页PDF未覆盖'] });
const sourceReadme = recordChanges.get('README.md')!;
const readme = `# 公开评审发布包（非比赛提交回执）\n\n体验入口：${PUBLISHED_DEMO_URL}；材料准备完成，部署后须按独立发布记录核验。首先打开project-materials.pdf或index.html。\n\n新增API授权尝试${report.realModelCalls}/24；确认上游请求${report.providerRequestsConfirmed}；已知usage响应${report.modelResponsesWithKnownUsage}。已报告用量保守估价${money(report.conservativeCostCny)}、承诺预留${money(report.committedCostCny)}、上限¥5；usage=${report.usageStatus}。居民仍为合成画像，mockUsed=false不等于真人外部效度。失败/未启动和全部24项live-proof附件保留。自然规划候选未自动替换固定17/18问卷；CORS重复首画像不计新居民。原工程夹具的0调用和历史负例原数值保持，彼此不合并。\n\n本包不含源码、Key、私人数据库或会话。安装使用独立发布记录的固定Git ref或审查过的源码ZIP。methods正文是候选阶段方法快照，新增状态以live-proof/report为准；未随包源码链接均明确为源码相对说明。录屏4分33秒是先前零费用UI操作，不冒充此次API运行录像。\n\n## 公开投影追溯\n\n源候选manifest SHA-256：${hash(await readFile(path.join(original, 'manifest.json')))}。源真实报告SHA-256：${hash(await readFile(path.join(liveDirectory, 'report.json')))}。下面映射保留原件字节身份，原文件未写回。repo:/表示源码仓库相对路径；内部链接仅保留不可逆原件hash，不公布地址/账号。raw只有在命中公开路径边界时才作脱敏副本，并标记；原证据hash指向冻结原件，不自动认证投影原文。哈希只证明字节一致性，不认证现实真值、调用身份或供应商账单。README自身为此说明新生成，不递归计算自hash。\n\n| 附件 | 源件SHA-256 | 公开副本SHA-256 | 投影说明 |\n|---|---|---|---|\n${projectionRecords.filter(record => record.name !== 'README.md').map(record => `| ${record.name} | ${record.sourceSha256} | ${record.publicSha256} | ${record.modified ? record.reasons.join('；') || '公开脱敏投影' : '逐字节相同'} |`).join('\n')}\n\nREADME源件SHA-256：${sourceReadme.sourceSha256}。正式提交状态未确认；旧submission及Tag保持原样，不回填旧截止时间。\n`;
projected['README.md'] = Buffer.from(readme);
for (const [name, bytes] of Object.entries(projected)) if (/\.(json|html|txt|md|vtt)$/.test(name)) assertPublicText(name, bytes.toString('utf8'));
const files = Object.entries(projected).sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) }));
const manifest = { ...sourceManifest, generatedAt,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: true,
  releaseStatus: 'public-reviewed-candidate', realModelCallsThisBatch: report.realModelCalls,
  publicationReview: { status: 'public-reviewed', reviewedAt: generatedAt, localPathsRemoved: true, internalLinksRemoved: true, credentialsRemoved: true, privateDataExcluded: true }, files };
delete manifest.localDemo;
verifyPublicSubmission({ manifest, files: projected });
// Exclusive output creation; reruns must use a new release UUID, never overwrite a candidate.
await mkdir(path.dirname(path.dirname(directory)), { recursive: true });
await mkdir(path.dirname(directory), { recursive: false });
await mkdir(directory, { recursive: false });
for (const [name, bytes] of Object.entries(projected)) { const filename = path.join(directory, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes, { flag: 'wx' }); }
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
const pdfDirectory = path.join(root, 'output/pdf'); await mkdir(pdfDirectory, { recursive: true });
const pdfPath = path.join(pdfDirectory, `city-agent-public-review-${id}.pdf`); await writeFile(pdfPath, pdfBytes, { flag: 'wx' });
console.log(JSON.stringify({ directory, pdfPath, files: files.length, realModelCalls: report.realModelCalls, conservativeCostCny: report.conservativeCostCny,
  originalCandidateUnchanged: true, published: false, formalSubmission: 'not-confirmed', externalWrites: 0 }, null, 2));
