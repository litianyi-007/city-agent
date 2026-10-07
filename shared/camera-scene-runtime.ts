import { sha256 } from 'js-sha256';
import { cameraSceneSchema, type CameraSceneConfig } from './camera-scene-schema.js';
export { renderCameraHandWorkerSource, CAMERA_HAND_WORKER_SOURCE } from './camera-hand-worker.js';

export const CAMERA_RUNTIME_VERSION = 'camera-scene-runtime-v1';
export const CAMERA_GEOMETRY_VERSION = 'hand-geometry-v1';
export const CAMERA_HAND_WORKER_VERSION = 'camera-hand-worker-v1';
export const CAMERA_DEBOUNCE_FRAMES = 3;
export interface CameraLandmark { x: number; y: number; z: number; }
export type CameraGesture = 'openPalm' | 'closedFist' | null;
export interface CameraHandSample { gesture: CameraGesture; palmX: number | null; }
export interface CameraParticle { x: number; y: number; z: number; color: string; snow: boolean; scatter: [number, number, number]; }

/** Frozen geometric heuristic, not a trained gesture model or an accuracy claim. */
export function classifyCameraLandmarks(points: readonly CameraLandmark[]): CameraHandSample {
  if (points.length !== 21 || points.some(point => !point || ![point.x, point.y, point.z].every(Number.isFinite) || Math.abs(point.x) > 2 || Math.abs(point.y) > 2 || Math.abs(point.z) > 2)) return { gesture: null, palmX: null };
  const wrist = points[0];
  const distance = (a: CameraLandmark, b: CameraLandmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  let extended = 0; let curled = 0;
  for (const [pip, tip] of [[6, 8], [10, 12], [14, 16], [18, 20]]) {
    const base = distance(points[pip], wrist);
    if (base < 0.015) return { gesture: null, palmX: null };
    const ratio = distance(points[tip], wrist) / base;
    if (ratio >= 1.18) extended++;
    if (ratio <= 0.92) curled++;
  }
  const centerX = [0, 5, 9, 13, 17].reduce((sum, index) => sum + points[index].x, 0) / 5;
  return { gesture: extended === 4 ? 'openPalm' : curled >= 3 ? 'closedFist' : null, palmX: Math.min(1, Math.max(0, 1 - centerX)) };
}

/** Deterministic generic geometry; no demand keywords or project-specific output. */
export function createCameraParticles(scene: CameraSceneConfig): CameraParticle[] {
  let seed = 2166136261;
  for (const character of JSON.stringify(scene)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const particles: CameraParticle[] = [];
  for (const object of scene.objects) {
    for (let index = 0; index < object.count; index++) {
      const u = (index + 0.5) / object.count;
      const angle = index * 2.399963229728653;
      let x = 0; let y = 0; let z = 0;
      if (object.primitive === 'cone') { y = 1 - 2 * u; const radius = u; x = Math.cos(angle) * radius; z = Math.sin(angle) * radius; }
      if (object.primitive === 'sphere') { y = 1 - 2 * u; const radius = Math.sqrt(Math.max(0, 1 - y * y)); x = Math.cos(angle) * radius; z = Math.sin(angle) * radius; }
      if (object.primitive === 'ring') { const theta = u * Math.PI * 2; x = Math.cos(theta); z = Math.sin(theta); y = (random() - 0.5) * 0.12; }
      if (object.primitive === 'star') {
        const side = u * 10; const segment = Math.floor(side); const fraction = side - segment;
        const a = -Math.PI / 2 + segment * Math.PI / 5; const b = a + Math.PI / 5;
        const radiusA = segment % 2 === 0 ? 1 : 0.43; const radiusB = segment % 2 === 0 ? 0.43 : 1;
        x = Math.cos(a) * radiusA * (1 - fraction) + Math.cos(b) * radiusB * fraction;
        y = -(Math.sin(a) * radiusA * (1 - fraction) + Math.sin(b) * radiusB * fraction); z = (random() - 0.5) * 0.16;
      }
      const scatter: [number, number, number] = [(random() - 0.5) * 28, (random() - 0.5) * 20, (random() - 0.5) * 18];
      particles.push({ x: object.position[0] + x * object.scale[0], y: object.position[1] + y * object.scale[1], z: object.position[2] + z * object.scale[2], color: object.color, snow: false, scatter });
    }
  }
  for (let index = 0; index < scene.snowCount; index++) {
    const x = (random() - 0.5) * 25; const y = (random() - 0.5) * 18; const z = (random() - 0.5) * 16;
    particles.push({ x, y, z, color: scene.palette[index % scene.palette.length], snow: true, scatter: [x, y, z] });
  }
  return particles;
}

function cameraClient(installGateHooks?: (hooks: { feed: (value: { gesture: CameraGesture; palmX?: number }) => unknown; feedLandmarks: (points: CameraLandmark[]) => unknown; snapshot: () => unknown }) => void) {
  const configElement = document.getElementById('camera-scene-config')!;
  const config = JSON.parse(configElement.textContent!) as { scene: CameraSceneConfig; gateMode: boolean; assetBase: string; runtimeVersion: string; geometryVersion: string; debounceFrames: number };
  const scene = config.scene;
  const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const video = document.getElementById('camera-video') as HTMLVideoElement;
  const startButton = document.getElementById('camera-start') as HTMLButtonElement;
  const stopButton = document.getElementById('camera-stop') as HTMLButtonElement;
  const status = document.getElementById('camera-status')!;
  const stateText = document.getElementById('scene-state')!;
  const rotationText = document.getElementById('rotation')!;
  const sourceText = document.getElementById('interaction-source')!;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const particles = createCameraParticles(scene);
  const current = particles.map(particle => [particle.x, particle.y, particle.z]);
  let state: 'gather' | 'scatter' = 'gather'; let rotation = 0; let lastGesture: CameraGesture = null; let streak = 0;
  let cameraGeneration = 0; let stream: MediaStream | null = null; let worker: Worker | null = null;
  const activeWorkers = new Set<Worker>(); let frameCount = 0;
  let modelReady = false; let inferenceBusy = false; let inferenceTimer = 0; let captureTimer = 0; let initTimer = 0; let permissionTimer = 0;
  let disposed = false; let animationId = 0; let lastTimestamp = -1;
  const setStatus = (text: string, value: string) => { status.textContent = text; status.setAttribute('data-status', value); status.setAttribute('data-state', value === 'active' ? 'running' : value === 'loading' || value === 'permission' ? 'initializing' : value === 'error' ? 'error' : 'stopped'); };
  function snapshot() {
    return Object.freeze({ state, rotation, particleCount: particles.length, objectParticleCount: particles.length - scene.snowCount, snowCount: scene.snowCount, cameraActive: !!stream, trackCount: stream?.getTracks().filter(track => track.readyState === 'live').length ?? 0, workerCount: activeWorkers.size, frameCount, inferenceBusy, runtimeVersion: config.runtimeVersion, geometryVersion: config.geometryVersion, particles: Object.freeze(current.slice(0, 32).map(point => Object.freeze([...point]))) });
  }
  function setState(next: 'gather' | 'scatter', source: string) { state = next; stateText.textContent = state; sourceText.textContent = source; if (reducedMotion.matches) draw(0, true); }
  function setRotation(next: number) { rotation = Math.max(-Math.PI, Math.min(Math.PI, next)); rotationText.textContent = rotation.toFixed(4); if (reducedMotion.matches) draw(0, true); }
  function sample(value: CameraHandSample, source: string) {
    if (scene.mappings.palmX === 'rotate' && value.palmX != null && Number.isFinite(value.palmX) && value.palmX >= 0 && value.palmX <= 1) setRotation((value.palmX * 2 - 1) * Math.PI);
    if (!value.gesture) { streak = 0; lastGesture = null; return; }
    streak = value.gesture === lastGesture ? streak + 1 : 1; lastGesture = value.gesture;
    if (streak >= config.debounceFrames) setState(scene.mappings[value.gesture], source);
  }
  function resize() { const box = canvas.getBoundingClientRect(); const ratio = Math.min(2, devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio)); draw(0, true); }
  function draw(time: number, immediate = false) {
    if (disposed) return;
    ctx.fillStyle = scene.background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.55);
    glow.addColorStop(0, '#64748b20'); glow.addColorStop(1, '#64748b00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const projected: Array<{ x: number; y: number; z: number; color: string; radius: number }> = [];
    const cos = Math.cos(rotation); const sin = Math.sin(rotation); const scale = Math.min(canvas.width, canvas.height) / 27;
    for (let index = 0; index < particles.length; index++) {
      const particle = particles[index]; const target = state === 'scatter' ? particle.scatter : [particle.x, particle.y, particle.z];
      for (let axis = 0; axis < 3; axis++) {
        if (immediate || reducedMotion.matches) current[index][axis] = target[axis];
        else current[index][axis] += (target[axis] - current[index][axis]) * 0.1;
      }
      let [x, y, z] = current[index];
      if (particle.snow && !reducedMotion.matches) y = ((y - time * 0.00055 + 20) % 20 + 20) % 20 - 10;
      const rotatedX = x * cos + z * sin; const rotatedZ = -x * sin + z * cos;
      const depth = 38 / Math.max(16, 38 + rotatedZ);
      projected.push({ x: canvas.width / 2 + rotatedX * scale * depth, y: canvas.height / 2 - y * scale * depth, z: rotatedZ, color: particle.color, radius: Math.max(1, Math.min(4.5, depth * (particle.snow ? 1.3 : 1.8))) * Math.min(2, devicePixelRatio || 1) });
    }
    projected.sort((a, b) => b.z - a.z);
    for (let index = 0; index < projected.length; index++) {
      const point = projected[index]; ctx.fillStyle = point.color;
      if (index % 5 === 0) { ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(point.x, point.y, point.radius * 3.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = Math.max(0.45, Math.min(1, 0.85 - point.z * 0.013)); ctx.beginPath(); ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function animate(time: number) { draw(time); if (!disposed) animationId = requestAnimationFrame(animate); }
  function stopCamera(text = '摄像头已关闭。按钮是独立手动模式，不代表摄像头验收。', value = 'off') {
    cameraGeneration++; clearTimeout(initTimer); clearTimeout(permissionTimer); clearTimeout(captureTimer); clearTimeout(inferenceTimer);
    const oldStream = stream; stream = null; oldStream?.getTracks().forEach(track => track.stop());
    video.pause(); video.srcObject = null; video.hidden = true; modelReady = false; inferenceBusy = false; lastTimestamp = -1; lastGesture = null; streak = 0;
    const oldWorker = worker; worker = null;
    if (oldWorker) {
      let ended = false;
      const finish = () => { if (ended) return; ended = true; oldWorker.onmessage = null; oldWorker.onerror = null; oldWorker.terminate(); activeWorkers.delete(oldWorker); };
      oldWorker.onmessage = event => { if (event.data?.type === 'STOPPED') finish(); }; oldWorker.onerror = finish;
      try { oldWorker.postMessage({ type: 'STOP' }); } catch { finish(); }
      setTimeout(finish, 200);
    }
    startButton.disabled = disposed || config.gateMode; stopButton.disabled = true; setStatus(text, value);
  }
  function failCamera(name: string) {
    const messages: Record<string, string> = { NotAllowedError: '摄像头权限被拒绝或当前页面不允许访问。', NotFoundError: '没有可用摄像头。', NotReadableError: '摄像头被占用或无法读取。', OverconstrainedError: '摄像头不支持所需配置。', SecurityError: '当前页面的安全策略禁止摄像头。' };
    stopCamera(`${messages[name] ?? '摄像头启动失败。'}可继续使用独立手动模式；摄像头验收仍未完成。`, 'error');
  }
  async function capture(generation: number) {
    if (generation !== cameraGeneration || disposed || !stream || !worker || !modelReady || inferenceBusy) return;
    if (video.readyState < 2) { captureTimer = window.setTimeout(() => void capture(generation), 100); return; }
    inferenceBusy = true;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(video, { resizeWidth: 320, resizeHeight: 240, resizeQuality: 'low' });
      if (generation !== cameraGeneration || disposed || !worker || !stream) { bitmap.close(); if (generation === cameraGeneration) inferenceBusy = false; return; }
      lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
      worker.postMessage({ type: 'FRAME', bitmap, timestampMs: lastTimestamp }, [bitmap]); bitmap = null;
      inferenceTimer = window.setTimeout(() => { if (generation === cameraGeneration) stopCamera('本地识别超时，摄像头及识别资源已停止。摄像头验收未完成。', 'error'); }, 8000);
    } catch { bitmap?.close(); if (generation === cameraGeneration) stopCamera('无法读取摄像头画面，本地识别已停止。', 'error'); }
  }
  async function openCamera(generation: number) {
    if (generation !== cameraGeneration || disposed) return;
    setStatus('等待你的摄像头授权；只读取视频，不请求音频。可随时点停止取消。', 'permission');
    permissionTimer = window.setTimeout(() => { if (generation === cameraGeneration) stopCamera('摄像头授权等待超时。迟到的授权流会立即停止，不自动恢复。', 'error'); }, 30000);
    try {
      const incoming = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 12, max: 15 } } });
      if (generation !== cameraGeneration || disposed) { incoming.getTracks().forEach(track => track.stop()); return; }
      clearTimeout(permissionTimer); stream = incoming; video.srcObject = incoming; video.hidden = false;
      incoming.getTracks().forEach(track => track.addEventListener('ended', () => { if (stream === incoming) stopCamera('摄像头画面已结束，识别已停止。', 'off'); }, { once: true }));
      await video.play();
      if (generation !== cameraGeneration || disposed) return;
      setStatus('摄像头已开启，本机识别中。画面不上传、不录制。实际识别效果尚待实机验收。', 'active');
      void capture(generation);
    } catch (error) { if (generation === cameraGeneration) failCamera(error instanceof DOMException ? error.name : 'unknown'); }
  }
  function startCamera() {
    if (config.gateMode || disposed || worker || stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.Worker || !window.createImageBitmap) { setStatus('当前浏览器或安全上下文不支持本地摄像头识别。请使用 HTTPS / localhost 的现代浏览器。', 'error'); return; }
    const generation = ++cameraGeneration; startButton.disabled = true; stopButton.disabled = false;
    setStatus('正在加载已固定版本的本地手部识别模型…', 'loading');
    try {
      const nextWorker = new Worker('/api/production/camera-runtime/worker.js', { name: 'city-agent-local-hand-worker' }); worker = nextWorker; activeWorkers.add(nextWorker);
      initTimer = window.setTimeout(() => { if (generation === cameraGeneration) stopCamera('本地模型加载超时。资产不可用时不会改用 CDN，摄像头未开启。', 'error'); }, 25000);
      nextWorker.onerror = () => { if (generation === cameraGeneration) stopCamera('本地识别 Worker 初始化失败。摄像头已停止；不会切换外部识别服务。', 'error'); };
      nextWorker.onmessage = event => {
        if (generation !== cameraGeneration || worker !== nextWorker || disposed) return;
        const message = event.data;
        if (message?.type === 'READY') { clearTimeout(initTimer); modelReady = true; void openCamera(generation); }
        else if (message?.type === 'RESULT') {
          clearTimeout(inferenceTimer); inferenceBusy = false; frameCount++;
          const landmarks = Array.isArray(message.landmarks) ? message.landmarks : [];
          const classified = classifyCameraLandmarks(landmarks);
          status.setAttribute('data-hand', classified.palmX == null ? 'none' : 'detected');
          const messageText = classified.palmX == null ? '摄像头已开启；当前未检测到手，保持场景。画面只在本机处理，实机验收未完成。' : '摄像头已开启；已检测到手部关键点，本机几何分类中。识别质量尚待实机验收。';
          if (status.textContent !== messageText) setStatus(messageText, 'active');
          sample(classified, '摄像头：本地手部几何分类'); captureTimer = window.setTimeout(() => void capture(generation), 90);
        }
        else if (message?.type === 'ERROR') stopCamera('本地模型加载或识别失败，摄像头已停止。请检查本地资产；不会外联回退。', 'error');
      };
      nextWorker.postMessage({ type: 'INIT', assetBase: config.assetBase });
    } catch { stopCamera('浏览器无法启动本地识别 Worker，摄像头未开启。', 'error'); }
  }
  document.getElementById('scatter')!.addEventListener('click', () => setState('scatter', '手动按钮（不是摄像头验证）'));
  document.getElementById('gather')!.addEventListener('click', () => setState('gather', '手动按钮（不是摄像头验证）'));
  document.getElementById('rotate-left')!.addEventListener('click', () => { sourceText.textContent = '手动按钮（不是摄像头验证）'; setRotation(rotation - Math.PI / 8); });
  document.getElementById('rotate-right')!.addEventListener('click', () => { sourceText.textContent = '手动按钮（不是摄像头验证）'; setRotation(rotation + Math.PI / 8); });
  document.getElementById('reset-btn')!.addEventListener('click', () => { streak = 0; lastGesture = null; setRotation(0); setState('gather', '手动重置（不是摄像头验证）'); });
  startButton.addEventListener('click', startCamera); stopButton.addEventListener('click', () => stopCamera());
  document.getElementById('particle-count')!.textContent = String(particles.length);
  document.getElementById('scene-title')!.textContent = scene.title;
  document.getElementById('gesture-map')!.textContent = `张掌 → ${scene.mappings.openPalm}；握拳 → ${scene.mappings.closedFist}；手掌横移 → ${scene.mappings.palmX === 'rotate' ? '旋转' : '不启用旋转'}。连续 ${config.debounceFrames} 帧确认，几何门限未进行人群准确率校准。`;
  Object.defineProperty(window, '__cameraSceneEvidence', { value: Object.freeze({ snapshot }), writable: false, configurable: false });
  if (config.gateMode) {
    installGateHooks?.(Object.freeze({ feed: (value: { gesture: CameraGesture; palmX?: number }) => { if (value && ['openPalm', 'closedFist', null].includes(value.gesture)) sample({ gesture: value.gesture, palmX: value.palmX ?? null }, '合成 landmark 驱动（不是实机摄像头）'); return snapshot(); }, feedLandmarks: (value: CameraLandmark[]) => { sample(classifyCameraLandmarks(value), '合成 landmark 驱动（不是实机摄像头）'); return snapshot(); }, snapshot }));
    startButton.disabled = true; setStatus('场景 Gate 使用合成输入；摄像头、视觉模型与完整需求未验收。', 'synthetic');
  }
  window.addEventListener('resize', resize);
  const motionChange = () => { cancelAnimationFrame(animationId); resize(); if (!reducedMotion.matches) animationId = requestAnimationFrame(animate); };
  reducedMotion.addEventListener('change', motionChange);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera('页面已隐藏，摄像头与识别已停止。重新开始需手动点击。', 'off'); });
  const dispose = () => { disposed = true; stopCamera('页面已关闭，摄像头与识别已停止。', 'off'); cancelAnimationFrame(animationId); window.removeEventListener('resize', resize); reducedMotion.removeEventListener('change', motionChange); };
  window.addEventListener('pagehide', dispose, { once: true });
  resize(); if (!reducedMotion.matches) animationId = requestAnimationFrame(animate);
}

