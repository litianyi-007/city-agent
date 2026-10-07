import { createDecipheriv, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { RoleModelConfig } from '../harness';

type CredentialFailure = 'INVALID_SELECTOR' | 'UNSAFE_STORE' | 'STORE_BUSY' | 'NO_MATCH' | 'INVALID_CREDENTIAL' | 'READ_FAILED';
export class ProbeCredentialError extends Error {
  constructor(public readonly code: CredentialFailure) {
    super(`既有研究员凭据读取被拒绝（${code}）；未修改存储或调用模型。`);
  }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const ROOT = 'https://api.deepseek.com';
const normalizeRoot = (value: unknown) => typeof value === 'string' && [ROOT, ROOT + '/'].includes(value) ? ROOT : null;
const identity = (stat: Awaited<ReturnType<typeof lstat>>) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}:${stat.gid}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

async function safeDirectory(path: string): Promise<string> {
  const ancestors: string[] = [];
  for (let current = path; ; current = dirname(current)) { ancestors.unshift(current); if (dirname(current) === current) break; }
  const parts: string[] = [];
  for (const ancestor of ancestors) {
    const stat = await lstat(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProbeCredentialError('UNSAFE_STORE');
    // Directory mtime is deliberately excluded: this helper does not own unrelated application files.
    parts.push(`${ancestor}:${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}:${stat.gid}`);
  }
  if (await realpath(path) !== path) throw new ProbeCredentialError('UNSAFE_STORE');
  return parts.join('\n');
}

async function safeFile(path: string, maximumBytes: number, keepBytes = false) {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maximumBytes || await realpath(path) !== path) throw new ProbeCredentialError('UNSAFE_STORE');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (identity(await handle.stat()) !== identity(before)) throw new ProbeCredentialError('UNSAFE_STORE');
    const hash = createHash('sha256'); let count = 0; const chunks: Buffer[] = [];
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const bytes = Buffer.from(chunk); count += bytes.byteLength;
      if (count > maximumBytes) throw new ProbeCredentialError('UNSAFE_STORE');
      hash.update(bytes); if (keepBytes) chunks.push(bytes);
    }
    if (count !== before.size || identity(await handle.stat()) !== identity(before) || identity(await lstat(path)) !== identity(before)) throw new ProbeCredentialError('UNSAFE_STORE');
    return { signature: `${identity(before)}:${hash.digest('hex')}`, size: count, bytes: keepBytes ? Buffer.concat(chunks) : undefined };
  } finally { await handle.close(); }
}

const STORE_FILES = ['city-agent.sqlite', 'city-agent.sqlite-wal', 'city-agent.sqlite-shm', 'city-agent.sqlite-journal', 'encryption.key'];
const MAX_STORE_BYTES = 32_000_000;
async function inventory(store: string, keepBytes = false) {
  const names = (await fs.readdir(store)).sort();
  if (!names.includes('city-agent.sqlite') || !names.includes('encryption.key') || names.some(name => name !== 'runs' && !STORE_FILES.includes(name))) throw new ProbeCredentialError('UNSAFE_STORE');
  const files = new Map<string, Awaited<ReturnType<typeof safeFile>>>(); let total = 0;
  for (const name of names) {
    if (name === 'runs') {
      // Production CityStore may own a runs directory. Only its own identity is checked; never traverse, read or copy its contents.
      const path = join(store, name), stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== path) throw new ProbeCredentialError('UNSAFE_STORE');
      files.set(name, { signature: `directory:${identity(stat)}`, size: 0, bytes: undefined }); continue;
    }
    const file = await safeFile(join(store, name), name === 'encryption.key' ? 32 : MAX_STORE_BYTES, keepBytes);
    total += file.size; if (total > MAX_STORE_BYTES) throw new ProbeCredentialError('UNSAFE_STORE');
    // A rollback journal might require recovery. This reader never recovers or guesses whether it is hot.
    if (name === 'city-agent.sqlite-journal' && file.size !== 0) throw new ProbeCredentialError('STORE_BUSY');
    files.set(name, file);
  }
  return { signature: JSON.stringify([...files].map(([name, file]) => [name, file.signature])), files };
}

/** Strict coherent WAL subset, per https://www.sqlite.org/fileformat2.html#walformat and #walchecksum.
 * Reject stale reset tails, incomplete/uncommitted tails and any corruption rather than falling back to old DB pages.
 */
