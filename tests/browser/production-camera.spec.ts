import { expect, test } from '@playwright/test';

// API state fixtures only: no model requests, camera permission, keys or real
// autonomous-delivery evidence are created by these UI contract tests.
const roles = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
const agents = roles.map((role, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, role, name: `工程界面 ${role}`, provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'fake-ui-model', hasApiKey: true, enabled: true, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } }));
const id = '00000000-0000-4000-8000-000000000099';
function stateRun(input: Record<string, unknown>, passed: boolean) {
  return { id, input, createdAt: '2026-10-07T00:00:00Z', status: passed ? 'completed' : 'failed', evidenceKind: 'real-model', agentSnapshot: agents, events: [], calls: [], verifications: [], outputs: [], gateHistory: [], gate: { passed, checks: [{ name: '合成场景行为', passed }] }, cameraVerification: { scope: 'scene-behavior-synthetic', boundedScenePassed: passed, visionModelVerified: false, physicalCameraVerified: false, fullRequirementVerified: false, runtimeVersion: 'engineering-ui-state', runtimeHash: 'fixture', limitations: ['UI state fixture only'] }, repairs: 0, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, interventions: [], artifacts: [{ name: 'scene.json', type: 'application/json' }] };
}

test('camera capability is live-only and explicitly budgeted; its bounded Gate never becomes complete acceptance', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/production/agents', route => route.fulfill({ json: agents }));
  await page.route('**/api/production/runs', async route => {
    if (route.request().method() === 'POST') { submitted = route.request().postDataJSON(); return route.fulfill({ status: 202, json: stateRun(submitted!, true) }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/#production');
  await page.getByLabel('受控交付能力').selectOption('camera-scene-v1');
  await expect(page.getByLabel('真实模型', { exact: true })).toBeChecked();
  await expect(page.getByLabel('工程夹具 / Mock', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Mock + 真实 Jev', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '启动真实生产' })).toBeDisabled();
  await page.getByLabel('需求原话').fill('制作一个可通过本机摄像头控制聚散与旋转的通用粒子场景');
  await page.getByText('需求来源与验收材料', { exact: true }).click();
  await page.getByLabel('业务验收要求').fill('固定可信运行时；摄像头默认关闭且只在本机识别；场景行为和实机验收分开记录');
  await page.getByLabel(/我授权本次在上述有限预算/).check();
  await expect(page.getByRole('button', { name: '启动真实生产' })).toBeEnabled();
  await page.getByRole('button', { name: '启动真实生产' }).click();
  await expect(page.getByText('场景行为通过，摄像头待实机验收', { exact: true })).toBeVisible();
  expect(submitted?.capability).toBe('camera-scene-v1'); expect(submitted?.mode).toBe('live'); expect(submitted?.budgetAuthorized).toBe(true); expect(submitted).not.toHaveProperty('demoCaseId');
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：通过（合成输入）' })).toBeVisible();
  const preview = page.getByRole('link', { name: '打开受控场景预览' });
  await expect(preview).toHaveAttribute('href', `/api/production/runs/${id}/scene-preview`);
  await expect(preview).toHaveAttribute('target', '_blank'); await expect(preview).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('iframe')).toHaveCount(0); await expect(page.locator('.prod-preview img')).toHaveCount(0);
  for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole('button', { name: '证据与申报', exact: true }).click();
  const rate = page.locator('.prod-metric').filter({ hasText: '真实自主交付良品率' });
  await expect(rate).toContainText('0.0%'); await expect(rate).toContainText('0 次完整验收通过 / 1 次终态尝试');
});

test('a failed camera Gate does not offer an unusable trusted preview link or execute any generated HTML', async ({ page }) => {
  const run = stateRun({ capability: 'camera-scene-v1', mode: 'live', limits: { maxCalls: 24, maxRepairCycles: 2 }, requirement: { id: 'UI-CAMERA-FAILED', kind: 'illustrative' } }, false);
  await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
  await page.route(`**/api/production/runs/${id}`, route => route.fulfill({ json: run }));
  await page.goto('/#production'); await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开受控场景预览' })).toHaveCount(0);
  await expect(page.getByText(/交互预览未开放/)).toBeVisible(); await expect(page.locator('iframe')).toHaveCount(0);
});
