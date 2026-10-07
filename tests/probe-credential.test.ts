import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { loadProbeCredential, ProbeCredentialError } from '../server/research/probe-credential';

const publicModel = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' };
const KEY = 'offline-credential-fixture-key';
const agent = { ...publicModel, role: 'researcher', enabled: true };
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
// Independent BigInt checksum oracle, based on SQLite's public format, not the helper's uint32 implementation.
function restampWal(bytes: Buffer, bigEndian = false) {
  bytes.writeUInt32BE(bigEndian ? 0x377f0683 : 0x377f0682, 0);
  let left = 0n, right = 0n; const mask = 0xffff_ffffn;
  const compute = (from: number, to: number) => { for (let i = from; i < to; i += 8) {
    left = (left + BigInt(bigEndian ? bytes.readUInt32BE(i) : bytes.readUInt32LE(i)) + right) & mask;
    right = (right + BigInt(bigEndian ? bytes.readUInt32BE(i + 4) : bytes.readUInt32LE(i + 4)) + left) & mask;
  } };
  compute(0, 24); bytes.writeUInt32BE(Number(left), 24); bytes.writeUInt32BE(Number(right), 28);
  const frameSize = bytes.readUInt32BE(8) + 24;
  for (let at = 32; at < bytes.length; at += frameSize) {
    compute(at, at + 8); compute(at + 24, at + frameSize); bytes.writeUInt32BE(Number(left), at + 16); bytes.writeUInt32BE(Number(right), at + 20);
  }
  return bytes;
}
function payload(secret: string | Uint8Array, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
async function fixture(options: { wal?: boolean; rows?: { id: string; data: unknown; secret?: string | null }[]; secret?: string | Uint8Array; keyLength?: number } = {}) {
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'city-credential-test-'));
  const key = randomBytes(options.keyLength ?? 32); await fs.writeFile(join(directory, 'encryption.key'), key, { mode: 0o600 });
  const db = new DatabaseSync(join(directory, 'city-agent.sqlite'));
  if (options.wal) db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE agents(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret TEXT); CREATE TABLE resident_agents(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret TEXT)');
  const secret = key.length === 32 ? payload(options.secret ?? KEY, key) : payload(KEY, randomBytes(32));
  for (const row of options.rows ?? [{ id: 'configured', data: agent }]) db.prepare('INSERT INTO agents VALUES(?,?,?)').run(row.id, typeof row.data === 'string' ? row.data : JSON.stringify(row.data), row.secret === undefined ? secret : row.secret);
  db.prepare('INSERT INTO resident_agents VALUES(?,?,?)').run('resident-only', JSON.stringify(agent), key.length === 32 ? payload('offline-resident-never-selected', key) : secret);
  if (!options.wal) db.close();
  return { directory, key, db: options.wal ? db : undefined, close: async () => { if (options.wal) db.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}
async function sourceState(directory: string) {
  const files = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const stat = await fs.lstat(join(directory, name));
    files.push({ name, mode: stat.mode, size: stat.size, hash: stat.isFile() ? digest(await fs.readFile(join(directory, name))) : null });
  }
  return files;
}
const reject = async (operation: Promise<unknown>, code?: string) => assert.rejects(operation, (error: unknown) => {
  assert.ok(error instanceof ProbeCredentialError); if (code) assert.equal(error.code, code);
  assert.equal(error.message.includes(KEY), false); assert.equal(Object.hasOwn(error, 'cause'), false);
  return true;
});

