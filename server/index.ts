import express from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getCityProfile } from './city.js';
import { createRunner } from './orchestrator.js';
import { CityStore, StoreError } from './store.js';
import { PROVIDERS, ROLES } from './types.js';
import type { RunInput, Runner } from './types.js';
import { getPopulationModel, getPopulationOverview, getPopulationPack, getPopulationSource, getPopulationTemplate, validatePopulationIntake } from './population/service.ts';
import { preflightResearchTask, researchTaskSchema } from './research/contract.js';
import { getResearchTemplates } from './research/templates.js';
import { getResidentTemplates, residentCreateSchema, residentPatchSchema, researchProjectInputSchema } from './research/residents.js';
import { createSurveyService } from './research/surveys.js';
import { runRole } from './harness.js';
import { planResearch, ResearchPlanningError } from './research/planning.js';
import { researchPlanningInputSchema } from '../shared/research-planning.js';
import { createBusinessEvidenceTemplate, validateBusinessEvidence } from '../shared/business-evidence.js';

const agentFields = {
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  provider: z.enum(PROVIDERS),
  baseUrl: z.string().min(1).max(2048),
  modelId: z.string().trim().min(1).max(200),
  apiKey: z.string().max(8192).nullable(),
  enabled: z.boolean(),
};
const agentCreateSchema = z.object({
  ...agentFields, provider: agentFields.provider.optional(), baseUrl: agentFields.baseUrl.optional(),
  modelId: agentFields.modelId.optional(), apiKey: agentFields.apiKey.optional(),
  enabled: agentFields.enabled.optional(),
}).strict();
const agentPatchSchema = z.object(agentFields).partial().strict().refine(value => Object.keys(value).length > 0);
const runSchema = z.object({
  task: z.string().trim().min(1).max(12000),
  mode: z.enum(['demo', 'live']),
  agentIds: z.array(z.string().uuid()).length(4),
  product: z.string().trim().min(1).max(500).default('AI 生活服务会员'),
  price: z.number().finite().min(0).max(100000).default(29),
  sampleSize: z.number().int().min(30).max(600).default(120),
  seed: z.number().int().min(0).max(2147483647).default(42),
  researchSurveyId: z.string().uuid().optional(),
}).strict();
const planningRequestSchema = researchPlanningInputSchema.extend({
  agentId: z.string().uuid(), acknowledgeCost: z.literal(true),
  cancelId: z.string().uuid().optional(),
}).strict();
const planningCancelSchema = z.object({ cancelId: z.string().uuid() }).strict();
const businessEvidenceRequestSchema = z.object({ pack: z.unknown(), requirements: z.unknown().optional() }).strict();

function parameter(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') throw new StoreError('请求参数无效。');
  return value;
}

function isLoopback(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname);
}

function rejectUnsupportedAgentOptions(body: unknown): void {
  if (body && typeof body === 'object' && 'temperature' in body && body.temperature !== undefined) {
    throw new StoreError('当前 DeepSeek Harness SDK 不支持 temperature 配置。请省略此字段。');
  }
}

