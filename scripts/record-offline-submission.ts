import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright';

// Record the actual static browser workflow in a fresh context. Never read a Key,
// a server database, or a model endpoint, and never replace existing evidence.
const directory = path.resolve('output/submission-video/2026-10-07-offline-v1');
const origin = 'http://127.0.0.1:4176';
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory, { mode: 0o700 }); // EEXIST intentionally prevents overwrite.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: directory, size: { width: 1600, height: 1000 } } });
const forbiddenRequests: string[] = []; const pageErrors: string[] = [];
const allowedRequests: string[] = [];
await context.route('**/*', async route => {
  const request = route.request(); const url = new URL(request.url());
  const staticGet = url.origin === origin && ['GET', 'HEAD'].includes(request.method())
    && url.pathname.startsWith('/city-agent/') && !url.pathname.includes('/api/');
  if (!staticGet) {
    forbiddenRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort('blockedbyclient'); return;
  }
  allowedRequests.push(`${request.method()} ${url.pathname}`);
  await route.continue();
});
const recordingRequestedAt = Date.now();
const page = await context.newPage();
page.on('dialog', dialog => void dialog.accept());
page.on('pageerror', error => pageErrors.push(error.message));
await page.goto(`${origin}/city-agent/#research`);
await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).waitFor();
const started = Date.now();
const captionOffsetSeconds = (started - recordingRequestedAt) / 1000;
const captions: { at: number; text: string }[] = [];
const hold = async (untilSeconds: number) => {
  while (Date.now() - started < untilSeconds * 1000) {
    await page.waitForTimeout(Math.min(1000, untilSeconds * 1000 - (Date.now() - started)));
  }
};
const caption = async (text: string) => {
  captions.push({ at: (Date.now() - started) / 1000, text });
  await page.evaluate(text => {
    const host = document.querySelector('dialog[open]') ?? document.body;
    let label = document.getElementById('offline-version-label');
    if (!label) { label = document.createElement('div'); label.id = 'offline-version-label';
      label.style.cssText = 'position:fixed;z-index:2147483646;top:14px;right:24px;padding:7px 13px;background:#17343d;color:#fff;border-radius:6px;font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none;'; }
    host.append(label); label.textContent = 'CITY AGENT · 离线演示 2026-10-07 v1';
    let element = document.getElementById('offline-caption');
    if (!element) { element = document.createElement('div'); element.id = 'offline-caption';
      element.style.cssText = 'position:fixed;z-index:2147483646;bottom:18px;left:280px;right:24px;padding:15px 20px;background:rgba(13,45,48,.97);border-left:4px solid #80d0b4;color:#fff;border-radius:8px;font:20px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none;'; }
    host.append(element); element.textContent = text;
  }, text);
  console.log(`Chapter ${(Date.now() - started) / 1000}s: ${text}`);
};
const screenshot = async (name: string) => page.screenshot({ path: path.join(directory, name) });
const downloadProof = async (name: string, scope: ReturnType<Page['getByRole']>) => {
  const download = page.waitForEvent('download');
  await scope.getByRole('button', { name: '导出运行与跨题自证', exact: true }).click();
  await (await download).saveAs(path.join(directory, name));
};
const openTrace = async (scope: ReturnType<Page['getByRole']>) => {
  const trace = scope.locator('.survey-run-results > details').filter({ has: page.locator('summary').filter({ hasText: '回查画像、硬约束诊断与原始答卷' }) });
  if (await trace.getAttribute('open') === null) await trace.locator('summary').first().click();
  const individual = trace.locator('details').first();
  if (await individual.getAttribute('open') === null) await individual.locator('summary').click();
  await trace.scrollIntoViewIfNeeded();
};

