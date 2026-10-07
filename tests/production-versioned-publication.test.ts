import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionHistoryPreserved, assertReviewedPublicationSnapshot, assertVersionedPublicationTarget, publishPath } from '../scripts/publish-production.js';
import { MATERIALS_VERSION } from '../scripts/production-materials.js';
import { sha256, PUBLIC_PROJECT_ID } from '../scripts/production-public-safety.js';

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
  for (const materialsVersion of [undefined, 'production-materials-v5', 'production-materials-v6x']) assert.throws(() => assertReviewedPublicationSnapshot({ ...manifest, materialsVersion }, new Map(), commit), /current reviewed/);
  assert.throws(() => assertReviewedPublicationSnapshot({ ...manifest, materialsVersion: MATERIALS_VERSION }, new Map(), commit), /package manifest/);
});

test('publisher binds mapped source bytes and rejects extra or missing publication inventory', () => {
  const commit = 'a'.repeat(40), platformCommit = 'b'.repeat(40), base = `reviews/${commit}/`;
  const sources = ['REVIEW.md', 'materials-summary.json', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'requirements.json', 'submission-evidence.json', 'production-mock-submission.pdf', 'demo.webm', ...['01', '02', '03'].map(id => `MOCK-${id}/index.html`)];
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
