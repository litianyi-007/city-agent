import { test, expect, type Page, type Route } from '@playwright/test';
import { createBusinessEvidenceTemplate } from '../../shared/business-evidence.ts';
import type { ResearchTask } from '../../shared/research-schema.ts';
import type { ResearchPlanningResult } from '../../shared/research-planning.ts';

const fixtureAgentId = '11111111-1111-4111-8111-111111111111';
const candidateTitle = '合成UI夹具候选 · 非真实调研';
type PlanningBody = { agentId: string; acknowledgeCost: boolean; request: string; context?: string; maxQuestions: number; cancelId?: string; population: Omit<ResearchTask['population'], 'filters'> };

/** Explicitly synthetic UI response. No model, provider, credential or market fact is involved. */
function candidateFixture(body: PlanningBody): ResearchPlanningResult {
  const task: ResearchTask = {
    schemaVersion: '1.0', id: 'synthetic-ui-task', title: candidateTitle, objective: 'questionnaire-quality',
    decisionContext: { offering: '合成测试概念', buyer: '合成测试购买者', endUser: '合成测试使用者', channel: '测试渠道，非经营建议' },
    population: { ...body.population, filters: [] },
    questionnaire: { id: 'synthetic-ui-questionnaire', version: 'test-v1', questions: [
      { id: 'synthetic-question', type: 'text', prompt: '仅用于UI工程夹具的测试题？', required: true, maxLength: 1000 },
    ] },
    declarations: [{ id: 'fixture-only', claim: '全部为合成测试，不认证现实事实。', provenance: 'generated', sourceIds: [], observationIds: [] }],
    requestedOutputs: ['questionnaire-review'],
  };
  const input = { request: body.request, population: body.population, context: body.context, maxQuestions: body.maxQuestions };
  return {
    schemaVersion: '1.0', status: 'candidate', candidate: true, semanticValidation: 'not-performed', marketResearchValidated: false,
    residentCalls: 0, task, assumptions: ['合成UI夹具，不是来源事实。'], clarifications: ['待用户确认目标人群。'],
    dataGaps: ['未提供现实业务证据。'], limitations: ['page.route模拟，仅用于UI，不是模型能力实测。'],
    evidence: {
      schemaVersion: '1.0', plannerVersion: 'synthetic-ui-fixture', execution: 'injected-runner', state: 'candidate',
      startedAt: '2026-10-07T00:00:00.000Z', finishedAt: '2026-10-07T00:00:00.001Z', durationMs: 1, modelCalls: 0,
      model: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:39999/v1', modelId: 'synthetic-ui-model' },
      modelConfigHash: '1'.repeat(64), input, inputHash: '2'.repeat(64), systemPrompt: '合成UI夹具，无真实Prompt调用。',
      userPrompt: body.request, promptHash: '3'.repeat(64), rawResponse: 'synthetic-ui-fixture', responseHash: '4'.repeat(64),
      inputTokens: null, outputTokens: null, usageStatus: 'unknown', cost: null, costStatus: 'unknown', harness: 'synthetic-ui-fixture-not-harness',
      limits: { timeoutMs: 1000, maxOutputTokens: 1000, maxQuestions: body.maxQuestions },
    },
  };
}

/** All possible execution POSTs are intercepted before the local backend. */
async function installZeroCostGuard(page: Page, planning?: (route: Route, body: PlanningBody) => Promise<void>) {
  const state = { planningBodies: [] as PlanningBody[], planningCancels: [] as { cancelId?: string }[], blockedWrites: [] as string[], externalRequests: [] as string[], errors: [] as string[] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      state.externalRequests.push(url.href); await route.abort('blockedbyclient'); return;
    }
    if (url.pathname === '/api/research/planning/agents') {
      await route.fulfill({ json: [
        { id: fixtureAgentId, name: '合成规划测试连接', role: 'researcher', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:39999/v1', modelId: 'synthetic-ui-model', enabled: true, hasApiKey: true },
        { id: '22222222-2222-4222-8222-222222222222', name: '未配置Key的合成连接', role: 'product', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:39999/v1', modelId: 'synthetic-ui-model', enabled: true, hasApiKey: false },
      ] }); return;
    }
    if (url.pathname === '/api/research/planning/cancel' && request.method() === 'POST') {
      state.planningCancels.push(request.postDataJSON());
      await route.fulfill({ json: { cancelled: true, cancelId: request.postDataJSON()?.cancelId } });
      return;
    }
    if (url.pathname === '/api/research/planning' && request.method() === 'POST') {
      const body = request.postDataJSON() as PlanningBody; state.planningBodies.push(body);
      if (planning) await planning(route, body); else await route.fulfill({ json: candidateFixture(body) });
      return;
    }
    if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.blockedWrites.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 409, json: { error: 'Synthetic UI safety guard: all non-planning writes blocked.' } }); return;
    }
    await route.continue();
  });
  return state;
}

