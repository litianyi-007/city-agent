import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPublishedSecrets, assertUnrelatedTreesPreserved, assertWorktreeDirectory, checkedFile, packagePath, publicPath } from '../scripts/production-public-safety.js';
import { trustedFixturePreview } from '../scripts/production-public.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { demoHtml } from '../server/production/fixtures.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { randomUUID } from 'node:crypto';

test('publication paths cannot include runtime data or overwrite unrelated site files', () => {
  for (const name of ['../index.html', '/index.html', '.city-agent-production/master.key', 'server/store.ts', 'MOCK-04/index.html', 'MOCK-01/../index.html', 'recording/private.webm']) assert.throws(() => packagePath(name));
  assert.equal(packagePath('MOCK-01/evidence.json'), 'MOCK-01/evidence.json');
  assert.equal(publicPath('MOCK-02/index.html'), 'MOCK-02/index.html.txt');
  assert.equal(publicPath('MOCK-02/gate.json'), 'MOCK-02/gate.json');
});
test('secret-like values and nonempty credential fields block publication', () => {
  assert.throws(() => assertNoPublishedSecrets(Buffer.from('apikey_' + 'a'.repeat(40)), 'note.txt'));
  assert.throws(() => assertNoPublishedSecrets(Buffer.from(JSON.stringify({ snapshot: { apiKey: 'placeholder-not-to-publish' } })), 'run.json'));
  assert.throws(() => assertNoPublishedSecrets(Buffer.from(JSON.stringify({ authorization: 'Bearer fixture-not-to-publish' })), 'run.json'));
  assert.doesNotThrow(() => assertNoPublishedSecrets(Buffer.from(JSON.stringify({ hasApiKey: true, apiKey: null })), 'public.json'));
});
test('whole unrelated root tree SHA/mode preservation is mandatory', () => {
  const prior = [{ path: 'assets', type: 'tree', mode: '040000', sha: 'a' }, { path: 'submission', type: 'tree', mode: '040000', sha: 'b' }, { path: 'index.html', type: 'blob', mode: '100644', sha: 'c' }];
  assert.doesNotThrow(() => assertUnrelatedTreesPreserved(prior, [...prior, { path: 'production', type: 'tree', mode: '040000', sha: 'new' }]));
  assert.throws(() => assertUnrelatedTreesPreserved(prior, prior.map(item => item.path === 'submission' ? { ...item, sha: 'changed' } : item)));
  assert.throws(() => assertUnrelatedTreesPreserved(prior, prior.slice(1)));
});
test('public fixture interactivity requires exact platform-authored bytes and provenance', () => {
  const fixture = PRODUCTION_DEMO_CASES[0];
  const input = productionRunInputSchema.parse({ brief: fixture.brief, mode: 'demo', demoCaseId: fixture.operation, agentIds: Array.from({ length: 6 }, () => randomUUID()), requirement: { id: fixture.id, source: fixture.source, acceptance: fixture.acceptance, kind: 'illustrative' } });
  const run = { input, evidenceKind: 'fixture' } as ProductionRun;
  const bytes = Buffer.from(demoHtml(input));
  assert.match(trustedFixturePreview(run, bytes), /Content-Security-Policy/);
  assert.throws(() => trustedFixturePreview(run, Buffer.concat([bytes, Buffer.from('<script>location.href="https://outside.invalid"</script>')])));
  assert.throws(() => trustedFixturePreview({ ...run, evidenceKind: 'real-model' }, bytes));
  assert.throws(() => trustedFixturePreview({ ...run, input: { ...input, brief: 'A different unregistered mock task' } }, bytes));
});
test('publication directory and every file reject symlink escapes, including root aliases', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(root, '.city-agent-production-public-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'output/pdf/review'), { recursive: true });
  await mkdir(path.join(directory, 'outside'));
  await writeFile(path.join(directory, 'outside/not-secret.txt'), 'fixture');
  await writeFile(path.join(directory, 'output/pdf/review/valid.txt'), 'fixture');
  await assertWorktreeDirectory(directory, path.join(directory, 'output/pdf/review'), 'output/pdf');
  await symlink(path.join(directory, 'outside'), path.join(directory, 'output/pdf/escaped'));
  await assert.rejects(assertWorktreeDirectory(directory, path.join(directory, 'output/pdf/escaped'), 'output/pdf'));
  await symlink(path.join(directory, 'outside/not-secret.txt'), path.join(directory, 'output/pdf/review/escaped.txt'));
  await assert.rejects(checkedFile(path.join(directory, 'output/pdf/review'), 'escaped.txt'));
  assert.equal((await checkedFile(path.join(directory, 'output/pdf/review'), 'valid.txt')).toString(), 'fixture');
});
