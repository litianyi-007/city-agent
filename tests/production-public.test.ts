import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentReviewedPackage, assertReviewedPublicRender, buildReviewedPublicRenders, preferredPublicVideo, probeCheckedVideoDuration, productionReviewLayout } from '../scripts/production-public.js';
import { MATERIALS_VERSION } from '../scripts/production-materials.js';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { demoHtml } from '../server/production/fixtures.js';
import { sha256, type PackageManifest } from '../scripts/production-public-safety.js';
import { VERIFIER_REAL02_MATERIAL_FILES } from '../scripts/production-study-materials.js';

test('reviewer publication layout is immutable and does not target historical production material paths', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(productionReviewLayout(commit), {
    base: `reviews/${commit}/`,
    materialsBase: `reviews/${commit}/submission/`,
    previewsBase: `reviews/${commit}/previews/`,
    versionedEntry: `reviews/${commit}/index.html`,
  });
  for (const unsafe of ['main', 'a'.repeat(7), '../other', 'A'.repeat(40), 'a'.repeat(40) + '/outside']) assert.throws(() => productionReviewLayout(unsafe));
});

test('public video selects registered MP4 first, falls back to WebM and fails closed when neither is present', () => {
  assert.equal(preferredPublicVideo(new Map([['demo.mp4', Buffer.alloc(0)], ['demo.webm', Buffer.alloc(0)]])), 'demo.mp4');
  assert.equal(preferredPublicVideo(new Map([['demo.webm', Buffer.alloc(0)]])), 'demo.webm');
  assert.throws(() => preferredPublicVideo(new Map([['unregistered-video.mp4', Buffer.alloc(0)]])));
});

