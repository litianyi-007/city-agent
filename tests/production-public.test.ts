import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrentReviewedPackage, assertReviewedPublicRender, buildReviewedPublicRenders, preferredPublicVideo, productionReviewLayout } from '../scripts/production-public.js';
import { MATERIALS_VERSION } from '../scripts/production-materials.js';
import { readFileSync } from 'node:fs';
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
