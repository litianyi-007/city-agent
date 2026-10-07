import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runRole, HarnessCallError, HARNESS_NAME } from '../server/harness';
import { createExperimentBudget, type ExperimentBudgetGuard } from '../server/research/experiment-budget';
import { createSingleRequestRelay } from '../server/research/single-request-relay';
import { getPopulationPack, getPopulationModel } from '../server/population/service';
import { createLiveBusinessProtocol, checkLiveQualification, liveResponseStop, LIVE_BUSINESS_PROTOCOL } from '../shared/live-business-protocol';
import { executeSurvey } from '../shared/survey-runner';
import { buildProfiles, RESIDENT_SYSTEM_PROMPT, residentPrompt, type SurveyRun } from '../shared/survey-engine';
import { fingerprint } from '../shared/evidence';
import { auditBusinessDemoRun } from '../shared/research-demo';
import { preflightResearchTask } from '../server/research/contract';
import { planResearch, ResearchPlanningError } from '../server/research/planning';
import { parseSurveyEvidence } from '../src/run-history';
import { redactKnownSecret, containsKnownSecret } from '../shared/redaction';

const root = path.resolve(import.meta.dirname, '..');
const AUTHORIZATION_ID = 'approved-2026-10-07-cny5-24';
const args = process.argv.slice(2);
if (args.some(arg => !['--execute', '--preflight'].includes(arg) && !arg.startsWith('--credential-store='))) throw new Error('仅接受执行/预检和本机凭据目录；预算/次数/模型不可由命令行放宽。');
if (args.filter(arg => ['--execute', '--preflight'].includes(arg)).length !== 1) throw new Error('显式选择--preflight或--execute；默认不付费。');
const execute = args.includes('--execute');
const store = path.resolve(args.find(arg => arg.startsWith('--credential-store='))?.slice('--credential-store='.length) ?? path.join(root, '.city-agent'));
// Read-only reuse of ONE already-configured agent. No CityStore construction/migration or Key logging.
const db = new DatabaseSync(path.join(store, 'city-agent.sqlite'), { readOnly: true });
let selected: { agent: any; encrypted: string } | undefined;
try {
  for (const row of db.prepare('SELECT data,secret FROM agents WHERE secret IS NOT NULL').all() as unknown as { data: string; secret: string }[]) {
    const agent = JSON.parse(row.data);
    if (agent.role === 'researcher' && agent.enabled && agent.provider === 'deepseek' && agent.baseUrl.replace(/\/$/, '') === 'https://api.deepseek.com' && agent.modelId === 'deepseek-flash') { selected = { agent, encrypted: row.secret }; break; }
  }
} finally { db.close(); }
if (!selected) throw new Error('没有已配置的DeepSeek官方Flash研究员；不替换模型或充值。');
const publicModel = { provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' };
const sourceHtml = await readFile(path.join(root, 'output/deepseek-pricing-live-source.html'));
const pricingSource = { checkedAt: new Date().toISOString(), url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  sourceHtmlSha256: createHash('sha256').update(sourceHtml).digest('hex'), method: 'direct-official-HTML-fetched-and-table-manually-verified',
  modelId: publicModel.modelId, currency: 'CNY', peakCacheMissInputPerMillion: 2, peakOutputPerMillion: 8,
  offPeakCacheMissInputPerMillion: 1, offPeakOutputPerMillion: 4,
  estimateBasis: 'All input charged at peak cache-miss and output at peak rate for conservative ceiling; no cache/off-peak rebate. Not provider invoice.', sourceVersionIndependentlyAttested: false };
if (!sourceHtml.includes(Buffer.from('deepseek-flash')) || !sourceHtml.includes(Buffer.from('高峰时段'))) throw new Error('定价原件未核验，不执行付费。');
const pricing = { currency: 'CNY' as const, inputPerMillion: 2, outputPerMillion: 8, suppliedAt: pricingSource.checkedAt,
  source: `${pricingSource.url}；本轮按高峰非缓存价保守估算，不是账单，忽略缓存/谷价优惠。` };
const pack = getPopulationPack(); const population = getPopulationModel();
const protocols = (['child-snacks', 'pet-snacks'] as const).map(id => createLiveBusinessProtocol(id, publicModel));
const seed = 20261007;
const prepared = protocols.map(protocol => ({ protocol, profiles: buildProfiles(protocol.task, population, protocol.presets, 10, seed) }));
if (!execute) {
  console.log(JSON.stringify({ status: 'preflight-only', model: publicModel, configured: true, authorizationId: AUTHORIZATION_ID,
    budgetCny: 5, maxProviderRequests: 24, plannedResidents: 20, plannedPlanningRequests: 2, plannedCorsRequests: 2,
    pricingSource, cases: prepared.map(({ protocol, profiles }) => ({ id: protocol.id, questions: protocol.task.questionnaire.questions.length,
      count: profiles.length, personaCounts: protocol.presets.map(preset => ({ id: preset.id, count: profiles.filter(profile => profile.presetId === preset.id).length })),
      taskHash: fingerprint(protocol.task), profileHash: fingerprint(profiles), rulesHash: fingerprint(protocol.logicRules) })), realModelRequests: 0 }, null, 2));
  process.exit(0);
}
const key = await readFile(path.join(store, 'encryption.key'));
const payload = Buffer.from(selected.encrypted, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12)); decipher.setAuthTag(payload.subarray(12, 28));
const apiKey = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
const model = { ...publicModel, apiKey };
const experimentId = randomUUID(); const directory = path.join(root, 'output/live-proof', experimentId);
const ledgerPath = path.join(root, 'output/live-evaluation-authorizations', AUTHORIZATION_ID, 'budget-ledger.json');
let guard: ExperimentBudgetGuard;
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory, { recursive: false });
const safe = (input: unknown) => {
  const text = redactKnownSecret(JSON.stringify(input, null, 2), apiKey);
  if (containsKnownSecret(text, apiKey)) throw new Error('公开证据仍含凭据，停止写入。'); return `${text}\n`;
};
const save = async (name: string, value: unknown, exclusive = false) => {
  const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, safe(value), exclusive ? { flag: 'wx' } : undefined);
};
const sources = ['scripts/run-live-business-review.ts', 'shared/live-business-protocol.ts', 'shared/survey-runner.ts', 'shared/survey-engine.ts',
  'server/harness.ts', 'server/research/experiment-budget.ts', 'server/research/single-request-relay.ts'];
