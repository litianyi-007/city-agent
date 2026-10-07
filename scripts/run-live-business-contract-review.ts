import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { runRole, HarnessCallError, HARNESS_NAME, type RoleModelConfig } from '../server/harness';
import { createExperimentBudget, type ExperimentBudgetGuard } from '../server/research/experiment-budget';
import { createSingleRequestRelay } from '../server/research/single-request-relay';
import { getPopulationPack, getPopulationModel } from '../server/population/service';
import { createLiveBusinessContractProtocol, checkLiveQualification, liveResponseStop, LIVE_BUSINESS_CONTRACT_PROTOCOL } from '../shared/live-business-protocol';
import { executeSurvey } from '../shared/survey-runner';
import { buildProfiles, RESIDENT_SYSTEM_PROMPT, RESIDENT_PROMPT_VERSION, residentPrompt, type SurveyRun } from '../shared/survey-engine';
import { fingerprint } from '../shared/evidence';
import { auditBusinessDemoRun } from '../shared/research-demo';
import { preflightResearchTask } from '../server/research/contract';
import { planResearch, ResearchPlanningError, RESEARCH_PLANNER_VERSION, RESEARCH_PLANNING_SYSTEM_PROMPT } from '../server/research/planning';
import { researchPlanningInputSchema } from '../shared/research-planning';
import { parseSurveyEvidence } from '../src/run-history';
import { redactKnownSecret, containsKnownSecret } from '../shared/redaction';
import { CONTRACT_TRIAL_AUTHORIZATION_ID, CONTRACT_TRIAL_MODEL, CONTRACT_TRIAL_SCOPE, assertTrialRequest,
  validateTrialAuthorization, validateTrialRegistration, type TrialRequest } from '../shared/live-trial-authorization';

// Independent 1.1 trial. The original 1.0 script, closed ledger and raw evidence remain untouched.
const root = path.resolve(import.meta.dirname, '..');
const AUTHORIZATION_ID = CONTRACT_TRIAL_AUTHORIZATION_ID;
const args = process.argv.slice(2);
if (args.some(arg => !['--execute', '--preflight'].includes(arg) && !arg.startsWith('--credential-store='))
  || args.filter(arg => arg.startsWith('--credential-store=')).length > 1) throw new Error('仅接受执行/预检和一个本机凭据目录；授权ID/预算/次数/模型不可由命令行放宽。');
if (args.filter(arg => ['--execute', '--preflight'].includes(arg)).length !== 1) throw new Error('显式选择--preflight或--execute；默认不付费。');
const execute = args.includes('--execute');
const authorizationDirectory = path.join(root, 'output/live-evaluation-authorizations', AUTHORIZATION_ID);
const planPath = path.join(authorizationDirectory, 'plan.json');
const ledgerPath = path.join(authorizationDirectory, 'budget-ledger.json');
const readFixed = async (filename: string) => {
  const target = path.join(authorizationDirectory, filename);
  if ((await lstat(target)).isSymbolicLink() || !(await realpath(target)).startsWith(authorizationDirectory + path.sep)) throw new Error('授权原件路径越界或含符号链接。');
  return JSON.parse(await readFile(target, 'utf8'));
};
const exists = async (target: string) => {
  try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
};
let authorization!: ReturnType<typeof validateTrialAuthorization>;
let plan: any;
if (execute) {
  // Receipt and exact-plan binding must already exist. This script never approves its own trial.
  plan = await readFixed('plan.json');
  authorization = validateTrialAuthorization(await readFixed('approval.json'), await readFixed('authorized-plan.json'), plan);
  if (await exists(ledgerPath) || await exists(ledgerPath + '.lock')) throw new Error('本次授权账本已创建或被占用；不重开、不补余额、不自动清锁。');
}
const publicModel = CONTRACT_TRIAL_MODEL;
const pack = getPopulationPack(); const population = getPopulationModel();
const protocols = (['child-snacks', 'pet-snacks'] as const).map(id => createLiveBusinessContractProtocol(id, publicModel));
const seed = 20261007;
const prepared = protocols.map(protocol => ({ protocol, profiles: buildProfiles(protocol.task, population, protocol.presets, 10, seed) }));
if (LIVE_BUSINESS_CONTRACT_PROTOCOL !== CONTRACT_TRIAL_SCOPE.protocolVersion || RESIDENT_PROMPT_VERSION !== CONTRACT_TRIAL_SCOPE.residentPromptVersion
  || RESEARCH_PLANNER_VERSION !== CONTRACT_TRIAL_SCOPE.plannerVersion) throw new Error('执行协议/居民Prompt/规划Prompt版本与已批准scope不同。');