test('new public installer requires the same reviewed material version and immutable publisher, not the prior v3 report', () => {
  const commit = 'a'.repeat(40);
  const files = new Map(['REVIEW.md', 'materials-summary.json', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md'].map(name => [name, Buffer.alloc(0)]));
  const manifest = { version: 'mock-package-v2', materialsVersion: MATERIALS_VERSION, publisherCommit: commit };
  assert.doesNotThrow(() => assertCurrentReviewedPackage(manifest, files, commit));
  assert.throws(() => assertCurrentReviewedPackage({ ...manifest, materialsVersion: 'production-materials-v3' }, files, commit));
  assert.throws(() => assertCurrentReviewedPackage({ ...manifest, publisherCommit: 'b'.repeat(40) }, files, commit));
  const missingGuide = new Map(files); missingGuide.delete('REVIEWER-GUIDE.md');
  assert.throws(() => assertCurrentReviewedPackage(manifest, missingGuide, commit));
});

function renderSnapshot() {
  const commit = 'a'.repeat(40), platformCommit = 'b'.repeat(40), files = new Map<string, Buffer>();
  for (const name of VERIFIER_REAL02_MATERIAL_FILES) files.set(name, readFileSync(new URL('../docs/production/experiments/' + name, import.meta.url)));
  for (const fixture of PRODUCTION_DEMO_CASES) {
    const input = productionRunInputSchema.parse({ brief: fixture.brief, mode: 'demo', demoCaseId: fixture.operation, agentIds: Array.from({ length: 6 }, () => '00000000-0000-4000-8000-000000000001'), requirement: { id: fixture.id, source: fixture.source, acceptance: fixture.acceptance, kind: 'illustrative' } });
    const run = { id: fixture.id, createdAt: '2026-10-08T00:00:00.000Z', platformCommit, evidenceKind: 'fixture', input, status: 'completed', agentSnapshot: [], events: [], calls: [], outputs: [], gateHistory: [], verifications: [], repairs: 0, interventions: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, artifacts: [{ name: 'index.html', type: 'text/html' }] } as ProductionRun;
    files.set(`${fixture.id}/run.json`, Buffer.from(JSON.stringify(run))); files.set(`${fixture.id}/index.html`, Buffer.from(demoHtml(input)));
  }
  for (const [name, value] of [['requirements.json', PRODUCTION_DEMO_CASES], ['submission-evidence.json', {}], ['jev-benchmarks.json', []], ['mixed-and-live-runs.json', []], ['materials-summary.json', {}]] as const) files.set(name, Buffer.from(JSON.stringify(value)));
  for (const name of ['REVIEW.md', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'demo.mp4']) files.set(name, Buffer.from('fixture bytes, no media/service invocation'));
  const manifest: PackageManifest = { version: 'mock-package-v2', materialsVersion: MATERIALS_VERSION, publisherCommit: commit, platformCommit, videoSourceCommit: platformCommit, generatedAt: '2026-10-08T00:00:00.000Z', submissionBaseline: 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466', files: [...files].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })) };
  files.set('package-manifest.json', Buffer.from(JSON.stringify(manifest)));
  const layout = productionReviewLayout(commit), metadata = { ...layout, publisherCommit: commit, generatedAt: '2026-10-08T00:00:00.000Z', videoDurationSeconds: 205.88, videoName: 'demo.mp4', videoSourceCommit: platformCommit, sourcePackageManifestSha256: sha256(files.get('package-manifest.json')!), evidencePlatformCommit: platformCommit, materialsVersion: MATERIALS_VERSION };
  return { manifest, files, metadata };
}
test('publisher regenerates both portals and all three byte-verified previews, rejecting replaced executable HTML', () => {
  const { manifest, files, metadata } = renderSnapshot();
  const rendered = buildReviewedPublicRenders(metadata, manifest, files); assert.equal(rendered.size, 5); assertReviewedPublicRender(metadata, files, rendered);
  for (const name of rendered.keys()) {
    const changed = new Map(rendered); changed.set(name, Buffer.from('<script>location.href="https://outside.invalid"</script>'));
    assert.throws(() => assertReviewedPublicRender(metadata, files, changed), /trusted renderer/);
  }
  const missing = new Map(rendered); missing.delete('index.html'); assert.throws(() => assertReviewedPublicRender(metadata, files, missing));
});
test('public render metadata cannot change evidence/video sources, versioned paths or malformed duration', () => {
  const { manifest, files, metadata } = renderSnapshot(), rendered = buildReviewedPublicRenders(metadata, manifest, files);
  for (const change of [{ sourcePackageManifestSha256: '0'.repeat(64) }, { evidencePlatformCommit: 'c'.repeat(40) }, { videoSourceCommit: 'c'.repeat(40) }, { materialsBase: '../submission/' }, { videoDurationSeconds: NaN }, { videoDurationSeconds: -1 }, { generatedAt: '<script>unsafe</script>' }]) assert.throws(() => assertReviewedPublicRender({ ...metadata, ...change }, files, rendered));
  const tampered = new Map(files); tampered.set('MOCK-01/index.html', Buffer.from('<script>untrusted()</script>')); assert.throws(() => buildReviewedPublicRenders(metadata, manifest, tampered), /trusted fixture/);
});

const worktreeRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
async function probeFixture(t: TestContext) {
  const parent = path.join(worktreeRoot, 'output/production-public');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'probe-test-'));
  t.after(() => rmdir(directory));
  return directory;
}
function mockProbe(t: TestContext, implementation: (filename: string, options: Record<string, unknown>) => string) {
  t.mock.method(childProcess, 'execFileSync', ((command: string, args: string[], options: Record<string, unknown>) => {
    assert.equal(command, 'ffprobe');
    assert.deepEqual(args.slice(0, -1), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '-i']);
    assert.equal(options.cwd, worktreeRoot);
    assert.equal(options.timeout, 15000);
    assert.equal(options.maxBuffer, 1_000_000);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.input, undefined);
    return implementation(args.at(-1)!, options);
  }) as typeof childProcess.execFileSync);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}
