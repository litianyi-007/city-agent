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
  assert.match(rc1, /RC1 · 契约1\.0历史保留：真实LLM测试轮（宠物联合1\/10）/);
  assert.match(rc1, /小学联合0\/10、宠物联合3\/10、15未启动、5次请求、¥0\.042032/);
  assert.equal(rc1.includes('新增重点'), false);
  assert.equal(rc1.includes('待部署后核验公网'), false);
  assert.equal(rc1.includes('最新申报材料'), false);

  const guide = await readFile(new URL('../public/review-guide.html', import.meta.url), 'utf8');
  assert.match(guide, /追加：契约1\.1真实调查补充/);
  assert.match(guide, /小学联合0\/10、宠物联合3\/10，15未启动/);
  assert.match(guide, /¥0\.042032/);
  assert.match(guide, /RC1 · 契约1\.0历史保留：质量门限未通过（宠物联合1\/10）/);
  assert.match(guide, /RC1完整申报材料 · 历史保留/);
  assert.equal(guide.includes('最新申报材料'), false);
  assert.equal(guide.includes('本轮真实测试报告'), false);
  assert.equal(guide.includes('本轮真实测试：质量门限未通过'), false);
});