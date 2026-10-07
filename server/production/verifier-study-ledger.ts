import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync, type Stats } from 'node:fs';
import path from 'node:path';
import { types as utilTypes } from 'node:util';

export const VERIFIER_STUDY_LEDGER_VERSION = 'verifier-study-ledger-v2' as const;
export const VERIFIER_STUDY_EVENT_VERSION = 'verifier-study-event-v1' as const;
export const VERIFIER_STUDY_COMMIT_VERSION = 'verifier-study-event-commit-v1' as const;
export const STUDY_EVENT_TYPES = ['run-start', 'decision-start', 'call-intent', 'call-result', 'decision-result', 'oracle-intent', 'oracle-result', 'run-end'] as const;
export type StudyEventType = typeof STUDY_EVENT_TYPES[number];
export type StudyJson = null | boolean | number | string | StudyJson[] | { [key: string]: StudyJson };
export type StudyRecord = { [key: string]: StudyJson };

export interface StudyLedgerEvent {
  version: typeof VERIFIER_STUDY_EVENT_VERSION;
  sequence: number;
  time: string;
  type: StudyEventType;
  payload: StudyRecord;
  previousHash: string;
  hash: string;
}
export interface StudyLedgerManifest {
  version: typeof VERIFIER_STUDY_LEDGER_VERSION;
  createdAt: string;
  runId: string;
  status: 'running';
  manifest: StudyRecord;
  limits: { maxEvents: number; maxFileBytes: number; maxManifestBytes: number; maxTotalBytes: number };
}
export interface StudyLedgerOptions {
  /** Free fault-injection hook; must never dispatch a model or contain credentials. */
  beforePersist?: (operation: 'manifest' | 'event' | 'commit-marker' | 'directory-sync', context: { eventType?: StudyEventType; sequence?: number; phase?: 'manifest' | 'event' | 'commit-marker' }) => void;
}

