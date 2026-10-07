import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { inspectVerifierStudyArchive, VERIFIER_STUDY_ARCHIVE_LIMITS } from '../../server/production/verifier-study-archive.js';

export const VERIFIER_REAL01_ARCHIVE_URL = new URL('../../docs/production/experiments/VERIFIER-REAL-01/run-ledger.tar.gz', import.meta.url);
export const VERIFIER_REAL01_ARCHIVE_SHA256 = '3d1b81adcbe78a523ee8d442204e79bf704a3e3a8b1b6f58c439a111c654920c';
export interface PublicVerifierReal01Event {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
}

function readBoundedArchiveBytes() {
  const descriptor = openSync(fileURLToPath(VERIFIER_REAL01_ARCHIVE_URL), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor);
    assert.ok(before.isFile() && before.size > 0 && before.size <= VERIFIER_STUDY_ARCHIVE_LIMITS.compressedBytes);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0, 'archive became truncated while reading');
      offset += count;
    }
    const after = fstatSync(descriptor);
    assert.ok(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'archive changed while reading');
    return bytes;
  } finally { closeSync(descriptor); }
}

/** The production reader first validates the pinned archive and ledger chain.
 * This test-only second pass reads bounded, already validated public JSON
 * entries in memory. It never extracts files, creates a ledger, loads private
 * settings or uses tar paths as filesystem paths. PAX extensions have already
 * been checked and ignored by inspection. The provider model is never called.
 * Consumers cast their own expected payload shapes; integrity is not a proof
 * that a recorded model decision or artifact was correct.
 */
export function readVerifierReal01Evidence() {
  const archiveBytes = readBoundedArchiveBytes();
  const inspection = inspectVerifierStudyArchive(archiveBytes, VERIFIER_REAL01_ARCHIVE_SHA256);
  const tar = gunzipSync(archiveBytes, { maxOutputLength: VERIFIER_STUDY_ARCHIVE_LIMITS.decompressedBytes });
  let manifest: unknown;
  const events: PublicVerifierReal01Event[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const prefix = header.subarray(345, 500).toString('ascii').split('\0')[0];
    const leaf = header.subarray(0, 100).toString('ascii').split('\0')[0];
    const name = prefix ? `${prefix}/${leaf}` : leaf;
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/[\0 ]/g, ''), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const end = offset + 512 + size;
    assert.ok(end <= tar.length);
    if (header[156] === 0x30 && (name === 'run/manifest.json' || /^run\/event-[0-9]{6}\.json$/.test(name))) {
      const entry: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(tar.subarray(offset + 512, end)));
      if (name === 'run/manifest.json') manifest = entry;
      else events.push(entry as PublicVerifierReal01Event);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(manifest);
  events.sort((a, b) => a.sequence - b.sequence);
  assert.equal(events.length, inspection.eventCount);
  return { archiveBytes, inspection, manifest, events };
}
