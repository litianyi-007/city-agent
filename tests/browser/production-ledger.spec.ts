import { expect, test, type Page, type Route } from '@playwright/test';
import { DEFAULT_JEV_CONFIG } from '../../shared/jev-schema';

// Control-plane UI fixtures only: every API is intercepted. No real Key,
// provider request, cancellation, Gate, hardware or delivery is exercised.
const roles = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
const agents = roles.map((role, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, role, name: `UI fixture ${role}`, provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'engineering-ui-only', enabled: true, hasApiKey: true, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } }));
function run(id: string, requirementId: string, status: 'failed' | 'running' | 'cancelled' = 'failed') {
  return { id, status, createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'injected-test', input: { brief: 'UI state only; no model invocation', mode: 'live', capability: 'offline-single-html', agentIds: agents.map(agent => agent.id), candidateCount: 1, limits: { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 5, currency: 'USD' }, budgetAuthorized: true, requirement: { id: requirementId, source: 'Browser API response fixture, not a real requirement', acceptance: 'UI state only', background: '', difficulty: 'low', kind: 'illustrative' } }, agentSnapshot: [], calls: [], jevCalls: [], outputs: [], events: [], verifications: [], artifacts: [], gateHistory: [], repairs: 0, interventions: [], usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } };
}
const a = run('00000000-0000-4000-8000-000000000041', 'UI-RUN-A');
const b = run('00000000-0000-4000-8000-000000000042', 'UI-HISTORY-B');
const c = run('00000000-0000-4000-8000-000000000043', 'UI-HISTORY-C');
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

async function intercept(page: Page, history: ReturnType<typeof run>[], mutation?: (route: Route) => Promise<void>) {
  await page.route('**/api/production/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return mutation ? mutation(route) : route.fulfill({ status: 400, json: { error: 'Writes forbidden in this UI fixture' } });
    if (path === '/api/production/agents') return route.fulfill({ json: agents });
    if (path === '/api/production/runs') return route.fulfill({ json: history });
    const recorded = history.find(item => path === `/api/production/runs/${item.id}`);
    if (recorded) return route.fulfill({ json: recorded });
    if (path === '/api/production/jev/config') return route.fulfill({ json: { ...DEFAULT_JEV_CONFIG, hasApiKey: false } });
    return route.fulfill({ status: 404, json: { error: 'Read-only fixture endpoint absent' } });
  });
}

