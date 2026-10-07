import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';

test('fixed repository historical evidence stays byte-identical at start/end, without depending on private output folders', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const before = await verifyHistoricalEvidence(root);
  assert.equal(before.verifiedCount, 42);
  assert.equal(before.files.some(file => file.name.startsWith('output/')), false);
  const after = await verifyHistoricalEvidence(root);
  assert.deepEqual(after, before);
});

test('predeclared baseline hash rejects drift rather than treating freshly learned bytes as proof', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'city-history-check-'));
  try {
    await mkdir(path.join(root, 'public/submission'), { recursive: true });
    await writeFile(path.join(root, 'public/submission/live-run.json'), '{"changed":true}');
    await assert.rejects(verifyHistoricalEvidence(root), /历史字节校验失败/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
