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
    expect(run.gate.checks.length).toBeGreaterThan(0);
    expect(run.gate.checks.every((check: { passed: boolean }) => check.passed)).toBe(true);
    expect(run.verifications.length).toBe(6);
    await page.getByRole('button', { name: /门禁与交付/ }).click();
    await expect(page.getByRole('heading', { name: '最终行为 Gate：通过' })).toBeVisible();
    await page.getByRole('button', { name: '打开运行预览' }).click();
    const preview = page.getByAltText(`受控浏览器截图 ${item.id}`, { exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', `/api/production/runs/${queued.id}/preview`);
    await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByText('截图已载入；不是实时交互预览。')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const source = await request.get(`/api/production/runs/${queued.id}/artifacts/index.html`);
    expect(source.headers()['content-type']).toContain('text/plain');
    expect(source.headers()['content-disposition']).toContain('attachment');
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('.prod-preview img')).toHaveCount(0);
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
  await expect(page.getByLabel('Model ID', { exact: true })).toHaveValue('deepseek-flash');
  const name = `Browser test agent ${Date.now()}`;
  const secret = 'fixture-browser-secret-not-a-real-key';
  await page.getByLabel('Agent 名称').fill(name);
  await page.getByLabel('Model ID', { exact: true }).fill('browser-user-selected-model-v1');
  await page.getByLabel(/API Key（/).fill('short');
  expect(await page.getByLabel(/API Key（/).evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(false);
  await page.getByLabel(/API Key（/).fill('fixture-invalid-token-"quote');
  expect(await page.getByLabel(/API Key（/).evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(false);
  await page.getByLabel(/API Key（/).fill(secret);
  expect(await page.getByLabel(/API Key（/).evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(true);
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  const card = page.locator('.prod-agent-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card).toContainText('已配置 · 仅显示脱敏状态');
  expect(await page.locator('body').innerText()).not.toContain(secret);
  expect(JSON.stringify(await (await request.get('/api/production/agents')).json())).not.toContain(secret);
  await card.getByRole('button', { name: '复制', exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} 副本`, exact: true })).toBeVisible();
  const copiedAgents = await (await request.get('/api/production/agents')).json();
  expect(copiedAgents.find((agent: { name: string }) => agent.name === `${name} 副本`).modelId).toBe('browser-user-selected-model-v1');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('Model ID', { exact: true })).toHaveValue('browser-user-selected-model-v1');
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

test('a failed recorded Gate is displayed as not passed, never as not executed', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000009';
  const fixture = PRODUCTION_DEMO_CASES[0];
  const failedRun = { id, status: 'failed', createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'fixture', input: { brief: fixture.brief, mode: 'demo', limits: { maxRepairCycles: 2, maxCalls: 24 }, requirement: { id: fixture.id, acceptance: fixture.acceptance, kind: 'illustrative' } }, agentSnapshot: [], events: [], calls: [], outputs: [], verifications: [], repairs: 2, gate: { passed: false, checks: [{ name: '新增后任务数量', passed: false, detail: 'expected 1, got 0' }] }, gateHistory: [], artifacts: [], interventions: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true } };
  await page.route('**/api/production/runs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([failedRun]) }));
  await page.route(`**/api/production/runs/${id}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(failedRun) }));
  await page.goto('/#production');
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '最终行为 Gate：未通过', exact: true })).toBeVisible();
  await expect(page.getByText('expected 1, got 0')).toBeVisible();
  await expect(page.getByRole('heading', { name: '最终行为 Gate：未执行', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('an unresolved Jev request intent is unobserved, not a free zero-request call', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000008';
  const fixture = PRODUCTION_DEMO_CASES[0];
  const evaluation = { policyVersion: 'test-v2', status: 'error', selectedCandidateId: null, reason: 'Synthetic persisted request intent', requestSnapshot: null, rawResponse: null, scores: [], choice: null, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, modelIdRequested: 'jev-1.13.0', modelIdReturned: null, httpStatus: null, providerRequests: 0, durationMs: 0 };
  const run = { id, status: 'interrupted', createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'fixture-with-real-jev', input: { brief: fixture.brief, mode: 'mock-jev', limits: { maxRepairCycles: 2, maxCalls: 24 }, requirement: { id: fixture.id, acceptance: fixture.acceptance, kind: 'illustrative' } }, agentSnapshot: [], events: [], calls: [], outputs: [], verifications: [], repairs: 0, gateHistory: [], artifacts: [], interventions: [], usage: evaluation.usage, jevCalls: [{ id: 'request-intent', phase: 'product', startedAt: '2026-10-07T00:00:00Z', configHash: 'fixed', evaluation }] };
  await page.route('**/api/production/runs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([run]) }));
  await page.route(`**/api/production/runs/${id}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(run) }));
  await page.goto('/#production');
  await expect(page.locator('.prod-run-summary')).toContainText('unknown（已知 0 次；1 个请求意图未观测）');
  await page.getByRole('button', { name: /候选验证/ }).click();
  await expect(page.getByText('请求意图未完成 / 未观测', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-jev-evidence')).toContainText('实际请求 未观测 / unknown');
  await expect(page.locator('.prod-jev-evidence')).not.toContainText('实际请求 0');
  // A completed preflight failure with an explicit error and no provider call
  // remains a known zero, rather than being mistaken for an unresolved intent.
  const completed = { ...run, jevCalls: [{ ...run.jevCalls[0], evaluation: { ...evaluation, error: 'preflight denied', usage: { ...evaluation.usage, inputTokens: 0, outputTokens: 0, estimatedCost: 0, complete: true } } }] };
  await page.unroute('**/api/production/runs');
  await page.route('**/api/production/runs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([completed]) }));
  await page.unroute(`**/api/production/runs/${id}`);
  await page.route(`**/api/production/runs/${id}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(completed) }));
  await page.reload(); await page.getByRole('button', { name: /候选验证/ }).click();
  await expect(page.locator('.prod-jev-evidence')).toContainText('实际请求 0');
  await expect(page.getByText('请求意图未完成 / 未观测', { exact: true })).toHaveCount(0);
});
