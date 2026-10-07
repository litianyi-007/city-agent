import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import { assertPublicText, FROZEN_SUBMISSION_FILES, FROZEN_SUBMISSION_TAG, parsePublishingOptions, PUBLIC_LIVE_PROOF_FILES,
  PUBLIC_REVIEW_FILES, PUBLISHED_DEMO_URL, selectPagesBuildFiles, verifyPublicSubmission } from '../shared/publishing-contract';

function candidate(live = false) {
  const names = live ? [...PUBLIC_REVIEW_FILES, ...PUBLIC_LIVE_PROOF_FILES] : [...PUBLIC_REVIEW_FILES];
  const files: Record<string, string> = Object.fromEntries(names.map(name => [name, name.endsWith('.json') ? '{}' : `public artifact ${name}`]));
  const manifest = {
    schemaVersion: '1.0', kind: 'city-agent-review-candidate', generatedAt: '2026-10-07T12:00:00.000Z',
    proofId: '30000000-0000-4000-8000-000000000001', sourceHead: 'a'.repeat(40), sourceDirty: true,
    branch: 'feature/virtual-society-next', releaseStatus: 'public-reviewed-candidate', formalSubmission: 'not-confirmed',
    realModelCallsThisBatch: live ? 24 : 0, publishedDemo: PUBLISHED_DEMO_URL, frozenTag: FROZEN_SUBMISSION_TAG,
    historicalArtifactsModified: false, businessArtifactsVerification: {
      verifierVersion: 'submission-artifacts-verifier-1.0', registeredFiles: [], sourceAndExecutionAuthenticity: 'not-independently-attested',
      marketResearchValidated: false, rawEvidenceModified: false,
    }, checksumMeaning: 'byte-integrity-not-source-or-execution-attestation', publicationReview: {
      status: 'public-reviewed', reviewedAt: '2026-10-07T12:00:01.000Z', localPathsRemoved: true, internalLinksRemoved: true,
      credentialsRemoved: true, privateDataExcluded: true,
    }, files: names.map(name => ({ name, bytes: new TextEncoder().encode(files[name]).length, sha256: sha256(files[name]) })),
  };
  return { manifest, files };
}
function rehash(input: ReturnType<typeof candidate>) {
  input.manifest.files = Object.entries(input.files).map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value).length, sha256: sha256(value) }));
}

