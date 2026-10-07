import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { inspectVerifierStudyLedgerEvidence } from './verifier-study-ledger.js';

export const VERIFIER_STUDY_ARCHIVE_VERSION = 'verifier-study-archive-inspection-v1' as const;
export const VERIFIER_OBSERVED_01_ARCHIVE_SHA256 = 'a1d171a2e9106327a0a4d758b5e32b3f1cdf0f159c514c538efa37ad8baed987';
export const VERIFIER_STUDY_ARCHIVE_LIMITS = Object.freeze({ compressedBytes: 8 * 1024 * 1024,
  decompressedBytes: 64 * 1024 * 1024, entries: 12_300, manifestBytes: 8 * 1024 * 1024,
  eventBytes: 1024 * 1024, metadataBytes: 4096 });
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => { const text = JSON.stringify(value); if (typeof text !== 'string') return refuse('recorded-json'); return sha(text); };
const LEDGER_NAME = /^run\/(?:manifest|event-[0-9]{6}(?:\.commit)?)\.json$/;
const FILE_NAME = /^event-([0-9]{6})\.json$/;
const MARKER_NAME = /^event-([0-9]{6})\.commit\.json$/;
const APPLE_PREFIX = Buffer.from('00051607000200004d6163204f5320582020202020202020000200000009000000320000007100000002000000a300000000000000000000000000000000000000000000000000000000000000000000000000004154545200000000000000a3000000980000000b00000000000000000000000000000001000000980000000b000015636f6d2e6170706c652e70726f76656e616e636500', 'hex');

export class VerifierStudyArchiveError extends Error {
  constructor(readonly code: string) { super(`Verifier study archive inspection failed: ${code}`); this.name = 'VerifierStudyArchiveError'; }
}
const refuse = (code: string): never => { throw new VerifierStudyArchiveError(code); };
function utf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) return refuse('invalid-utf8');
    return text;
  } catch { return refuse('invalid-utf8'); }
}
function cstring(bytes: Buffer): string {
  const end = bytes.indexOf(0); const content = end === -1 ? bytes : bytes.subarray(0, end);
  if (end !== -1 && !bytes.subarray(end).every(byte => byte === 0)) return refuse('tar-string-padding');
  if (!content.every(byte => byte >= 0x20 && byte <= 0x7e)) return refuse('tar-header-text');
  return content.toString('ascii');
}
function octal(bytes: Buffer): number {
  // No base-256, signs, extensions, truncation or integer overflow.
  const text = bytes.toString('ascii').replace(/[\0 ]+$/g, '').replace(/^ +/g, '');
  if (!/^[0-7]{1,12}$/.test(text) || bytes.some(byte => byte > 0x7f)) return refuse('tar-octal');
  const value = Number.parseInt(text, 8); if (!Number.isSafeInteger(value)) return refuse('tar-octal'); return value;
}
function metadataTarget(name: string, kind: 'apple' | 'pax'): string | null {
  if (kind === 'apple') {
    if (name === '._run') return 'run/';
    if (name.startsWith('run/._') && LEDGER_NAME.test(`run/${name.slice(6)}`)) return `run/${name.slice(6)}`;
  } else {
    if (name === 'PaxHeader/run') return 'run/';
    if (name.startsWith('run/PaxHeader/') && LEDGER_NAME.test(`run/${name.slice(14)}`)) return `run/${name.slice(14)}`;
  }
  return null;
}
/** Only the observed mtime/provenance PAX metadata is allowed. It is ignored,
 * never applied. path/linkpath/size/global headers and unknown extensions fail. */