const sourceHtml = await readFile(path.join(root, 'output/deepseek-pricing-contract11-source.html'));
if (!sourceHtml.includes(Buffer.from('deepseek-flash')) || !sourceHtml.includes(Buffer.from('高峰时段'))) throw new Error('定价原件未核验，不执行付费。');
const sourceHtmlSha256 = createHash('sha256').update(sourceHtml).digest('hex');
const sources = ['scripts/run-live-business-contract-review.ts', 'shared/live-trial-authorization.ts', 'shared/live-business-protocol.ts', 'shared/survey-runner.ts',
  'shared/survey-engine.ts', 'src/run-history.ts', 'server/research/planning.ts', 'shared/research-planning.ts', 'server/harness.ts',
  'server/research/experiment-budget.ts', 'server/research/single-request-relay.ts', 'shared/questionnaire-logic.ts',
  'shared/research-demo.ts', 'shared/survey-analysis.ts', 'shared/research-schema.ts', 'shared/resident-persona.ts',
  'server/population/model.ts', 'server/population/service.ts', 'scripts/population.ts', 'shared/evidence.ts', 'shared/redaction.ts', 'package.json', 'package-lock.json'];
const sourceFiles = await Promise.all(sources.map(async name => ({ path: name, sha256: createHash('sha256').update(await readFile(path.join(root, name))).digest('hex') })));
const planningInputs = Object.fromEntries(protocols.map(protocol => [protocol.id, researchPlanningInputSchema.parse({
  request: protocol.id === 'child-snacks'
    ? '我想调查滨江区小学生的零食喜好，如果开零食店，该怎么选址和选择零食品类？本次先设计成年照护者问卷，不冒充儿童本人。'
    : '我想为线上销售配合线下网点售卖宠物零食，该调查哪些区域、价位、猫犬类别？零食与主粮必须分开，没有现实订单不作真实选址结论。',
  population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' }, maxQuestions: 18,
})]));
const requests: TrialRequest[] = prepared.flatMap(({ protocol, profiles }) => {
  const residentRequests = profiles.map(profile => ({ requestId: protocol.id + '.' + profile.id, scenario: protocol.id, purpose: 'resident' as const,
    maxOutputTokens: 3000 as const, systemPrompt: RESIDENT_SYSTEM_PROMPT, userPrompt: residentPrompt(protocol.task, profile) }));
  return [...residentRequests,
    { requestId: 'planning.' + protocol.id, scenario: protocol.id, purpose: 'planning' as const, maxOutputTokens: 6000 as const,
      systemPrompt: RESEARCH_PLANNING_SYSTEM_PROMPT, userPrompt: JSON.stringify({ plannerVersion: RESEARCH_PLANNER_VERSION, ...planningInputs[protocol.id] }) },
    { requestId: 'cors.' + protocol.id, scenario: protocol.id, purpose: 'browser-cors' as const, maxOutputTokens: 3000 as const,
      systemPrompt: RESIDENT_SYSTEM_PROMPT, userPrompt: residentRequests[0].userPrompt },
  ].map(request => ({ ...request, promptHash: fingerprint({ system: request.systemPrompt, user: request.userPrompt }) }));
});
const registeredCases = prepared.map(({ protocol, profiles }) => ({ id: protocol.id, task: protocol.task, presets: protocol.presets, profiles,
  taskHash: fingerprint(protocol.task), profileHash: fingerprint(profiles), rules: protocol.logicRules, rulesHash: fingerprint(protocol.logicRules),
  qualificationProtocol: protocol.qualificationProtocol, qualificationProtocolHash: fingerprint(protocol.qualificationProtocol),
  systemPrompt: RESIDENT_SYSTEM_PROMPT, systemPromptHash: fingerprint(RESIDENT_SYSTEM_PROMPT),
  userPrompts: profiles.map(profile => residentPrompt(protocol.task, profile)) }));
