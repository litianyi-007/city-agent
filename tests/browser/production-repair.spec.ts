import { expect, test } from '@playwright/test';

// Mocked response state only. These records are not stored as real model runs,
// and no provider calls, credentials or hardware are used by this regression.
const runId = '00000000-0000-4000-8000-000000000087';
function runState(extra: Record<string, unknown> = {}) {
  return { id: runId, status: 'failed', createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'real-model', input: { brief: '工程界面全局返修账本状态', capability: 'camera-scene-v1', mode: 'live', limits: { maxRepairCycles: 2, maxCalls: 24 }, requirement: { id: 'UI-REPAIR-LEDGER', acceptance: 'UI state only', kind: 'illustrative' } }, agentSnapshot: [], events: [], calls: [], outputs: [], verifications: [], repairs: 2, gate: { passed: false, checks: [{ name: '未通过的原始 Gate', passed: false }] }, gateHistory: [], artifacts: [], interventions: [], usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, ...extra };
}

test('global repair ledger shows both sources within one pool, original reasons, candidate references and freeze hashes', async ({ page }) => {
  const hash = 'abcdef0123456789'.repeat(4);
  const run = runState({ repairPolicyVersion: 'production-global-repair-v1', repairHistory: [
    { id: 'stage-repair-1', time: '2026-10-07T00:00:01Z', phase: 'research', role: 'researcher', kind: 'stage-regeneration', attempt: 1, reason: '候选无法通过结构预检，需要按原约束重生成', rejectedCandidateIds: ['research-c0', 'research-c1'], frozenHash: null },
    { id: 'gate-repair-2', time: '2026-10-07T00:00:02Z', phase: 'implementation', role: 'developer', kind: 'gate-repair', attempt: 2, reason: '原始行为断言未通过，不能放宽 Gate', rejectedCandidateIds: ['implementation-c0'], frozenHash: hash },
  ] });
  await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
  await page.route(`**/api/production/runs/${runId}`, route => route.fulfill({ json: run }));
  await page.goto('/#production');
  await expect(page.locator('.prod-loop')).toContainText('全局返修 2 / 2');
  await expect(page.getByText(/阶段生成纠错与 Gate 返修共用该预算/)).toBeVisible();
  const history = page.getByLabel('返修历史与计数口径', { exact: true });
  await history.locator('summary').click();
  await expect(history).toContainText('production-global-repair-v1');
  await expect(history).toContainText('第 1 次 · 阶段生成纠错'); await expect(history).toContainText('研究员 · research');
  await expect(history).toContainText('第 2 次 · Gate 返修'); await expect(history).toContainText('研发 · implementation');
  await expect(history).toContainText('候选无法通过结构预检，需要按原约束重生成');
  await expect(history).toContainText('原始行为断言未通过，不能放宽 Gate');
  for (const value of ['research-c0', 'research-c1', 'implementation-c0', hash, '未记录 / null', 'stage-repair-1', 'gate-repair-2']) await expect(history).toContainText(value);
  for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
  await page.getByRole('button', { name: '证据与申报', exact: true }).click();
  await expect(page.locator('.prod-metric').filter({ hasText: '真实自主交付良品率' })).toContainText('0.0%');
});

test('legacy repair count preserves old semantics and absent history never becomes a zero-entry ledger', async ({ page }) => {
  const run = runState({ repairs: 1 });
  await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
  await page.goto('/#production');
  await expect(page.locator('.prod-loop')).toContainText('旧版研发 / Gate 返修 1 / 2');
  const history = page.getByLabel('返修历史与计数口径', { exact: true }); await history.locator('summary').click();
  await expect(history).toContainText('未记录（旧版）'); await expect(history).toContainText('不按当前全局返修池解释');
  await expect(history).toContainText('阶段生成前纠错的消耗不可追溯，不补记为 0');
  await expect(history).not.toContainText('全局返修尚未消耗'); await expect(history.getByRole('region', { name: '已记录返修条目' })).toHaveCount(0);
});

test('a versioned missing ledger is unknown while an explicitly empty ledger with zero count is known empty', async ({ page }) => {
  let run = runState({ repairs: 0, repairPolicyVersion: 'production-global-repair-v1' });
  await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
  await page.goto('/#production');
  let history = page.getByLabel('返修历史与计数口径', { exact: true }); await history.locator('summary').click();
  await expect(history).toContainText('返修明细未记录 / unknown'); await expect(history).not.toContainText('全局返修尚未消耗');
  run = { ...run, repairHistory: [] } as typeof run;
  await page.reload(); history = page.getByLabel('返修历史与计数口径', { exact: true }); await history.locator('summary').click();
  await expect(history).toContainText('全局返修尚未消耗；当前账本明确为空'); await expect(history).not.toContainText('返修明细未记录 / unknown');
});

for (const [failureKind, label] of [['infrastructure', '执行环境失败'], ['timeout', '执行器总时限耗尽']] as const) {
  test(`typed Gate ${failureKind} displays executor termination, preserves failed evidence and consumes no repair`, async ({ page }) => {
    const gate = { passed: false, failureKind, summary: '保留的原始 Gate 失败摘要；不得修改为通过', checks: [{ name: '失败原始检查', passed: false, detail: '这是工程状态，不是真实模型任务' }] };
    const run = runState({ repairs: 0, repairPolicyVersion: 'production-global-repair-v1', repairHistory: [], gate, gateHistory: [gate], artifacts: [{ name: 'scene.json', type: 'application/json' }] });
    await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
    await page.goto('/#production'); await page.getByRole('button', { name: /门禁与交付/ }).click();
    await expect(page.locator('.prod-gate-failure-kind')).toHaveText(`${label}：已停止，未作为代码质量返修。`);
    await expect(page.locator('.prod-loop')).toContainText('全局返修 0 / 2');
    await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
    await expect(page.getByText('保留的原始 Gate 失败摘要；不得修改为通过', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '打开受控场景预览' })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    const history = page.getByLabel('返修历史与计数口径', { exact: true }); await history.locator('summary').click();
    await expect(history).toContainText('全局返修尚未消耗；当前账本明确为空');
    await page.getByRole('button', { name: '证据与申报', exact: true }).click();
    await expect(page.locator('.prod-metric').filter({ hasText: '真实自主交付良品率' })).toContainText('0 次完整验收通过 / 1 次终态尝试');
  });
}

test('an untyped legacy Gate summary cannot fabricate infrastructure or timeout classification', async ({ page }) => {
  const run = runState({ repairs: 0, gate: { passed: false, summary: '执行环境失败或执行器总时限耗尽只是旧版摘要文字，没有结构化控制面标记', checks: [{ name: 'timeout infrastructure text is not a type', passed: false }] } });
  await page.route('**/api/production/runs', route => route.fulfill({ json: [run] }));
  await page.goto('/#production'); await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.locator('.prod-gate-failure-kind')).toHaveCount(0);
  await expect(page.getByText(/只是旧版摘要文字/)).toBeVisible();
  await expect(page.locator('.prod-loop')).toContainText('旧版研发 / Gate 返修 0 / 2');
});
