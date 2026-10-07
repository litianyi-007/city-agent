import { chromium, type Browser } from 'playwright';
import { cameraSceneSchema, type CameraSceneConfig } from '../../shared/camera-scene-schema.js';
import { CAMERA_RUNTIME_VERSION, CAMERA_RUNTIME_SOURCE, CAMERA_GATE_RUNTIME_SOURCE, CAMERA_RUNTIME_STYLE, CAMERA_GEOMETRY_VERSION, renderCameraSceneHtml } from '../../shared/camera-scene-runtime.js';
import { CAMERA_HAND_WORKER_VERSION, CAMERA_HAND_WORKER_SOURCE } from '../../shared/camera-hand-worker.js';
import { CAMERA_ASSET_MANIFEST } from '../../shared/camera-asset-manifest.js';
import type { ProductionGate } from '../../shared/production-schema.js';
import { GateInfrastructureError, runGate, type AcceptanceCheck } from '../gate.js';
import { CAMERA_MANDATORY_CHECKS_VERSION } from './contracts.js';
import { hash } from './store.js';

export function cameraRuntimeMetadata() {
  const inputs = { renderer: CAMERA_RUNTIME_SOURCE, gateRenderer: CAMERA_GATE_RUNTIME_SOURCE, style: CAMERA_RUNTIME_STYLE, worker: CAMERA_HAND_WORKER_SOURCE, geometryVersion: CAMERA_GEOMETRY_VERSION, workerVersion: CAMERA_HAND_WORKER_VERSION, assets: CAMERA_ASSET_MANIFEST, mandatoryChecksVersion: CAMERA_MANDATORY_CHECKS_VERSION };
  return { version: CAMERA_RUNTIME_VERSION, hash: hash(inputs), rendererHash: hash(CAMERA_RUNTIME_SOURCE), gateRendererHash: hash(CAMERA_GATE_RUNTIME_SOURCE), styleHash: hash(CAMERA_RUNTIME_STYLE), workerVersion: CAMERA_HAND_WORKER_VERSION, workerHash: hash(CAMERA_HAND_WORKER_SOURCE), geometryVersion: CAMERA_GEOMETRY_VERSION, assetManifest: CAMERA_ASSET_MANIFEST, mandatoryChecksVersion: CAMERA_MANDATORY_CHECKS_VERSION };
}

/** Owned synthetic landmarks, not real model detections or real human footage. */
function landmarks(open: boolean, centerX = 0.5) {
  const points = Array.from({ length: 21 }, () => ({ x: centerX, y: 0.7, z: 0 }));
  points[0] = { x: centerX, y: 0.9, z: 0 };
  for (const [index, [pip, tip]] of [[6, 8], [10, 12], [14, 16], [18, 20]].entries()) { const x = centerX + (index - 1.5) * 0.03; points[pip] = { x, y: 0.6, z: 0 }; points[tip] = { x, y: open ? 0.2 : 0.84, z: 0 }; }
  return points;
}

