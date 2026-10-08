import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRODUCTION_DEFAULT_MODEL_ID, PRODUCTION_ROLES, PRODUCTION_ROLE_LABELS, productionAgentInputSchema, productionAgentPatchSchema, type ProductionAgent, type ProductionAgentInput, type ProductionRun } from '../../shared/production-schema.js';
import { DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL_ID, jevConfigPatchSchema, type JevConfig, type JevPublicConfig, type SecretJevConfig } from '../../shared/jev-schema.js';

export type SecretAgent = ProductionAgent & { apiKey?: string };
interface StoredAgent { public: ProductionAgent; secret?: string; }
interface StoredJev { public: JevConfig; secret?: string; }
interface State { version: 1; agents: StoredAgent[]; runs: ProductionRun[]; snapshots: Record<string, StoredAgent[]>; jev?: StoredJev; jevSnapshots?: Record<string, StoredJev>; jevBenchmarks?: unknown[]; }
export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const STUDY_PUBLIC_CONTEXT = ['loopback-engineering', 'real-provider', 'localFixtureHttpAttempts', 'actualProviderHttpAttempts',
  'single-new-study-no-auto-resume', 'frozenStudySha256', 'verifier-study-control-v1', 'verifier-study-source-v2', 'verifier-study-source-v3', 'verifier-study-source-v4', 'verifier-study-source-v5',
  'estimatedBillingOnlyAcknowledged', 'jevOutputObservationOnlyAcknowledged', 'configurationSha256', 'ledgerTerminalPersisted'];

