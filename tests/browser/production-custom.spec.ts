import { expect, test, type Page } from '@playwright/test';
import { PRODUCTION_DEMO_CASES } from '../../shared/production-benchmarks';

// UI state tests only. All production API requests are intercepted: no real
// keys are supplied, no provider calls are made, and no delivery is claimed.
const roles = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
const agents = roles.map((role, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`, role, name: `表单夹具 ${role}`,
  provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'ui-state-only',
  enabled: true, hasApiKey: true, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' },
}));
const secondProduct = { ...agents[0], id: '00000000-0000-4000-8000-000000000089', name: '第二个产品夹具' };
const customBrief = '做一个离线单页阅读清单，支持新增书名、完成标记与数量统计';
const customAcceptance = '添加一本书后显示一项；标记已读后完成数为一；不使用网络';
const authorization = (page: Page) => page.getByLabel(/我授权本次在上述有限预算/);

async function openWorkspace(page: Page, configured = true) {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/production/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postDataJSON() });
      // A deliberate rejected UI fixture, not an invocation of the platform.
      return route.fulfill({ status: 400, json: { error: '工程提交快照已捕获；未发起模型或执行器调用' } });
    }
    if (path.endsWith('/agents')) return route.fulfill({ json: [...agents, secondProduct].map(agent => ({ ...agent, hasApiKey: configured, pricing: configured ? agent.pricing : null })) });
    if (path.endsWith('/runs')) return route.fulfill({ json: [] });
    if (path.endsWith('/jev/config')) return route.fulfill({ json: { enabled: true, hasApiKey: configured, modelId: 'jev-1.13.0', minConfidence: 0.5, minScore: 3, maxRequests: 24, timeoutMs: 30000, pricing: { inputPerMillion: 0.042, outputPerMillion: 0, currency: 'USD' } } });
    return route.fulfill({ status: 404, json: { error: 'UI fixture route absent' } });
  });
  await page.goto('/#production');
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeEnabled();
  return writes;
}

async function fillCustom(page: Page) {
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  await page.getByLabel('需求原话', { exact: true }).fill(customBrief);
  await page.getByLabel('编号', { exact: true }).fill('CUSTOM-UI-01');
  await page.getByLabel('来源', { exact: true }).fill('工程浏览器自拟题；不是实际业务需求');
  await page.getByLabel('背景', { exact: true }).fill('验证自定义表单与输入快照，不验证模型自主交付');
  await page.getByLabel('业务验收要求', { exact: true }).fill(customAcceptance);
}

test('new custom requirement clears the Mock snapshot, focuses a labelled input and never starts or invents a real source', async ({ page }) => {
  const writes = await openWorkspace(page, false);
  const button = page.getByRole('button', { name: '新建自定义需求', exact: true });
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('需求原话', { exact: true })).toBeFocused();
  for (const label of ['需求原话', '编号', '来源', '背景', '业务验收要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByLabel('需求来源类型', { exact: true })).toHaveValue('illustrative');
  await expect(page.getByLabel('真实模型', { exact: true })).toBeChecked();
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await expect(page.locator('.prod-required-guidance')).toContainText('需求原话（至少 3 字）、编号、来源、业务验收要求');
  await expect(page.getByText(/已新建自定义需求，尚未启动或产生费用/)).toBeVisible();
  await expect(page.getByText(/请先在研发团队配置所有已选角色/)).toBeVisible();
  expect(writes).toEqual([]);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('editing a registered Mock brief detaches its evidence, preserves the new text and blocks fixed-case execution', async ({ page }) => {
  const writes = await openWorkspace(page);
  await page.getByLabel('需求原话', { exact: true }).fill(customBrief);
  await expect(page.getByLabel('需求原话', { exact: true })).toHaveValue(customBrief);
  for (const label of ['编号', '来源', '背景', '业务验收要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByLabel('需求来源类型', { exact: true })).toHaveValue('illustrative');
  await expect(page.getByRole('button', { name: PRODUCTION_DEMO_CASES[0].title, exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeDisabled();
  await expect(page.getByText(/已解除固定 Mock 关联/)).toBeVisible();
  await expect(page.getByText(/自定义需求或验收需要真实模型处理/)).toBeVisible();
  await page.getByLabel('Mock + 真实 Jev', { exact: true }).check();
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '运行 Mock + Jev 验证', exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: PRODUCTION_DEMO_CASES[1].title, exact: true }).click();
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByLabel('需求原话', { exact: true })).toHaveValue(PRODUCTION_DEMO_CASES[1].brief);
  await expect(page.getByLabel('编号', { exact: true })).toHaveValue(PRODUCTION_DEMO_CASES[1].id);
  await expect(page.getByLabel('来源', { exact: true })).toHaveValue(PRODUCTION_DEMO_CASES[1].source);
  await expect(page.getByLabel('业务验收要求', { exact: true })).toHaveValue(PRODUCTION_DEMO_CASES[1].acceptance);
  await page.getByLabel('工程夹具 / Mock', { exact: true }).check();
  await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeEnabled();
});

test('first edits to every Mock metadata field preserve only the current edit, not stale source or acceptance', async ({ page }) => {
  const writes = await openWorkspace(page);
  const cases = [
    { label: '编号', value: 'EDITED-UI', select: false },
    { label: '来源', value: '我重新提供的来源', select: false },
    { label: '背景', value: '我重新填写的背景', select: false },
    { label: '业务验收要求', value: '新的验收，不能使用旧断言', select: false },
    { label: '难度', value: 'high', select: true },
    { label: '需求来源类型', value: 'user-declared-real', select: true },
  ];
  for (const item of cases) {
    await page.getByRole('button', { name: PRODUCTION_DEMO_CASES[0].title, exact: true }).click();
    const sourceDetails = page.locator('details').filter({ has: page.getByText('需求来源与验收材料', { exact: true }) });
    if (!(await sourceDetails.evaluate(details => (details as HTMLDetailsElement).open))) await sourceDetails.locator('summary').click();
    const field = page.getByLabel(item.label, { exact: true });
    if (item.select) await field.selectOption(item.value); else await field.fill(item.value);
    await expect(field).toHaveValue(item.value);
    await expect(page.getByLabel('需求原话', { exact: true })).toHaveValue(PRODUCTION_DEMO_CASES[0].brief);
    for (const label of ['编号', '来源', '背景', '业务验收要求'].filter(label => label !== item.label)) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '运行 Mock 链路', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: PRODUCTION_DEMO_CASES[0].title, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  expect(writes).toEqual([]);
});

test('a custom live submit contains its own provenance, never demoCaseId, with real status only explicitly user-declared', async ({ page }) => {
  const writes = await openWorkspace(page);
  await fillCustom(page);
  await page.getByLabel('来源', { exact: true }).fill('   ');
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await expect(page.locator('.prod-required-guidance')).toContainText('来源');
  await page.getByLabel('来源', { exact: true }).fill('工程浏览器自拟题；不是实际业务需求');
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect(page.getByText('工程提交快照已捕获；未发起模型或执行器调用', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ brief: customBrief, mode: 'live', capability: 'offline-single-html', budgetAuthorized: true, requirement: { id: 'CUSTOM-UI-01', source: '工程浏览器自拟题；不是实际业务需求', acceptance: customAcceptance, kind: 'illustrative' } });
  expect(writes[0].body).not.toHaveProperty('demoCaseId');
  await page.getByLabel('需求来源类型', { exact: true }).selectOption('user-declared-real');
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await expect(page.getByText(/“真实业务需求”是你的来源声明，不是平台认证/)).toBeVisible();
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toMatchObject({ requirement: { kind: 'user-declared-real', source: '工程浏览器自拟题；不是实际业务需求' } });
  expect(writes[1].body).not.toHaveProperty('demoCaseId');
});

test('source-bound evidence is opt-in, revokes consent and is preserved in the submitted snapshot', async ({ page }) => {
  const writes = await openWorkspace(page);
  await fillCustom(page);
  const evidence = page.getByLabel('启用条款证据门禁（LLM）', { exact: true });
  await expect(evidence).not.toBeChecked();
  await authorization(page).check();
  await evidence.focus(); await page.keyboard.press('Space');
  await expect(evidence).toBeChecked();
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await expect(page.locator('#prod-evidence-explanation')).toContainText('引用核验不证明语义正确');
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ implementationEvidencePolicy: 'source-bound-v1', mode: 'live', budgetAuthorized: true });
  await evidence.uncheck();
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).toMatchObject({ implementationEvidencePolicy: 'legacy' });
});

test('evidence and Jev incompatibility blocks launch instead of silently changing the policy or adding paid calls', async ({ page }) => {
  const writes = await openWorkspace(page);
  await fillCustom(page);
  await page.getByLabel('启用条款证据门禁（LLM）', { exact: true }).check();
  await authorization(page).check();
  await page.getByText('候选验证与有界执行预算', { exact: true }).click();
  await page.getByLabel('候选验证引擎', { exact: true }).selectOption('jev-cascade');
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByText(/条款证据模式仅支持 LLM 序数评审/)).toBeVisible();
  await authorization(page).check();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  await expect(page.getByLabel('启用条款证据门禁（LLM）', { exact: true })).toBeChecked();
  expect(writes).toEqual([]);
});

test('all requirement, execution, budget and team edits revoke old consent synchronously', async ({ page }) => {
  const writes = await openWorkspace(page);
  await fillCustom(page);
  await page.getByText('候选验证与有界执行预算', { exact: true }).click();
  const edits = [
    () => page.getByLabel('需求原话', { exact: true }).fill(`${customBrief}，支持删除`),
    () => page.getByLabel('编号', { exact: true }).fill('CUSTOM-UI-02'),
    () => page.getByLabel('来源', { exact: true }).fill('另一条自拟来源'),
    () => page.getByLabel('背景', { exact: true }).fill('补充背景'),
    () => page.getByLabel('业务验收要求', { exact: true }).fill(`${customAcceptance}；删除后计数归零`),
    () => page.getByLabel('难度', { exact: true }).selectOption('medium'),
    () => page.getByLabel('需求来源类型', { exact: true }).selectOption('user-declared-real'),
    () => page.getByLabel('每环节候选数', { exact: true }).selectOption('2'),
    () => page.getByLabel('最多模型调用', { exact: true }).fill('30'),
    () => page.getByLabel('全局自动返修上限', { exact: true }).fill('1'),
    () => page.getByLabel('时间上限（秒）', { exact: true }).fill('500'),
    () => page.getByLabel('总 Token 上限', { exact: true }).fill('400000'),
    () => page.getByLabel('每次输出 Token 上限', { exact: true }).fill('5000'),
    () => page.getByLabel('单次估算费用上限', { exact: true }).fill('4'),
    () => page.getByLabel('候选验证引擎', { exact: true }).selectOption('jev-cascade'),
    () => page.getByLabel('产品经理 Agent', { exact: true }).selectOption(secondProduct.id),
    () => page.getByLabel('受控交付能力', { exact: true }).selectOption('camera-scene-v1'),
  ];
  for (const edit of edits) {
    await authorization(page).check();
    await expect(authorization(page)).toBeChecked();
    await edit();
    await expect(authorization(page)).not.toBeChecked();
    await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  }
  await authorization(page).check();
  await page.getByLabel('币种', { exact: true }).selectOption('CNY');
  await expect(authorization(page)).not.toBeChecked();
  await page.getByLabel('受控交付能力', { exact: true }).selectOption('offline-single-html');
  await authorization(page).check();
  await page.getByLabel('Mock + 真实 Jev', { exact: true }).check();
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByRole('button', { name: '运行 Mock + Jev 验证', exact: true })).toBeDisabled();
  await authorization(page).check();
  await page.getByLabel('真实模型', { exact: true }).check();
  await expect(authorization(page)).not.toBeChecked();
  expect(writes).toEqual([]);
});

test('camera selection and new custom preserve capability but never inherit an HTML Mock source or grant', async ({ page }) => {
  const writes = await openWorkspace(page);
  await page.getByLabel('真实模型', { exact: true }).check();
  await authorization(page).check();
  await page.getByLabel('受控交付能力', { exact: true }).selectOption('camera-scene-v1');
  for (const label of ['需求原话', '编号', '来源', '背景', '业务验收要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(authorization(page)).not.toBeChecked();
  await expect(page.getByLabel('工程夹具 / Mock', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Mock + 真实 Jev', { exact: true })).toBeDisabled();
  await fillCustom(page);
  await expect(page.getByLabel('受控交付能力', { exact: true })).toHaveValue('camera-scene-v1');
  await expect(page.getByLabel('来源', { exact: true })).toHaveValue('工程浏览器自拟题；不是实际业务需求');
  await authorization(page).check();
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  await expect(page.getByLabel('受控交付能力', { exact: true })).toHaveValue('camera-scene-v1');
  await expect(page.getByLabel('需求原话', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('来源', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('需求来源类型', { exact: true })).toHaveValue('illustrative');
  await expect(authorization(page)).not.toBeChecked();
  expect(writes).toEqual([]);
});

test('explicit camera mapping requirements revoke consent, reject conflicting actions and are sent only as optional camera data', async ({ page }) => {
  const writes = await openWorkspace(page);
  await fillCustom(page);
  await expect(page.getByLabel('张掌动作要求', { exact: true })).toHaveCount(0);
  await page.getByLabel('受控交付能力', { exact: true }).selectOption('camera-scene-v1');
  for (const label of ['张掌动作要求', '握拳动作要求', '横移动作要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByText(/不会从原话自动猜测或改写来源/)).toBeVisible();
  await authorization(page).check();
  await page.getByLabel('张掌动作要求', { exact: true }).selectOption('scatter');
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await page.getByLabel('握拳动作要求', { exact: true }).selectOption('scatter');
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await expect(page.getByText(/张掌与握拳的要求不能相同/)).toBeVisible();
  await expect(page.getByRole('button', { name: '启动真实生产', exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  await page.getByLabel('握拳动作要求', { exact: true }).selectOption('gather');
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await page.getByLabel('横移动作要求', { exact: true }).selectOption('rotate');
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).toMatchObject({ capability: 'camera-scene-v1', mode: 'live', cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } });
  expect(writes[0].body).not.toHaveProperty('demoCaseId');
  await page.getByLabel('横移动作要求', { exact: true }).selectOption('');
  await expect(authorization(page)).not.toBeChecked();
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body.cameraBusinessConstraints).toEqual({ openPalm: 'scatter', closedFist: 'gather' });
  await page.getByLabel('受控交付能力', { exact: true }).selectOption('offline-single-html');
  await authorization(page).check();
  await page.getByRole('button', { name: '启动真实生产', exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].body).not.toHaveProperty('cameraBusinessConstraints');
  await page.getByLabel('受控交付能力', { exact: true }).selectOption('camera-scene-v1');
  for (const label of ['张掌动作要求', '握拳动作要求', '横移动作要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await page.getByLabel('张掌动作要求', { exact: true }).selectOption('gather');
  await page.getByRole('button', { name: '新建自定义需求', exact: true }).click();
  for (const label of ['张掌动作要求', '握拳动作要求', '横移动作要求']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(authorization(page)).not.toBeChecked();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
