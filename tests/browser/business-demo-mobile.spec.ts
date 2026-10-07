import { test, expect } from '@playwright/test';

test('complete business evidence and historic frozen logic fit a 375px viewport without model requests', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const blocked: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(request.method())) { blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return; }
    await route.continue();
  });
  await page.goto('/#research');
  await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
  const panel = page.getByRole('region', { name: '完整业务工程自证' });
  await panel.getByLabel('完整业务问卷').selectOption('pet-snacks');
  await panel.getByRole('button', { name: '运行完整业务自证 · 0 API费用', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true })).toBeVisible();
  await panel.locator('details').first().locator('summary').first().click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1); expect(blocked).toEqual([]);
});