const verifyCurrentRegistration = (candidate: any) => {
  validateTrialRegistration(candidate);
  if (fingerprint(candidate.sourceFiles) !== fingerprint(sourceFiles) || fingerprint(candidate.cases) !== fingerprint(registeredCases)
    || fingerprint(candidate.requests) !== fingerprint(requests) || fingerprint(candidate.planningInputs) !== fingerprint(planningInputs)
    || candidate.populationHash !== population.datasetHash || candidate.seed !== seed
    || candidate.protocolVersion !== LIVE_BUSINESS_CONTRACT_PROTOCOL || candidate.residentPromptVersion !== RESIDENT_PROMPT_VERSION
    || candidate.plannerVersion !== RESEARCH_PLANNER_VERSION || candidate.pricingSource?.sourceHtmlSha256 !== sourceHtmlSha256
    || candidate.pricingSource?.peakCacheMissInputPerMillion !== 2 || candidate.pricingSource?.peakOutputPerMillion !== 8) throw new Error('当前源文件、冻结画像、Prompt、模型、定价或抽样与绑定计划不一致；需要另行确认，不自动更新。');
};
if (!execute) {
  if (await exists(planPath)) { plan = await readFixed('plan.json'); verifyCurrentRegistration(plan); }
  else {
    plan = { schemaVersion: 'live-business-plan-1.1', id: randomUUID(), authorizationId: AUTHORIZATION_ID, registeredAt: new Date().toISOString(),
      scope: CONTRACT_TRIAL_SCOPE, requests, planningInputs, protocolVersion: LIVE_BUSINESS_CONTRACT_PROTOCOL, residentPromptVersion: RESIDENT_PROMPT_VERSION, plannerVersion: RESEARCH_PLANNER_VERSION,
      authorizationMeaning: 'Local operator-recorded explicit approval and canonical JSON content binding; not cryptographic user identity attestation or a provider-side billing cap.',
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDirty: true, sourceFiles,
      model: publicModel, modelIdentity: 'configured-selector-not-independent-weight-attestation', harness: HARNESS_NAME, populationHash: population.datasetHash,
      budgetCny: 5, maxProviderRequests: 24, seed, retries: 0, concurrency: 1, timeoutMs: 90_000, residentMaxOutputTokens: 3000, plannerMaxOutputTokens: 6000,
      answerCache: false, providerSeed: null, temperature: null, reasoning: 'DeepSeek thinking disabled',
      stopRules: ['Budget/unknown usage/storage/network failure: halt all subsequent requests.', 'First invalid/registered cross-rule/qualification conflict: stop that scenario, keep not-started denominator, no retry.', 'No resume or new ledger under same approval.'],
      plannedResidents: 20, plannedPlanningRequests: 2, plannedCorsRequests: 2,
      qualityTarget: { eachScenarioPlanned: 10, completeValid: 10, registeredHardConflicts: 0, externalValidity: 'not-tested', personaContribution: 'not-tested' },
      cases: registeredCases,
      pricingSource: { checkedAt: new Date().toISOString(), url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', sourceHtmlSha256,
        method: 'direct-official-HTML-fetched-and-table-manually-verified', modelId: publicModel.modelId, currency: 'CNY', peakCacheMissInputPerMillion: 2, peakOutputPerMillion: 8,
        offPeakCacheMissInputPerMillion: 1, offPeakOutputPerMillion: 4,
        estimateBasis: 'All input charged at peak cache-miss and output at peak rate for conservative ceiling; no cache/off-peak rebate. Not provider invoice.', sourceVersionIndependentlyAttested: false },
    };
    validateTrialRegistration(plan);
    await mkdir(authorizationDirectory, { recursive: true, mode: 0o700 });
    await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ status: 'preflight-only-plan-frozen', authorizationId: AUTHORIZATION_ID,
    planPath: path.relative(root, planPath), experimentId: plan.id, planHash: fingerprint(plan), approvalCreatedByScript: false,
    consumed: await exists(ledgerPath), scope: CONTRACT_TRIAL_SCOPE, cases: prepared.map(({ protocol, profiles }) => ({ id: protocol.id, questions: protocol.task.questionnaire.questions.length,
      count: profiles.length, personaCounts: protocol.presets.map(preset => ({ id: preset.id, count: profiles.filter(profile => profile.presetId === preset.id).length })) })),
    realModelRequests: 0 }, null, 2));
  process.exit(0);
}
verifyCurrentRegistration(plan);
const pricingSource = plan.pricingSource;
const pricing = { currency: 'CNY' as const, inputPerMillion: 2, outputPerMillion: 8, suppliedAt: pricingSource.checkedAt,
  source: pricingSource.url + '；本轮按高峰非缓存价保守估算，不是账单，忽略缓存/谷价优惠。' };
