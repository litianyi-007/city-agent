import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const NANO_CNY = 1_000_000_000;
const MAX_PROMPT_BYTES = 16_000_000;
const MIN_ENVELOPE_TOKENS = 1024;

export type BudgetErrorCode = 'invalid-config' | 'existing-ledger' | 'locked' | 'storage-failed' | 'halted' | 'closed' | 'request-limit' | 'budget-limit' | 'pending-request' | 'invalid-request' | 'invalid-settlement';

export class ExperimentBudgetError extends Error {
  constructor(public readonly code: BudgetErrorCode, message: string) {
    super(message);
    this.name = 'ExperimentBudgetError';
  }
}

export interface ExperimentPricing {
  provider: string;
  modelId: string;
  currency: 'CNY';
  /** Use the non-cache input price; no cache rebate is assumed when reserving. */
  inputCnyPerMillionTokens: number;
  outputCnyPerMillionTokens: number;
  sourceUrl: string;
  checkedAt: string;
}

export interface ExperimentBudgetOptions {
  /** Absolute local path. An existing ledger is never resumed or overwritten. */
  ledgerPath: string;
  experimentId: string;
  budgetCny: number;
  maxProviderRequests: number;
  pricing: ExperimentPricing;
}

export interface BudgetReservationInput {
  requestId: string;
  /** An identifier, not a prompt, URL, provider error, credential, or personal data. */
  purpose: string;
  /** The complete outgoing system/user payload, excluding headers and credentials. */
  inputText: string;
  maxOutputTokens: number;
  /** Extra protocol/system overhead. At least 1024; defaults to 4096. */
  inputEnvelopeTokens?: number;
}

export interface BudgetSettlementInput {
  outcome: 'succeeded' | 'failed' | 'cancelled';
  /** Null means unreported/invalid usage; it does NOT mean zero usage. */
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface ExperimentBudgetEntry {
  reservationId: string;
  requestId: string;
  purpose: string;
  reservedAt: string;
  finishedAt?: string;
  promptUtf8Bytes: number;
  inputEnvelopeTokens: number;
  reservedInputTokens: number;
  maxOutputTokens: number;
  reservationNanoCny: number;
  committedNanoCny: number;
  state: 'reserved' | 'settled' | 'uncertain';
  outcome?: BudgetSettlementInput['outcome'];
  usage?: { inputTokens: number; outputTokens: number };
  actualNanoCny?: number;
  stopReason?: string;
}

export interface ExperimentBudgetLedger {
  schemaVersion: 'experiment-budget-1.0';
  experimentId: string;
  createdAt: string;
  updatedAt: string;
  state: 'active' | 'halted' | 'closed';
  budgetCny: number;
  budgetNanoCny: number;
  maxProviderRequests: number;
  pricing: ExperimentPricing;
  /** Rates rounded upward to integral nano-CNY/token; this is an estimate, not billing. */
  inputNanoCnyPerToken: number;
  outputNanoCnyPerToken: number;
  reservations: ExperimentBudgetEntry[];
  requestCount: number;
  committedNanoCny: number;
  committedCny: number;
  knownUsageCostCny: number;
  knownUsageRequestCount: number;
  usageStatus: 'not-called' | 'reported' | 'incomplete';
  storageStatus: 'durable' | 'uncertain';
  remainingCny: number;
  stopReason?: string;
  limitation: string;
}

export interface ExperimentBudgetGuard {
  /** Synchronously persists before returning. Only then may the caller send ONE request. */
  reserve(input: BudgetReservationInput): { reservationId: string; reservedInputTokens: number; reservedCny: number };
  /** Invalid/unknown usage, failure, or usage above reserve halts all later requests. */
  settle(reservationId: string, input: BudgetSettlementInput): ExperimentBudgetLedger;
  snapshot(): ExperimentBudgetLedger;
  /** Controlled reason identifier only; do not pass provider exception messages. */
  stop(reason: string): ExperimentBudgetLedger;
  /** Finalizes and releases this process's lock; does not make the ledger resumable. */
  close(): void;
}

function fail(code: BudgetErrorCode, message: string): never {
  throw new ExperimentBudgetError(code, message);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value);
}

function finiteSafeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validateOptions(options: ExperimentBudgetOptions): void {
  if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['ledgerPath', 'experimentId', 'budgetCny', 'maxProviderRequests', 'pricing'].includes(key))) fail('invalid-config', 'Budget configuration contains unknown fields.');
  if (typeof options.ledgerPath !== 'string' || !isAbsolute(options.ledgerPath) || !validIdentifier(options.experimentId)) fail('invalid-config', 'Budget requires an absolute ledger path and safe experiment identifier.');
  if (!Number.isFinite(options.budgetCny) || options.budgetCny < 0 || options.budgetCny > 100_000 || !finiteSafeInteger(Math.floor(options.budgetCny * NANO_CNY))) fail('invalid-config', 'Budget must be a finite non-negative CNY value.');
  if (!finiteSafeInteger(options.maxProviderRequests, 0, 10_000)) fail('invalid-config', 'Request limit must be an integer from zero through 10000.');
  const price = options.pricing;
  if (!price || typeof price !== 'object' || Object.keys(price).some(key => !['provider', 'modelId', 'currency', 'inputCnyPerMillionTokens', 'outputCnyPerMillionTokens', 'sourceUrl', 'checkedAt'].includes(key)) || price.currency !== 'CNY' || !validIdentifier(price.provider) || !validIdentifier(price.modelId)) fail('invalid-config', 'Pricing requires CNY, safe provider/model identifiers, and no unknown fields.');
  for (const rate of [price.inputCnyPerMillionTokens, price.outputCnyPerMillionTokens]) {
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) fail('invalid-config', 'Frozen prices must be positive finite CNY per million tokens.');
  }
  let source: URL;
  try { if (typeof price.sourceUrl !== 'string') throw new Error(); source = new URL(price.sourceUrl); } catch { fail('invalid-config', 'Pricing source must be a valid public HTTPS URL.'); }
  if (source.protocol !== 'https:' || source.username || source.password || source.search || source.hash) fail('invalid-config', 'Pricing source must not contain credentials, query, or fragment.');
  if (typeof price.checkedAt !== 'string' || !Number.isFinite(Date.parse(price.checkedAt))) fail('invalid-config', 'Pricing requires a valid verification time.');
}

function refreshTotals(ledger: ExperimentBudgetLedger): void {
  ledger.updatedAt = new Date().toISOString();
  ledger.requestCount = ledger.reservations.length;
  ledger.committedNanoCny = ledger.reservations.reduce((sum, entry) => sum + entry.committedNanoCny, 0);
  if (!finiteSafeInteger(ledger.committedNanoCny)) fail('invalid-settlement', 'Committed cost cannot be represented safely.');
  ledger.committedCny = ledger.committedNanoCny / NANO_CNY;
  ledger.knownUsageCostCny = ledger.reservations.reduce((sum, entry) => sum + (entry.actualNanoCny ?? 0), 0) / NANO_CNY;
  ledger.knownUsageRequestCount = ledger.reservations.filter(entry => entry.actualNanoCny !== undefined).length;
  ledger.usageStatus = ledger.requestCount === 0 ? 'not-called' : ledger.knownUsageRequestCount === ledger.requestCount ? 'reported' : 'incomplete';
  ledger.remainingCny = Math.max(0, ledger.budgetNanoCny - ledger.committedNanoCny) / NANO_CNY;
}

/**
 * One fresh experiment, one process, one request at a time. This local guard is not a
 * provider-side spend cap: tokenization/system overhead and billing are external.
 * No credentials, prompt text, responses, or raw provider exceptions are persisted.
 */
