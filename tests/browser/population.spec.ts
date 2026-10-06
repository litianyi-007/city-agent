import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('population evidence traces inferred cells to arithmetic inputs, downloads originals and blocks empty intake', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const overviewResponse = await request.get('/api/population');
  expect(overviewResponse.ok()).toBe(true);
  const overview = await overviewResponse.json();
  expect(overview.status).toBe('ready');
  const maleCell = overview.model.cells.find((cell: { areaCode: string; ageBand: string; sex: string }) => cell.areaCode === 'xixing' && cell.ageBand === '15-59' && cell.sex === 'male');
  expect(maleCell).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: /城市与样本/ }).click();
  await expect(page.locator('.city-number')).toContainText('503,859');
  await expect(page.locator('.street-panel .street')).toHaveCount(3);
  await page.getByLabel('选择联合人口单元').selectOption(maleCell.id);
  await expect(page.locator('.trace-evidence')).toHaveCount(3);
  const derived = page.locator('.trace-evidence').filter({ hasText: '算术派生' });
  await expect(derived).toHaveCount(1);
  await expect(derived).toContainText('74,538');
  await expect(derived).toContainText('减法输入');
  await expect(derived).toContainText('143,318');
  await expect(derived).toContainText('68,780');
  await expect(page.locator('.trace-calculation')).toContainText('不是置信区间');
  await expect(page.locator('.trace-calculation')).toContainText('infer');
  await expect(page.locator('.source-record')).toHaveCount(overview.model.sources.length + overview.recent.sources.length);

  const sourceLink = derived.getByRole('link', { name: '下载原始证据 ↗' });
  const sourceUrl = await sourceLink.getAttribute('href');
  expect(sourceUrl).toBeTruthy();
  const sourceId = decodeURIComponent(sourceUrl!.split('/').at(-1)!);
  const source = overview.model.sources.find((row: { id: string }) => row.id === sourceId);
  const [download] = await Promise.all([page.waitForEvent('download'), sourceLink.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloaded = await readFile(downloadedPath!);
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(source.sha256);
  const original = await request.get(sourceUrl!);
  expect(original.status()).toBe(200);
  expect(original.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(original.headers()['content-security-policy']).toContain('sandbox');
  expect(createHash('sha256').update(await original.body()).digest('hex')).toBe(source.sha256);

  const [templateDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载新区域录入模板' }).click(),
  ]);
  const templatePath = await templateDownload.path();
  expect(templatePath).not.toBeNull();
  const template = JSON.parse(await readFile(templatePath!, 'utf8'));
  expect(template.observations).toEqual([]);
  await page.getByLabel('上传人口数据包预检').setInputFiles({
    name: 'new-region-empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)),
  });
  await expect(page.getByLabel('数据包预检结果')).toContainText('"status": "blocked"');
  await expect(page.locator('.city-number')).toContainText('503,859');
  expect((await (await request.get('/api/population/model')).json()).datasetHash).toBe(overview.model.datasetHash);

  await page.screenshot({ path: 'test-results/population-evidence-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/population-evidence-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('failed evidence integrity hides model values instead of presenting them as ready', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /城市与样本/ }).click();
  await expect(page.locator('.city-number')).toContainText('503,859');
  await page.route('**/api/population', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.status = 'blocked';
    payload.sourceFiles[0].passed = false;
    payload.sourceFiles[0].detail = '浏览器回归测试：登记原件 SHA-256 不匹配';
    await route.fulfill({ response, json: payload });
  });
  await page.reload();
  await page.getByRole('button', { name: /城市与样本/ }).click();
  await expect(page.getByRole('alert')).toContainText('证据完整性检查未通过');
  await expect(page.getByRole('alert')).toContainText('已阻止人口数字与模型展示');
  await expect(page.locator('.city-number')).toHaveCount(0);
  await expect(page.locator('.trace-calculation')).toHaveCount(0);
});

test('school and pet mock tasks deliver interactive conditional research while preserving the data gap', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '流程演示', exact: true }).click();
  // A single sequential test keeps both runs isolated from the one-active-run limit.
  for (const scenario of [
    { button: '小学生零食店', kind: 'school-snacks', evidenceText: '当前学年小学及在校生', firstHypothesis: '假设 A：放学路径上的小份即时购买', nextHypothesis: '假设 B：家庭同行的组合购买' },
    { button: '宠物零食网点', kind: 'pet-snacks', evidenceText: '养宠目标人群与猫狗结构', firstHypothesis: '假设 A：猫向小规模试售', nextHypothesis: '假设 B：狗向小规模试售' },
  ]) {
    await page.getByRole('button', { name: scenario.button, exact: true }).click();
    await expect(page.getByRole('button', { name: '启动任务' })).toBeEnabled();
    const [createdResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/runs') && response.request().method() === 'POST'),
      page.getByRole('button', { name: '启动任务' }).click(),
    ]);
    expect(createdResponse.status()).toBe(202);
    const created = await createdResponse.json();
    await expect(page.locator('.run-identity code')).toHaveText(created.id.slice(0, 8));
    await expect(page.locator('.run-header .status-pill')).toHaveText('已完成', { timeout: 45_000 });
    await page.getByRole('tab', { name: '调研结果', exact: true }).click();
    await expect(page.locator('.case-readiness')).toContainText('需要补充数据');
    await expect(page.locator('.case-readiness')).toContainText(scenario.evidenceText);
    await expect(page.locator('.research-metrics')).toHaveCount(0);
    await expect(page.locator('.research-bars')).toHaveCount(0);
    const report = await (await request.get(`/api/runs/${created.id}/artifacts/case-report.json`)).json();
    expect(report.kind).toBe(scenario.kind);
    expect(report.decisionStatus).toBe('needs-data');
    expect(report.frameFit.surveyApplicable).toBe(false);

    await page.getByRole('tab', { name: /交付产物/ }).click();
    await expect(page.getByRole('heading', { name: '✓ 验收通过' })).toBeVisible();
    await expect(page.locator('.artifact-list a').filter({ hasText: 'case-report.json' })).toBeVisible();
    const frame = page.frameLocator('iframe[title="交付应用预览"]');
    await expect(frame.locator('#decision-status')).toContainText('needs-data');
    await expect(frame.locator('#scenario-summary')).toContainText(scenario.firstHypothesis);
    await frame.locator('#next-hypothesis').click();
    await expect(frame.locator('#scenario-summary')).toContainText(scenario.nextHypothesis);
    await expect(frame.locator('#gap-status')).toContainText('已加入补采计划 0 项');
    await frame.locator('#gap-plan-0').check();
    await expect(frame.locator('#gap-status')).toContainText('已加入补采计划 1 项');
    await expect(frame.locator('#gap-status')).toContainText('全部证据仍待核验');
    await expect(frame.locator('#decision-status')).toContainText('needs-data');
    await expect(frame.locator('#acceptance')).toHaveCount(0);
    await page.screenshot({ path: `test-results/${scenario.kind}-delivery.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
