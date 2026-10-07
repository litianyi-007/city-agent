import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseSurveyEvidence } from '../../src/run-history';

test('two complete business demos run locally without a key or model request and export frozen evidence', async ({ page }) => {
  const writes: string[] = []; const external: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(url.href); await route.abort(); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(url.pathname); await route.abort(); return; }
    await route.continue();
  });
  await page.goto('/#research');
  const title = await page.getByLabel('调查标题', { exact: true }).inputValue();
  await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
  const panel = page.getByRole('region', { name: '完整业务工程自证', exact: true });
  for (const [id, questionCount] of [['child-snacks', 17], ['pet-snacks', 18]] as const) {
    await panel.getByLabel('完整业务问卷').selectOption(id);
    await panel.getByRole('button', { name: '运行完整业务自证 · 0 API费用', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true })).toBeVisible();
    await expect(panel.getByRole('status')).toContainText('未读取 Key、未调用模型');
    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出运行与跨题自证', exact: true }).click();
    const download = await downloadPromise; const file = await download.path();
    expect(file).not.toBeNull();
    const proof = JSON.parse(await readFile(file!, 'utf8'));
    const run = parseSurveyEvidence(proof.run);
    expect(run.mode).toBe('fixture'); expect(run.metrics.modelCalls).toBe(0);
    expect(run.metrics.apiCostCny).toBe(0); expect(run.task.questionnaire.questions).toHaveLength(questionCount);
    expect(run.presetSnapshots).toHaveLength(4); expect(proof.logicAudit.passed).toBe(12);
    expect(proof.logicAudit.failed).toBe(0); expect(run.parameters?.fixturePolicyId).toBe('business-consistent-synthetic-v1');
    expect(run.profiles.every(profile => profile.persona?.provenance === 'assumption')).toBe(true);
    const diagnostics = panel.getByRole('region', { name: '研究内容与执行状态诊断', exact: true });
    await expect(diagnostics).toContainText('计划 12 个合成个人；已检查 12、未启动 0、结构阻断 0、未知 0');
    await expect(diagnostics).toContainText('合法未知不会被强行补成偏好');
    const diagnosticDownload = page.waitForEvent('download');
    await diagnostics.getByRole('button', { name: '导出独立研究诊断 · 不修改原证据', exact: true }).click();
    const diagnosticFile = await (await diagnosticDownload).path();
    const diagnosticReport = JSON.parse(await readFile(diagnosticFile!, 'utf8'));
    expect(diagnosticReport.version).toBe('research-diagnostics-1.0');
    expect(diagnosticReport.sourceRunId).toBe(run.id);
    expect(diagnosticReport.planned).toBe(12); expect(diagnosticReport.summary.checked).toBe(12);
    expect(diagnosticReport.marketResearchValidated).toBe(false);
  }
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue(title);
  expect(writes).toEqual([]); expect(external).toEqual([]); expect(errors).toEqual([]);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('city-agent-business-proof-v1', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('proofs', 'readwrite');
      tx.objectStore('proofs').add({ run: { id: '00000000-0000-4000-8000-000000000009' }, note: 'synthetic malformed historical record' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(new Error('synthetic history injection failed')); };
    };
    request.onerror = () => reject(new Error('synthetic history db unavailable'));
  }));
  await page.reload();
  await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
  await expect(panel.getByLabel('业务自证历史').locator('option')).toHaveCount(3);
  await expect(panel.getByRole('status')).toContainText('隔离1条旧版或不一致记录');
  const historicalId = await panel.getByLabel('业务自证历史').locator('option').nth(1).getAttribute('value');
  await panel.getByLabel('业务自证历史').selectOption(historicalId!);
  await expect(panel.getByRole('heading', { name: '工程演示结果 · 规则答卷 · 12/12 有效', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '导出运行与跨题自证', exact: true })).toBeEnabled();
  await expect(panel.getByRole('region', { name: '研究内容与执行状态诊断', exact: true })).toContainText('计划 12 个合成个人');
});

test('applying a complete example requires draft confirmation, creates four keyless presets, and never runs a survey', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.goto('/#research');
  await page.getByLabel('调查标题', { exact: true }).fill('评委未保存的原草稿');
  await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
  const panel = page.getByRole('region', { name: '完整业务工程自证', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await panel.getByRole('button', { name: '应用问卷与五层预设 · 不启动调查', exact: true }).click();
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue('评委未保存的原草稿');
  expect(writes).toEqual([]);
  page.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: '应用问卷与五层预设 · 不启动调查', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('尚未保存或启动调查');
  await expect(page.getByRole('heading', { name: '03 · 问卷 · 17 题', exact: true })).toBeVisible();
  expect(writes).toEqual(Array(4).fill('/api/research/resident-agents'));
  const residents = await (await page.request.get('/api/research/resident-agents')).json();
  const applied = residents.filter((resident: { modelId: string }) => resident.modelId === 'fixture-no-model');
  expect(applied).toHaveLength(4);
  expect(applied.every((resident: { hasApiKey: boolean; persona: { provenance: string } }) => !resident.hasApiKey && resident.persona.provenance === 'assumption')).toBe(true);
});

test('a partial preset write failure keeps the old draft and explicitly reports already-created presets', async ({ page }) => {
  let created = 0;
  await page.route('**/api/research/resident-agents', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    created += 1;
    if (created === 3) await route.fulfill({ status: 400, json: { error: 'synthetic write failure' } });
    else await route.continue();
  });
  await page.goto('/#research');
  const original = await page.getByLabel('调查标题', { exact: true }).inputValue();
  await page.getByRole('button', { name: '完整业务示例 · 零费用体验', exact: true }).click();
  const panel = page.getByRole('region', { name: '完整业务工程自证', exact: true });
  await panel.getByRole('button', { name: '应用问卷与五层预设 · 不启动调查', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('已新增2份无 Key 预设');
  await expect(page.getByLabel('调查标题', { exact: true })).toHaveValue(original);
  expect(created).toBe(3);
});
