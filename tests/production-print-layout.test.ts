import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { PRODUCTION_LEDGER_PRINT_STYLE } from '../scripts/production-materials.js';

test('printed evidence tables wrap complete long IDs/hashes without changing short Mock layout or clipping text', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1060, height: 740 } });
  let requests = 0;
  await context.route('**/*', route => { requests++; return route.abort(); });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    const runId = '966fc3b9-1308-4e19-832f-ea4960fb07f2';
    const commit = 'f21256f8fe280b619c295ec17842fdc941b36545';
    await page.setContent(`<style>body{margin:0}table{width:100%;table-layout:fixed;border-collapse:collapse}td{padding:7px;border:1px solid;overflow-wrap:anywhere;font:10px/1.6 Arial}.case-table td:first-child{white-space:nowrap}.case-table td:nth-child(2),.case-table td:nth-child(6),.case-table td:nth-child(7){white-space:pre-line;word-break:keep-all;overflow-wrap:normal}${PRODUCTION_LEDGER_PRINT_STYLE}</style><table class="case-table ledger-table"><colgroup><col style="width:12%"><col style="width:17%"><col style="width:9%"><col style="width:6%"><col style="width:11%"><col style="width:8%"><col style="width:9%"><col style="width:28%"></colgroup><tr><td>HTML-08\n${runId}</td><td>${commit}\nproduction-html-grouped-v4</td><td>failed / not-reached</td><td>18</td><td>166317 / 13317</td><td>0.0658755</td><td>102991 ms / 2</td><td>Preserve every original byte in evidence; display wraps identifiers, never truncates or hides them.</td></tr></table><table class="case-table"><tr><td>MOCK-01</td><td>Create\nCompleted</td></tr></table>`);
    const cells = await page.locator('.ledger-table td').evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scroll: element.scrollWidth, whiteSpace: getComputedStyle(element).whiteSpace, overflowWrap: getComputedStyle(element).overflowWrap, overflow: getComputedStyle(element).overflow, text: element.textContent })));
    for (const cell of cells) { assert.ok(cell.scroll <= cell.width + 1, JSON.stringify(cell)); assert.equal(cell.whiteSpace, 'pre-line'); assert.equal(cell.overflowWrap, 'anywhere'); assert.equal(cell.overflow, 'visible'); }
    assert.equal(cells[0].text, 'HTML-08\n' + runId); assert.equal(cells[1].text, commit + '\nproduction-html-grouped-v4');
    assert.equal(await page.locator('table:not(.ledger-table) td').first().evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap');
    assert.equal(requests, 0);
    const exporter = readFileSync(new URL('../scripts/production-package.ts', import.meta.url), 'utf8');
    assert.ok(exporter.includes("headers.some(header => header.includes('运行ID'))"));
    assert.ok(exporter.includes("+ PRODUCTION_LEDGER_PRINT_STYLE"));
  } finally { await context.close(); await browser.close(); }
});
