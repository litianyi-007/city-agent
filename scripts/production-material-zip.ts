import { deflateRawSync, inflateRawSync } from 'node:zlib';

const refuse = (): never => { throw new Error('Material ZIP differs from the bounded checked package snapshot.'); };
const table = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; return crc >>> 0; });
function crc32(bytes: Buffer): number { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function snapshot(files: ReadonlyMap<string, Buffer>) {
  if (!files.size || files.size > 121) refuse(); let total = 0;
  for (const [name, bytes] of files) {
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || name.endsWith('.zip') || !Buffer.isBuffer(bytes) || bytes.length > 30_000_000 || (total += bytes.length) > 100_000_000) refuse();
  }
}
/** Canonical bounded ZIP from immutable checked bytes, not live disk filenames. */
export function buildMaterialZipSnapshot(files: ReadonlyMap<string, Buffer>): Buffer {
  snapshot(files); const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const [name, bytes] of files) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, compressed); centrals.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, directory, end]); if (zip.length > 30_000_000) refuse();
  assertMaterialZipSnapshot(zip, files); return zip;
}
/** Accept only our canonical format; no ZIP64, links, paths/extraction, extra
 * fields, encryption, descriptors, alternate names or trailing hidden payload. */
export function assertMaterialZipSnapshot(zip: Buffer, files: ReadonlyMap<string, Buffer>): void {
  snapshot(files);
  try {
    if (!Buffer.isBuffer(zip) || zip.length < 22 || zip.length > 30_000_000) return refuse();
    const end = zip.subarray(zip.length - 22);
    if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(8) !== files.size || end.readUInt16LE(10) !== files.size || end.readUInt16LE(20)) return refuse();
    const directoryOffset = end.readUInt32LE(16), directorySize = end.readUInt32LE(12);
    if (directoryOffset + directorySize !== zip.length - 22) return refuse();
    let localOffset = 0, centralOffset = directoryOffset, total = 0; const seen = new Set<string>();
    for (let index = 0; index < files.size; index++) {
      const local = zip.subarray(localOffset, localOffset + 30), central = zip.subarray(centralOffset, centralOffset + 46);
      if (local.length !== 30 || central.length !== 46 || local.readUInt32LE(0) !== 0x04034b50 || central.readUInt32LE(0) !== 0x02014b50 || local.readUInt16LE(4) !== 20 || central.readUInt16LE(4) !== 20 || central.readUInt16LE(6) !== 20 || local.readUInt16LE(6) !== 0x0800 || central.readUInt16LE(8) !== 0x0800 || local.readUInt16LE(8) !== 8 || central.readUInt16LE(10) !== 8 || local.readUInt16LE(10) || central.readUInt16LE(12) || local.readUInt16LE(12) !== 0x21 || central.readUInt16LE(14) !== 0x21 || local.readUInt16LE(28) || central.readUInt16LE(30) || central.readUInt16LE(32) || central.readUInt16LE(34) || central.readUInt16LE(36) || central.readUInt32LE(38) || central.readUInt32LE(42) !== localOffset) return refuse();
      const filenameLength = local.readUInt16LE(26), compressedLength = local.readUInt32LE(18), length = local.readUInt32LE(22), crc = local.readUInt32LE(14);
      if (!filenameLength || filenameLength !== central.readUInt16LE(28) || compressedLength !== central.readUInt32LE(20) || length !== central.readUInt32LE(24) || crc !== central.readUInt32LE(16) || length > 30_000_000 || (total += length) > 100_000_000) return refuse();
      const filename = zip.subarray(localOffset + 30, localOffset + 30 + filenameLength);
      if (!filename.equals(zip.subarray(centralOffset + 46, centralOffset + 46 + filenameLength))) return refuse();
      const name = filename.toString('utf8'), expected = files.get(name);
      if (!expected || seen.has(name) || !filename.equals(Buffer.from(name)) || expected.length !== length) return refuse(); seen.add(name);
      const start = localOffset + 30 + filenameLength, finish = start + compressedLength;
      if (finish > directoryOffset) return refuse();
      const decoded = inflateRawSync(zip.subarray(start, finish), { maxOutputLength: Math.max(1, length), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      const bytes = decoded.buffer;
      if (decoded.engine.bytesWritten !== compressedLength || !bytes.equals(expected) || crc32(bytes) !== crc) return refuse();
      localOffset = finish; centralOffset += 46 + filenameLength;
    }
    if (localOffset !== directoryOffset || centralOffset !== zip.length - 22 || seen.size !== files.size) return refuse();
  } catch { return refuse(); }
}
