import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import express from 'express';
import { chromium } from 'playwright';
import { cameraSceneSchema } from '../shared/camera-scene-schema.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';
import { createProductionService } from '../server/production/index.js';
import { cameraRuntimeMetadata } from '../server/production/camera-gate.js';
import { hash } from '../server/production/store.js';

// This is a trusted engineering scene, NOT an internal Agent generation result.
const scene = cameraSceneSchema.parse({ version: 'camera-scene-v1', title: '工程媒体生命周期夹具', background: '#081020', palette: ['#e0f2fe', '#c4b5fd'], objects: [{ id: 'geometry', primitive: 'cone', position: [0, 0, 0], scale: [3, 5, 3], count: 200, color: '#38bdf8' }], snowCount: 20, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } });

test('trusted local scene initializes pinned vision on a fake camera, stops resources and sends no external requests', { timeout: 60000 }, async t => {
  if (!existsSync(fileURLToPath(new URL('../public/camera-assets/hand_landmarker.task', import.meta.url)))) { t.skip('Pinned camera assets have not been prepared; fake-device vision integration is unverified. Run the documented preparation script first.'); return; }
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-camera-browser-'));
  const service = createProductionService(directory);
  const id = randomUUID();
  const input = productionRunInputSchema.parse({ brief: '工程假摄像头生命周期测试，不是实体摄像头证据', capability: 'camera-scene-v1', mode: 'live', agentIds: service.store.agents().map(agent => agent.id), requirement: { id: 'ENGINEERING-FAKE-CAMERA', source: 'automated engineering fixture', acceptance: 'local model init and cancellation only', kind: 'illustrative' } });
  const runtime = cameraRuntimeMetadata();
  const run: ProductionRun = { id, input, status: 'completed', createdAt: new Date().toISOString(), evidenceKind: 'injected-test', agentSnapshot: service.store.agents(), events: [], calls: [], verifications: [], outputs: [], gateHistory: [], repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], frozenContract: { version: 'engineering-camera-test', hash: 'engineering-only', requirementHash: 'engineering-only', checks: [], frozenAt: new Date().toISOString(), runtimeHash: runtime.hash }, cameraVerification: { scope: 'scene-behavior-synthetic', boundedScenePassed: true, visionModelVerified: false, physicalCameraVerified: false, fullRequirementVerified: false, runtimeVersion: runtime.version, runtimeHash: runtime.hash, limitations: ['Injected engineering media-lifecycle fixture, not Agent delivery'] }, artifacts: [{ name: 'scene.json', type: 'application/json' }, { name: 'camera-runtime-manifest.json', type: 'application/json' }] };
  service.store.addRun(run, input.agentIds);
  service.store.writeArtifact(id, 'scene.json', JSON.stringify(scene));
  service.store.writeArtifact(id, 'camera-runtime-manifest.json', JSON.stringify({ ...runtime, sceneSha256: hash(JSON.stringify(scene)) }));
  const app = express(); app.use('/api/production', service.router);
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  t.after(async () => { await browser.close(); await service.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(directory, { recursive: true, force: true }); });
  const context = await browser.newContext();
  // Permission applies only to this ephemeral origin and artificial device.
  await context.grantPermissions(['camera'], { origin });
  const external: string[] = [];
  context.on('request', request => { const url = request.url(); if (!url.startsWith(origin + '/') && !url.startsWith('blob:')) external.push(url.split('?')[0]); });
  const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(`${origin}/api/production/runs/${id}/scene-preview`);
  assert.equal(response?.status(), 200);
  assert.match(response!.headers()['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(await page.evaluate(() => '__cameraSceneTest' in window), false);
  assert.equal(await page.locator('#camera-status').getAttribute('data-status'), 'off');
  assert.equal(await page.locator('#scene-state').innerText(), 'gather');
  await page.locator('#scatter').click(); assert.equal(await page.locator('#scene-state').innerText(), 'scatter');
  await page.locator('#gather').click(); assert.equal(await page.locator('#scene-state').innerText(), 'gather');
  await page.locator('#camera-start').click();
  await page.waitForFunction(() => ['active', 'error'].includes(document.querySelector('#camera-status')!.getAttribute('data-status')!), undefined, { timeout: 35000 });
  assert.equal(await page.locator('#camera-status').getAttribute('data-status'), 'active', await page.locator('#camera-status').innerText());
  // The SDK really executes on artificial color bars; this proves initialization
  // and transport, not recognition accuracy or compatibility with real hardware.
  await page.waitForFunction(() => (window as unknown as { __cameraSceneEvidence: { snapshot: () => { frameCount: number } } }).__cameraSceneEvidence.snapshot().frameCount >= 2, undefined, { timeout: 10000 });
  await page.locator('#camera-stop').click();
  await page.waitForFunction(() => { const value = (window as unknown as { __cameraSceneEvidence: { snapshot: () => { cameraActive: boolean; workerCount: number; trackCount: number; inferenceBusy: boolean } } }).__cameraSceneEvidence.snapshot(); return !value.cameraActive && value.workerCount === 0 && value.trackCount === 0 && !value.inferenceBusy; });
  assert.equal(await page.locator('#camera-status').getAttribute('data-status'), 'off');
  assert.equal(await page.locator('#camera-video').evaluate(video => (video as HTMLVideoElement).srcObject), null);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#scatter').click(); assert.equal(await page.locator('#scene-state').innerText(), 'scatter');
});
