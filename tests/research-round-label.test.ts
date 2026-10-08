import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CONTRACT11_ROUND_BANNER } from '../src/research-round-copy.ts';

test('research banner names the contract 1.1 round and leaves the RC1 ledger untouched', async () => {
  assert.match(CONTRACT11_ROUND_BANNER, /契约1\.1（2026-10-07，5请求）/);
  assert.match(CONTRACT11_ROUND_BANNER, /小学联合0\/10、宠物3\/10/);
  assert.match(CONTRACT11_ROUND_BANNER, /¥0\.042032/);
  assert.equal(CONTRACT11_ROUND_BANNER.includes('0.085884'), false);
  assert.equal(CONTRACT11_ROUND_BANNER.includes('宠物1/10'), false);
  const rc1 = await readFile(new URL('../public/submission-next/index.html', import.meta.url), 'utf8');
  assert.match(rc1, /宠物采购者 · 18题<\/td><td>10<\/td><td>2<\/td><td>8<\/td><td>1\/10<\/td><td>1\/10<\/td><td>1\/10<\/td><td>1\/10/);
  assert.match(rc1, /¥0\.085884/);
  assert.match(rc1, /本次授权API尝试 7 次/);
});