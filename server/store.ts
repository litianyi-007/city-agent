import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PROVIDERS, ROLES } from './types.js';
import type { Agent, AgentInput, AgentPatch, AgentPublic, NormalizedRunInput, Run, RunInput } from './types.js';
import { assertPublicMetadataSafe, getResidentTemplates, residentCreateSchema, residentPatchSchema, residentPublic, residentInput, researchProjectInputSchema } from './research/residents.js';
import type { ResidentAgent, ResidentAgentInput, ResidentAgentPatch, ResidentAgentPublic, ResearchProject, ResearchProjectInput } from './research/residents.js';
import { surveyRunSummary, type SurveyRun, type SurveyRunSummary } from '../shared/survey-engine.js';
import { redactKnownSecret } from '../shared/redaction.js';

export class StoreError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'StoreError';
  }
}

interface AgentRow { data: string; secret: string | null }
interface RunRow { data: string; secrets: string }

function publicAgent(agent: Agent): AgentPublic {
  return {
    id: agent.id, name: agent.name, role: agent.role, provider: agent.provider,
    baseUrl: agent.baseUrl, modelId: agent.modelId, hasApiKey: Boolean(agent.hasApiKey),
    enabled: agent.enabled, ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
  };
}

function validateAgent(input: AgentInput): void {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) {
    throw new StoreError('Agent 名称须为 1–100 个字符。');
  }
  if (!ROLES.includes(input.role)) throw new StoreError('无效的 Agent 角色。');
  if (!PROVIDERS.includes(input.provider!)) throw new StoreError('无效的模型提供方。');
  if (typeof input.modelId !== 'string' || !input.modelId.trim() || input.modelId.length > 200) {
    throw new StoreError('模型 ID 须为 1–200 个字符。');
  }
  try {
    const url = new URL(input.baseUrl!);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new StoreError('Base URL 必须是 HTTP(S) 地址，且不能包含凭证、查询参数或片段。');
  }
  if (typeof input.enabled !== 'boolean') throw new StoreError('enabled 必须为布尔值。');
  if (input.apiKey != null && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192)) {
    throw new StoreError('API Key 格式无效。');
  }
  if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) {
    throw new StoreError('temperature 必须在 0–2 之间。');
  }
}

/** Local, single-user persistence. Encryption protects keys at rest, not from the local OS user. */
export class CityStore {
  readonly dataDir: string;
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  private readonly ownerToken = randomUUID();
  private closed = false;

