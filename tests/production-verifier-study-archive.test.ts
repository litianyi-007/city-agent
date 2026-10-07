import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { inspectVerifierStudyArchive, inspectVerifierStudyArchiveFile, VerifierStudyArchiveError, VERIFIER_OBSERVED_01_ARCHIVE_SHA256, VERIFIER_STUDY_ARCHIVE_LIMITS } from '../server/production/verifier-study-archive.ts';

// No source/ref/store/provider mutation, extraction, xattr application, repair,
// resume or temporary evidence files. Adversarial tars exist only in memory.
const archivePath = fileURLToPath(new URL('../docs/production/experiments/VERIFIER-OBSERVED-01/run-ledger.tar.gz', import.meta.url));
const frozen = readFileSync(archivePath);
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const decoded = gunzipSync(frozen);
const frozenEntries: Array<{ name: string; type: string; body: Buffer }> = [];
for (let offset = 0; offset < decoded.length;) {
  const header = decoded.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
  const name = header.subarray(0, 100).toString().split('\0')[0]; const type = String.fromCharCode(header[156]);
  const size = Number.parseInt(header.subarray(124, 136).toString().split('\0')[0].trim(), 8);
  frozenEntries.push({ name, type, body: decoded.subarray(offset + 512, offset + 512 + size) });
  offset += 512 + Math.ceil(size / 512) * 512;
}
const payloads = new Map(frozenEntries.filter(entry => /^run\/(?:manifest|event-[0-9]{6}(?:\.commit)?)\.json$/.test(entry.name)).map(entry => [entry.name, entry.body]));
function checksum(header: Buffer) {
  header.fill(0x20, 148, 156); const sum = header.reduce((value, byte) => value + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
}
function entry(name: string, body: Buffer | string = '', type = '0'): Buffer {
  const data = typeof body === 'string' ? Buffer.from(body) : body; const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'ascii'); header.write('0000600\0', 100, 8, 'ascii'); header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii'); header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii'); header[156] = type.charCodeAt(0); header.write('ustar\0' + '00', 257, 8, 'ascii');
  checksum(header); return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
function tar(files = payloads, extras: Buffer[] = []): Buffer {
  return Buffer.concat([entry('run/', '', '5'), ...extras, ...[...files].map(([name, body]) => entry(name, body)), Buffer.alloc(1024)]);
}
function inspectTar(bytes: Buffer) { const compressed = gzipSync(bytes); return inspectVerifierStudyArchive(compressed, sha(compressed)); }
function mustReject(bytes: Buffer, code?: string) {
  assert.throws(() => inspectTar(bytes), (error: unknown) => error instanceof VerifierStudyArchiveError && (!code || error.code === code));
}
function paxRecord(key: string, value: Buffer | string): Buffer {
  const field = Buffer.concat([Buffer.from(`${key}=`), typeof value === 'string' ? Buffer.from(value) : value, Buffer.from('\n')]);
  let length = field.length + 2;
  while (Buffer.byteLength(String(length)) + 1 + field.length !== length) length = Buffer.byteLength(String(length)) + 1 + field.length;
  return Buffer.concat([Buffer.from(`${length} `), field]);
}