test('video probe uses a private exclusive snapshot of the checked Buffer and removes only its own temporary files', async t => {
  let sentinel: string | undefined;
  t.after(() => sentinel ? unlink(sentinel) : undefined);
  const directory = await probeFixture(t), original = Buffer.alloc(5_000_000, 23), expected = Buffer.from(original);
  sentinel = path.join(directory, 'unrelated.txt'); writeFileSync(sentinel, 'preserve unrelated publication files');
  mockProbe(t, filename => {
    assert.equal(path.dirname(path.dirname(filename)), directory);
    assert.match(path.basename(path.dirname(filename)), /^\.video-probe-/);
    assert.equal(statSync(filename).isFile(), true);
    assert.equal(statSync(filename).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(filename)).mode & 0o777, 0o700);
    assert.deepEqual(readFileSync(filename), expected);
    return '{"format":{"duration":"205.880000"}}';
  });
  const pending = probeCheckedVideoDuration(original, worktreeRoot, directory);
  original.fill(99);
  assert.equal(await pending, 205.88);
  assert.deepEqual(await readdir(directory), ['unrelated.txt']);
});
test('video probe preserves process/parse/duration failures, cleans snapshots, and fails closed on cleanup failure', async t => {
  const directory = await probeFixture(t);
  let response: string | Error = '';
  let leftover: string | undefined;
  mockProbe(t, filename => {
    if (leftover !== undefined) { leftover = path.join(path.dirname(filename), 'unexpected.txt'); writeFileSync(leftover, 'not recursively removed'); }
    if (response instanceof Error) throw response;
    return response;
  });
  for (const code of ['EPIPE', 'ETIMEDOUT', 'NONZERO_EXIT']) {
    response = Object.assign(new Error('controlled ffprobe failure'), { code, status: code === 'EPIPE' ? 0 : 1, stdout: '{"format":{"duration":"205.88"}}' });
    await assert.rejects(probeCheckedVideoDuration(Buffer.from('checked bytes'), worktreeRoot, directory), error => error === response);
    assert.deepEqual(await readdir(directory), []);
  }
  for (response of ['not JSON', '{}', '{"format":{}}', ...['0', '-1', 'NaN', 'Infinity', '86400.001'].map(duration => JSON.stringify({ format: { duration } }))]) {
    await assert.rejects(probeCheckedVideoDuration(Buffer.from('checked bytes'), worktreeRoot, directory));
    assert.deepEqual(await readdir(directory), []);
  }
  const processError = new Error('original process failure'); response = processError; leftover = 'create-owned-test-sentinel';
  await assert.rejects(probeCheckedVideoDuration(Buffer.from('checked bytes'), worktreeRoot, directory), error => error instanceof AggregateError && error.errors[0] === processError && error.errors[1]?.code === 'ENOTEMPTY');
  assert.equal(existsSync(leftover!), true);
  await unlink(leftover!); await rmdir(path.dirname(leftover!));
  assert.deepEqual(await readdir(directory), []);
});
test('video probe rejects out-of-scope directories and file-size bounds before creating a snapshot', async t => {
  const directory = await probeFixture(t);
  await assert.rejects(probeCheckedVideoDuration(Buffer.from('checked bytes'), worktreeRoot, path.dirname(directory)), /publication scope/);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(30_000_001)]) await assert.rejects(probeCheckedVideoDuration(bytes, worktreeRoot, directory), /bounds/);
  assert.deepEqual(await readdir(directory), []);
});
test('real large archived MP4 reproduces early-close stdin EPIPE while checked file probing succeeds and cleans up', async t => {
  const archived = path.join(worktreeRoot, 'output/pdf/production-mock-materials-u8496O/demo.mp4');
  if (!existsSync(archived) || childProcess.spawnSync('ffprobe', ['-version'], { cwd: worktreeRoot, stdio: 'ignore' }).status !== 0) { t.skip('Optional public archived MP4 and native ffprobe are not installed in this checkout.'); return; }
  const bytes = readFileSync(archived);
  assert.ok(bytes.length > 1_000_000 && bytes.length <= 30_000_000);
  const oldPipe = childProcess.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '-i', 'pipe:0'], { cwd: worktreeRoot, input: bytes, encoding: 'utf8', timeout: 15000, maxBuffer: 1_000_000 });
  assert.equal(oldPipe.status, 0);
  assert.equal((oldPipe.error as NodeJS.ErrnoException | undefined)?.code, 'EPIPE');
  assert.equal(Number(JSON.parse(oldPipe.stdout).format.duration), 205.88);
  const directory = await probeFixture(t);
  assert.equal(await probeCheckedVideoDuration(bytes, worktreeRoot, directory), 205.88);
  assert.deepEqual(await readdir(directory), []);
});
