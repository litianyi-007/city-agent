import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright';
import { cameraSceneSchema, type CameraSceneConfig } from '../shared/camera-scene-schema.js';
import { CAMERA_GATE_RUNTIME_CSP_HASH, CAMERA_GATE_RUNTIME_SOURCE, CAMERA_GEOMETRY_VERSION, CAMERA_RUNTIME_CSP_HASH, CAMERA_RUNTIME_SOURCE, CAMERA_STYLE_CSP_HASH, CAMERA_RUNTIME_STYLE, classifyCameraLandmarks, createCameraParticles, renderCameraSceneHtml, type CameraLandmark } from '../shared/camera-scene-runtime.js';
import { renderCameraHandWorkerSource } from '../shared/camera-hand-worker.js';

function scene(): CameraSceneConfig {
  return cameraSceneSchema.parse({ version: 'camera-scene-v1', title: '通用几何场景 " & 测试', background: '#0f172a', palette: ['#60a5fa', '#fde68a'], objects: ['cone', 'sphere', 'ring', 'star'].map((primitive, index) => ({ id: `object-${index}`, primitive, position: [index * 2 - 3, 0, 0], scale: [1, 2, 1], count: 30, color: '#93c5fd' })), snowCount: 8, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } });
}
function landmarks(gesture: 'open' | 'fist', angle = 0): CameraLandmark[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 })); points[0] = { x: 0.5, y: 0.88, z: 0 };
  for (const [finger, pip, tip] of [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]) { points[finger] = { x: 0.5 + (finger - 11) * 0.012, y: 0.66, z: 0 }; points[pip] = { x: points[finger].x, y: 0.5, z: 0 }; points[tip] = { x: points[finger].x, y: gesture === 'open' ? 0.22 : 0.72, z: 0 }; }
  return points.map(point => ({ x: 0.5 + (point.x - 0.5) * Math.cos(angle) - (point.y - 0.5) * Math.sin(angle), y: 0.5 + (point.x - 0.5) * Math.sin(angle) + (point.y - 0.5) * Math.cos(angle), z: point.z }));
}

test('generic geometry is deterministic, bounded and independent of demand words', () => {
  const input = scene(); const particles = createCameraParticles(input);
  assert.equal(particles.length, 128); assert.deepEqual(particles, createCameraParticles(input));
  assert.equal(particles.filter(particle => particle.snow).length, 8);
  assert.ok(particles.every(particle => [particle.x, particle.y, particle.z, ...particle.scatter].every(Number.isFinite)));
  assert.ok(particles.every(particle => Math.abs(particle.scatter[0]) <= 14 && Math.abs(particle.scatter[1]) <= 10 && Math.abs(particle.scatter[2]) <= 9));
  for (let offset = 0; offset < 120; offset += 30) assert.ok(new Set(particles.slice(offset, offset + 30).map(particle => JSON.stringify([particle.x, particle.y, particle.z]))).size > 20);
});

test('frozen classifier rejects malformed points, tolerates hand orientation and returns neutral when ambiguous', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) { assert.equal(classifyCameraLandmarks(landmarks('open', angle)).gesture, 'openPalm'); assert.equal(classifyCameraLandmarks(landmarks('fist', angle)).gesture, 'closedFist'); }
  assert.deepEqual(classifyCameraLandmarks([]), { gesture: null, palmX: null });
  assert.deepEqual(classifyCameraLandmarks(landmarks('open').map(point => ({ ...point, x: NaN }))), { gesture: null, palmX: null });
  const neutral = landmarks('open'); for (const [pip, tip] of [[6, 8], [10, 12], [14, 16], [18, 20]]) neutral[tip] = { ...neutral[pip] };
  assert.equal(classifyCameraLandmarks(neutral).gesture, null);
  assert.equal(classifyCameraLandmarks(landmarks('open')).palmX, 0.5);
});

test('renderer validates data, escapes JSON, pins CSP hashes and omits gate hooks from normal HTML', () => {
  const input = scene(); const html = renderCameraSceneHtml(input);
  assert.equal(html.includes('__cameraSceneTest'), false); assert.ok(renderCameraSceneHtml(input, { gateMode: true }).includes('__cameraSceneTest'));
  assert.ok(html.includes('audio:false')); assert.ok(html.includes('没有画面上传、录制或日志')); assert.equal(html.includes('<iframe'), false); assert.equal(html.includes('https://'), false);
  assert.ok(html.includes('\\u0026')); assert.ok(html.includes(`data-geometry-version="${CAMERA_GEOMETRY_VERSION}"`));
  for (const [source, digest] of [[CAMERA_RUNTIME_SOURCE, CAMERA_RUNTIME_CSP_HASH], [CAMERA_GATE_RUNTIME_SOURCE, CAMERA_GATE_RUNTIME_CSP_HASH], [CAMERA_RUNTIME_STYLE, CAMERA_STYLE_CSP_HASH]]) assert.equal(digest, `sha256-${createHash('sha256').update(source).digest('base64')}`);
  assert.throws(() => renderCameraSceneHtml({ ...input, title: '</script><script>external()</script>' }));
  assert.throws(() => renderCameraSceneHtml(input, { assetBase: 'https://external.example/' }));
  assert.throws(() => renderCameraSceneHtml({ ...input, background: 'url(https://external.example)' }));
  const worker = renderCameraHandWorkerSource(); assert.ok(worker.includes('vision_bundle.mjs')); assert.ok(worker.includes('0.10.32')); assert.equal(worker.includes('eval('), false); assert.ok(worker.includes('bitmap?.close()')); assert.ok(worker.includes('STOPPED'));
});