function paxProvenance(body: Buffer): Buffer | null {
  const fields = new Map<string, Buffer>(); let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1 || space - offset > 6) return refuse('pax-framing');
    const lengthText = body.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) return refuse('pax-framing');
    const length = Number(lengthText); const end = offset + length;
    if (!Number.isSafeInteger(length) || end > body.length || end <= space + 1 || body[end - 1] !== 0x0a) return refuse('pax-framing');
    const equal = body.indexOf(0x3d, space + 1);
    if (equal === -1 || equal >= end - 1) return refuse('pax-framing');
    const keyBytes = body.subarray(space + 1, equal);
    if (!keyBytes.every(byte => byte >= 0x21 && byte <= 0x7e)) return refuse('pax-key');
    const key = keyBytes.toString('ascii');
    if (!['mtime', 'LIBARCHIVE.xattr.com.apple.provenance', 'SCHILY.xattr.com.apple.provenance'].includes(key) || fields.has(key)) return refuse('pax-unsupported-field');
    fields.set(key, body.subarray(equal + 1, end - 1)); offset = end;
  }
  const mtime = fields.get('mtime');
  if (!mtime || !/^[0-9]{1,12}(?:\.[0-9]{1,12})?$/.test(mtime.toString('ascii')) || mtime.some(byte => byte > 0x7f)) return refuse('pax-mtime');
  const encoded = fields.get('LIBARCHIVE.xattr.com.apple.provenance'); const binary = fields.get('SCHILY.xattr.com.apple.provenance');
  if (!encoded && !binary) return null;
  if (!encoded || !binary || binary.length !== 11) return refuse('pax-provenance');
  const text = encoded.toString('ascii'); const decoded = Buffer.from(text, 'base64');
  if (!encoded.every(byte => byte <= 0x7f) || !/^[A-Za-z0-9+/]{15}=?$/.test(text) || decoded.length !== 11 || decoded.toString('base64').replace(/=+$/, '') !== text.replace(/=+$/, '') || !decoded.equals(binary)) return refuse('pax-provenance');
  return binary;
}
function parseTar(bytes: Buffer) {
  if (bytes.length % 512 !== 0) return refuse('tar-truncated');
  const names = new Set<string>(); const files = new Map<string, string>();
  let offset = 0; let entries = 0; let directories = 0; let paxHeaders = 0; let appleDoubleFiles = 0; let ended = false;
  let apple: { target: string; provenance: Buffer } | null = null;
  let pax: { target: string; provenance: Buffer | null } | null = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > bytes.length || !bytes.subarray(offset).every(byte => byte === 0)) return refuse('tar-end-marker');
      ended = true; break;
    }
    if (++entries > VERIFIER_STUDY_ARCHIVE_LIMITS.entries) return refuse('tar-entry-limit');
    let checksum = 0; for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 0x20 : header[index];
    if (checksum !== octal(header.subarray(148, 156))) return refuse('tar-checksum');
    if (!header.subarray(257, 265).equals(Buffer.from('ustar\0' + '00', 'ascii'))) return refuse('tar-format');
    const prefix = cstring(header.subarray(345, 500)); const leaf = cstring(header.subarray(0, 100));
    const name = prefix ? `${prefix}/${leaf}` : leaf; const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '.' || part === '..') || names.has(name)) return refuse('tar-path-or-duplicate');
    names.add(name);
    if (cstring(header.subarray(157, 257)) !== '' || !['0', '5', 'x'].includes(type)) return refuse('tar-link-or-unsupported-type');
    const size = octal(header.subarray(124, 136));
    const maximum = type === 'x' || metadataTarget(name, 'apple') ? VERIFIER_STUDY_ARCHIVE_LIMITS.metadataBytes
      : name === 'run/manifest.json' ? VERIFIER_STUDY_ARCHIVE_LIMITS.manifestBytes : VERIFIER_STUDY_ARCHIVE_LIMITS.eventBytes;
    if (size > maximum) return refuse('tar-entry-size');
    const next = offset + 512 + Math.ceil(size / 512) * 512;
    if (next > bytes.length) return refuse('tar-truncated');
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    if (!bytes.subarray(offset + 512 + size, next).every(byte => byte === 0)) return refuse('tar-data-padding');
    offset = next;
    const appleTarget = metadataTarget(name, 'apple');
    if (appleTarget) {
      if (type !== '0' || apple || pax || body.length !== APPLE_PREFIX.length + 11 || !body.subarray(0, APPLE_PREFIX.length).equals(APPLE_PREFIX)) return refuse('appledouble-format-or-order');
      apple = { target: appleTarget, provenance: body.subarray(APPLE_PREFIX.length) }; appleDoubleFiles++; continue;
    }
    if (type === 'x') {
      const target = metadataTarget(name, 'pax');
      if (!target || pax || (apple && apple.target !== target)) return refuse('pax-target-or-order');
      const provenance = paxProvenance(body);
      if (apple && (!provenance || !apple.provenance.equals(provenance))) return refuse('metadata-provenance-mismatch');
      pax = { target, provenance }; paxHeaders++; continue;
    }
    if ((apple && apple.target !== name) || (pax && pax.target !== name)) return refuse('metadata-orphan');
    apple = null; pax = null;
    if (type === '5') {
      if (name !== 'run/' || size !== 0 || ++directories !== 1) return refuse('tar-directory');
    } else {
      if (!LEDGER_NAME.test(name)) return refuse('tar-unexpected-file');
      files.set(name.slice(4), utf8(body));
    }
  }
  if (!ended || apple || pax || directories !== 1 || !files.has('manifest.json')) return refuse('tar-incomplete');
  const events = [...files.keys()].filter(name => FILE_NAME.test(name)).sort();
  const markers = [...files.keys()].filter(name => MARKER_NAME.test(name)).sort();
  if (events.length !== markers.length || events.some((name, index) => name !== `event-${String(index + 1).padStart(6, '0')}.json`)
    || markers.some((name, index) => name !== `event-${String(index + 1).padStart(6, '0')}.commit.json`)) return refuse('ledger-sequence-or-unconfirmed-tail');
  return { manifestText: files.get('manifest.json')!, eventTexts: events.map(name => files.get(name)!), commitTexts: markers.map(name => files.get(name)!),
    inventory: { physicalEntries: entries, ledgerJsonFiles: files.size, directories, paxHeaders, appleDoubleFiles } };
}

