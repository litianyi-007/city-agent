import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AcceptanceCheck } from '../server/gate.js';
import { ACCEPTANCE_SEMANTICS_VERSION, preflightAcceptanceSemantics } from '../server/production/acceptance-preflight.js';
import { testsSchema } from '../server/production/contracts.js';
import { demoChecks } from '../server/production/fixtures.js';
import { cameraTestSemantics, CAMERA_GESTURE_LABELS, CAMERA_TEST_SEMANTICS_VERSION } from '../shared/camera-test-semantics.js';
import { renderCameraSceneHtml } from '../shared/camera-scene-runtime.js';
import type { CameraSceneConfig } from '../shared/camera-scene-schema.js';

const camera = { capability: 'camera-scene-v1' } as const;
const wrap = (steps: AcceptanceCheck['steps']): AcceptanceCheck[] => [
  { name: 'Candidate under semantic review', steps },
  { name: 'Independent positive state behavior', steps: [{ action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }] },
];
const codes = (checks: AcceptanceCheck[], context = camera) => preflightAcceptanceSemantics(checks, context).issues.map(issue => issue.code);

test('semantic version and shared aliases are exact; this module is not a browser or full coverage oracle', () => {
  assert.equal(ACCEPTANCE_SEMANTICS_VERSION, 'production-acceptance-semantic-v2');
  assert.equal(cameraTestSemantics.version, CAMERA_TEST_SEMANTICS_VERSION);
  assert.equal(cameraTestSemantics.evidenceOwners.deferred.includes('physical camera'), true);
  for (const operation of ['create', 'feature', 'bugfix'] as const) assert.equal(preflightAcceptanceSemantics(demoChecks(operation)).valid, true);
});

test('unbound expected references are rejected without substituting or mutating candidate JSON', () => {
  for (const text of ['{{particleCount}}', '${total}', '<%=total%>', '{{}}']) {
    const checks = wrap([{ action: 'click', selector: '#submit' }, { action: 'assertTextExact', selector: '#result', text }]);
    const original = JSON.stringify(checks);
    assert.ok(preflightAcceptanceSemantics(checks).issues.some(issue => issue.code === 'unbound-expectation'));
    assert.equal(JSON.stringify(checks), original);
  }
});

test('explicit original literal template display remains compatible with offline HTML requirements', () => {
  const checks = wrap([{ action: 'fill', selector: '#input', value: '{{name}}' }, { action: 'click', selector: '#submit' }, { action: 'assertTextExact', selector: '#result', text: '{{name}}' }]);
  assert.equal(preflightAcceptanceSemantics(checks, { brief: 'Show the literal string {{name}}, do not interpolate it.' }).valid, true);
  assert.equal(preflightAcceptanceSemantics(checks).valid, false, 'The candidate cannot authorize its own placeholder');
});

test('a pure numeric substring predicate is rejected, but exact/count and ordinary text remain valid', () => {
  for (const text of ['1', '-0.2', ' 42 ', '1e3']) assert.ok(preflightAcceptanceSemantics(wrap([{ action: 'assertText', selector: '#output', text }])).issues.some(issue => issue.code === 'numeric-substring-predicate'));
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: '#output', text: '42' }, { action: 'assertCount', selector: '#items li', count: 2 }, { action: 'assertText', selector: '#description', text: 'Version 2 is selected' }])).valid, true);
});