await caption('City Agent｜离线申报演示：从人口来源、五层人群设定到完整问卷、原文与历史。现在实际操作浏览器，运行两套工程仿真；全程零模型调用、零API费用。');
await screenshot('01-research.png'); await hold(18);
await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /人口来源与方法/ }).click();
await caption('人口来源可回查官方原件与统计时点：2020七普503,859人、三个街道。年龄×性别联合显式采用独立性推断；家长与养宠资格另作情景设定，未知保持未知。');
await screenshot('02-population.png'); await hold(40);
await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /人群 Agent 预设/ }).click();
const resident = page.locator('.resident-grid .agent-card').filter({ has: page.getByRole('heading', { name: '一般成年居民', exact: true }) });
await resident.getByRole('button', { name: '编辑配置', exact: true }).click();
const builder = page.getByRole('region', { name: '五层人群情景构建' });
await builder.scrollIntoViewIfNeeded();
await builder.getByLabel('开放性情景档位', { exact: true }).selectOption('75');
await caption('五层人群支持可选与自定义：第一层是人格倾向参数，示意刻度明确标为情景假设。没有设定的字段保留null，参数与真实心理测量分开记录。');
await screenshot('03-personality.png'); await hold(60);
await builder.locator('summary').filter({ hasText: '第一层' }).click();
await builder.locator('summary').filter({ hasText: '第二层' }).click();
await builder.getByLabel(/^成长期间主要照护结构/).selectOption({ index: 1 });
await builder.getByRole('group', { name: '成长环境与迁居经历', exact: true }).getByRole('checkbox').first().check();
await builder.locator('summary').filter({ hasText: '第二层' }).scrollIntoViewIfNeeded();
await caption('第二层记录成长环境：主要照护结构可选，成长与迁居经历可多选，也能补充自定义说明。每项设定保留假设身份，便于后续回查和比较情景。');
await hold(70);
await builder.locator('summary').filter({ hasText: '第二层' }).click();
await builder.locator('summary').filter({ hasText: '第三层' }).click();
await builder.getByLabel(/^已完成的最高教育程度/).selectOption({ index: 1 });
await builder.locator('summary').filter({ hasText: '第三层' }).scrollIntoViewIfNeeded();
await caption('第三层独立记录已完成教育程度；第四层记录当前关系、居住组成与照护职责。背景字段与待研究的购买答案分开，方便检查问卷资格与信息缺口。');
await hold(78);
await builder.locator('summary').filter({ hasText: '第三层' }).click();
await builder.locator('summary').filter({ hasText: '第四层' }).click();
await builder.getByLabel(/^当前关系状态/).selectOption({ index: 1 });
await builder.getByRole('group', { name: '居住组成与照护职责', exact: true }).getByRole('checkbox').first().check();
await builder.locator('summary').filter({ hasText: '第四层' }).scrollIntoViewIfNeeded();
await hold(86);
await builder.locator('summary').filter({ hasText: '第四层' }).click();
await builder.locator('summary').filter({ hasText: '第五层' }).click();
await builder.getByLabel(/^当前主要就业\/学习状态/).selectOption({ index: 1 });
await builder.getByLabel(/^月收入口径（人民币，不是零食预算）/).selectOption({ index: 1 });
await builder.locator('summary').filter({ hasText: '第五层' }).scrollIntoViewIfNeeded();
await caption('第五层记录社会分工和收入口径。个人与家庭收入分别定义，区间可留空；收入与零食预算各有独立字段。这里演示编辑能力，完整业务问卷使用冻结的四份五层预设。');
await screenshot('04-work-income.png'); await hold(100);
await page.getByRole('dialog').getByLabel(/^Provider/).scrollIntoViewIfNeeded();
await caption('每个人群Agent均有独立Provider、Base URL、Model ID和Key配置。页面Key仅本次会话使用；此演示保留空Key，工程问卷运行不读取凭证。');
await screenshot('05-model-config.png'); await hold(115);
await page.getByRole('button', { name: '关闭人群配置', exact: true }).click();
await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /虚拟社会调查/ }).click();
await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
const panel = page.getByRole('region', { name: '完整业务工程自证' });
await panel.scrollIntoViewIfNeeded();
await panel.getByRole('button', { name: '运行完整业务自证 · 0 API费用', exact: true }).click();
await panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true }).waitFor();
await panel.locator('.survey-run-results h3').scrollIntoViewIfNeeded();
await caption('小学照护者场景：实际运行17题、四份五层情景、12个不同合成实例，结构12/12，模型与Token均0。成年人回答购买和许可；孩子本人具体口味保留未知。');
await screenshot('06-child-results.png'); await hold(142);
const childTaste = panel.locator('.survey-run-results > details').filter({ has: page.locator('summary').filter({ hasText: '孩子本人表达的具体口味' }) });
await childTaste.locator('summary').click(); await childTaste.scrollIntoViewIfNeeded();
await caption('原始答卷保留未知与不购买：孩子本人口味12份均为null；未知预算为null，明确不购买预算为0。逐题统计显示有效分母、缺失与选项计数，支持回查每个人的raw。');
await screenshot('07-child-unknown.png'); await hold(158);
await openTrace(panel);
await caption('证据链随运行冻结：人口版本、资格与五层假设、每人Prompt、原始JSON、结构及登记跨题规则、分组统计。导出保留完整原文，哈希用于检查字节和内容一致性。');
await screenshot('08-child-raw.png'); await hold(178);
await downloadProof('recorded-child-proof.json', panel);
await panel.getByLabel(/^完整业务问卷/).selectOption('pet-snacks');
await panel.getByRole('button', { name: '运行完整业务自证 · 0 API费用', exact: true }).click();
await panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true }).waitFor();
await panel.locator('.survey-run-results h3').scrollIntoViewIfNeeded();
await caption('宠物零食场景：实际运行18题、12个合成实例。猫犬资格、既往购买、每50克价位和线上履约分别提问，工程分支覆盖与滨江真实市场比例各自有清楚口径。');
await screenshot('09-pet-results.png'); await hold(204);
await openTrace(panel);
await caption('两套问卷均可逐人回查画像、Prompt和raw，并导出运行与跨题自证。12/12是规则工程验收；真实偏好、人格有效性和经营决策需要相应的独立证据。');
await screenshot('10-pet-raw.png'); await hold(225);
await downloadProof('recorded-pet-proof.json', panel);
const historyId = await panel.getByLabel(/^业务自证历史/).inputValue();
await page.reload();
await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
await panel.getByLabel(/^业务自证历史/).selectOption(historyId);
await panel.getByRole('button', { name: '导出运行与跨题自证', exact: true }).waitFor();
await panel.locator('.survey-run-results h3').scrollIntoViewIfNeeded();
await caption('刷新后恢复同一历史运行，继续使用当时冻结的答卷和逻辑规则。离线附件还保留历史12人×15题真实API快照与49次实验，均标明版本、调用和成本口径。');
await screenshot('11-restored-history.png'); await hold(244);
await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /虚拟社会调查/ }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await caption('City Agent｜用来源、假设、问卷和原文形成可追溯的研究前测。申报附件包含完整材料、两套工程自证、历史证据与字节清单，可从离线包中的index.html相对打开。');
await screenshot('12-final-research.png'); await hold(255);
if (forbiddenRequests.length || pageErrors.length) throw new Error(`离线录屏检查失败：${JSON.stringify({ forbiddenRequests, pageErrors })}`);
const workflowDurationSeconds = (Date.now() - started) / 1000;
const video = page.video()!;
await context.close();
await video.saveAs(path.join(directory, 'actual-browser.webm'));
await browser.close();
const mp4 = path.join(directory, 'demo-offline-v1.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(directory, 'actual-browser.webm'),
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4], { encoding: 'utf8' }));
const durationSeconds = Number(probe.format.duration);
if (durationSeconds < 180 || durationSeconds > 300 || probe.streams.some((stream: { codec_type: string }) => stream.codec_type !== 'video')) throw new Error('录屏时长或音轨不符合离线演示要求。');
const stamp = (value: number) => { const milliseconds = Math.round(value * 1000); return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`; };
await writeFile(path.join(directory, 'captions.json'), JSON.stringify({ version: '2026-10-07-offline-v1', actualBrowserRecording: true,
  realModelCalls: 0, requestedExternalOrWrites: forbiddenRequests, pageErrors, staticRequests: [...new Set(allowedRequests)],
  durationSeconds, workflowDurationSeconds, captionOffsetSeconds, audio: 'none-captioned', captions }, null, 2), { flag: 'wx' });
await writeFile(path.join(directory, 'demo-offline-v1.vtt'), 'WEBVTT\n\n' + captions.map((item, index) =>
  `${stamp(item.at + captionOffsetSeconds)} --> ${stamp(captions[index + 1] ? captions[index + 1].at + captionOffsetSeconds : durationSeconds)}\n${item.text}\n`).join('\n'), { flag: 'wx' });
const comparisons = [];
for (const [name, scenario] of [['recorded-child-proof.json', 'child-snacks'], ['recorded-pet-proof.json', 'pet-snacks']]) {
  const recorded = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
  const fixture = JSON.parse(await readFile(path.resolve(`public/submission-next/business-proof/${scenario}/survey-run.json`), 'utf8'));
  const matches = { task: recorded.run.taskHash === fixture.taskHash, population: recorded.run.populationHash === fixture.populationHash,
    profiles: recorded.run.profileHash === fixture.profileHash, raw: JSON.stringify(recorded.run.responses.map((item: { raw: unknown }) => item.raw)) === JSON.stringify(fixture.responses.map((item: { raw: unknown }) => item.raw)) };
  const zeroCalls = recorded.realModelCalls === 0 && recorded.run.metrics.modelCalls === 0 && recorded.run.metrics.inputTokens === 0 && recorded.run.metrics.outputTokens === 0 && recorded.run.metrics.apiCostCny === 0;
  if (Object.values(matches).some(value => !value) || !zeroCalls || recorded.run.metrics.valid !== 12 || recorded.logicAudit.passed !== 12) throw new Error(`录屏导出与冻结工程证据不一致：${name}`);
  comparisons.push({ name, scenario, runId: recorded.run.id, questions: recorded.run.task.questionnaire.questions.length,
    instances: recorded.run.profiles.length, rawResponses: recorded.run.responses.length, zeroCalls, matches, logicVerifier: recorded.logicAudit.verifierVersion });
}
const files = await Promise.all(['demo-offline-v1.mp4', 'demo-offline-v1.vtt', 'captions.json', 'recorded-child-proof.json', 'recorded-pet-proof.json'].map(async name => {
  const bytes = await readFile(path.join(directory, name));
  return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
await writeFile(path.join(directory, 'verification.json'), JSON.stringify({ version: '2026-10-07-offline-v1', actualBrowserRecording: true,
  durationSeconds, video: probe.streams.map(({ codec_name, codec_type, width, height, avg_frame_rate }: Record<string, unknown>) => ({ codec_name, codec_type, width, height, avg_frame_rate })),
  realModelCalls: 0, forbiddenRequests, pageErrors, comparisons, files }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ directory, durationSeconds, realModelCalls: 0, comparisons, files }, null, 2));
