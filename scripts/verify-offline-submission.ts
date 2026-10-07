import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { assertPublicText } from '../shared/publishing-contract';

// Read-only verification of the new offline payload; a separate QA receipt only.
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--submission-v2')) throw new Error('仅支持固定v1或--submission-v2');
const id = args.includes('--submission-v2') ? '2026-10-07-offline-v2' : '2026-10-07-offline-v1';
const dir = path.join(root, 'output/submission-offline', id);
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
const files: string[] = [];
async function walk(folder: string) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error('离线包不能含符号链接');
    if (entry.isDirectory()) await walk(filename); else files.push(path.relative(dir, filename));
  }
}
await walk(dir);
if (files.length !== manifest.files.length + 1 || files.some(name => name !== 'manifest.json' && !manifest.files.some((f: any) => f.name === name))) throw new Error('包内文件未登记');
for (const f of manifest.files) {
  const bytes = await readFile(path.join(dir, f.name));
  if (bytes.length !== f.bytes || sha(bytes) !== f.sha256) throw new Error('离线字节不符：' + f.name);
  if (/\.(json|txt|md|html|vtt)$/.test(f.name)) assertPublicText(f.name, bytes.toString('utf8'));
  if (f.name.endsWith('.pdf')) assertPublicText(f.name + '.txt', execFileSync('pdftotext', [path.join(dir, f.name), '-'], { encoding: 'utf8' }));
}
for (const source of manifest.sources) if (sha(await readFile(path.join(root, source.source))) !== source.sha256) throw new Error('原件发生变化：' + source.source);
const index = await readFile(path.join(dir, 'index.html'), 'utf8');
const references = [...index.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
const local = references.filter(ref => !/^(?:https?:|data:|#)/.test(ref));
for (const ref of local) {
  const resolved = path.resolve(dir, ref);
  if (!resolved.startsWith(dir + path.sep) || !(await lstat(resolved)).isFile()) throw new Error('离线链接无效：' + ref);
}
const browser = await chromium.launch(); const blocked: string[] = []; const errors: string[] = [];
let video: any; let width: any;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (!route.request().url().startsWith('file://')) { blocked.push(route.request().url()); await route.abort(); return; }
    await route.continue();
  });
  await page.goto('file://' + path.join(dir, 'index.html'));
  const element = page.locator('video'); await element.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1);
  video = await element.evaluate(async node => {
    const v = node as HTMLVideoElement;
    await v.play(); await new Promise(resolve => setTimeout(resolve, 300));
    const data = { duration: v.duration, readyState: v.readyState, videoWidth: v.videoWidth, videoHeight: v.videoHeight, currentTime: v.currentTime, paused: v.paused, error: v.error?.message ?? null };
    v.pause(); return data;
  });
  await page.setViewportSize({ width: 375, height: 812 });
  width = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  if (width.document > width.viewport || video.paused || video.currentTime <= 0 || video.duration < 180 || video.duration > 300 || video.error || blocked.length || errors.length) throw new Error('离线播放/响应式/无网络检查不符：' + JSON.stringify({ video, width, blocked, errors }));
} finally { await browser.close(); }
const receipt = { schemaVersion: 'offline-submission-qa-1.0', checkedAt: new Date().toISOString(),
  filesVerified: manifest.files.length, originalSourcesUnchanged: manifest.sources.length, localLinksVerified: local.length,
  publicTextAndPdfGatePassed: true, offlineVideoPlayback: video, mobileWidth: width, requestedNetwork: blocked,
  pageErrors: errors, providerRequests: 0, manifestSha256: sha(await readFile(path.join(dir, 'manifest.json'))),
  rootVisualReview: 'separate-page-by-page-receipt', oldArtifactsModified: false };
const target = path.join(root, 'output/submission-offline', id + '-verification.json');
await writeFile(target, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