async function openPlanner(page: Page) {
  await page.goto('/#research');
  await page.getByRole('button', { name: '从自然语言规划调查', exact: true }).click();
  const panel = page.getByRole('region', { name: '自然语言研究规划', exact: true });
  await expect(panel.getByLabel('规划模型')).toHaveValue(fixtureAgentId);
  await panel.getByLabel('用自然语言描述研究需求').fill('这是一条合成UI测试研究需求，不发真实模型请求。');
  return panel;
}

test('synthetic planning requires cost acknowledgement and explicit application, never starts resident execution', async ({ page }) => {
  const guard = await installZeroCostGuard(page);
  const panel = await openPlanner(page);
  const initialTitle = await page.getByLabel('调查标题', { exact: true }).inputValue();
  const generate = panel.getByRole('button', { name: '生成候选问卷 · 调用模型', exact: true });
  await expect(generate).toBeDisabled();
  expect(guard.planningBodies).toHaveLength(0);
  await panel.getByRole('checkbox').check();
  await panel.getByLabel('规划模型').selectOption('22222222-2222-4222-8222-222222222222');
  await expect(generate).toBeDisabled();
  await panel.getByLabel('规划模型').selectOption(fixtureAgentId);
  await expect(generate).toBeEnabled();
  expect(guard.planningBodies).toHaveLength(0);
  await generate.click();
  await expect(panel.getByRole('heading', { name: `候选研究 · ${candidateTitle}`, exact: true })).toBeVisible();
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue(initialTitle);
  expect(guard.planningBodies).toHaveLength(1);
  expect(guard.planningBodies[0].acknowledgeCost).toBe(true);
  expect(JSON.stringify(guard.planningBodies)).not.toContain('apiKey');
  await panel.getByRole('button', { name: '应用候选至草稿 · 不启动调查', exact: true }).click();
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue(candidateTitle);
  await expect(page.getByRole('heading', { name: '03 · 问卷 · 1 题', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '问卷仿真与结果' }).getByRole('button', { name: '运行问卷演示' })).toBeVisible();
  expect(guard.planningBodies).toHaveLength(1);
  expect(guard.blockedWrites).toEqual([]);
  expect(guard.externalRequests).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('synthetic candidate cannot overwrite a draft changed after planning', async ({ page }) => {
  const guard = await installZeroCostGuard(page);
  const panel = await openPlanner(page);
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '生成候选问卷 · 调用模型', exact: true }).click();
  await expect(panel.getByRole('heading', { name: `候选研究 · ${candidateTitle}`, exact: true })).toBeVisible();
  await page.getByLabel('调查标题', { exact: true }).fill('候选之后的新草稿（合成测试）');
  await expect(panel.getByText('草稿已改变，不能将旧候选覆盖到新背景，请重新规划。', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '应用候选至草稿 · 不启动调查', exact: true })).toBeDisabled();
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue('候选之后的新草稿（合成测试）');
  expect(guard.planningBodies).toHaveLength(1);
  expect(guard.blockedWrites).toEqual([]);
  expect(guard.externalRequests).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('cancelled synthetic planning ignores a deliberately delayed candidate and does not retry', async ({ page }) => {
  let release!: () => void; let delivered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { delivered = resolve; });
  const guard = await installZeroCostGuard(page, async (route, body) => {
    await pending;
    try { await route.fulfill({ json: candidateFixture(body) }); }
    finally { delivered(); }
  });
  const panel = await openPlanner(page);
  const initialTitle = await page.getByLabel('调查标题', { exact: true }).inputValue();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '生成候选问卷 · 调用模型', exact: true }).click();
  await expect.poll(() => guard.planningBodies.length).toBe(1);
  await expect(panel.getByRole('button', { name: '取消规划', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '取消规划', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('规划已取消');
  await expect.poll(() => guard.planningCancels.length).toBe(1);
  release(); await done;
  await expect(panel.getByRole('button', { name: '应用候选至草稿 · 不启动调查', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue(initialTitle);
  expect(guard.planningBodies).toHaveLength(1);
  expect(guard.planningCancels).toHaveLength(1);
  expect(guard.planningCancels[0].cancelId).toBe(guard.planningBodies[0].cancelId);
  expect(guard.blockedWrites).toEqual([]);
  expect(guard.externalRequests).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('business evidence preflight surfaces uncollected and malformed input without any model request', async ({ page }) => {
  const guard = await installZeroCostGuard(page);
  await page.goto('/#research');
  await page.getByRole('button', { name: '检查业务证据包', exact: true }).click();
  const panel = page.getByRole('region', { name: '业务证据包预检', exact: true });
  const check = panel.getByRole('button', { name: '检查业务证据包 · 不调用模型', exact: true });
  expect(JSON.parse(await panel.getByLabel('来源与观测包 JSON').inputValue())).toEqual(createBusinessEvidenceTemplate());
  await check.click();
  await expect(panel.getByRole('heading', { name: '业务证据仍有缺口', exact: true })).toBeVisible();
  await expect(panel.locator('.evidence-audit-json')).toContainText('"requirementsProvided": false');
  await expect(panel.locator('.evidence-audit-json')).toContainText('"manualSourceVerificationNeeded": true');
  await panel.getByLabel('来源与观测包 JSON').fill('{ malformed');
  await expect(panel.getByRole('heading', { name: '业务证据仍有缺口', exact: true })).toHaveCount(0);
  await check.click();
  await expect(panel.getByRole('alert')).toContainText('文件不是有效 JSON');
  await panel.getByLabel('来源与观测包 JSON').fill('{}');
  await check.click();
  await expect(panel.getByRole('heading', { name: '文件契约无效', exact: true })).toBeVisible();
  await panel.getByLabel('来源与观测包 JSON').fill(JSON.stringify(createBusinessEvidenceTemplate()));
  await panel.getByLabel('本次研究的数据要求 JSON（可选）').fill('{ malformed');
  await check.click();
  await expect(panel.getByRole('alert')).toContainText('文件不是有效 JSON');
  expect(guard.planningBodies).toEqual([]);
  expect(guard.blockedWrites).toEqual([]);
  expect(guard.externalRequests).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('review guide link really resolves and new research panels fit a 375px viewport', async ({ page }) => {
  const guard = await installZeroCostGuard(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const panel = await openPlanner(page);
  await page.getByRole('button', { name: '检查业务证据包', exact: true }).click();
  const evidence = page.getByRole('region', { name: '业务证据包预检', exact: true });
  await evidence.getByRole('button', { name: '检查业务证据包 · 不调用模型', exact: true }).click();
  await expect(evidence.getByRole('heading', { name: '业务证据仍有缺口', exact: true })).toBeVisible();
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button', { name: '生成候选问卷 · 调用模型', exact: true }).click();
  await expect(panel.getByRole('heading', { name: `候选研究 · ${candidateTitle}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/research-next-mobile.png', fullPage: true });
  const guideLink = page.getByRole('link', { name: '评委本机复现说明 ↗', exact: true });
  await expect(guideLink).toHaveAttribute('href', '/review-guide.html');
  const popupPromise = page.waitForEvent('popup');
  await guideLink.click();
  const guide = await popupPromise;
  await expect(guide.getByRole('heading', { name: '评委体验指南', exact: true })).toBeVisible();
  await expect(guide.getByText('不经过Harness', { exact: true })).toBeVisible();
  await expect(guide.getByRole('heading', { name: '本机Harness', exact: true })).toBeVisible();
  expect(await guide.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await guide.close();
  expect(guard.blockedWrites).toEqual([]);
  expect(guard.externalRequests).toEqual([]);
  expect(guard.errors).toEqual([]);
});