const LIMITS = Object.freeze({ maxEvents: 2048, maxFileBytes: 1024 * 1024, maxManifestBytes: 8 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
const MANIFEST_FILE = 'manifest.json';
const EVENT_FILE = /^event-([0-9]{6})\.json$/;
const COMMIT_FILE = /^event-([0-9]{6})\.commit\.json$/;
const TERMINAL_CALL = new Set(['completed', 'failed', 'unknown', 'cancelled', 'interrupted']);
const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const SECRET_FIELDS = new Set(['key', 'apikey', 'secret', 'authorization', 'accesstoken', 'refreshtoken', 'privatekey', 'password', 'clientsecret', 'bearer', 'cookie', 'setcookie', 'credentials']);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const eventFile = (sequence: number): string => `event-${String(sequence).padStart(6, '0')}.json`;
const commitFile = (sequence: number): string => `event-${String(sequence).padStart(6, '0')}.commit.json`;
interface EventCommit {
  version: typeof VERIFIER_STUDY_COMMIT_VERSION;
  sequence: number;
  runId: string;
  directoryHash: string;
  manifestHash: string;
  eventHash: string;
  previousCommitHash: string;
  hash: string;
}
function eventCommit(event: StudyLedgerEvent, directory: string, manifestHash: string, previousCommitHash: string): EventCommit {
  const body = { version: VERIFIER_STUDY_COMMIT_VERSION, sequence: event.sequence, runId: event.payload.runId as string, directoryHash: hash(directory), manifestHash, eventHash: event.hash, previousCommitHash };
  return { ...body, hash: hash(JSON.stringify(body)) };
}

/** Refuse lossy serialization, accessors, cycles, secret fields and recognizable credential text.
 * Arbitrary opaque secrets are not detectable: callers must redact exact configured keys before
 * supplying untrusted model text. This ledger never reads the credential store or the network.
 */
function publicJson(value: unknown): StudyJson {
  const ancestors = new Set<object>(); let nodes = 0;
  const inspect = (current: unknown, depth: number): StudyJson => {
    if (++nodes > 100_000 || depth > 40) throw new Error('Study ledger JSON complexity limit exceeded');
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') { if (!Number.isFinite(current)) throw new Error('Study ledger requires finite JSON numbers'); return current; }
    if (typeof current === 'string') {
      if (/\b(?:sk-[A-Za-z0-9_-]{12,}|apikey_[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+\/-]{12,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(current)) throw new Error('Study ledger refuses credential-like text');
      return current;
    }
    if (!current || typeof current !== 'object') throw new Error('Study ledger accepts JSON values only');
    if (utilTypes.isProxy(current)) throw new Error('Study ledger refuses Proxy objects');
    if (ancestors.has(current)) throw new Error('Study ledger refuses circular JSON');
    ancestors.add(current);
    let result: StudyJson;
    if (Array.isArray(current)) {
      if (Object.getOwnPropertySymbols(current).length || Object.keys(current).length !== current.length || Object.getOwnPropertyNames(current).length !== current.length + 1) throw new Error('Study ledger refuses sparse or decorated arrays');
      result = Array.from({ length: current.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || descriptor.get || descriptor.set) throw new Error('Study ledger refuses accessors');
        return inspect(descriptor.value, depth + 1);
      });
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) throw new Error('Study ledger requires plain JSON objects');
      if (Object.getOwnPropertySymbols(current).length) throw new Error('Study ledger refuses symbol properties');
      const copy: StudyRecord = Object.create(null) as StudyRecord;
      for (const name of Object.getOwnPropertyNames(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name)!;
        if (descriptor.get || descriptor.set) throw new Error('Study ledger refuses accessors');
        if (!descriptor.enumerable) throw new Error('Study ledger refuses non-JSON properties');
        const normalized = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (SECRET_FIELDS.has(normalized) || name === '__proto__' || name === 'constructor' || name === 'prototype') throw new Error('Study ledger refuses secret or unsafe fields');
        copy[name] = inspect(descriptor.value, depth + 1);
      }
      result = copy;
    }
    ancestors.delete(current); return result;
  };
  return inspect(value, 0);
}
function publicRecord(value: unknown): StudyRecord {
  const result = publicJson(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Study ledger payload must be a JSON object');
  return result;
}
function identifier(value: StudyJson | undefined, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error(`Study ledger requires a stable ${field}`);
  return value;
}
function assertExactKeys(value: object, expected: string[]): void {
  if (Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error('Study ledger envelope fields are invalid');
}
function assertTime(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Study ledger timestamp is invalid');
}
function assertMatchingOptionalFields(payload: StudyRecord, previous: StudyRecord, names: string[]): void {
  for (const name of names) if (Object.hasOwn(payload, name) && Object.hasOwn(previous, name) && payload[name] !== previous[name]) throw new Error('Study ledger result lineage does not match its intent');
}
function assertDirectoryName(directory: string): string {
  if (!path.isAbsolute(directory) || directory.includes('\0') || directory.split(/[\\/]/).includes('..') || path.normalize(directory) !== directory) throw new Error('Study ledger requires an absolute normalized directory without traversal');
  if (directory === path.parse(directory).root) throw new Error('Study ledger may not use a filesystem root');
  return directory;
}
function assertNoSymlinkParents(directory: string): void {
  const parsed = path.parse(directory); let next = parsed.root;
  for (const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    next = path.join(next, part);
    const stat = lstatSync(next);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Study ledger directories must not contain symlinks');
  }
}
function assertPrivate(stat: Stats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1)) throw new Error('Study ledger refuses symlinks, hard links and non-regular files');
  if ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) throw new Error('Study ledger requires private filesystem permissions');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Study ledger owner does not match this process');
}
function fileText(file: string, maximum: number): string {
  const before = lstatSync(file); assertPrivate(before, false);
  if (before.size > maximum) throw new Error('Study ledger file size limit exceeded');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd); assertPrivate(opened, false);
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size > maximum) throw new Error('Study ledger file changed during open');
    const bytes = readFileSync(fd);
    if (bytes.length !== opened.size || bytes.length > maximum) throw new Error('Study ledger file changed during read');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || !text.endsWith('\n')) throw new Error('Study ledger file is invalid UTF-8 or truncated');
    return text;
  } finally { closeSync(fd); }
}
interface LedgerState { runStarted: boolean; runEnded: boolean; decisions: Map<string, StudyRecord>; calls: Map<string, StudyRecord>; oracles: Map<string, StudyRecord>; }
function replay(manifest: StudyLedgerManifest, events: StudyLedgerEvent[]): LedgerState {
  const state: LedgerState = { runStarted: false, runEnded: false, decisions: new Map(), calls: new Map(), oracles: new Map() };
  for (const event of events) {
    const payload = event.payload;
    if (payload.runId !== manifest.runId) throw new Error('Study ledger run ID does not match manifest');
    if (state.runEnded) throw new Error('Study ledger may not append after a terminal run');
    if (event.type === 'run-start') {
      if (state.runStarted || event.sequence !== 1 || payload.status !== 'running') throw new Error('Study ledger requires exactly one initial running record');
      state.runStarted = true; continue;
    }
    if (!state.runStarted) throw new Error('Study ledger requires run-start before execution events');
    if (event.type === 'decision-start') {
      const id = identifier(payload.decisionId, 'decisionId'); identifier(payload.poolId, 'poolId'); identifier(payload.strategy, 'strategy');
      if (state.decisions.has(id) || payload.status !== 'running') throw new Error('Study ledger decision intent is duplicate or invalid');
      state.decisions.set(id, payload);
    } else if (event.type === 'call-intent') {
      const id = identifier(payload.callId, 'callId'); const decisionId = identifier(payload.decisionId, 'decisionId');
      const decision = state.decisions.get(decisionId);
      if (!decision || decision.status !== 'running' || state.calls.has(id) || !['llm', 'jev'].includes(String(payload.kind)) || payload.status !== 'pending' || payload.usage !== null) throw new Error('Study ledger call intent is duplicate, unbound or has known usage');
      assertMatchingOptionalFields(payload, decision, ['poolId', 'strategy']);
      state.calls.set(id, { ...decision, ...payload });
    } else if (event.type === 'call-result') {
      const id = identifier(payload.callId, 'callId'); const previous = state.calls.get(id);
      if (!previous || previous.status !== 'pending' || payload.decisionId !== previous.decisionId || !TERMINAL_CALL.has(String(payload.status)) || !Object.hasOwn(payload, 'usage')) throw new Error('Study ledger call result is duplicate or not bound to a pending intent');
      assertMatchingOptionalFields(payload, previous, ['kind', 'poolId', 'strategy']);
      if (['unknown', 'interrupted'].includes(String(payload.status)) && payload.usage !== null) throw new Error('Study ledger unknown usage must remain null');
      state.calls.set(id, { ...previous, ...payload });
    } else if (event.type === 'decision-result') {
      const id = identifier(payload.decisionId, 'decisionId'); const previous = state.decisions.get(id);
      if (!previous || previous.status !== 'running' || !['accept', 'abstain', 'error'].includes(String(payload.decision)) || (payload.status !== undefined && !TERMINAL_CALL.has(String(payload.status))) || [...state.calls.values()].some(call => call.decisionId === id && call.status === 'pending')) throw new Error('Study ledger decision result is duplicate, invalid or has unresolved calls');
      assertMatchingOptionalFields(payload, previous, ['poolId', 'strategy']);
      state.decisions.set(id, { ...previous, ...payload, status: typeof payload.status === 'string' ? payload.status : 'completed' });
    } else if (event.type === 'oracle-intent') {
      const oracleId = identifier(payload.oracleId, 'oracleId'); identifier(payload.poolId, 'poolId'); identifier(payload.candidateId, 'candidateId');
      if (state.oracles.has(oracleId) || payload.status !== 'pending' || [...state.oracles.values()].some(oracle => oracle.poolId === payload.poolId && oracle.candidateId === payload.candidateId)) throw new Error('Study ledger Oracle intent is duplicate or invalid');
      state.oracles.set(oracleId, payload);
    } else if (event.type === 'oracle-result') {
      const oracleId = identifier(payload.oracleId, 'oracleId'); const previous = state.oracles.get(oracleId);
      if (!previous || previous.status !== 'pending' || payload.poolId !== previous.poolId || payload.candidateId !== previous.candidateId || !TERMINAL_CALL.has(String(payload.status))) throw new Error('Study ledger Oracle result is duplicate or unbound');
      state.oracles.set(oracleId, payload);
    } else if (event.type === 'run-end') {
      if (!TERMINAL_RUN.has(String(payload.status)) || [...state.calls.values()].some(call => call.status === 'pending') || [...state.decisions.values()].some(decision => decision.status === 'running') || [...state.oracles.values()].some(oracle => oracle.status === 'pending')) throw new Error('Study ledger terminal run must close all started intents');
      if (payload.status === 'interrupted' && payload.usage !== null) throw new Error('Study ledger interrupted run usage must remain unknown');
      state.runEnded = true;
    }
  }
  return state;
}

