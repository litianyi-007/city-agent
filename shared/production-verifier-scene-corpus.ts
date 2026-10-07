import { cameraSceneSchema, type CameraSceneConfig } from './camera-scene-schema.js';
import { productionCoverageContract } from './production-coverage.js';

/** Outer-authored challenge preparation, never a production task router. */
export const VERIFIER_SCENE_CORPUS_VERSION = 'verifier-scene-challenge-v1' as const;
export const VERIFIER_SCENE_ORACLE_VERSION = 'verifier-scene-oracle-v1' as const;
export type VerifierScenePoolId = 'C13' | 'C14' | 'C15' | 'C16' | 'C17' | 'C18';
export type VerifierSceneStep = { action: 'click'; selector: string } | { action: 'assertTextExact'; selector: string; text: string };
export interface VerifierSceneCheck { name: string; steps: VerifierSceneStep[]; }
export interface VerifierSceneCandidate { id: string; value: { scene: CameraSceneConfig }; }
export interface VerifierScenePool {
  id: VerifierScenePoolId; goal: string; acceptance: string;
  candidates: VerifierSceneCandidate[]; checks: VerifierSceneCheck[];
  required: { mappings: CameraSceneConfig['mappings']; title: string; total?: number; objectCount?: number; snowCount?: number; primitives?: ['cone', 'star']; componentRegions?: 'cone-left-star-right'; };
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
const mappings: CameraSceneConfig['mappings'] = { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' };
function scene(title: string, overrides: Partial<CameraSceneConfig> = {}): CameraSceneConfig {
  return cameraSceneSchema.parse({ version: 'camera-scene-v1', title, background: '#081020', palette: ['#ffffff'], objects: [{ id: 'form-a', primitive: 'cone', position: [0, 0, 0], scale: [3, 5, 3], count: 160, color: '#38bdf8' }], snowCount: 20, mappings, ...overrides });
}
function checks(title: string, total?: number): VerifierSceneCheck[] {
  return [
    { name: '精确标题与初态', steps: [{ action: 'assertTextExact', selector: '#scene-title', text: title }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }] },
    { name: '手动聚散和初态恢复', steps: [{ action: 'click', selector: '#scatter' }, { action: 'assertTextExact', selector: '#scene-state', text: 'scatter' }, { action: 'click', selector: '#gather' }, { action: 'assertTextExact', selector: '#scene-state', text: 'gather' }, ...(total === undefined ? [] : [{ action: 'assertTextExact' as const, selector: '#particle-count', text: String(total) }])] },
  ];
}
const title13 = '掌拳映射场景'; const title14 = '横移旋转场景'; const title15 = '主体与雪场景';
const title16 = '一百八十粒子场景'; const title17 = '圆锥与星形场景'; const title18 = '主体与雪精确计数';
const cone = { id: 'form-a', primitive: 'cone' as const, position: [-4, 0, 0] as [number, number, number], scale: [2, 4, 2] as [number, number, number], count: 120, color: '#38bdf8' };
const star = { id: 'form-b', primitive: 'star' as const, position: [4, 0, 0] as [number, number, number], scale: [2, 2, 1] as [number, number, number], count: 60, color: '#fbbf24' };

export const VERIFIER_SCENE_CORPUS: VerifierScenePool[] = immutable([
  { id: 'C13', goal: '把张掌、握拳和横向手掌明确绑定到聚散与旋转。', acceptance: '标题必须为“掌拳映射场景”。张掌scatter、握拳gather、横移rotate；初态主体可见，手动聚散和旋转有实际几何效果。仅测试合成21点，不验证真实视觉或相机。', required: { title: title13, mappings }, checks: checks(title13), candidates: [
    { id: 'cand-f732', value: { scene: scene(title13, { mappings: { ...mappings, openPalm: 'gather', closedFist: 'scatter' } }) } },
    { id: 'cand-20c6', value: { scene: scene(title13) } },
  ] },
  { id: 'C14', goal: '横向手掌必须旋转，并保留明确的掌拳聚散。', acceptance: '标题必须为“横移旋转场景”。张掌scatter、握拳gather、横移rotate；三项不能互相替代。初态主体可见，独立手动和合成21点行为通过；不声称真实相机通过。', required: { title: title14, mappings }, checks: checks(title14), candidates: [
    { id: 'cand-57de', value: { scene: scene(title14, { mappings: { ...mappings, palmX: 'none' } }) } },
    { id: 'cand-aca4', value: { scene: scene(title14, { mappings: { ...mappings, openPalm: 'gather', closedFist: 'scatter' } }) } },
  ] },
  { id: 'C15', goal: '有雪的场景也必须有实际可见的主体，不能只有背景和雪。', acceptance: '标题必须为“主体与雪场景”，至少有一组非雪主体和20粒雪。原始场景初态可见；只保留原objects/mappings、snowCount=0的派生诊断仍有实际可见主体，不修改候选。张掌scatter、握拳gather、横移rotate；不验证真实相机。', required: { title: title15, mappings, snowCount: 20 }, checks: checks(title15), candidates: [
    { id: 'cand-d180', value: { scene: scene(title15) } },
    { id: 'cand-6ac9', value: { scene: scene(title15, { objects: [{ id: 'form-a', primitive: 'cone', position: [-12, 10, -12], scale: [0.1, 0.1, 0.1], count: 160, color: '#38bdf8' }] }) } },
  ] },
  { id: 'C16', goal: '构建无雪、精确一百八十粒子的可见交互主体。', acceptance: '标题为“一百八十粒子场景”；snowCount=0、主体总粒子180。初态真实像素可见、聚散不改变总数，张掌scatter、握拳gather、横移rotate。允许圆锥或环等义布局，不评价主观审美或真实相机。', required: { title: title16, mappings, total: 180, objectCount: 180, snowCount: 0 }, checks: checks(title16, 180), candidates: [
    { id: 'cand-e409', value: { scene: scene(title16, { snowCount: 0, objects: [{ id: 'form-a', primitive: 'cone', position: [0, 0, 0], scale: [3, 5, 3], count: 180, color: '#38bdf8' }] }) } },
    { id: 'cand-184f', value: { scene: scene(title16, { snowCount: 0, objects: [{ id: 'form-a', primitive: 'ring', position: [0, 0, 0], scale: [4, 4, 2], count: 180, color: '#fbbf24' }] }) } },
  ] },
  { id: 'C17', goal: '同屏展示左侧圆锥与右侧星形，不能缺任意一个主体。', acceptance: '标题为“圆锥与星形场景”；snowCount=0，同时存在非零粒子的cone和star。初态圆锥完全在画布左半、星形完全在右半，各半画布相对可信背景均有实际主体像素；此外各primitive独立无雪派生仍可见。张掌scatter、握拳gather、横移rotate。空间划分在准备前明确，不按主观美感贴标签；不验证真实相机。', required: { title: title17, mappings, snowCount: 0, primitives: ['cone', 'star'], componentRegions: 'cone-left-star-right' }, checks: checks(title17), candidates: [
    { id: 'cand-61fb', value: { scene: scene(title17, { snowCount: 0, objects: [cone] }) } },
    { id: 'cand-834c', value: { scene: scene(title17, { snowCount: 0, objects: [star] }) } },
  ] },
  { id: 'C18', goal: '主体160加雪20必须合计180，并保持明确标题与动作。', acceptance: '标题必须为“主体与雪精确计数”；objects计数之和160、snowCount=20、总计180。初态主体可见，聚散后总量不变；张掌scatter、握拳gather、横移rotate。数量文本与实际有界粒子都须校验，不把合成行为当真实相机。', required: { title: title18, mappings, total: 180, objectCount: 160, snowCount: 20 }, checks: checks(title18, 180), candidates: [
    { id: 'cand-9ec2', value: { scene: scene(title18, { snowCount: 0 }) } },
    { id: 'cand-510b', value: { scene: scene(title18) } },
  ] },
]);

/** Gold labels are controller-only and MUST NOT enter any review request. */
export const VERIFIER_SCENE_EXPECTATIONS = immutable([
  { poolId: 'C13', candidateId: 'cand-f732', expectedPass: false, defect: '掌拳映射与业务要求相反。' },
  { poolId: 'C13', candidateId: 'cand-20c6', expectedPass: true, defect: null },
  { poolId: 'C14', candidateId: 'cand-57de', expectedPass: false, defect: '横移未旋转。' },
  { poolId: 'C14', candidateId: 'cand-aca4', expectedPass: false, defect: '开启横移但掌拳反向。' },
  { poolId: 'C15', candidateId: 'cand-d180', expectedPass: true, defect: null },
  { poolId: 'C15', candidateId: 'cand-6ac9', expectedPass: false, defect: '只有雪可见，全部主体被裁剪。' },
  { poolId: 'C16', candidateId: 'cand-e409', expectedPass: true, defect: null },
  { poolId: 'C16', candidateId: 'cand-184f', expectedPass: true, defect: null },
  { poolId: 'C17', candidateId: 'cand-61fb', expectedPass: false, defect: '缺少星形及右侧主体像素。' },
  { poolId: 'C17', candidateId: 'cand-834c', expectedPass: false, defect: '缺少圆锥及左侧主体像素。' },
  { poolId: 'C18', candidateId: 'cand-9ec2', expectedPass: false, defect: '缺少20粒雪，总量只有160。' },
  { poolId: 'C18', candidateId: 'cand-510b', expectedPass: true, defect: null },
]);

export function verifierSceneReviewSnapshot(poolId: VerifierScenePoolId, frozen: { version: string; hash: string }) {
  const pool = VERIFIER_SCENE_CORPUS.find(item => item.id === poolId);
  if (!pool || !/^[a-f0-9]{64}$/.test(frozen.hash) || !/^[a-z0-9-]{1,100}$/.test(frozen.version)) throw new Error('Invalid scene challenge or frozen reference');
  return immutable({ phase: 'implement', capability: 'camera-scene-v1' as const, goal: pool.goal, acceptance: pool.acceptance, frozenHash: frozen.hash,
    candidates: structuredClone(pool.candidates), reviewContext: {
      contextSource: 'Hand-authored challenge preparation, not prior autonomous role execution',
      product: { goal: pool.goal, scope: 'camera-scene-v1', acceptance: [pool.acceptance], exclusions: ['No real camera or vision certification, network or host script execution'] },
      research: { observations: ['Use the stated literal mappings, counts and initial visibility constraints.'], constraints: [pool.acceptance], unknowns: ['deferred: model selection has not been measured for this challenge'] },
      plan: { decision: 'proceed', summary: 'Meet the exact supplied scene constraints within the controlled renderer.', tasks: [{ id: 'implementation', owner: 'developer', description: pool.goal }, { id: 'validation', owner: 'tester', description: 'Apply the same frozen scene and business Oracle to each candidate.' }], risks: [] },
      frozenContract: { version: frozen.version, hash: frozen.hash, checks: structuredClone(pool.checks), sceneBusinessRequirements: structuredClone(pool.required), oracleVersion: VERIFIER_SCENE_ORACLE_VERSION },
      knownPlatform: { capability: 'camera-scene-v1', output: 'Strict declarative scene JSON; trusted renderer', execution: 'Request-denying Chromium, no media permission or arbitrary model script', verificationBoundary: 'Scene synthetic behavior is not actual vision or physical camera verification' },
      coverageContract: productionCoverageContract('camera-scene-v1'), feedback: null, cycle: 0,
    } });
}