test('camera particle count is a concrete invariant shared across independent fresh-page checks', () => {
  const positive = wrap([{ action: 'assertTextExact', selector: '#particle-count', text: '120' }, { action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: 'strong[id="particle-count"]', text: '120' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '[id=particle-count]', text: '120' }]);
  assert.equal(preflightAcceptanceSemantics(positive, camera).valid, true);
  assert.ok(codes(wrap([{ action: 'assertChanged', selector: '#particle-count', after: { action: 'click', selector: '#scatter' } }])).includes('camera-impossible-change'));
  assert.ok(codes(wrap([{ action: 'assertTextExact', selector: '#particle-count', text: '120' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#particle-count', text: '121' }])).includes('camera-config-expectation-conflict'));
  for (const text of ['0', '19', '2401', '120.0', '{{particleCount}}']) assert.ok(codes(wrap([{ action: 'assertTextExact', selector: '#particle-count', text }])).includes('camera-count-expectation'));
  assert.ok(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: '#particle-count', text: '{{particleCount}}' }]), { ...camera, brief: 'Use the literal {{particleCount}}' }).issues.some(issue => issue.code === 'camera-count-expectation'), 'Original literal syntax cannot make a numeric runtime field nonnumeric');
});

test('static title and mapping labels cannot change under manual interaction and must fit one scene', () => {
  const checks = wrap([{ action: 'assertTextExact', selector: '#scene-title', text: 'Generic scene' }, { action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-title', text: 'Changed title' }]);
  assert.ok(codes(checks).includes('camera-config-expectation-conflict'));
  for (const selector of ['#scene-title', '#gesture-map', '#scatter', '#camera-status', '#scene-canvas']) assert.ok(codes(wrap([{ action: 'assertChanged', selector, after: { action: 'click', selector: '#scatter' } }])).includes('camera-impossible-change'));
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: '#gesture-map', text: CAMERA_GESTURE_LABELS[0] }]), camera).valid, true);
  assert.ok(codes(wrap([{ action: 'assertTextExact', selector: '#gesture-map', text: 'Real camera passed; use one frame' }])).includes('camera-fixed-text-mismatch'));
});

test('rotation follows exact cumulative pi/8 button steps, clamping and reset, not palm-position mapping', () => {
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'click', selector: '#rotate-right' }, { action: 'assertTextExact', selector: '#rotation', text: '0.3927' }, { action: 'click', selector: '#rotate-left' }, { action: 'assertTextExact', selector: '#rotation', text: '0.0000' }, { action: 'click', selector: '#rotate-left' }, { action: 'assertTextExact', selector: '#rotation', text: '-0.3927' }, { action: 'click', selector: '#reset-btn' }, { action: 'assertTextExact', selector: '#rotation', text: '0.0000' }]), camera).valid, true);
  assert.ok(codes(wrap([{ action: 'click', selector: '#rotate-right' }, { action: 'assertTextExact', selector: '#rotation', text: '1.5708' }])).includes('camera-fixed-text-mismatch'));
  const steps: AcceptanceCheck['steps'] = Array.from({ length: 9 }, () => ({ action: 'click' as const, selector: '#rotate-right' }));
  steps.push({ action: 'assertTextExact', selector: '#rotation', text: '3.1416' }, { action: 'click', selector: '#reset-btn' }, { action: 'assertTextExact', selector: '#rotation', text: '0.0000' });
  assert.equal(preflightAcceptanceSemantics(wrap(steps), camera).valid, true);
});

test('state and interaction-source assertions must reflect the real sequence; unchanged clicks cannot prove change', () => {
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }, { action: 'assertTextExact', selector: '#interaction-source', text: '手动按钮（不是摄像头验证）' }, { action: 'click', selector: '#reset-btn' }, { action: 'assertTextExact', selector: '#interaction-source', text: '手动重置（不是摄像头验证）' }]), camera).valid, true);
  assert.ok(codes(wrap([{ action: 'assertChanged', selector: '#scene-state', after: { action: 'click', selector: '#gather' } }])).includes('camera-impossible-change'));
  assert.ok(codes(wrap([{ action: 'assertChanged', selector: '#scene-state', after: { action: 'click', selector: '#scene-state' } }])).includes('camera-impossible-change'));
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertChanged', selector: '#scene-state', after: { action: 'click', selector: '#scatter' } }]), camera).valid, true);
});