export const CAMERA_RUNTIME_SOURCE = `"use strict";const __name=(value,_name)=>value;\n${classifyCameraLandmarks.toString()}\n${createCameraParticles.toString()}\n(${cameraClient.toString()})();`;
export const CAMERA_GATE_RUNTIME_SOURCE = CAMERA_RUNTIME_SOURCE.replace(/\(\)\;$/, `(hooks=>Object.defineProperty(window,'__cameraSceneTest',{value:hooks,writable:false,configurable:false}));`);
export const CAMERA_RUNTIME_STYLE = `:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#f1f5f9}*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere}main{max-width:1120px;margin:auto;padding:28px 24px}h1{font-size:clamp(26px,4vw,40px);line-height:1.2;margin:8px 0 14px}.eyebrow{color:#93c5fd;font-size:12px;letter-spacing:.13em}.caption,p{line-height:1.6;color:#cbd5e1}.boundary{padding:14px 18px;background:#1e293b;border-left:3px solid #60a5fa;border-radius:6px}canvas{display:block;width:100%;height:clamp(300px,52vw,520px);border:1px solid #334155;border-radius:18px;background:#0f172a}.stage{position:relative;margin:24px 0}video{position:absolute;right:14px;bottom:14px;width:min(28%,200px);border:1px solid #64748b;border-radius:8px;transform:scaleX(-1);pointer-events:none}video[hidden]{display:none}.controls{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}button{min-height:44px;padding:10px 18px;border:1px solid #475569;border-radius:10px;background:#1e293b;color:#f1f5f9;font:inherit;font-weight:600;cursor:pointer}button:hover:not(:disabled){background:#334155}button:disabled{opacity:.55;cursor:not-allowed}button.primary{background:#2563eb;border-color:#3b82f6}button.danger{border-color:#f87171}button:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}.stats{display:flex;gap:22px;flex-wrap:wrap;padding:12px 0;color:#cbd5e1}.stats strong{color:#f8fafc}code{font-family:ui-monospace,SFMono-Regular,monospace}.camera-panel{border:1px solid #334155;border-radius:16px;padding:18px;margin-top:24px}.camera-panel h2{margin:0;font-size:20px}#camera-status{min-height:48px}#camera-status[data-status=error]{color:#fecaca}.caption{font-size:14px}a{color:#93c5fd}@media(max-width:480px){main{padding:20px 14px}.controls button{flex:1 1 auto}.stats{gap:12px}video{width:30%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

function base64Hex(hex: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let result = '';
  const bytes = hex.match(/.{2}/g)!.map(value => parseInt(value, 16));
  for (let index = 0; index < bytes.length; index += 3) { const value = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0); result += alphabet[(value >>> 18) & 63] + alphabet[(value >>> 12) & 63] + (index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') + (index + 2 < bytes.length ? alphabet[value & 63] : '='); }
  return result;
}
export const CAMERA_RUNTIME_HASH = sha256(CAMERA_RUNTIME_SOURCE);
export const CAMERA_RUNTIME_CSP_HASH = `sha256-${base64Hex(CAMERA_RUNTIME_HASH)}`;
export const CAMERA_GATE_RUNTIME_HASH = sha256(CAMERA_GATE_RUNTIME_SOURCE);
export const CAMERA_GATE_RUNTIME_CSP_HASH = `sha256-${base64Hex(CAMERA_GATE_RUNTIME_HASH)}`;
export const CAMERA_STYLE_CSP_HASH = `sha256-${base64Hex(sha256(CAMERA_RUNTIME_STYLE))}`;
function safeJson(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

export function renderCameraSceneHtml(input: CameraSceneConfig, options: { gateMode?: boolean; mode?: 'gate' | 'camera'; assetBase?: string } = {}): string {
  const scene = cameraSceneSchema.parse(input);
  const assetBase = options.assetBase ?? '/api/production/camera-assets/';
  if (!['/api/production/camera-assets/', '/camera-assets/'].includes(assetBase)) throw new Error('Camera runtime only permits fixed same-origin asset paths');
  const gateMode = options.gateMode === true || options.mode === 'gate';
  const runtimeSource = gateMode ? CAMERA_GATE_RUNTIME_SOURCE : CAMERA_RUNTIME_SOURCE;
  const csp = `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src '${gateMode ? CAMERA_GATE_RUNTIME_CSP_HASH : CAMERA_RUNTIME_CSP_HASH}' 'self' 'wasm-unsafe-eval'; style-src '${CAMERA_STYLE_CSP_HASH}'; connect-src 'self'; worker-src 'self'; img-src 'none'; media-src blob:; frame-src 'none'`;
  const payload = safeJson({ scene, gateMode, assetBase, runtimeVersion: CAMERA_RUNTIME_VERSION, geometryVersion: CAMERA_GEOMETRY_VERSION, debounceFrames: CAMERA_DEBOUNCE_FRAMES });
return `<!doctype html><html lang="zh-CN" data-runtime-version="${CAMERA_RUNTIME_VERSION}" data-geometry-version="${CAMERA_GEOMETRY_VERSION}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>受控摄像头场景</title><style>${CAMERA_RUNTIME_STYLE}</style></head><body><main><p class="eyebrow">CONTROLLED SCENE / DECLARATIVE RUNTIME</p><h1 id="scene-title">正在载入场景</h1><p class="boundary">可信平台运行时 + 经校验的场景 JSON。场景行为通过不等于摄像头或完整需求通过；真实摄像头待实机验收。</p><div class="stage"><canvas id="scene-canvas" aria-label="声明式三维粒子场景"></canvas><video id="camera-video" autoplay playsinline muted hidden aria-label="仅本地显示的摄像头画面"></video></div><div class="stats"><span>状态 <strong id="scene-state">gather</strong></span><span>旋转 <strong id="rotation">0.0000</strong></span><span>粒子 <strong id="particle-count">0</strong></span></div><div class="controls" aria-label="独立手动场景控制"><button id="scatter" type="button">散开</button><button id="gather" type="button">聚合</button><button id="rotate-left" type="button">向左旋转</button><button id="rotate-right" type="button">向右旋转</button><button id="reset-btn" type="button">重置场景</button></div><p class="caption" id="interaction-source">手动按钮模式（不是摄像头验证）</p><section class="camera-panel" aria-labelledby="camera-heading"><h2 id="camera-heading">本机摄像头手势</h2><p id="gesture-map"></p><div class="controls"><button id="camera-start" class="primary" type="button">开启摄像头</button><button id="camera-stop" class="danger" type="button" disabled>停止摄像头</button></div><p id="camera-status" data-status="off" data-state="stopped" role="status" aria-live="polite">摄像头默认关闭。仅用户点击后请求视频权限，不请求音频。</p><p class="caption">识别使用本地固定版本 MediaPipe Worker；没有画面上传、录制或日志。停止、页面隐藏与关闭会释放摄像头和识别资源；资产失败不外联回退。手动控制只是备用交互，不能替代摄像头验收。</p></section></main><script id="camera-scene-config" type="application/json">${payload}</script><script>${runtimeSource}</script></body></html>`;
}