const sourceFiles = await Promise.all(sources.map(async name => ({ path: name, sha256: createHash('sha256').update(await readFile(path.join(root, name))).digest('hex') })));
const plan = { schemaVersion: 'live-business-plan-1.0', id: experimentId, authorizationId: AUTHORIZATION_ID, registeredAt: new Date().toISOString(),
  protocolVersion: LIVE_BUSINESS_PROTOCOL, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: true, sourceFiles,
  model: publicModel, modelIdentity: 'configured-selector-not-independent-weight-attestation', harness: HARNESS_NAME, populationHash: population.datasetHash,
  budgetCny: 5, maxProviderRequests: 24, seed, retries: 0, concurrency: 1, timeoutMs: 90_000, residentMaxOutputTokens: 3000, plannerMaxOutputTokens: 6000,
  answerCache: false, providerSeed: null, temperature: null, reasoning: 'DeepSeek thinking disabled',
  stopRules: ['Budget/unknown usage/storage/network failure: halt all subsequent requests.', 'First invalid/registered cross-rule/qualification conflict: stop that scenario, keep not-started denominator, no retry.', 'No resume or new ledger under same approval.'],
  plannedResidents: 20, plannedPlanningRequests: 2, plannedCorsRequests: 2,
  qualityTarget: { eachScenarioPlanned: 10, completeValid: 10, registeredHardConflicts: 0, externalValidity: 'not-tested', personaContribution: 'not-tested' },
  cases: prepared.map(({ protocol, profiles }) => ({ id: protocol.id, task: protocol.task, presets: protocol.presets, profiles,
    taskHash: fingerprint(protocol.task), profileHash: fingerprint(profiles), rules: protocol.logicRules, rulesHash: fingerprint(protocol.logicRules),
    qualificationProtocol: protocol.qualificationProtocol, qualificationProtocolHash: fingerprint(protocol.qualificationProtocol),
    systemPrompt: RESIDENT_SYSTEM_PROMPT, userPrompts: profiles.map(profile => residentPrompt(protocol.task, profile)) })) };