test('loads one normalized existing encrypted researcher, without changing source bytes or permissions', async t => {
  for (const baseUrl of [publicModel.baseUrl, publicModel.baseUrl + '/']) {
    const f = await fixture({ rows: [{ id: 'configured', data: { ...agent, baseUrl } }] });
    const before = await sourceState(f.directory), snapshots: string[] = [], realMkdtemp = fs.mkdtemp.bind(fs), realWrite = fs.writeFile.bind(fs);
    const make = t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { const path = await realMkdtemp(...args); snapshots.push(String(path)); return path; });
    const write = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      const path = String(args[0]); assert.ok(path.startsWith(snapshots.at(-1)! + '/')); assert.equal(path.endsWith('encryption.key'), false);
      assert.equal((args[2] as any)?.mode, 0o600); return realWrite(...args);
    });
    try {
      assert.deepEqual(await loadProbeCredential(f.directory, { ...publicModel, baseUrl }), { ...publicModel, apiKey: KEY });
      assert.deepEqual(await sourceState(f.directory), before); assert.equal(snapshots.length, 1);
      await assert.rejects(fs.lstat(snapshots[0]), { code: 'ENOENT' });
    } finally { make.mock.restore(); write.mock.restore(); await f.close(); }
  }
});

test('active WAL latest committed credential is read only from a private snapshot, without source sidecar mutation', async t => {
  const f = await fixture({ wal: true }), snapshots: string[] = [], realMkdtemp = fs.mkdtemp.bind(fs);
  f.db!.prepare('UPDATE agents SET secret=? WHERE id=?').run(payload('offline-latest-wal-key', f.key), 'configured');
  const before = await sourceState(f.directory); assert.ok(before.some(file => file.name.endsWith('-wal') && file.size > 0));
  t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { const path = await realMkdtemp(...args); snapshots.push(String(path)); return path; });
  try {
    assert.equal((await loadProbeCredential(f.directory, publicModel)).apiKey, 'offline-latest-wal-key');
    assert.deepEqual(await sourceState(f.directory), before); assert.equal(snapshots.length, 1);
    await assert.rejects(fs.lstat(snapshots[0]), { code: 'ENOENT' });
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('normal production runs directory is allowed without reading or copying its contents; links and regular files are rejected', async t => {
  const f = await fixture(), runs = join(f.directory, 'runs'); await fs.mkdir(runs);
  await fs.writeFile(join(runs, 'unrelated-private-evidence'), 'offline-unrelated-data');
  // An unreadable child proves no recursive inspection is required. Root dir remains a normal directory.
  await fs.chmod(join(runs, 'unrelated-private-evidence'), 0o000);
  const originalReaddir = fs.readdir.bind(fs), originalWrite = fs.writeFile.bind(fs);
  const read = t.mock.method(fs, 'readdir', async (...args: Parameters<typeof fs.readdir>) => {
    assert.notEqual(String(args[0]), runs); return originalReaddir(...args);
  });
  const write = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    assert.equal(String(args[0]).includes('/runs'), false); return originalWrite(...args);
  });
  try { assert.equal((await loadProbeCredential(f.directory, publicModel)).apiKey, KEY); }
  finally { read.mock.restore(); write.mock.restore(); await f.close(); }
  for (const kind of ['symlink', 'file'] as const) {
    const other = await fixture(), target = join(other.directory, 'runs');
    if (kind === 'symlink') await fs.symlink(other.directory, target); else await fs.writeFile(target, 'not-a-directory');
    try { await reject(loadProbeCredential(other.directory, publicModel), 'UNSAFE_STORE'); } finally { await other.close(); }
  }
});

test('both documented WAL checksum byte orders are accepted, with full committed frame chains', async () => {
  for (const bigEndian of [false, true]) {
    const f = await fixture({ wal: true }), walPath = join(f.directory, 'city-agent.sqlite-wal'), original = await fs.readFile(walPath);
    await fs.writeFile(walPath, restampWal(Buffer.from(original), bigEndian)); const before = await sourceState(f.directory);
    try { assert.equal((await loadProbeCredential(f.directory, publicModel)).apiKey, KEY); assert.deepEqual(await sourceState(f.directory), before); }
    finally { await fs.writeFile(walPath, original); await f.close(); }
  }
});

