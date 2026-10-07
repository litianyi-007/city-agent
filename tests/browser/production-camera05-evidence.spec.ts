import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProductionRun } from '../../shared/production-schema';

// Real archived data replay, not new execution or success. All production API
// responses are intercepted; this test does not configure credentials, invoke
// providers, run a Gate, request media permissions or generate a new product.
const run: ProductionRun = JSON.parse(readFileSync(new URL('../../docs/production/experiments/CAMERA-05/run.json', import.meta.url), 'utf8'));
const sourceCommit = '6c7fa4df9c9defd0f8f5bc7bbc39c556a5e12c93';

test('CAMERA-05 archived failed attempt displays unknown usage, observed request records and no frozen Gate or preview', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'evidence-scope', description: 'real archived data replay, not new execution or success' });
  expect(run.platformCommit).toBe(sourceCommit);
  expect(run.status).toBe('failed');
  const mutations: string[] = [];
  const unhandledApi: string[] = [];
  const externalRequests: string[] = [];
  const origin = new URL(testInfo.project.use.baseURL as string).origin;

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      externalRequests.push(request.url());
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 400, json: { error: 'Archived UI replay prohibits execution and configuration changes' } });
    }
    // The fresh UI has no configured agents; only the immutable historical run
    // carries its already-sanitized public metadata. No Key editor is opened.
    if (url.pathname === '/api/production/agents') return route.fulfill({ json: [] });
    if (url.pathname === '/api/production/runs') return route.fulfill({ json: [run] });
    if (url.pathname === `/api/production/runs/${run.id}`) return route.fulfill({ json: run });
    if (url.pathname === '/api/production/jev/config') return route.fulfill({ status: 404, json: { error: 'Decision settings intentionally unavailable in this read-only replay' } });
    unhandledApi.push(url.pathname);
    return route.fulfill({ status: 404, json: { error: 'No other API is available during archived replay' } });
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/#production');
  const detail = page.getByRole('region', { name: '当前运行详情', exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.locator('.prod-run-header')).toContainText('CAMERA-05');
  await expect(detail.locator('.prod-run-header')).toContainText(run.id);
  await expect(detail.locator('.prod-status')).toHaveText('交付失败');
  await expect(detail.locator('.prod-run-summary')).toContainText('时间 39.6s');
  await expect(detail.locator('.prod-run-summary')).toContainText('角色调用记录 8');
  await expect(detail.locator('.prod-run-summary')).toContainText('调用预算记录 11 / 30');
  await expect(detail.locator('.prod-run-summary')).toContainText('Jev 实际请求 3');
  await expect(detail.locator('.prod-run-summary')).toContainText('输入 / 输出 Token unknown / unknown');
  await expect(detail.locator('.prod-run-summary')).toContainText('估算费用 unknown');
  await expect(detail.locator('.prod-loop')).toContainText('全局返修 1 / 2');
  const ledger = detail.getByRole('region', { name: '请求与用量账本', exact: true });
  for (const [label, value] of [['Harness 调用意图', '8 条'], ['Harness 实际 HTTP POST', '7'], ['Jev 实际 HTTP POST', '3'], ['总实际 HTTP POST', '10'], ['已报告输入 Token 小计', '61,317'], ['已报告输出 Token 小计', '4,842'], ['已报告估算费用小计', '0.01776294 USD']]) await expect(ledger.locator('dl > div').filter({ has: page.locator('dt').filter({ hasText: label }) }).locator('dd')).toContainText(value);
  await expect(ledger).toContainText('已报告小计不替代 unknown 总额');
  await expect(ledger).toContainText('用量明细含未知记录1 / 11 条');
  await expect(detail.locator('.prod-run-error').first()).toContainText('malformed prompt variable reference');
  await expect(detail.locator('.prod-run-error').first()).toContainText('{{particleCount}}');

  await detail.getByRole('button', { name: /候选验证/ }).click();
  const jevEvidence = detail.getByRole('region', { name: 'Jev 决策证据', exact: true });
  await expect(jevEvidence.getByText('不确定 → 需复核', { exact: true })).toHaveCount(3);
  await expect(detail.locator('.prod-uncertain-fallback')).toHaveCount(3);
  for (const call of run.jevCalls!) {
    const originalDecision = page.locator(`#prod-jev-call-${call.id}`);
    await expect(originalDecision).toContainText('实际请求 1');
    await expect(originalDecision).toContainText('选中 无');
    await expect(originalDecision).not.toContainText('接受候选');
  }

  await detail.getByRole('button', { name: /原始调用/ }).click();
  const tester = detail.locator('details.prod-output').filter({ has: page.locator('summary').filter({ hasText: '测试 · acceptance' }) });
  await expect(tester).toHaveCount(1);
  await tester.locator('summary').first().click();
  await expect(tester).toContainText('调用失败');
  await expect(tester).toContainText('输入 unknown / 输出 unknown Token · 估算费用 unknown');
  await expect(tester.locator(':scope > pre')).toHaveText('（未收到输出）');
  expect(run.calls.at(-1)!.providerRequests!.requests).toBe(0);
  expect(run.calls.filter(call => call.executionSource === 'harness').length).toBe(8);
  expect(run.calls.reduce((sum, call) => sum + call.providerRequests!.requests, 0) + run.jevCalls!.reduce((sum, call) => sum + call.evaluation.providerRequests, 0)).toBe(10);

  await detail.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(detail.getByRole('heading', { name: '场景行为 Gate：未执行', exact: true })).toBeVisible();
  await expect(detail.locator('.prod-contract')).toContainText('尚未冻结。研发开始前必须完成业务与测试契约冻结。');
  await expect(detail.getByText('交互预览未开放；尚无场景文件，仅可下载上方已列出的证据。', { exact: true })).toBeVisible();
  await expect(detail.locator('.prod-artifact-list a')).toHaveCount(2);
  for (const name of ['delivery-manifest.json', 'evidence.json']) await expect(detail.getByRole('link', { name: new RegExp(name.replace('.', '\\.')) })).toHaveAttribute('href', `/api/production/runs/${run.id}/artifacts/${name}`);
  await expect(detail.getByRole('link', { name: '打开受控场景预览', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '打开运行预览', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe, .prod-preview-image, video')).toHaveCount(0);
  await expect(detail.getByText('scene.json', { exact: true })).toHaveCount(0);
  await expect(detail.locator('.prod-download-warning')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  // Add only a trusted screenshot annotation, not a new status or execution
  // result. The immutable failed run is displayed exactly as supplied above.
  await detail.evaluate(element => {
    const note = document.createElement('aside');
    note.setAttribute('role', 'note');
    note.setAttribute('data-evidence-scope', 'real archived data replay, not new execution or success');
    note.textContent = '历史真实记录重放 · CAMERA-05 / 6c7fa4d · 本截图不是新执行或交付成功';
    note.style.cssText = 'padding:16px 22px;background:#fff7ed;border-bottom:1px solid #fed7aa;color:#7c2d12;font:600 14px/1.7 system-ui,sans-serif;border-radius:12px 12px 0 0';
    element.prepend(note);
  });
  const screenshotDirectory = fileURLToPath(new URL('../../output/production-camera05/', import.meta.url));
  // Preserve the earlier status screenshot; this is a new ledger UI replay.
  const screenshotPath = `${screenshotDirectory}CAMERA05-status-ledger.png`;
  mkdirSync(screenshotDirectory, { recursive: true });
  await detail.screenshot({ path: screenshotPath, animations: 'disabled' });
  await testInfo.attach('CAMERA05 archived failed UI replay — not new execution or success', { path: screenshotPath, contentType: 'image/png' });

  expect(mutations).toEqual([]);
  expect(unhandledApi).toEqual([]);
  expect(externalRequests).toEqual([]);
});
