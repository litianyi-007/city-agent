import { test, expect } from '@playwright/test';

test('live survey starts with one slot and explicit fee consent expires on changed inputs without a model call', async ({ page }) => {
  const dispatches: string[] = [];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || request.method() === 'POST' && url.pathname.endsWith('/surveys')) {
      dispatches.push(url.pathname); await route.abort(); return;
    }
    await route.continue();
  });
  await page.goto('/#research');
  await expect(page.getByText('契约1.1（2026-10-07，5请求）')).toBeVisible();
  const panel = page.getByRole('region', { name: '问卷仿真与结果', exact: true });
  const count = panel.getByLabel('计划受访者');
  await expect(count).toHaveValue('12');
  await count.fill('8');
  await panel.getByLabel('运行方式').selectOption('live');
  await expect(count).toHaveValue('1');
  await count.fill('3');
  await panel.getByLabel('运行方式').selectOption('fixture');
  await expect(count).toHaveValue('8');
  await panel.getByLabel('运行方式').selectOption('live');
  await expect(count).toHaveValue('1');
  await panel.getByLabel('确认本次按显式画像假设开展合成实验', { exact: false }).check();
  const start = panel.getByRole('button', { name: '开始真实模型调查', exact: true });
  const consent = panel.getByLabel('确认使用自己的 Key 支付本次', { exact: false });
  await expect(start).toBeDisabled(); await consent.check(); await expect(start).toBeEnabled();
  for (const [label, value] of [['计划受访者', '2'], ['画像随机种子', '43'], ['输入单价（元／百万 Token）', '2'], ['输出单价（元／百万 Token）', '8']] as const) {
    await panel.getByLabel(label, { exact: true }).fill(value);
    await expect(consent).not.toBeChecked(); await expect(start).toBeDisabled();
    await consent.check(); await expect(start).toBeEnabled();
  }
  await page.getByLabel('调查标题', { exact: true }).fill('已变更的评委研究题目');
  await expect(consent).not.toBeChecked(); await expect(start).toBeDisabled();
  await consent.check(); await start.click();
  await expect(consent).not.toBeChecked(); await expect(start).toBeDisabled();
  // At most one local survey submission may be blocked; no provider can be reached by this test.
  expect(dispatches.length).toBeLessThanOrEqual(1);
  expect(dispatches.every(path => path.endsWith('/surveys'))).toBe(true);
  await expect(panel).toContainText('结构无效不会自动停止后续居民');
  await expect(page.getByRole('link', { name: '最新工程与接口能力记录 ↗', exact: true })).toHaveAttribute('href', /review-updates\/2026-10-08\//);
});