/** Exported app factory permits exercising the actual HTTP API without model calls. */
export function createApp(store: CityStore, suppliedRunner?: Runner, planningRunner: typeof runRole = runRole) {
  const app = express();
  const runner = suppliedRunner ?? createRunner(store);
  const surveys = createSurveyService(store);
  let planningActive = false;
  const planningJobs = new Map<string, AbortController>();
  const webPort = process.env.CITY_AGENT_WEB_PORT || '5180';
  if (!/^\d+$/.test(webPort) || Number(webPort) < 1 || Number(webPort) > 65535) throw new Error('CITY_AGENT_WEB_PORT must be a valid TCP port.');
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    let host: URL;
    try { host = new URL(`http://${request.headers.host}`); }
    catch { response.status(403).json({ error: '仅支持本机访问。' }); return; }
    if (!isLoopback(host.hostname)) {
      response.status(403).json({ error: '仅支持本机访问。' }); return;
    }
    const originHeader = request.headers.origin;
    if (originHeader) {
      let allowed = false;
      try {
        const origin = new URL(originHeader);
        allowed = ['http:', 'https:'].includes(origin.protocol) && isLoopback(origin.hostname)
          && (origin.host === host.host || ['5173', '4173', webPort].includes(origin.port));
      } catch { /* Invalid and opaque origins are denied. */ }
      if (!allowed) { response.status(403).json({ error: '不允许此来源的请求。' }); return; }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers['sec-fetch-site'] === 'cross-site') {
      response.status(403).json({ error: '不允许跨站修改。' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'city-agent', storage: 'sqlite', localOnly: true }));
  app.get('/api/city', async (_request, response) => response.json(await getCityProfile()));
  app.get('/api/population', async (_request, response) => response.json(await getPopulationOverview()));
  app.get('/api/population/pack', (_request, response) => response.json(getPopulationPack()));
  app.get('/api/population/model', (_request, response) => response.json(getPopulationModel()));
  app.get('/api/population/template', (_request, response) => response.json(getPopulationTemplate()));
  app.post('/api/population/validate', async (request, response) => response.json(await validatePopulationIntake(request.body)));
  app.get('/api/population/sources/:id', (request, response) => {
    const source = getPopulationSource(parameter(request, 'id'));
    if (!source) throw new StoreError('人口证据不存在。', 404);
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Disposition', `attachment; filename="${source.filename}"`);
    response.type('application/octet-stream').send(source.bytes);
  });

  // Read-only research intake. This is deliberately separate from /api/runs:
  // accepting a questionnaire must not silently execute the legacy price fixture.
  app.get('/api/research/templates', (_request, response) => response.json({
    schemaVersion: '1.0', stage: 'preflight', executorAvailable: false,
    templates: getResearchTemplates(),
  }));
  app.get('/api/research/business-evidence/template', (_request, response) => response.json(createBusinessEvidenceTemplate()));
  app.post('/api/research/business-evidence/validate', (request, response) => {
    const input = businessEvidenceRequestSchema.parse(request.body);
    response.json(validateBusinessEvidence(input.pack, input.requirements));
  });
  app.get('/api/research/planning/agents', (_request, response) => response.json(
    store.getAgents().filter(agent => agent.enabled && ['product', 'researcher'].includes(agent.role)),
  ));
  // One in-flight plan. cancelId is registered before the model call so POST /planning/cancel can abort the same signal Harness already honors.
  app.post('/api/research/planning/cancel', (request, response) => {
    const { cancelId } = planningCancelSchema.parse(request.body ?? {});
    const job = planningJobs.get(cancelId);
    if (!job) throw new StoreError('此规划没有正在运行的请求。', 409);
    job.abort();
    response.json({ cancelled: true, cancelId });
  });
  app.post('/api/research/planning', async (request, response) => {
    const { agentId, acknowledgeCost: _acknowledgeCost, cancelId: suppliedCancelId, ...input } = planningRequestSchema.parse(request.body);
    const agent = store.getAgent(agentId, true);
    if (!agent) throw new StoreError('规划 Agent 不存在。', 404);
    if (!agent.enabled || !['product', 'researcher'].includes(agent.role)) throw new StoreError('请选择已启用的产品或研究员 Agent。');
    if (!agent.apiKey?.trim()) throw new StoreError('规划 Agent 尚未配置 API Key；未发出模型请求。');
    if (planningActive) throw new StoreError('已有候选规划正在运行；不自动重试。', 409);
    if (suppliedCancelId && planningJobs.has(suppliedCancelId)) throw new StoreError('此规划取消编号正在使用。', 409);
    const cancelId = suppliedCancelId ?? randomUUID();
    const clientAbort = new AbortController();
    const planningAbort = new AbortController();
    const signal = AbortSignal.any([clientAbort.signal, planningAbort.signal]);
    planningActive = true;
    planningJobs.set(cancelId, planningAbort);
    const disconnect = () => { if (!response.writableEnded) clientAbort.abort(); };
    request.once('aborted', disconnect);
    response.once('close', disconnect);
    const recordId = randomUUID();
    const persist = async (record: unknown) => {
      const directory = path.join(store.dataDir, 'planning');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, `${recordId}.json`), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    };
    try {
      const pack = getPopulationPack();
      const integrity = await validatePopulationIntake(pack);
      if (!signal.aborted && integrity.status !== 'ready') throw new StoreError('冻结人口证据完整性未通过；未发出模型请求。', 409);
      const candidate = await planResearch(input, { ...agent, apiKey: agent.apiKey }, signal, planningRunner);
      if (signal.aborted) throw new ResearchPlanningError('候选规划已取消；不自动重试。', { ...candidate.evidence, state: 'cancelled', error: '候选规划已取消；不自动重试。' });
      const result = { ...candidate, recordId, preflight: preflightResearchTask(candidate.task, pack) };
      try { await persist({ schemaVersion: '1.0', recordId, result }); }
      catch {
        if (!clientAbort.signal.aborted && !planningAbort.signal.aborted) response.status(503).json({ error: '模型已经调用，但本机证据保存失败。请先导出返回证据，不要盲目重试。', code: 'planning-evidence-write-failed', recordId, result });
        return;
      }
      if (planningAbort.signal.aborted) {
        if (!clientAbort.signal.aborted) response.status(422).json({
          error: '候选规划已取消；不自动重试。', recordId,
          evidence: { ...candidate.evidence, state: 'cancelled', error: '候选规划已取消；不自动重试。' }, recorded: true,
        });
        return;
      }
      if (!clientAbort.signal.aborted) response.json(result);
    } catch (error) {
      if (!(error instanceof ResearchPlanningError)) throw error;
      let recorded = true;
      try { await persist({ schemaVersion: '1.0', recordId, evidence: error.evidence }); } catch { recorded = false; }
      if (!clientAbort.signal.aborted) response.status(error.evidence.state === 'timed-out' ? 504 : 422).json({
        error: error.message, recordId, evidence: error.evidence, recorded,
        ...(recorded ? {} : { warning: '本机证据保存失败，请导出本响应。模型可能已计费；不要盲目重试。' }),
      });
    } finally {
      request.removeListener('aborted', disconnect);
      response.removeListener('close', disconnect);
      planningJobs.delete(cancelId);
      planningActive = false;
    }
  });
  app.post('/api/research/validate', async (request, response) => {
    const task = researchTaskSchema.parse(request.body);
    const pack = getPopulationPack();
    const integrity = await validatePopulationIntake(pack);
    if (integrity.status !== 'ready') {
      response.status(409).json({
        status: 'blocked', code: 'population-evidence-unavailable',
        error: '人口证据或口径校验未通过，不能判断任务样本框是否适用。',
        executorAvailable: false, modelCalls: 0, marketResearchValidated: false,
      });
      return;
    }
    response.json(preflightResearchTask(task, pack));
  });

  app.get('/api/research/resident-templates', (_request, response) => response.json(getResidentTemplates()));
  app.get('/api/research/surveys', (_request, response) => response.json(store.listSurveyRunSummaries()));
  app.get('/api/research/surveys/:id', (request, response) => {
    const run = store.getSurveyRun(parameter(request, 'id'));
    if (!run) throw new StoreError('问卷运行不存在。', 404);
    response.json(run);
  });
  app.post('/api/research/surveys', (request, response) => response.status(202).json(surveys.start(request.body)));
  app.post('/api/research/surveys/:id/cancel', (request, response) => { surveys.cancel(parameter(request, 'id')); response.json({ cancelled: true }); });
  app.get('/api/research/resident-agents', (_request, response) => response.json(store.getResidentAgents()));
  app.post('/api/research/resident-agents', (request, response) => response.status(201).json(store.createResidentAgent(residentCreateSchema.parse(request.body))));
  app.patch('/api/research/resident-agents/:id', (request, response) => response.json(store.updateResidentAgent(parameter(request, 'id'), residentPatchSchema.parse(request.body))));
  app.post('/api/research/resident-agents/:id/clone', (request, response) => {
    z.object({}).strict().parse(request.body ?? {});
    response.status(201).json(store.cloneResidentAgent(parameter(request, 'id')));
  });
  app.delete('/api/research/resident-agents/:id', (request, response) => {
    if (!store.deleteResidentAgent(parameter(request, 'id'))) throw new StoreError('人群 Agent 预设不存在。', 404);
    response.status(204).end();
  });
  app.get('/api/research/projects', (_request, response) => response.json(store.listResearchProjects()));
  app.post('/api/research/projects', (request, response) => response.status(201).json(store.saveResearchProject(researchProjectInputSchema.parse(request.body))));
  app.put('/api/research/projects/:id', (request, response) => response.json(store.saveResearchProject(researchProjectInputSchema.parse(request.body), parameter(request, 'id'))));
  app.post('/api/research/projects/validate', async (request, response) => {
    const input = researchProjectInputSchema.parse(request.body);
    const agents = input.residentAgentIds.map(id => {
      const agent = store.getResidentAgent(id);
      if (!agent) throw new StoreError('所选人群预设不存在，请刷新后重新选择。');
      return agent;
    });
    const pack = getPopulationPack();
    const integrity = await validatePopulationIntake(pack);
    if (integrity.status !== 'ready') throw new StoreError('人口原件或口径校验失败，暂不可预检。', 409);
    const taskCheck = preflightResearchTask(input.task, pack);
    const residents = agents.map(agent => {
      const filters = [...input.task.population.filters, ...agent.population.filters];
      const unique = [...new Map(filters.map(filter => [JSON.stringify(filter), filter])).values()];
      if (unique.length > 24) throw new StoreError(`预设“${agent.name}”与问卷的合并筛选超过24项。`);
      const check = preflightResearchTask({ ...input.task, population: { ...input.task.population, filters: unique } }, pack);
      const incompatible = ['regionCode', 'period', 'unit'].some(key => agent.population[key as keyof typeof agent.population] !== input.task.population[key as keyof typeof input.task.population]);
      const missingEvidence = [...check.missingEvidence, ...(incompatible ? ['预设与调查的地区、时点或统计单位不一致；不能直接混用。'] : [])];
      return { id: agent.id, name: agent.name, enabled: agent.enabled, modelConfigured: agent.hasApiKey,
        status: check.status === 'unsupported' ? 'unsupported' : missingEvidence.length ? 'needs-data' : check.status,
        missingEvidence, warnings: check.warnings, updatedAt: agent.updatedAt };
    });
    response.json({ taskCheck, residents, executorAvailable: false, modelCalls: 0, marketResearchValidated: false,
      executionBlockers: ['本次是只读预检；请在独立问卷执行区显式启动。',
        ...(agents.length ? [] : ['尚未选择人群 Agent 预设。']),
        ...agents.filter(agent => !agent.enabled).map(agent => `预设“${agent.name}”已停用。`),
        ...agents.filter(agent => !agent.hasApiKey).map(agent => `预设“${agent.name}”尚未配置 API Key。`)] });
  });

  app.get('/api/agents', (_request, response) => response.json(store.getAgents()));
  app.post('/api/agents', (request, response) => {
    rejectUnsupportedAgentOptions(request.body);
    const input = agentCreateSchema.parse(request.body);
    response.status(201).json(store.createAgent(input));
  });
  app.patch('/api/agents/:id', (request, response) => {
    rejectUnsupportedAgentOptions(request.body);
    const input = agentPatchSchema.parse(request.body);
    response.json(store.updateAgent(parameter(request, 'id'), input));
  });
  app.delete('/api/agents/:id', (request, response) => {
    if (!store.deleteAgent(parameter(request, 'id'))) throw new StoreError('Agent 不存在。', 404);
    response.status(204).end();
  });
  app.post('/api/agents/:id/clone', (request, response) => response.status(201).json(store.cloneAgent(parameter(request, 'id'))));

  app.get('/api/runs', (_request, response) => response.json(store.listRuns()));
  app.get('/api/runs/:id', (request, response) => {
    const run = store.getRun(parameter(request, 'id'));
    if (!run) throw new StoreError('运行不存在。', 404);
    response.json(run);
  });
  app.post('/api/runs', (request, response) => {
    const input: RunInput = runSchema.parse(request.body);
    if (store.listRuns().some(run => ['queued', 'running'].includes(run.status))) {
      throw new StoreError('已有任务正在运行。请等待完成或取消后再提交。', 409);
    }
    const run = store.createRun(input);
    response.status(202).json(run);
    Promise.resolve().then(() => runner.start(run.id, run.input)).catch(() => {
      const latest = store.getRun(run.id);
      if (!latest || ['cancelled', 'completed', 'failed', 'interrupted'].includes(latest.status)) return;
      latest.status = 'failed';
      latest.finishedAt = new Date().toISOString();
      latest.error = '任务执行失败。请检查模型配置后重试。';
      store.saveRun(latest);
    });
  });
  app.post('/api/runs/:id/cancel', async (request, response) => {
    const id = parameter(request, 'id');
    const run = store.getRun(id);
    if (!run) throw new StoreError('运行不存在。', 404);
    if (!['queued', 'running'].includes(run.status)) throw new StoreError('此运行已经结束。', 409);
    await runner.cancel(id);
    const latest = store.getRun(id)!;
    if (['queued', 'running'].includes(latest.status)) {
      latest.status = 'cancelled';
      latest.finishedAt = new Date().toISOString();
      store.saveRun(latest);
    }
    response.json(store.getRun(id));
  });
  app.get('/api/runs/:id/artifacts/:name', (request, response) => {
    const id = parameter(request, 'id');
    const run = store.getRun(id);
    if (!run) throw new StoreError('运行不存在。', 404);
    const artifact = run.artifacts.find(item => item.name === parameter(request, 'name'));
    if (!artifact || !/^[a-zA-Z0-9._-]+$/.test(artifact.name)) throw new StoreError('产物不存在。', 404);
    const directory = realpathSync(store.runDir(id));
    const filename = path.resolve(directory, artifact.path);
    if (!filename.startsWith(`${directory}${path.sep}`) || !existsSync(filename)) throw new StoreError('产物不存在。', 404);
    const realFilename = realpathSync(filename);
    if (!realFilename.startsWith(`${directory}${path.sep}`) || !statSync(realFilename).isFile()) throw new StoreError('产物不存在。', 404);
    const html = path.extname(artifact.name).toLowerCase() === '.html';
    response.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-ancestors 'self'");
    response.setHeader('Content-Disposition', `${html ? 'inline' : 'attachment'}; filename="${artifact.name}"`);
    // The default data root is .city-agent, so Express's implicit dotfile deny
    // would reject every artifact. Path/realpath and manifest checks above are
    // the authority; only this exact allowlisted file is exposed.
    response.sendFile(realFilename, { dotfiles: 'allow' });
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: '接口不存在。' }));
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error: unknown, _request: Request, response: Response, _next) => {
    if (error instanceof StoreError) { response.status(error.statusCode).json({ error: error.message }); return; }
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: '输入格式无效。', fields: error.issues.map(issue => issue.path.join('.')) }); return;
    }
    const status = (error as { status?: number })?.status;
    if (status === 413) { response.status(413).json({ error: '请求超过 1 MB 大小限制。' }); return; }
    if (status === 400 || error instanceof URIError) { response.status(400).json({ error: '请求格式无效。' }); return; }
    response.status(500).json({ error: '服务内部错误。请检查本地服务状态。' });
  };
  app.use(errorHandler);
  return app;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  const store = new CityStore();
  const port = Number(process.env.PORT || 4320);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const server = createApp(store).listen(port, '127.0.0.1', () => console.log(`City Agent: http://127.0.0.1:${port}`));
  const shutdown = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