export function createExperimentBudget(rawOptions: ExperimentBudgetOptions): ExperimentBudgetGuard {
  validateOptions(rawOptions);
  const options = structuredClone(rawOptions);
  const ledgerPath = resolve(options.ledgerPath);
  const ledgerDirectory = dirname(ledgerPath);
  const lockPath = `${ledgerPath}.lock`;
  try { mkdirSync(ledgerDirectory, { recursive: true, mode: 0o700 }); } catch { fail('storage-failed', 'Could not create the ledger directory; no request is authorized.'); }
  if (existsSync(ledgerPath)) fail('existing-ledger', 'A ledger already exists. Automatic resume or replacement is forbidden.');
  const owner = randomUUID();
  let lockFd: number;
  try { lockFd = openSync(lockPath, 'wx', 0o600); } catch { fail('locked', 'Another or interrupted experiment owns this ledger lock. Do not auto-clear it.'); }
  let closed = false;
  let poisoned = false;
  let ledger: ExperimentBudgetLedger;

  const releaseOwnLock = () => {
    try { closeSync(lockFd); } catch { /* Closed only after all allowed requests stop. */ }
    try {
      const content = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (content.owner === owner) unlinkSync(lockPath);
    } catch { /* Never delete an unverified lock or hide another owner. */ }
  };

  const persist = (next: ExperimentBudgetLedger, initial = false) => {
    const tempPath = `${ledgerPath}.pending-${owner}`;
    let file: number | undefined;
    let directory: number | undefined;
    try {
      if (initial && existsSync(ledgerPath)) fail('existing-ledger', 'Ledger appeared while acquiring the lock; refusing replacement.');
      file = openSync(tempPath, 'wx', 0o600);
      writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fsyncSync(file);
      closeSync(file); file = undefined;
      renameSync(tempPath, ledgerPath);
      directory = openSync(ledgerDirectory, 'r');
      fsyncSync(directory);
      closeSync(directory); directory = undefined;
      ledger = next;
    } catch {
      poisoned = true;
      if (file !== undefined) { try { closeSync(file); } catch { /* Keep failed writes closed. */ } }
      if (directory !== undefined) { try { closeSync(directory); } catch { /* Keep failed writes closed. */ } }
      // A partial pending journal remains as evidence; never silently resume it.
      fail('storage-failed', 'Budget journal write failed. No further request is authorized; inspect the original ledger and pending journal.');
    }
  };

  try {
    writeFileSync(lockFd, `${JSON.stringify({ owner, pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
    fsyncSync(lockFd);
    const now = new Date().toISOString();
    ledger = {
      schemaVersion: 'experiment-budget-1.0', experimentId: options.experimentId,
      createdAt: now, updatedAt: now, state: 'active', budgetCny: options.budgetCny,
      budgetNanoCny: Math.floor(options.budgetCny * NANO_CNY), maxProviderRequests: options.maxProviderRequests,
      pricing: options.pricing,
      inputNanoCnyPerToken: Math.ceil(options.pricing.inputCnyPerMillionTokens * 1000),
      outputNanoCnyPerToken: Math.ceil(options.pricing.outputCnyPerMillionTokens * 1000),
      reservations: [], requestCount: 0, committedNanoCny: 0, committedCny: 0, knownUsageCostCny: 0,
      knownUsageRequestCount: 0, usageStatus: 'not-called', storageStatus: 'durable',
      remainingCny: options.budgetCny,
      limitation: 'Local conservative pre-call reservation, not a provider billing guarantee. Input tokens are bounded by outgoing UTF8 bytes plus registered protocol overhead; unknown, failed or excess usage halts and retains the reservation. No auto-retry, cache discount, top-up, fallback, or ledger resume.',
    };
    persist(ledger, true);
  } catch (error) {
    releaseOwnLock();
    if (error instanceof ExperimentBudgetError) throw error;
    fail('storage-failed', 'Could not initialize the budget journal; no request is authorized.');
  }

  const requireActive = () => {
    if (closed) fail('closed', 'Experiment budget is closed.');
    if (poisoned) fail('storage-failed', 'Budget storage is uncertain; no further request is authorized.');
    if (ledger.state !== 'active') fail('halted', 'Experiment halted; a new authorization is required.');
  };

  const halt = (reason: string) => {
    const next = structuredClone(ledger);
    next.state = 'halted'; next.stopReason = reason;
    refreshTotals(next); persist(next);
  };

  return {
    reserve(input) {
      requireActive();
      if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['requestId', 'purpose', 'inputText', 'maxOutputTokens', 'inputEnvelopeTokens'].includes(key))) {
        halt('invalid-request'); fail('invalid-request', 'Request contains unknown fields.');
      }
      const envelope = input.inputEnvelopeTokens ?? 4096;
      if (!validIdentifier(input.requestId) || !validIdentifier(input.purpose) || typeof input.inputText !== 'string' || !finiteSafeInteger(input.maxOutputTokens, 1, 1_000_000) || !finiteSafeInteger(envelope, MIN_ENVELOPE_TOKENS, 1_000_000)) {
        halt('invalid-request'); fail('invalid-request', 'Request identifiers, output cap, or envelope are invalid.');
      }
      if (ledger.reservations.some(entry => entry.requestId === input.requestId)) {
        halt('duplicate-request-id'); fail('invalid-request', 'A request identifier may only be used once.');
      }
      if (ledger.reservations.some(entry => entry.state === 'reserved')) fail('pending-request', 'Settle the previous request before requesting another reservation.');
      if (ledger.requestCount >= ledger.maxProviderRequests) {
        halt('request-limit'); fail('request-limit', 'The authorized provider request count has been exhausted.');
      }
      const promptUtf8Bytes = Buffer.byteLength(input.inputText, 'utf8');
      if (promptUtf8Bytes > MAX_PROMPT_BYTES) {
        halt('prompt-too-large'); fail('invalid-request', 'Outgoing payload exceeds the registered byte limit.');
      }
      const reservedInputTokens = promptUtf8Bytes + envelope;
      const reservationNanoCny = reservedInputTokens * ledger.inputNanoCnyPerToken + input.maxOutputTokens * ledger.outputNanoCnyPerToken;
      if (!finiteSafeInteger(reservationNanoCny) || ledger.committedNanoCny + reservationNanoCny > ledger.budgetNanoCny) {
        halt('budget-limit'); fail('budget-limit', 'The next conservative reservation exceeds the remaining authorized budget.');
      }
      const reservationId = randomUUID();
      const next = structuredClone(ledger);
      next.reservations.push({ reservationId, requestId: input.requestId, purpose: input.purpose,
        reservedAt: new Date().toISOString(), promptUtf8Bytes, inputEnvelopeTokens: envelope,
        reservedInputTokens, maxOutputTokens: input.maxOutputTokens,
        reservationNanoCny, committedNanoCny: reservationNanoCny, state: 'reserved' });
      refreshTotals(next); persist(next);
      return { reservationId, reservedInputTokens, reservedCny: reservationNanoCny / NANO_CNY };
    },
    settle(reservationId, input) {
      requireActive();
      if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['outcome', 'usage'].includes(key))) {
        halt('invalid-settlement'); fail('invalid-settlement', 'Settlement contains unknown fields.');
      }
      const next = structuredClone(ledger);
      const entry = next.reservations.find(item => item.reservationId === reservationId);
      if (!entry || entry.state !== 'reserved' || !['succeeded', 'failed', 'cancelled'].includes(input.outcome)) {
        halt('invalid-settlement'); fail('invalid-settlement', 'Only an outstanding reservation can be settled once.');
      }
      entry.finishedAt = new Date().toISOString(); entry.outcome = input.outcome;
      const usage = input.usage;
      const validUsage = usage !== null && typeof usage === 'object' && Object.keys(usage).every(key => ['inputTokens', 'outputTokens'].includes(key)) && finiteSafeInteger(usage.inputTokens) && finiteSafeInteger(usage.outputTokens);
      let reason: string | undefined;
      if (!validUsage) reason = 'unknown-usage';
      else {
        const actualNanoCny = usage.inputTokens * next.inputNanoCnyPerToken + usage.outputTokens * next.outputNanoCnyPerToken;
        if (!finiteSafeInteger(actualNanoCny)) reason = 'unsafe-usage-cost';
        else {
          entry.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
          entry.actualNanoCny = actualNanoCny;
          if (usage.inputTokens > entry.reservedInputTokens || usage.outputTokens > entry.maxOutputTokens || actualNanoCny > entry.reservationNanoCny) reason = 'usage-exceeded-reservation';
        }
      }
      if (input.outcome !== 'succeeded') reason = `request-${input.outcome}`;
      if (reason) {
        entry.state = 'uncertain'; entry.stopReason = reason;
        entry.committedNanoCny = Math.max(entry.reservationNanoCny, entry.actualNanoCny ?? 0);
        next.state = 'halted'; next.stopReason = reason;
      } else {
        entry.state = 'settled'; entry.committedNanoCny = entry.actualNanoCny!;
      }
      refreshTotals(next); persist(next);
      return structuredClone(ledger);
    },
    snapshot() {
      const snapshot = structuredClone(ledger);
      if (poisoned) { snapshot.state = 'halted'; snapshot.storageStatus = 'uncertain'; snapshot.stopReason = 'storage-failed'; }
      return snapshot;
    },
    stop(reason) {
      requireActive();
      if (!validIdentifier(reason)) fail('invalid-request', 'Stop reason must be a safe identifier, not provider text.');
      halt(reason); return structuredClone(ledger);
    },
    close() {
      if (closed) return;
      try {
        if (!poisoned) {
          const next = structuredClone(ledger);
          const outstanding = next.reservations.filter(entry => entry.state === 'reserved');
          for (const entry of outstanding) { entry.state = 'uncertain'; entry.stopReason = 'closed-with-pending-request'; }
          if (outstanding.length) { next.state = 'halted'; next.stopReason = 'closed-with-pending-request'; }
          else if (next.state === 'active') next.state = 'closed';
          refreshTotals(next); persist(next);
        }
      } finally { closed = true; releaseOwnLock(); }
    },
  };
}

/** Safe path convention for command-line callers; this function does not create files. */
export function experimentLedgerPath(directory: string, experimentId: string): string {
  if (!isAbsolute(directory) || !validIdentifier(experimentId)) fail('invalid-config', 'Ledger directory and experiment identifier are invalid.');
  return resolve(directory, `${basename(experimentId)}.budget.json`);
}