test('corrupt WAL cannot be ignored in favor of an older valid main-database credential', async () => {
  for (const mutation of ['magic', 'version', 'page', 'header-checksum', 'salt', 'frame-checksum', 'page-content', 'truncated', 'uncommitted'] as const) {
    const f = await fixture({ wal: true }); f.db!.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    f.db!.prepare('UPDATE agents SET secret=? WHERE id=?').run(payload('offline-new-key-never-fallback', f.key), 'configured');
    const walPath = join(f.directory, 'city-agent.sqlite-wal'), original = await fs.readFile(walPath); let bad = Buffer.from(original);
    if (mutation === 'magic') bad.writeUInt32BE(0, 0); if (mutation === 'version') bad.writeUInt32BE(1, 4);
    if (mutation === 'page') bad.writeUInt32BE(512, 8); if (mutation === 'header-checksum') bad[24] ^= 1;
    if (mutation === 'salt') bad[40] ^= 1; if (mutation === 'frame-checksum') bad[48] ^= 1; if (mutation === 'page-content') bad[56] ^= 1;
    if (mutation === 'truncated') bad = bad.subarray(0, bad.length - 1);
    if (mutation === 'uncommitted') { const frameSize = bad.readUInt32BE(8) + 24; bad.writeUInt32BE(0, bad.length - frameSize + 4); restampWal(bad); }
    await fs.writeFile(walPath, bad); const before = await sourceState(f.directory);
    try { await reject(loadProbeCredential(f.directory, publicModel), mutation === 'uncommitted' ? 'STORE_BUSY' : 'INVALID_CREDENTIAL'); assert.deepEqual(await sourceState(f.directory), before); }
    finally { await fs.writeFile(walPath, original); await f.close(); }
  }
});

test('ignores wrong provider/model/role and disabled agents; never uses the resident table', async () => {
  const f = await fixture({ rows: [
    { id: '01', data: { ...agent, provider: 'openai' } }, { id: '02', data: { ...agent, modelId: 'wrong-model' } },
    { id: '03', data: { ...agent, role: 'developer' } }, { id: '04', data: { ...agent, enabled: false } },
    { id: '05', data: { ...agent, enabled: 'true' } }, { id: '06', data: { ...agent, baseUrl: publicModel.baseUrl + '/v1' } },
    { id: '07', data: agent },
  ] });
  try { assert.equal((await loadProbeCredential(f.directory, publicModel)).apiKey, KEY); } finally { await f.close(); }
  const residentOnly = await fixture({ rows: [] });
  try { await reject(loadProbeCredential(residentOnly.directory, publicModel), 'NO_MATCH'); } finally { await residentOnly.close(); }
});

test('invalid public selectors fail before any credential directory or temporary snapshot access', async t => {
  let called = false; t.mock.method(fs, 'mkdtemp', async () => { called = true; throw new Error(KEY); });
  for (const changed of [{ provider: 'openai' }, { modelId: 'wrong' }, { baseUrl: publicModel.baseUrl + '/v1' },
    { baseUrl: publicModel.baseUrl + '//'}, { baseUrl: publicModel.baseUrl + '?key=' + KEY }, { baseUrl: 'https://other.invalid' }]) {
    await reject(loadProbeCredential('/not-a-real-credential-directory', { ...publicModel, ...changed }), 'INVALID_SELECTOR');
  }
  await reject(loadProbeCredential('/not-real', { ...publicModel, apiKey: KEY } as any), 'INVALID_SELECTOR'); assert.equal(called, false);
});

test('first matching row is irreversible: bad encryption never falls back to another key', async () => {
  const f = await fixture({ rows: [{ id: '01', data: agent, secret: Buffer.alloc(29).toString('base64') }, { id: '02', data: agent }] });
  try { await reject(loadProbeCredential(f.directory, publicModel)); } finally { await f.close(); }
});

