import { test, expect } from '@playwright/test';
import type { Run } from '../../server/types.ts';

test('terminal snapshot without finish time keeps polling until its execution manifest arrives', async ({ page }) => {
  const run: Run = {
    id: '11111111-1111-4111-8111-111111111111', task: '合成 UI 终态竞态回归，无模型请求', mode: 'demo', status: 'completed',
    createdAt: '2026-10-07T00:00:00.000Z', input: { task: '合成 UI 终态竞态回归', mode: 'demo', agentIds: [], product: '合成夹具', price: 0, sampleSize: 30, seed: 1 },
    stages: [], events: [], artifacts: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: null }, agentSnapshot: [],
  };
  let detailReads = 0;
  const writes: string[] = []; const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) { external.push(url.href); await route.abort(); return; }
    if (url.pathname.startsWith('/api/') && request.method() !== 'GET') { writes.push(url.pathname); await route.abort(); return; }
    if (url.pathname === '/api/runs') { await route.fulfill({ json: [run] }); return; }
    if (url.pathname === `/api/runs/${run.id}`) {
      detailReads++;
      // The first terminal read deliberately precedes the manifest. This
      // reproduces the old publish-before-finalization API state deterministically.
      if (detailReads >= 2) {
        run.finishedAt = '2026-10-07T00:00:01.000Z';
        run.artifacts = [{ name: 'manifest.json', path: 'manifest.json', type: 'application/json' }];
      }
      await route.fulfill({ json: run }); return;
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('.run-header .status-pill')).toHaveText('已完成');
  await page.getByRole('tab', { name: /交付产物/ }).click();
  await expect(page.locator('.artifact-list a').filter({ hasText: 'manifest.json' })).toBeVisible();
  expect(detailReads).toBe(2);
  await page.clock.install();
  await page.clock.fastForward(4000);
  expect(detailReads).toBe(2); // Stop only once the durable finish time is present.
  expect(writes).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
