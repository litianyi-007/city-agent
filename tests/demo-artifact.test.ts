import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { simulateSurvey } from '../server/city.js';
import { buildDemoHtml, DEMO_ACCEPTANCE } from '../server/demo-artifact.js';
import { runGate } from '../server/gate.js';

test('offline artifact safely renders untrusted product/task text and responds to prices', async () => {
  const malicious = '</script><script>window.injected = true</script><img src=x onerror="window.injected=true">';
  const survey = simulateSurvey({ product: malicious, price: 29, sampleSize: 60, seed: 42 });
  const html = buildDemoHtml(survey, malicious);
  assert.equal(html.includes(malicious), false);
  assert.equal(DEMO_ACCEPTANCE.length, 2);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(html);
    assert.equal(await page.locator('h1').textContent(), malicious);
    assert.equal(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected), undefined);
    assert.equal(await page.locator('#population').textContent(), '503,859');
    assert.equal(await page.locator('.street-row').count(), 3);
    assert.match((await page.locator('#disclaimer').textContent())!, /模拟/);
    const rates: number[] = [];
    for (const price of ['0', '29', '90', '999']) {
      await page.locator('#price').fill(price);
      await page.locator('#simulate').click();
      rates.push(parseFloat((await page.locator('#acceptance').textContent())!));
    }
    assert.ok(rates[0] > rates[1] && rates[1] > rates[2] && rates[2] > rates[3]);
    assert.equal(rates[3], 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('maximum sample artifact fits the gate and changes under the opaque browser sandbox', async () => {
  const survey = simulateSurvey({ product: 'AI 生活服务会员', price: 100000, sampleSize: 600, seed: 42 });
  const html = buildDemoHtml(survey, '研究报价变化对模拟接受度的影响');
  assert.ok(Buffer.byteLength(html, 'utf8') <= 500000);
  const gate = await runGate(html, DEMO_ACCEPTANCE);
  assert.equal(gate.passed, true, JSON.stringify(gate));
});