test('malformed AES payloads, incorrect encryption key length and non-printable/empty secrets are sanitized failures', async () => {
  for (const secret of ['', ' ', 'offline\nkey', 'offline\u0000key', '含中文的Key', Buffer.from([0xff]), 'x'.repeat(8001)]) {
    const f = await fixture({ secret }); try { await reject(loadProbeCredential(f.directory, publicModel)); } finally { await f.close(); }
  }
  for (const encrypted of ['not-base64!', '', Buffer.alloc(27).toString('base64'), Buffer.alloc(28).toString('base64'), Buffer.alloc(29).toString('base64')]) {
    const f = await fixture({ rows: [{ id: 'one', data: agent, secret: encrypted }] }); try { await reject(loadProbeCredential(f.directory, publicModel)); } finally { await f.close(); }
  }
  for (const keyLength of [0, 31, 33]) { const f = await fixture({ keyLength }); try { await reject(loadProbeCredential(f.directory, publicModel)); } finally { await f.close(); } }
});

test('all credential source files can be filesystem read-only and retain exact modes and hashes', async () => {
  const f = await fixture();
  for (const name of await fs.readdir(f.directory)) await fs.chmod(join(f.directory, name), 0o444);
  const before = await sourceState(f.directory); await fs.chmod(f.directory, 0o555);
  try { assert.equal((await loadProbeCredential(f.directory, publicModel)).apiKey, KEY); assert.deepEqual(await sourceState(f.directory), before); }
  finally { await fs.chmod(f.directory, 0o700); await f.close(); }
});

test('missing, non-regular, symbolic credential files and symbolic store ancestors fail without creating source files', async () => {
  for (const name of ['city-agent.sqlite', 'encryption.key']) {
    for (const kind of ['missing', 'directory', 'symlink'] as const) {
      const f = await fixture(), target = join(f.directory, name), saved = join(await fs.realpath(tmpdir()), 'city-saved-' + randomBytes(8).toString('hex'));
      await fs.rename(target, saved);
      if (kind === 'directory') await fs.mkdir(target); if (kind === 'symlink') await fs.symlink(saved, target);
      try { await reject(loadProbeCredential(f.directory, publicModel)); } finally { await fs.rm(saved, { force: true }); await f.close(); }
    }
  }
  const f = await fixture(), parent = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'city-credential-link-test-'));
  await fs.symlink(f.directory, join(parent, 'store-link'));
  try { await reject(loadProbeCredential(join(parent, 'store-link'), publicModel), 'UNSAFE_STORE'); } finally { await fs.rm(parent, { recursive: true, force: true }); await f.close(); }
  const outer = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'city-credential-ancestor-test-')), actual = join(outer, 'actual'); await fs.mkdir(actual);
  const nested = await fixture(); await fs.rename(nested.directory, join(actual, 'store')); await fs.symlink(actual, join(outer, 'ancestor-link'));
  try { await reject(loadProbeCredential(join(outer, 'ancestor-link', 'store'), publicModel), 'UNSAFE_STORE'); } finally { await fs.rm(outer, { recursive: true, force: true }); }
});

test('a source key change or new sidecar while copying makes the entire read fail closed', async t => {
  for (const mutate of ['key', 'sidecar'] as const) {
    const f = await fixture(), realWrite = fs.writeFile.bind(fs); let changed = false;
    const mock = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      await realWrite(...args);
      if (!changed) { changed = true; await realWrite(join(f.directory, mutate === 'key' ? 'encryption.key' : 'city-agent.sqlite-wal'), mutate === 'key' ? randomBytes(32) : Buffer.alloc(0)); }
    });
    try { await reject(loadProbeCredential(f.directory, publicModel), 'UNSAFE_STORE'); assert.equal(changed, true); }
    finally { mock.mock.restore(); await f.close(); }
  }
});

