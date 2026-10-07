import { expect, test, type Page } from '@playwright/test';

// Browser API-state fixtures only. These tests neither send provider requests
// nor create real delivery evidence, configure keys, or request camera access.
const roles = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
const agents = roles.map((role, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`, role, name: `工程状态 ${role}`,
  provider: 'deepseek', baseUrl: 'https://example.invalid', modelId: 'ui-fixture',
  hasApiKey: false, enabled: true,
}));
const id = '00000000-0000-4000-8000-000000000198';
const limits = { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 5, currency: 'USD' };
const scriptText = '<script>window.fixtureInjected=true</script>';
const absentSecret = 'ui-only-secret-never-provided-to-api-or-page';
const rawResponse = {
  answers: { c0_coverage: { score: 3.39, confidence: 0.51, probabilities: { 0: 0.10, 1: 0, 2: 0.10, 3: 0, 4: 0.80 } } },
  usage: { input_tokens: 3386, output_tokens: 177 },
  providerText: scriptText, alreadySanitizedCredential: '[REDACTED]',
};

function makeRun(kind: 'protocol' | 'uncertain' | 'legacy' | 'fatal') {
  const sourceId = `jev-ui-${kind}`;
  const evaluation = {
    policyVersion: kind === 'legacy' ? 'jev-candidate-v2' : 'jev-candidate-v3',
    status: kind === 'uncertain' ? 'uncertain' : 'error',
    selectedCandidateId: null,
    // Misleading words in old/fatal error text must not drive typed UI state.
    reason: '工程状态原文：arithmetic-drift，曾建议 protocol fallback；这不是可信分类。',
    requestSnapshot: { model: 'jev-1.13.0', state: { phase: 'research', goal: '工程 UI 反例', acceptance: '冻结验收不变', frozenHash: 'frozen-ui-hash', candidates: [{ id: 'candidate-ui', value: { notes: '原始候选' } }], trustBoundary: 'UI fixture only' }, questions: {} },
    rawResponse, scores: [], choice: null,
    usage: { inputTokens: 3386, outputTokens: 177, estimatedCost: 0.000142212, currency: 'USD', complete: true },
    modelIdRequested: 'jev-1.13.0', modelIdReturned: 'jev-1.13.0',
    httpStatus: 200, providerRequests: 1, durationMs: 900,
    ...(kind !== 'uncertain' ? { error: '工程 API 状态，原始错误未改写' } : {}),
    ...(kind === 'protocol' ? { errorKind: 'arithmetic-drift', diagnostics: [{ code: 'score-mean-drift', answerId: 'c0_coverage' }] } : kind === 'fatal' ? { errorKind: 'fatal' } : {}),
  };
  const review = {
    phase: 'research', engine: kind === 'protocol' ? 'jev-llm-protocol-fallback' : 'jev-llm-fallback',
    ...(kind === 'protocol' ? { sourceJevCallId: sourceId } : {}),
    candidateIds: ['candidate-ui'], selectedCandidateId: 'candidate-ui',
    criteriaHash: 'frozen-ui-hash', scores: [{ candidateId: 'candidate-ui', score: 4, reason: '工程复核状态，不是模型实测' }],
    decision: 'accept', reason: '仅复核候选，不改变未通过的最终 Gate',
  };
  return {
    id, createdAt: '2026-10-07T00:00:00Z', status: 'failed', evidenceKind: 'injected-test',
    input: {
      brief: '工程界面：本地摄像头声明式场景', mode: 'live', capability: 'camera-scene-v1',
      verifierEngine: 'jev-cascade', budgetAuthorized: true, limits, candidateCount: 1,
      agentIds: agents.map(agent => agent.id),
      requirement: { id: `UI-JEV-${kind.toUpperCase()}`, source: '工程 API 状态夹具，非真实需求', kind: 'illustrative', acceptance: '冻结验收不降低', difficulty: 'low' },
    },
    agentSnapshot: agents, events: [], outputs: [], gateHistory: [],
    gate: { passed: false, checks: [{ name: '最终 Gate 保持失败', passed: false }] },
    cameraVerification: { scope: 'scene-behavior-synthetic', boundedScenePassed: false, visionModelVerified: false, physicalCameraVerified: false, fullRequirementVerified: false, limitations: ['纯 UI 状态，不是场景或实机验收'] },
    repairPolicyVersion: 'production-global-repair-v1', repairHistory: [], repairs: 0,
    calls: kind === 'protocol' || kind === 'uncertain' ? [{
      id: 'independent-ui-verifier', role: 'verifier', phase: 'research', model: agents[5],
      executionSource: 'injected', startedAt: '2026-10-07T00:00:01Z',
      promptVersion: 'engineering-ui-only', promptHash: 'fixture', configHash: 'fixture',
      rawOutput: JSON.stringify({ score: 4, selectedCandidateId: 'candidate-ui', credential: '[REDACTED]' }),
      usage: { inputTokens: 20, outputTokens: 10, estimatedCost: 0.00001, currency: 'USD' },
    }] : [],
    verifications: kind === 'protocol' || kind === 'uncertain' ? [review] : [],
    jevCalls: [{ id: sourceId, phase: 'research', startedAt: '2026-10-07T00:00:00Z', configHash: 'fixture-config', evaluation }],
    usage: { inputTokens: 3406, outputTokens: 187, estimatedCost: 0.000152212, currency: 'USD', complete: true },
    interventions: [], artifacts: [] as Array<{ name: string; type: string }>,
  };
}

async function openFixture(page: Page, run: Record<string, unknown>) {
  const mutationRequests: string[] = [];
  await page.route('**/api/production/**', route => {
    const request = route.request();
    if (request.method() !== 'GET') { mutationRequests.push(request.url()); return route.fulfill({ status: 400, json: { error: 'No writes permitted in UI fixture' } }); }
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/agents')) return route.fulfill({ json: agents });
    if (pathname.endsWith('/runs')) return route.fulfill({ json: [run] });
    if (pathname.endsWith(`/runs/${id}`)) return route.fulfill({ json: run });
    return route.fulfill({ status: 404, json: { error: 'UI fixture route absent' } });
  });
  await page.goto('/#production');
  await page.getByRole('button', { name: /候选验证/ }).click();
  return mutationRequests;
}

test('v3 arithmetic error stays untrusted with an exact-source independent review, unchanged budget and failed camera Gate', async ({ page }) => {
  const run = makeRun('protocol');
  const requests = await openFixture(page, run);
  await expect(page.getByText('独立 LLM 复核（Jev 算术异常）', { exact: true })).toBeVisible();
  await expect(page.getByText('Jev 异常决策未采信', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-protocol-fallback')).toContainText('不以异常分数作为依据');
  await expect(page.locator('.prod-fallback-budget')).toContainText('计入原调用、Token、时间与费用上限');
  await expect(page.locator('.prod-fallback-budget')).toContainText('不额外增加预算或返修次数');
  await expect(page.locator('.prod-fallback-budget')).toContainText('不证明准确率或高性价比');
  await expect(page.locator('.prod-run-summary')).toContainText('调用预算记录 2 / 24');
  await expect(page.locator('.prod-loop')).toContainText('全局返修 0 / 2');
  await expect(page.locator('.prod-jev-diagnostics')).toContainText('score-mean-drift');
  await expect(page.locator('.prod-jev-diagnostics')).toContainText('c0_coverage');
  const evidence = page.locator('#prod-jev-call-jev-ui-protocol');
  await page.getByRole('button', { name: '查看来源 Jev 调用 jev-ui-protocol' }).click();
  await expect(evidence).toBeFocused(); expect(new URL(page.url()).hash).toBe('#production');
  await expect(evidence).toContainText('选中 无');
  await expect(evidence).toContainText('派发记录（未验证 HTTP） 1');
  await evidence.locator('summary').click();
  const rawText = await evidence.locator('pre').textContent();
  const raw = JSON.parse(rawText!);
  expect(raw.id).toBe('jev-ui-protocol');
  expect(raw.evaluation).toMatchObject({ status: 'error', errorKind: 'arithmetic-drift', selectedCandidateId: null, scores: [], choice: null });
  expect(raw.evaluation.rawResponse).toEqual(rawResponse);
  expect(raw.evaluation.usage.estimatedCost).toBe(0.000142212);
  await expect(evidence.locator('pre')).toContainText(scriptText);
  await expect(evidence.locator('pre')).toContainText('[REDACTED]');
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).fixtureInjected)).toBeUndefined();
  await expect(page.locator('body')).not.toContainText(absentSecret);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByText('候选验证与有界执行预算', { exact: true }).click();
  await expect(page.getByLabel('最多模型调用', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('全局自动返修上限', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('单次估算费用上限', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
  await expect(page.getByText('交互预览未开放；尚无场景文件或交付物。', { exact: true })).toBeVisible();
  await expect(page.getByText(/可以下载已有场景/)).toHaveCount(0);
  await expect(page.locator('.prod-download-warning')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '打开受控场景预览' })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(requests).toEqual([]);
});

test('ordinary uncertain review is distinct, does not invent source ancestry, and offers only existing evidence without a scene', async ({ page }) => {
  const run = { ...makeRun('uncertain'), artifacts: [{ name: 'evidence.json', type: 'application/json' }] };
  const requests = await openFixture(page, run);
  await expect(page.getByText('独立 LLM 复核（Jev 不确定）', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-uncertain-fallback')).toContainText('原 Jev 决策不确定');
  await expect(page.getByText('不确定 → 需复核', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-protocol-fallback')).toHaveCount(0);
  await expect(page.getByText('Jev 异常决策未采信', { exact: true })).toHaveCount(0);
  await expect(page.locator('.prod-jev-source-missing')).toContainText('来源 Jev 调用 ID 未记录');
  await expect(page.locator('.prod-jev-source')).toHaveCount(0);
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByText('交互预览未开放；尚无场景文件，仅可下载上方已列出的证据。', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /evidence.json/ })).toBeVisible();
  await expect(page.locator('.prod-download-warning')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('legacy v2 error text cannot fabricate arithmetic classification or a new fallback record', async ({ page }) => {
  const requests = await openFixture(page, makeRun('legacy'));
  await expect(page.getByText('请求 / 契约错误', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-jev-evidence')).toContainText('jev-candidate-v2');
  await expect(page.locator('.prod-jev-evidence')).toContainText('arithmetic-drift');
  await expect(page.locator('.prod-jev-error-boundary')).toHaveCount(0);
  await expect(page.locator('.prod-verifier-engine')).toHaveCount(0);
  await expect(page.locator('.prod-protocol-fallback')).toHaveCount(0);
  await expect(page.locator('.prod-jev-source')).toHaveCount(0);
  const evidence = page.locator('#prod-jev-call-jev-ui-legacy');
  await evidence.locator('summary').click();
  const raw = JSON.parse((await evidence.locator('pre').textContent())!);
  expect(raw.evaluation).not.toHaveProperty('errorKind');
  expect(raw.evaluation.policyVersion).toBe('jev-candidate-v2');
  expect(requests).toEqual([]);
});

test('trusted fatal classification remains fatal despite misleading protocol text and opens no review or preview', async ({ page }) => {
  const requests = await openFixture(page, makeRun('fatal'));
  await expect(page.getByText('Jev 致命错误 / 决策未采信', { exact: true })).toBeVisible();
  await expect(page.locator('.prod-jev-error-boundary')).toContainText('不进入算术异常的独立复核分支');
  await expect(page.locator('.prod-fallback-budget')).toHaveCount(0);
  await expect(page.locator('.prod-jev-source')).toHaveCount(0);
  await expect(page.locator('.prod-run-summary')).toContainText('调用预算记录 1 / 24');
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开受控场景预览' })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('an independently attempted verifier failure keeps unknown cost and exact provenance without fabricating abstention or acceptance', async ({ page }) => {
  const original = makeRun('protocol');
  const run = {
    ...original, verifications: [],
    calls: original.calls.map(call => ({
      ...call, verificationEngine: 'jev-llm-protocol-fallback', sourceJevCallId: 'jev-ui-protocol',
      error: '工程传输失败状态：未观测 usage，未取得合法复核响应',
      rawOutput: '', usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD' },
    })),
    usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false },
  };
  const requests = await openFixture(page, run);
  await expect(page.getByText('尚无候选评审结果。', { exact: true })).toBeVisible();
  await expect(page.getByText('选择候选', { exact: true })).toHaveCount(0);
  await expect(page.getByText('拒绝 / 弃权', { exact: true })).toHaveCount(0);
  await expect(page.locator('.prod-run-summary')).toContainText('估算费用 unknown');
  await page.getByRole('button', { name: /原始调用/ }).click();
  const attemptedCall = page.locator('.prod-output').filter({ hasText: 'Verifier · research' });
  await expect(attemptedCall.locator('summary').first()).toContainText('复核请求失败 / 未取得合法结论');
  await attemptedCall.locator('summary').first().click();
  await expect(attemptedCall.locator('.prod-verifier-engine')).toContainText('独立 LLM 复核（Jev 算术异常）');
  await expect(attemptedCall.locator('.prod-verification-request-failed')).toContainText('此处没有通过或模型弃权判定');
  await expect(attemptedCall.locator('.prod-verification-request-failed')).toContainText('unknown 用量或费用不记为零');
  await expect(attemptedCall.locator('.prod-call-meta')).toContainText('输入 unknown / 输出 unknown Token · 估算费用 unknown');
  await expect(attemptedCall.locator('pre').first()).toHaveText('（未收到输出）');
  await attemptedCall.locator('.prod-prompt summary').click();
  const snapshot = JSON.parse((await attemptedCall.locator('.prod-prompt pre').textContent())!);
  expect(snapshot).toMatchObject({ verificationEngine: 'jev-llm-protocol-fallback', sourceJevCallId: 'jev-ui-protocol' });
  await attemptedCall.getByRole('button', { name: '查看来源 Jev 调用 jev-ui-protocol' }).click();
  await expect(page.locator('#prod-jev-call-jev-ui-protocol')).toBeFocused();
  await expect(page.getByText('Jev 异常决策未采信', { exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#production');
  await page.getByRole('button', { name: /门禁与交付/ }).click();
  await expect(page.getByRole('heading', { name: '场景行为 Gate：未通过' })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开受控场景预览' })).toHaveCount(0);
  expect(requests).toEqual([]);
});