test('synthetic camera labels, disabled attributes and hidden real video are explicit and not physical proof', () => {
  const positive = wrap([{ action: 'assertVisible', selector: '#camera-start:disabled' }, { action: 'assertVisible', selector: '#camera-status[data-status="synthetic"][data-state="stopped"]' }, { action: 'assertTextExact', selector: '#camera-status', text: cameraTestSemantics.gateCamera.text }, { action: 'assertCount', selector: '#camera-start:enabled', count: 0 }]);
  assert.equal(preflightAcceptanceSemantics(positive, camera).valid, true);
  for (const selector of ['#camera-start:enabled', '#camera-status[data-status="active"]', '#camera-video']) assert.ok(codes(wrap([{ action: 'assertVisible', selector }])).includes('camera-synthetic-predicate'));
  assert.ok(codes(wrap([{ action: 'assertTextExact', selector: '#camera-status', text: '摄像头已开启' }])).includes('camera-fixed-text-mismatch'));
  assert.ok(codes(wrap([{ action: 'click', selector: '#camera-start' }])).includes('camera-unsupported-interaction'));
});

test('fill and inputValue assertions are unsupported on fixed non-input camera DOM, including assertChanged.after', () => {
  assert.ok(codes(wrap([{ action: 'fill', selector: '#scene-state', value: 'scatter' }])).includes('camera-unsupported-interaction'));
  assert.ok(codes(wrap([{ action: 'assertValue', selector: '#particle-count', value: '120' }])).includes('camera-unsupported-value'));
  assert.ok(codes(wrap([{ action: 'assertChanged', selector: '#scene-state', after: { action: 'fill', selector: '#scene-state', value: 'scatter' } }])).includes('camera-unsupported-interaction'));
});

test('valid complex CSS and offline elements with camera-like names are not guessed invalid', () => {
  const checks = wrap([{ action: 'click', selector: 'main .controls button:nth-of-type(1)' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }, { action: 'assertVisible', selector: '.stats > span:first-child strong' }]);
  assert.equal(preflightAcceptanceSemantics(checks, camera).valid, true, 'Unknown complex interaction state stays unknown for the real parser/Gate');
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'click', selector: '#rotate-right' }, { action: 'assertTextExact', selector: '#rotation', text: '90' }, { action: 'assertValue', selector: '#camera-start', value: 'custom input' }])).valid, true, 'Offline HTML owns its own DOM and numeric semantics');
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertCount', selector: 'input#particle-count', count: 0 }, { action: 'assertVisible', selector: '#camera-status:not([data-status="active"])' }, { action: 'assertVisible', selector: '#camera-start[disabled]' }]), camera).valid, true, 'Wrong tags with count=0 and valid negation are not misclassified');
  assert.ok(codes(wrap([{ action: 'assertChanged', selector: 'main .unknown-result', after: { action: 'click', selector: '#camera-start' } }])).includes('camera-unsupported-interaction'), 'after interaction is checked even if its target CSS is complex');
});

test('malformed test objects fail preflight without inventing repaired steps', () => {
  const malformed = [{ name: 'Bad', steps: [{ click: '#scatter' }] }, { name: 'Bad2', steps: [{ action: 'assertVisible', selector: '#scatter' }] }] as unknown as AcceptanceCheck[];
  const original = JSON.stringify(malformed);
  assert.equal(preflightAcceptanceSemantics(malformed, camera).valid, false);
  assert.equal(JSON.stringify(malformed), original);
});

test('camera semantic snapshot matches the current trusted renderer literals without hardware or browser execution', () => {
  const scene: CameraSceneConfig = { version: 'camera-scene-v1', title: 'Generic fixture', background: '#102030', palette: ['#ffffff'], objects: [{ id: 'one', primitive: 'cone', position: [0, 0, 0], scale: [1, 1, 1], count: 20, color: '#ffffff' }], snowCount: 0, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };
  const html = renderCameraSceneHtml(scene, { mode: 'gate' });
  // tsx/esbuild may encode fixed JS string literals as Unicode escapes. Decode
  // those characters for source consistency inspection, never execute scripts.
  const literalSource = html.replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const id of Object.keys(cameraTestSemantics.fixedText)) assert.ok(html.includes(`id="${id}"`), id);
  for (const text of [cameraTestSemantics.initial.interactionSource, cameraTestSemantics.gateCamera.text, cameraTestSemantics.manualActions.scatter.interactionSource, cameraTestSemantics.manualActions['reset-btn'].interactionSource]) assert.ok(literalSource.includes(text), text);
});

