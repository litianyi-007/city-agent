import { createCipheriv } from 'node:crypto';
import { types } from 'node:util';

export const PUBLIC_COLLISION_GUARD_VERSION = 'public-collision-guard-v2' as const;
const MAX_PUBLIC_BYTES = 1024 * 1024;
const MAX_NODES = 100000;
const MAX_DEPTH = 40;
const MAX_SCAN_WORK = 100000;
const MAX_CRYPTO_WORK = 100000;
const MAX_PREFIX_WORK = 1000000;
const invalidPublic = () => { throw new Error('评估公开数据无效或超限'); };
const invalidStructure = () => { throw new Error('评估公开数据结构超限'); };
const invalidCredential = () => { throw new Error('旧凭据格式需先在页面重新设置'); };
const exhausted = () => { throw new Error('评估凭据碰撞检查超限，请精简配置'); };
const collision = () => { throw new Error('凭据与评估公开契约冲突，请在页面轮换'); };

/** Validate without invoking getters/toJSON. Keep decoded values and property
 * names as well as the original serialized-token coverage of the legacy scan. */
function publicRuns(value: unknown): Buffer[] {
  const decoded = new Set<string>(); const ancestors = new Set<object>();
  let nodes = 0; let bytes = 0;
  const add = (text: string) => {
    if (text.length > MAX_PUBLIC_BYTES || (bytes += Buffer.byteLength(text, 'utf8')) > MAX_PUBLIC_BYTES) invalidPublic();
    decoded.add(text);
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return invalidStructure();
    if (typeof item === 'string') { add(item); return; }
    // Retain legacy JSON serialization: omitted object fields / null array
    // values are not tokens, while non-finite numbers serialize to "null".
    if (item === undefined) return;
    if (typeof item === 'number') { add(JSON.stringify(item)); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item)) return invalidPublic();
    const array = Array.isArray(item); const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalidPublic();
    const names = Object.getOwnPropertyNames(item);
    if (names.length > MAX_NODES || Object.getOwnPropertySymbols(item).length) return invalidStructure();
    if (names.includes('toJSON')) return invalidPublic();
    if (array && names.length !== (item as unknown[]).length + 1) return invalidPublic();
    ancestors.add(item);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
      if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || array && name !== 'length' && !/^(0|[1-9][0-9]*)$/.test(name)) return invalidPublic();
      add(name); visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  let text: string;
  try { text = JSON.stringify(value); } catch { return invalidPublic(); }
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PUBLIC_BYTES) return invalidPublic();
  const strings = new Set(text.split(/[\s"'\\]+/));
  for (const part of decoded) strings.add(part);
  return [...strings].map(part => Buffer.from(part, 'utf8')).filter(part => part.length >= 16);
}

interface Credential { iv: Buffer; tag: Buffer; ciphertext: Buffer; mask?: Buffer; }
function credentials(values: readonly string[]): Credential[] {
  if (!Array.isArray(values) || types.isProxy(values) || Object.getPrototypeOf(values) !== Array.prototype) return invalidCredential();
  if (values.length > MAX_CRYPTO_WORK) return exhausted();
  const names = Object.getOwnPropertyNames(values);
  if (Object.getOwnPropertySymbols(values).length || names.length !== values.length + 1) return invalidCredential();
  const unique = new Set<string>(); const result: Credential[] = [];
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return invalidCredential();
    const value: string = descriptor.value;
    if (value.length < 60 || value.length > 704 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return invalidCredential();
    if (unique.has(value)) continue;
    const encoded = Buffer.from(value, 'base64');
    if (encoded.toString('base64') !== value || encoded.length < 44 || encoded.length > 528) return invalidCredential();
    unique.add(value); result.push({ iv: encoded.subarray(0, 12), tag: encoded.subarray(12, 28), ciphertext: encoded.subarray(28) });
  }
  return result;
}

/** Encryption-only equality check, never a credential reader or authorization.
 * No ciphertext is XORed with a mask, no decipher/digest/export is performed,
 * and all caches are local to this call. Length is ciphertext byte length.
 * Scan work counts actual byte windows ONCE per distinct credential length,
 * before window deduplication; every mask/full GCM is a crypto operation, and
 * every public-candidate/entry prefix comparison has its own bounded counter. */
export function assertPublicCollisionSafe(value: unknown, encryptionKey: Buffer, encryptedCredentials: readonly string[]): void {
  const runs = publicRuns(value);
  if (types.isProxy(encryptionKey) || !Buffer.isBuffer(encryptionKey) || !types.isUint8Array(encryptionKey) || encryptionKey.length !== 32) return invalidCredential();
  const entries = credentials(encryptedCredentials);
  let cryptoWork = 0; let scanWork = 0; let prefixWork = 0;
  const encrypt = (candidate: Buffer, iv: Buffer): { bytes: Buffer; tag: Buffer } => {
    if (++cryptoWork > MAX_CRYPTO_WORK) return exhausted();
    try {
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      return { bytes: Buffer.concat([cipher.update(candidate), cipher.final()]), tag: cipher.getAuthTag() };
    } catch { return invalidCredential(); }
  };
  const masks = new Map<string, Buffer>(); const byLength = new Map<number, Credential[]>();
  for (const entry of entries) {
    const identity = entry.iv.toString('hex');
    entry.mask = masks.get(identity);
    if (!entry.mask) { entry.mask = encrypt(Buffer.alloc(16), entry.iv).bytes; masks.set(identity, entry.mask); }
    const group = byLength.get(entry.ciphertext.length) ?? [];
    group.push(entry); byLength.set(entry.ciphertext.length, group);
  }
  for (const [length, group] of byLength) {
    const seen = new Set<string>();
    for (const part of runs) for (let index = 0; index + length <= part.length; index++) {
      if (++scanWork > MAX_SCAN_WORK) return exhausted();
      const candidate = part.subarray(index, index + length); const identity = candidate.toString('base64');
      if (seen.has(identity)) continue;
      seen.add(identity);
      for (const entry of group) {
        if (++prefixWork > MAX_PREFIX_WORK) return exhausted();
        let different = 0;
        for (let byte = 0; byte < 16; byte++) {
          const encryptedPublicByte = candidate[byte]! ^ entry.mask![byte]!;
          different |= encryptedPublicByte ^ entry.ciphertext[byte]!;
        }
        if (different !== 0) continue;
        const encrypted = encrypt(candidate, entry.iv);
        if (encrypted.bytes.equals(entry.ciphertext) && encrypted.tag.equals(entry.tag)) return collision();
      }
    }
  }
}
