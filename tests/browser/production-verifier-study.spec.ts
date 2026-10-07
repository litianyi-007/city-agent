import { expect, test, type Page, type Route } from '@playwright/test';
import { jevConfigSchema } from '../../shared/jev-schema';
import type { VerifierStudyExecutionSource, VerifierStudyPreparation, VerifierStudyPublicPlan, VerifierStudyPublicRun, VerifierStudyPublicSummary } from '../../shared/verifier-study-control-schema';

const verifierId = '00000000-0000-4000-8000-000000000006';
const preparationId = '00000000-0000-4000-8000-000000000100';
const runId = '00000000-0000-4000-8000-000000000101';
const hash = 'a'.repeat(64);
const configuration = {
  verifier: { id: verifierId, name: 'Browser fixture verifier', role: 'verifier' as const, enabled: true,
    provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
    pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' as const } },
  jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true },
};
const plan: VerifierStudyPublicPlan = {
  version: 'verifier-study-observed-policy-v1', configuration,
  limits: { maxCalls: 54, maxInputTokens: 3391488, maxObservedOutputTokens: 221184, maxEstimatedCostUsd: 1,
    maxDurationMs: 1800000, oracleTimeoutMs: 120000, llmTimeoutMs: 120000, jevTimeoutMs: 30000 },
  reservations: {
    llm: { inputTokens: 61440, outputTokens: 4096, timeoutMs: 120000, estimatedCostUsd: 0.0233472, outputPolicy: 'vendor-request-max_tokens-4096-and-observed-stop' },
    jev: { inputTokens: 65536, outputTokens: 4096, timeoutMs: 30000, estimatedCostUsd: 0.002752512, outputPolicy: '4096-post-response-observation-stop-only; vendor-output-limit-unknown' },
  },
  poolIds: [...Array.from({ length: 12 }, (_, index) => `H${String(index + 1).padStart(2, '0')}`), ...Array.from({ length: 6 }, (_, index) => `C${index + 13}`)],
  strategies: ['baseline', 'llm', 'jev-cascade'], candidateRandomization: 'not-performed',
  accountingBoundary: 'Declared-rate estimates, not provider billing caps.', httpBoundary: 'Proxy/fetch dispatch is not remote receipt or billing.',
};
function preparation(source: VerifierStudyExecutionSource, expiresAt = new Date(Date.now() + 600000).toISOString()): VerifierStudyPreparation {
  return { id: preparationId, executionSource: source, frozenStudySha256: hash, expiresAt, plan };
}
function summary(source: VerifierStudyExecutionSource, status: 'completed' | 'cancelled' = 'completed'): VerifierStudyPublicSummary {
  const complete = status === 'completed';
  return { version: 'verifier-study-observed-v1', runId, executionSource: source, cachePolicy: 'bypass', status,
    reason: null, startedAt: '2026-10-07T00:00:00Z', endedAt: '2026-10-07T00:00:01Z', durationMs: 1000,
    plannedDecisions: 54, attemptedDecisions: complete ? 54 : 1, notStartedDecisions: complete ? 0 : 53,
    plannedOracles: 36, attemptedOracles: complete ? 36 : 0, completedOracles: complete ? 36 : 0, callbackIntents: complete ? 54 : 1,
    actualProviderHttpAttempts: source === 'real-provider' ? complete ? 54 : null : 0,
    localFixtureHttpAttempts: source === 'loopback-engineering' ? complete ? 54 : 1 : null,
    actualModelUsage: null, usage: { complete, knownInputTokens: complete ? 5454 : 0, knownOutputTokens: complete ? 378 : 0,
      knownEstimatedCost: complete ? 0.001469556 : 0, currency: 'USD', unknownCalls: complete ? 0 : 1,
      scope: source === 'real-provider' ? 'observed-provider-declared-rate-estimate-not-bill' : 'loopback-fixture-accounting-not-model-measurement' },
    byStrategy: [], ledgerTerminalPersisted: true };
}
function run(source: VerifierStudyExecutionSource = 'loopback-engineering', status: VerifierStudyPublicRun['status'] = 'running', id = runId): VerifierStudyPublicRun {
  return { id, executionSource: source, status, bootId: 'browser-fixture-boot', frozenStudySha256: hash,
    createdAt: '2026-10-07T00:00:00Z', finishedAt: status === 'running' ? null : '2026-10-07T00:00:01Z',
    progress: { ledgerEvents: status === 'running' ? null : 290, decisions: status === 'running' ? null : 54,
      calls: status === 'running' ? null : 54, oracles: status === 'running' ? null : 36 },
    summary: status === 'completed' || status === 'cancelled' ? summary(source, status) : null, error: null };
}
const fulfill = (route: Route, value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
type Handlers = { prepare?: (route: Route) => Promise<void>; start?: (route: Route) => Promise<void>;
  list?: () => VerifierStudyPublicRun[]; detail?: (route: Route, id: string) => Promise<void>; cancel?: (route: Route, id: string) => Promise<void> };
async function mockApi(page: Page, handlers: Handlers = {}) {
  const roles = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
  await page.route('**/api/production/agents', route => fulfill(route, roles.map((role, index) => ({ ...configuration.verifier,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: role === 'verifier' ? configuration.verifier.name : `Fixture ${role}`, role }))));
  await page.route('**/api/production/runs', route => fulfill(route, []));
  await page.route('**/api/production/jev/config', route => fulfill(route, configuration.jev));
  await page.route('**/api/production/verifier-studies**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/prepare') && route.request().method() === 'POST') {
      if (handlers.prepare) await handlers.prepare(route);
      else await fulfill(route, preparation(route.request().postDataJSON().executionSource));
    } else if (pathname.endsWith('/start') && route.request().method() === 'POST') {
      if (handlers.start) await handlers.start(route); else await fulfill(route, run());
    } else if (pathname.endsWith('/cancel') && route.request().method() === 'POST') {
      const id = pathname.split('/').at(-2)!;
      if (handlers.cancel) await handlers.cancel(route, id); else await fulfill(route, run('loopback-engineering', 'cancelled', id));
    } else if (pathname.endsWith('/verifier-studies') && route.request().method() === 'GET') await fulfill(route, handlers.list?.() ?? []);
    else if (route.request().method() === 'GET') {
      const id = pathname.split('/').at(-1)!;
      if (handlers.detail) await handlers.detail(route, id); else await fulfill(route, run('loopback-engineering', 'running', id));
    } else await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Unexpected mocked study request"}' });
  });
  await page.goto('/#production');
  await page.getByRole('button', { name: '决策设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifier A/B/C 评测', exact: true })).toBeVisible();
}
const panel = (page: Page) => page.locator('.verifier-study-panel');
async function expand(page: Page) { await panel(page).getByRole('button', { name: '展开评测并测试', exact: true }).click(); }

