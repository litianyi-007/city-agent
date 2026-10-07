import { chromium, type Browser } from 'playwright';
import { cameraSceneSchema, type CameraSceneConfig } from '../../shared/camera-scene-schema.js';
import { createCameraParticles, renderCameraSceneHtml } from '../../shared/camera-scene-runtime.js';
import { VERIFIER_SCENE_ORACLE_VERSION, type VerifierScenePool } from '../../shared/production-verifier-scene-corpus.js';
import { runCameraSceneGate } from './camera-gate.js';
import type { AcceptanceCheck } from '../gate.js';

/** Independent benchmark Oracle; not part of production delivery or the camera Gate. */
export interface VerifierSceneOracleResult {
  version: typeof VERIFIER_SCENE_ORACLE_VERSION;
  evidenceKind: 'outer-authored-challenge-oracle';
  passed: boolean;
  failureKind?: 'infrastructure' | 'timeout';
  business: { name: string; passed: boolean; detail?: string }[];
  gate: Awaited<ReturnType<typeof runCameraSceneGate>>;
  componentPixels?: { left: number; right: number; total: number; width: number; height: number; cameraActive: false };
  componentDiagnostics?: { primitive: 'cone' | 'star'; gate: Awaited<ReturnType<typeof runCameraSceneGate>> }[];
  modelRequests: 0;
}
const URL = 'https://verifier-scene-oracle.invalid/';
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";

/** Pixel evidence on the ORIGINAL scene, not just each isolated derived object. */
async function originalComponentPixels(scene: CameraSceneConfig, signal?: AbortSignal): Promise<NonNullable<VerifierSceneOracleResult['componentPixels']>> {
  signal?.throwIfAborted();
  let browser: Browser | undefined; let stopping = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined; let operation: Promise<NonNullable<VerifierSceneOracleResult['componentPixels']>> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= browser?.close() ?? Promise.resolve();
  const stopped = new Promise<never>((_, reject) => {
    const stop = (error: Error) => { stopping = true; reject(error); if (browser) void close().catch(() => undefined); };
    abort = () => stop(new DOMException('Scene challenge pixel Oracle cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => stop(new Error('Scene challenge pixel Oracle timed out')), 12_000);
  });
  try {
    operation = (async () => {
      browser = await chromium.launch({ headless: true, timeout: 8000, args: ['--js-flags=--max-old-space-size=128'] });
      if (stopping || signal?.aborted) { await close(); throw new DOMException('Scene pixel Oracle stopped', 'AbortError'); }
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: false });
      const faults: string[] = []; let served = false;
      context.on('page', page => { if (served) { faults.push('Unexpected popup'); void page.close().catch(() => undefined); } });
      await context.addInitScript({ content: `(() => {
        const backgrounds = new WeakMap(); const original = CanvasRenderingContext2D.prototype.fillRect;
        CanvasRenderingContext2D.prototype.fillRect = function(x,y,w,h) {
          original.call(this,x,y,w,h); const c=this.canvas;
          if(c.id!=='scene-canvas'||x!==0||y!==0||w!==c.width||h!==c.height||!w||!h)return;
          const previous=backgrounds.get(c); backgrounds.set(c,{width:w,height:h,count:(previous?.count??0)+1,bytes:this.getImageData(0,0,w,h).data});
        };
        Object.defineProperty(window,'__verifierOriginalPixels',{configurable:false,writable:false,value:() => {
          const c=document.querySelector('#scene-canvas'); const b=backgrounds.get(c); if(!b||b.count<2||b.width!==c.width||b.height!==c.height)throw new Error('Missing actual background baseline');
          const actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let left=0,right=0;
          for(let i=0;i<actual.length;i+=4)if(actual[i]!==b.bytes[i]||actual[i+1]!==b.bytes[i+1]||actual[i+2]!==b.bytes[i+2]||actual[i+3]!==b.bytes[i+3]){const x=(i/4)%c.width;if(x<c.width/2)left++;else right++;}
          return {left,right,total:left+right,width:c.width,height:c.height,cameraActive:window.__cameraSceneTest.snapshot().cameraActive};
        }});
      })();` });
      await context.route('**/*', async route => {
        const request = route.request();
        if (!served && request.isNavigationRequest() && request.url() === URL) { served = true; await route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': CSP }, body: renderCameraSceneHtml(scene, { mode: 'gate' }) }); }
        else { faults.push('Unexpected network/navigation'); await route.abort('blockedbyclient'); }
      });
      const page = await context.newPage();
      page.on('pageerror', () => faults.push('Trusted renderer JavaScript failure'));
      page.on('dialog', dialog => { faults.push('Unexpected dialog'); void dialog.dismiss(); });
      page.on('download', download => { faults.push('Unexpected download'); void download.cancel(); });
      await page.goto(URL, { waitUntil: 'load', timeout: 3000 });
      const result = await page.evaluate(() => (window as unknown as { __verifierOriginalPixels: () => { left: number; right: number; total: number; width: number; height: number; cameraActive: boolean } }).__verifierOriginalPixels());
      // Region geometry below assumes the fixed trusted renderer at this
      // viewport: min(canvas.width, canvas.height)=520, not an arbitrary size.
      if (faults.length || page.url() !== URL || result.cameraActive !== false || result.width < 520 || result.height !== 520) throw new Error('Invalid scene pixel execution environment');
      return { ...result, cameraActive: false as const };
    })();
    if (signal?.aborted) abort?.();
    return await Promise.race([operation, stopped]);
  } finally { stopping = true; if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); if (browser) await close().catch(() => undefined); await operation?.catch(() => undefined); }
}