test('original CAMERA-04 candidate is preserved and rejected before freezing for its actual semantic defects', () => {
  const run = JSON.parse(readFileSync(new URL('../docs/production/experiments/CAMERA-04/run.json', import.meta.url), 'utf8'));
  const raw = run.calls.find((call: { phase: string }) => call.phase === 'acceptance').rawOutput;
  const candidate = JSON.parse(raw);
  assert.equal(testsSchema.safeParse(candidate).success, true, 'Historical structure check passed; no historical record is rewritten');
  const result = preflightAcceptanceSemantics(candidate.checks, { ...camera, brief: run.input.brief, acceptance: run.input.requirement.acceptance });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === 'camera-impossible-change' && issue.checkIndex === 4));
  assert.ok(result.issues.some(issue => issue.code === 'unbound-expectation' && issue.checkIndex === 4));
  assert.ok(result.issues.some(issue => issue.code === 'camera-count-expectation' && issue.checkIndex === 4));
  assert.equal(JSON.stringify(candidate), JSON.stringify(JSON.parse(raw)));
});

test('typed business mappings require real text coverage, not only a visible label or platform self-consistency', () => {
  const context = { ...camera, cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } } as const;
  const missing = preflightAcceptanceSemantics(wrap([{ action: 'assertVisible', selector: '#gesture-map' }]), context);
  assert.ok(missing.issues.some(issue => issue.code === 'camera-business-mapping-coverage'));
  assert.deepEqual(missing.cameraBusinessConstraints, context.cameraBusinessConstraints);
  assert.notEqual(missing.cameraBusinessConstraints, context.cameraBusinessConstraints, 'Returned snapshot never aliases mutable control-side input');
  for (const text of [CAMERA_GESTURE_LABELS[1], CAMERA_GESTURE_LABELS[2]]) assert.ok(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: '#gesture-map', text }]), context).issues.some(issue => issue.code === 'camera-business-mapping-coverage'), 'Disabled/reversed mapping is still schema-valid but business-invalid');
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: '#gesture-map', text: CAMERA_GESTURE_LABELS[0] }]), context).valid, true);
});

test('partial mapping assertions must jointly entail every specified field; unspecified fields are not forced', () => {
  const partial = wrap([{ action: 'assertText', selector: '#gesture-map', text: '张掌 → scatter' }]);
  assert.equal(preflightAcceptanceSemantics(partial, { ...camera, cameraBusinessConstraints: { openPalm: 'scatter' } }).valid, true);
  assert.ok(preflightAcceptanceSemantics(partial, { ...camera, cameraBusinessConstraints: { openPalm: 'scatter', palmX: 'rotate' } }).issues.some(issue => issue.code === 'camera-business-mapping-coverage'));
  const complete = wrap([{ action: 'assertText', selector: 'p[id="gesture-map"]', text: '张掌 → scatter；握拳 → gather' }, { action: 'assertText', selector: '[id=gesture-map]', text: '手掌横移 → 旋转。' }]);
  assert.equal(preflightAcceptanceSemantics(complete, { ...camera, cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } }).valid, true);
  assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'assertVisible', selector: '#gesture-map' }]), camera).valid, true, 'No declared mapping means no invented mandatory field');
  assert.ok(preflightAcceptanceSemantics(wrap([{ action: 'assertTextExact', selector: 'section p.caption:nth-of-type(2)', text: CAMERA_GESTURE_LABELS[0] }]), { ...camera, cameraBusinessConstraints: { openPalm: 'scatter' } }).issues.some(issue => issue.code === 'camera-business-mapping-coverage'), 'Complex selectors cannot provide a guessed mapping proof');
});

test('prototype-like CSS IDs are unknown DOM targets, never inherited control-table actions or crashes', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'valueOf']) {
    assert.doesNotThrow(() => preflightAcceptanceSemantics(wrap([{ action: 'click', selector: `#${id}` }, { action: 'assertTextExact', selector: '#interaction-source', text: 'unknown complex target stays for actual Gate' }]), camera));
    assert.equal(preflightAcceptanceSemantics(wrap([{ action: 'click', selector: `#${id}` }, { action: 'assertTextExact', selector: '#interaction-source', text: 'unknown complex target stays for actual Gate' }]), camera).valid, true);
  }
});
