import { expect, test } from '@playwright/test';
import { PRODUCTION_DEMO_CASES } from '../../shared/production-benchmarks';

test('production workspace runs three explicit fixtures through frozen browser gates and returns to society', async ({ page, request }) => {
  await page.goto('/#production');
  await expect(page.getByRole('heading', { name: '把一句话，交给一支研发团队。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '运行 Mock 链路' })).toBeEnabled();
  for (const item of PRODUCTION_DEMO_CASES) {
    await page.getByRole('button', { name: item.title, exact: true }).click();
    await expect(page.getByLabel('需求原话')).toHaveValue(item.brief);
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/production/runs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '运行 Mock 链路' }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const queued = await response.json();
    await expect.poll(async () => (await (await request.get(`/api/production/runs/${queued.id}`)).json()).status).toBe('completed');
    const run = await (await request.get(`/api/production/runs/${queued.id}`)).json();
    expect(run.evidenceKind).toBe('fixture');
    expect(run.input.requirement.kind).toBe('illustrative');
    expect(run.gate.passed).toBe(true);
    expect(run.verifications.length).toBe(6);
    await page.getByRole('button', { name: /门禁与交付/ }).click();
    await expect(page.getByRole('heading', { name: '最终行为 Gate：通过' })).toBeVisible();
    await page.getByRole('button', { name: '打开运行预览' }).click();
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#notice')).toContainText('Mock');
    await frame.locator('#task-input').fill('浏览器实操');
    await frame.locator('#add-task').click();
    await expect(frame.locator('#tasks li')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '证据与申报', exact: true }).click();
  await expect(page.getByText('unknown', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回虚拟社会' }).click();
  await expect(page.getByRole('heading', { name: '虚拟社会调查', exact: true })).toBeVisible();
});

test('production agents configure and clone without revealing keys, and endpoint change clears the old key', async ({ page, request }) => {
  await page.goto('/#production');
  await page.getByRole('button', { name: '研发团队', exact: true }).click();
  await page.getByRole('button', { name: '创建 Agent', exact: true }).click();
  const name = `Browser test agent ${Date.now()}`;
  const secret = 'fixture-browser-secret-not-a-real-key';
  await page.getByLabel('Agent 名称').fill(name);
  await page.getByLabel(/API Key（/).fill(secret);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const card = page.locator('.prod-agent-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card).toContainText('已配置 · 仅显示脱敏状态');
  expect(await page.locator('body').innerText()).not.toContain(secret);
  expect(JSON.stringify(await (await request.get('/api/production/agents')).json())).not.toContain(secret);
  await card.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} 副本`, exact: true })).toBeVisible();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel(/API Key（/)).toHaveValue('');
  await page.getByLabel('Base URL', { exact: true }).fill('https://changed.example/v1');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(card).toContainText('未配置');
  await page.getByRole('button', { name: '生产工作台', exact: true }).click();
  await page.getByLabel('真实模型', { exact: true }).check();
  await expect(page.getByRole('button', { name: '启动真实生产' })).toBeDisabled();
  await expect(page.getByText(/请先在研发团队配置所有已选角色/)).toBeVisible();
});

test('production workspace fits narrow screens with labelled controls and visible mock boundaries', async ({ page }) => {
  await page.goto('/#production');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel('需求原话')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByLabel('需求原话').fill('自定义需求不能使用固定夹具伪装完成');
  await expect(page.getByRole('button', { name: '运行 Mock 链路' })).toBeDisabled();
  await expect(page.getByText(/自定义需求或验收需要真实模型处理/)).toBeVisible();
});
