import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionHistoryPreserved, assertReviewedPublicationSnapshot, assertVersionedPublicationTarget, publishPath } from '../scripts/publish-production.js';
import { MATERIALS_VERSION } from '../scripts/production-materials.js';
import { sha256, PUBLIC_PROJECT_ID } from '../scripts/production-public-safety.js';
import { readFileSync } from 'node:fs';
import { buildSelectedHtmlMaterials, HTML_MATERIALS_FILENAME, SELECTED_HTML_MATERIAL_ARCHIVES, SELECTED_HTML_MATERIAL_FILES } from '../scripts/production-html-materials.js';
import { buildReviewedPublicRenders, productionReviewLayout } from '../scripts/production-public.js';
import { buildMaterialZipSnapshot } from '../scripts/production-material-zip.js';
import { VERIFIER_REAL02_MATERIAL_FILES } from '../scripts/production-study-materials.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { demoHtml } from '../server/production/fixtures.js';
import { publicPath, type PackageManifest } from '../scripts/production-public-safety.js';

test('versioned production publication is confined to its reviewed source revision', () => {
  const commit = 'a'.repeat(40);
  for (const relative of ['index.html', 'submission/demo.mp4', 'previews/MOCK-01/index.html']) {
    assert.equal(publishPath(`reviews/${commit}/${relative}`, commit), `production/reviews/${commit}/${relative}`);
  }
  for (const name of [`reviews/${'b'.repeat(40)}/submission/demo.mp4`, `reviews/${commit}/submission/../../index.html`, `reviews/${commit}/previews/CAMERA-04/index.html`, 'reviews/main/index.html', 'assets/index.html', 'index.html/']) {
    assert.throws(() => publishPath(name, commit));
  }
  assert.throws(() => publishPath(`reviews/${commit}/index.html`));
  assert.equal(publishPath('submission/production-mock-submission.pdf'), 'production/submission/production-mock-submission.pdf');
  assert.equal(publishPath('publication-manifest.json', commit), 'production/publication-manifest.json');
});

test('only entry pointers and the reviewed new snapshot may be publication targets', () => {
  const commit = 'a'.repeat(40);
  for (const name of ['index.html', 'publication-manifest.json', `reviews/${commit}/submission/demo.mp4`]) assert.doesNotThrow(() => assertVersionedPublicationTarget(name, commit));
  for (const name of ['submission/demo.mp4', 'previews/MOCK-01/index.html', `reviews/${'b'.repeat(40)}/index.html`]) assert.throws(() => assertVersionedPublicationTarget(name, commit));
});

test('production history preserves every old immutable leaf including legacy assets', () => {
  const old = [{ path: 'submission/demo.mp4', sha: 'a'.repeat(40), mode: '100644', type: 'blob' },
    { path: 'reviews/old/submission/report.pdf', sha: 'b'.repeat(40), mode: '100644', type: 'blob' },
    { path: 'index.html', sha: 'c'.repeat(40), mode: '100644', type: 'blob' },
    { path: 'reviews', sha: 'd'.repeat(40), mode: '040000', type: 'tree' }];
  const next = [...old.slice(0, 2), { ...old[2], sha: 'e'.repeat(40) }, { ...old[3], sha: 'f'.repeat(40) }, { path: 'reviews/new/index.html', sha: '0'.repeat(40), mode: '100644', type: 'blob' }];
  assert.doesNotThrow(() => assertProductionHistoryPreserved(old, next));
  for (const alteration of [{ sha: 'f'.repeat(40) }, { mode: '100755' }, { type: 'commit' }]) assert.throws(() => assertProductionHistoryPreserved(old, [{ ...next[0], ...alteration }, ...next.slice(1)]));
  assert.throws(() => assertProductionHistoryPreserved(old, next.slice(1)));
  assert.throws(() => assertProductionHistoryPreserved(old, [...next, next[0]]));
});