function validateDatabaseBytes(database: Buffer, wal?: Buffer): void {
  if (database.length < 512 || !database.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  const storedPage = database.readUInt16BE(16), pageSize = storedPage === 1 ? 65536 : storedPage;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || database.length % pageSize !== 0
    || ![1, 2].includes(database[18]) || database[18] !== database[19]) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  if (!wal?.length) return;
  if (wal.length < 32 || database[18] !== 2) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  const magic = wal.readUInt32BE(0), frameBytes = pageSize + 24;
  if (![0x377f0682, 0x377f0683].includes(magic) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== pageSize
    || (wal.length - 32) % frameBytes !== 0) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  let s0 = 0, s1 = 0;
  const word = (offset: number) => magic === 0x377f0683 ? wal.readUInt32BE(offset) : wal.readUInt32LE(offset);
  const checksum = (start: number, end: number) => {
    for (let offset = start; offset < end; offset += 8) { s0 = (s0 + word(offset) + s1) >>> 0; s1 = (s1 + word(offset + 4) + s0) >>> 0; }
  };
  checksum(0, 24);
  if (s0 !== wal.readUInt32BE(24) || s1 !== wal.readUInt32BE(28)) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  let lastCommit = 0;
  for (let at = 32; at < wal.length; at += frameBytes) {
    const page = wal.readUInt32BE(at), commit = wal.readUInt32BE(at + 4);
    if (!page || page > 0xffff_fffe || commit > 0xffff_fffe || !wal.subarray(at + 8, at + 16).equals(wal.subarray(16, 24))) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    checksum(at, at + 8); checksum(at + 24, at + frameBytes);
    if (s0 !== wal.readUInt32BE(at + 16) || s1 !== wal.readUInt32BE(at + 20)) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    lastCommit = commit;
  }
  if (wal.length > 32 && !lastCommit) throw new ProbeCredentialError('STORE_BUSY');
}

/** Reject duplicate JSON keys instead of letting JSON.parse silently replace the selector. */
function publicAgent(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw) > 64_000) throw new ProbeCredentialError('INVALID_CREDENTIAL');
  const result: unknown = JSON.parse(raw); let index = 0;
  const white = () => { while (/\s/.test(raw[index] ?? '') && index < raw.length) index++; };
  const string = () => {
    const start = index++;
    while (index < raw.length) { const char = raw[index++]; if (char === '\\') index++; else if (char === '"') return JSON.parse(raw.slice(start, index)) as string; }
    throw new ProbeCredentialError('INVALID_CREDENTIAL');
  };
  const visit = (depth: number): void => {
    if (depth > 64) throw new ProbeCredentialError('INVALID_CREDENTIAL'); white();
    if (raw[index] === '{') {
      index++; white(); const keys = new Set<string>(); if (raw[index] === '}') { index++; return; }
      do { white(); const key = string(); if (keys.has(key)) throw new ProbeCredentialError('INVALID_CREDENTIAL'); keys.add(key); white(); index++; visit(depth + 1); white();
        if (raw[index] === '}') { index++; return; } index++; } while (index < raw.length);
    } else if (raw[index] === '[') {
      index++; white(); if (raw[index] === ']') { index++; return; }
      do { visit(depth + 1); white(); if (raw[index] === ']') { index++; return; } index++; } while (index < raw.length);
    } else if (raw[index] === '"') string(); else while (index < raw.length && !/[\s,}\]]/.test(raw[index])) index++;
  };
  visit(0); if (!object(result)) throw new ProbeCredentialError('INVALID_CREDENTIAL'); return result;
}