/** Append-only local study evidence. Synchronous file and directory fsync precede return, so
 * callers must create/append intent successfully BEFORE any model or Oracle callback.
 * `open` only validates and reads. Recovery is explicit, never replays calls and never writes
 * a successful report. Filesystem isolation is defensive checks, not a hostile-user sandbox
 * or atomic OS-wide snapshot. Every event needs a directory/run/manifest/hash-bound commit
 * marker, created ONLY AFTER the event file and event directory barriers succeeded. Missing,
 * truncated or corrupt markers fail closed and preserve all original bytes for manual audit.
 * A valid marker confirms that event's barrier, not that the caller received a return value;
 * late confirmation I/O failure may be commit-ambiguous, never permission to replay a call.
 * Markers are local content-hash confirmations, not signatures, proof of hostile-user
 * authenticity, or guarantees about OS/device power-loss behavior.
 */
export class VerifierStudyLedger {
  private events: StudyLedgerEvent[];
  private totalBytes: number;
  private faulted = false;
  private readonly directoryIdentity: { ino: number; dev: number };
  private constructor(readonly directory: string, private readonly manifest: StudyLedgerManifest, private readonly manifestHash: string, events: StudyLedgerEvent[], totalBytes: number, private readonly options: StudyLedgerOptions = {}) {
    this.events = events; this.totalBytes = totalBytes;
    const stat = lstatSync(directory); this.directoryIdentity = { ino: stat.ino, dev: stat.dev };
  }

