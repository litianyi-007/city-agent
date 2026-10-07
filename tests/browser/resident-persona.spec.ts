import { test, expect, type Locator } from '@playwright/test';
import { createDefaultPersona } from '../../shared/resident-persona';
import type { ResidentAgentPublic } from '../../server/research/residents';

test.use({ actionTimeout: 15_000 });

async function openLayer(dialog: Locator, layer: string) {
  const details = dialog.locator('details.persona-layer').filter({ hasText: layer });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

test('five-layer custom resident saves, refreshes and clones through real local API without model requests or public keys', async ({ page, request }) => {
  const name = '五层浏览器验收 · 自定义居民';
  const privateKey = 'browser-persona-fixture-not-a-real-api-key';
  const original = await (await request.get('/api/research/resident-agents')).json() as ResidentAgentPublic[];
  const originalFour = original.filter(agent => ['一般成年居民', '小学生照护者', '养猫家庭购买者', '养犬家庭购买者'].includes(agent.name));
  expect(originalFour).toHaveLength(4);
  for (const preset of originalFour) expect(preset.persona).toEqual(createDefaultPersona());
  const beforeRuns = await (await request.get('/api/runs')).json();
  const beforeSurveys = await (await request.get('/api/research/surveys')).json();
  const forbiddenRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', outgoing => {
    const url = new URL(outgoing.url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) forbiddenRequests.push(outgoing.url());
    if (outgoing.method() === 'POST' && ['/api/runs', '/api/research/planning', '/api/research/surveys'].includes(url.pathname)) forbiddenRequests.push(outgoing.url());
  });
  await page.goto('/#residents');
  await page.getByRole('button', { name: '＋ 新建人群 Agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '人群模板', exact: true }).selectOption('custom');
  await dialog.getByLabel('预设名称', { exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: '画像说明', exact: true }).fill('五层情景浏览器验收；不是滨江真人或消费偏好证据。');
  for (const trait of ['开放性', '尽责性', '外向性', '宜人性', '情绪稳定性']) {
    await expect(dialog.getByRole('spinbutton', { name: new RegExp(`^${trait}`) })).toHaveValue('');
    await expect(dialog.getByRole('combobox', { name: `${trait}情景档位`, exact: true })).toHaveValue('unknown');
  }
  await dialog.getByRole('combobox', { name: '开放性情景档位', exact: true }).selectOption('75');
  await expect(dialog.getByRole('spinbutton', { name: /^开放性/ })).toHaveValue('75');
  await dialog.getByRole('spinbutton', { name: /^开放性/ }).fill('72');
  await expect(dialog.getByRole('combobox', { name: '开放性情景档位', exact: true })).toHaveValue('custom');
  await dialog.getByRole('combobox', { name: '情绪稳定性情景档位', exact: true }).selectOption('25');
  await expect(dialog.getByRole('spinbutton', { name: /^情绪稳定性/ })).toHaveValue('25');
  await dialog.getByRole('combobox', { name: '情绪稳定性情景档位', exact: true }).selectOption('unknown');
  await expect(dialog.getByRole('spinbutton', { name: /^情绪稳定性/ })).toHaveValue('');
  await dialog.getByRole('spinbutton', { name: /^尽责性/ }).fill('61');
  await dialog.getByRole('button', { name: '＋ 添加自定义人格倾向', exact: true }).click();
  await dialog.getByLabel('自定义人格倾向名称 1', { exact: true }).fill('求证习惯');
  await dialog.getByRole('textbox', { name: '自定义人格倾向说明 1', exact: true }).fill('先询问信息来源，不预填对商品或售价的接受程度。');

  await openLayer(dialog, '第二层');
  await dialog.getByRole('combobox', { name: '成长期间主要照护结构', exact: true }).selectOption('two-caregivers');
  await dialog.getByRole('checkbox', { name: '成长期间迁居', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '扩展家庭共同照护', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '乡村生活经历', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '城市生活经历', exact: true }).check();
  await openLayer(dialog, '第三层');
  await dialog.getByRole('combobox', { name: '已完成的最高教育程度', exact: true }).selectOption('bachelor');
  await dialog.getByLabel('教育补充说明（可选）', { exact: true }).fill('学历是情景设定，不推断收入或购买答案。');
  await openLayer(dialog, '第四层');
  await dialog.getByRole('combobox', { name: '当前关系状态', exact: true }).selectOption('single');
  await dialog.getByRole('checkbox', { name: '与父母同住', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '承担照护角色（不要求同住）', exact: true }).check();
  await openLayer(dialog, '第五层');
  await dialog.getByRole('combobox', { name: '当前主要就业/学习状态', exact: true }).selectOption('employed');
  await dialog.getByLabel('职业或分工说明（可选）', { exact: true }).fill('情景中的信息服务从业者');
  await dialog.getByRole('checkbox', { name: '员工', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '志愿者', exact: true }).check();
  await dialog.getByRole('combobox', { name: '月收入口径（人民币，不是零食预算）', exact: true }).selectOption('personal-gross');
  await dialog.getByLabel('月收入下界（元，留空未知）', { exact: true }).fill('5000');
  await dialog.getByLabel('月收入上界（元，留空未知）', { exact: true }).fill('9000');
  await dialog.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai-compatible');
  await dialog.getByLabel('Base URL', { exact: true }).fill('http://127.0.0.1:39998/v1');
  await dialog.getByLabel('Model ID', { exact: true }).fill('persona-browser-fixture-model');
  await dialog.getByLabel('API Key', { exact: true }).fill(privateKey);
  await dialog.getByRole('button', { name: '保存人群预设', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const savedResponse = await request.get('/api/research/resident-agents');
  const savedBody = await savedResponse.text();
  expect(savedBody).not.toContain(privateKey);
  const saved = (JSON.parse(savedBody) as ResidentAgentPublic[]).find(agent => agent.name === name)!;
  expect(saved.hasApiKey).toBe(true);
  expect(saved.persona?.provenance).toBe('assumption');
  expect(saved.persona?.personality.openness).toBe(72);
  expect(saved.persona?.personality.extraversion).toBeNull();
  expect(saved.persona?.personality.customTraits[0].label).toBe('求证习惯');
  expect(saved.persona?.upbringing.experiences).toEqual(['relocated', 'extended-family', 'rural', 'urban']);
  expect(saved.persona?.household.relationship).toBe('single');
  expect(saved.persona?.household.livingRoles).toEqual(['with-parents', 'caregiver']);
  expect(saved.persona?.work.income).toEqual({ currency: 'CNY', period: 'month', basis: 'personal-gross', lower: 5000, upper: 9000 });

  await page.reload();
  const card = page.locator('.resident-grid .agent-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: '编辑配置', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: /^开放性/ })).toHaveValue('72');
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('自定义人格倾向名称 1', { exact: true })).toHaveValue('求证习惯');
  await dialog.getByRole('button', { name: '关闭人群配置', exact: true }).click();
  await card.getByRole('button', { name: `复制人群 ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} 副本`, exact: true })).toBeVisible();
  const after = await (await request.get('/api/research/resident-agents')).json() as ResidentAgentPublic[];
  const copy = after.find(agent => agent.name === `${name} 副本`)!;
  expect(copy.id).not.toBe(saved.id);
  expect(copy.persona).toEqual(saved.persona);
  expect(copy.hasApiKey).toBe(true);
  expect(JSON.stringify(after)).not.toContain(privateKey);
  expect(after.filter(agent => originalFour.some(originalAgent => originalAgent.id === agent.id))).toEqual(originalFour);
  expect(await (await request.get('/api/runs')).json()).toEqual(beforeRuns);
  expect(await (await request.get('/api/research/surveys')).json()).toEqual(beforeSurveys);
  expect(forbiddenRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('persona UI and actual local API reject contradictory living/income settings without saving or launching models', async ({ page, request }) => {
  const name = '五层无效设置不应保存';
  const before = await (await request.get('/api/research/resident-agents')).json() as ResidentAgentPublic[];
  let postCount = 0;
  page.on('request', outgoing => { if (outgoing.method() === 'POST') postCount++; });
  await page.goto('/#residents');
  await page.getByRole('button', { name: '＋ 新建人群 Agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '人群模板', exact: true }).selectOption('custom');
  await dialog.getByLabel('预设名称', { exact: true }).fill(name);
  await openLayer(dialog, '第四层');
  await dialog.getByRole('checkbox', { name: '独居', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '与父母同住', exact: true }).check();
  await dialog.getByRole('button', { name: '保存人群预设', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('独居与明确共同居住项目互斥');
  expect(postCount).toBe(0);
  await dialog.getByRole('checkbox', { name: '与父母同住', exact: true }).uncheck();
  await openLayer(dialog, '第五层');
  await dialog.getByLabel('月收入下界（元，留空未知）', { exact: true }).fill('1000');
  await dialog.getByRole('button', { name: '保存人群预设', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('设置收入范围时必须明确个人税前或家庭可支配口径');
  expect(postCount).toBe(0);
  expect(await (await request.get('/api/research/resident-agents')).json()).toEqual(before);
  const templates = await (await request.get('/api/research/resident-templates')).json();
  const invalidPersona = createDefaultPersona();
  invalidPersona.household.livingRoles = ['living-alone', 'with-parents'];
  expect((await request.post('/api/research/resident-agents', { data: { ...templates[0], name, persona: invalidPersona } })).status()).toBe(400);
  invalidPersona.household.livingRoles = [];
  invalidPersona.work.income.lower = 1000;
  expect((await request.post('/api/research/resident-agents', { data: { ...templates[0], name, persona: invalidPersona } })).status()).toBe(400);
  expect(await (await request.get('/api/research/resident-agents')).json()).toEqual(before);
});

for (const width of [375, 390]) test(`five-layer dialog fits ${width}px viewport and leaves legacy presets unchanged`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const before = await (await request.get('/api/research/resident-agents')).json();
  await page.goto('/#residents');
  await page.getByRole('button', { name: '＋ 新建人群 Agent', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '新建人群 Agent', exact: true })).toBeVisible();
  for (const layer of ['第二层', '第三层', '第四层', '第五层']) await openLayer(dialog, layer);
  await dialog.getByRole('button', { name: '＋ 添加自定义人格倾向', exact: true }).click();
  await dialog.getByLabel('自定义人格倾向名称 1', { exact: true }).fill('移动端情景字段');
  await dialog.getByRole('textbox', { name: '自定义人格倾向说明 1', exact: true }).fill('验证多层展开后的宽度，不进行模型或数据推断。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  // A whole tall element screenshot would capture content clipped outside the
  // modal. Record real viewport views of the scrollable dialog instead.
  await page.screenshot({ path: `output/ui-validation/persona-dialog-${width}.png` });
  await dialog.getByRole('heading', { name: '五层人群构建 · 可选情景设定', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/ui-validation/persona-personality-${width}.png` });
  await dialog.getByRole('combobox', { name: '月收入口径（人民币，不是零食预算）', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/ui-validation/persona-income-${width}.png` });
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: '关闭人群配置', exact: true }).click();
  expect(await (await request.get('/api/research/resident-agents')).json()).toEqual(before);
});
