import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { renderProductionPortal, type ProductionPortalInput } from '../scripts/production-portal.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { demoHtml } from '../server/production/fixtures.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import type { JevEvaluation } from '../shared/jev-schema.js';

function fixtureRun(index: number): ProductionRun {
  const item = PRODUCTION_DEMO_CASES[index];
  const input = productionRunInputSchema.parse({ brief: item.brief, mode: 'demo', demoCaseId: item.operation, agentIds: Array.from({ length: 6 }, (_, offset) => `00000000-0000-4000-8000-00000000000${offset}`), requirement: { id: item.id, source: item.source, acceptance: item.acceptance, kind: item.kind } });
  return { id: `portal-fixture-${index}`, input, status: 'completed', createdAt: '2026-10-07T00:00:00Z', evidenceKind: 'fixture', agentSnapshot: [], events: [], calls: [], verifications: [], outputs: [{ role: 'developer', phase: 'implementation', value: { html: 'SOURCE_MUST_NOT_BE_EMBEDDED<script>unsafe()</script>' }, selectedCandidateId: 'mock' }], gateHistory: [], gate: { passed: true, checks: [{ name: '实际行为契约', passed: true }] }, repairs: 0, durationMs: 1200, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [{ name: 'index.html', type: 'text/html' }], frozenContract: { version: 'test-contract', hash: 'frozen-hash', requirementHash: 'input-hash', frozenAt: '2026-10-07T00:00:00Z', checks: [] } };
}
const portalInput = (): ProductionPortalInput => ({ packageManifest: { platformCommit: 'frozen-commit', generatedAt: '2026-10-07', files: [] }, report: {}, requirements: PRODUCTION_DEMO_CASES, runs: PRODUCTION_DEMO_CASES.map((_, index) => fixtureRun(index)), jevBenchmarks: [], mixedRuns: [], trustedFixtureIds: PRODUCTION_DEMO_CASES.map(item => item.id) });

test('reviewer v3 highlights same-version Markdown, independent installation and immutable evidence links', () => {
  const input = portalInput();
  const commit = 'a'.repeat(40);
  input.packageManifest = { ...input.packageManifest, materialsVersion: 'production-materials-v3', reportCommit: commit, publisherCommit: commit, files: [{ path: 'REVIEWER-GUIDE.md' }, { path: 'SUBMISSION-REPORT.md' }] };
  input.submissionBase = `./reviews/${commit}/submission/`;
  input.previewBase = `./reviews/${commit}/previews/`;
  input.snapshotHref = `./reviews/${commit}/index.html`;
  const html = renderProductionPortal(input);
  assert.ok(html.includes('评委入口 · 下载、安装与自测'));
  for (const name of ['REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md']) assert.ok(html.includes(`href="./reviews/${commit}/submission/${name}"`));
  assert.ok(html.includes(`href="./reviews/${commit}/index.html"`));
  assert.ok(html.includes('git clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review'));
  assert.ok(html.includes('Node.js 22.19+'));
  assert.ok(html.includes('npx playwright install chromium'));
  assert.ok(html.includes(`git checkout ${commit}`));
  assert.ok(html.includes('npm ci\nnpx playwright install chromium\nnpm run build\nnpm start'));
  assert.ok(html.includes('公开页面不接收 Key、不运行 Harness、不进行实时生成'));
  assert.ok(html.includes('按评委指南准备并核验固定本地资产'));
});

test('registered MP4 is preferred without relabeling historical footage as a new real delivery experiment', () => {
  const input = portalInput();
  const originalCommit = '891fedcab0f3c5994c7e92f7874e610b3b6354b8';
  input.packageManifest = { ...input.packageManifest, files: [{ path: 'demo.mp4' }, { path: 'demo.webm' }], historicalVideo: true, videoSourceCommit: originalCommit };
  const mp4 = renderProductionPortal(input);
  assert.ok(mp4.includes('下载 MP4 演示视频'));
  assert.ok(mp4.includes('<source src="./submission/demo.mp4" type="video/mp4">'));
  assert.ok(mp4.indexOf('<source src="./submission/demo.mp4"') < mp4.indexOf('<source src="./submission/demo.webm"'));
  assert.ok(mp4.includes(originalCommit));
  assert.ok(mp4.includes('格式转换不是重跑、重录或新的模型实验'));
  assert.ok(mp4.includes('不作为现版本安全边界通过证据'));
  input.packageManifest.files = [{ path: 'demo.webm' }];
  const fallback = renderProductionPortal(input);
  assert.ok(fallback.includes('历史 WebM 回退录屏'));
  assert.ok(fallback.includes('下载历史 WebM 录屏'));
  assert.ok(fallback.includes('本包没有 MP4'));
  assert.equal(fallback.includes('<source src="./submission/demo.mp4"'), false);
});

