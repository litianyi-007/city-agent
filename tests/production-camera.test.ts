import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { chromium } from 'playwright';
import { cameraSceneSchema, type CameraSceneConfig } from '../shared/camera-scene-schema.js';
import { productionRunInputSchema } from '../shared/production-schema.js';
import { CAMERA_ASSET_MANIFEST } from '../shared/camera-asset-manifest.js';
import { createProductionService, productionReport, readPinnedCameraAsset, verifyCameraAssets } from '../server/production/index.js';
import { runCameraSceneGate, cameraRuntimeMetadata } from '../server/production/camera-gate.js';
import { CAMERA_PROMPT_VERSION, CAMERA_ACCEPTANCE_VERSION, contractProfile, PROMPT_VERSION, ACCEPTANCE_CONTRACT_VERSION } from '../server/production/contracts.js';
import { buildJevCandidateRequest } from '../server/production/jev.js';
import type { ProductionOptions } from '../server/production/pipeline.js';
import type { runRole } from '../server/harness.js';
import type { AcceptanceCheck } from '../server/gate.js';

const branch = fileURLToPath(new URL('../', import.meta.url));
const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Synthetic geometry fixture', background: '#101827', palette: ['#facc15', '#67e8f9'], objects: [{ id: 'shape', primitive: 'cone', position: [0, 0, 0], scale: [3, 5, 3], count: 160, color: '#67e8f9' }, { id: 'detail', primitive: 'star', position: [0, 5, 0], scale: [1, 1, 1], count: 40, color: '#facc15' }], snowCount: 10, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };
const checks: AcceptanceCheck[] = [
  { name: 'scatter actual state', steps: [{ action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }] },
  { name: 'gather and rotate actual state', steps: [{ action: 'click', selector: '#scatter' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }, { action: 'assertChanged', selector: '#rotation', after: { action: 'click', selector: '#rotate-right' } }] },
];
const roleCall: typeof runRole = async (_agent, system, prompt) => {
  const data = JSON.parse(prompt); let value: unknown;
  if (system.startsWith('你是独立质量Verifier')) value = { decision: 'accept', selectedCandidateId: data.candidates[0].id, scores: data.candidates.map((candidate: { id: string }) => ({ candidateId: candidate.id, score: 4, reason: 'Injected test review, no provider call' })), reason: 'Free injected review' };
  else if (system.includes('"goal"')) value = { goal: data.input.brief, scope: 'camera-scene-v1', acceptance: [data.input.requirement.acceptance], exclusions: ['Actual vision/physical camera acceptance pending'] };
  else if (system.includes('"observations"')) value = { observations: ['Provided material only'], constraints: ['Strict declarative scene'], unknowns: ['Physical camera unverified'] };
  else if (system.includes('"decision"')) value = { decision: data.context.gate?.passed === false ? 'revise' : 'proceed', summary: 'Synthetic scene scope only; hardware unverified', tasks: [{ id: 'scene', owner: 'developer', description: 'Return strict JSON scene' }], risks: ['Physical acceptance pending'] };
  else if (system.includes('"checks"')) value = { checks };
  else value = { scene };
  return { text: JSON.stringify(value), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Free injected engineering test' };
};
async function setup(t: TestContext, options: ProductionOptions = {}) {
  const directory = mkdtempSync(path.join(branch, '.city-agent-camera-unit-')); const service = createProductionService(directory, { roleCall, ...options }); const app = express(); app.use(express.json()); app.use('/api/production', service.router); const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request = (route: string, body?: unknown, method = 'GET') => fetch(`http://127.0.0.1:${address.port}/api/production${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  t.after(async () => { await service.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of service.store.agents()) service.store.patchAgent(agent.id, { apiKey: `camera-fixture-key-${agent.role}`, pricing: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } });
  const input = productionRunInputSchema.parse({ mode: 'live', capability: 'camera-scene-v1', brief: 'Generate an interactive particle scene controlled by camera gestures', agentIds: service.store.agents().map(agent => agent.id), budgetAuthorized: true, requirement: { id: 'unit-camera', source: 'Free injected engineering regression, not real user execution', acceptance: 'Actual particle canvas, scatter/gather/rotate and camera interaction. Physical camera remains pending.', kind: 'illustrative' } });
  const wait = async (id: string) => { const end = Date.now() + 30000; while (Date.now() < end) { if (!service.pipeline.busy) return service.store.run(id)!; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Camera engineering test timeout'); };
  return { service, directory, request, input, wait };
}

test('camera scene strict schema rejects executable payloads, URLs, duplicate IDs, overbudget geometry and identical gestures', () => {
  assert.equal(cameraSceneSchema.safeParse(scene).success, true);
  for (const changed of [{ ...scene, script: 'evil()' }, { ...scene, title: '<img src=x>' }, { ...scene, background: 'https://outside.invalid' }, { ...scene, objects: [...scene.objects, scene.objects[0]] }, { ...scene, objects: Array.from({ length: 3 }, (_, i) => ({ ...scene.objects[0], id: `part-${i}`, count: 1000 })) }, { ...scene, mappings: { ...scene.mappings, openPalm: 'gather' } }, { ...scene, objects: [{ ...scene.objects[0], scale: [0, 1, 1] }] }]) assert.equal(cameraSceneSchema.safeParse(changed).success, false);
});

test('old capability remains default/v2; camera requires live and uses its own scoped prompts and Jev rubric', () => {
  assert.equal(contractProfile().promptVersion, PROMPT_VERSION); assert.equal(contractProfile().acceptanceVersion, ACCEPTANCE_CONTRACT_VERSION); assert.equal(contractProfile('camera-scene-v1').promptVersion, CAMERA_PROMPT_VERSION);
  const base = { brief: 'Free schema fixture', agentIds: Array(6).fill('00000000-0000-4000-8000-000000000001'), requirement: { id: 'unit', source: 'unit', acceptance: 'unit' } };
  assert.equal(productionRunInputSchema.parse(base).capability, 'offline-single-html'); assert.equal(productionRunInputSchema.safeParse({ ...base, capability: 'camera-scene-v1', mode: 'demo' }).success, false);
  const request = buildJevCandidateRequest('jev-1.13.0', { phase: 'implement', goal: 'camera', acceptance: 'physical camera required', frozenHash: 'frozen', capability: 'camera-scene-v1', candidates: [{ id: 'valid', value: { scene } }] });
  assert.match(request.questions.c0_scope.instructions, /physical camera/); assert.match(request.questions.c0_safe.instructions, /model code/); assert.match(request.questions.best.instructions, /unverified/);
});

test('real restricted Chromium verifies Canvas, particles, manual actions and synthetic landmark geometry without camera grant', async () => {
  const gate = await runCameraSceneGate(scene, checks); assert.equal(gate.passed, true, JSON.stringify(gate)); assert.equal(gate.evidenceScope, 'scene-behavior-synthetic'); assert.match(gate.summary!, /未验证真实视觉模型/); assert.ok(gate.checks.some(check => check.name.includes('合成21点')));
  const swapped = { ...scene, mappings: { openPalm: 'gather' as const, closedFist: 'scatter' as const, palmX: 'none' as const } }; assert.equal((await runCameraSceneGate(swapped, checks)).passed, true);
});

test('camera gate rejects wrong frozen behavior and invisible canvas instead of accepting status text alone', async () => {
  const badChecks = checks.map(check => ({ ...check, steps: check.steps.map(step => step.action === 'assertTextExact' ? { ...step, text: 'impossible-state' } : step) })); assert.equal((await runCameraSceneGate(scene, badChecks)).passed, false);
  const invisible = { ...scene, snowCount: 0, objects: scene.objects.map(object => ({ ...object, color: scene.background })) }; const gate = await runCameraSceneGate(invisible, checks); assert.equal(gate.passed, false); assert.match(gate.checks.at(-1)!.detail!, /Canvas/);
});

test('camera gate respects preexisting cancellation without resources or camera permission', async () => { const controller = new AbortController(); controller.abort(); await assert.rejects(runCameraSceneGate(scene, checks, controller.signal), { name: 'AbortError' }); });

test('camera assets are fixed allowlist/hash verified; model config cannot select paths, symlinks or corrupt local bytes', t => {
  if (CAMERA_ASSET_MANIFEST.assets.some(pin => !existsSync(path.join(branch, 'public', 'camera-assets', pin.filename)))) { t.skip('Pinned local camera assets are not prepared; asset-serving integration is unverified, not passed'); return; } assert.equal(verifyCameraAssets().ready, true); const pin = CAMERA_ASSET_MANIFEST.assets[0]; assert.equal(readPinnedCameraAsset(pin.filename).value.length, pin.bytes); assert.throws(() => readPinnedCameraAsset('../state.json'), /白名单/);
  const directory = mkdtempSync(path.join(branch, '.city-agent-camera-assets-unit-')); t.after(() => rmSync(directory, { recursive: true, force: true })); mkdirSync(path.join(directory, 'ordinary')); writeFileSync(path.join(directory, 'ordinary', pin.filename), Buffer.alloc(pin.bytes)); assert.throws(() => readPinnedCameraAsset(pin.filename, path.join(directory, 'ordinary')), /Hash/); symlinkSync(path.join(directory, 'ordinary'), path.join(directory, 'alias')); assert.throws(() => readPinnedCameraAsset(pin.filename, path.join(directory, 'alias')), /目录/);
});

test('injected six-role camera delivery freezes new profile and source/runtime lineage, never counts full camera success', async t => {
  const { request, input, wait, service } = await setup(t); const queued = await request('/runs', input, 'POST'); assert.equal(queued.status, 202, await queued.clone().text()); const run = await wait((await queued.json()).id);
  assert.equal(run.status, 'completed', run.error); assert.equal(run.evidenceKind, 'injected-test'); assert.equal(run.calls.length, 12); assert.equal(run.frozenContract?.version, CAMERA_ACCEPTANCE_VERSION); assert.equal(run.frozenContract?.runtimeHash, cameraRuntimeMetadata().hash); assert.equal(run.calls.every(call => call.promptVersion === CAMERA_PROMPT_VERSION), true);
  assert.equal(run.cameraVerification?.boundedScenePassed, true); assert.equal(run.cameraVerification?.physicalCameraVerified, false); assert.equal(run.cameraVerification?.visionModelVerified, false); assert.equal(run.cameraVerification?.fullRequirementVerified, false);
  const manifest = JSON.parse(service.store.readArtifact(run.id, 'delivery-manifest.json')); assert.equal(manifest.source, 'scene.json'); assert.equal(manifest.capability, 'camera-scene-v1'); assert.equal(manifest.cameraVerification.fullRequirementVerified, false);
  const response = await request(`/runs/${run.id}/scene-preview`); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/); assert.match(response.headers.get('content-security-policy')!, /\/api\/production\/camera-assets\//); assert.doesNotMatch(response.headers.get('content-security-policy')!, /'(?:unsafe-inline|unsafe-eval)'/); assert.match(response.headers.get('permissions-policy')!, /microphone=\(\)/); const html = await response.text(); assert.match(html, /scene-canvas/); assert.doesNotMatch(html, /__cameraSceneTest/);
  const source = await request(`/runs/${run.id}/artifacts/index.html`); assert.match(source.headers.get('content-type')!, /^text\/plain/); assert.match(source.headers.get('content-disposition')!, /attachment/);
  const claimedReal = { ...run, evidenceKind: 'real-model' as const }; const report = productionReport([claimedReal]); assert.equal(report.metrics.realModelPassed, 0); assert.equal(report.metrics.goodProductRate, 0); assert.equal(report.cameraAcceptanceMetrics.boundedScenePassed, 1); assert.equal(report.cameraAcceptanceMetrics.fullRequirementVerified, 0);
  service.store.writeArtifact(run.id, 'index.html', '<script>throw new Error("untrusted artifact must not execute")</script>'); assert.equal((await request(`/runs/${run.id}/scene-preview`)).status, 200, 'preview interprets validated scene, never stored HTML');
  const runtimeManifest = JSON.parse(service.store.readArtifact(run.id, 'camera-runtime-manifest.json')); service.store.writeArtifact(run.id, 'camera-runtime-manifest.json', JSON.stringify({ ...runtimeManifest, hash: 'stale-runtime' })); const stale = await request(`/runs/${run.id}/scene-preview`); assert.equal(stale.status, 400); assert.match(await stale.text(), /新版本实验/);
});

test('invalid camera developer code is retained as rejected raw evidence without scene/HTML template fallback', async t => {
  const invalid: typeof runRole = async (...args) => { if (args[1].startsWith('返回严格JSON {"scene"')) return { text: JSON.stringify({ scene, html: '<script>evil()</script>' }), inputTokens: 100, outputTokens: 100, usageReported: true, harness: 'Injected' }; return roleCall(...args); };
  const { request, input, wait } = await setup(t, { roleCall: invalid }); const run = await wait((await (await request('/runs', input, 'POST')).json()).id); assert.equal(run.status, 'failed'); assert.match(run.error!, /全部候选非法/); assert.equal(run.artifacts.some(artifact => artifact.name === 'scene.json' || artifact.name === 'index.html'), false); assert.ok(run.calls.some(call => call.rawOutput.includes('evil()') && call.error?.includes('候选契约拒绝')));
});

test('camera repairs stay bounded with identical frozen tests/runtime and cannot convert hardware pending into verified', async t => {
  let count = 0; const seen: string[] = []; const gate: NonNullable<ProductionOptions['cameraGate']> = async (_scene, frozen) => { count++; seen.push(JSON.stringify(frozen)); return { passed: false, checks: [{ name: 'Synthetic fixture failure', passed: false }], evidenceScope: 'scene-behavior-synthetic', summary: 'Injected failure' }; };
  const { request, input, wait } = await setup(t, { cameraGate: gate }); const run = await wait((await (await request('/runs', input, 'POST')).json()).id); assert.equal(run.status, 'failed'); assert.equal(run.repairs, 2); assert.equal(count, 3); assert.equal(new Set(seen).size, 1); assert.match(run.error!, /返修次数耗尽/); assert.equal(run.cameraVerification?.physicalCameraVerified, false); assert.equal(run.artifacts.some(artifact => artifact.name === 'scene.json'), false);
});

test('camera cancellation aborts pending Gate and preserves intervention, with no hidden continuation', async t => {
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); let stopped = false;
  const { request, input, wait } = await setup(t, { cameraGate: async (_scene, _checks, signal) => { entered(); return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => { stopped = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true })); } }); const queued = await request('/runs', input, 'POST'); const id = (await queued.json()).id; await started; await request(`/runs/${id}/cancel`, undefined, 'POST'); const run = await wait(id); assert.equal(run.status, 'cancelled'); assert.equal(stopped, true); assert.equal(run.interventions.length, 1); assert.equal(run.cameraVerification?.boundedScenePassed, false); assert.equal(run.calls.some(call => call.phase === 'feedback-0'), false);
});

test('camera Gate preserves CSS environment failure and types its own mandatory-browser launch failure', async () => {
  const original = chromium.launch;
  try {
    chromium.launch = async () => { throw new Error('Injected missing Chromium'); };
    const inherited = await runCameraSceneGate(scene, checks); assert.equal(inherited.failureKind, 'infrastructure'); assert.equal(inherited.passed, false); assert.equal(inherited.evidenceScope, 'scene-behavior-synthetic');
    let calls = 0;
    chromium.launch = async options => { if (++calls === 2) throw new Error('Injected mandatory browser unavailable'); return original.call(chromium, options); };
    const mandatory = await runCameraSceneGate(scene, checks); assert.equal(calls, 2); assert.equal(mandatory.failureKind, 'infrastructure'); assert.equal(mandatory.passed, false); assert.equal(mandatory.checks.at(-1)!.name, '强制场景行为Gate');
  } finally { chromium.launch = original; }
});
