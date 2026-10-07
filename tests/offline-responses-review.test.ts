import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) };

test('offline Responses command refuses credential/URL/budget arguments before any model process', () => {
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/run-offline-responses-review.ts', '--api-key', 'synthetic-not-used'],
    { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }), error => {
    const failure = error as { status?: number; stderr?: string }; assert.notEqual(failure.status, 0);
    assert.match(failure.stderr ?? '', /不接受Key/); return true;
  });
});

test('offline Responses command exports registered real-DSH local tests with fixed history, never a paid-provider claim', { timeout: 60_000 }, () => {
  const summary = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/run-offline-responses-review.ts'],
    { cwd: root, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 }));
  const directory = path.resolve(summary.directory), parent = path.join(root, 'output/offline-review');
  assert.equal(path.dirname(directory), parent); assert.ok(path.basename(directory).startsWith('responses-'));
  try {
    const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
    assert.equal(report.version, 'offline-responses-review-1.0'); assert.equal(report.historicalIntegrity.verifiedCount, 42);
    assert.equal(report.counts.pass, report.counts.tests); assert.ok(report.counts.tests >= 120); assert.equal(report.counts.skipped, 0);
    assert.equal(report.source.files.length, 14); assert.equal(report.providerRequests, 0); assert.equal(report.apiCostCny, 0);
    assert.equal(report.realProviderSchemaSupport, 'not-tested'); assert.equal(report.productionRouteActivated, false);
    assert.equal(report.syntheticUsageIsNotBilling, true); assert.equal(report.logicOrMarketQualityCertified, false);
    assert.match(readFileSync(path.join(directory, 'tests.tap'), 'utf8'), /real DSH candidate carries 18 schema/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