await save('plan.json', plan, true); await save('pricing-source.json', pricingSource, true);
const transport: { requestId: string; kind: string; forwardedRequests: number; deniedRequests: number; providerStatus: number | null }[] = [];
const boundedHarness = (requestId: string, purpose: string): typeof runRole => async (agent, system, user, signal, event, limits) => {
  const maxOutputTokens = limits?.maxOutputTokens ?? 3000;
  const reservation = guard.reserve({ requestId, purpose, inputText: JSON.stringify({ system, user }), maxOutputTokens, inputEnvelopeTokens: 16384 });
  let relay: Awaited<ReturnType<typeof createSingleRequestRelay>> | undefined;
  try {
    relay = await createSingleRequestRelay({ model: agent, maxOutputTokens, reservedInputTokens: reservation.reservedInputTokens });
    const result = await runRole({ ...agent, baseUrl: relay.baseUrl }, system, user, signal, event, { maxOutputTokens, timeoutMs: 90_000, reportUsage: true });
    const ledger = guard.settle(reservation.reservationId, { outcome: 'succeeded', usage: result.usageReported ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens } : null });
    if (ledger.state === 'halted') throw new HarnessCallError('预算检查停止后续请求：用量未知或超预留。', { text: result.text, inputTokens: result.usageReported ? result.inputTokens : null, outputTokens: result.usageReported ? result.outputTokens : null });
    return result;
  } catch (error) {
    if (guard.snapshot().reservations.some(entry => entry.reservationId === reservation.reservationId && entry.state === 'reserved')) {
      const evidence = error instanceof HarnessCallError ? error.evidence : undefined;
      guard.settle(reservation.reservationId, { outcome: signal.aborted ? 'cancelled' : 'failed', usage: evidence?.inputTokens != null && evidence.outputTokens != null
        ? { inputTokens: evidence.inputTokens, outputTokens: evidence.outputTokens } : null });
    }
    throw error;
  } finally { transport.push({ requestId, kind: purpose, ...(relay?.snapshot() ?? { forwardedRequests: 0, deniedRequests: 0, providerStatus: null }) }); await relay?.close(); }
};
const reports: any[] = []; const completed: { protocol: typeof protocols[number]; run: SurveyRun }[] = [];
let cors: any[] = [];
guard = createExperimentBudget({ ledgerPath, experimentId: AUTHORIZATION_ID, budgetCny: 5, maxProviderRequests: 24,
  pricing: { provider: publicModel.provider, modelId: publicModel.modelId, currency: 'CNY', inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
    sourceUrl: pricingSource.url, checkedAt: pricingSource.checkedAt } });