test('preserved SHA archive verifies portable integrity, full chains and exact hidden macOS metadata inventory', () => {
  const value = inspectVerifierStudyArchive(frozen, VERIFIER_OBSERVED_01_ARCHIVE_SHA256);
  assert.equal(value.archiveVerified, true); assert.equal(value.hashVerified, true); assert.equal(value.state, 'terminal'); assert.equal(value.terminalStatus, 'completed');
  assert.equal(value.runId, 'f5152c26-891f-458f-a63a-bcf414dc3200'); assert.equal(value.sourceCommit, '3a1bedfa8369f2032bb3b943b393dfbeaee3a456');
  assert.deepEqual(value.inventory, { physicalEntries: 1746, ledgerJsonFiles: 581, directories: 1, paxHeaders: 582, appleDoubleFiles: 582 });
  assert.equal(value.eventCount, 290); assert.equal(value.decisionCount, 54); assert.equal(value.callbackIntents, 54); assert.equal(value.oracleCount, 36);
  assert.equal(value.usage.knownInputTokens, 5454); assert.equal(value.usage.knownOutputTokens, 378); assert.equal(value.usage.unknownCalls, 0);
  assert.ok(Math.abs(value.usage.knownEstimatedCost - 0.001469556) < 1e-15);
  assert.equal(value.recordedExecutionSource, 'loopback-engineering'); assert.match(value.usage.boundary, /fixture.*not-model/);
  assert.equal(value.authenticity, 'not-signed-or-independently-authenticated'); assert.equal(value.directoryScope, 'recorded-only-not-current-extraction-path');
  assert.notEqual(value.recordedDirectorySha256, sha('/another-reviewer-machine/new-extraction/run'));
  assert.equal(value.resumed, false); assert.equal(value.repaired, false); assert.equal(value.extracted, false);
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.usage), true);
  assert.equal(JSON.stringify(value).includes('synthetic-study-llm-not-a-real-credential'), false);
  assert.equal(JSON.stringify(value).includes('responseSnapshot'), false);
});

test('archive without platform metadata has the same recorded scope and evidence, never current-path binding', () => {
  const value = inspectTar(tar()); const original = inspectVerifierStudyArchive(frozen, VERIFIER_OBSERVED_01_ARCHIVE_SHA256);
  assert.deepEqual(value.usage, original.usage); assert.equal(value.recordedDirectorySha256, original.recordedDirectorySha256);
  assert.equal(value.eventCount, original.eventCount); assert.equal(value.inventory.paxHeaders, 0); assert.equal(value.inventory.appleDoubleFiles, 0);
});

test('wrong expected SHA, truncated gzip, invalid gzip and compressed/decompressed limits reject before promotion', () => {
  assert.throws(() => inspectVerifierStudyArchive(frozen, 'a'.repeat(64)), /archive-sha256-mismatch/);
  assert.throws(() => inspectVerifierStudyArchive(frozen, 'not-a-hash'), /expected-sha256/);
  const truncated = frozen.subarray(0, frozen.length - 5);
  assert.throws(() => inspectVerifierStudyArchive(truncated, sha(truncated)), /gzip-invalid-or-size/);
  const invalid = Buffer.from('not-a-gzip'); assert.throws(() => inspectVerifierStudyArchive(invalid, sha(invalid)), /gzip-invalid-or-size/);
  assert.throws(() => inspectVerifierStudyArchive(Buffer.alloc(VERIFIER_STUDY_ARCHIVE_LIMITS.compressedBytes + 1), 'a'.repeat(64)), /compressed-size/);
  const bomb = gzipSync(Buffer.alloc(VERIFIER_STUDY_ARCHIVE_LIMITS.decompressedBytes + 512));
  assert.throws(() => inspectVerifierStudyArchive(bomb, sha(bomb)), /gzip-invalid-or-size/);
});

test('tar truncation, nonzero trailing data, checksums, body padding and duplicate names fail closed', () => {
  const valid = tar(); mustReject(valid.subarray(0, valid.length - 512), 'tar-end-marker');
  const trailing = Buffer.from(valid); trailing[trailing.length - 1] = 1; mustReject(trailing, 'tar-end-marker');
  const badHeader = Buffer.from(valid); badHeader[100] ^= 1; mustReject(badHeader, 'tar-checksum');
  mustReject(tar(payloads, [entry('run/manifest.json', payloads.get('run/manifest.json')!)]), 'tar-path-or-duplicate');
  const badPadding = entry('run/manifest.json', '{}\n'); badPadding[515] = 1;
  mustReject(tar(new Map(), [badPadding]), 'tar-data-padding');
});