test('publisher rejects absent, obsolete and misspelled material labels instead of bypassing REAL02 verification', () => {
  const commit = 'a'.repeat(40);
  const manifest = { version: PUBLIC_PROJECT_ID, sourceBranch: 'feature/autonomous-production', publisherCommit: commit, evidencePlatformCommit: 'b'.repeat(40), materialsBase: `reviews/${commit}/submission/`, versionedEntry: `reviews/${commit}/index.html`, files: [] };
  for (const materialsVersion of [undefined, 'production-materials-v5', 'production-materials-v6', 'production-materials-v6x', 'production-materials-v7x']) assert.throws(() => assertReviewedPublicationSnapshot({ ...manifest, materialsVersion }, new Map(), commit), /current reviewed/);
  assert.throws(() => assertReviewedPublicationSnapshot({ ...manifest, materialsVersion: MATERIALS_VERSION }, new Map(), commit), /package manifest/);
});

test('publisher binds mapped source bytes and rejects extra or missing publication inventory', () => {
  const commit = 'a'.repeat(40), platformCommit = 'b'.repeat(40), base = `reviews/${commit}/`;
  const sources = ['REVIEW.md', 'materials-summary.json', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'CURRENT-PROGRESS.md', 'HTML-DELIVERY-STATUS.json', 'mixed-and-live-runs.json', 'requirements.json', 'submission-evidence.json', 'production-mock-submission.pdf', 'demo.webm', ...['01', '02', '03'].map(id => `MOCK-${id}/index.html`)];
  const sourceBytes = Buffer.from('unit-only');
  const pack = Buffer.from(JSON.stringify({ version: 'mock-package-v2', materialsVersion: MATERIALS_VERSION, publisherCommit: commit, platformCommit, files: sources.map(name => ({ path: name, sha256: sha256(sourceBytes) })) }));
  const bytes = new Map<string, Buffer>(sources.map(name => [base + 'submission/' + (/^MOCK-/.test(name) ? name + '.txt' : name), sourceBytes]));
  bytes.set(base + 'submission/package-manifest.json', pack);
  for (const name of ['index.html', base + 'index.html', base + 'submission/materials.zip', ...['01', '02', '03'].map(id => base + `previews/MOCK-${id}/index.html`)]) bytes.set(name, sourceBytes);
  const manifest = { version: PUBLIC_PROJECT_ID, materialsVersion: MATERIALS_VERSION, sourceBranch: 'feature/autonomous-production', publisherCommit: commit, evidencePlatformCommit: platformCommit, sourcePackageManifestSha256: sha256(pack), materialsBase: base + 'submission/', versionedEntry: base + 'index.html', files: [] };
  const changed = new Map(bytes); changed.set(base + 'submission/MOCK-01/index.html.txt', Buffer.from('changed'));
  assert.throws(() => assertReviewedPublicationSnapshot(manifest, changed, commit), /differs from its reviewed package/);
  const extra = new Map(bytes); extra.set(base + 'submission/index.html', sourceBytes);
  assert.throws(() => assertReviewedPublicationSnapshot(manifest, extra, commit), /inventory differs/);
  const missing = new Map(bytes); missing.delete(base + 'previews/MOCK-01/index.html');
  assert.throws(() => assertReviewedPublicationSnapshot(manifest, missing, commit), /inventory differs/);
});

