import { expect, test, type Page } from '@playwright/test';
import { buildProductionLaunchPreflight } from '../../server/production/launch-preflight';
import { PRODUCTION_EXECUTION_IDENTITY_VERSION, EXECUTION_IDENTITY_LIMITATION, type ProductionExecutionIdentity } from '../../server/production/provenance';
import { PRODUCTION_ROLES, type ProductionAgent } from '../../shared/production-schema';

// UI engineering only. Every API route is intercepted; no credentials,
// providers, task execution or actual delivery are involved.
const agents: ProductionAgent[] = PRODUCTION_ROLES.map((role, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`, name: `预检夹具 ${role}`, role,
  provider: 'deepseek', modelId: 'preflight-ui-fixture', baseUrl: 'https://example.invalid',
  enabled: true, hasApiKey: true, pricing: { inputPerMillion: .3, outputPerMillion: 1.2, currency: 'USD' },
}));
const alternateProduct = { ...agents[0], id: '00000000-0000-4000-8000-000000000090', name: '另一个产品夹具' };
const execution: ProductionExecutionIdentity = {
  version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId: 'engineering-only', startedAt: '2026-10-08T00:00:00.000Z',
  commit: '1'.repeat(40), sourceClean: true, sourceFingerprint: '2'.repeat(64), sourceFiles: [],
  buildFingerprint: '3'.repeat(64), buildFiles: [], buildSnapshot: { platformCommit: '1'.repeat(40), sourceClean: true, builtAt: '2026-10-08T00:00:00.000Z' },
  ready: true, issues: [], limitation: EXECUTION_IDENTITY_LIMITATION,
};
const authorization = (page: Page) => page.getByLabel(/我授权本次在上述有限预算/);

async function setup(page: Page, options: { configured?: boolean; reject?: boolean; delay?: Promise<void>; refresh?: { delay: Promise<void>; fail: boolean; onRequested: () => void } } = {}) {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const configured = options.configured !== false;
  const team = [...agents, alternateProduct].map(agent => ({ ...agent, hasApiKey: configured, pricing: configured ? agent.pricing : undefined }));
  let agentReads = 0;
  await page.route('**/api/production/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      if (path.endsWith('/agents')) {
        if (++agentReads > 1 && options.refresh) {
          options.refresh.onRequested(); await options.refresh.delay;
          if (options.refresh.fail) return route.fulfill({ status: 400, json: { error: '公开团队刷新夹具失败' } });
        }
        return route.fulfill({ json: team });
      }
      if (path.endsWith('/runs')) return route.fulfill({ json: [] });
      if (path.endsWith('/jev/config')) return route.fulfill({ json: { enabled: false, hasApiKey: false } });
      return route.fulfill({ status: 404, json: { error: '未登记的 UI 夹具路由' } });
    }
    const body = request.postDataJSON(); requests.push({ path, method: request.method(), body });
    if (options.refresh && request.method() === 'PATCH' && path === `/api/production/agents/${agents[0]!.id}`) {
      team[0] = { ...team[0]!, modelId: String(body.modelId) };
      return route.fulfill({ json: team[0] });
    }
    if (path !== '/api/production/runs/preflight') return route.fulfill({ status: 400, json: { error: '测试禁止启动实际任务' } });
    if (options.delay) await options.delay;
    if (options.reject) return route.fulfill({ status: 400, json: { error: '免费预检被拒绝；不会启动任务。' } });
    try { await route.fulfill({ json: buildProductionLaunchPreflight(body, team, execution, () => {}) }); }
    catch (error) { if (!options.delay) throw error; /* Changed input aborts this expected in-flight fixture. */ }
  });
  await page.goto('/#production');
  await expect(page.getByRole('button', { name: '新建自定义需求', exact: true })).toBeVisible();
  return requests;
}
async function fillRequirement(page: Page) {
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  await page.getByLabel('需求原话', { exact: true }).fill('做一个离线费用记录页，能新增、筛选和精确统计');
  await page.getByLabel('编号', { exact: true }).fill('UI-PREFLIGHT-01');
  await page.getByLabel('来源', { exact: true }).fill('工程自拟题；没有业务工单');
  await page.getByLabel('业务验收要求', { exact: true }).fill('新增后有一条真实记录；分类筛选小计正确，全部总额保持不变');
}

test('free prepare uses explicit false consent, records configuration and never creates a task', async ({ page }) => {
  const requests = await setup(page);
  await expect(page.getByRole('button', { name: '免费启动预检', exact: true })).toHaveCount(0);
  await fillRequirement(page);
  await authorization(page).check();
  await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
  await expect(page.getByLabel('免费启动预检结果')).toBeVisible();
  await expect(page.getByLabel('免费启动预检结果')).toContainText('采集时预检无阻塞');
  await expect(page.getByLabel('免费启动预检结果')).toContainText('12 / 24');
  await expect(page.getByLabel('免费启动预检结果')).toContainText('最终 Gate 尚未生成');
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].path).toBe('/api/production/runs/preflight');
  expect(requests[0].body).toMatchObject({ mode: 'live', budgetAuthorized: false, implementationEvidencePolicy: 'legacy', verifierEngine: 'llm-rubric' });
  expect(requests[0].body).not.toHaveProperty('demoCaseId');
  expect(requests[0].body).not.toHaveProperty('apiKey');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('missing keys and prices are reported as blockers, with unknown estimates rather than zero', async ({ page }) => {
  const requests = await setup(page, { configured: false });
  await fillRequirement(page);
  await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
  await expect(page.getByLabel('免费启动预检结果')).toContainText('启动条件存在阻塞');
  await expect(page.getByLabel('免费启动预检结果')).toContainText('声明费率');
  await expect(page.getByLabel('免费启动预检结果')).toContainText('unknown');
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight']);
});

test('changes to requirement, limits, evidence policy or selected models revoke the report and consent', async ({ page }) => {
  const requests = await setup(page); await fillRequirement(page);
  const prepare = async () => {
    await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
    await expect(page.getByLabel('免费启动预检结果')).toBeVisible();
    await authorization(page).check();
  };
  await prepare();
  await page.getByLabel('业务验收要求', { exact: true }).fill('另一个业务验收，旧预检不可复用');
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await prepare();
  await page.getByLabel('启用条款证据门禁（LLM）').check();
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await prepare();
  await page.getByLabel('产品经理 Agent', { exact: true }).selectOption(alternateProduct.id);
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await prepare();
  await page.getByText('候选验证与有界执行预算', { exact: true }).click();
  await page.getByLabel('总 Token 上限', { exact: true }).fill('400000');
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  expect(requests.every(item => item.path === '/api/production/runs/preflight' && item.body.budgetAuthorized === false)).toBe(true);
});

test('an input change cancels an in-flight preparation and cannot display its late report or enable paid start', async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; });
  const requests = await setup(page, { delay }); await fillRequirement(page);
  await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在免费预检…', exact: true })).toBeDisabled();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByLabel('需求原话', { exact: true }).fill('这是输入变化之后的新需求，不应出现旧预检报告');
  release();
  await expect(page.getByRole('button', { name: '免费启动预检', exact: true })).toBeEnabled();
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight']);
});

test('a rejected free request has no paid fallback, and unsupported engines do not show the preflight', async ({ page }) => {
  const requests = await setup(page, { reject: true }); await fillRequirement(page);
  await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('免费预检被拒绝');
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await page.getByLabel('候选验证引擎', { exact: true }).selectOption('jev-cascade');
  await expect(page.getByRole('button', { name: '免费启动预检', exact: true })).toHaveCount(0);
  expect(requests.map(item => item.path)).toEqual(['/api/production/runs/preflight']);
});

for (const fail of [false, true]) test(`saved Agent rotation revokes report and consent before delayed public refresh ${fail ? 'fails' : 'succeeds'}`, async ({ page }) => {
  let release!: () => void; const delay = new Promise<void>(resolve => { release = resolve; }); let refreshRequested = 0;
  const requests = await setup(page, { refresh: { delay, fail, onRequested: () => { refreshRequested++; } } });
  await fillRequirement(page);
  await page.getByRole('button', { name: '免费启动预检', exact: true }).click();
  await expect(page.getByLabel('免费启动预检结果')).toBeVisible();
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '研发团队', exact: true }).click();
  await page.locator('.prod-agent-card').filter({ has: page.getByRole('heading', { name: agents[0]!.name, exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('Model ID', { exact: true }).fill('rotated-ui-fixture-model');
  await page.getByLabel(/API Key（已配置/).fill('synthetic-ui-rotation-not-a-real-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect.poll(() => refreshRequested).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '生产工作台', exact: true }).click();
  // The GET is still pending: neither stale report nor old consent may survive
  // this await boundary, and a later failed refresh cannot restore them.
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  release();
  if (fail) await expect(page.getByRole('alert')).toContainText('配置已保存，但刷新团队失败');
  else await expect(page.getByRole('status').filter({ hasText: 'Agent 配置已保存' })).toBeVisible();
  await expect(page.getByLabel('免费启动预检结果')).toHaveCount(0);
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  expect(requests.map(item => [item.method, item.path])).toEqual([
    ['POST', '/api/production/runs/preflight'], ['PATCH', `/api/production/agents/${agents[0]!.id}`],
  ]);
  expect(requests.some(item => item.path === '/api/production/runs')).toBe(false);
});
