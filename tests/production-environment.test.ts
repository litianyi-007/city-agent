import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { productionEnvironment } from '../config/production-environment.js';

test('production ports and data are isolated and configurable', () => {
  const defaults = productionEnvironment({});
  assert.deepEqual([defaults.apiPort, defaults.webPort, defaults.previewPort, defaults.e2ePort], [4420, 5420, 4422, 4421]);
  assert.match(defaults.dataDir, /city-agent-autonomous-production\/\.city-agent-production$/);
  assert.equal(productionEnvironment({ PORT: '4421' }).apiPort, 4421);
  assert.equal(productionEnvironment({ PRODUCTION_API_PORT: '4450', PRODUCTION_WEB_PORT: '5450' }).webPort, 5450);
});

test('production environment rejects collisions, invalid ports and foreign data directories', () => {
  for (const env of [{ PRODUCTION_API_PORT: '0' }, { PRODUCTION_WEB_PORT: '4420' }, { PRODUCTION_E2E_PORT: '5420' }, { PRODUCTION_DATA_DIR: '../city-agent/.city-agent' }, { PRODUCTION_DATA_DIR: '.' }]) {
    assert.throws(() => productionEnvironment(env));
  }
});

test('production data directory rejects a symlink escape', () => {
  const root = productionEnvironment({}).root;
  const temporary = mkdtempSync(path.join(root, '.city-agent-production-test-link-'));
  try {
    symlinkSync(path.join(root, '..', 'city-agent'), path.join(temporary, 'foreign'));
    assert.throws(() => productionEnvironment({ PRODUCTION_DATA_DIR: path.join(temporary, 'foreign', 'data') }), /symlink/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