try {
  // Execute the actual resident test first; planner candidates never silently replace this frozen questionnaire.
  for (const { protocol, profiles } of prepared) {
    const controller = new AbortController();
    if (guard.snapshot().state !== 'active') controller.abort('Global budget stop; no provider request allowed.');
    const run = await executeSurvey({ id: randomUUID(), task: protocol.task, population, pack, presets: protocol.presets, count: 10, seed, mode: 'live',
      frozenProfiles: profiles, pricing, knownSecrets: [apiKey], signal: controller.signal, experiment: { id: experimentId, arm: protocol.id },
      stopAfterResponse: (response, profile) => liveResponseStop(protocol, response, profile),
      progress: text => console.log(JSON.stringify({ event: 'resident-progress', scenario: protocol.id, text })),
      checkpoint: async run => { run.limitations.push('真实LLM/API测试轮；逐调用由持久CNY5/24预算及单请求转发控制，不是真人调查。'); await save(`${protocol.id}/survey-run.json`, run); },
      call: async (profile, system, user, signal) => {
        const result = await boundedHarness(`${protocol.id}.${profile.id}`, 'resident')(model, system, user, signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90_000, reportUsage: true });
        return { text: result.text, inputTokens: result.usageReported ? result.inputTokens : null, outputTokens: result.usageReported ? result.outputTokens : null };
      } });
    run.limitations.push('真实LLM/API测试轮；未采集真人，不认证五层贡献、养宠比例、儿童本人口味或真实选址。');
    if (controller.signal.aborted) run.limitations.push('本场景未启动是全局预算停止，不是用户主动取消；modelCalls=0。');
    parseSurveyEvidence(run);
    const logicAudit = auditBusinessDemoRun(run, protocol.logicRules);
    const qualifications = run.profiles.map(profile => checkLiveQualification(protocol.id, profile, run.responses.find(response => response.residentId === profile.id)!));
    const qualificationAudit = { protocol: protocol.qualificationProtocol, planned: 10, checked: qualifications.filter(item => item.status === 'checked').length, rows: qualifications };
    const fullyValid = run.responses.filter(response => response.status === 'valid' && qualifications.find(item => item.residentId === response.residentId)?.status === 'checked'
      && logicAudit.records.find(item => item.residentId === response.residentId)?.passed === true).length;
    for (const [name, value] of [['questionnaire.json', run.task], ['presets.json', run.presetSnapshots], ['survey-run.json', run], ['raw-responses.json', run.responses],
      ['statistics.json', { summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }], ['logic-audit.json', logicAudit], ['qualification-audit.json', qualificationAudit]] as const) await save(`${protocol.id}/${name}`, value);
    await writeFile(path.join(directory, protocol.id, 'prompts.txt'), redactKnownSecret(`SYSTEM\n${run.prompt.system}\n\n${run.prompt.users.map(user => `RESIDENT ${user.residentId} SHA256 ${user.hash}\n${user.text}`).join('\n\n')}`, apiKey));
    const report = { id: protocol.id, runId: run.id, title: run.task.title, questions: run.task.questionnaire.questions.length, planned: 10, started: run.metrics.modelCalls,
      structurallyValid: run.metrics.structurallyValid, defaultValid: run.metrics.valid, logicPassed: logicAudit.passed, qualificationPassed: qualificationAudit.checked,
      completeValid: fullyValid, qualityTargetMet: fullyValid === 10 && logicAudit.passed === 10 && qualificationAudit.checked === 10,
      notStarted: run.metrics.notStarted, failed: run.metrics.failed, state: run.state, metrics: run.metrics, durationMs: run.durationMs,
      taskHash: run.taskHash, profileHash: run.profileHash, rulesHash: logicAudit.rulesHash, qualificationProtocolHash: fingerprint(protocol.qualificationProtocol),
      preflight: preflightResearchTask(run.task, pack), marketResearchValidated: false, personaContributionValidated: false };
    reports.push(report); completed.push({ protocol, run }); console.log(JSON.stringify({ event: 'scenario-finished', ...report }));
  }
  for (const { protocol } of prepared) {
    const filename = protocol.id === 'child-snacks' ? 'planning-child.json' : 'planning-pet.json';
    if (guard.snapshot().state !== 'active') { await save(filename, { state: 'not-run', reason: 'budget-stopped', modelCalls: 0 }); continue; }
    try {
      const candidate = await planResearch({ request: protocol.id === 'child-snacks'
        ? '我想调查滨江区小学生的零食喜好，如果开零食店，该怎么选址和选择零食品类？本次先设计成年照护者问卷，不冒充儿童本人。'
        : '我想为线上销售配合线下网点售卖宠物零食，该调查哪些区域、价位、猫犬类别？零食与主粮必须分开，没有现实订单不作真实选址结论。',
        population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' }, maxQuestions: 18 }, model,
        new AbortController().signal, boundedHarness(`planning.${protocol.id}`, 'planning'));
      // The planner's injected-runner flag is deliberately preserved, with explicit trusted transport attestation alongside it.
      await save(filename, { ...candidate, controlledExecution: { transport: HARNESS_NAME, oneUpstreamRequestGuarded: true, candidateNotApplied: true } });
    } catch (error) { await save(filename, { state: 'failed', modelCalls: guard.snapshot().reservations.filter(entry => entry.requestId === `planning.${protocol.id}`).length,
      error: redactKnownSecret(error instanceof Error ? error.message : String(error), apiKey), ...(error instanceof ResearchPlanningError ? { evidence: error.evidence } : {}) }); }
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (guard.snapshot().state === 'active') {
      browser = await chromium.launch(); const page = await browser.newPage();
      await page.goto('https://litianyi-007.github.io/city-agent/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (new URL(page.url()).origin !== 'https://litianyi-007.github.io') throw new Error('公网origin不匹配，不注入Key。');
      for (const { protocol, run } of completed) {
        if (guard.snapshot().state !== 'active') break;
        const system = run.prompt.system; const user = run.prompt.users[0].text;
        const reservation = guard.reserve({ requestId: `cors.${protocol.id}`, purpose: 'browser-cors', inputText: JSON.stringify({ system, user }), maxOutputTokens: 3000, inputEnvelopeTokens: 16384 });
        const result = await page.evaluate(async ({ apiKey, system, user }) => {
          try {
            const response = await fetch('https://api.deepseek.com/chat/completions', { method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(90_000),
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 3000, thinking: { type: 'disabled' }, stream: false }) });
            const body = await response.json(); return { state: response.ok ? 'completed' : 'failed', status: response.status, raw: body.choices?.[0]?.message?.content ?? '',
              finishReason: body.choices?.[0]?.finish_reason ?? null, inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null };
          } catch { return { state: 'failed', status: null, raw: '', finishReason: null, inputTokens: null, outputTokens: null }; }
        }, { apiKey, system, user });
        const usage = Number.isSafeInteger(result.inputTokens) && Number.isSafeInteger(result.outputTokens) && result.inputTokens >= 0 && result.outputTokens >= 0
          ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens } : null;
        guard.settle(reservation.reservationId, { outcome: result.state === 'completed' && result.finishReason === 'stop' ? 'succeeded' : 'failed', usage });
        cors.push({ id: protocol.id, origin: 'https://litianyi-007.github.io', execution: 'actual-browser-provider-fetch', sourceRunId: run.id,
          repeatedProfileId: run.profiles[0].id, countedInResidentCohort: false, ...result });
      }
    }
  } catch (error) { cors.push({ state: 'not-run', reason: redactKnownSecret(error instanceof Error ? error.message : String(error), apiKey) }); }
  finally { await browser?.close(); }
  await save('cors-checks.json', { checks: cors, note: '真实Pages origin的模型协议/CORS检查；不等于新版页面长问卷输入全流程，不增加独立居民分母。' });
} finally {
  guard.close(); await save('budget-ledger.json', guard.snapshot());
  for (const filename of ['planning-child.json', 'planning-pet.json', 'cors-checks.json']) {
    try { await readFile(path.join(directory, filename)); } catch { await save(filename, { state: 'not-run', reason: 'experiment-stopped', modelCalls: 0 }); }
  }
  const budget = guard.snapshot();
  const ledgerKnownInput = budget.reservations.reduce((total, entry) => total + (entry.usage?.inputTokens ?? 0), 0);
  const ledgerKnownOutput = budget.reservations.reduce((total, entry) => total + (entry.usage?.outputTokens ?? 0), 0);
  const report = { schemaVersion: 'live-business-report-1.0', id: experimentId, authorizationId: AUTHORIZATION_ID, generatedAt: new Date().toISOString(),
    execution: 'real-api-synthetic-residents', mockUsed: false, model: publicModel, harness: HARNESS_NAME, planHash: fingerprint(plan),
    plannedResidents: 20, cases: reports, realModelCalls: budget.requestCount, authorizedRequestAttempts: budget.requestCount,
    providerRequestsConfirmed: transport.reduce((total, item) => total + item.forwardedRequests, 0) + cors.filter(item => item.status !== null && item.status !== undefined).length,
    modelResponsesWithKnownUsage: budget.knownUsageRequestCount, successfulKnownUsageRequests: budget.reservations.filter(item => item.outcome === 'succeeded' && item.state === 'settled').length,
    requestCountMeaning: 'realModelCalls is conservative authorization/model-attempt count, not successful inference count; confirmed transport and reported-usage responses are separate. CORS failures may never forward a POST.',
    maximumCalls: 24, budgetCny: 5,
    knownInputTokens: ledgerKnownInput, knownOutputTokens: ledgerKnownOutput, usageStatus: budget.usageStatus,
    conservativeCostCny: budget.knownUsageCostCny, committedCostCny: budget.committedCny, costBasis: pricingSource.estimateBasis,
    budgetState: budget.state, budgetStopReason: budget.stopReason ?? null, transport, providerBillingIndependentlyVerified: false,
    personaContributionValidated: false, marketResearchValidated: false, thirtyResidentGate: 'not-run',
    externalDataGaps: ['真人资格分母/独立留出', '儿童本人合法口味证据', '候选点/租金/客流/竞争', '真实养宠/订单/SKU/毛利/试售'],
    limitation: '真实LLM独立回答，不是mock规则生成；受访者仍是合成画像，并不认证真实市场偏好、人格贡献或可盈利店址。未通过/未启动均保留。' };
  await save('report.json', report, true);
  const rows = reports.map(item => `| ${item.id} | ${item.questions} | ${item.started}/${item.planned} | ${item.structurallyValid}/${item.planned} | ${item.logicPassed}/${item.planned} | ${item.qualificationPassed}/${item.planned} | ${item.completeValid}/${item.planned} | ${item.notStarted} | ${item.qualityTargetMet ? 'pass' : 'fail'} |`).join('\n');
  await writeFile(path.join(directory, 'report.md'), `# 真实API虚拟社会调查测试轮\n\n${report.limitation}\n\n协议${LIVE_BUSINESS_PROTOCOL}；模型${publicModel.modelId}；seed${seed}；每场景4情景覆盖3/3/2/2，不是人口权重。\n\n| 场景 | 题数 | 实际调用/计划 | 结构/计划 | 跨题/计划 | 资格/计划 | 联合通过/计划 | 未启动 | 10人门限 |\n|---|---|---|---|---|---|---|---|---|\n${rows}\n\n全部授权请求（居民/规划/CORS）${report.realModelCalls}/24；已报告input ${ledgerKnownInput} / output ${ledgerKnownOutput} Token；按高峰非缓存价保守估算¥${report.conservativeCostCny.toFixed(6)}，承诺预留¥${report.committedCostCny.toFixed(6)}，总授权¥5；不是供应商账单。usage=${report.usageStatus}。\n\n规划候选另册，不自动应用到17/18冻结调查；CORS检查重复首个画像，不计独立居民。没有重试、补答、样本替换或30人扩容。原文、未知、失败、未启动与资格/规则冲突均保留。\n\n人格消融、语义双盲、真人校准和真实店址结论均未验。\n`, { flag: 'wx' });
  console.log(JSON.stringify({ event: 'experiment-finished', directory: path.relative(root, directory), ...report }));
}