test('study is initially collapsed and defaults to explicit free preparation/start with no automatic execution', async ({ page }) => {
  const preparations: unknown[] = [], starts: unknown[] = []; let lists = 0;
  await mockApi(page, { list: () => { lists++; return []; }, prepare: async route => {
    preparations.push(route.request().postDataJSON()); await fulfill(route, preparation('loopback-engineering'));
  }, start: async route => { starts.push(route.request().postDataJSON()); await fulfill(route, run('loopback-engineering', 'completed')); } });
  await expect(panel(page).getByRole('button', { name: '展开评测并测试' })).toHaveAttribute('aria-expanded', 'false');
  expect(lists).toBe(0); expect(starts).toHaveLength(0);
  await panel(page).getByRole('button', { name: '展开评测并测试' }).focus(); await page.keyboard.press('Enter');
  await expect(panel(page).getByLabel('免费工程评测（不调用真实模型）', { exact: true })).toBeChecked();
  await expect(panel(page)).toContainText('不读取生产模型 Key');
  await expect(panel(page)).toContainText('18 次内存 fixture dispatch，不是 18 个 HTTP 请求');
  await panel(page).getByRole('button', { name: '准备免费工程评测', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '本次冻结配置与执行边界' })).toBeVisible();
  expect(preparations).toEqual([{ executionSource: 'loopback-engineering' }]); expect(starts).toHaveLength(0);
  await expect(panel(page)).toContainText(hash); await expect(panel(page)).toContainText('61,440');
  await expect(panel(page)).toContainText('USD 0.890044416');
  await panel(page).getByRole('button', { name: '启动免费工程评测', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '评测记录完成', exact: true })).toBeVisible();
  expect(starts).toEqual([{ preparationId, estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true }]);
  await expect(panel(page)).toContainText('合成 Token（非真实模型）');
  await expect(panel(page)).toContainText('不产生真实模型费用（仅免费工程模式）');
  await expect(panel(page).getByRole('button', { name: '启动免费工程评测', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('real study requires selected agent, frozen preparation, two explicit acknowledgements and one start; cancel preserves unknown fees', async ({ page }) => {
  const preparations: unknown[] = [], starts: unknown[] = [], cancels: string[] = []; let stored: VerifierStudyPublicRun | null = null;
  await mockApi(page, { list: () => stored ? [stored] : [], prepare: async route => {
    preparations.push(route.request().postDataJSON()); await fulfill(route, preparation('real-provider'));
  }, start: async route => { starts.push(route.request().postDataJSON()); stored = run('real-provider'); await fulfill(route, stored); },
  detail: async route => fulfill(route, stored!), cancel: async (route, id) => { cancels.push(id); stored = run('real-provider', 'cancelled'); await fulfill(route, stored); } });
  await expand(page); await panel(page).getByLabel('真实模型评测（确认后可能付费）', { exact: true }).check();
  await panel(page).getByRole('button', { name: '准备真实评测（尚不调用）', exact: true }).click();
  const start = panel(page).getByRole('button', { name: '确认并启动本次真实付费评测', exact: true });
  await expect(start).toBeDisabled(); expect(preparations).toEqual([{ executionSource: 'real-provider', verifierAgentId: verifierId }]); expect(starts).toHaveLength(0);
  await panel(page).getByLabel(/我理解 1 USD 是估算预算/).check(); await expect(start).toBeDisabled();
  await panel(page).getByLabel(/我理解 Jev 输出 4,096 Token/).check(); await expect(start).toBeEnabled();
  await start.click(); await expect(panel(page).getByRole('heading', { name: '评测执行中', exact: true })).toBeVisible();
  expect(starts).toEqual([{ preparationId, estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true }]);
  await expect(panel(page).locator('.verifier-study-run')).toContainText('unknown / 54');
  await expect(panel(page)).toContainText('unknown（费率估算不能替代账单）');
  await panel(page).getByRole('button', { name: '取消当前评测', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: '已取消', exact: true })).toBeVisible(); expect(cancels).toEqual([runId]);
  await expect(panel(page)).toContainText('unknown（已知 USD 0；1 次 usage 未观测）');
  await page.reload(); await page.getByRole('button', { name: '决策设置', exact: true }).click(); await expand(page);
  await expect(panel(page).getByRole('heading', { name: '已取消', exact: true })).toBeVisible(); expect(starts).toHaveLength(1);
});

test('late preparation after changing free/real mode cannot install or authorize the stale freeze', async ({ page }) => {
  let held: Route | null = null; let starts = 0;
  await mockApi(page, { prepare: async route => { held = route; }, start: async route => { starts++; await fulfill(route, run()); } });
  await expand(page); await panel(page).getByRole('button', { name: '准备免费工程评测', exact: true }).click();
  await expect.poll(() => !!held).toBe(true);
  await panel(page).getByLabel('真实模型评测（确认后可能付费）', { exact: true }).check();
  await fulfill(held!, preparation('loopback-engineering')).catch(() => {});
  await expect(panel(page).getByRole('heading', { name: '本次冻结配置与执行边界' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: '确认并启动本次真实付费评测' })).toHaveCount(0); expect(starts).toBe(0);
  await expect(panel(page).getByRole('button', { name: '准备真实评测（尚不调用）', exact: true })).toBeEnabled();
});

test('expired preparation cannot start or silently refresh its authorization', async ({ page }) => {
  let starts = 0;
  await mockApi(page, { prepare: async route => fulfill(route, preparation('loopback-engineering', new Date(Date.now() - 1000).toISOString())),
    start: async route => { starts++; await fulfill(route, run()); } });
  await expand(page); await panel(page).getByRole('button', { name: '准备免费工程评测', exact: true }).click();
  await expect(panel(page).getByText('冻结准备已过期，请重新准备；不会自动启动。', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '启动免费工程评测', exact: true })).toBeDisabled(); expect(starts).toBe(0);
});

test('interrupted history and nullable progress stay unknown; reading never resumes or polls a terminal study', async ({ page }) => {
  let details = 0, starts = 0;
  const interrupted = { ...run('real-provider', 'interrupted'), progress: { ledgerEvents: null, decisions: null, calls: null, oracles: null } };
  await mockApi(page, { list: () => [interrupted], detail: async route => { details++; await fulfill(route, interrupted); },
    start: async route => { starts++; await fulfill(route, run()); } });
  await expand(page); await expect(panel(page).getByRole('heading', { name: '已中断（不会自动恢复）', exact: true })).toBeVisible();
  await expect(panel(page).locator('.verifier-study-run')).toContainText('unknown / 54');
  await expect(panel(page)).toContainText('继续实验需重新准备并明确启动');
  await page.waitForTimeout(900); expect(starts).toBe(0); expect(details).toBe(0);
});

test('only active studies poll, and collapsing cancels polling without cancelling or restarting the task', async ({ page }) => {
  let details = 0, mutations = 0;
  const active = run();
  await mockApi(page, { list: () => [active], detail: async route => { details++; await fulfill(route, active); },
    cancel: async route => { mutations++; await fulfill(route, run('loopback-engineering', 'cancelled')); },
    start: async route => { mutations++; await fulfill(route, active); } });
  await expand(page); await expect.poll(() => details).toBeGreaterThan(0);
  await panel(page).getByRole('button', { name: '收起评测入口', exact: true }).click();
  const before = details; await page.waitForTimeout(1600); expect(details).toBe(before); expect(mutations).toBe(0);
  await expand(page); await expect.poll(() => details).toBeGreaterThan(before); expect(mutations).toBe(0);
});

test('a delayed record response cannot replace the more recently selected run', async ({ page }) => {
  const a = run('loopback-engineering', 'completed', '00000000-0000-4000-8000-000000000201');
  const b = run('real-provider', 'completed', '00000000-0000-4000-8000-000000000202');
  let held: Route | null = null;
  await mockApi(page, { list: () => [a, b], detail: async (route, id) => { if (id === a.id) held = route; else await fulfill(route, b); } });
  await expand(page);
  const history = panel(page).getByLabel('评测运行记录');
  await history.getByRole('button').nth(0).click(); await expect.poll(() => !!held).toBe(true);
  await history.getByRole('button').nth(1).click(); await expect(panel(page).locator('.verifier-study-run')).toContainText(b.id);
  await fulfill(held!, a).catch(() => {});
  await expect(panel(page).locator('.verifier-study-run')).toContainText(b.id);
  await expect(history.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
});