test('four different-version real camera failures remain separate from three zero-generation Mock cases', () => {
  const input = portalInput();
  input.cameraRuns = Array.from({ length: 4 }, (_, index): ProductionRun => ({
    ...fixtureRun(0), id: `camera-ui-state-${index}`, platformCommit: String(index + 1).repeat(40),
    input: { ...fixtureRun(0).input, mode: 'live', capability: 'camera-scene-v1', demoCaseId: undefined, requirement: { ...fixtureRun(0).input.requirement, id: `CAMERA-0${index + 1}`, source: 'Engineering portal-state test, not measured evidence', acceptance: 'Original frozen acceptance', kind: 'illustrative' } },
    evidenceKind: 'real-model', status: 'failed', gate: undefined, gateHistory: [], artifacts: [],
    cameraVerification: { scope: 'scene-behavior-synthetic', boundedScenePassed: false, visionModelVerified: false, physicalCameraVerified: false, fullRequirementVerified: false, runtimeVersion: 'engineering-fixture', runtimeHash: 'engineering-fixture-hash', limitations: ['UI fixture only'] },
    calls: [], usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false }, error: 'engineering failed-state evidence',
  }));
  const html = renderProductionPortal(input);
  assert.ok(html.includes('记录 4 次真实生成尝试；完整交付通过 0 / 4 次终态'));
  assert.ok(html.includes('不同配置的调优账本，不是同一冻结配置下的稳定成功率实验'));
  assert.ok(html.includes('3 / 3'));
  assert.ok(html.includes('0.0%'));
  assert.ok(html.includes('0 个通过 / 4 次真实研发终态尝试'));
  assert.ok(html.includes('real-camera-runs.json'));
  assert.equal((html.match(/完整需求未验收/g) ?? []).length, 4);
  for (const run of input.cameraRuns) assert.ok(html.includes(run.platformCommit!));
  const bounded = { ...input.cameraRuns[0], status: 'completed' as const, gate: { passed: true, checks: [] }, cameraVerification: { ...input.cameraRuns[0].cameraVerification!, boundedScenePassed: true } };
  const boundedHtml = renderProductionPortal({ ...input, cameraRuns: [bounded], mixedRuns: [bounded] });
  assert.ok(boundedHtml.includes('0 个通过 / 1 次真实研发终态尝试'));
  assert.ok(boundedHtml.includes('通过（不代表实机）'));
  assert.equal(boundedHtml.includes('完整需求已验收'), false);
});

test('portable portal escapes evidence, discloses static scope and never embeds generated source or Key forms', () => {
  const input = portalInput(); input.requirements = [{ ...PRODUCTION_DEMO_CASES[0], brief: '<script>alert("escape")</script>' }];
  const html = renderProductionPortal(input);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;escape&quot;)&lt;/script&gt;'));
  assert.equal(html.includes('<script>alert("escape")</script>'), false);
  assert.equal(html.includes('SOURCE_MUST_NOT_BE_EMBEDDED'), false);
  assert.ok(html.includes('静态交互演示 / 证据回放，非线上自主研发服务'));
  assert.ok(html.includes('index.html.txt')); assert.equal(html.includes('type="password"'), false);
  assert.equal(html.includes('fetch('), false); assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes('unknown')); assert.equal(html.includes('allow-same-origin'), false);
  assert.throws(() => renderProductionPortal({ ...input, sourceHref: 'javascript:alert(1)' }));
  assert.throws(() => renderProductionPortal({ ...input, previewBase: 'https://external.example/' }));
  assert.throws(() => renderProductionPortal({ ...input, requirements: [{ ...input.requirements[0], id: '../unsafe' }] }));
});

