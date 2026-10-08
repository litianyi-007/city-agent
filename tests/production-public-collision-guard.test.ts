import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';
import { PUBLIC_COLLISION_GUARD_VERSION, assertPublicCollisionSafe } from '../server/production/public-collision-guard.js';

// All encryption keys and credential plaintexts are explicit test-owned values.
// No filesystem/store, real configuration, decipher, service or provider calls.
const key = Buffer.alloc(32, 0x73);
const ivFor = (index: number) => { const iv = Buffer.alloc(12); iv.writeUInt32BE(index, 8); return iv; };
function encode(value: string | Buffer, index = 1): string {
  const iv = ivFor(index); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(typeof value === 'string' ? Buffer.from(value) : value), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
const isCollision = (value: unknown, entries: string[]) => {
  try { assertPublicCollisionSafe(value, key, entries); return false; }
  catch (error) { assert.ok(error instanceof Error); assert.equal(error.message, '凭据与评估公开契约冲突，请在页面轮换'); return true; }
};

/** Independent exhaustive legacy reference: enumerate original byte windows
 * and perform full authenticated encryption on every deduplicated candidate.
 * Optional original work bound exposes the synthetic historical-scale failure. */
function legacyCollision(value: unknown, entries: string[], bounded = false): boolean {
  const text = JSON.stringify(value); const strings = new Set(text.split(/[\s"'\\]+/));
  const collect = (item: unknown) => {
    if (typeof item === 'string') strings.add(item);
    else if (typeof item === 'number') strings.add(JSON.stringify(item));
    else if (item && typeof item === 'object') for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) { strings.add(name); collect(descriptor.value); }
  };
  collect(value); const runs = [...strings].map(part => Buffer.from(part)).filter(part => part.length >= 16); let work = 0;
  for (const entry of new Set(entries)) {
    const bytes = Buffer.from(entry, 'base64'); const length = bytes.length - 28; const candidates = new Set<string>();
    for (const part of runs) for (let i = 0; i + length <= part.length; i++) {
      if (bounded && ++work > 100000) throw new Error('legacy scan exhausted');
      candidates.add(part.subarray(i, i + length).toString('base64'));
    }
    for (const encodedCandidate of candidates) {
      const cipher = createCipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      const encrypted = Buffer.concat([cipher.update(Buffer.from(encodedCandidate, 'base64')), cipher.final()]);
      if (encrypted.equals(bytes.subarray(28)) && cipher.getAuthTag().equals(bytes.subarray(12, 28))) return true;
    }
  }
  return false;
}

test('pure encryption-only guard version, empty credentials and safe public JSON produce no output or mutation', () => {
  assert.equal(PUBLIC_COLLISION_GUARD_VERSION, 'public-collision-guard-v2');
  const value = { scope: 'ordinary public protocol', nested: [null, true, 17, 'public string'] }; const before = JSON.stringify(value);
  assert.equal(assertPublicCollisionSafe(value, key, []), undefined);
  assert.equal(assertPublicCollisionSafe(value, key, [encode('test-owned-secret-never-public')]), undefined);
  assert.equal(JSON.stringify(value), before); assert.deepEqual(key, Buffer.alloc(32, 0x73));
});

test('legacy optional undefined fields and dense array/non-finite null serialization keep property-name coverage without rewriting values', () => {
  const property = 'missing-price-public-field';
  const value = { [property]: undefined, pricing: undefined, values: [undefined, NaN, Infinity, -Infinity] };
  const before = JSON.stringify(value);
  assert.equal(before, '{"values":[null,null,null,null]}');
  assert.doesNotThrow(() => assertPublicCollisionSafe(value, key, [encode('unrelated-test-secret')]));
  assert.ok(isCollision(value, [encode(property)]));
  assert.equal(JSON.stringify(value), before); assert.ok(Object.hasOwn(value, property));
  assert.equal(value.values[0], undefined); assert.ok(Number.isNaN(value.values[1])); assert.equal(value.values[2], Infinity);
  assert.throws(() => assertPublicCollisionSafe(undefined, key, []), /公开数据无效或超限/);
});

test('six roles across eighty synthetic encrypted historical generations avoid the old repeated-window exhaustion', () => {
  const entries = Array.from({ length: 480 }, (_, i) => encode(`PRIVATE-role${i % 6}-generation${String(i).padStart(4, '0')}`.padEnd(48, '!'), i + 1));
  const value = 'ordinary-public-configuration-'.repeat(60);
  assert.throws(() => legacyCollision(value, entries, true), /legacy scan exhausted/);
  assert.doesNotThrow(() => assertPublicCollisionSafe(value, key, entries));
  assert.ok(isCollision({ nested: 'PRIVATE-role5-generation0479'.padEnd(48, '!') }, entries));
});

test('different IVs, duplicate encrypted snapshots and same-IV entries remain authenticated exact comparisons', () => {
  const secret = 'test-owned-common-credential'; const first = encode(secret, 1); const second = encode(secret, 2);
  const other = encode('test-owned-other-credential!', 1);
  assert.ok(isCollision({ field: `before ${secret} after` }, [first, first, second, other]));
  assert.ok(isCollision({ field: 'test-owned-other-credential!' }, [first, other]));
  assert.equal(isCollision({ field: 'unrelated-public-value' }, [first, first, second, other]), false);
});

test('a matching encrypted prefix alone never proves a collision: suffix and GCM authentication tag must both match', () => {
  const prefix = 'same-public-16!!'; assert.equal(Buffer.byteLength(prefix), 16);
  const entry = encode(`${prefix}private-suffix`);
  assert.equal(isCollision(`${prefix}public-suffix!`, [entry]), false);
  const corrupt = Buffer.from(entry, 'base64'); corrupt[12] ^= 1;
  assert.equal(isCollision(`${prefix}private-suffix`, [corrupt.toString('base64')]), false);
  assert.ok(isCollision(`${prefix}private-suffix`, [entry]));
});

test('decoded escaped quote/backslash/control values and property names retain collision coverage', () => {
  for (const secret of ['legacy"quoted\\credential', 'legacy\ncontrol\tcredential', 'literal\\u0061credential']) {
    const entry = encode(secret); assert.ok(isCollision({ field: `xx${secret}yy` }, [entry]));
    assert.ok(isCollision({ [`before${secret}after`]: 0 }, [entry]));
  }
});

test('UTF-8 byte windows include multibyte prefix offsets and never use UTF-16 character lengths', () => {
  for (const secret of ['秘密凭据甲乙丙丁', '🌍🌍🌍🌍', 'abc秘密xyz凭据']) {
    assert.ok(Buffer.byteLength(secret) >= 16);
    assert.ok(isCollision({ field: `前缀🌍${secret}后缀` }, [encode(secret)]));
    assert.equal(isCollision({ field: '前缀🌍不同公开值后缀' }, [encode(secret)]), false);
  }
});

test('exhaustive full-GCM legacy differential covers decoded strings, property names, serialized tokens and arbitrary byte windows', () => {
  const samples: unknown[] = ['abcdefghijklmnop', { longabcdefghijklmnopfield: 'safe' }, { a: 'abcdefgh', b: 'ijklmnop' }, { n: 1234567890123456 }, { a: ['prefixabcdefghijklmnopsuffix', '字符🌍字符🌍字符🌍'] }, { a: 'quoted"and\\slashabcdefghijklmnop' }];
  let identity = 1;
  for (const value of samples) {
    const text = JSON.stringify(value); const candidates = new Set<string>();
    const add = (part: string) => { const bytes = Buffer.from(part); for (const length of [16, 17, 24]) for (let i = 0; i + length <= bytes.length; i++) candidates.add(bytes.subarray(i, i + length).toString('base64')); };
    add(text); for (const part of text.split(/[\s"'\\]+/)) add(part);
    const collect = (item: unknown) => { if (typeof item === 'string') add(item); else if (item && typeof item === 'object') for (const [name, child] of Object.entries(item)) { add(name); collect(child); } };
    collect(value); candidates.add(Buffer.from('absent-test-owned-secret').toString('base64'));
    for (const candidate of candidates) {
      const entries = [encode(Buffer.from(candidate, 'base64'), identity++)];
      assert.equal(isCollision(value, entries), legacyCollision(value, entries));
    }
  }
});

test('scan budget counts actual positions before deduplication, once per distinct ciphertext length, and is global', () => {
  assert.doesNotThrow(() => assertPublicCollisionSafe('a'.repeat(100015), key, [encode('b'.repeat(16))]));
  assert.throws(() => assertPublicCollisionSafe('a'.repeat(100016), key, [encode('b'.repeat(16))]), /碰撞检查超限/);
  const entries = [encode('b'.repeat(16), 1), encode('c'.repeat(17), 2)];
  assert.doesNotThrow(() => assertPublicCollisionSafe('a'.repeat(50015), key, entries));
  assert.throws(() => assertPublicCollisionSafe('a'.repeat(50016), key, entries), /碰撞检查超限/);
});

function uniquePublic(length: number) {
  let state = 0x12345678; let text = '';
  for (let index = 0; index < length; index++) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; text += '0123456789abcdef'[state >>> 28]; }
  assert.equal(new Set(Array.from({ length: length - 15 }, (_, i) => text.slice(i, i + 16))).size, length - 15);
  return text;
}
test('one million prefix comparisons is a hard separate bound, with exact boundary and no full-GCM shortcut', () => {
  const entries = Array.from({ length: 1000 }, (_, i) => encode('Z'.repeat(16), i));
  assert.doesNotThrow(() => assertPublicCollisionSafe(uniquePublic(1015), key, entries));
  assert.throws(() => assertPublicCollisionSafe(uniquePublic(1016), key, entries), /碰撞检查超限/);
});

test('actual crypto budget includes each distinct IV mask and the full authenticated comparison', () => {
  const secret = 'public-match-16!'; assert.equal(Buffer.byteLength(secret), 16);
  const entries = Array.from({ length: 100000 }, (_, i) => i === 0 ? encode(secret, 0) : Buffer.concat([ivFor(i), Buffer.alloc(32)]).toString('base64'));
  assert.doesNotThrow(() => assertPublicCollisionSafe('', key, entries));
  assert.throws(() => assertPublicCollisionSafe(secret, key, entries), /碰撞检查超限/);
  assert.throws(() => assertPublicCollisionSafe('', key, [...entries, encode('another-test-key', 100001)]), /碰撞检查超限/);
});

test('malformed private formats, noncanonical base64, byte length outside 16..500 and unsafe key/entry accessors fail closed', () => {
  for (const entry of ['', 'not-base64', `${encode('test-owned-secret')}\n`, encode('x'.repeat(15)), encode('x'.repeat(501))]) assert.throws(() => assertPublicCollisionSafe('public', key, [entry]), /旧凭据格式/);
  for (const bad of [Buffer.alloc(31), Object.create(Buffer.prototype), new Proxy(key, { getPrototypeOf() { throw new Error('must-not-run'); } })]) assert.throws(() => assertPublicCollisionSafe('public', bad, []), /旧凭据格式/);
  let invoked = 0; const entries: string[] = []; Object.defineProperty(entries, '0', { get() { invoked++; return encode('test-owned-secret'); } });
  assert.throws(() => assertPublicCollisionSafe('public', key, entries), /旧凭据格式/); assert.equal(invoked, 0);
});

test('public byte/node/depth limits and non-JSON/accessor/proxy/toJSON inputs reject without running user code', () => {
  for (const value of ['a'.repeat(1024 * 1024), '\u0000'.repeat(180000)]) assert.throws(() => assertPublicCollisionSafe(value, key, []), /公开数据无效或超限/);
  let deep: unknown = 0; for (let i = 0; i < 41; i++) deep = { child: deep };
  assert.throws(() => assertPublicCollisionSafe(deep, key, []), /结构超限/);
  assert.throws(() => assertPublicCollisionSafe(Array.from({ length: 100000 }, () => null), key, []), /结构超限/);
  let invoked = 0; const getter = { get field() { invoked++; return 'must-not-run'; } };
  const proxy = new Proxy({}, { ownKeys() { invoked++; throw new Error('must-not-run'); } });
  const toJSON = { toJSON() { invoked++; return 'must-not-run'; } };
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [getter, proxy, toJSON, cycle, undefined, BigInt(1), () => 0, Array(1)]) assert.throws(() => assertPublicCollisionSafe(value, key, []), /公开数据无效或超限/);
  assert.equal(invoked, 0);
});