test('one consent is consumed synchronously, double submit creates one intent and late start cannot steal a newer historical selection', async ({ page }) => {
  const submitted: Record<string, unknown>[] = [];
  const pending = deferred();
  await intercept(page, [b, c], async route => {
    expect(new URL(route.request().url()).pathname).toBe('/api/production/runs');
    submitted.push(route.request().postDataJSON());
    if (submitted.length === 1) { await pending.promise; await route.fulfill({ status: 202, json: a }); }
    else await route.fulfill({ status: 400, json: { error: 'Explicitly reauthorized UI fixture rejection; no model request' } });
  });
  await page.goto('/#production');
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  await page.getByLabel('需求原话', { exact: true }).fill('做一个离线阅读清单，支持新增和完成计数');
  await page.getByLabel('编号', { exact: true }).fill('UI-CONSENT');
  await page.getByLabel('来源', { exact: true }).fill('工程表单反例，不是真实业务需求');
  await page.getByLabel('业务验收要求', { exact: true }).fill('新增一项后数量变为一');
  const consent = page.getByLabel(/我授权本次在上述有限预算/);
  await consent.check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeEnabled();
  await page.locator('form.prod-request').evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0].budgetAuthorized).toBe(true);
  await expect(consent).not.toBeChecked();
  await page.getByLabel('选择运行', { exact: true }).selectOption(c.id);
  const detail = page.getByRole('region', { name: '当前运行详情', exact: true });
  await expect(detail.locator('.prod-run-header')).toContainText('UI-HISTORY-C');
  await detail.getByRole('button', { name: /门禁与交付/ }).click();
  const response = page.waitForResponse(value => value.request().method() === 'POST' && value.url().endsWith('/api/production/runs'));
  pending.release(); await response;
  await expect(page.getByLabel('选择运行', { exact: true }).locator('option')).toHaveCount(4);
  await expect(detail.locator('.prod-run-header')).toContainText('UI-HISTORY-C');
  await expect(detail.getByRole('button', { name: /门禁与交付/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await consent.check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect(page.getByText('Explicitly reauthorized UI fixture rejection; no model request', { exact: true })).toBeVisible();
  await expect(consent).not.toBeChecked();
  expect(submitted).toHaveLength(2); expect(submitted[1].budgetAuthorized).toBe(true);
});

test('late successful or failed cancellation never overwrites or shows an error on the newly selected historical run', async ({ page }) => {
  const active = run(a.id, 'UI-RUN-A', 'running');
  let pending = deferred(); let error = false; let writes = 0;
  await intercept(page, [active, b], async route => {
    expect(new URL(route.request().url()).pathname).toBe(`/api/production/runs/${a.id}/cancel`);
    writes++; await pending.promise;
    await route.fulfill(error ? { status: 400, json: { error: 'Stale cancellation error must not appear on B' } } : { json: run(a.id, 'UI-RUN-A', 'cancelled') });
  });
  for (const failed of [false, true]) {
    pending = deferred(); error = failed;
    if (failed) await page.reload(); else await page.goto('/#production');
    await page.getByRole('button', { name: '取消任务', exact: true }).click();
    await expect.poll(() => writes).toBe(failed ? 2 : 1);
    await page.getByLabel('选择运行', { exact: true }).selectOption(b.id);
    const detail = page.getByRole('region', { name: '当前运行详情', exact: true });
    await expect(detail.locator('.prod-run-header')).toContainText('UI-HISTORY-B');
    const response = page.waitForResponse(value => value.request().method() === 'POST' && value.url().endsWith('/cancel'));
    pending.release(); await response;
    await page.waitForTimeout(50);
    await expect(detail.locator('.prod-run-header')).toContainText('UI-HISTORY-B');
    await expect(page.getByText('Stale cancellation error must not appear on B', { exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '取消任务', exact: true })).toHaveCount(0);
  }
});

test('stable Jev config callback performs one settings load and preserves unsaved edits without repeated fetches', async ({ page }) => {
  let configReads = 0; let benchmarkReads = 0; let writes = 0;
  await page.route('**/api/production/**', route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 400, json: { error: 'No config or model writes allowed' } }); }
    if (path === '/api/production/agents') return route.fulfill({ json: [] });
    if (path === '/api/production/runs') return route.fulfill({ json: [] });
    if (path === '/api/production/jev/config') { configReads++; return route.fulfill({ json: { ...DEFAULT_JEV_CONFIG, hasApiKey: false } }); }
    if (path === '/api/production/jev/benchmarks') { benchmarkReads++; return route.fulfill({ json: [] }); }
    return route.fulfill({ status: 404, json: { error: 'Read-only UI fixture endpoint absent' } });
  });
  await page.goto('/#production');
  await expect.poll(() => configReads).toBe(1);
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存 Jev 设置', exact: true })).toBeEnabled();
  await page.getByLabel('每维最低加权分数（0–4）', { exact: true }).fill('2.9');
  await page.getByLabel('最低分布集中度', { exact: true }).fill('0.6');
  await page.waitForTimeout(300);
  expect(configReads).toBe(2); expect(benchmarkReads).toBe(1); expect(writes).toBe(0);
  await expect(page.getByLabel('每维最低加权分数（0–4）', { exact: true })).toHaveValue('2.9');
  await expect(page.getByLabel('最低分布集中度', { exact: true })).toHaveValue('0.6');
  await expect(page.getByLabel(/Jev API Key（/)).toHaveValue('');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});