  static create(directory: string, record: Record<string, unknown>, options: StudyLedgerOptions = {}): VerifierStudyLedger {
    assertDirectoryName(directory); assertNoSymlinkParents(path.dirname(directory));
    const safe = publicRecord(record); const runId = identifier(safe.runId, 'runId');
    if (safe.status !== 'running') throw new Error('Study ledger manifest must start running');
    const manifest: StudyLedgerManifest = { version: VERIFIER_STUDY_LEDGER_VERSION, createdAt: new Date().toISOString(), runId, status: 'running', manifest: safe, limits: { ...LIMITS } };
    const text = `${JSON.stringify(manifest)}\n`;
    if (Buffer.byteLength(text) > LIMITS.maxManifestBytes) throw new Error('Study ledger manifest size limit exceeded');
    // mkdir is intentionally exclusive: never reuse, clear or modify another study directory.
    mkdirSync(directory, { mode: 0o700 }); assertPrivate(lstatSync(directory), true);
    // The parent's new-directory entry has its own durability barrier, independent of files.
    const parentFd = openSync(path.dirname(directory), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try { options.beforePersist?.('directory-sync', {}); fsyncSync(parentFd); } finally { closeSync(parentFd); }
    const ledger = new VerifierStudyLedger(directory, manifest, hash(text), [], Buffer.byteLength(text), options);
    ledger.persist(MANIFEST_FILE, text, 'manifest', {});
    ledger.append('run-start', { runId, status: 'running', manifestHash: ledger.manifestHash });
    return ledger;
  }

  static open(directory: string, options: StudyLedgerOptions = {}): VerifierStudyLedger {
    assertDirectoryName(directory); assertNoSymlinkParents(directory); assertPrivate(lstatSync(directory), true);
    const files = readdirSync(directory);
    if (files.length > LIMITS.maxEvents * 2 + 1 || !files.includes(MANIFEST_FILE) || files.some(file => file !== MANIFEST_FILE && !EVENT_FILE.test(file) && !COMMIT_FILE.test(file))) throw new Error('Study ledger directory contains missing, unexpected or excessive files');
    const manifestText = fileText(path.join(directory, MANIFEST_FILE), LIMITS.maxManifestBytes);
    const manifestRecord = publicRecord(JSON.parse(manifestText));
    assertExactKeys(manifestRecord, ['version', 'createdAt', 'runId', 'status', 'manifest', 'limits']);
    if (manifestRecord.version !== VERIFIER_STUDY_LEDGER_VERSION || manifestRecord.status !== 'running' || JSON.stringify(manifestRecord.limits) !== JSON.stringify(LIMITS)) throw new Error('Study ledger manifest version, state or limits are invalid');
    assertTime(manifestRecord.createdAt); identifier(manifestRecord.runId, 'runId');
    const manifest = manifestRecord as unknown as StudyLedgerManifest;
    if (manifest.manifest.runId !== manifest.runId || manifest.manifest.status !== 'running') throw new Error('Study ledger manifest identity is inconsistent');
    const manifestHash = hash(manifestText); let previousHash = manifestHash; let previousCommitHash = manifestHash; let totalBytes = Buffer.byteLength(manifestText);
    const events: StudyLedgerEvent[] = [];
    const eventFiles = files.filter(file => EVENT_FILE.test(file)).sort();
    const markerFiles = files.filter(file => COMMIT_FILE.test(file));
    if (eventFiles.length > LIMITS.maxEvents) throw new Error('Study ledger event count limit exceeded');
    for (const [index, file] of eventFiles.entries()) {
      const sequence = index + 1;
      if (file !== eventFile(sequence)) throw new Error('Study ledger event sequence has a gap');
      const eventText = fileText(path.join(directory, file), LIMITS.maxFileBytes); totalBytes += Buffer.byteLength(eventText);
      if (totalBytes > LIMITS.maxTotalBytes) throw new Error('Study ledger total size limit exceeded');
      const eventRecord = publicRecord(JSON.parse(eventText));
      assertExactKeys(eventRecord, ['version', 'sequence', 'time', 'type', 'payload', 'previousHash', 'hash']);
      const event = eventRecord as unknown as StudyLedgerEvent;
      if (event.version !== VERIFIER_STUDY_EVENT_VERSION || event.sequence !== sequence || !STUDY_EVENT_TYPES.includes(event.type) || event.previousHash !== previousHash || !/^[a-f0-9]{64}$/.test(event.hash)) throw new Error('Study ledger event envelope or hash chain is invalid');
      assertTime(event.time); publicRecord(event.payload);
      const { hash: recordedHash, ...body } = event;
      if (hash(JSON.stringify(body)) !== recordedHash) throw new Error('Study ledger event content hash does not match');
      if (!markerFiles.includes(commitFile(sequence))) throw new Error('Study ledger event has an unconfirmed commit marker; explicit audit required, no recovery or replay');
      const markerText = fileText(path.join(directory, commitFile(sequence)), LIMITS.maxFileBytes); totalBytes += Buffer.byteLength(markerText);
      if (totalBytes > LIMITS.maxTotalBytes) throw new Error('Study ledger total size limit exceeded');
      const marker = publicRecord(JSON.parse(markerText));
      assertExactKeys(marker, ['version', 'sequence', 'runId', 'directoryHash', 'manifestHash', 'eventHash', 'previousCommitHash', 'hash']);
      const expectedMarker = eventCommit(event, directory, manifestHash, previousCommitHash);
      if (JSON.stringify(marker) !== JSON.stringify(expectedMarker)) throw new Error('Study ledger commit marker hash, sequence, scope or content is invalid');
      previousCommitHash = expectedMarker.hash;
      events.push(event); previousHash = event.hash;
    }
    if (markerFiles.length !== eventFiles.length) throw new Error('Study ledger contains orphan commit markers');
    replay(manifest, events);
    return new VerifierStudyLedger(directory, manifest, manifestHash, events, totalBytes, options);
  }

  readManifest(): StudyLedgerManifest { return clone(this.manifest); }
  readEvents(): StudyLedgerEvent[] { return clone(this.events); }
  isFaulted(): boolean { return this.faulted; }

  append(type: StudyEventType, record: Record<string, unknown>): StudyLedgerEvent {
    if (this.faulted) throw new Error('Study ledger is write-disabled after persistence failure; reopen for explicit audit');
    if (!STUDY_EVENT_TYPES.includes(type)) throw new Error('Study ledger event type is invalid');
    const payload = publicRecord(record);
    const body = { version: VERIFIER_STUDY_EVENT_VERSION, sequence: this.events.length + 1, time: new Date().toISOString(), type, payload, previousHash: this.events.at(-1)?.hash ?? this.manifestHash };
    const event: StudyLedgerEvent = { ...body, hash: hash(JSON.stringify(body)) };
    replay(this.manifest, [...this.events, event]);
    let previousCommitHash = this.manifestHash;
    for (const previous of this.events) previousCommitHash = eventCommit(previous, this.directory, this.manifestHash, previousCommitHash).hash;
    const marker = eventCommit(event, this.directory, this.manifestHash, previousCommitHash);
    const text = `${JSON.stringify(event)}\n`; const markerText = `${JSON.stringify(marker)}\n`; const bytes = Buffer.byteLength(text); const markerBytes = Buffer.byteLength(markerText);
    if (event.sequence > LIMITS.maxEvents || bytes > LIMITS.maxFileBytes || markerBytes > LIMITS.maxFileBytes || this.totalBytes + bytes + markerBytes > LIMITS.maxTotalBytes) throw new Error('Study ledger event or total size limit exceeded');
    try {
      this.assertUnchangedDirectory();
      const existing = readdirSync(this.directory).sort(); const expected = [MANIFEST_FILE, ...this.events.flatMap(item => [eventFile(item.sequence), commitFile(item.sequence)])].sort();
      if (existing.join('\0') !== expected.join('\0') || hash(fileText(path.join(this.directory, MANIFEST_FILE), LIMITS.maxManifestBytes)) !== this.manifestHash) throw new Error('Study ledger changed or another writer advanced its tail');
      let priorMarkerHash = this.manifestHash;
      for (const previous of this.events) {
        if (fileText(path.join(this.directory, eventFile(previous.sequence)), LIMITS.maxFileBytes) !== `${JSON.stringify(previous)}\n`) throw new Error('Study ledger previously committed event changed');
        const expectedMarker = eventCommit(previous, this.directory, this.manifestHash, priorMarkerHash);
        if (fileText(path.join(this.directory, commitFile(previous.sequence)), LIMITS.maxFileBytes) !== `${JSON.stringify(expectedMarker)}\n`) throw new Error('Study ledger previously committed marker changed');
        priorMarkerHash = expectedMarker.hash;
      }
      this.persist(eventFile(event.sequence), text, 'event', { eventType: type, sequence: event.sequence });
      // The marker cannot exist if the event barrier failed. Do not silently discard a tail.
      this.persist(commitFile(event.sequence), markerText, 'commit-marker', { eventType: type, sequence: event.sequence });
    } catch (error) { this.faulted = true; throw error; }
    // Never advance memory first; a failed fsync can leave forensic bytes but no call is allowed.
    this.events.push(event); this.totalBytes += bytes + markerBytes; return clone(event);
  }

  recoverInterrupted(): { recovered: boolean; events: StudyLedgerEvent[] } {
    const state = replay(this.manifest, this.events);
    if (state.runEnded) return { recovered: false, events: this.readEvents() };
    const runId = this.manifest.runId;
    if (!state.runStarted) this.append('run-start', { runId, status: 'running', manifestHash: this.manifestHash, recoveryOnly: true });
    for (const [callId, call] of state.calls) if (call.status === 'pending') this.append('call-result', { runId, decisionId: call.decisionId, callId, status: 'unknown', usage: null, reason: 'interrupted', actualWireAttempts: null, recoveryOnly: true });
    for (const [oracleId, oracle] of state.oracles) if (oracle.status === 'pending') this.append('oracle-result', { runId, oracleId, poolId: oracle.poolId, candidateId: oracle.candidateId, status: 'unknown', result: null, reason: 'interrupted', recoveryOnly: true });
    for (const [decisionId, decision] of state.decisions) if (decision.status === 'running') this.append('decision-result', { runId, decisionId, poolId: decision.poolId, strategy: decision.strategy, status: 'interrupted', decision: 'error', selectedCandidateId: null, reason: 'interrupted', recoveryOnly: true });
    this.append('run-end', { runId, status: 'interrupted', usage: null, reason: 'explicit-recovery-no-call-replay', recoveryOnly: true });
    return { recovered: true, events: this.readEvents() };
  }

  private assertUnchangedDirectory(): void {
    assertNoSymlinkParents(this.directory); const stat = lstatSync(this.directory); assertPrivate(stat, true);
    if (stat.ino !== this.directoryIdentity.ino || stat.dev !== this.directoryIdentity.dev) throw new Error('Study ledger directory was replaced');
  }
  private persist(file: string, text: string, operation: 'manifest' | 'event' | 'commit-marker', context: { eventType?: StudyEventType; sequence?: number }): void {
    const phasedContext = { ...context, phase: operation };
    this.assertUnchangedDirectory(); this.options.beforePersist?.(operation, phasedContext);
    const fd = openSync(path.join(this.directory, file), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const bytes = Buffer.from(text, 'utf8'); let offset = 0;
      while (offset < bytes.length) { const count = writeSync(fd, bytes, offset, bytes.length - offset); if (count <= 0) throw new Error('Study ledger short write'); offset += count; }
      fsyncSync(fd);
    } finally { closeSync(fd); }
    const directoryFd = openSync(this.directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(directoryFd);
      if (opened.ino !== this.directoryIdentity.ino || opened.dev !== this.directoryIdentity.dev) throw new Error('Study ledger directory changed before durability barrier');
      this.options.beforePersist?.('directory-sync', phasedContext); fsyncSync(directoryFd);
    } finally { closeSync(directoryFd); }
  }
}
