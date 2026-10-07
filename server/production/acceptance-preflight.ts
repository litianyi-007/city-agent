import { acceptanceSchema, type AcceptanceCheck } from '../gate.js';
import type { ProductionCapability } from '../../shared/production-schema.js';
import { CAMERA_GESTURE_SEMANTICS, CAMERA_TEST_SEMANTICS, CAMERA_TEST_SEMANTICS_VERSION } from '../../shared/camera-test-semantics.js';

export const PRODUCTION_ACCEPTANCE_PREFLIGHT_VERSION = 'production-acceptance-semantic-v2' as const;
export const ACCEPTANCE_SEMANTICS_VERSION = PRODUCTION_ACCEPTANCE_PREFLIGHT_VERSION;
export type AcceptanceSemanticCode = 'invalid-test-shape' | 'unbound-expectation' | 'numeric-substring-predicate' | 'camera-count-expectation' | 'camera-config-expectation-conflict' | 'camera-fixed-text-mismatch' | 'camera-impossible-change' | 'camera-synthetic-predicate' | 'camera-unsupported-interaction' | 'camera-unsupported-value' | 'camera-business-mapping-coverage';
export interface AcceptanceSemanticIssue { code: AcceptanceSemanticCode; checkIndex: number; stepIndex: number; detail: string; }
export interface CameraBusinessConstraints { openPalm?: 'scatter' | 'gather'; closedFist?: 'scatter' | 'gather'; palmX?: 'rotate' | 'none'; }
export interface AcceptanceSemanticContext { capability?: ProductionCapability; brief?: string; acceptance?: string; cameraBusinessConstraints?: CameraBusinessConstraints; }
export interface AcceptanceSemanticResult { version: typeof PRODUCTION_ACCEPTANCE_PREFLIGHT_VERSION; cameraSemanticsVersion?: typeof CAMERA_TEST_SEMANTICS_VERSION; cameraBusinessConstraints?: CameraBusinessConstraints; valid: boolean; errors: string[]; issues: AcceptanceSemanticIssue[]; }
type Step = AcceptanceCheck['steps'][number];
type Interaction = Extract<Step, { action: 'fill' | 'click' }> | Extract<Step, { action: 'assertChanged' }>['after'];
type CameraState = { state: string | null; rotation: number | null; interactionSource: string | null };
type FixedTarget = { id: string; tag?: string; modifiers: string };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const numberLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const placeholder = /\{\{[^{}]*\}\}|\$\{[^{}]*\}|<%[=-]?[^%]*%>/g;
const immutableIds = new Set(['particle-count', 'scene-title', 'gesture-map', 'camera-status', ...Object.keys(CAMERA_TEST_SEMANTICS.fixedText)]);
const knownIds = new Set([...immutableIds, 'scene-state', 'rotation', 'interaction-source']);

/** Only resolve standalone, unescaped ID selectors (including common ID aliases).
 * Unknown complex CSS remains for the real CSS parser/Gate; it is never guessed
 * to be invalid merely because this conservative semantic resolver cannot read it. */
