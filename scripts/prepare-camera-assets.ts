import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CAMERA_ASSET_NOTICE, CAMERA_ASSET_PINS, CAMERA_ASSET_PROFILE, CAMERA_ASSET_VERSION, CAMERA_NPM_SOURCE, CAMERA_SOURCE_COMMIT } from '../shared/camera-asset-manifest.js';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const hash = (value: Buffer | string, algorithm = 'sha256') => createHash(algorithm).update(value).digest(algorithm === 'sha512' ? 'base64' : 'hex');
const MAX_ARCHIVE_BYTES = 26_000_000;
const MAX_ENTRIES = 100;
const allowedSources = new Set([CAMERA_NPM_SOURCE.url, ...CAMERA_ASSET_PINS.filter(pin => !pin.archivePath).map(pin => pin.source)]);

function verifyBytes(value: Buffer, expected: { bytes: number; sha256: string }, name: string) {
  if (value.byteLength !== expected.bytes || hash(value) !== expected.sha256) throw new Error(`Asset byte/hash mismatch: ${name}`);
}

/** No redirects, URL parameters, arbitrary mirrors, retries, or install scripts. */
export async function downloadPinnedAsset(url: string, expected: { bytes: number; sha256: string }): Promise<Buffer> {
  if (!allowedSources.has(url) || !url.startsWith('https://')) throw new Error('Asset URL is not in the reviewed exact-source allowlist.');
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > 8_000_000) throw new Error('Asset download bound is invalid.');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'City-Agent-Camera-Asset-Preparation/1', 'Accept-Encoding': 'identity' } });
  if (response.status !== 200 || response.url !== url || !response.body) throw new Error(`Asset source failed or redirected: HTTP ${response.status}`);
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > expected.bytes)) { await response.body.cancel(); throw new Error('Asset Content-Length exceeds its reviewed bound.'); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > expected.bytes) throw new Error('Asset streamed bytes exceed the reviewed bound.'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const buffer = Buffer.concat(chunks); verifyBytes(buffer, expected, url); return buffer;
}

function octal(field: Buffer): number {
  const value = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Unsupported tar numeric field.');
  const number = Number.parseInt(value, 8); if (!Number.isSafeInteger(number)) throw new Error('Tar numeric field overflow.'); return number;
}

/** Read a bounded ordinary-file-only tar in memory; never extract paths to disk. */
export function unpackCameraArchive(compressed: Buffer): Map<string, Buffer> {
  verifyBytes(compressed, CAMERA_NPM_SOURCE, 'npm tarball');
  if (`sha512-${hash(compressed, 'sha512')}` !== CAMERA_NPM_SOURCE.integrity) throw new Error('npm published integrity mismatch.');
  const tar = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const files = new Map<string, Buffer>(); let offset = 0; let entries = 0; let ended = false;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { if (tar.subarray(offset).some(byte => byte !== 0)) throw new Error('Unexpected data after tar terminator.'); ended = true; break; }
    if (++entries > MAX_ENTRIES) throw new Error('Tar contains too many entries.');
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0];
    const type = header[156];
    if (prefix || !/^package\/[a-zA-Z0-9._/-]+$/.test(name) || name.split('/').includes('..') || files.has(name) || (type !== 48 && type !== 0)) throw new Error('Tar path, duplicate, metadata or non-ordinary entry rejected.');
    const expectedChecksum = octal(header.subarray(148, 156));
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (expectedChecksum !== actualChecksum) throw new Error('Tar header checksum mismatch.');
    const bytes = octal(header.subarray(124, 136));
    if (bytes > MAX_ARCHIVE_BYTES || offset + 512 + bytes > tar.byteLength) throw new Error('Truncated or oversized tar entry.');
    files.set(name, tar.subarray(offset + 512, offset + 512 + bytes));
    offset += 512 + Math.ceil(bytes / 512) * 512;
  }
  if (!ended) throw new Error('Tar archive lacks a complete terminator.');
  for (const pin of CAMERA_ASSET_PINS.filter(pin => pin.archivePath)) { const value = files.get(pin.archivePath!); if (!value) throw new Error(`Missing npm asset: ${pin.archivePath}`); verifyBytes(value, pin, pin.path); }
  const metadata = JSON.parse(files.get('package/package.json')!.toString('utf8')) as { name: string; version: string; license: string };
  if (metadata.name !== '@mediapipe/tasks-vision' || metadata.version !== CAMERA_ASSET_VERSION || metadata.license !== 'Apache-2.0') throw new Error('npm package identity or license mismatch.');
  return files;
}

