import { expect, test, type Page } from '@playwright/test';
import { buildProductionLaunchPreflight } from '../server/production/launch-preflight';
import { PRODUCTION_EXECUTION_IDENTITY_VERSION, EXECUTION_IDENTITY_LIMITATION, type ProductionExecutionIdentity } from '../server/production/provenance';
import { PRODUCTION_ROLES, type ProductionAgent } from '../shared/production-schema';

// Engineering UI fixtures only: intercept every production API request and
// reject launch submissions. No Key, provider, candidate or Gate is executed.
const agents: ProductionAgent[] = PRODUCTION_ROLES.map((role, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`, role, name: `分组 UI 夹具 ${role}`,
  provider: 'deepseek', modelId: 'acceptance-groups-ui-fixture', baseUrl: 'https://example.invalid',
  enabled: true, hasApiKey: true, pricing: { inputPerMillion: .3, outputPerMillion: 1.2, currency: 'USD' },
}));
const execution: ProductionExecutionIdentity = {
  version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId: 'groups-ui-engineering-only', startedAt: '2026-10-08T00:00:00.000Z',
  commit: '1'.repeat(40), sourceClean: true, sourceFingerprint: '2'.repeat(64), sourceFiles: [],
  buildFingerprint: '3'.repeat(64), buildFiles: [], buildSnapshot: { platformCommit: '1'.repeat(40), sourceClean: true, builtAt: '2026-10-08T00:00:00.000Z' },
  ready: true, issues: [], limitation: EXECUTION_IDENTITY_LIMITATION,
};
const strategy = (page: Page) => page.getByLabel('启用分组验收规划（工程预览）', { exact: true });
const authorization = (page: Page) => page.getByLabel(/我授权本次在上述有限预算/);
const prepare = (page: Page) => page.getByRole('button', { name: '免费启动预检', exact: true });
const report = (page: Page) => page.getByLabel('免费启动预检结果');
const launch = (page: Page) => page.getByRole('button', { name: '启动真实生产', exact: true });

async function setup(page: Page, delay?: Promise<void>) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const progress = { preparationResponses: 0 };
  await page.route('**/api/production/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path.endsWith('/agents')) return route.fulfill({ json: agents });
      if (path.endsWith('/runs')) return route.fulfill({ json: [] });
      if (path.endsWith('/jev/config')) return route.fulfill({ json: { enabled: true, hasApiKey: true, modelId: 'jev-ui-only', minScore: 3, minConfidence: .5 } });
      return route.fulfill({ status: 404, json: { error: '未登记的 UI 夹具路由' } });
    }
    const body = request.postDataJSON(); requests.push({ path, body });
    if (path !== '/api/production/runs/preflight') return route.fulfill({ status: 400, json: { error: '分组 UI 提交夹具已捕获；没有实际启动' } });
    // A baseline report fixture suffices for UI state/payload assertions. Its
    // budget is not evidence for the planned-groups backend or model quality.
    const { acceptanceStrategy: _fixtureStrategy, ...legacyInput } = body;
    const fixture = buildProductionLaunchPreflight(legacyInput, agents, execution, () => {});
    if (delay) await delay;
    try { await route.fulfill({ json: fixture }); }
    catch (error) { if (!delay) throw error; /* Expected: the UI aborted its obsolete request. */ }
    finally { progress.preparationResponses++; }
  });
  await page.goto('/#production');
  await expect(strategy(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeEnabled();
  return { requests, progress };
}

async function fillRequirement(page: Page) {
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  await page.getByLabel('需求原话', { exact: true }).fill('做一个离线费用页，支持新增与准确统计');
  await page.getByLabel('编号', { exact: true }).fill('GROUPS-UI-01');
  await page.getByLabel('来源', { exact: true }).fill('工程 UI 夹具，不是真实业务原件');
  await page.getByLabel('业务验收要求', { exact: true }).fill('新增合法费用后数量和总额变化；非法输入在空态和已有记录态均保持记录不变');
}
async function prepareAndAuthorize(page: Page) {
  await prepare(page).click(); await expect(report(page)).toBeVisible();
  await authorization(page).check(); await expect(launch(page)).toBeEnabled();
}

test('groups preview is off by default and Mock is blocked without changing any selected configuration', async ({ page }) => {
  const { requests } = await setup(page);
  await expect(strategy(page)).not.toBeChecked();
  await strategy(page).check();
  await expect(page.getByLabel('工程夹具 / Mock', { exact: true })).toBeChecked();
  await expect(page.getByText(/分组验收规划仅支持真实模型/)).toBeVisible();
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeDisabled();
  await strategy(page).uncheck();
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeEnabled();
  expect(requests).toEqual([]);
});

test('only an explicit groups opt-in sends the strategy to free preparation and intercepted launch', async ({ page }) => {
  const { requests } = await setup(page); await fillRequirement(page);
  for (const optedIn of [false, true, false]) {
    await strategy(page).setChecked(optedIn);
    await prepareAndAuthorize(page);
    await launch(page).click();
    await expect(page.getByRole('alert')).toContainText('分组 UI 提交夹具已捕获');
    await expect(authorization(page)).not.toBeChecked();
    const pair = requests.slice(-2);
    expect(pair.map(item => item.path)).toEqual(['/api/production/runs/preflight', '/api/production/runs']);
    expect(pair[0].body.budgetAuthorized).toBe(false); expect(pair[1].body.budgetAuthorized).toBe(true);
    for (const item of pair) {
      expect(item.body).toMatchObject({ mode: 'live', capability: 'offline-single-html', candidateCount: 1, implementationEvidencePolicy: 'legacy' });
      if (optedIn) expect(item.body.acceptanceStrategy).toBe('planned-groups-v1');
      else expect(item.body).not.toHaveProperty('acceptanceStrategy');
      expect(item.body).not.toHaveProperty('apiKey'); expect(item.body).not.toHaveProperty('demoCaseId');
    }
  }
  expect(requests).toHaveLength(6);
});

test('strategy toggles revoke both consent and an existing free report, with explicit non-success boundaries', async ({ page }) => {
  const { requests } = await setup(page); await fillRequirement(page);
  await prepareAndAuthorize(page);
  await strategy(page).focus(); await page.keyboard.press('Space');
  await expect(strategy(page)).toBeChecked(); await expect(authorization(page)).not.toBeChecked();
  await expect(report(page)).toHaveCount(0); await expect(launch(page)).toBeDisabled();
  await expect(page.locator('#prod-acceptance-groups-explanation')).toContainText('测试最多 3 组');
  await expect(page.locator('#prod-acceptance-groups-explanation')).toContainText('完整原 Schema、语义、CSS 与 LLM 覆盖审查');
  await expect(page.locator('#prod-acceptance-groups-explanation')).toContainText('12×20');
  await expect(page.locator('#prod-acceptance-groups-explanation')).toContainText('工程证据不等于实测增益');
  await prepareAndAuthorize(page); await strategy(page).uncheck();
  await expect(authorization(page)).not.toBeChecked(); await expect(report(page)).toHaveCount(0);
  await expect(launch(page)).toBeDisabled();
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight', '/api/production/runs/preflight']);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

const conflicts = ['N2', 'Jev', 'source-bound', 'Mock', 'Mock-Jev', 'camera'] as const;
for (const conflict of conflicts) test(`groups ${conflict} conflict revokes old consent/report and blocks preparation/launch without silent fallback`, async ({ page }) => {
  const { requests } = await setup(page); await fillRequirement(page);
  await strategy(page).check(); await prepareAndAuthorize(page);
  if (conflict === 'N2') {
    await page.getByText('候选验证与有界执行预算', { exact: true }).click();
    await page.getByLabel('每环节候选数', { exact: true }).selectOption('2');
    await expect(page.getByLabel('每环节候选数', { exact: true })).toHaveValue('2');
  } else if (conflict === 'Jev') {
    await page.getByLabel('候选验证引擎', { exact: true }).selectOption('jev-cascade');
    await expect(page.getByLabel('候选验证引擎', { exact: true })).toHaveValue('jev-cascade');
  } else if (conflict === 'source-bound') {
    await page.getByLabel('启用条款证据门禁（LLM）', { exact: true }).check();
    await expect(page.getByLabel('启用条款证据门禁（LLM）', { exact: true })).toBeChecked();
  } else if (conflict === 'camera') {
    await page.getByLabel('受控交付能力', { exact: true }).selectOption('camera-scene-v1');
    await expect(page.getByLabel('受控交付能力', { exact: true })).toHaveValue('camera-scene-v1');
  } else {
    await page.getByLabel(conflict === 'Mock' ? '工程夹具 / Mock' : 'Mock + 真实 Jev', { exact: true }).check();
    await expect(page.getByLabel(conflict === 'Mock' ? '工程夹具 / Mock' : 'Mock + 真实 Jev', { exact: true })).toBeChecked();
  }
  await expect(strategy(page)).toBeChecked();
  await expect(page.getByText(/分组验收规划仅支持真实模型/)).toBeVisible();
  if (conflict === 'Mock') await expect(authorization(page)).toHaveCount(0);
  else await expect(authorization(page)).not.toBeChecked();
  await expect(report(page)).toHaveCount(0);
  if (await prepare(page).count()) await expect(prepare(page)).toBeDisabled();
  const submit = page.locator('form.prod-request button[type="submit"]');
  await expect(submit).toBeDisabled();
  if (conflict !== 'Mock') { await authorization(page).check(); await expect(submit).toBeDisabled(); }
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight']);

  if (conflict === 'N2') await page.getByLabel('每环节候选数', { exact: true }).selectOption('1');
  else if (conflict === 'Jev') await page.getByLabel('候选验证引擎', { exact: true }).selectOption('llm-rubric');
  else if (conflict === 'source-bound') await page.getByLabel('启用条款证据门禁（LLM）', { exact: true }).uncheck();
  else if (conflict === 'camera') await page.getByLabel('受控交付能力', { exact: true }).selectOption('offline-single-html');
  else await page.getByLabel('真实模型', { exact: true }).check();
  await expect(strategy(page)).toBeChecked(); await expect(authorization(page)).not.toBeChecked();
  await expect(report(page)).toHaveCount(0); await expect(prepare(page)).toBeEnabled();
  await expect(launch(page)).toBeDisabled();
});

for (const change of ['strategy', 'candidate-count'] as const) test(`a late free report cannot survive a ${change} change or restore consent`, async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const { requests, progress } = await setup(page, delay); await fillRequirement(page);
  await strategy(page).check(); await authorization(page).check();
  await prepare(page).click(); await expect.poll(() => requests.length).toBe(1);
  try {
    if (change === 'strategy') await strategy(page).uncheck();
    else {
      await page.getByText('候选验证与有界执行预算', { exact: true }).click();
      await page.getByLabel('每环节候选数', { exact: true }).selectOption('2');
    }
  } finally { release(); }
  await expect.poll(() => progress.preparationResponses).toBe(1);
  await expect(report(page)).toHaveCount(0); await expect(authorization(page)).not.toBeChecked();
  await expect(launch(page)).toBeDisabled();
  if (change === 'strategy') await expect(prepare(page)).toBeEnabled();
  else await expect(prepare(page)).toBeDisabled();
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight']);
});
