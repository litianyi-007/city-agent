export const PHASE_READINESS_VERSION = 'production-phase-readiness-v1' as const;

export interface ProductionPhaseReadiness {
  readonly version: typeof PHASE_READINESS_VERSION;
  readonly source: 'control-plane-stage-policy';
  readonly role: string;
  readonly phase: string;
  readonly currentArtifact: string;
  readonly requiredNow: readonly string[];
  readonly downstreamArtifacts: readonly string[];
  readonly proceedAuthorizes: string | null;
  readonly evidenceBoundary: string;
}

export const PHASE_READINESS_PROTOCOL_LITERALS = Object.freeze([
  PHASE_READINESS_VERSION, 'production-html-grouped-v5', 'phaseReadiness',
  'phaseReadinessVersion', 'phaseReadinessProtocolLiterals', 'control-plane-stage-policy',
  'currentArtifact', 'requiredNow', 'downstreamArtifacts', 'proceedAuthorizes',
  'Stage readiness unavailable',
] as const);

/** Fixed workflow dependencies, NOT claims that any artifact exists or passed.
 * Only the control-plane role/phase are accepted: no user/model state, verdict,
 * selectors, generated steps, completion flag or mutable run is an input.
 * Actual evidence must still come from the separately supplied original role
 * outputs, frozen contract and current Gate; this policy proves none of them. */
export function productionPhaseReadiness(role: string, phase: string): ProductionPhaseReadiness {
  const reject = (): never => { throw new Error('Stage readiness unavailable'); };
  if (arguments.length !== 2 || typeof role !== 'string' || typeof phase !== 'string') return reject();
  let currentArtifact: string;
  let requiredNow: string[];
  let downstreamArtifacts: string[];
  let proceedAuthorizes: string | null = null;
  if (role === 'product' && phase === 'product') {
    currentArtifact = 'Actionable product goal retaining every original in-scope requirement.';
    requiredNow = ['Original goal and acceptance retained; unsupported scope and necessary inputs explicit.'];
    downstreamArtifacts = ['Research constraints', 'PM feasibility decision', 'Acceptance plan and actual checks', 'Frozen contract', 'Implementation', 'Executed behavior Gate'];
  } else if (role === 'researcher' && phase === 'research') {
    currentArtifact = 'Actionable design recommendations, constraints and blocking/deferred unknowns.';
    requiredNow = ['Complete original requirement and supplied product/platform facts', 'Honest feasibility and capacity risks; no fabricated completed tests'];
    downstreamArtifacts = ['PM feasibility decision', 'Acceptance plan and actual CSS/check steps', 'Frozen contract', 'Implementation', 'Executed behavior Gate'];
  } else if (role === 'project-manager' && phase === 'think-design') {
    currentArtifact = 'Justified feasibility decision and concrete role-owned next-stage tasks.';
    requiredNow = ['Preserved original goal and research constraints', 'Executable in-scope path with necessary blockers and capacity risks explicit'];
    downstreamArtifacts = ['PM acceptance-plan', 'Tester acceptance-group checks', 'Whole-check static review and freeze', 'Implementation', 'Executed behavior Gate'];
    proceedAuthorizes = 'Only acceptance-plan and tester check construction; not implementation, freeze or delivery.';
  } else if (role === 'project-manager' && phase === 'acceptance-plan') {
    currentArtifact = 'Source-bound obligations and independent check slots with realistic step budgets.';
    requiredNow = ['Complete original clauses and required states/outcomes', 'Independent setup, exercise and assertions; declared budgets are not actual step counts'];
    downstreamArtifacts = ['Tester actual CSS/check steps', 'Whole-check static review and freeze', 'Implementation', 'Executed behavior Gate'];
  } else if (role === 'tester' && /^acceptance-group-[A-Za-z0-9_-]{1,40}(?![\s\S])/.test(phase)) {
    currentArtifact = 'Actual check steps for this one bound plan group.';
    requiredNow = ['Exact plan/group/round binding', 'Actual steps within each registered budget; full independent setup and required assertions'];
    downstreamArtifacts = ['Other bound groups if any', 'Whole-check static review and freeze', 'Implementation', 'Executed behavior Gate'];
  } else if (role === 'tester' && phase === 'acceptance') {
    currentArtifact = 'Complete actual checks assembled from every registered source group.';
    requiredNow = ['Actual complete steps and source-bound step audit', 'Full original requirement coverage; counts and IDs alone are not proof'];
    downstreamArtifacts = ['Frozen contract', 'Implementation', 'Executed behavior Gate'];
  } else if (role === 'developer' && (phase === 'implement' || /^repair-[0-2](?![\s\S])/.test(phase))) {
    currentArtifact = 'Complete actual HTML implementation matching the frozen contract.';
    requiredNow = ['Already-frozen original business checks', 'Actual implementation; relevant original failure evidence on repair'];
    downstreamArtifacts = ['Executed current-round behavior Gate', 'PM feedback decision'];
  } else if (role === 'project-manager' && /^feedback-[0-2](?![\s\S])/.test(phase)) {
    currentArtifact = 'Decision and scoped tasks justified by the actual current-round Gate.';
    requiredNow = ['Actual current-round Gate and frozen contract', 'Remaining shared repair/call/token/time/cost limits'];
    downstreamArtifacts = ['Scoped repair and new Gate if allowed, or an explicit terminal result'];
    proceedAuthorizes = 'Delivery only when the separately recorded actual Gate passed; never overrides it.';
  } else return reject();
  return Object.freeze({ version: PHASE_READINESS_VERSION, source: 'control-plane-stage-policy', role, phase,
    currentArtifact, requiredNow: Object.freeze(requiredNow), downstreamArtifacts: Object.freeze(downstreamArtifacts), proceedAuthorizes,
    evidenceBoundary: 'Workflow policy only; not generated/frozen/executed/passed evidence, not permission and not a waiver of original requirements or final Gate.' });
}

export const PHASE_READINESS_REVIEW_INSTRUCTIONS = `阶段依赖审查 ${PHASE_READINESS_VERSION}：state.reviewContext.phaseReadiness仅是宿主阶段顺序，不证明产物存在、已冻结或通过。research/think-design审当前方案、完整原需求、权限/必要输入与可执行路线；尚未生成的具体CSS、checks或实际steps不能仅因缺失被当作当前阶段阻塞，think-design的proceed只释放后续验收构建。可行性估计不是真实步数/容量自证；确定漏计独立setup、必需断言或原容量不可达，虚称已计数/冻结/通过，真实业务遗漏、范围缺口或必要blocking未解决，仍必须低于3且abstain。acceptance-plan需真实来源义务和可行slot方案，不要求未来checks，但声明不能代替其后完整actual checks与stepAudit。acceptance必须直接核对全部真实steps、独立前置和精确业务断言；implementation仍需实际代码及冻结契约；feedback只能服从实际Gate与剩余预算。未知不得伪造解决，不强制接受候选，不覆盖最终Gate或改共享返修/预算。`;
