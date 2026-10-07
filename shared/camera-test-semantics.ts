/** Read-only contract for the trusted synthetic Gate DOM, not physical-camera evidence. */
export const CAMERA_TEST_SEMANTICS_VERSION = 'camera-test-semantics-v1' as const;
export const CAMERA_TEST_SEMANTICS = {
  version: CAMERA_TEST_SEMANTICS_VERSION,
  runtimeVersion: CAMERA_RUNTIME_VERSION,
  scope: 'scene-behavior-synthetic',
  initial: { state: 'gather', rotation: 0, interactionSource: '手动按钮模式（不是摄像头验证）' },
  manualActions: {
    scatter: { state: 'scatter', interactionSource: '手动按钮（不是摄像头验证）' },
    gather: { state: 'gather', interactionSource: '手动按钮（不是摄像头验证）' },
    'rotate-left': { rotationDelta: -Math.PI / 8, interactionSource: '手动按钮（不是摄像头验证）' },
    'rotate-right': { rotationDelta: Math.PI / 8, interactionSource: '手动按钮（不是摄像头验证）' },
    'reset-btn': { state: 'gather', rotation: 0, interactionSource: '手动重置（不是摄像头验证）' },
  },
  rotation: { minimum: -Math.PI, maximum: Math.PI, decimalPlaces: 4 },
  particleCount: { selector: '#particle-count', minimum: 20, maximum: 2400, invariantUnderCssInteraction: true, meaning: 'sum(scene.objects[].count) + scene.snowCount; freeze a concrete decimal integer, not a placeholder' },
  title: { selector: '#scene-title', maximumLength: 80, invariantUnderCssInteraction: true, meaning: 'scene.title; any exact expectation must be concrete and consistent across fresh-page checks' },
  gateCamera: { status: 'synthetic', state: 'stopped', text: '场景 Gate 使用合成输入；摄像头、视觉模型与完整需求未验收。', startDisabled: true, stopDisabled: true },
  nodeTags: { 'particle-count': 'strong', 'scene-title': 'h1', 'gesture-map': 'p', 'camera-status': 'p', 'scene-state': 'strong', rotation: 'strong', 'interaction-source': 'p', scatter: 'button', gather: 'button', 'rotate-left': 'button', 'rotate-right': 'button', 'reset-btn': 'button', 'camera-start': 'button', 'camera-stop': 'button', 'camera-heading': 'h2', 'scene-canvas': 'canvas', 'camera-video': 'video' },
  fixedText: {
    scatter: '散开', gather: '聚合', 'rotate-left': '向左旋转', 'rotate-right': '向右旋转', 'reset-btn': '重置场景',
    'camera-start': '开启摄像头', 'camera-stop': '停止摄像头', 'camera-heading': '本机摄像头手势',
    'scene-canvas': '', 'camera-video': '',
  },
  evidenceOwners: {
    schema: 'strict scene JSON bounds, fields, primitives, colors, mapping constraints and no executable code/URLs',
    mandatoryGate: 'actual Canvas/particles/manual geometry and synthetic landmark/debounce behavior',
    roleCss: 'supported fixed-DOM business interactions and concrete config-dependent text expectations',
    deferred: 'actual vision quality, physical camera, permissions/device failures and full user acceptance',
  },
} as const;
export const cameraTestSemantics = CAMERA_TEST_SEMANTICS;

/** Four schema-supported mapping labels; choosing an enum never overrides the user's requirement. */
export const CAMERA_GESTURE_SEMANTICS = (['scatter', 'gather'] as const).flatMap(openPalm => (['rotate', 'none'] as const).map(palmX => ({
  openPalm, closedFist: openPalm === 'scatter' ? 'gather' as const : 'scatter' as const, palmX,
  label: `张掌 → ${openPalm}；握拳 → ${openPalm === 'scatter' ? 'gather' : 'scatter'}；手掌横移 → ${palmX === 'rotate' ? '旋转' : '不启用旋转'}。连续 3 帧确认，几何门限未进行人群准确率校准。`,
})));
export const CAMERA_GESTURE_LABELS = CAMERA_GESTURE_SEMANTICS.map(mapping => mapping.label);
import { CAMERA_RUNTIME_VERSION } from './camera-scene-runtime.js';
