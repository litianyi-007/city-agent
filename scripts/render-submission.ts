import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const output = path.resolve('output/pdf'); mkdirSync(output, { recursive: true });
const target = path.join(output, 'city-agent-project-materials.pdf');
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/city-agent/submission/index.html');
await page.evaluate(() => {
  const base = document.createElement('base'); base.href = 'https://litianyi-007.github.io/city-agent/submission/'; document.head.prepend(base);
});
await page.pdf({ path: target, format: 'A4', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>', footerTemplate: '<div style="font:9px Arial;width:100%;text-align:center;color:#637888">CITY AGENT · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
copyFileSync(target, path.resolve('public/submission/project-materials.pdf'));
await browser.close(); console.log(target);
