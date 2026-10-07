import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { buildMaterialZipSnapshot, assertMaterialZipSnapshot } from '../scripts/production-material-zip.js';
import { assertMaterialZipSnapshot as assertPublicMaterialZip } from '../scripts/production-public-safety.js';

test('canonical ZIP preserves every checked member byte, filename/count and standard CRC', () => {
  const files = new Map([['README.md', Buffer.from('123456789')], ['MOCK-01/index.html', Buffer.from('<h1>trusted unit bytes only</h1>')], ['requirements.json', Buffer.from('{}')]]);
  const zip = buildMaterialZipSnapshot(files); assertMaterialZipSnapshot(zip, files); assertPublicMaterialZip(zip, files);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926);
  assert.equal(zip.readUInt16LE(zip.length - 14), 3);
  const changed = new Map(files); changed.set('README.md', Buffer.from('changed')); assert.throws(() => assertMaterialZipSnapshot(zip, changed));
  const missing = new Map(files); missing.delete('requirements.json'); assert.throws(() => assertMaterialZipSnapshot(zip, missing));
});

test('ZIP builds from checked bytes even when the original source file changes afterwards', async t => {
  const directory = await mkdtemp(path.join(process.cwd(), '.city-agent-public-zip-unit-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'README.md'); await writeFile(source, 'original checked bytes');
  const checked = new Map([['README.md', await readFile(source)]]);
  await writeFile(source, 'different source after checking');
  const zip = buildMaterialZipSnapshot(checked); assertMaterialZipSnapshot(zip, checked);
  assert.throws(() => assertMaterialZipSnapshot(zip, new Map([['README.md', Buffer.from('different source after checking')]])));
});

function appendHiddenInput(zip: Buffer, hidden: Buffer): Buffer {
  const endOffset = zip.length - 22, directoryOffset = zip.readUInt32LE(endOffset + 16);
  const changed = Buffer.concat([zip.subarray(0, directoryOffset), hidden, zip.subarray(directoryOffset)]);
  changed.writeUInt32LE(zip.readUInt32LE(18) + hidden.length, 18);
  changed.writeUInt32LE(zip.readUInt32LE(directoryOffset + 20) + hidden.length, directoryOffset + hidden.length + 20);
  changed.writeUInt32LE(directoryOffset + hidden.length, changed.length - 6);
  return changed;
}
test('hidden second deflate streams, unused padding, trailing payload and invalid ZIP header metadata fail closed', () => {
  const files = new Map([['README.md', Buffer.from('public fixture')]]), zip = buildMaterialZipSnapshot(files);
  for (const hidden of [deflateRawSync(Buffer.from('sk-' + 'synthetic_fixture_'.repeat(3))), Buffer.from([0, 0, 0])]) assert.throws(() => assertMaterialZipSnapshot(appendHiddenInput(zip, hidden), files));
  assert.throws(() => assertMaterialZipSnapshot(Buffer.concat([zip, Buffer.from('hidden')]), files));
  for (const offset of [0, 6, 8, 14, 26, zip.length - 22]) { const malformed = Buffer.from(zip); malformed[offset] ^= 1; assert.throws(() => assertMaterialZipSnapshot(malformed, files)); }
  assert.throws(() => assertMaterialZipSnapshot(zip.subarray(0, 20), files));
});
test('unsafe paths, secrets and decompressed snapshot bounds cannot become publication ZIP members', () => {
  for (const name of ['../private.json', '/private.json', 'bad//file', 'nested/materials.zip']) assert.throws(() => buildMaterialZipSnapshot(new Map([[name, Buffer.from('fixture')]])));
  assert.throws(() => buildMaterialZipSnapshot(new Map([['README.md', Buffer.alloc(30_000_001)]])));
  const secret = new Map([['requirements.json', Buffer.from('{"apiKey":"synthetic-sensitive-fixture"}')]]);
  assert.throws(() => assertPublicMaterialZip(buildMaterialZipSnapshot(secret), secret), /credential/);
});
