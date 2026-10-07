import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraSceneSchema, type CameraSceneConfig } from '../shared/camera-scene-schema.js';
import { createCameraParticles } from '../shared/camera-scene-runtime.js';
import { runCameraSceneGate } from '../server/production/camera-gate.js';
import type { AcceptanceCheck } from '../server/gate.js';

const visible: CameraSceneConfig = cameraSceneSchema.parse({ version: 'camera-scene-v1', title: '工程可见性反例', background: '#081020', palette: ['#ffffff'], objects: [{ id: 'geometry', primitive: 'cone', position: [0, 0, 0], scale: [3, 5, 3], count: 120, color: '#38bdf8' }], snowCount: 0, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } });
const checks: AcceptanceCheck[] = [
  { name: '状态文本交互', steps: [{ action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }] },
  { name: '旋转文本交互', steps: [{ action: 'assertChanged', selector: '#rotation', after: { action: 'click', selector: '#rotate-right' } }] },
];
const clipped = (): CameraSceneConfig => cameraSceneSchema.parse({ ...visible, objects: [{ ...visible.objects[0], position: [-12, 10, -12], scale: [0.1, 0.1, 0.1] }] });

test('initial visible particles pass the mandatory background-only pixel comparison without changing frozen checks', async () => {
  const before = JSON.stringify(checks);
  const gate = await runCameraSceneGate(visible, checks);
  assert.equal(gate.passed, true, JSON.stringify(gate));
  assert.equal(gate.evidenceScope, 'scene-behavior-synthetic');
  assert.equal(JSON.stringify(checks), before);
  assert.ok(gate.checks.some(check => check.name === '强制：真实Canvas绘制与有界粒子配置' && check.passed));
  assert.ok(gate.checks.some(check => check.name.includes('合成21点') && check.passed));
});

test('a background glow cannot hide fully clipped initial geometry even if scatter and right rotation would later reveal it', async () => {
  const scene = clipped();
  // The fixed 1280px Gate viewport gives a 520px Canvas. Including the
  // renderer's maximum glow radius, every initial arc is above that Canvas.
  assert.ok(createCameraParticles(scene).every(particle => {
    const depth = 38 / Math.max(16, 38 + particle.z);
    const centerY = 260 - particle.y * (520 / 27) * depth;
    const glowRadius = Math.max(1, Math.min(4.5, depth * 1.8)) * 3.2;
    return centerY + glowRadius < 0;
  }));
  const gate = await runCameraSceneGate(scene, checks);
  assert.equal(gate.passed, false);
  assert.equal(gate.failureKind, undefined);
  assert.equal(gate.checks.filter(check => checks.some(frozen => frozen.name === check.name)).every(check => check.passed), true, 'Frozen text checks really pass; they do not prove visible geometry.');
  assert.match(gate.checks.at(-1)?.detail ?? '', /初始实际像素.*背景基线/);
});

test('passing visible status and count text is not a replacement for initially visible particle pixels', async () => {
  const scene = { ...clipped(), title: '所有检查通过' };
  const textChecks: AcceptanceCheck[] = [
    checks[0],
    { name: '静态成功与数量文本', steps: [{ action: 'assertTextExact', selector: '#scene-title', text: '所有检查通过' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#particle-count', text: '120' }] },
  ];
  const frozen = JSON.stringify(textChecks);
  const gate = await runCameraSceneGate(scene, textChecks);
  assert.equal(gate.passed, false);
  assert.equal(JSON.stringify(textChecks), frozen);
  assert.equal(gate.checks.filter(check => textChecks.some(checkSnapshot => checkSnapshot.name === check.name)).every(check => check.passed), true);
  assert.match(gate.checks.at(-1)?.detail ?? '', /仅状态文本不能作为可见粒子绘制证据/);
});

test('visible snow does not conceal a fully clipped object scene; the derived diagnostic leaves delivery data and frozen CSS intact', async () => {
  const scene = { ...clipped(), snowCount: 120 };
  const before = JSON.stringify({ scene, checks });
  const gate = await runCameraSceneGate(scene, checks);
  assert.equal(gate.passed, false);
  assert.equal(gate.failureKind, undefined);
  assert.equal(JSON.stringify({ scene, checks }), before);
  assert.ok(gate.checks.some(check => check.name === '强制：真实Canvas绘制与有界粒子配置' && check.passed), 'Visible snow passes the original initial pixel comparison.');
  assert.ok(gate.checks.some(check => check.name.includes('合成21点') && check.passed), 'Original mandatory actions must still execute before the additional diagnostic.');
  assert.match(gate.checks.at(-1)?.detail ?? '', /可见雪不能替代完全不可见对象/);
});