/** Inspect bytes, not a directory. No extraction, shell, paths from the tar,
 * network, repair, replay, credentials or append-capable ledger object. */
export function inspectVerifierStudyArchive(input: Uint8Array, expectedSha256: string) {
  if (!(input instanceof Uint8Array) || input.byteLength > VERIFIER_STUDY_ARCHIVE_LIMITS.compressedBytes || input.byteLength === 0) return refuse('compressed-size');
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) return refuse('expected-sha256');
  const compressed = Buffer.from(input); const archiveSha256 = sha(compressed);
  if (archiveSha256 !== expectedSha256) return refuse('archive-sha256-mismatch');
  let decompressed: Buffer;
  try { decompressed = gunzipSync(compressed, { maxOutputLength: VERIFIER_STUDY_ARCHIVE_LIMITS.decompressedBytes }); }
  catch { return refuse('gzip-invalid-or-size'); }
  const parsed = parseTar(decompressed);
  let evidence: ReturnType<typeof inspectVerifierStudyLedgerEvidence>;
  try { evidence = inspectVerifierStudyLedgerEvidence({ manifestText: parsed.manifestText, eventTexts: parsed.eventTexts, commitTexts: parsed.commitTexts }); }
  catch { return refuse('ledger-integrity'); }
  const manifest = evidence.manifest.manifest; const source = manifest.executionSource;
  if (typeof source !== 'string' || !['injected-test', 'loopback-engineering', 'real-provider'].includes(source)
    || manifest.version !== (source === 'injected-test' ? 'verifier-study-injected-v1' : 'verifier-study-observed-v1')) return refuse('recorded-study-provenance');
  let sourceCommit: string | null = null;
  if (source !== 'injected-test') {
    const plan = manifest.observedPlan as Record<string, unknown> | undefined;
    if (!plan || plan.version !== 'verifier-study-observed-policy-v1' || plan.executionSource !== source) return refuse('recorded-plan');
    const { frozenStudySha256, ...body } = plan;
    const recordedSource = plan.source as { commit?: unknown } | undefined;
    if (digest(body) !== frozenStudySha256 || digest(plan.source) !== plan.sourceSha256 || digest(plan.configuration) !== plan.configurationSha256
      || digest({ limits: plan.limits, reservations: plan.reservations }) !== plan.limitsSha256
      || typeof recordedSource?.commit !== 'string' || !/^[a-f0-9]{40}$/.test(recordedSource.commit)) return refuse('recorded-freeze');
    sourceCommit = recordedSource.commit;
  }
  const events = evidence.events; const intents = events.filter(event => event.type === 'call-intent');
  let knownInputTokens = 0; let knownOutputTokens = 0; let knownEstimatedCost = 0; let unknownCalls = 0;
  for (const intent of intents) {
    const result = events.find(event => event.type === 'call-result' && event.payload.callId === intent.payload.callId);
    const usage = result?.payload.usage as { complete?: unknown; currency?: unknown; inputTokens?: number; outputTokens?: number; estimatedCost?: number } | undefined;
    if (usage?.complete !== true || usage.currency !== 'USD' || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens! < 0
      || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens! < 0 || !Number.isFinite(usage.estimatedCost) || usage.estimatedCost! < 0) unknownCalls++;
    else { knownInputTokens += usage.inputTokens!; knownOutputTokens += usage.outputTokens!; knownEstimatedCost += usage.estimatedCost!; }
  }
  if (!Number.isSafeInteger(knownInputTokens) || !Number.isSafeInteger(knownOutputTokens) || !Number.isFinite(knownEstimatedCost)) return refuse('usage-total-overflow');
  const terminal = events.at(-1)?.type === 'run-end' ? events.at(-1)! : null;
  const usage = Object.freeze({ complete: unknownCalls === 0, knownInputTokens, knownOutputTokens, knownEstimatedCost,
    currency: 'USD' as const, unknownCalls, boundary: source === 'real-provider' ? 'recorded-declared-rate-estimate-not-provider-bill' : 'recorded-fixture-accounting-not-model-measurement' });
  return Object.freeze({ version: VERIFIER_STUDY_ARCHIVE_VERSION, mode: 'read-only-archive-integrity' as const,
    archiveVerified: true, hashVerified: true, archiveSha256, expectedSha256, authenticity: 'not-signed-or-independently-authenticated' as const,
    extracted: false, resumed: false, repaired: false, inventory: Object.freeze(parsed.inventory),
    runId: evidence.manifest.runId, recordedExecutionSource: source, sourceCommit,
    recordedDirectorySha256: evidence.recordedDirectoryHash, directoryScope: 'recorded-only-not-current-extraction-path' as const,
    state: terminal ? 'terminal' as const : 'incomplete' as const, terminalStatus: terminal?.payload.status ?? null,
    eventCount: events.length, decisionCount: events.filter(event => event.type === 'decision-result').length,
    callbackIntents: intents.length, oracleCount: events.filter(event => event.type === 'oracle-result').length,
    usage });
}

/** Optional caller-selected archive FILE, never an extraction root. Exclusive
 * read-only descriptor; no symlinks, nonregular files or uncontrolled sizes. */
export function inspectVerifierStudyArchiveFile(file: string, expectedSha256: string) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) return refuse('expected-sha256');
  let descriptor: number | undefined;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > VERIFIER_STUDY_ARCHIVE_LIMITS.compressedBytes) return refuse('archive-file');
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const opened = fstatSync(descriptor);
    if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino || before.size !== opened.size) return refuse('archive-file-changed');
    const bytes = readFileSync(descriptor); const after = fstatSync(descriptor);
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return refuse('archive-file-changed');
    return inspectVerifierStudyArchive(bytes, expectedSha256);
  } catch (error) { if (error instanceof VerifierStudyArchiveError) throw error; return refuse('archive-file'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}