const store = path.resolve(args.find(arg => arg.startsWith('--credential-store='))?.slice('--credential-store='.length) ?? path.join(root, '.city-agent'));
// Read-only reuse of ONE already-configured agent; no store construction, migration or Key logging.
const db = new DatabaseSync(path.join(store, 'city-agent.sqlite'), { readOnly: true });
let selected: { agent: any; encrypted: string } | undefined;
try {
  for (const row of db.prepare('SELECT data,secret FROM agents WHERE secret IS NOT NULL').all() as unknown as { data: string; secret: string }[]) {
    const agent = JSON.parse(row.data);
    if (agent.role === 'researcher' && agent.enabled && agent.provider === publicModel.provider
      && agent.baseUrl.replace(/\/$/, '') === publicModel.baseUrl && agent.modelId === publicModel.modelId) { selected = { agent, encrypted: row.secret }; break; }
  }
} finally { db.close(); }
if (!selected) throw new Error('没有已配置的DeepSeek官方Flash研究员；不替换模型或充值。');
const key = await readFile(path.join(store, 'encryption.key'));
const payload = Buffer.from(selected.encrypted, 'base64');
const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12)); decipher.setAuthTag(payload.subarray(12, 28));
const apiKey = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
if (containsKnownSecret(JSON.stringify(plan), apiKey)) throw new Error('冻结计划含模型凭据；不修改绑定原件，不创建付费账本。');
const model = { ...publicModel, apiKey };
const experimentId = plan.id; const directory = path.join(root, 'output/live-proof', experimentId);
let guard: ExperimentBudgetGuard;
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory, { recursive: false });
const safe = (input: unknown) => {
  const text = redactKnownSecret(JSON.stringify(input, null, 2), apiKey);
  if (containsKnownSecret(text, apiKey)) throw new Error('公开证据仍含凭据，停止写入。'); return text + '\n';
};
const save = async (name: string, value: unknown, exclusive = false) => {
  const target = path.join(directory, name); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, safe(value), exclusive ? { flag: 'wx' } : undefined);
};
await save('plan.json', plan, true); await save('pricing-source.json', pricingSource, true);
const admitRequest = (requestId: string, purpose: TrialRequest['purpose'], agent: RoleModelConfig, system: string, user: string, maxOutputTokens: number) => {
  try {
    assertTrialRequest(plan, { requestId, purpose, model: { provider: agent.provider, baseUrl: agent.baseUrl.replace(/\/$/, ''), modelId: agent.modelId }, system, user, maxOutputTokens });
  } catch (error) {
    if (guard.snapshot().state === 'active') guard.stop('registered-request-mismatch');
    throw error;
  }
};
const transport: { requestId: string; kind: string; forwardedRequests: number; deniedRequests: number; providerStatus: number | null }[] = [];
const pendingTransports = new Set<Promise<unknown>>();
const performBoundedHarness = (requestId: string, purpose: string): typeof runRole => async (agent, system, user, signal, event, limits) => {
  const maxOutputTokens = limits?.maxOutputTokens ?? 3000;
  admitRequest(requestId, purpose as TrialRequest['purpose'], agent, system, user, maxOutputTokens);
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
  } finally {
    transport.push({ requestId, kind: purpose, ...(relay?.snapshot() ?? { forwardedRequests: 0, deniedRequests: 0, providerStatus: null }) });
    try { await relay?.close(); }
    catch (error) { if (guard.snapshot().state === 'active') guard.stop('transport-cleanup-failed'); throw error; }
  }
};
// The planner treats this adapter as injected and may return before its abort cleanup.
// Drain real transport settlement before starting another request or closing the journal.
const boundedHarness = (requestId: string, purpose: string): typeof runRole => (...parameters) => {
  const operation = performBoundedHarness(requestId, purpose)(...parameters);
  pendingTransports.add(operation);
  operation.then(() => pendingTransports.delete(operation), () => pendingTransports.delete(operation));
  return operation;
};
const drainTransports = async () => { await Promise.allSettled([...pendingTransports]); };
const reports: any[] = []; const completed: { protocol: typeof protocols[number]; run: SurveyRun }[] = [];
const stoppedScenarios = new Set<string>();
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
    if (!report.qualityTargetMet) stoppedScenarios.add(protocol.id);
    reports.push(report); completed.push({ protocol, run }); console.log(JSON.stringify({ event: 'scenario-finished', ...report }));
  }
  for (const { protocol } of prepared) {
    const filename = protocol.id === 'child-snacks' ? 'planning-child.json' : 'planning-pet.json';
    if (stoppedScenarios.has(protocol.id)) { await save(filename, { state: 'not-run', reason: 'scenario-quality-stopped', modelCalls: 0 }); continue; }
    if (guard.snapshot().state !== 'active') { await save(filename, { state: 'not-run', reason: 'budget-stopped', modelCalls: 0 }); continue; }
    try {
      const candidate = await planResearch(plan.planningInputs[protocol.id], model,
        new AbortController().signal, boundedHarness(`planning.${protocol.id}`, 'planning'));
      // The planner's injected-runner flag is deliberately preserved, with explicit trusted transport attestation alongside it.
      await save(filename, { ...candidate, controlledExecution: { transport: HARNESS_NAME, oneUpstreamRequestGuarded: true, candidateNotApplied: true } });
    } catch (error) { stoppedScenarios.add(protocol.id); await save(filename, { state: 'failed', modelCalls: guard.snapshot().reservations.filter(entry => entry.requestId === `planning.${protocol.id}`).length,
      error: redactKnownSecret(error instanceof Error ? error.message : String(error), apiKey), ...(error instanceof ResearchPlanningError ? { evidence: error.evidence } : {}) }); }
    finally { await drainTransports(); }
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (guard.snapshot().state === 'active' && completed.some(item => !stoppedScenarios.has(item.protocol.id))) {
      browser = await chromium.launch(); const page = await browser.newPage();
      await page.goto('https://litianyi-007.github.io/city-agent/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (new URL(page.url()).origin !== 'https://litianyi-007.github.io') throw new Error('公网origin不匹配，不注入Key。');
      for (const { protocol, run } of completed) {
        if (guard.snapshot().state !== 'active') break;
        if (stoppedScenarios.has(protocol.id)) { cors.push({ id: protocol.id, state: 'not-run', reason: 'scenario-quality-stopped', modelCalls: 0 }); continue; }
        const system = run.prompt.system; const user = run.prompt.users[0].text;
        admitRequest(`cors.${protocol.id}`, 'browser-cors', model, system, user, 3000);
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
  } catch (error) {
    if (guard.snapshot().state === 'active') guard.stop('browser-transport-failed');
    cors.push({ state: 'not-run', reason: redactKnownSecret(error instanceof Error ? error.message : String(error), apiKey) });
  }
  finally {
    try { await browser?.close(); }
    catch (error) { if (guard.snapshot().state === 'active') guard.stop('browser-cleanup-failed'); throw error; }
  }
  for (const { protocol } of completed) if (!cors.some(item => item.id === protocol.id)) {
    cors.push({ id: protocol.id, state: 'not-run', reason: stoppedScenarios.has(protocol.id) ? 'scenario-quality-stopped' : 'global-budget-or-transport-stopped', modelCalls: 0 });
  }
  await save('cors-checks.json', { checks: cors, note: '真实Pages origin的模型协议/CORS检查；不等于新版页面长问卷输入全流程，不增加独立居民分母。' });
} finally {
  await drainTransports();
  guard.close(); await save('budget-ledger.json', guard.snapshot());
  for (const filename of ['planning-child.json', 'planning-pet.json', 'cors-checks.json']) {
    try { await readFile(path.join(directory, filename)); } catch { await save(filename, { state: 'not-run', reason: 'experiment-stopped', modelCalls: 0 }); }
  }
  const budget = guard.snapshot();
  const ledgerKnownInput = budget.reservations.reduce((total, entry) => total + (entry.usage?.inputTokens ?? 0), 0);
  const ledgerKnownOutput = budget.reservations.reduce((total, entry) => total + (entry.usage?.outputTokens ?? 0), 0);
  const report = { schemaVersion: 'live-business-report-1.1', id: experimentId, authorizationId: AUTHORIZATION_ID, generatedAt: new Date().toISOString(),
    execution: 'real-api-synthetic-residents', mockUsed: false, model: publicModel, harness: HARNESS_NAME, planHash: fingerprint(plan), authorizationReceiptHash: fingerprint(authorization.approval), authorizationBindingHash: fingerprint(authorization.binding),
    authorizationMeaning: plan.authorizationMeaning,
    protocolVersion: LIVE_BUSINESS_CONTRACT_PROTOCOL, residentPromptVersion: RESIDENT_PROMPT_VERSION, plannerVersion: RESEARCH_PLANNER_VERSION,
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
  await writeFile(path.join(directory, 'report.md'), `# 真实API虚拟社会调查测试轮\n\n${report.limitation}\n\n协议${LIVE_BUSINESS_CONTRACT_PROTOCOL}；模型${publicModel.modelId}；seed${seed}；每场景4情景覆盖3/3/2/2，不是人口权重。\n\n| 场景 | 题数 | 实际调用/计划 | 结构/计划 | 跨题/计划 | 资格/计划 | 联合通过/计划 | 未启动 | 10人门限 |\n|---|---|---|---|---|---|---|---|---|\n${rows}\n\n全部授权请求（居民/规划/CORS）${report.realModelCalls}/24；已报告input ${ledgerKnownInput} / output ${ledgerKnownOutput} Token；按高峰非缓存价保守估算¥${report.conservativeCostCny.toFixed(6)}，承诺预留¥${report.committedCostCny.toFixed(6)}，总授权¥5；不是供应商账单。usage=${report.usageStatus}。\n\n规划候选另册，不自动应用到17/18冻结调查；CORS检查重复首个画像，不计独立居民。没有重试、补答、样本替换或30人扩容。原文、未知、失败、未启动与资格/规则冲突均保留。\n\n人格消融、语义双盲、真人校准和真实店址结论均未验。\n`, { flag: 'wx' });
  console.log(JSON.stringify({ event: 'experiment-finished', directory: path.relative(root, directory), ...report }));
}