export async function runVerifierSceneOracle(pool: VerifierScenePool, input: CameraSceneConfig, signal?: AbortSignal): Promise<VerifierSceneOracleResult> {
  signal?.throwIfAborted();
  const scene = cameraSceneSchema.parse(input); const required = pool.required;
  const business: VerifierSceneOracleResult['business'] = [];
  const ensure = (name: string, passed: boolean, detail?: string) => business.push({ name, passed, ...(!passed && detail ? { detail } : {}) });
  ensure('精确标题', scene.title === required.title);
  ensure('业务掌拳与横移映射', (['openPalm', 'closedFist', 'palmX'] as const).every(key => scene.mappings[key] === required.mappings[key]));
  const count = scene.objects.reduce((sum, object) => sum + object.count, 0);
  if (required.total !== undefined) ensure('业务总粒子数量', count + scene.snowCount === required.total);
  if (required.objectCount !== undefined) ensure('业务主体粒子数量', count === required.objectCount);
  if (required.snowCount !== undefined) ensure('业务雪粒子数量', scene.snowCount === required.snowCount);
  const gate = await runCameraSceneGate(scene, structuredClone(pool.checks) as AcceptanceCheck[], signal);
  const result: VerifierSceneOracleResult = { version: VERIFIER_SCENE_ORACLE_VERSION, evidenceKind: 'outer-authored-challenge-oracle', passed: false, business, gate, modelRequests: 0 };
  if (gate.failureKind) result.failureKind = gate.failureKind;
  if (required.primitives) {
    for (const primitive of required.primitives) ensure(`业务非零${primitive}主体`, scene.objects.some(object => object.primitive === primitive && object.count > 0));
    // Before interpreting a half-canvas pixel count, verify that all actual
    // projected particle/glow bounds for each existing primitive stay on its
    // specified half. Thus one component cannot supply the other's pixels.
    if (required.componentRegions) {
      ensure('业务无雪组件区域', scene.snowCount === 0 && scene.objects.every(object => required.primitives!.includes(object.primitive as 'cone' | 'star')));
      // The renderer seed depends on the WHOLE scene JSON. Slice the actual
      // original particle order; filtering objects before generation would
      // change that seed and would not prove bounds on the original frame.
      const originalParticles = createCameraParticles(scene);
      let offset = 0;
      const objectParticles = scene.objects.map(object => {
        const particles = originalParticles.slice(offset, offset + object.count); offset += object.count;
        return { primitive: object.primitive, particles };
      });
      for (const primitive of required.primitives) {
        const particles = objectParticles.filter(item => item.primitive === primitive).flatMap(item => item.particles);
        const inside = particles.length > 0 && particles.every(point => {
          const depth = 38 / Math.max(16, 38 + point.z); const x = 260 + point.x * (520 / 27) * depth;
          const radius = Math.max(1, Math.min(4.5, depth * 1.8)) * 3.2;
          return primitive === 'cone' ? x - radius >= 0 && x + radius < 260 : x - radius > 260 && x + radius <= 520;
        });
        ensure(`业务${primitive}区域不串扰`, inside);
      }
      try {
        result.componentPixels = await originalComponentPixels(scene, signal);
        ensure('原场景左侧圆锥像素', result.componentPixels.left > 0);
        ensure('原场景右侧星形像素', result.componentPixels.right > 0);
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Scene Oracle cancelled', 'AbortError');
        result.failureKind = error instanceof Error && /timed out/.test(error.message) ? 'timeout' : 'infrastructure';
        ensure('原场景独立像素执行', false, error instanceof Error ? error.message : String(error));
      }
    }
    result.componentDiagnostics = [];
    for (const primitive of required.primitives) {
      const objects = scene.objects.filter(object => object.primitive === primitive);
      if (!objects.length) continue; // absence is a business failure above, not a made-up execution
      const derivedGate = await runCameraSceneGate({ ...scene, objects, snowCount: 0 }, structuredClone(pool.checks) as AcceptanceCheck[], signal);
      result.componentDiagnostics.push({ primitive, gate: derivedGate });
      if (derivedGate.failureKind) result.failureKind = derivedGate.failureKind;
      ensure(`独立${primitive}无雪派生实际可见`, derivedGate.passed);
    }
  }
  result.passed = !result.failureKind && gate.passed && business.every(check => check.passed);
  return result;
}