/** Separate private store; parent CityStore supplies the single-process owner lock. */
export class ProductionStore {
  readonly directory: string;
  private key: Buffer;
  private state: State;
  constructor(dataDir: string) {
    this.directory = path.join(dataDir, 'production');
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink()) throw new Error('生产数据目录不得为符号链接');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700);
    const keyPath = path.join(this.directory, 'encryption.key');
    if (existsSync(keyPath) && lstatSync(keyPath).isSymbolicLink()) throw new Error('生产密钥文件不得为符号链接');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    this.key = readFileSync(keyPath); if (this.key.length !== 32) throw new Error('生产加密密钥损坏'); chmodSync(keyPath, 0o600);
    const statePath = path.join(this.directory, 'state.json');
    if (existsSync(statePath) && lstatSync(statePath).isSymbolicLink()) throw new Error('生产状态文件不得为符号链接');
    if (existsSync(statePath)) {
      this.state = JSON.parse(readFileSync(statePath, 'utf8')) as State;
      if (this.state.version !== 1 || !Array.isArray(this.state.agents) || !Array.isArray(this.state.runs) || !this.state.snapshots) throw new Error('不支持或损坏的生产状态');
      for (const run of this.state.runs) if (['running', 'queued'].includes(run.status)) { run.status = 'interrupted'; run.error = '服务重启导致中断；不会自动重复付费请求。'; run.finishedAt = new Date().toISOString(); }
      for (const entry of this.state.jevBenchmarks ?? []) { const benchmark = entry as { status: string; error?: string; finishedAt?: string; usage?: unknown }; if (['running', 'queued'].includes(benchmark.status)) { benchmark.status = 'failed'; benchmark.error = '服务重启导致基准中断；不自动重复请求。未完成调用用量 unknown。'; benchmark.finishedAt = new Date().toISOString(); benchmark.usage = { inputTokens: null, outputTokens: null, estimatedCost: null, providerRequests: null, complete: false, currency: 'USD' }; } }
    } else {
      this.state = { version: 1, agents: [], runs: [], snapshots: {} };
      for (const role of PRODUCTION_ROLES) { const publicAgent: ProductionAgent = { id: randomUUID(), name: PRODUCTION_ROLE_LABELS[role], role, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: PRODUCTION_DEFAULT_MODEL_ID, enabled: true, hasApiKey: false }; this.state.agents.push({ public: publicAgent }); }
    }
    this.persist();
  }
  private encrypt(secret: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'); }
  private decrypt(secret?: string) { if (!secret) return undefined; const encoded = Buffer.from(secret, 'base64'); const cipher = createDecipheriv('aes-256-gcm', this.key, encoded.subarray(0, 12)); cipher.setAuthTag(encoded.subarray(12, 28)); return Buffer.concat([cipher.update(encoded.subarray(28)), cipher.final()]).toString('utf8'); }
  private persist() { const temporary = path.join(this.directory, `state.${randomUUID()}.tmp`); writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600, flag: 'wx' }); renameSync(temporary, path.join(this.directory, 'state.json')); }
  private publicCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
  private assertCredentialContext(secret: string | null | undefined, extra: string[] = []) {
    if (!secret) return;
    const publicAgents = [...this.state.agents, ...Object.values(this.state.snapshots).flat()].flatMap(agent => [agent.public.id, agent.public.name, agent.public.baseUrl, agent.public.modelId]);
    if ([...extra, ...publicAgents, ...this.state.runs.map(run => run.id), JEV_ENDPOINT, JEV_MODEL_ID, ...STUDY_PUBLIC_CONTEXT].some(value => value.includes(secret))) throw new Error('API Key 不得包含在公开标识、模型、服务地址、运行 ID 或评估契约中');
  }
  private assertPublicMetadata(values: string[]) { if (values.some(value => this.redact(value) !== value)) throw new Error('公开 Agent 名称、模型及服务地址不得包含已配置 API Key'); }
  agents() { return this.state.agents.map(agent => this.publicCopy(agent.public)); }
  /** Private control-plane equality token, never an API/ledger field. Includes
   * encrypted credential generations so even same-public-config key rotation
   * invalidates a prepared study, without decrypting or exporting a Key hash. */
  studyConfigurationIdentity(agentId: string): string {
    const agent = this.state.agents.find(value => value.public.id === agentId);
    if (!agent) throw new Error('Agent 不存在');
    return createHmac('sha256', this.key).update(JSON.stringify({ agent, jev: this.state.jev ?? null })).digest('hex');
  }
  /** Detect public-text collisions with legacy configured credentials
   * WITHOUT decrypting them. Re-encrypt only already-public candidate strings
   * using each stored IV and compare authenticated bytes; never export a Key
   * digest or use this as an authorization test. No general encoding claim. */
  assertStudyPublicSafe(value: unknown): void {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('评估公开数据无效或超限');
    const publicStrings = new Set(text.split(/[\s"'\\]+/));
    let nodes = 0;
    const collect = (current: unknown, depth: number) => {
      if (++nodes > 100000 || depth > 40) throw new Error('评估公开数据结构超限');
      if (typeof current === 'string') { publicStrings.add(current); return; }
      if (typeof current === 'number') { publicStrings.add(JSON.stringify(current)); return; }
      if (current && typeof current === 'object') for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
        if (descriptor.get || descriptor.set) throw new Error('评估公开数据不可包含访问器');
        publicStrings.add(name); collect(descriptor.value, depth + 1);
      }
    };
    // JSON serialization escapes quotes/backslashes. Inspect decoded values
    // AND property names so legacy escaped credentials cannot hide there.
    collect(value, 0);
    const runs = [...publicStrings].map(part => Buffer.from(part, 'utf8')).filter(part => part.length >= 16);
    const encryptedSecrets = new Set([...this.state.agents, ...Object.values(this.state.snapshots).flat(),
      ...(this.state.jev ? [this.state.jev] : []), ...Object.values(this.state.jevSnapshots ?? {})].flatMap(entry => entry.secret ? [entry.secret] : []));
    let scanWork = 0; let cryptoWork = 0;
    for (const secret of encryptedSecrets) {
      const encoded = Buffer.from(secret, 'base64');
      const length = encoded.length - 28;
      if (length < 16 || length > 500) throw new Error('旧凭据格式需先在页面重新设置');
      const candidates = new Set(runs.flatMap(part => {
        const result: string[] = [];
        for (let index = 0; index + length <= part.length; index++) {
          if (++scanWork > 100000) throw new Error('评估凭据碰撞检查超限，请精简配置');
          result.push(part.subarray(index, index + length).toString('base64'));
        }
        return result;
      }));
      for (const encodedCandidate of candidates) {
        if (++cryptoWork > 100000) throw new Error('评估凭据碰撞检查超限，请精简配置');
        const candidate = Buffer.from(encodedCandidate, 'base64');
        const cipher = createCipheriv('aes-256-gcm', this.key, encoded.subarray(0, 12));
        const encrypted = Buffer.concat([cipher.update(candidate), cipher.final()]);
        if (encrypted.equals(encoded.subarray(28)) && cipher.getAuthTag().equals(encoded.subarray(12, 28))) throw new Error('凭据与评估公开契约冲突，请在页面轮换');
      }
    }
  }
  jevConfig(): JevPublicConfig { const config = this.state.jev ?? { public: DEFAULT_JEV_CONFIG }; return { ...this.publicCopy(config.public), hasApiKey: Boolean(config.secret) }; }
  secretJevConfig(runId?: string): SecretJevConfig { const config = (runId ? this.state.jevSnapshots?.[runId] : this.state.jev) ?? { public: DEFAULT_JEV_CONFIG }; return { ...this.publicCopy(config.public), apiKey: this.decrypt(config.secret) }; }
  patchJevConfig(input: unknown) { const parsed = jevConfigPatchSchema.parse(input); const patch = Object.fromEntries(Object.entries(parsed).filter(([field]) => Object.hasOwn(input as object, field))) as typeof parsed; const { apiKey, ...config } = patch; this.assertCredentialContext(apiKey); const old = this.state.jev ?? { public: DEFAULT_JEV_CONFIG }; this.state.jev = { public: { ...old.public, ...config }, secret: apiKey === undefined ? old.secret : apiKey ? this.encrypt(apiKey) : undefined }; this.persist(); return this.jevConfig(); }
  jevBenchmarks() { return this.publicCopy(this.state.jevBenchmarks ?? []); }
  saveJevBenchmark(value: unknown) { const safe = this.sanitize(value) as { id?: string }; const list = this.state.jevBenchmarks ??= []; const index = list.findIndex(item => (item as { id?: string }).id === safe.id); if (index < 0) list.push(this.publicCopy(safe)); else list[index] = this.publicCopy(safe); this.persist(); }
  secretAgents(ids: string[]): SecretAgent[] { return ids.map(id => { const agent = this.state.agents.find(value => value.public.id === id); if (!agent) throw new Error(`Agent 不存在：${id}`); return { ...this.publicCopy(agent.public), apiKey: this.decrypt(agent.secret) }; }); }
  runAgents(id: string): SecretAgent[] { return (this.state.snapshots[id] ?? []).map(agent => ({ ...this.publicCopy(agent.public), apiKey: this.decrypt(agent.secret) })); }
  addAgent(input: ProductionAgentInput) { const parsed = productionAgentInputSchema.parse(input); const { apiKey, pricing, ...config } = parsed; this.assertCredentialContext(apiKey, [config.name, config.baseUrl, config.modelId]); this.assertPublicMetadata([config.name, config.baseUrl, config.modelId]); const publicAgent: ProductionAgent = { id: randomUUID(), ...config, ...(pricing ? { pricing } : {}), hasApiKey: Boolean(apiKey) }; this.state.agents.push({ public: publicAgent, ...(apiKey ? { secret: this.encrypt(apiKey) } : {}) }); this.persist(); return this.publicCopy(publicAgent); }
  patchAgent(id: string, input: unknown) {
    const parsed = productionAgentPatchSchema.parse(input); const patch = Object.fromEntries(Object.entries(parsed).filter(([field]) => Object.hasOwn(input as object, field))) as typeof parsed; const agent = this.state.agents.find(value => value.public.id === id); if (!agent) throw new Error('Agent 不存在');
    const endpointChanged = (patch.provider !== undefined && patch.provider !== agent.public.provider) || (patch.baseUrl !== undefined && patch.baseUrl !== agent.public.baseUrl);
    const { apiKey, pricing, ...config } = patch;
    const effectiveSecret = apiKey === undefined && !endpointChanged ? this.decrypt(agent.secret) : apiKey;
    this.assertCredentialContext(effectiveSecret, [config.name ?? agent.public.name, config.baseUrl ?? agent.public.baseUrl, config.modelId ?? agent.public.modelId]);
    this.assertPublicMetadata([config.name ?? agent.public.name, config.baseUrl ?? agent.public.baseUrl, config.modelId ?? agent.public.modelId]);
    agent.public = { ...agent.public, ...config };
    if (pricing !== undefined) { if (pricing) agent.public.pricing = pricing; else delete agent.public.pricing; }
    if (apiKey !== undefined || endpointChanged) agent.secret = apiKey ? this.encrypt(apiKey) : undefined;
    agent.public.hasApiKey = Boolean(agent.secret); this.persist(); return this.publicCopy(agent.public);
  }
  cloneAgent(id: string) { const source = this.secretAgents([id])[0]; const { id: _, hasApiKey: __, ...config } = source; return this.addAgent({ ...config, name: `${source.name} 副本` }); }
  deleteAgent(id: string) { if (!this.state.agents.some(agent => agent.public.id === id)) throw new Error('Agent 不存在'); this.state.agents = this.state.agents.filter(agent => agent.public.id !== id); this.persist(); }
  redact(value: string, runId?: string) {
    const agents = [...this.state.agents, ...(runId ? this.state.snapshots[runId] ?? [] : Object.values(this.state.snapshots).flat()), ...(this.state.jev ? [this.state.jev] : []), ...Object.values(this.state.jevSnapshots ?? {})];
    const variants = new Set<string>();
    for (const agent of agents) {
      const secret = this.decrypt(agent.secret); if (!secret) continue;
      // Legacy persisted credentials may contain JSON-significant characters.
      // Raw model JSON and nested JSON strings must not evade literal masking.
      let encoded = secret;
      for (let depth = 0; depth <= 2; depth++) { variants.add(encoded); encoded = JSON.stringify(encoded).slice(1, -1); }
    }
    let result = value; for (const secret of [...variants].sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]'); return result;
  }
  sanitize<T>(value: T, runId?: string): T { if (typeof value === 'string') return this.redact(value, runId) as T; if (Array.isArray(value)) return value.map(item => this.sanitize(item, runId)) as T; if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.redact(key, runId), this.sanitize(item, runId)])) as T; return value; }
  save(run: ProductionRun) { const index = this.state.runs.findIndex(value => value.id === run.id); if (index >= 0) run.interventions = [...new Map([...this.state.runs[index].interventions, ...run.interventions].map(item => [`${item.time}:${item.type}`, item])).values()]; const safe = this.publicCopy(this.sanitize(run, run.id)); if (index < 0) this.state.runs.push(safe); else this.state.runs[index] = safe; this.persist(); }
  addRun(run: ProductionRun, ids: string[]) { this.state.snapshots[run.id] = ids.map(id => { const agent = this.state.agents.find(value => value.public.id === id); if (!agent) throw new Error('Agent 不存在'); return this.publicCopy(agent); }); if (run.jevSnapshot && this.state.jev) (this.state.jevSnapshots ??= {})[run.id] = this.publicCopy(this.state.jev); this.save(run); }
  runs() { return this.publicCopy(this.state.runs).reverse(); }
  run(id: string) { const run = this.state.runs.find(value => value.id === id); return run && this.publicCopy(run); }
  artifactDirectory(runId: string) { if (!/^[a-f0-9-]{36}$/.test(runId) || !this.run(runId)) throw new Error('运行不存在'); const base = path.join(this.directory, 'artifacts'); if (existsSync(base) && lstatSync(base).isSymbolicLink()) throw new Error('产物基目录不得为符号链接'); const directory = path.join(base, runId); if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('产物目录不得为符号链接'); mkdirSync(directory, { recursive: true, mode: 0o700 }); const relative = path.relative(realpathSync(this.directory), realpathSync(directory)); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('产物目录越界'); return directory; }
  writeArtifact(runId: string, name: string, value: string) { if (!['index.html', 'scene.json', 'camera-runtime-manifest.json', 'delivery-manifest.json', 'evidence.json'].includes(name)) throw new Error('产物名称不合法'); const directory = this.artifactDirectory(runId); const file = path.join(directory, name); if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('产物不得为符号链接'); writeFileSync(file, this.redact(value, runId), { mode: 0o600 }); }
  readArtifact(runId: string, name: string) { const run = this.run(runId); if (!run || !run.artifacts.some(artifact => artifact.name === name)) throw new Error('产物不存在'); const directory = this.artifactDirectory(runId); const file = path.join(directory, name); const relative = path.relative(realpathSync(directory), realpathSync(file)); if (relative.startsWith('..') || path.isAbsolute(relative) || lstatSync(file).isSymbolicLink()) throw new Error('产物路径越界'); return readFileSync(file, 'utf8'); }
}