test('path traversal, absolute/Windows paths, symlinks, hardlinks and other tar types are refused without extraction', () => {
  for (const name of ['../escape.json', '/run/manifest.json', 'run/../manifest.json', 'run/./manifest.json', 'run\\manifest.json', 'run/nested/manifest.json']) mustReject(tar(payloads, [entry(name, '{}\n')]));
  for (const type of ['1', '2', '3', '4', '6', '7', 'g', 'L', 'K']) mustReject(tar(payloads, [entry('run/extra.json', '', type)]), 'tar-link-or-unsupported-type');
});

test('oversized entries and malformed UTF8/duplicate JSON/extra envelopes cannot be normalized into evidence', () => {
  const largeHeader = entry('run/event-000001.json', '').subarray(0, 512);
  largeHeader.write(`${(VERIFIER_STUDY_ARCHIVE_LIMITS.eventBytes + 1).toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii'); checksum(largeHeader);
  mustReject(Buffer.concat([entry('run/', '', '5'), largeHeader, Buffer.alloc(1024)]), 'tar-entry-size');
  for (const body of [Buffer.from([0xff]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), payloads.get('run/manifest.json')!]),
    Buffer.from(payloads.get('run/manifest.json')!.toString().replace('{"version":', '{"version":"duplicate","version":')),
    Buffer.from(payloads.get('run/manifest.json')!.toString().replace('{"version":', '{"extra":null,"version":'))]) {
    const altered = new Map(payloads); altered.set('run/manifest.json', body); mustReject(tar(altered));
  }
});

test('rehashed outer archive cannot hide changed events, invalid marker chains, mixed scopes, gaps or orphan markers', () => {
  for (const [name, change] of [
    ['run/event-000290.json', (record: Record<string, unknown>) => { record.hash = 'a'.repeat(64); }],
    ['run/event-000290.commit.json', (record: Record<string, unknown>) => { record.previousCommitHash = 'a'.repeat(64); }],
    ['run/event-000290.commit.json', (record: Record<string, unknown>) => { record.directoryHash = 'a'.repeat(64); }],
  ] as const) {
    const altered = new Map(payloads); const record = JSON.parse(altered.get(name)!.toString()); change(record);
    altered.set(name, Buffer.from(`${JSON.stringify(record)}\n`)); mustReject(tar(altered), 'ledger-integrity');
  }
  for (const name of ['run/event-000290.commit.json', 'run/event-000001.json', 'run/event-000290.json']) {
    const altered = new Map(payloads); altered.delete(name); mustReject(tar(altered), 'ledger-sequence-or-unconfirmed-tail');
  }
});

test('even a self-consistent tail rehash must obey the shared ledger terminal/lineage contract', () => {
  const altered = new Map(payloads); const name = 'run/event-000290.json'; const record = JSON.parse(altered.get(name)!.toString());
  record.payload.status = 'provider-says-success'; const { hash: _oldHash, ...body } = record; record.hash = sha(JSON.stringify(body));
  altered.set(name, Buffer.from(`${JSON.stringify(record)}\n`));
  const markerName = 'run/event-000290.commit.json'; const marker = JSON.parse(altered.get(markerName)!.toString()); marker.eventHash = record.hash;
  const { hash: _oldMarkerHash, ...markerBody } = marker; marker.hash = sha(JSON.stringify(markerBody)); altered.set(markerName, Buffer.from(`${JSON.stringify(marker)}\n`));
  mustReject(tar(altered), 'ledger-integrity');
});

test('PAX is bounded byte-framed whitelist metadata, never path/link/size redirection or hidden entry', () => {
  for (const key of ['path', 'linkpath', 'size', 'GNU.sparse.map', 'unknown']) mustReject(tar(payloads, [entry('run/PaxHeader/manifest.json', paxRecord(key, '../escape'), 'x')]), 'pax-unsupported-field');
  mustReject(tar(payloads, [entry('run/PaxHeader/manifest.json', '99 mtime=1\n', 'x')]), 'pax-framing');
  mustReject(tar(payloads, [entry('run/PaxHeader/manifest.json', Buffer.concat([paxRecord('mtime', '1'), paxRecord('mtime', '2')]), 'x')]), 'pax-unsupported-field');
  mustReject(tar(payloads, [entry('run/PaxHeader/absent.json', paxRecord('mtime', '1'), 'x')]), 'pax-target-or-order');
  const manifest = payloads.get('run/manifest.json')!; const without = new Map(payloads); without.delete('run/manifest.json');
  const safe = Buffer.concat([entry('run/', '', '5'), entry('run/PaxHeader/manifest.json', paxRecord('mtime', '1.25'), 'x'), entry('run/manifest.json', manifest),
    ...[...without].map(([name, body]) => entry(name, body)), Buffer.alloc(1024)]);
  assert.equal(inspectTar(safe).inventory.paxHeaders, 1);
});

test('AppleDouble/xattr metadata is recognized exactly, must be paired, and is never exported or applied', () => {
  const apple = frozenEntries.find(item => item.name === '._run')!;
  const pax = frozenEntries.find(item => item.name === 'PaxHeader/run')!;
  const badApple = Buffer.from(apple.body); badApple[0] = 1;
  mustReject(Buffer.concat([entry('._run', badApple), entry('PaxHeader/run', pax.body, 'x'), tar()]), 'appledouble-format-or-order');
  mustReject(Buffer.concat([entry('._run', apple.body), Buffer.alloc(1024)]), 'tar-incomplete');
  const badPax = Buffer.from(pax.body); badPax[badPax.length - 2] ^= 1;
  mustReject(Buffer.concat([entry('._run', apple.body), entry('PaxHeader/run', badPax, 'x'), tar()]), 'pax-provenance');
});

test('valid unfinished evidence is distinguished from a terminal success or malformed archive', () => {
  const noTerminal = new Map(payloads); noTerminal.delete('run/event-000290.json'); noTerminal.delete('run/event-000290.commit.json');
  const unfinished = inspectTar(tar(noTerminal)); assert.equal(unfinished.archiveVerified, true); assert.equal(unfinished.state, 'incomplete'); assert.equal(unfinished.terminalStatus, null);
  const firstIntent = [...payloads].filter(([name]) => FILE_SEQUENCE(name) !== null && !name.includes('.commit.')).map(([, body]) => JSON.parse(body.toString())).sort((a, b) => a.sequence - b.sequence).find(record => record.type === 'call-intent')!.sequence;
  const pending = new Map([...payloads].filter(([name]) => FILE_SEQUENCE(name) === null || FILE_SEQUENCE(name)! <= firstIntent));
  const partial = inspectTar(tar(pending)); assert.equal(partial.state, 'incomplete'); assert.equal(partial.usage.complete, false); assert.equal(partial.usage.unknownCalls, 1);
  assert.equal(partial.resumed, false); assert.equal(partial.usage.knownInputTokens, 0);
});
function FILE_SEQUENCE(name: string): number | null { const match = /event-([0-9]{6})(?:\.commit)?\.json$/.exec(name); return match ? Number(match[1]) : null; }

test('portable readonly CLI supports defaults or explicit archive/hash; unknown switches and nonfiles fail without echo', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url)); const script = fileURLToPath(new URL('../scripts/inspect-production-verifier-study.ts', import.meta.url));
  for (const args of [[], ['--archive', archivePath, '--sha256', VERIFIER_OBSERVED_01_ARCHIVE_SHA256]]) {
    const value = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd, encoding: 'utf8' }));
    assert.equal(value.archiveVerified, true); assert.equal(value.resumed, false);
  }
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', script, '--resume'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.throws(() => inspectVerifierStudyArchiveFile(cwd, VERIFIER_OBSERVED_01_ARCHIVE_SHA256), /archive-file/);
});
