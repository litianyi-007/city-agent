import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Locator } from 'playwright';
import { expect } from '@playwright/test';

// Engineering-only verification of the existing Pages build. No app backend,
// real provider, private configuration, or persistent resident DB is opened.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = await realpath(path.join(root, 'dist-pages'));
const base = '/city-agent/';
const origin = 'http://127.0.0.1:4182';
const output = path.join(root, 'output/ui-validation');
const canary = 'pages-persona-fixture-not-a-real-api-key';
const name = 'Pages五层工程验收居民';
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
    if (!pathname.startsWith(base) || pathname.includes('\0')) { response.writeHead(404); response.end(); return; }
    const relative = pathname.slice(base.length);
    let target = path.resolve(dist, relative || 'index.html');
    if (target !== dist && !target.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return; }
    try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
    catch { if (!path.extname(relative)) target = path.join(dist, 'index.html'); else throw new Error('missing'); }
    target = await realpath(target);
    if (!target.startsWith(dist + path.sep)) { response.writeHead(404); response.end(); return; }
    const data = await readFile(target);
    response.writeHead(200, { 'content-type': mime[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404); response.end(); }
});

async function openLayer(dialog: Locator, layer: string) {
  const details = dialog.locator('details.persona-layer').filter({ hasText: layer });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}
async function readJson(file: string) { return JSON.parse(await readFile(file, 'utf8')); }

