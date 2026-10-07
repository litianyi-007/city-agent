export const CAMERA_HAND_WORKER_VERSION = 'camera-hand-worker-v1';

function cameraWorker() {
  const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown) => void; close: () => void };
  type Detector = { detectForVideo: (bitmap: ImageBitmap, timestamp: number) => { landmarks?: Array<Array<{ x: number; y: number; z: number }>> }; close: () => void };
  let detector: Detector | null = null; let generation = 0; let initializing = false; let lastTimestamp = -1;
  const failure = () => scope.postMessage({ type: 'ERROR', code: 'LOCAL_MODEL_FAILURE' });
  async function initialize(assetBase: string) {
    if (initializing || detector || !['/api/production/camera-assets/', '/camera-assets/'].includes(assetBase)) { failure(); return; }
    const currentGeneration = ++generation; initializing = true;
    try {
      // Classic worker preserves SDK importScripts support; no vendor source rewriting.
      const vision = await import(assetBase + 'vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(assetBase.replace(/\/$/, ''));
      const created: Detector = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: assetBase + 'hand_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      if (currentGeneration !== generation) { created.close(); return; }
      detector = created; scope.postMessage({ type: 'READY', workerVersion: 'camera-hand-worker-v1', modelPackageVersion: '0.10.32' });
    } catch { if (currentGeneration === generation) failure(); }
    finally { if (currentGeneration === generation) initializing = false; }
  }
  scope.onmessage = event => {
    const value = event.data;
    if (value?.type === 'INIT') { void initialize(value.assetBase); return; }
    if (value?.type === 'STOP') { generation++; detector?.close(); detector = null; scope.postMessage({ type: 'STOPPED' }); scope.close(); return; }
    if (value?.type !== 'FRAME') return;
    const bitmap = value.bitmap as ImageBitmap;
    try {
      if (!bitmap || typeof bitmap.close !== 'function' || !detector || !Number.isFinite(value.timestampMs) || value.timestampMs <= lastTimestamp || bitmap.width > 640 || bitmap.height > 480) { failure(); return; }
      lastTimestamp = value.timestampMs;
      const result = detector.detectForVideo(bitmap, value.timestampMs);
      const points = result.landmarks?.[0] ?? [];
      const landmarks = points.length === 21 && points.every(point => [point.x, point.y, point.z].every(Number.isFinite)) ? points.map(point => ({ x: point.x, y: point.y, z: point.z })) : [];
      scope.postMessage({ type: 'RESULT', landmarks });
    } catch { failure(); }
    finally { bitmap?.close(); }
  };
}

export const CAMERA_HAND_WORKER_SOURCE = `"use strict";const __name=(value,_name)=>value;\n(${cameraWorker.toString()})();`;
export function renderCameraHandWorkerSource() { return CAMERA_HAND_WORKER_SOURCE; }
