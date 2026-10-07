import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('full-log offline runner rejects credential/custom-command arguments before spawning registered jobs', () => {
  for (const flag of ['--api-key', '--command', '--budget-cny', '--endpoint']) assert.throws(() => execFileSync(process.execPath,
    ['--import', 'tsx', 'scripts/run-offline-system-review.ts', flag, 'synthetic-not-used'],
    { env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, encoding: 'utf8', stdio: 'pipe' }), error => {
      const failure = error as { status?: number; stdout?: string; stderr?: string }; assert.notEqual(failure.status, 0);
      assert.equal(failure.stdout, ''); assert.match(failure.stderr ?? '', /不接收Key/); return true;
    });
});