test('public interactive previews require explicit byte-verified fixture IDs; failed and empty states remain honest', () => {
  const input = portalInput(); input.trustedFixtureIds = [];
  input.runs[0].gate!.passed = false; input.runs[0].status = 'failed';
  const html = renderProductionPortal(input);
  assert.equal(html.includes('data-src="'), false); assert.ok(html.includes('最终行为 Gate：未通过'));
  assert.ok(html.includes('预览不可用。')); assert.ok(html.includes('2 / 3'));
  const empty = renderProductionPortal({ ...input, runs: [], requirements: [] });
  assert.ok(empty.includes('本材料包未提供需求快照')); assert.ok(empty.includes('0 / 0')); assert.ok(empty.includes('unknown'));
});

test('real Jev accounting retains failed and uncertain calls, excludes injected tests and never equates it with autonomous delivery', () => {
  const input = portalInput();
  const evaluation = (status: JevEvaluation['status'], count: number): JevEvaluation => ({ status, policyVersion: 'test-v2', selectedCandidateId: null, reason: `${status} evidence`, requestSnapshot: null, rawResponse: { reason: '<script>untrusted()</script>' }, scores: [], choice: null, usage: { inputTokens: count * 10, outputTokens: count, estimatedCost: count / 1e6, currency: 'USD', complete: true }, modelIdRequested: 'pinned-test', modelIdReturned: 'pinned-test', httpStatus: 200, providerRequests: 1, durationMs: 20 });
  const batch = { id: 'real-batch', evidenceSource: 'live-jev-evaluation', status: 'completed', policyVersion: 'test-v2', configHash: 'fixed', cases: ['accepted', 'error', 'uncertain'].map((status, index) => ({ id: `case-${index}`, title: 'synthetic candidate pool', attempted: true, status: 'completed', evaluation: evaluation(status as JevEvaluation['status'], index + 1) })), usage: {}, metrics: {}, error: null } as unknown as JevBenchmarkRun;
  input.jevBenchmarks = [batch, { ...batch, id: 'injected-batch', evidenceSource: 'injected-test' }];
  const html = renderProductionPortal(input);
  assert.ok(html.includes('0.000006000')); assert.ok(html.includes('60 输入 / 6 输出 Token'));
  assert.ok(html.includes('error evidence')); assert.ok(html.includes('uncertain evidence'));
  assert.equal((html.match(/class="decision"/g) ?? []).length, 3);
  assert.ok(html.includes('unknown')); assert.ok(html.includes('候选由人工固定构造，不是模型生成软件'));
  assert.equal(html.includes('<script>untrusted()</script>'), false);
  input.jevBenchmarks = [{ ...batch, cases: batch.cases.map((item, index) => index === 0 ? { ...item, evaluation: { ...item.evaluation!, usage: { ...item.evaluation!.usage, inputTokens: null, estimatedCost: null, complete: false } } } : item) }];
  assert.ok(renderProductionPortal(input).includes('unknown'));
  const intent = { ...evaluation('error', 0), durationMs: 0, providerRequests: 0, rawResponse: null, requestSnapshot: null, modelIdReturned: null, httpStatus: null, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD' as const, complete: false } };
  input.jevBenchmarks = [{ ...batch, cases: [{ ...batch.cases[0], evaluation: intent }] }];
  const unresolved = renderProductionPortal(input);
  assert.ok(unresolved.includes('未完成请求意图 / 未观测')); assert.ok(unresolved.includes('实际请求</dt><dd>unknown'));
  assert.ok(unresolved.includes('已知 0 次；1 个请求意图未观测，不记为 0'));
  input.jevBenchmarks = [{ ...batch, cases: [{ ...batch.cases[0], evaluation: { ...intent, error: 'preflight failed', usage: { ...intent.usage, inputTokens: 0, outputTokens: 0, estimatedCost: 0, complete: true } } }] }];
  const denied = renderProductionPortal(input); assert.ok(denied.includes('实际请求</dt><dd>0')); assert.equal(denied.includes('未完成请求意图 / 未观测'), false);
  input.jevBenchmarks = [{ ...batch, cases: [{ ...batch.cases[0], evaluationInvoked: true, evaluation: null }] }];
  const missingResponse = renderProductionPortal(input);
  assert.ok(missingResponse.includes('已登记开始评审，但没有取得响应记录'));
  assert.ok(missingResponse.includes('实际请求</dt><dd>unknown'));
  assert.ok(missingResponse.includes('已知 0 次；1 个请求意图未观测，不记为 0'));
  assert.equal(missingResponse.includes('真实 Jev 估算费用（USD）</p><strong>0.'), false);
});

test('actual Chromium public portal performs three trusted fixture interactions, keyboard selection and both themes without external calls', async () => {
  const input = portalInput();
  input.packageManifest.platformCommit = '891fedcab0f3c5994c7e92f7874e610b3b6354b8';
  input.packageManifest.files = [{ path: 'demo.webm' }, { path: 'demo.mp4' }, { path: 'REVIEWER-GUIDE.md' }, { path: 'SUBMISSION-REPORT.md' }];
  input.packageManifest.materialsVersion = 'production-materials-v3';
  const html = renderProductionPortal(input);
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const unexpected: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://portal.test' && url.pathname === '/production/') return route.fulfill({ contentType: 'text/html', body: html });
    const match = /^\/production\/previews\/(MOCK-0[123])\/index\.html$/.exec(url.pathname);
    if (url.origin === 'http://portal.test' && match) {
      const run = input.runs.find(item => item.input.requirement.id === match[1])!;
      const source = demoHtml(run.input).replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
      return route.fulfill({ contentType: 'text/html', body: source });
    }
    unexpected.push(route.request().url()); return route.abort();
  });
  try {
    await page.goto('http://portal.test/production/');
    assert.deepEqual(errors, []);
    assert.equal(await page.getByRole('heading', { name: '评委入口 · 下载、安装与自测' }).count(), 1);
    assert.equal(await page.getByRole('link', { name: '下载评委安装 / 自测指南' }).getAttribute('href'), './submission/REVIEWER-GUIDE.md');
    assert.equal(await page.getByRole('link', { name: '下载申报主稿', exact: true }).getAttribute('href'), './submission/SUBMISSION-REPORT.md');
    assert.equal(await page.locator('video source').first().getAttribute('type'), 'video/mp4');
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    let frame = page.frameLocator('iframe');
    await frame.locator('#task-input').fill('准备发布'); await frame.locator('#add-task').click();
    assert.equal(await frame.locator('#tasks li').count(), 1); await frame.locator('.toggle').click();
    assert.equal(await frame.locator('#done-count').innerText(), '1'); await frame.locator('.delete').click();
    assert.equal(await frame.locator('#count').innerText(), '0');
    const featureButton = page.getByRole('button', { name: /MOCK-02/ }); await featureButton.focus(); await page.keyboard.press('Enter');
    assert.equal(await featureButton.getAttribute('aria-pressed'), 'true'); assert.equal(new URL(page.url()).hash, '#case-MOCK-02');
    frame = page.frameLocator('iframe');
    for (const text of ['编写方案', '执行测试']) { await frame.locator('#task-input').fill(text); await frame.locator('#add-task').click(); }
    await frame.locator('.toggle').first().click(); await frame.locator('#show-open').click();
    assert.equal(await frame.locator('#tasks li span').innerText(), '执行测试'); await frame.locator('#show-done').click();
    assert.equal(await frame.locator('#tasks li span').innerText(), '编写方案'); await frame.locator('#show-all').click();
    assert.equal(await frame.locator('#tasks li').count(), 2); assert.equal(await frame.locator('#count').innerText(), '2');
    await page.getByRole('button', { name: /MOCK-03/ }).click(); frame = page.frameLocator('iframe');
    await frame.locator('#task-input').fill('   '); await frame.locator('#add-task').click(); assert.equal(await frame.locator('#tasks li').count(), 0);
    for (const text of ['回归接口', '检查日志']) { await frame.locator('#task-input').fill(text); await frame.locator('#add-task').click(); }
    await frame.locator('.delete').first().click(); assert.equal(await frame.locator('#tasks li span').innerText(), '检查日志');
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换浅色' }).click();
      for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${theme} ${width}`); }
    }
    await page.getByRole('button', { name: '关闭预览', exact: true }).click(); assert.equal(await page.locator('iframe').count(), 0);
    await page.getByRole('button', { name: '打开预览', exact: true }).click(); frame = page.frameLocator('iframe'); assert.equal(await frame.locator('#tasks li').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await context.close(); await browser.close(); }
});