/** Separate capability Gate. Never changes shared HTML Gate or grants camera. */
export async function runCameraSceneGate(input: CameraSceneConfig, checks: AcceptanceCheck[], signal?: AbortSignal): Promise<ProductionGate> {
  signal?.throwIfAborted();
  const scene = cameraSceneSchema.parse(input);
  const html = renderCameraSceneHtml(scene, { mode: 'gate' });
  const cssGate = await runGate(html, checks, signal);
  if (!cssGate.passed) return { ...cssGate, evidenceScope: 'scene-behavior-synthetic', summary: '冻结场景DOM验收未通过；没有声称识别模型或物理摄像头完成验收。' };
  const background = scene.background.toLowerCase();
  if (scene.objects.every(object => object.color.toLowerCase() === background) && (scene.snowCount === 0 || scene.palette.every(color => color.toLowerCase() === background))) return { passed: false, checks: [...cssGate.checks, { name: '强制：可见几何与背景分离', passed: false, detail: 'Canvas背景渐变不算粒子绘制证据；所有粒子颜色与背景相同，无法验收可见几何。' }], evidenceScope: 'scene-behavior-synthetic', summary: '场景缺少可验证的可见粒子；没有降低门禁。' };
  const results = [...cssGate.checks]; let browser: Browser | undefined; let operation: Promise<void> | undefined; let stopping = false; let timedOut = false; let environmentReady = false; let browserDisconnected = false;
  let abortListener: (() => void) | undefined; let closePromise: Promise<void> | undefined;
  const close = () => (closePromise ??= browser?.close() ?? Promise.resolve());
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = () => { stopping = true; rejectStopped(new DOMException(timedOut ? '场景行为Gate超时' : '场景行为Gate已取消', 'AbortError')); if (browser) void close().catch(() => undefined); };
  abortListener = stop; signal?.addEventListener('abort', abortListener, { once: true });
  const timeout = setTimeout(() => { timedOut = true; stop(); }, 15_000);
  const url = 'https://city-agent-camera-gate.invalid/';
  // No assets, media permissions or arbitrary model code are admitted in Gate mode.
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";
  try {
    operation = (async () => {
      browser = await chromium.launch({ headless: true, timeout: 8000, args: ['--js-flags=--max-old-space-size=128'] });
      browser.on('disconnected', () => { if (!stopping) browserDisconnected = true; });
      if (stopping || signal?.aborted) { await close(); throw new DOMException('场景Gate已停止', 'AbortError'); }
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', acceptDownloads: false });
      const faults: string[] = []; let served = false;
      await context.route('**/*', async route => { const request = route.request(); if (!served && request.isNavigationRequest() && request.url() === url) { served = true; await route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': csp }, body: html }); } else { faults.push('未授权网络或导航'); await route.abort('blockedbyclient'); } });
      const page = await context.newPage(); page.setDefaultTimeout(2000);
      environmentReady = true;
      context.on('page', popup => { faults.push('弹窗'); void popup.close().catch(() => undefined); });
      page.on('pageerror', () => faults.push('可信运行时JavaScript错误'));
      page.on('download', download => { faults.push('下载'); void download.cancel(); });
      page.on('dialog', dialog => { faults.push('对话框'); void dialog.dismiss(); });
      await page.goto(url, { waitUntil: 'load', timeout: 3000 });
      const snapshot = () => page.evaluate(() => (window as unknown as { __cameraSceneTest: { snapshot: () => { state: string; rotation: number; particleCount: number; particles: number[][]; cameraActive: boolean } } }).__cameraSceneTest.snapshot());
      const pixels = () => page.evaluate(() => { const canvas = document.querySelector<HTMLCanvasElement>('#scene-canvas')!; const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; let checksum = 2166136261; const colors = new Set<number>(); for (let i = 0; i < bytes.length; i += 4) { const color = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; colors.add(color); checksum = Math.imul(checksum ^ color, 16777619) >>> 0; } return { width: canvas.width, height: canvas.height, checksum, colors: colors.size }; });
      const ensure = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
      const initial = await snapshot(); const initialPixels = await pixels();
      ensure(initialPixels.width >= 300 && initialPixels.height >= 200 && initialPixels.colors > 1, 'Canvas必须实际绘制可见粒子而非仅状态文本');
      ensure(initial.particleCount === scene.objects.reduce((sum, object) => sum + object.count, scene.snowCount) && initial.particles.length > 0 && initial.particles.length <= 32 && initial.particles.every(point => point.length === 3 && point.every(Number.isFinite)), '实际粒子数或有界坐标快照不符合场景配置');
      ensure(initial.cameraActive === false, '合成Gate不得启动摄像头');
      results.push({ name: '强制：真实Canvas绘制与有界粒子配置', passed: true });
      await page.click('#scatter'); const scattered = await snapshot(); const scatteredPixels = await pixels();
      ensure(scattered.state === 'scatter' && JSON.stringify(scattered.particles) !== JSON.stringify(initial.particles) && scatteredPixels.checksum !== initialPixels.checksum, '散开必须改变实际粒子与Canvas，而不是只写通过文本');
      await page.click('#gather'); const gathered = await snapshot(); ensure(gathered.state === 'gather' && JSON.stringify(gathered.particles) === JSON.stringify(initial.particles), '聚合必须恢复实际对象几何');
      const beforeRotation = await pixels(); await page.click('#rotate-right'); const rotated = await snapshot(); const rotationPixels = await pixels(); ensure(rotated.rotation > 0 && rotationPixels.checksum !== beforeRotation.checksum, '手动旋转必须改变实际旋转状态和可见Canvas；完全不可辨别的旋转不能满足可观察交互');
      await page.click('#reset-btn'); ensure((await snapshot()).rotation === 0, '重置必须复原旋转');
      results.push({ name: '强制：手动散开/聚合/旋转/重置实际行为', passed: true });
      const feed = (points: ReturnType<typeof landmarks>) => page.evaluate(values => { const api = (window as unknown as { __cameraSceneTest: { feedLandmarks: (points: unknown) => unknown } }).__cameraSceneTest; for (let frame = 0; frame < 3; frame++) api.feedLandmarks(values); }, points);
      // Wrong noisy one-frame gesture must not flip a stable state.
      await feed(landmarks(true)); ensure((await snapshot()).state === scene.mappings.openPalm, '合成张掌经过几何分类与稳定帧后必须按配置映射');
      await page.evaluate(values => (window as unknown as { __cameraSceneTest: { feedLandmarks: (points: unknown) => unknown } }).__cameraSceneTest.feedLandmarks(values), landmarks(false));
      ensure((await snapshot()).state === scene.mappings.openPalm, '单帧噪声不得越过三帧稳定门限');
      await feed(landmarks(false)); ensure((await snapshot()).state === scene.mappings.closedFist, '合成握拳必须按配置映射');
      await page.click('#reset-btn'); await feed(landmarks(true, 0.25)); const horizontal = await snapshot();
      ensure(scene.mappings.palmX === 'rotate' ? horizontal.rotation > 0 : horizontal.rotation === 0, '横向手掌旋转必须遵守rotate/none配置');
      ensure(horizontal.cameraActive === false && !faults.length && page.url() === url, 'Gate访问了摄像头、网络或导航');
      results.push({ name: '强制：合成21点手势分类/去抖/横向映射（非真实识别）', passed: true });
    })();
    if (signal?.aborted) stop();
    await Promise.race([operation, stopped]);
    return { passed: true, checks: results, evidenceScope: 'scene-behavior-synthetic', summary: '受控场景配置、实际Canvas、手动按钮及合成21点手势行为通过；未验证真实视觉模型、物理摄像头或完整用户需求。' };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('场景行为Gate已取消', 'AbortError');
    results.push({ name: '强制场景行为Gate', passed: false, detail: error instanceof Error ? error.message : String(error) });
    return { passed: false, ...(timedOut ? { failureKind: 'timeout' as const } : !environmentReady || browserDisconnected || error instanceof GateInfrastructureError ? { failureKind: 'infrastructure' as const } : {}), checks: results, evidenceScope: 'scene-behavior-synthetic', summary: '场景行为验收失败；没有放宽冻结门禁或替代真实摄像头验收。' };
  } finally { stopping = true; clearTimeout(timeout); if (abortListener) signal?.removeEventListener('abort', abortListener); if (browser) await close().catch(() => undefined); await operation?.catch(() => undefined); }
}