test('trusted runtime actual Canvas, manual controls and synthetic landmark debounce work without camera or external calls', async () => {
  const browser = await chromium.launch(); const context = await browser.newContext({ reducedMotion: 'reduce' }); const page = await context.newPage();
  const errors: string[] = []; const unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => new URL(route.request().url()).pathname === '/scene' ? route.fulfill({ contentType: 'text/html', body: renderCameraSceneHtml(scene(), { gateMode: true }) }) : (unexpected.push(route.request().url()), route.abort()));
  const snapshot = () => page.evaluate(() => (window as unknown as { __cameraSceneTest: { snapshot: () => { state: string; rotation: number; particleCount: number; particles: number[][]; cameraActive: boolean } } }).__cameraSceneTest.snapshot());
  const feed = (points: CameraLandmark[]) => page.evaluate(value => (window as unknown as { __cameraSceneTest: { feedLandmarks: (points: CameraLandmark[]) => void } }).__cameraSceneTest.feedLandmarks(value), points);
  try {
    await page.goto('http://127.0.0.1:49999/scene');
    assert.deepEqual(errors, []); assert.equal(await page.locator('#scene-title').innerText(), scene().title); assert.equal(await page.locator('#camera-start').isDisabled(), true);
    const before = await snapshot(); assert.equal(before.particleCount, 128); assert.equal(before.cameraActive, false); assert.equal(before.state, 'gather');
    const pixelsBefore = await page.locator('#scene-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    await page.locator('#scatter').focus(); await page.keyboard.press('Enter'); const after = await snapshot(); assert.equal(after.state, 'scatter'); assert.notDeepEqual(after.particles, before.particles);
    assert.notEqual(await page.locator('#scene-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()), pixelsBefore);
    await page.locator('#rotate-right').click(); assert.ok((await snapshot()).rotation > 0); await page.locator('#reset-btn').click(); assert.equal((await snapshot()).rotation, 0); assert.deepEqual((await snapshot()).particles, before.particles);
    await feed(landmarks('open')); await feed(landmarks('open')); assert.equal((await snapshot()).state, 'gather'); await feed(landmarks('open')); assert.equal((await snapshot()).state, 'scatter');
    await feed(landmarks('fist')); await feed(landmarks('fist')); await feed(landmarks('fist')); assert.equal((await snapshot()).state, 'gather');
    for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 960 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`); }
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await context.close(); await browser.close(); }
});

test('normal runtime stop before permission resolves releases late tracks and local worker without auto-restart', async () => {
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  await context.addInitScript({ content: 'window.__name=(value,_name)=>value;' });
  await context.addInitScript(() => {
    const testWindow = window as unknown as { resolveCamera: (() => void) | null; stoppedTracks: number; workersTerminated: number; mediaCalls: number };
    testWindow.resolveCamera = null; testWindow.stoppedTracks = 0; testWindow.workersTerminated = 0; testWindow.mediaCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: (constraints: MediaStreamConstraints) => { if (constraints.audio !== false) throw Error('audio requested'); testWindow.mediaCalls++; return new Promise(resolve => { testWindow.resolveCamera = () => resolve({ getTracks: () => [{ stop: () => testWindow.stoppedTracks++ }] }); }); } } });
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null;
      postMessage(value: { type: string }) { if (value.type === 'INIT') queueMicrotask(() => this.onmessage?.({ data: { type: 'READY' } })); if (value.type === 'STOP') queueMicrotask(() => this.onmessage?.({ data: { type: 'STOPPED' } })); }
      terminate() { testWindow.workersTerminated++; }
    }
    Object.defineProperty(window, 'Worker', { value: FakeWorker });
  });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: renderCameraSceneHtml(scene()) }));
  try {
    await page.goto('http://127.0.0.1:49999/scene');
    assert.equal(await page.evaluate(() => '__cameraSceneTest' in window), false);
    assert.equal(await page.evaluate(() => (window as unknown as { mediaCalls: number }).mediaCalls), 0);
    await page.locator('#camera-start').click(); await page.waitForFunction(() => !!(window as unknown as { resolveCamera: unknown }).resolveCamera);
    await page.locator('#camera-stop').click(); await page.evaluate(() => (window as unknown as { resolveCamera: () => void }).resolveCamera());
    await page.waitForFunction(() => (window as unknown as { stoppedTracks: number; workersTerminated: number }).stoppedTracks === 1 && (window as unknown as { workersTerminated: number }).workersTerminated === 1);
    assert.equal(await page.locator('#camera-status').getAttribute('data-state'), 'stopped');
    const evidence = await page.evaluate(() => (window as unknown as { __cameraSceneEvidence: { snapshot: () => { cameraActive: boolean; workerCount: number; trackCount: number; frameCount: number } } }).__cameraSceneEvidence.snapshot());
    assert.equal(evidence.cameraActive, false); assert.equal(evidence.workerCount, 0); assert.equal(evidence.trackCount, 0); assert.equal(evidence.frameCount, 0);
    assert.equal(await page.evaluate(() => (window as unknown as { mediaCalls: number }).mediaCalls), 1);
  } finally { await context.close(); await browser.close(); }
});

test('local model initialization error never requests media or falls back to an external service', async () => {
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  await context.addInitScript({ content: 'window.__name=(value,_name)=>value;' });
  await context.addInitScript(() => {
    const testWindow = window as unknown as { mediaCalls: number }; testWindow.mediaCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => { testWindow.mediaCalls++; throw Error('must not request media'); } } });
    class FailedWorker { onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; postMessage(value: { type: string }) { queueMicrotask(() => this.onmessage?.({ data: { type: value.type === 'INIT' ? 'ERROR' : 'STOPPED' } })); } terminate() {} }
    Object.defineProperty(window, 'Worker', { value: FailedWorker });
  });
  const unexpected: string[] = [];
  await context.route('**/*', route => new URL(route.request().url()).pathname === '/scene' ? route.fulfill({ contentType: 'text/html', body: renderCameraSceneHtml(scene()) }) : (unexpected.push(route.request().url()), route.abort()));
  try {
    await page.goto('http://127.0.0.1:49999/scene'); await page.locator('#camera-start').click();
    await page.waitForFunction(() => document.getElementById('camera-status')?.getAttribute('data-state') === 'error');
    assert.equal(await page.evaluate(() => (window as unknown as { mediaCalls: number }).mediaCalls), 0);
    await page.waitForFunction(() => (window as unknown as { __cameraSceneEvidence: { snapshot: () => { workerCount: number } } }).__cameraSceneEvidence.snapshot().workerCount === 0);
    assert.equal(await page.locator('#camera-stop').isDisabled(), true); assert.deepEqual(unexpected, []);
  } finally { await context.close(); await browser.close(); }
});

test('stop during asynchronous frame creation closes the late bitmap and stops every synthetic track', async () => {
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  await context.addInitScript({ content: 'window.__name=(value,_name)=>value;' });
  await context.addInitScript(() => {
    const testWindow = window as unknown as { bitmapClosed: number; resolveBitmap: (() => void) | null; fixtureStream: MediaStream }; testWindow.bitmapClosed = 0; testWindow.resolveBitmap = null;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#777'; ctx.fillRect(0, 0, 32, 24); const stream = canvas.captureStream(10); testWindow.fixtureStream = stream; return stream; } } });
    Object.defineProperty(window, 'createImageBitmap', { value: () => new Promise(resolve => { testWindow.resolveBitmap = () => resolve({ width: 320, height: 240, close: () => testWindow.bitmapClosed++ }); }) });
    class FakeWorker { onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; postMessage(value: { type: string }) { if (value.type !== 'FRAME') queueMicrotask(() => this.onmessage?.({ data: { type: value.type === 'INIT' ? 'READY' : 'STOPPED' } })); } terminate() {} }
    Object.defineProperty(window, 'Worker', { value: FakeWorker });
  });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: renderCameraSceneHtml(scene()) }));
  try {
    await page.goto('http://127.0.0.1:49999/scene'); await page.locator('#camera-start').click();
    await page.waitForFunction(() => !!(window as unknown as { resolveBitmap: unknown }).resolveBitmap, undefined, { timeout: 5000 });
    await page.locator('#camera-stop').click(); await page.evaluate(() => (window as unknown as { resolveBitmap: () => void }).resolveBitmap());
    await page.waitForFunction(() => (window as unknown as { bitmapClosed: number }).bitmapClosed === 1);
    assert.equal(await page.evaluate(() => (window as unknown as { fixtureStream: MediaStream }).fixtureStream.getTracks().every(track => track.readyState === 'ended')), true);
    const snapshot = await page.evaluate(() => (window as unknown as { __cameraSceneEvidence: { snapshot: () => { cameraActive: boolean; inferenceBusy: boolean; frameCount: number } } }).__cameraSceneEvidence.snapshot());
    assert.equal(snapshot.cameraActive, false); assert.equal(snapshot.inferenceBusy, false); assert.equal(snapshot.frameCount, 0);
  } finally { await context.close(); await browser.close(); }
});