/** Test-owned publication built purely from selected public files; no API/media/model execution. */
function completePublicationFixture() {
  const commit = 'a'.repeat(40), platformCommit = 'b'.repeat(40), layout = productionReviewLayout(commit), sources = new Map<string, Buffer>();
  for (const name of VERIFIER_REAL02_MATERIAL_FILES) sources.set(name, readFileSync(new URL('../docs/production/experiments/' + name, import.meta.url)));
  const htmlOriginals = new Map<string, Buffer>(SELECTED_HTML_MATERIAL_ARCHIVES.flatMap(id => SELECTED_HTML_MATERIAL_FILES.map(name => [`${id}/${name}`, readFileSync(new URL(`../docs/production/experiments/${id}/${name}`, import.meta.url))] as const)));
  sources.set(HTML_MATERIALS_FILENAME, Buffer.from(JSON.stringify(buildSelectedHtmlMaterials(commit, htmlOriginals))));
  for (const demo of PRODUCTION_DEMO_CASES) {
    const input = productionRunInputSchema.parse({ brief: demo.brief, mode: 'demo', demoCaseId: demo.operation, agentIds: Array.from({ length: 6 }, () => '00000000-0000-4000-8000-000000000001'), requirement: { id: demo.id, source: demo.source, acceptance: demo.acceptance, kind: 'illustrative' } });
    const run: ProductionRun = { id: demo.id, createdAt: '2026-10-09T00:00:00.000Z', platformCommit, evidenceKind: 'fixture', input, status: 'completed', agentSnapshot: [], events: [], calls: [], outputs: [], gateHistory: [], verifications: [], repairs: 0, interventions: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, artifacts: [{ name: 'index.html', type: 'text/html' }] };
    sources.set(`${demo.id}/run.json`, Buffer.from(JSON.stringify(run))); sources.set(`${demo.id}/index.html`, Buffer.from(demoHtml(input)));
  }
  for (const [name, value] of [['requirements.json', PRODUCTION_DEMO_CASES], ['submission-evidence.json', {}], ['jev-benchmarks.json', []], ['mixed-and-live-runs.json', []], ['materials-summary.json', {}]] as const) sources.set(name, Buffer.from(JSON.stringify(value)));
  for (const name of ['REVIEW.md', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'CURRENT-PROGRESS.md', 'production-mock-submission.pdf', 'demo.webm', 'demo.mp4']) sources.set(name, Buffer.from('synthetic fixture bytes, not a new PDF/video experiment'));
  const pack: PackageManifest = { version: 'mock-package-v2', materialsVersion: MATERIALS_VERSION, publisherCommit: commit, platformCommit, videoSourceCommit: platformCommit, generatedAt: '2026-10-09T00:00:00.000Z', submissionBaseline: 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466', files: [...sources].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })) };
  sources.set('package-manifest.json', Buffer.from(JSON.stringify(pack)));
  const manifest = { version: PUBLIC_PROJECT_ID, sourceBranch: 'feature/autonomous-production', ...layout, publisherCommit: commit, evidencePlatformCommit: platformCommit, generatedAt: '2026-10-09T00:00:00.000Z', videoDurationSeconds: 205.88, videoName: 'demo.mp4', videoSourceCommit: platformCommit, sourcePackageManifestSha256: sha256(sources.get('package-manifest.json')!), materialsVersion: MATERIALS_VERSION, files: [] };
  const bytes = new Map<string, Buffer>([...sources].map(([name, content]) => [layout.materialsBase + publicPath(name), content]));
  for (const [name, content] of buildReviewedPublicRenders(manifest, pack, sources)) bytes.set(name, content);
  bytes.set(layout.materialsBase + 'materials.zip', buildMaterialZipSnapshot(sources));
  return { commit, sources, manifest, bytes, htmlOriginals };
}
function replaceBoundSource(fixture: ReturnType<typeof completePublicationFixture>, name: string, content: Buffer | null) {
  const target = fixture.manifest.materialsBase + publicPath(name), packTarget = fixture.manifest.materialsBase + 'package-manifest.json';
  const pack = JSON.parse(fixture.bytes.get(packTarget)!.toString());
  if (content) { fixture.bytes.set(target, content); pack.files.find((item: { path: string }) => item.path === name).sha256 = sha256(content); }
  else { fixture.bytes.delete(target); pack.files = pack.files.filter((item: { path: string }) => item.path !== name); }
  const packBytes = Buffer.from(JSON.stringify(pack)); fixture.bytes.set(packTarget, packBytes); fixture.manifest.sourcePackageManifestSha256 = sha256(packBytes);
}

test('v7 complete publisher snapshot preserves exact ZIP, selected HTML, REAL02 and trusted executable render bindings', () => {
  const fixture = completePublicationFixture();
  const verified = assertReviewedPublicationSnapshot(fixture.manifest, fixture.bytes, fixture.commit, fixture.htmlOriginals);
  assert.deepEqual(verified.get(HTML_MATERIALS_FILENAME), fixture.sources.get(HTML_MATERIALS_FILENAME));
  assert.ok(verified.has('CURRENT-PROGRESS.md')); assert.equal(verified.size, fixture.sources.size);
  assert.equal(fixture.manifest.materialsVersion, 'production-materials-v7');
  for (const name of ['index.html', fixture.manifest.versionedEntry, fixture.manifest.previewsBase + 'MOCK-01/index.html']) {
    const replaced = new Map(fixture.bytes); replaced.set(name, Buffer.from('<script>location.href="https://outside.invalid"</script>'));
    assert.throws(() => assertReviewedPublicationSnapshot(fixture.manifest, replaced, fixture.commit), /trusted renderer/);
  }
  const stale = { ...fixture.manifest, materialsVersion: 'production-materials-v6' }; assert.throws(() => assertReviewedPublicationSnapshot(stale, fixture.bytes, fixture.commit), /current reviewed/);
});

test('authoritative original snapshot defeats a coherent forged index, package hash, ZIP and both portal renders', () => {
  const fixture = completePublicationFixture(), index = JSON.parse(fixture.sources.get(HTML_MATERIALS_FILENAME)!.toString()), entry = index.entries[7], run = JSON.parse(entry.originalRunUtf8);
  run.error += ' synthetic forged archive'; entry.originalRunUtf8 = JSON.stringify(run); entry.summary.error = run.error;
  entry.originalArtifacts[0].sha256 = sha256(entry.originalRunUtf8); entry.originalArtifacts[0].bytes = Buffer.byteLength(entry.originalRunUtf8);
  replaceBoundSource(fixture, HTML_MATERIALS_FILENAME, Buffer.from(JSON.stringify(index)));
  const sources = new Map(fixture.sources); sources.set(HTML_MATERIALS_FILENAME, fixture.bytes.get(fixture.manifest.materialsBase + HTML_MATERIALS_FILENAME)!);
  const packBytes = fixture.bytes.get(fixture.manifest.materialsBase + 'package-manifest.json')!; sources.set('package-manifest.json', packBytes);
  const pack = JSON.parse(packBytes.toString()) as PackageManifest;
  for (const [name, content] of buildReviewedPublicRenders(fixture.manifest, pack, sources)) fixture.bytes.set(name, content);
  fixture.bytes.set(fixture.manifest.materialsBase + 'materials.zip', buildMaterialZipSnapshot(sources));
  // Pure self-contained verification proves internal consistency only. Real
  // public/publish entry points always inject the current clean HEAD originals.
  assert.doesNotThrow(() => assertReviewedPublicationSnapshot(fixture.manifest, fixture.bytes, fixture.commit));
  assert.throws(() => assertReviewedPublicationSnapshot(fixture.manifest, fixture.bytes, fixture.commit, fixture.htmlOriginals), /archived originals/);
});

test('new publisher rejects false HTML summary and conflicting mixed evidence even when file/package hashes are rebound', () => {
  const fixture = completePublicationFixture(), summary = JSON.parse(fixture.sources.get(HTML_MATERIALS_FILENAME)!.toString());
  summary.entries[7].summary.gateState = 'passed'; replaceBoundSource(fixture, HTML_MATERIALS_FILENAME, Buffer.from(JSON.stringify(summary)));
  assert.throws(() => assertReviewedPublicationSnapshot(fixture.manifest, fixture.bytes, fixture.commit), /portable index/);
  const mixed = completePublicationFixture(), run = JSON.parse(JSON.parse(mixed.sources.get(HTML_MATERIALS_FILENAME)!.toString()).entries[7].originalRunUtf8) as ProductionRun;
  run.repairs = 0; replaceBoundSource(mixed, 'mixed-and-live-runs.json', Buffer.from(JSON.stringify([run])));
  assert.throws(() => assertReviewedPublicationSnapshot(mixed.manifest, mixed.bytes, mixed.commit), /existing mixed run/);
  for (const missing of ['CURRENT-PROGRESS.md', HTML_MATERIALS_FILENAME]) {
    const value = completePublicationFixture(); replaceBoundSource(value, missing, null);
    assert.throws(() => assertReviewedPublicationSnapshot(value.manifest, value.bytes, value.commit), /material is missing/);
  }
});