test('public manifest accepts only explicit reviewed zero-call or full live-proof bundles without mutation', () => {
  assert.equal(PUBLIC_REVIEW_FILES.length, 53); assert.equal(PUBLIC_LIVE_PROOF_FILES.length, 24);
  for (const live of [false, true]) {
    const input = candidate(live); const original = structuredClone(input);
    const manifest = verifyPublicSubmission(input); assert.equal(manifest.realModelCallsThisBatch, live ? 24 : 0);
    assert.deepEqual(input, original);
  }
});
test('public manifest rejects unreviewed flags, main branch, excess calls and arbitrary top-level fields', () => {
  for (const mutate of [
    (input: ReturnType<typeof candidate>) => { input.manifest.publicationReview.credentialsRemoved = false; },
    (input: ReturnType<typeof candidate>) => { input.manifest.branch = 'main'; },
    (input: ReturnType<typeof candidate>) => { input.manifest.realModelCallsThisBatch = 25; },
    (input: ReturnType<typeof candidate>) => { input.manifest.releaseStatus = 'local-candidate-not-published'; },
    (input: ReturnType<typeof candidate>) => { Object.assign(input.manifest, { privateNotes: 'not reviewed' }); },
  ]) { const input = candidate(); mutate(input); assert.throws(() => verifyPublicSubmission(input)); }
});
test('new real-call metadata requires complete live-proof even if every supplied hash matches', () => {
  const input = candidate(); input.manifest.realModelCallsThisBatch = 1;
  assert.throws(() => verifyPublicSubmission(input), /live-proof/);
  const partial = candidate(true); delete partial.files['live-proof/cors-checks.json']; rehash(partial);
  assert.throws(() => verifyPublicSubmission(partial), /清单/);
});
test('public bundle rejects duplicate, traversal, extra/missing paths and extra caller files', () => {
  const duplicate = candidate(); duplicate.manifest.files[1] = { ...duplicate.manifest.files[0] };
  assert.throws(() => verifyPublicSubmission(duplicate), /清单/);
  for (const name of ['../outside.json', 'private.db', '.env', 'live-proof/private-sessions.json', 'historical/transcript.md']) {
    const input = candidate(); input.files[name] = '{}'; rehash(input); assert.throws(() => verifyPublicSubmission(input), /清单/);
  }
  const missing = candidate(); delete missing.files['demo-next.mp4']; rehash(missing); assert.throws(() => verifyPublicSubmission(missing), /清单/);
  const extra = candidate(); extra.files['undocumented.json'] = '{}'; assert.throws(() => verifyPublicSubmission(extra), /清单/);
});
test('public byte integrity uses UTF-8 bytes and rejects post-review mutation', () => {
  const input = candidate(); input.files['README.md'] = '公开审查说明'; rehash(input); verifyPublicSubmission(input);
  input.files['README.md'] += '改'; assert.throws(() => verifyPublicSubmission(input), /字节/);
  const wrong = candidate(); wrong.manifest.files[0].sha256 = '0'.repeat(64); assert.throws(() => verifyPublicSubmission(wrong), /字节/);
});
test('public scanner rejects local paths, internal links, credential examples and escaped equivalents', () => {
  for (const value of [
    '/Users/ExampleUser/Documents/private', 'C:\\Users\\Someone\\private', 'https://docs.popo.netease.com/lingxi/internal',
    'qa-only-not-a-real-credential', 'synthetic-only-not-a-real-key', 'sk-not-a-real-credential-example', 'Bearer syntheticToken1234',
    String.raw`\u002fUsers\u002fExampleUser\u002fprivate`, '%2FUsers%2FExampleUser%2Fprivate', '&#47;Users&#47;user&#47;',
    'https:\\/\\/docs.popo.netease.com/secret',
  ]) {
    assert.throws(() => assertPublicText('notes.md', value), /非公开/);
    const input = candidate(); input.files['README.md'] = value; rehash(input); assert.throws(() => verifyPublicSubmission(input), /非公开/);
  }
});
test('public JSON refuses nested private fields but allows redacted placeholders and usage tokens', () => {
  for (const key of ['apiKey', 'api_key', 'Authorization', 'password', 'accessToken', 'credential', 'secret']) {
    const input = candidate(); input.files['verification.json'] = JSON.stringify({ nested: [{ [key]: 'not-credential-shaped-but-private' }] }); rehash(input);
    assert.throws(() => verifyPublicSubmission(input), /凭据字段/);
  }
  assertPublicText('usage.json', JSON.stringify({ totalTokens: 123, hasApiKey: true, apiKey: '[REDACTED]', password: '' }));
  assert.throws(() => assertPublicText('nested.json', JSON.stringify({ Authorization: { value: 'not-token-shaped-private' } })), /凭据字段/);
  assertPublicText('ui.js', 'headers.Authorization = `Bearer ${apiKey}`;');
  assert.throws(() => assertPublicText('bad.json', '{invalid'), /无法解析/);
});
test('publisher requires exact explicit approved artifact path and dry-run does not broaden arguments', () => {
  const selection = '--submission=output/release-candidate/30000000-0000-4000-8000-000000000001/submission-next';
  assert.deepEqual(parsePublishingOptions([selection, '--dry-run']), { dryRun: true, submission: selection.slice('--submission='.length) });
  for (const args of [[], ['--dry-run'], [selection, selection], [selection, '--dry-run', '--dry-run'],
    ['--submission=public/submission-next'], [selection, '--force'], [selection.replace('output/release-candidate/', '/tmp/')],
    [selection.replace('/submission-next', '/../submission-next')]]) assert.throws(() => parsePublishingOptions(args));
});
test('build selection deliberately ignores raw candidate tree but rejects new private/unknown assets', () => {
  const files = ['index.html', 'review-guide.html', 'assets/index_ABC-123.js', 'assets/main-ab12.css',
    ...FROZEN_SUBMISSION_FILES.map(name => `submission/${name}`), 'submission-next/README.md', 'submission-next/private-copy.json'];
  const selected = selectPagesBuildFiles(files); assert.equal(selected.some(name => name.startsWith('submission-next/')), false);
  for (const name of ['.env', 'private.db', 'output/research.json', 'assets/key.json', 'submission/other.json', 'main/transcripts.md']) {
    assert.throws(() => selectPagesBuildFiles([...files, name]), /白名单/);
  }
  assert.throws(() => selectPagesBuildFiles(files.filter(name => name !== 'submission/demo.mp4')), /缺少/);
  assert.throws(() => selectPagesBuildFiles([...files, files[0]]), /重复/);
});