  constructor(dataDir = process.env.CITY_AGENT_DATA_DIR || path.resolve('.city-agent')) {
    this.dataDir = path.resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(this.dataDir, 'encryption.key');
    if (!existsSync(keyPath)) {
      try { writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    chmodSync(keyPath, 0o600);
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('Local encryption key is invalid.');
    const dbPath = path.join(this.dataDir, 'city-agent.sqlite');
    this.db = new DatabaseSync(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS resident_agents (id TEXT PRIMARY KEY, data TEXT NOT NULL, secret TEXT);
      CREATE TABLE IF NOT EXISTS research_projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS survey_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL, secrets TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS instance_lock (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL);
    `);
    this.acquireOwnership();
    try {
      this.initialize();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private initialize(): void {
    if (!this.db.prepare("SELECT value FROM settings WHERE key = 'resident-presets-v1'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const preset of getResidentTemplates()) this.createResidentAgent(preset);
        this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('resident-presets-v1', 'true');
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (!this.db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const [role, name] of [['product', '产品经理'], ['developer', '研发工程师'], ['tester', '测试工程师'], ['researcher', '研究员']] as const) {
          this.createAgent({ name, role });
        }
        this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('seeded', 'true');
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    // A process restart cannot resume an in-flight model request safely.
    for (const survey of this.listSurveyRuns()) {
      if (survey.state !== 'running') continue;
      survey.state = 'stopped';
      survey.limitations.push('服务重启中断请求；保留最后快照及未知用量，不自动恢复或重试。');
      this.saveSurveyRun(survey);
    }
    for (const run of this.listRuns()) {
      if (run.status === 'queued' || run.status === 'running') {
        run.status = 'interrupted';
        run.finishedAt = new Date().toISOString();
        run.error = '服务重启中断了此运行。请重新提交任务。';
        for (const stage of run.stages) if (stage.status === 'running') stage.status = 'failed';
        run.events.push({ id: randomUUID(), time: run.finishedAt, type: 'warning', message: run.error });
        this.saveRun(run);
      }
    }
  }

  /** SQLite serializes acquisition, so a second server cannot interrupt live work. */
  private acquireOwnership(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owner = this.db.prepare('SELECT pid FROM instance_lock WHERE id = 1').get() as { pid: number } | undefined;
      if (owner) {
        let ownerAlive = true;
        try { process.kill(owner.pid, 0); }
        catch (error) { ownerAlive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (ownerAlive) throw new StoreError('已有 City Agent 服务正在使用此数据目录，请使用现有服务或另选 CITY_AGENT_DATA_DIR。', 409);
      }
      this.db.prepare('INSERT OR REPLACE INTO instance_lock (id, pid, token) VALUES (1, ?, ?)').run(process.pid, this.ownerToken);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  private encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  private decrypt(secret: string): string {
    const payload = Buffer.from(secret, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  }

  /** Credentials stay in the control plane; never attach them to public data. */
  private knownSecrets(extra: readonly string[] = []): string[] {
    const rows = [...this.db.prepare('SELECT secret FROM agents WHERE secret IS NOT NULL').all(),
      ...this.db.prepare('SELECT secret FROM resident_agents WHERE secret IS NOT NULL').all()] as unknown as { secret: string }[];
    return [...new Set([...extra, ...rows.map(row => this.decrypt(row.secret))].filter(Boolean))];
  }

  private assertPublicSafe(value: unknown, extra: readonly string[] = [], label = '公开配置'): void {
    try { assertPublicMetadataSafe(value, this.knownSecrets(extra), label); }
    catch (error) { throw new StoreError((error as Error).message); }
  }

  getAgents(includeSecrets = false): Agent[] {
    return (this.db.prepare('SELECT data, secret FROM agents ORDER BY rowid').all() as unknown as AgentRow[]).map(row => {
      const agent = JSON.parse(row.data) as Agent;
      if (includeSecrets && row.secret) agent.apiKey = this.decrypt(row.secret);
      if (!includeSecrets) this.assertPublicSafe(agent, [], '智能体公开配置');
      return agent;
    });
  }

  getAgent(id: string, includeSecrets = false): Agent | undefined {
    const row = this.db.prepare('SELECT data, secret FROM agents WHERE id = ?').get(id) as unknown as AgentRow | undefined;
    if (!row) return undefined;
    const agent = JSON.parse(row.data) as Agent;
    if (includeSecrets && row.secret) agent.apiKey = this.decrypt(row.secret);
    if (!includeSecrets) this.assertPublicSafe(agent, [], '智能体公开配置');
    return agent;
  }

  createAgent(input: AgentInput): AgentPublic {
    const normalized: AgentInput = {
      provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash',
      enabled: true, ...input,
    };
    validateAgent(normalized);
    const agent = publicAgent({ ...normalized, id: randomUUID(), name: normalized.name.trim(),
      modelId: normalized.modelId!.trim(), baseUrl: normalized.baseUrl!.replace(/\/+$/, ''),
      provider: normalized.provider!, enabled: normalized.enabled!, hasApiKey: Boolean(normalized.apiKey),
      apiKey: undefined,
    });
    this.assertPublicSafe(agent, normalized.apiKey ? [normalized.apiKey] : [], '智能体公开配置');
    this.db.prepare('INSERT INTO agents (id, data, secret) VALUES (?, ?, ?)')
      .run(agent.id, JSON.stringify(agent), normalized.apiKey ? this.encrypt(normalized.apiKey) : null);
    return agent;
  }

  updateAgent(id: string, patch: AgentPatch): AgentPublic {
    const existing = this.getAgent(id, true);
    if (!existing) throw new StoreError('Agent 不存在。', 404);
    const merged = { ...existing, ...patch };
    validateAgent(merged);
    const endpointChanged = merged.provider !== existing.provider || merged.baseUrl.replace(/\/+$/, '') !== existing.baseUrl;
    if (endpointChanged && patch.apiKey === undefined) merged.apiKey = undefined;
    const agent = publicAgent({ ...merged, name: merged.name.trim(), modelId: merged.modelId.trim(),
      baseUrl: merged.baseUrl.replace(/\/+$/, ''), hasApiKey: Boolean(merged.apiKey), apiKey: undefined });
    this.assertPublicSafe(agent, [existing.apiKey ?? '', merged.apiKey ?? ''], '智能体公开配置');
    this.db.prepare('UPDATE agents SET data = ?, secret = ? WHERE id = ?')
      .run(JSON.stringify(agent), merged.apiKey ? this.encrypt(merged.apiKey) : null, id);
    return agent;
  }

  deleteAgent(id: string): boolean {
    return this.db.prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0;
  }

  cloneAgent(id: string): AgentPublic {
    const agent = this.getAgent(id, true);
    if (!agent) throw new StoreError('Agent 不存在。', 404);
    return this.createAgent({ ...agent, name: `${agent.name.slice(0, 94)} 副本` });
  }

  getResidentAgents(): ResidentAgentPublic[] {
    return (this.db.prepare('SELECT data, secret FROM resident_agents ORDER BY rowid').all() as unknown as AgentRow[])
      .map(row => { const agent = { ...JSON.parse(row.data), hasApiKey: Boolean(row.secret) }; this.assertPublicSafe(agent, [], '人群公开配置'); return agent; });
  }

  getResidentAgent(id: string, includeSecrets = false): ResidentAgent | undefined {
    const row = this.db.prepare('SELECT data, secret FROM resident_agents WHERE id = ?').get(id) as unknown as AgentRow | undefined;
    if (!row) return undefined;
    const agent = { ...JSON.parse(row.data), hasApiKey: Boolean(row.secret), ...(includeSecrets && row.secret ? { apiKey: this.decrypt(row.secret) } : {}) };
    if (!includeSecrets) this.assertPublicSafe(agent, [], '人群公开配置');
    return agent;
  }

  createResidentAgent(input: ResidentAgentInput): ResidentAgentPublic {
    const normalized = residentCreateSchema.parse(input);
    const { apiKey: _key, ...publicInput } = normalized;
    this.assertPublicSafe(publicInput, normalized.apiKey ? [normalized.apiKey] : [], '人群公开配置');
    const agent = residentPublic(normalized, randomUUID(), new Date().toISOString(), Boolean(normalized.apiKey));
    this.db.prepare('INSERT INTO resident_agents (id, data, secret) VALUES (?, ?, ?)')
      .run(agent.id, JSON.stringify(agent), normalized.apiKey ? this.encrypt(normalized.apiKey) : null);
    return agent;
  }

  updateResidentAgent(id: string, input: ResidentAgentPatch): ResidentAgentPublic {
    const patch = residentPatchSchema.parse(input);
    const existing = this.getResidentAgent(id, true);
    if (!existing) throw new StoreError('人群 Agent 预设不存在。', 404);
    const merged = residentCreateSchema.parse({ ...residentInput(existing), ...patch });
    const endpointChanged = merged.provider !== existing.provider || merged.baseUrl.replace(/\/+$/, '') !== existing.baseUrl;
    // A saved credential must never follow an edited endpoint without being explicitly resubmitted.
    if (endpointChanged && patch.apiKey === undefined) merged.apiKey = null;
    const { apiKey: _key, ...publicInput } = merged;
    this.assertPublicSafe(publicInput, [existing.apiKey ?? '', merged.apiKey ?? ''], '人群公开配置');
    const agent = residentPublic(merged, id, existing.createdAt, Boolean(merged.apiKey));
    this.db.prepare('UPDATE resident_agents SET data = ?, secret = ? WHERE id = ?')
      .run(JSON.stringify(agent), merged.apiKey ? this.encrypt(merged.apiKey) : null, id);
    return agent;
  }

  cloneResidentAgent(id: string): ResidentAgentPublic {
    const existing = this.getResidentAgent(id, true);
    if (!existing) throw new StoreError('人群 Agent 预设不存在。', 404);
    return this.createResidentAgent({ ...residentInput(existing), name: `${existing.name.slice(0, 94)} 副本` });
  }

  deleteResidentAgent(id: string): boolean {
    if (this.listResearchProjects().some(project => project.residentAgentIds.includes(id))) {
      throw new StoreError('此预设仍被调查草稿引用。请先在草稿中取消选择并保存。', 409);
    }
    return this.db.prepare('DELETE FROM resident_agents WHERE id = ?').run(id).changes > 0;
  }

  listResearchProjects(): ResearchProject[] {
    return (this.db.prepare('SELECT data FROM research_projects ORDER BY rowid DESC').all() as unknown as { data: string }[])
      .map(row => { const project = JSON.parse(row.data); this.assertPublicSafe(project, [], '调查草稿'); return project; });
  }

  listSurveyRuns(): SurveyRun[] {
    return (this.db.prepare('SELECT data FROM survey_runs ORDER BY rowid DESC').all() as unknown as { data: string }[]).map(row => { const run = JSON.parse(row.data); this.assertPublicSafe(run, [], '问卷运行证据'); return run; });
  }
  getSurveyRun(id: string): SurveyRun | undefined {
    const row = this.db.prepare('SELECT data FROM survey_runs WHERE id = ?').get(id) as unknown as { data: string } | undefined;
    if (!row) return undefined;
    const run = JSON.parse(row.data); this.assertPublicSafe(run, [], '问卷运行证据'); return run;
  }
  listSurveyRunSummaries(): SurveyRunSummary[] {
    const rows = this.db.prepare(`SELECT json_extract(data, '$.id') AS id, json_extract(data, '$.state') AS state, json_extract(data, '$.mode') AS mode,
      json_extract(data, '$.startedAt') AS startedAt, json_extract(data, '$.durationMs') AS durationMs, json_extract(data, '$.task.title') AS title,
      json_extract(data, '$.task.questionnaire.id') AS questionnaireId, json_extract(data, '$.metrics') AS metrics
      FROM survey_runs ORDER BY rowid DESC`).all() as unknown as { id: string; state: string | null; mode: SurveyRun['mode']; startedAt: string; durationMs: number; title: string; questionnaireId: string; metrics: string }[];
    return rows.map(row => {
      const summary = surveyRunSummary({ id: row.id, ...(row.state ? { state: row.state as SurveyRun['state'] } : {}), mode: row.mode, startedAt: row.startedAt, durationMs: row.durationMs,
        task: { title: row.title, questionnaire: { id: row.questionnaireId } }, metrics: typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics });
      this.assertPublicSafe(summary, [], '问卷运行摘要');
      return summary;
    });
  }
  saveSurveyRun(run: SurveyRun): void {
    this.assertPublicSafe(run, [], '问卷运行证据');
    this.db.prepare('INSERT INTO survey_runs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(run.id, JSON.stringify(run));
  }

  saveResearchProject(input: ResearchProjectInput, id?: string): ResearchProject {
    const normalized = researchProjectInputSchema.parse(input);
    this.assertPublicSafe(normalized, [], '调查草稿');
    if (normalized.residentAgentIds.some(agentId => !this.getResidentAgent(agentId))) throw new StoreError('所选人群预设不存在，请刷新后重新选择。');
    const existing = id ? this.listResearchProjects().find(project => project.id === id) : undefined;
    if (id && !existing) throw new StoreError('调查草稿不存在。', 404);
    const now = new Date().toISOString();
    const project: ResearchProject = { ...normalized, id: existing?.id ?? randomUUID(), stage: 'draft', createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.db.prepare('INSERT INTO research_projects (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(project.id, JSON.stringify(project));
    return project;
  }

  createRun(input: RunInput): Run {
    if (typeof input.task !== 'string' || !input.task.trim() || input.task.length > 12000) {
      throw new StoreError('任务须为 1–12000 个字符。');
    }
    if (!['demo', 'live'].includes(input.mode)) throw new StoreError('无效的运行模式。');
    const normalized: NormalizedRunInput = {
      task: input.task.trim(), mode: input.mode, agentIds: input.agentIds,
      product: input.product?.trim() ?? 'AI 生活服务会员', price: input.price ?? 29,
      sampleSize: input.sampleSize ?? 120, seed: input.seed ?? 42,
      ...(input.researchSurveyId ? { researchSurveyId: input.researchSurveyId } : {}),
    };
    if (!normalized.product || normalized.product.length > 500) throw new StoreError('调研商品须为 1–500 个字符。');
    if (!Number.isFinite(normalized.price) || normalized.price < 0 || normalized.price > 100000) throw new StoreError('商品价格须在 0–100000 之间。');
    if (!Number.isInteger(normalized.sampleSize) || normalized.sampleSize < 30 || normalized.sampleSize > 600) throw new StoreError('调研样本数须为 30–600 的整数。');
    if (!Number.isInteger(normalized.seed) || normalized.seed < 0 || normalized.seed > 2147483647) throw new StoreError('随机种子须为 0–2147483647 的整数。');
    if (!Array.isArray(input.agentIds) || input.agentIds.length !== ROLES.length || new Set(input.agentIds).size !== ROLES.length) {
      throw new StoreError('每次运行必须选择 4 个 Agent，每种角色各 1 个。');
    }
    const agents = input.agentIds.map(id => this.getAgent(id, true));
    if (agents.some(agent => !agent || !agent.enabled)) throw new StoreError('所选 Agent 不存在或已停用。');
    const selected = agents as Agent[];
    if (new Set(selected.map(agent => agent.role)).size !== ROLES.length) throw new StoreError('产品、研发、测试、研究员每种角色必须各选 1 个。');
    const now = new Date().toISOString();
    const questionnaireSurvey = input.researchSurveyId ? this.getSurveyRun(input.researchSurveyId) : undefined;
    if (input.researchSurveyId && (input.mode !== 'live' || !questionnaireSurvey || questionnaireSurvey.state !== 'completed' || questionnaireSurvey.metrics.valid < 1)) throw new StoreError('问卷交付须选择已完成且有有效答卷的运行，并使用四角色真实模式。');
    this.assertPublicSafe({ normalized, questionnaireSurvey, agentSnapshot: selected.map(publicAgent) }, selected.flatMap(agent => agent.apiKey ? [agent.apiKey] : []), '任务及冻结快照');
    const run: Run = {
      id: randomUUID(), task: normalized.task, mode: normalized.mode, input: normalized, status: 'queued', createdAt: now,
      stages: ROLES.map(role => ({ role, status: 'pending', output: '', attempt: 0, agentId: selected.find(agent => agent.role === role)!.id })),
      events: [{ id: randomUUID(), time: now, type: 'info', message: '任务已进入队列。' }],
      artifacts: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: null },
      agentSnapshot: selected.map(publicAgent),
      ...(questionnaireSurvey ? { questionnaireSurvey: structuredClone(questionnaireSurvey) } : {}),
    };
    const secrets = Object.fromEntries(selected.filter(agent => agent.apiKey).map(agent => [agent.id, agent.apiKey]));
    this.db.prepare('INSERT INTO runs (id, data, secrets) VALUES (?, ?, ?)')
      .run(run.id, JSON.stringify(run), this.encrypt(JSON.stringify(secrets)));
    return run;
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT data FROM runs WHERE id = ?').get(id) as unknown as RunRow | undefined;
    if (!row) return undefined;
    const run = JSON.parse(row.data) as Run;
    this.assertPublicSafe(run, this.getRunAgents(id, true).flatMap(agent => agent.apiKey ? [agent.apiKey] : []), '运行证据');
    return run;
  }

  listRuns(): Run[] {
    return (this.db.prepare('SELECT data FROM runs ORDER BY rowid DESC').all() as unknown as RunRow[])
      .map(row => { const run = JSON.parse(row.data) as Run; this.assertPublicSafe(run, this.getRunAgents(run.id, true).flatMap(agent => agent.apiKey ? [agent.apiKey] : []), '运行证据'); return run; });
  }

  getRunAgents(id: string, includeSecrets = false): Agent[] {
    const row = this.db.prepare('SELECT data, secrets FROM runs WHERE id = ?').get(id) as unknown as RunRow | undefined;
    if (!row) throw new StoreError('运行不存在。', 404);
    const run = JSON.parse(row.data) as Run;
    const secrets = JSON.parse(this.decrypt(row.secrets)) as Record<string, string>;
    if (!includeSecrets) { this.assertPublicSafe(run.agentSnapshot, Object.values(secrets), '冻结智能体快照'); return run.agentSnapshot; }
    return run.agentSnapshot.map(agent => ({ ...agent, ...(secrets[agent.id] ? { apiKey: secrets[agent.id] } : {}) }));
  }

  /** Redact secret values and key fields before persisting model-controlled output. */
  saveRun(run: Run): void {
    const original = this.getRun(run.id);
    if (!original) throw new StoreError('运行不存在。', 404);
    const secrets = this.getRunAgents(run.id, true).flatMap(agent => agent.apiKey ? [agent.apiKey] : []);
    this.assertPublicSafe({ input: original.input, agentSnapshot: original.agentSnapshot, questionnaireSurvey: run.questionnaireSurvey }, secrets, '冻结运行快照');
    const clean = (value: unknown): unknown => {
      if (typeof value === 'string') return secrets.reduce((text, secret) => redactKnownSecret(text, secret), value);
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['apikey', 'api_key', 'authorization', 'secret'].includes(key.toLowerCase()))
        .map(([key, entry]) => [key, clean(entry)]));
      return value;
    };
    const serialized = JSON.stringify(clean({ ...run, input: original.input, agentSnapshot: original.agentSnapshot }));
    const safe = JSON.parse(secrets.reduce((text, secret) => redactKnownSecret(text, secret), serialized)) as Run;
    this.assertPublicSafe(safe, secrets, '运行证据');
    this.db.prepare('UPDATE runs SET data = ? WHERE id = ?').run(JSON.stringify(safe), run.id);
  }

  runDir(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id) || !this.getRun(id)) throw new StoreError('运行不存在。', 404);
    const runDirectory = path.join(this.dataDir, 'runs', id);
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    return runDirectory;
  }

  close(): void {
    if (this.closed) return;
    this.db.prepare('DELETE FROM instance_lock WHERE id = 1 AND token = ?').run(this.ownerToken);
    this.db.close();
    this.closed = true;
  }
}

export { CityStore as Store };
