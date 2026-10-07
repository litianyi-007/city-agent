import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { verifierStudyPrepareRequestSchema, verifierStudyStartRequestSchema, verifierStudyPublicRunSchema, verifierStudyPreparationSchema,
  verifierStudySummarySchema, type VerifierStudyPreparation, type VerifierStudyPublicRun } from '../../shared/verifier-study-control-schema.js';
import type { ProductionStore } from './store.js';
import { prepareObservedVerifierStudyPlan, type ObservedVerifierStudyPlan, type ObservedStudyConsent } from './verifier-study-observed-policy.js';
import { snapshotVerifierStudySource, assertVerifierStudySourceFresh } from './verifier-study-source.js';
import { createVerifierStudyTransport } from './verifier-study-transport.js';
import { runObservedVerifierStudy, type ObservedStudySummary } from './verifier-study.js';
import { VerifierStudyLedger } from './verifier-study-ledger.js';
import { createVerifierStudyEngineeringFixture, verifierStudyEngineeringConfiguration } from './verifier-study-engineering-fixture.js';
import { verifierStudyPublicConfiguration } from './verifier-study-preflight.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import type { VerifierStudyTransport } from './verifier-study-transport.js';

const TTL_MS = 15 * 60_000; const UUID = z.string().uuid(); const BOOT_ID = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = <T>(value: T): T => structuredClone(value);
const nullProgress = () => ({ ledgerEvents: null, decisions: null, calls: null, oracles: null });
type Store = Pick<ProductionStore, 'agents' | 'jevConfig' | 'secretAgents' | 'secretJevConfig' | 'studyConfigurationIdentity'>
  & { assertStudyPublicSafe?: (value: unknown) => void };
interface Preparation { public: VerifierStudyPreparation; plan: ObservedVerifierStudyPlan; bootId: string; configurationIdentity: string; verifierAgentId: string | null; consumed: boolean; }
export interface VerifierStudyControllerOptions {
  directory: string; bootId: string; assertExecutionFresh: () => void; isOtherBusy: () => boolean; store: Store;
  /** Trusted constructor-only engineering seam, never an API option. Cannot
   * execute real mode or turn injected observations into model evidence. */
  engineeringTestExecutor?: (context: { directory: string; plan: ObservedVerifierStudyPlan; consent: ObservedStudyConsent;
    signal: AbortSignal; assertFresh: () => void }) => Promise<ObservedStudySummary>;
  /** Trusted engineering persistence fault only; cannot be supplied by requests,
   * and is never invoked in real mode. */
  engineeringPersistFault?: (phase: 'terminal-directory-sync') => void;
}
const consentSchema = z.object({ id: UUID, frozenStudySha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['granted', 'engineering-only']),
  scope: z.literal('single-new-study-no-auto-resume'), approvedAt: z.string().datetime(), estimatedBillingOnlyAcknowledged: z.literal(true),
  jevOutputObservationOnlyAcknowledged: z.literal(true) }).strict();
const grantSchema = z.object({ version: z.literal('verifier-study-control-v1'), preparationId: UUID, run: verifierStudyPublicRunSchema, consent: consentSchema,
  frozenPlan: z.record(z.string(), z.unknown()) }).strict();
