import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const script = 'scripts/run-offline-research-review.ts';
const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };

test('fresh-checkout offline command needs no private outputs or keys, exports separate diagnosis and preserves history', async () => {
  const before = await verifyHistoricalEvidence(root);
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', script], { cwd: root, env });
  const output = JSON.parse(stdout);
  const target = path.resolve(output.directory);
  assert.equal(path.dirname(target), path.join(path.resolve(root), 'output/offline-review'));
  assert.ok(path.basename(target).startsWith('review-'));
  try {
    assert.equal(output.verifiedHistoricalFiles, 42); assert.equal(output.compiledFixtureContracts, 24); assert.equal(output.providerRequests, 0);
    const report = JSON.parse(await readFile(path.join(target, 'report.json'), 'utf8'));
    assert.equal(report.historicalIntegrity.beforeHash, report.historicalIntegrity.afterHash);
    assert.equal(report.cases.length, 4); assert.equal(report.apiCostCny, 0); assert.equal(report.structuredAnswerProductionRouteChanged, false);
    assert.equal(report.source.files.length, 14);
    const contracts = JSON.parse(await readFile(path.join(target, 'fixture-answer-contracts.json'), 'utf8'));
    assert.equal(contracts.length, 24);
    assert.ok(contracts.every((value: any) => value.fixtureConversion.meaning === 'explicit-fixture-projection-not-provider-response'));
    assert.deepEqual(await verifyHistoricalEvidence(root), before);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test('offline command refuses unknown flags rather than enabling a key, budget or provider path', async () => {
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', script, '--api-key=synthetic'], { cwd: root, env }), /无Key、预算或网络参数/);
});