/** Reuse one encrypted researcher row, without constructing CityStore or modifying any source file. */
export async function loadProbeCredential(storeDirectory: string, publicModel: { provider: string; baseUrl: string; modelId: string }): Promise<RoleModelConfig> {
  let key: Buffer | undefined, plaintext: Buffer | undefined, db: DatabaseSync | undefined, ownedSnapshot: string | undefined, snapshotParent: string | undefined;
  let sourceFiles: Awaited<ReturnType<typeof inventory>> | undefined, result: RoleModelConfig | undefined, primary: ProbeCredentialError | undefined;
  let originalStore: string | undefined, originalDirectorySignature: string | undefined;
  try {
    if (!object(publicModel) || Object.keys(publicModel).length !== 3 || !Object.keys(publicModel).every(name => ['provider', 'baseUrl', 'modelId'].includes(name))
      || publicModel.provider !== 'deepseek' || normalizeRoot(publicModel.baseUrl) === null || publicModel.modelId !== 'deepseek-flash') throw new ProbeCredentialError('INVALID_SELECTOR');
    if (typeof storeDirectory !== 'string' || !storeDirectory.trim() || storeDirectory.length > 8192 || storeDirectory.includes('\0')) throw new ProbeCredentialError('UNSAFE_STORE');
    const store = resolve(storeDirectory), directoryBefore = await safeDirectory(store);
    originalStore = store; originalDirectorySignature = directoryBefore;
    sourceFiles = await inventory(store, true); key = sourceFiles.files.get('encryption.key')!.bytes!;
    if (key.byteLength !== 32) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    validateDatabaseBytes(sourceFiles.files.get('city-agent.sqlite')!.bytes!, sourceFiles.files.get('city-agent.sqlite-wal')?.bytes);
    // SQLite readOnly can create or update WAL/SHM sidecars. Never open SQLite in the source directory.
    // A short-lived encrypted DB+WAL snapshot includes committed WAL rows without copying the encryption key.
    snapshotParent = await realpath(tmpdir());
    ownedSnapshot = await fs.mkdtemp(join(snapshotParent, 'city-probe-credential-')); await fs.chmod(ownedSnapshot, 0o700);
    await safeDirectory(ownedSnapshot);
    for (const name of ['city-agent.sqlite', 'city-agent.sqlite-wal']) {
      const file = sourceFiles.files.get(name);
      if (file) {
        const target = join(ownedSnapshot, name);
        await fs.writeFile(target, file.bytes!, { mode: 0o600, flag: 'wx' }); await fs.chmod(target, 0o600);
        const copied = await safeFile(target, MAX_STORE_BYTES);
        if ((await lstat(target)).mode % 0o1000 !== 0o600 || !copied.signature.endsWith(':' + createHash('sha256').update(file.bytes!).digest('hex'))) throw new ProbeCredentialError('UNSAFE_STORE');
      }
    }
    db = new DatabaseSync(join(ownedSnapshot, 'city-agent.sqlite'), { readOnly: true, allowExtension: false });
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.length !== 1 || integrity[0].quick_check !== 'ok' || db.prepare("SELECT type FROM sqlite_schema WHERE name='agents'").get()?.type !== 'table') throw new ProbeCredentialError('INVALID_CREDENTIAL');
    const columns = db.prepare('PRAGMA table_info(agents)').all();
    if (columns.length !== 3 || !['id', 'data', 'secret'].every(name => columns.some(column => column.name === name && column.type === 'TEXT'))
      || columns.find(column => column.name === 'id')?.pk !== 1 || columns.find(column => column.name === 'data')?.notnull !== 1) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    const rows = db.prepare('SELECT data, secret FROM agents WHERE secret IS NOT NULL ORDER BY id LIMIT 1001').all();
    if (rows.length > 1000) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    let encrypted: string | undefined;
    for (const row of rows) {
      if (typeof row.data !== 'string' || typeof row.secret !== 'string') throw new ProbeCredentialError('INVALID_CREDENTIAL');
      const agent = publicAgent(row.data);
      if (agent.role === 'researcher' && agent.enabled === true && agent.provider === publicModel.provider
        && normalizeRoot(agent.baseUrl) === ROOT && agent.modelId === publicModel.modelId) { encrypted = row.secret; break; }
    }
    db.close(); db = undefined;
    if (!encrypted) throw new ProbeCredentialError('NO_MATCH');
    if (encrypted.length > 12_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encrypted)) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    const payload = Buffer.from(encrypted, 'base64');
    if (payload.length < 29 || payload.toString('base64') !== encrypted) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12)); decipher.setAuthTag(payload.subarray(12, 28));
    plaintext = Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
    const apiKey = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!/^[\x21-\x7e]{1,8000}$/.test(apiKey)) throw new ProbeCredentialError('INVALID_CREDENTIAL');
    if (await safeDirectory(store) !== directoryBefore || (await inventory(store)).signature !== sourceFiles.signature) throw new ProbeCredentialError('UNSAFE_STORE');
    result = { provider: 'deepseek', baseUrl: ROOT, modelId: 'deepseek-flash', apiKey };
  } catch (error) {
    primary = error instanceof ProbeCredentialError ? error : new ProbeCredentialError('READ_FAILED');
  } finally {
    key?.fill(0); plaintext?.fill(0);
    // A cleanup error must not expose a SQLite/native message, filename, row or credential.
    if (db) { try { db.close(); } catch { primary ??= new ProbeCredentialError('READ_FAILED'); } }
    for (const file of sourceFiles?.files.values() ?? []) file.bytes?.fill(0);
    if (ownedSnapshot) {
      try {
        if (dirname(ownedSnapshot) !== snapshotParent || !ownedSnapshot.startsWith(join(snapshotParent!, 'city-probe-credential-'))) throw new Error('Not an owned snapshot.');
        await safeDirectory(ownedSnapshot);
        await fs.rm(ownedSnapshot, { recursive: true, force: false });
      } catch { primary ??= new ProbeCredentialError('READ_FAILED'); }
    }
  }
  // Hold the source-stability gate through owned cleanup too; cleanup failure must never return a credential.
  if (!primary && result && originalStore && sourceFiles) {
    try {
      if (await safeDirectory(originalStore) !== originalDirectorySignature || (await inventory(originalStore)).signature !== sourceFiles.signature) throw new ProbeCredentialError('UNSAFE_STORE');
    } catch (error) { primary = error instanceof ProbeCredentialError ? error : new ProbeCredentialError('READ_FAILED'); }
  }
  if (primary) throw primary;
  return result!;
}
