import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPath } from '../scripts/publish-production.js';

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
