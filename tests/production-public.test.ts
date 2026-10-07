import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCurrentReviewedPackage, preferredPublicVideo, productionReviewLayout } from '../scripts/production-public.js';
import { MATERIALS_VERSION } from '../scripts/production-materials.js';

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