test('copy and temporary creation failure are sanitized and successful cleanup leaves no snapshot', async t => {
  const f = await fixture(), before = await sourceState(f.directory), snapshots: string[] = [], realMkdtemp = fs.mkdtemp.bind(fs);
  const make = t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { const path = await realMkdtemp(...args); snapshots.push(String(path)); return path; });
  const write = t.mock.method(fs, 'writeFile', async () => { throw new Error(`private filesystem failure ${KEY}`); });
  try {
    await reject(loadProbeCredential(f.directory, publicModel), 'READ_FAILED'); assert.deepEqual(await sourceState(f.directory), before);
    await assert.rejects(fs.lstat(snapshots[0]), { code: 'ENOENT' });
  } finally { write.mock.restore(); make.mock.restore(); }
  const creation = t.mock.method(fs, 'mkdtemp', async () => { throw new Error(KEY); });
  try { await reject(loadProbeCredential(f.directory, publicModel), 'READ_FAILED'); assert.deepEqual(await sourceState(f.directory), before); }
  finally { creation.mock.restore(); await f.close(); }
});

test('source mutation during snapshot cleanup is still inside the stability gate', async t => {
  const f = await fixture(), realRemove = fs.rm.bind(fs), realWrite = fs.writeFile.bind(fs);
  const remove = t.mock.method(fs, 'rm', async (...args: Parameters<typeof fs.rm>) => {
    await realRemove(...args); await realWrite(join(f.directory, 'encryption.key'), randomBytes(32));
  });
  try { await reject(loadProbeCredential(f.directory, publicModel), 'UNSAFE_STORE'); } finally { remove.mock.restore(); await f.close(); }
});

test('cleanup failure never returns a credential and does not mask an earlier sanitized primary rejection', async t => {
  const f = await fixture(), missing = await fixture({ rows: [] }), before = await sourceState(f.directory), snapshots: string[] = [], realMkdtemp = fs.mkdtemp.bind(fs), realRemove = fs.rm.bind(fs);
  const make = t.mock.method(fs, 'mkdtemp', async (...args: Parameters<typeof fs.mkdtemp>) => { const path = await realMkdtemp(...args); snapshots.push(String(path)); return path; });
  const remove = t.mock.method(fs, 'rm', async () => { throw new Error(KEY); });
  try {
    await reject(loadProbeCredential(f.directory, publicModel), 'READ_FAILED'); assert.deepEqual(await sourceState(f.directory), before);
    assert.equal((await fs.stat(snapshots[0])).mode & 0o777, 0o700);
    assert.equal((await fs.readdir(snapshots[0])).includes('encryption.key'), false);
    for (const name of await fs.readdir(snapshots[0])) assert.equal((await fs.stat(join(snapshots[0], name))).mode & 0o777, 0o600);
    await reject(loadProbeCredential(missing.directory, publicModel), 'NO_MATCH');
  } finally { remove.mock.restore(); make.mock.restore(); for (const snapshot of snapshots) await realRemove(snapshot, { recursive: true, force: false }); await f.close(); await missing.close(); }
});

test('hot journal, unexpected inventory, corrupted databases and size caps reject without source recovery', async () => {
  for (const mutation of ['journal', 'extra', 'database', 'oversized'] as const) {
    const f = await fixture();
    if (mutation === 'journal') await fs.writeFile(join(f.directory, 'city-agent.sqlite-journal'), Buffer.of(1));
    if (mutation === 'extra') await fs.writeFile(join(f.directory, 'unknown-file'), KEY);
    if (mutation === 'database') await fs.writeFile(join(f.directory, 'city-agent.sqlite'), Buffer.from('corrupted fixture'));
    if (mutation === 'oversized') await fs.truncate(join(f.directory, 'city-agent.sqlite'), 32_000_001);
    const before = await sourceState(f.directory);
    try { await reject(loadProbeCredential(f.directory, publicModel)); assert.deepEqual(await sourceState(f.directory), before); } finally { await f.close(); }
  }
});

test('duplicate selector JSON keys cannot override enabled or provider silently', async () => {
  const raw = JSON.stringify(agent).replace('"enabled":true', '"enabled":false,"\\u0065nabled":true');
  const f = await fixture({ rows: [{ id: 'configured', data: raw }] });
  try { await reject(loadProbeCredential(f.directory, publicModel), 'INVALID_CREDENTIAL'); } finally { await f.close(); }
});
