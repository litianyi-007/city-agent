import { expect, test } from '@playwright/test';

test('Jev page stores, rotates and clears a password key without browser or API disclosure', async ({ page, request }) => {
  await request.patch('/api/production/jev/config', { data: { enabled: false, apiKey: null } });
  const first = 'fixture-jev-browser-first-not-a-real-key';
  const rotated = 'fixture-jev-browser-rotated-not-a-real-key';
  await page.goto('/#production');
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  const key = page.getByLabel(/Jev API Key（/);
  await expect(key).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('固定官方 Endpoint')).toHaveValue('https://api.typesafe.ai/v1/systemone');
  await expect(page.getByLabel('固定模型版本')).toHaveValue('jev-1.13.0');
  await key.fill(first);
  await page.getByLabel('启用 Jev 候选验证', { exact: true }).check();
  await page.getByRole('button', { name: '保存 Jev 设置', exact: true }).click();
  await expect(key).toHaveValue('');
  await expect(page.getByText(/Jev 设置已保存/)).toBeVisible();
  let config = await (await request.get('/api/production/jev/config')).json();
  expect(config.hasApiKey).toBe(true);
  expect(config).not.toHaveProperty('apiKey');
  expect(JSON.stringify(config)).not.toContain(first);
  expect(await page.locator('body').innerHTML()).not.toContain(first);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(first);
  await page.reload();
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  await expect(key).toHaveValue('');
  await expect(page.getByText('Key 已配置', { exact: true })).toBeVisible();
  await key.fill(rotated);
  await page.getByRole('button', { name: '保存 Jev 设置', exact: true }).click();
  await expect(key).toHaveValue('');
  await expect(page.getByText(/Jev 设置已保存/)).toBeVisible();
  config = await (await request.get('/api/production/jev/config')).json();
  expect(JSON.stringify(config)).not.toContain(rotated);
  expect(await page.locator('body').innerHTML()).not.toContain(rotated);
  await page.getByLabel('清除 Jev Key', { exact: true }).check();
  await page.getByRole('button', { name: '保存 Jev 设置', exact: true }).click();
  await expect(page.getByText('未配置 Key', { exact: true })).toBeVisible();
  config = await (await request.get('/api/production/jev/config')).json();
  expect(config.hasApiKey).toBe(false);
  await request.patch('/api/production/jev/config', { data: { enabled: false, apiKey: null } });
});

test('mixed Mock/Jev cannot start without both configuration and explicit budget; settings fit three sizes', async ({ page, request }) => {
  await request.patch('/api/production/jev/config', { data: { enabled: false, apiKey: null } });
  let submitted = 0;
  await page.route('**/api/production/runs', route => { if (route.request().method() === 'POST') { submitted++; return route.abort(); } return route.continue(); });
  await page.goto('/#production');
  await page.getByLabel('Mock + 真实 Jev', { exact: true }).check();
  const launch = page.getByRole('button', { name: '运行 Mock + Jev 验证', exact: true });
  await expect(launch).toBeDisabled();
  await page.getByLabel(/我授权本次在上述有限预算内/).check();
  await expect(launch).toBeDisabled();
  await expect(page.getByText(/请在决策设置启用并配置 Jev Key/)).toBeVisible();
  await request.patch('/api/production/jev/config', { data: { enabled: true, apiKey: 'fixture-only-jev-budget-ui-key' } });
  await page.reload();
  await page.getByLabel('Mock + 真实 Jev', { exact: true }).check();
  await expect(launch).toBeDisabled();
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel('最低分布集中度')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(submitted).toBe(0);
  await request.patch('/api/production/jev/config', { data: { enabled: false, apiKey: null } });
});

test('Jev comparison observes asynchronous completion and cancellation without paid backend calls', async ({ page, request }) => {
  await request.patch('/api/production/jev/config', { data: { enabled: true, apiKey: 'fixture-only-jev-comparison-ui-key' } });
  let status = 'idle'; let starts = 0;
  await page.route('**/api/production/jev/benchmarks', async route => {
    if (route.request().method() === 'POST') { starts++; status = 'running'; await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'browser-injected-comparison' }) }); }
    else await route.fulfill({ contentType: 'application/json', body: JSON.stringify(status === 'idle' ? [] : [{ id: 'browser-injected-comparison', status, source: 'browser route injection; no provider request' }]) });
  });
  await page.route('**/api/production/jev/benchmarks/cancel', async route => { status = 'cancelled'; await route.fulfill({ status: 202, contentType: 'application/json', body: '{"cancelling":true}' }); });
  await page.goto('/#production');
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  await page.getByLabel(/授权本次有界 Jev 对照费用/).check();
  await page.getByRole('button', { name: '运行 3 组 Jev 候选对照', exact: true }).click();
  await expect(page.getByText(/已启动候选池对照/)).toBeVisible();
  await expect(page.getByText(/对照 browser-injected-comparison 正在执行/)).toBeVisible();
  status = 'completed';
  await expect(page.getByText(/候选池对照进入终态：completed/)).toBeVisible();
  await page.getByRole('button', { name: '运行 3 组 Jev 候选对照', exact: true }).click();
  await page.getByRole('button', { name: '取消 Jev 对照', exact: true }).click();
  await expect(page.getByText(/候选池对照进入终态：cancelled/)).toBeVisible();
  expect(starts).toBe(2);
  await request.patch('/api/production/jev/config', { data: { enabled: false, apiKey: null } });
});