function fixedTarget(selector: string): FixedTarget | null {
  const match = /^([a-z][\w-]*)?(?:#([\w-]+)|\[\s*id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\])((?:\[[^\]]+\]|:[\w-]+(?:\([^()]*\))?|\.[\w-]+)*)$/i.exec(selector.trim());
  return match ? { id: match[2] ?? match[3] ?? match[4] ?? match[5], ...(match[1] ? { tag: match[1].toLowerCase() } : {}), modifiers: match[6] } : null;
}
function applyInteraction(state: CameraState, interaction: Interaction) {
  const target = fixedTarget(interaction.selector);
  if (target && knownIds.has(target.id) && !Object.hasOwn(CAMERA_TEST_SEMANTICS.manualActions, target.id)) return;
  if (interaction.action === 'fill' || !target || !Object.hasOwn(CAMERA_TEST_SEMANTICS.manualActions, target.id)) {
    // A complex selector might address a valid manual action. Do not invent its
    // target/state; immutable count/labels still have independent guarantees.
    state.state = null; state.rotation = null; state.interactionSource = null; return;
  }
  const action = CAMERA_TEST_SEMANTICS.manualActions[target.id as keyof typeof CAMERA_TEST_SEMANTICS.manualActions];
  if ('state' in action) state.state = action.state;
  if ('rotation' in action) state.rotation = action.rotation;
  if ('rotationDelta' in action && state.rotation !== null) state.rotation = Math.max(CAMERA_TEST_SEMANTICS.rotation.minimum, Math.min(CAMERA_TEST_SEMANTICS.rotation.maximum, state.rotation + action.rotationDelta));
  state.interactionSource = action.interactionSource;
}
function knownText(id: string, state: CameraState): string | null {
  if (id === 'scene-state') return state.state;
  if (id === 'rotation') return state.rotation === null ? null : state.rotation.toFixed(CAMERA_TEST_SEMANTICS.rotation.decimalPlaces);
  if (id === 'interaction-source') return state.interactionSource;
  if (id === 'camera-status') return CAMERA_TEST_SEMANTICS.gateCamera.text;
  return Object.hasOwn(CAMERA_TEST_SEMANTICS.fixedText, id) ? CAMERA_TEST_SEMANTICS.fixedText[id as keyof typeof CAMERA_TEST_SEMANTICS.fixedText] : null;
}
function predicateMatches(target: FixedTarget): boolean | null {
  if (target.tag && target.tag !== CAMERA_TEST_SEMANTICS.nodeTags[target.id as keyof typeof CAMERA_TEST_SEMANTICS.nodeTags]) return false;
  const disabled = target.id === 'camera-start' || target.id === 'camera-stop';
  const button = disabled || Object.hasOwn(CAMERA_TEST_SEMANTICS.manualActions, target.id);
  let remaining = target.modifiers;
  let matched = true;
  while (remaining) {
    const boolean = /^:(disabled|enabled)\b/.exec(remaining);
    if (boolean) { if (!button || disabled !== (boolean[1] === 'disabled')) matched = false; remaining = remaining.slice(boolean[0].length); continue; }
    const disabledAttribute = /^\[\s*disabled\s*\]/.exec(remaining);
    if (disabledAttribute) { if (!disabled) matched = false; remaining = remaining.slice(disabledAttribute[0].length); continue; }
    const attribute = /^\[\s*(data-status|data-state)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s]+))\s*\]/.exec(remaining);
    if (attribute && target.id === 'camera-status') {
      const actual = attribute[1] === 'data-status' ? CAMERA_TEST_SEMANTICS.gateCamera.status : CAMERA_TEST_SEMANTICS.gateCamera.state;
      if ((attribute[2] ?? attribute[3] ?? attribute[4]) !== actual) matched = false;
      remaining = remaining.slice(attribute[0].length); continue;
    }
    // Do not interpret attributes nested inside :not/:is or arbitrary classes.
    return matched ? null : false;
  }
  return matched;
}

/** Pure semantic preflight. This does not execute a page, mutate a candidate,
 * prove complete coverage, repair JSON, or replace the final frozen Gate. */