export function preparedCameraManifest() {
  return {
    version: CAMERA_ASSET_PROFILE, reviewedOn: '2026-10-07', license: 'Apache-2.0',
    npm: { name: '@mediapipe/tasks-vision', version: CAMERA_ASSET_VERSION, ...CAMERA_NPM_SOURCE, gitHead: null },
    source: { repository: 'https://github.com/google-ai-edge/mediapipe', tag: `v${CAMERA_ASSET_VERSION}`, commit: CAMERA_SOURCE_COMMIT, reproducibleBuildVerified: false },
    model: { name: 'hand_landmarker', variant: 'float16/1', modelCardDate: '2021-10', licenseSource: 'MODEL-CARD.pdf' },
    assets: CAMERA_ASSET_PINS,
    notice: { path: 'NOTICE', bytes: Buffer.byteLength(CAMERA_ASSET_NOTICE), sha256: hash(CAMERA_ASSET_NOTICE) },
    runtime: { assetBase: '/api/production/camera-assets', workerType: 'classic', modelInputMode: 'VIDEO', cameraImagesIncluded: false, externalNetworkAllowed: false },
    telemetry: { publicApiJsLiteralInspection: 'No telemetry/analytics/sendBeacon or HTTP URL literals found in the pinned browser bundle and two WASM loader JS files. Loaders include WEBGL_SHADER_CALC_METRICS local GPU timing helpers. This is not proof of absence of telemetry in compiled binaries.', runtimeEgressVerified: false, upstreamNotice: 'https://github.com/google-ai-edge/mediapipe#privacy-notice' },
  };
}
const manifestBytes = () => Buffer.from(`${JSON.stringify(preparedCameraManifest(), null, 2)}\n`);

async function withinOwnWorktree(root: string) {
  if (path.resolve(root) !== ROOT || await realpath(root) !== ROOT) throw new Error('Preparation is restricted to this script\'s production worktree.');
  const publicDirectory = path.join(ROOT, 'public'); const publicStat = await lstat(publicDirectory);
  if (!publicStat.isDirectory() || publicStat.isSymbolicLink() || await realpath(publicDirectory) !== publicDirectory) throw new Error('public directory must be an ordinary local directory.');
  return path.join(publicDirectory, 'camera-assets');
}

async function checkedOrdinaryFile(directory: string, name: string, bytes: number): Promise<Buffer> {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Unsafe prepared asset name.');
  const target = path.join(directory, name); const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes || await realpath(target) !== target) throw new Error(`Prepared asset is not an ordinary exact-size local file: ${name}`);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const opened = await handle.stat(); if (!opened.isFile() || opened.size !== bytes) throw new Error(`Prepared asset changed: ${name}`); return await handle.readFile(); }
  finally { await handle.close(); }
}