const runningSchema = z.object({ version: z.literal('verifier-study-control-v1'), grantSha256: z.string().regex(/^[a-f0-9]{64}$/), run: verifierStudyPublicRunSchema }).strict();
const confirmationSchema = z.object({ version: z.literal('verifier-study-terminal-confirmation-v1'), runId: UUID,
  directorySha256: z.string().regex(/^[a-f0-9]{64}$/), grantSha256: z.string().regex(/^[a-f0-9]{64}$/), terminalSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Defensive local filesystem checks, not a hostile-user sandbox or signed
 * audit. Never follows symlinks, overwrites a prior record, resumes or replays. */
function safeDirectory(directory: string, create: boolean) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory || directory === path.parse(directory).root || directory.includes('\0')) throw new Error('Invalid study control directory');
  let next = path.parse(directory).root; let created = false;
  for (const part of directory.slice(next.length).split(path.sep).filter(Boolean)) {
    next = path.join(next, part);
    if (!existsSync(next)) { if (!create || next !== directory) throw new Error('Study parent directory unavailable'); mkdirSync(next, { mode: 0o700 }); created = true; }
    const stat = lstatSync(next);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(next) !== next) throw new Error('Study directory must be independent without symlinks');
  }
  const stat = lstatSync(directory);
  if ((stat.mode & 0o777) !== 0o700 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Study directory must be private and owned');
  if (created) { const parent = openSync(path.dirname(directory), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); } }
}
function safeRead(file: string): unknown {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1024 * 1024 || (before.mode & 0o777) !== 0o600 || (process.getuid && before.uid !== process.getuid())) throw new Error('Invalid study control evidence');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new Error('Study control evidence changed');
    const bytes = readFileSync(fd); if (bytes.length !== opened.size || fstatSync(fd).mtimeMs !== opened.mtimeMs || lstatSync(file).ino !== opened.ino) throw new Error('Study control evidence changed');
    const text = bytes.toString('utf8'); if (!Buffer.from(text).equals(bytes) || !text.endsWith('\n')) throw new Error('Truncated study control evidence');
    return JSON.parse(text);
  } finally { closeSync(fd); }
}
function persist(directory: string, name: 'consent-consumed.json' | 'running.json' | 'terminal.json' | 'terminal.confirmed.json' | 'engineering-receipt.json', value: unknown, beforeDirectorySync?: () => void) {
  safeDirectory(directory, false); const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Study control evidence exceeds size limit');
  const fd = openSync(path.join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  const dir = openSync(directory, 'r'); try { beforeDirectorySync?.(); fsyncSync(dir); } finally { closeSync(dir); }
}
function synchronous(check: () => unknown) {
  const value = check(); if (value !== undefined) { if (value && typeof (value as { then?: unknown }).then === 'function') void Promise.resolve(value).catch(() => undefined); throw new Error('Study execution guard must synchronously deny or return undefined'); }
}
function publicPlan(plan: ObservedVerifierStudyPlan): VerifierStudyPreparation['plan'] {
  const { version, configuration, limits, reservations, poolIds, strategies, accountingBoundary, httpBoundary, candidateRandomization } = plan;
  return verifierStudyPreparationSchema.shape.plan.parse({ version, configuration, limits, reservations, poolIds, strategies, accountingBoundary, httpBoundary, candidateRandomization });
}

/** Single-boot control plane. Preparation has no authority, no secret reads and
 * no model dispatch. Acknowledged one-use consent plus running intent are fsynced
 * before the native delegate may read credentials or create its own ledger. */
export class VerifierStudyController {
  private readonly preparations = new Map<string, Preparation>();
  private readonly runs = new Map<string, VerifierStudyPublicRun>();
  private active: { id: string; controller: AbortController; task: Promise<void> } | null = null;
  private closed = false;
  constructor(private readonly options: VerifierStudyControllerOptions) {
    BOOT_ID.parse(options.bootId); if (typeof options.assertExecutionFresh !== 'function' || typeof options.isOtherBusy !== 'function') throw new Error('Missing study guards');
    safeDirectory(options.directory, true); this.recover();
  }
  get busy() { return this.active !== null; }
  private assertOpen() { if (this.closed) throw new Error('Study controller closed'); }
  private assertIdle() { this.assertOpen(); if (this.busy || this.options.isOtherBusy()) throw new Error('Another production operation is active'); }
  private assertPublicSafe(value: unknown) {
    if (this.options.store.assertStudyPublicSafe) synchronous(() => this.options.store.assertStudyPublicSafe!(value));
  }
  private recover() {
    const entries = readdirSync(this.options.directory); if (entries.length > 1000) throw new Error('Study history requires explicit archival before further runs');
    for (const id of entries) {
      if (!UUID.safeParse(id).success) continue; const directory = path.join(this.options.directory, id); safeDirectory(directory, false);
      // Unrecognized/partial evidence is preserved and fails closed. A valid
      // grant without running (e.g. write failure) is interrupted, never replayed.
      const grantFile = path.join(directory, 'consent-consumed.json'); if (!existsSync(grantFile)) continue;
      const grant = grantSchema.parse(safeRead(grantFile)); const { frozenStudySha256, ...planBody } = grant.frozenPlan;
      if (grant.run.id !== id || grant.consent.frozenStudySha256 !== grant.run.frozenStudySha256 || frozenStudySha256 !== grant.run.frozenStudySha256
        || hash(planBody) !== frozenStudySha256) throw new Error('Study consent lineage invalid');
      const runningFile = path.join(directory, 'running.json');
      if (existsSync(runningFile)) { const record = runningSchema.parse(safeRead(runningFile)); if (record.grantSha256 !== hash(grant) || hash(record.run) !== hash(grant.run)) throw new Error('Study running lineage invalid'); }
      const terminalFile = path.join(directory, 'terminal.json');
      const confirmationFile = path.join(directory, 'terminal.confirmed.json');
      if (existsSync(confirmationFile) && !existsSync(terminalFile)) throw new Error('Study terminal confirmation has no terminal evidence');
      if (existsSync(terminalFile) && existsSync(confirmationFile)) {
        const terminal = runningSchema.parse(safeRead(terminalFile));
        const confirmation = confirmationSchema.parse(safeRead(confirmationFile));
        if (confirmation.runId !== id || confirmation.directorySha256 !== hash(directory) || confirmation.grantSha256 !== hash(grant)
          || confirmation.terminalSha256 !== hash(terminal)) throw new Error('Study terminal confirmation invalid');
        if (terminal.grantSha256 !== hash(grant) || terminal.run.id !== id || terminal.run.status === 'running'
          || terminal.run.bootId !== grant.run.bootId || terminal.run.frozenStudySha256 !== grant.run.frozenStudySha256 || terminal.run.executionSource !== grant.run.executionSource) throw new Error('Study terminal lineage invalid');
        this.runs.set(id, terminal.run);
      } else this.runs.set(id, { ...grant.run, status: 'interrupted', finishedAt: new Date().toISOString(), progress: nullProgress(), summary: null,
        error: 'Previous service boot interrupted this study. In-flight usage is unknown; no resume or automatic paid replay.' });
    }
  }
  prepare(input: unknown): VerifierStudyPreparation {
    this.assertIdle(); const parsed = verifierStudyPrepareRequestSchema.safeParse(input); if (!parsed.success) throw new Error('Invalid study preparation request');
    for (const [id, preparation] of this.preparations) if (preparation.consumed || Date.now() >= Date.parse(preparation.public.expiresAt)) this.preparations.delete(id);
    if (this.preparations.size >= 16) throw new Error('Too many outstanding study preparations; wait for expiry or consume one');
    synchronous(this.options.assertExecutionFresh); const source = snapshotVerifierStudySource();
    let configuration; let configurationIdentity: string; let verifierAgentId: string | null = null;
    if (parsed.data.executionSource === 'loopback-engineering') {
      if (parsed.data.verifierAgentId) throw new Error('Engineering fixture does not use configured Agents');
      configuration = verifierStudyEngineeringConfiguration(); configurationIdentity = this.engineeringConfigurationIdentity();
    } else {
      const candidates = this.options.store.agents().filter(agent => agent.role === 'verifier' && agent.enabled);
      const selected = parsed.data.verifierAgentId ? candidates.find(agent => agent.id === parsed.data.verifierAgentId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!selected) throw new Error('Select one enabled Verifier Agent with explicit model/pricing settings');
      verifierAgentId = selected.id; configurationIdentity = this.options.store.studyConfigurationIdentity(selected.id);
      configuration = { verifier: selected, jev: this.options.store.jevConfig() };
    }
    let plan: ObservedVerifierStudyPlan;
    try { plan = prepareObservedVerifierStudyPlan({ executionSource: parsed.data.executionSource, configuration, source }); }
    catch { throw new Error('Study settings/source do not satisfy the frozen model, pricing, Jev, deadline or clean-source requirements'); }
    this.assertPublicSafe(plan);
    const preparation = verifierStudyPreparationSchema.parse({ id: randomUUID(), executionSource: plan.executionSource,
      frozenStudySha256: plan.frozenStudySha256, expiresAt: new Date(Date.now() + TTL_MS).toISOString(), plan: publicPlan(plan) });
    this.assertPublicSafe(preparation);
    const privatePreparation: Preparation = { public: preparation, plan, bootId: this.options.bootId, configurationIdentity, verifierAgentId, consumed: false };
    this.assertFresh(privatePreparation); this.preparations.set(preparation.id, privatePreparation); return copy(preparation);
  }
  private assertFresh(preparation: Preparation) {
    if (this.closed || preparation.bootId !== this.options.bootId) throw new Error('Study boot changed'); synchronous(this.options.assertExecutionFresh);
    assertVerifierStudySourceFresh(preparation.plan.source, preparation.plan.executionSource === 'real-provider');
    if (preparation.verifierAgentId) {
      const verifier = this.options.store.agents().find(agent => agent.id === preparation.verifierAgentId);
      const configuration = { verifier, jev: this.options.store.jevConfig() };
      if (this.options.store.studyConfigurationIdentity(preparation.verifierAgentId) !== preparation.configurationIdentity
        || hash(verifierStudyPublicConfiguration(configuration)) !== preparation.plan.configurationSha256) throw new Error('Study Agent/Jev configuration or credential generation changed; prepare again');
    } else if (this.engineeringConfigurationIdentity() !== preparation.configurationIdentity) throw new Error('Prepared engineering settings/credential generation changed; prepare again');
  }
  private engineeringConfigurationIdentity() {
    const agents = this.options.store.agents(); return hash({ fixture: verifierStudyEngineeringConfiguration(), agents, jev: this.options.store.jevConfig(),
      generations: agents.map(agent => this.options.store.studyConfigurationIdentity(agent.id)) });
  }
  start(input: unknown): VerifierStudyPublicRun {
    this.assertIdle(); const parsed = verifierStudyStartRequestSchema.safeParse(input); if (!parsed.success) throw new Error('Explicit estimate and Jev output-boundary acknowledgements are required');
    if (readdirSync(this.options.directory).length >= 1000) throw new Error('Study history requires explicit archival before further runs');
    const preparation = this.preparations.get(parsed.data.preparationId);
    if (!preparation || preparation.consumed || Date.now() >= Date.parse(preparation.public.expiresAt)) throw new Error('Study preparation expired, consumed or belongs to another boot; prepare again');
    this.assertFresh(preparation); preparation.consumed = true;
    const id = randomUUID(); const directory = path.join(this.options.directory, id); mkdirSync(directory, { mode: 0o700 }); safeDirectory(directory, false);
    const parent = openSync(this.options.directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    const run = verifierStudyPublicRunSchema.parse({ id, status: 'running', executionSource: preparation.plan.executionSource, bootId: this.options.bootId,
      frozenStudySha256: preparation.plan.frozenStudySha256, createdAt: new Date().toISOString(), finishedAt: null, progress: nullProgress(), summary: null, error: null });
    const consent: ObservedStudyConsent = { id: randomUUID(), frozenStudySha256: preparation.plan.frozenStudySha256,
      status: run.executionSource === 'real-provider' ? 'granted' : 'engineering-only', scope: 'single-new-study-no-auto-resume', approvedAt: run.createdAt,
      estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true };
    const grant = grantSchema.parse({ version: 'verifier-study-control-v1', preparationId: preparation.public.id, run, consent, frozenPlan: preparation.plan });
    this.assertPublicSafe(grant); const grantSha256 = hash(grant); const running = { version: 'verifier-study-control-v1' as const, grantSha256, run };
    this.assertPublicSafe(running); persist(directory, 'consent-consumed.json', grant);
    persist(directory, 'running.json', running);
    this.runs.set(id, run); const controller = new AbortController();
    // Mark busy BEFORE a microtask may enter any executor or credential method.
    const active = { id, controller, task: Promise.resolve() }; this.active = active;
    active.task = Promise.resolve().then(() => this.execute(preparation, run, directory, consent, grantSha256, controller.signal)).finally(() => { if (this.active === active) this.active = null; });
    return copy(run);
  }
  private async execute(preparation: Preparation, run: VerifierStudyPublicRun, directory: string, consent: ObservedStudyConsent, grantSha256: string, signal: AbortSignal) {
    let cleanup: (() => Promise<void>) | undefined;
    const assertFresh = () => { this.assertFresh(preparation); if (!preparation.consumed || this.active?.id !== run.id) throw new Error('Study consent no longer active');
      const grant = grantSchema.parse(safeRead(path.join(directory, 'consent-consumed.json')));
      const running = runningSchema.parse(safeRead(path.join(directory, 'running.json')));
      if (hash(grant) !== grantSha256 || running.grantSha256 !== grantSha256 || hash(running.run) !== hash(grant.run)) throw new Error('Durable consent/running evidence changed'); };
    let summary: ObservedStudySummary | undefined; let failed = false;
    try {
      assertFresh(); signal.throwIfAborted();
      if (preparation.plan.executionSource === 'loopback-engineering' && this.options.engineeringTestExecutor) {
        summary = await this.options.engineeringTestExecutor({ directory: path.join(directory, 'run'), plan: preparation.plan, consent, signal, assertFresh });
      } else {
        let transport: VerifierStudyTransport | undefined;
        const guards = { assertFresh, assertAuthorized: (context: { executionSource: string; configurationSha256: string; poolId: string; engine: 'llm' | 'jev'; requestSha256: string }) => {
          assertFresh(); signal.throwIfAborted(); const binding = preparation.plan.poolBindings.find(item => item.poolId === context.poolId);
          if (context.executionSource !== run.executionSource || !preparation.consumed || !transport
            || context.configurationSha256 !== transport.configurationSha256 || !binding
            || context.requestSha256 !== (context.engine === 'llm' ? binding.logicalLlmSha256 : hash(verifierPreparationRequests(binding.poolId).snapshot))) throw new Error('Study dispatch not authorized for this frozen configuration/request'); } };
        if (preparation.plan.executionSource === 'loopback-engineering') {
          const fixture = await createVerifierStudyEngineeringFixture({ guards }); cleanup = fixture.close; transport = fixture.transport;
          const prior = cleanup; cleanup = async () => { await prior(); const receipt = fixture.counts(); this.assertPublicSafe(receipt); persist(directory, 'engineering-receipt.json', receipt); };
        } else {
          // Only this acknowledged real-mode branch can decrypt selected keys.
          assertFresh(); signal.throwIfAborted();
          const agent = this.options.store.secretAgents([preparation.verifierAgentId!])[0]; const jev = this.options.store.secretJevConfig();
          assertFresh();
          transport = createVerifierStudyTransport({ configuration: preparation.plan.configuration, secrets: { llmKey: agent.apiKey ?? '', jevKey: jev.apiKey ?? '' }, guards });
        }
        summary = await runObservedVerifierStudy({ directory: path.join(directory, 'run'), plan: preparation.plan, transport, consent, signal });
      }
      assertFresh();
    } catch { failed = true; }
    finally { if (cleanup) try { await cleanup(); } catch { failed = true; } }
    // Native runner and fixture cleanup have settled before returning terminal.
    let safeSummary = null;
    if (summary) {
      try {
        if (summary.executionSource !== run.executionSource || (run.executionSource === 'loopback-engineering'
          && (summary.actualModelUsage !== null || summary.actualProviderHttpAttempts !== 0 || summary.usage.scope !== 'loopback-fixture-accounting-not-model-measurement'))) throw new Error('Engineering result cannot claim real model provenance');
        safeSummary = verifierStudySummarySchema.parse({ ...summary, reason: summary.reason === null ? null : 'Study stopped; inspect retained private ledger for the frozen failure evidence.' });
      }
      catch { failed = true; }
    }
    const terminal: VerifierStudyPublicRun = { ...run, status: failed ? signal.aborted ? 'cancelled' : 'failed' : safeSummary?.status ?? 'failed',
      finishedAt: new Date().toISOString(), progress: this.progress(directory), summary: safeSummary,
      error: failed ? 'Study stopped or evidence/configuration changed. No automatic retry or resume; retained usage may be unknown.' : safeSummary?.status === 'completed' ? null : 'Study ended without a completed verdict; retained observations are not a model success.' };
    if (signal.aborted && terminal.status === 'completed') { terminal.status = 'cancelled'; terminal.error = 'Cancellation requested after observations; no further work performed.'; }
    try {
      const record = { version: 'verifier-study-control-v1' as const, grantSha256, run: terminal };
      this.assertPublicSafe(record);
      persist(directory, 'terminal.json', record, run.executionSource === 'loopback-engineering'
        ? () => this.options.engineeringPersistFault?.('terminal-directory-sync') : undefined);
      // Created ONLY after the terminal file AND directory barriers return.
      // Like the native ledger commit marker, this confirms the preceding
      // barrier, not signatures, hostile-user authenticity or caller receipt.
      const confirmation = { version: 'verifier-study-terminal-confirmation-v1', runId: run.id,
        directorySha256: hash(directory), grantSha256, terminalSha256: hash(record) };
      this.assertPublicSafe(confirmation); persist(directory, 'terminal.confirmed.json', confirmation);
    }
    catch { terminal.status = 'failed'; terminal.error = 'Terminal persistence failed. Prior consent, running record and native evidence are preserved; no replay.'; }
    this.runs.set(run.id, terminal);
  }
  private progress(directory: string): VerifierStudyPublicRun['progress'] {
    try { const events = VerifierStudyLedger.open(path.join(directory, 'run')).readEvents();
      return { ledgerEvents: events.length, decisions: events.filter(event => event.type === 'decision-result').length,
        calls: events.filter(event => event.type === 'call-intent').length, oracles: events.filter(event => event.type === 'oracle-result').length }; }
    catch { return nullProgress(); }
  }
  get(id: string): VerifierStudyPublicRun | null {
    if (!UUID.safeParse(id).success) return null; const run = this.runs.get(id); if (!run) return null;
    const value = copy(run.status === 'running' ? { ...run, progress: this.progress(path.join(this.options.directory, id)) } : run);
    this.assertPublicSafe(value); return value;
  }
  list(): VerifierStudyPublicRun[] { return [...this.runs.keys()].map(id => this.get(id)!).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async cancel(id: string): Promise<VerifierStudyPublicRun | null> {
    const active = this.active; if (active?.id === id) { active.controller.abort(new DOMException('Study cancelled by user', 'AbortError')); await active.task; }
    return this.get(id);
  }
  async close(): Promise<void> { this.closed = true; const active = this.active; if (active) { active.controller.abort(new DOMException('Service shutting down', 'AbortError')); await active.task; } this.preparations.clear(); }
}