export function preflightAcceptanceSemantics(checks: AcceptanceCheck[], context: AcceptanceSemanticContext = {}): AcceptanceSemanticResult {
  const issues: AcceptanceSemanticIssue[] = [];
  const camera = context.capability === 'camera-scene-v1';
  const constraints: CameraBusinessConstraints = {};
  for (const field of ['openPalm', 'closedFist', 'palmX'] as const) {
    const value = context.cameraBusinessConstraints && Object.hasOwn(context.cameraBusinessConstraints, field) ? context.cameraBusinessConstraints[field] : undefined;
    if (value === undefined) continue;
    if (!(field === 'palmX' ? ['rotate', 'none'] : ['scatter', 'gather']).includes(value)) throw new Error('控制面摄像头业务映射不符合已登记枚举；不能按候选猜测或修复。');
    Object.assign(constraints, { [field]: value });
  }
  const result = (): AcceptanceSemanticResult => ({ version: PRODUCTION_ACCEPTANCE_PREFLIGHT_VERSION, ...(camera ? { cameraSemanticsVersion: CAMERA_TEST_SEMANTICS_VERSION } : {}), ...(context.cameraBusinessConstraints ? { cameraBusinessConstraints: { ...constraints } } : {}), valid: !issues.length, errors: issues.map(issue => `check[${issue.checkIndex}].steps[${issue.stepIndex}] ${issue.code}: ${issue.detail}`), issues });
  const add = (code: AcceptanceSemanticCode, checkIndex: number, stepIndex: number, detail: string) => issues.push({ code, checkIndex, stepIndex, detail });
  const shape = acceptanceSchema.safeParse(checks);
  if (!shape.success) {
    for (const issue of shape.error.issues) add('invalid-test-shape', typeof issue.path[0] === 'number' ? issue.path[0] : -1, typeof issue.path[2] === 'number' ? issue.path[2] : -1, issue.message.slice(0, 300));
    return result();
  }
  let frozenCount: string | undefined; let frozenTitle: string | undefined;
  let possibleMappings = [...CAMERA_GESTURE_SEMANTICS]; let hasMappingAssertion = false;
  const originalMaterials = `${context.brief ?? ''}\n${context.acceptance ?? ''}`;
  for (const [checkIndex, check] of checks.entries()) {
    const state: CameraState = { ...CAMERA_TEST_SEMANTICS.initial };
    for (const [stepIndex, step] of check.steps.entries()) {
      const expected = 'text' in step ? step.text : step.action === 'assertValue' ? step.value : undefined;
      if (expected !== undefined) for (const reference of expected.match(placeholder) ?? []) {
        // HTML applications can deliberately display literal template syntax.
        // Only explicit original user material permits that literal; the
        // candidate/check name is never its own binding authority.
        if (!originalMaterials.includes(reference)) add('unbound-expectation', checkIndex, stepIndex, '预期值含未绑定模板引用；请生成具体断言，不由平台替换占位符。');
      }
      if (step.action === 'assertText' && numberLiteral.test(step.text.trim())) add('numeric-substring-predicate', checkIndex, stepIndex, '纯数值预期不能用包含匹配；应由原测试角色生成精确文本或元素数量断言。');
      if (!camera) continue;
      const target = fixedTarget(step.selector);
      const validateInteraction = (interaction: Interaction) => {
        const actionTarget = fixedTarget(interaction.selector);
        if (!actionTarget || !knownIds.has(actionTarget.id)) return;
        if (interaction.action === 'fill' || actionTarget.id === 'camera-start' || actionTarget.id === 'camera-stop') add('camera-unsupported-interaction', checkIndex, stepIndex, '固定场景没有可填充输入；合成 Gate 的摄像头按钮禁用，不能请求真实媒体或模拟权限/识别状态。');
        if (predicateMatches(actionTarget) === false) add('camera-synthetic-predicate', checkIndex, stepIndex, '交互选择器与固定合成状态或按钮属性矛盾。');
      };
      if (step.action === 'fill' || step.action === 'click') {
        validateInteraction(step);
        applyInteraction(state, step); continue;
      }
      if (step.action === 'assertChanged') validateInteraction(step.after);
      if (!target || !knownIds.has(target.id)) {
        if (step.action === 'assertChanged') applyInteraction(state, step.after);
        continue;
      }
      const predicate = predicateMatches(target);
      if (predicate === false && step.action !== 'assertCount') add('camera-synthetic-predicate', checkIndex, stepIndex, '选择器与固定合成状态/按钮 disabled 属性矛盾；不得把真实摄像头状态套用在场景 Gate。');
      if (step.action === 'assertVisible' && target.id === 'camera-video') add('camera-synthetic-predicate', checkIndex, stepIndex, '合成 Gate 的真实摄像头视频保持隐藏，不提供实机识别证据。');
      if (step.action === 'assertCount' && predicate !== null && step.count !== (predicate ? 1 : 0)) add('camera-synthetic-predicate', checkIndex, stepIndex, '固定唯一 DOM 元素及可确定属性过滤的数量不符合可信运行时。');
      if (step.action === 'assertValue') add('camera-unsupported-value', checkIndex, stepIndex, '固定场景 DOM 不是 input/select/textarea；assertValue 不能验证这些元素，需原角色生成受支持文本/状态断言。');
      if (step.action === 'assertChanged') {
        const before = knownText(target.id, state);
        applyInteraction(state, step.after);
        const after = knownText(target.id, state);
        if (immutableIds.has(target.id) || before !== null && after !== null && normalize(before) === normalize(after)) add('camera-impossible-change', checkIndex, stepIndex, '该交互不会改变被读取的固定文本/数量；Canvas几何变化由平台强制 Gate 检查，不能用文本 assertChanged 伪称像素证明。');
        continue;
      }
      if (step.action !== 'assertText' && step.action !== 'assertTextExact') continue;
      const normalizedExpected = normalize(step.text);
      if (target.id === 'particle-count') {
        if (step.action !== 'assertTextExact' || !/^[1-9]\d*$/.test(normalizedExpected) || Number(normalizedExpected) < CAMERA_TEST_SEMANTICS.particleCount.minimum || Number(normalizedExpected) > CAMERA_TEST_SEMANTICS.particleCount.maximum) add('camera-count-expectation', checkIndex, stepIndex, '总粒子预期必须为20..2400的具体十进制整数，使用精确文本；聚散/旋转/复位均不改变数量。');
        else if (frozenCount !== undefined && frozenCount !== normalizedExpected) add('camera-config-expectation-conflict', checkIndex, stepIndex, '独立页面共享同一份场景配置；粒子数不能随操作或不同检查变化。');
        else frozenCount = normalizedExpected;
      } else if (target.id === 'scene-title' && step.action === 'assertTextExact') {
        if (!normalizedExpected || normalizedExpected.length > CAMERA_TEST_SEMANTICS.title.maximumLength || /[<>\x00-\x1f]/.test(step.text)) add('camera-fixed-text-mismatch', checkIndex, stepIndex, '精确场景标题必须满足实际 scene.title 契约。');
        else if (frozenTitle !== undefined && frozenTitle !== normalizedExpected) add('camera-config-expectation-conflict', checkIndex, stepIndex, '同一场景标题不能在独立检查或手动操作后变成另一个精确值。');
        else frozenTitle = normalizedExpected;
      } else if (target.id === 'gesture-map') {
        hasMappingAssertion = true;
        possibleMappings = possibleMappings.filter(mapping => step.action === 'assertTextExact' ? normalize(mapping.label) === normalizedExpected : mapping.label.includes(step.text));
        if (!possibleMappings.length) add('camera-fixed-text-mismatch', checkIndex, stepIndex, '手势说明必须能由同一份有效场景映射生成；不能猜测文案、改变连续3帧语义或声称实机通过。');
      } else {
        const actual = knownText(target.id, state);
        if (actual !== null && (step.action === 'assertTextExact' ? normalize(actual) !== normalizedExpected : !actual.includes(step.text))) add('camera-fixed-text-mismatch', checkIndex, stepIndex, `断言与可信运行时当前文本/按钮步进矛盾；当前确定值为 ${actual.slice(0, 160)}。`);
      }
    }
  }
  if (camera && Object.keys(constraints).length && (!hasMappingAssertion || !possibleMappings.length || possibleMappings.some(mapping => Object.entries(constraints).some(([field, value]) => mapping[field as keyof CameraBusinessConstraints] !== value)))) add('camera-business-mapping-coverage', -1, -1, '冻结检查必须以可识别 #gesture-map 文本断言证明全部已声明的结构化业务映射；不能只验证配置自洽、遗漏、反向或允许 none。请原测试角色重新生成明确断言。');
  return result();
}
