import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import { CONTRACT_REVIEW_EXPERIMENT, CONTRACT_REVIEW_FILES, parseContractPublicationOptions, verifyContractReviewFiles } from '../shared/contract-review-publication';

function fixture() {
  const files = Object.fromEntries(CONTRACT_REVIEW_FILES.map(name => [name, new TextEncoder().encode(name.endsWith('.json') ? '{}' : 'offline publication fixture')]));
  const manifest = { schemaVersion: 'contract-review-appendix-1.0', experimentId: CONTRACT_REVIEW_EXPERIMENT,
    protocolVersion: 'live-business-smoke-1.1', planHash: 'a'.repeat(64), realModelCalls: 5, conservativeCostCny: 0.042032,
    publicationKind: 'negative-result-supplement', files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) })) };
  return { files, manifest };
}
test('new negative-result appendix requires exactly its own 27 checksummed payloads', () => {
  const { files, manifest } = fixture(); assert.equal(verifyContractReviewFiles(manifest, files).files.length, 27);
  assert.throws(() => verifyContractReviewFiles(manifest, { ...files, 'approval.json': new Uint8Array([1]) }));
  assert.throws(() => verifyContractReviewFiles(manifest, { ...files, 'report.json': new TextEncoder().encode('{"changed":true}') }));
  assert.throws(() => verifyContractReviewFiles({ ...manifest, realModelCalls: 24 }, files));
  assert.throws(() => verifyContractReviewFiles({ ...manifest, publicationKind: 'market-validated' }, files));
});
test('publication rejects credential fields even when a forged manifest rehashes them', () => {
  const { files, manifest } = fixture(); files['report.json'] = new TextEncoder().encode('{"apiKey":"offline-canary-secret"}');
  manifest.files = Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha256(bytes) }));
  assert.throws(() => verifyContractReviewFiles(manifest, files), /凭据/);
});
test('publication cannot override scope, path, or silently execute by default', () => {
  assert.equal(parseContractPublicationOptions(['--dry-run']).execute, false);
  assert.equal(parseContractPublicationOptions(['--execute']).execute, true);
  for (const args of [[], ['--execute', '--dry-run'], ['--execute', '--budget=6'], ['--submission=other']]) assert.throws(() => parseContractPublicationOptions(args));
});