export async function verifyCameraAssets(root = ROOT) {
  const directory = await withinOwnWorktree(root); const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Prepared asset directory is not an ordinary local directory.');
  const names = await readdir(directory); const expectedNames = [...CAMERA_ASSET_PINS.map(pin => pin.path), 'NOTICE', 'manifest.json'].sort();
  if (names.sort().join('\n') !== expectedNames.join('\n')) throw new Error('Prepared assets are missing, partial, or contain unregistered files.');
  for (const pin of CAMERA_ASSET_PINS) verifyBytes(await checkedOrdinaryFile(directory, pin.path, pin.bytes), pin, pin.path);
  const notice = Buffer.from(CAMERA_ASSET_NOTICE); assert.deepEqual(await checkedOrdinaryFile(directory, 'NOTICE', notice.byteLength), notice, 'Dependency notice differs.');
  const manifest = manifestBytes(); assert.deepEqual(await checkedOrdinaryFile(directory, 'manifest.json', manifest.byteLength), manifest, 'Prepared manifest differs from reviewed source pins.');
  return preparedCameraManifest();
}

export async function prepareCameraAssets(root = ROOT) {
  const directory = await withinOwnWorktree(root);
  let exists = true;
  try { await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; exists = false; }
  if (exists) return await verifyCameraAssets(root); // partial members must not trigger network repair
  const archive = unpackCameraArchive(await downloadPinnedAsset(CAMERA_NPM_SOURCE.url, CAMERA_NPM_SOURCE));
  const assets = new Map<string, Buffer>();
  for (const pin of CAMERA_ASSET_PINS) assets.set(pin.path, pin.archivePath ? archive.get(pin.archivePath)! : await downloadPinnedAsset(pin.source, pin));
  assets.set('NOTICE', Buffer.from(CAMERA_ASSET_NOTICE)); assets.set('manifest.json', manifestBytes());
  // A branch-local ignored staging directory; existing or partial targets are
  // never overwritten or silently repaired. Manifest is installed last.
  const staging = await mkdtemp(path.join(ROOT, '.city-agent-camera-prep-'));
  try {
    for (const [name, value] of assets) await writeFile(path.join(staging, name), value, { flag: 'wx', mode: 0o644 });
    await mkdir(directory); // atomic exclusive claim; EEXIST means stop, not replace
    for (const name of assets.keys()) await link(path.join(staging, name), path.join(directory, name));
  } finally { await rm(staging, { recursive: true, force: false }); }
  return await verifyCameraAssets(root);
}

function selfTest() {
  assert.throws(() => unpackCameraArchive(Buffer.from('not a pinned archive')), /byte\/hash mismatch/);
  assert.throws(() => verifyBytes(Buffer.from('changed'), { bytes: 7, sha256: '0'.repeat(64) }, 'fixture'), /mismatch/);
  assert.equal(new Set(CAMERA_ASSET_PINS.map(pin => pin.path)).size, CAMERA_ASSET_PINS.length);
  assert(CAMERA_ASSET_PINS.every(pin => /^[a-f0-9]{64}$/.test(pin.sha256) && pin.bytes > 0 && /^[a-zA-Z0-9._-]+$/.test(pin.path)));
  assert.equal(CAMERA_ASSET_PINS.filter(pin => pin.runtime).length, 6);
  assert.deepEqual(preparedCameraManifest(), preparedCameraManifest());
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (path.resolve(process.cwd()) !== ROOT) throw new Error('Run asset preparation with the production worktree as explicit working directory.');
  const args = process.argv.slice(2); if (args.length > 1 || args.some(arg => !['--verify', '--self-test'].includes(arg))) throw new Error('Only --verify or --self-test is supported; no arbitrary paths or source URLs.');
  if (args.includes('--self-test')) { selfTest(); console.log('Camera asset preparation self-test passed; no files or network used.'); }
  else { const started = performance.now(); const manifest = args.includes('--verify') ? await verifyCameraAssets() : await prepareCameraAssets(); console.log(JSON.stringify({ verified: true, profile: manifest.version, version: manifest.npm.version, files: manifest.assets.length + 2, runtimeBytes: manifest.assets.filter(pin => pin.runtime).reduce((sum, pin) => sum + pin.bytes, 0), durationMs: Math.round(performance.now() - started), directory: path.join(ROOT, 'public/camera-assets') }, null, 2)); }
}