let browser: Browser | undefined;
let listening = false;
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 4182, exclusive: true }, () => { listening = true; resolve(); });
  });
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  const forbidden: string[] = [];
  const errors: string[] = [];
  let freshModelCalls = 0;
  // The allowlist is deliberately the one dedicated static origin and base.
  // Even accidental local /api calls or configured model calls are blocked.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) { await route.continue(); return; }
    if (url.origin === origin && url.pathname.startsWith(base) && request.method() === 'GET') { await route.continue(); return; }
    forbidden.push(`${request.method()} ${url.origin}${url.pathname}`);
    if (request.method() !== 'GET' || /chat|messages|planning|surveys|runs/.test(url.pathname)) freshModelCalls++;
    await route.abort('blockedbyclient');
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => void dialog.accept());
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${origin}${base}#residents`);
  await page.getByRole('button', { name: '＋ 新建人群 Agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '人群模板', exact: true }).selectOption('custom');
  await dialog.getByLabel('预设名称', { exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: '画像说明', exact: true }).fill('独立Pages工程验收情景；不代表真人和商品偏好。');
  for (const trait of ['开放性', '尽责性', '外向性', '宜人性', '情绪稳定性']) {
    await expect(dialog.getByRole('spinbutton', { name: new RegExp(`^${trait}`) })).toHaveValue('');
  }
  await dialog.getByRole('combobox', { name: '开放性情景档位', exact: true }).selectOption('75');
  await dialog.getByRole('button', { name: '＋ 添加自定义人格倾向', exact: true }).click();
  await dialog.getByLabel('自定义人格倾向名称 1', { exact: true }).fill('追问来源');
  await dialog.getByRole('textbox', { name: '自定义人格倾向说明 1', exact: true }).fill('仅情景设定，不预填购买答案。');
  await openLayer(dialog, '第二层');
  await dialog.getByRole('combobox', { name: '成长期间主要照护结构', exact: true }).selectOption('two-caregivers');
  await dialog.getByRole('checkbox', { name: '成长期间迁居', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '扩展家庭共同照护', exact: true }).check();
  await openLayer(dialog, '第三层');
  await dialog.getByRole('combobox', { name: '已完成的最高教育程度', exact: true }).selectOption('bachelor');
  await openLayer(dialog, '第四层');
  await dialog.getByRole('combobox', { name: '当前关系状态', exact: true }).selectOption('single');
  await dialog.getByRole('checkbox', { name: '与父母同住', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '承担照护角色（不要求同住）', exact: true }).check();
  await openLayer(dialog, '第五层');
  await dialog.getByRole('combobox', { name: '当前主要就业/学习状态', exact: true }).selectOption('employed');
  await dialog.getByLabel('职业或分工说明（可选）', { exact: true }).fill('信息服务情景角色');
  await dialog.getByRole('checkbox', { name: '员工', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '志愿者', exact: true }).check();
  await dialog.getByRole('combobox', { name: '月收入口径（人民币，不是零食预算）', exact: true }).selectOption('personal-gross');
  await dialog.getByLabel('月收入下界（元，留空未知）', { exact: true }).fill('5000');
  await dialog.getByLabel('月收入上界（元，留空未知）', { exact: true }).fill('9000');
  await dialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compatible');
  await dialog.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:39998/v1');
  await dialog.getByLabel('Model ID', { exact: true }).fill('pages-engineering-fixture');
  await dialog.getByLabel('API Key', { exact: true }).fill(canary);
  await dialog.getByRole('button', { name: '保存人群预设', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const storedBefore = await page.evaluate(() => localStorage.getItem('city-agent-pages-v1:residents'));
  assert.ok(storedBefore && !storedBefore.includes(canary));
  const saved = JSON.parse(storedBefore).find((agent: { name: string }) => agent.name === name);
  assert.equal(saved.persona.personality.openness, 75);
  assert.equal(saved.persona.provenance, 'assumption');
  assert.deepEqual(saved.persona.upbringing.experiences, ['relocated', 'extended-family']);
  assert.equal(saved.persona.education.level, 'bachelor');
  assert.deepEqual(saved.persona.household.livingRoles, ['with-parents', 'caregiver']);
  assert.equal(saved.persona.work.income.basis, 'personal-gross');
  await page.reload();
  const card = page.locator('.resident-grid .agent-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: '编辑配置', exact: true }).click();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('spinbutton', { name: /^开放性/ })).toHaveValue('75');
  await expect(dialog.getByLabel('自定义人格倾向名称 1', { exact: true })).toHaveValue('追问来源');
  await page.setViewportSize({ width: 375, height: 844 });
  for (const layer of ['第二层', '第三层', '第四层', '第五层']) await openLayer(dialog, layer);
  await dialog.getByRole('heading', { name: '五层人群构建 · 可选情景设定', exact: true }).scrollIntoViewIfNeeded();
  const dialogOverflow = await dialog.evaluate(element => element.scrollWidth - element.clientWidth);
  assert.ok(dialogOverflow <= 1, `Dialog overflow ${dialogOverflow}px`);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 375);
  await page.screenshot({ path: path.join(output, 'pages-next-persona-375.png') });
  await dialog.getByRole('button', { name: '关闭人群配置', exact: true }).click();
  await card.getByRole('button', { name: `复制人群 ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} 副本`, exact: true })).toBeVisible();
  const storedAfter = await page.evaluate(() => localStorage.getItem('city-agent-pages-v1:residents'));
  assert.ok(storedAfter && !storedAfter.includes(canary));
  const agents = JSON.parse(storedAfter);
  const copy = agents.find((agent: { name: string }) => agent.name === `${name} 副本`);
  assert.deepEqual(copy.persona, saved.persona);
  assert.notEqual(copy.id, saved.id);
  assert.equal(copy.hasApiKey, false);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /虚拟社会调查/ }).click();
  await page.getByRole('button', { name: '检查业务证据包', exact: true }).click();
  const business = page.getByRole('region', { name: '业务证据包预检', exact: true });
  await business.getByRole('button', { name: '检查业务证据包 · 不调用模型', exact: true }).click();
  await expect(business.getByRole('heading', { name: '业务证据仍有缺口', exact: true })).toBeVisible();
  const audit = JSON.parse(await business.locator('.evidence-audit-json').innerText());
  assert.equal(audit.status, 'needs-data');
  await page.getByRole('button', { name: '从自然语言规划调查', exact: true }).click();
  const planning = page.getByRole('region', { name: '自然语言研究规划', exact: true });
  await expect(planning).toContainText('当前GitHub Pages不运行Harness规划服务');
  assert.equal(await planning.getByRole('button').count(), 0);
  const guideLink = planning.getByRole('link', { name: '查看本机复现方式 ↗', exact: true });
  assert.equal(await guideLink.getAttribute('href'), `${base}review-guide.html`);
  const guide = await context.newPage();
  const guideResponse = await guide.goto(`${origin}${base}review-guide.html`);
  assert.equal(guideResponse?.status(), 200);
  await expect(guide.getByRole('heading', { name: /评委/ }).first()).toBeVisible();
  await guide.close();
  const proofDir = path.join(root, 'output/persona-proof');
  const proofFiles = (await readdir(proofDir)).map(id => path.join(proofDir, id, 'survey-run.json'));
  const proofs = await Promise.all(proofFiles.map(async file => ({ file, run: await readJson(file) })));
  const proof = proofs.find(value => value.run.mode === 'fixture' && value.run.profiles.length === 12 && value.run.task.questionnaire.questions.length === 16);
  assert.ok(proof, 'A real existing 12-profile/16-question persona fixture is required');
  const panel = page.getByRole('region', { name: '问卷仿真与结果', exact: true });
  const imports: { mode: string; version: string; profiles: number; questions: number; valid: number; planned: number; archivedModelCalls: number }[] = [];
  for (const file of [path.join(root, 'public/submission/live-run.json'), proof.file]) {
    const source = await readJson(file);
    await panel.getByLabel('导入运行证据', { exact: true }).setInputFiles(file);
    const prefix = source.mode === 'fixture' ? '工程演示结果 · 规则答卷' : '模型仿真结果';
    await expect(panel.getByRole('heading', { name: `${prefix} · ${source.metrics.valid}/${source.metrics.planned} 有效`, exact: true })).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出运行证据包', exact: true }).click();
    const download = await downloadEvent;
    const exportFile = path.join(output, `pages-next-import-${source.mode}.json`);
    await download.saveAs(exportFile);
    const exported = await readJson(exportFile);
    assert.equal(exported.id, source.id);
    assert.equal(exported.version, source.version);
    assert.equal(exported.mode, source.mode);
    assert.deepEqual(exported.metrics, source.metrics);
    assert.deepEqual(exported.profiles, source.profiles);
    assert.ok(!JSON.stringify(exported).includes(canary));
    imports.push({ mode: source.mode, version: source.version, profiles: source.profiles.length, questions: source.task.questionnaire.questions.length, valid: source.metrics.valid, planned: source.metrics.planned, archivedModelCalls: source.metrics.modelCalls });
  }
  await panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'pages-next-result-375.png') });
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(pageOverflow <= 1, `Pages overflow ${pageOverflow}px`);
  assert.deepEqual(forbidden, []);
  assert.deepEqual(errors, []);
  assert.equal(freshModelCalls, 0);
  const summary = { status: 'passed', source: 'actual dist-pages at isolated localhost:4182/city-agent/', personaSavedReloadedCloned: true, sessionKeyPersisted: false, businessStatus: audit.status, planning: 'local-harness-required; no request', guideHttpStatus: 200, imports, freshModelCalls, forbiddenRequests: forbidden.length, pageErrors: errors.length, pageOverflowPx: pageOverflow, dialogOverflowPx: dialogOverflow, browser: 'local macOS Chromium; other OS not exercised' };
  await writeFile(path.join(output, 'pages-next-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally {
  await browser?.close();
  if (listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
