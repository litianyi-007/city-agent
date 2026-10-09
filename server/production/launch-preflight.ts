import { createHash } from 'node:crypto';
import { PRODUCTION_ROLES, productionAgentInputSchema, productionRunInputSchema, type ProductionAgent, type ProductionRunInput } from '../../shared/production-schema.js';
import { estimateProductionCost, productionLaunchCallEnvelope, PRODUCTION_INPUT_TOKEN_RESERVATION, PRODUCTION_LAUNCH_PREFLIGHT_VERSION, type ProductionLaunchPreflightReport, type ProductionLaunchExecutionSummary } from '../../shared/production-launch-preflight.js';
import type { ProductionExecutionIdentity } from './provenance.js';
import { PHASE_READY_GROUPED_PROMPT_VERSION, ACCEPTANCE_REVIEW_PROJECTION_VERSION } from './contracts.js';
import { OUTPUT_ENVELOPE_VERSION } from './output-envelope.js';
import { PHASE_READINESS_VERSION } from './phase-readiness.js';
import { ACCEPTANCE_STEP_AUDIT_VERSION } from './acceptance-step-audit.js';
import { PM_OUTPUT_POLICY_VERSION, ROLE_SCHEMA_DIAGNOSTICS_VERSION } from './role-output-policy.js';
import { PUBLIC_COLLISION_GUARD_VERSION } from './public-collision-guard.js';
import { STARTUP_PUBLIC_GUARD_VERSION } from './startup-public-contract.js';

const messages = {
  'agent-selection-invalid': '必须选择六个不同的公开 Agent，每个角色恰好一个。',
  'agent-disabled': '所选 Agent 必须全部启用。',
  'agent-key-missing': '所选 Agent 的公开凭据状态尚未就绪；预检不读取 Key。',
  'agent-pricing-missing': '所选 Agent 必须全部配置明确的声明费率。',
  'agent-currency-mismatch': '全部声明费率必须与任务预算币种一致。',
  'execution-unready': '启动源码和干净构建身份未就绪；请干净构建并重启本服务。',
  'execution-stale': '启动身份新鲜度校验失败；报告不授权执行，请重新构建或准备。',
  'first-request-token-budget': 'Token 预算不足以预留第一次产品角色请求。',
  'first-request-cost-budget': '费用预算不足以预留第一次产品角色请求。',
  'startup-public-contract-rejected': '启动固定协议的保密或容量守卫未通过；请核对配置，不会启动任务或自动重试。',
} as const;
const warnings = {
  'not-paid-authorization': 'ready 仅表示此刻公开配置和第一次请求预留可满足，不是收费授权或启动令牌。真实启动仍须单独明确有限预算授权并重新校验。',
  'acceptance-not-frozen': '尚未生成产品、测试或 HTML；finalGate 为 null。原需求不会由预检缩减，研发前冻结检查仍须原测试角色生成、预检和独立评审；完整业务覆盖未验证。',
  'reservation-not-billing': '包络使用每请求 65536 输入 Token 加最大输出的保守预留，费用为声明价上界而非 Token 预测、供应商报价或账单；没有新增模型请求。',
  'budget-may-stop-early': '调用、Token、时间、费用或全局修复预算可能提前停止；unknown usage、协议错误或环境失败仍立即停止，不保证交付。',
  'call-envelope-exceeds-budget': '请求包络超过 maxCalls，受限运行可能在完成前因调用预算停止。',
  'token-envelope-exceeds-budget': '保守请求预留包络超过 maxTokens，不代表实际超限，但运行可能提前停止。',
  'cost-envelope-exceeds-budget': '声明价保守预留包络超过 maxCost，不代表实际收费，但运行可能提前停止。',
  'source-bound-not-real-validated': 'source-bound-v1 只有免费工程证据；源码锚点和检查引用不证明语义正确，完整冻结行为 Gate 仍必需，首轮建议 legacy 后再独立对照。',
  'planned-groups-not-real-validated': '分组策略只完成工程验证，未实测质量或节费；组不独立冻结或接受。按最多3组预留16初始／最多28次调用（两次共享修复），实际硬预算可能提前停止；原12项／20步与最终Gate不变。',
  'startup-guard-not-guarantee': '固定启动材料已使用加密凭据集合核验，不解密或导出秘密；ready仍非收费授权。实际启动重复核验，后续新数据、配置变化与执行错误仍可能停止。',
} as const;
const sha = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const iso = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function executionSummary(identity: ProductionExecutionIdentity, fresh: boolean): ProductionLaunchExecutionSummary {
  const build = identity.buildSnapshot;
  const buildSnapshot = build && commit.test(build.platformCommit) && typeof build.sourceClean === 'boolean' && iso(build.builtAt) ? { platformCommit: build.platformCommit, sourceClean: build.sourceClean, builtAt: build.builtAt } : null;
  const result = {
    bootId: typeof identity.bootId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(identity.bootId) ? identity.bootId : null,
    startedAt: iso(identity.startedAt) ? identity.startedAt : null,
    commit: typeof identity.commit === 'string' && commit.test(identity.commit) ? identity.commit : null,
    sourceClean: identity.sourceClean === true,
    sourceFingerprint: typeof identity.sourceFingerprint === 'string' && sha.test(identity.sourceFingerprint) ? identity.sourceFingerprint : null,
    buildFingerprint: typeof identity.buildFingerprint === 'string' && sha.test(identity.buildFingerprint) ? identity.buildFingerprint : null,
    buildSnapshot, ready: false, fresh,
  };
  result.ready = identity.ready === true && identity.issues.length === 0 && !!result.bootId && !!result.startedAt && !!result.commit && result.sourceClean && !!result.sourceFingerprint && !!result.buildFingerprint && !!buildSnapshot?.sourceClean && buildSnapshot.platformCommit === result.commit;
  return result;
}
/** Plaintext-credential-free, no dispatch/persistence/browser. The optional
 * server callback checks fixed public material against encrypted generations.
 * Without it, legacy pure reports stay byte-compatible. Never a paid token. */
export function buildProductionLaunchPreflight(raw: unknown, publicAgents: readonly ProductionAgent[], identity: ProductionExecutionIdentity, assertFresh: (() => void) | undefined, assertStartupSafe?: (input: ProductionRunInput) => void): ProductionLaunchPreflightReport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.hasOwn(raw, 'budgetAuthorized') || (raw as { budgetAuthorized?: unknown }).budgetAuthorized !== false) throw new Error('免费预检必须显式未授权收费。');
  const input = productionRunInputSchema.parse(raw);
  if (input.mode !== 'live' || input.capability !== 'offline-single-html' || input.verifierEngine !== 'llm-rubric') throw new Error('免费预检仅支持真实离线 HTML 的独立 LLM 复核配置，不启动执行。');
  const issues: ProductionLaunchPreflightReport['issues'] = [];
  const warn: ProductionLaunchPreflightReport['warnings'] = [];
  const add = (code: keyof typeof messages) => { if (!issues.some(issue => issue.code === code)) issues.push({ code, message: messages[code] }); };
  const warning = (code: keyof typeof warnings) => warn.push({ code, message: warnings[code] });
  const selected = publicAgents.filter(agent => input.agentIds.includes(agent.id));
  const models: ProductionAgent[] = [];
  for (const agent of selected) {
    // This is an existing public snapshot, not a creation request. Do not fill
    // missing stored configuration with the input schema's creation defaults.
    if (['id', 'name', 'role', 'provider', 'baseUrl', 'modelId', 'enabled', 'hasApiKey'].some(field => !Object.hasOwn(agent, field))) { add('agent-selection-invalid'); continue; }
    const value = productionAgentInputSchema.safeParse({ name: agent.name, role: agent.role, provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId, enabled: agent.enabled, pricing: agent.pricing });
    if (!value.success || typeof agent.hasApiKey !== 'boolean') { add('agent-selection-invalid'); continue; }
    const { apiKey: _never, ...configuration } = value.data;
    models.push({ id: agent.id, ...configuration, hasApiKey: agent.hasApiKey, ...(configuration.pricing ? { pricing: configuration.pricing } : { pricing: undefined }) });
  }
  models.sort((a, b) => PRODUCTION_ROLES.indexOf(a.role) - PRODUCTION_ROLES.indexOf(b.role));
  if (new Set(input.agentIds).size !== 6 || new Set(models.map(agent => agent.id)).size !== 6 || models.length !== 6 || input.agentIds.some(id => models.filter(agent => agent.id === id).length !== 1) || PRODUCTION_ROLES.some(role => models.filter(agent => agent.role === role).length !== 1)) add('agent-selection-invalid');
  if (models.some(agent => !agent.enabled)) add('agent-disabled');
  if (models.some(agent => !agent.hasApiKey)) add('agent-key-missing');
  if (models.some(agent => !agent.pricing)) add('agent-pricing-missing');
  if (models.some(agent => agent.pricing && agent.pricing.currency !== input.limits.currency)) add('agent-currency-mismatch');
  let fresh = false;
  try { if (assertFresh) { assertFresh(); fresh = true; } } catch { /* Fixed diagnostic, never an arbitrary freshness error/path. */ }
  const execution = executionSummary(identity, fresh);
  if (!execution.ready) add('execution-unready');
  if (!execution.fresh) add('execution-stale');
  const calls = productionLaunchCallEnvelope(input.candidateCount, input.limits.maxRepairCycles, input.acceptanceStrategy);
  const perRequest = PRODUCTION_INPUT_TOKEN_RESERVATION + input.limits.maxOutputTokens;
  const product = models.find(agent => agent.role === 'product');
  const firstCost = product?.pricing?.currency === input.limits.currency ? estimateProductionCost(product.pricing, PRODUCTION_INPUT_TOKEN_RESERVATION, input.limits.maxOutputTokens) : null;
  if (perRequest > input.limits.maxTokens) add('first-request-token-budget');
  if (firstCost !== null && firstCost > input.limits.maxCost) add('first-request-cost-budget');
  // Every possible stage/repair role is bounded by the most expensive selected
  // per-request reservation, not the weights of the longest planning branch.
  const maxReservation = models.length === 6 && models.every(agent => agent.pricing && agent.pricing.currency === input.limits.currency) ? Math.max(...models.map(agent => estimateProductionCost(agent.pricing, PRODUCTION_INPUT_TOKEN_RESERVATION, input.limits.maxOutputTokens)!)) : null;
  const budget = { ...calls, inputTokensPerRequest: PRODUCTION_INPUT_TOKEN_RESERVATION, outputTokensPerRequest: input.limits.maxOutputTokens,
    firstRequest: { totalTokens: perRequest, estimatedCost: firstCost, currency: input.limits.currency },
    envelope: { baseTokens: calls.baseCalls * perRequest, worstCaseTokens: calls.worstCaseCalls * perRequest, baseEstimatedCost: maxReservation === null ? null : calls.baseCalls * maxReservation, worstCaseEstimatedCost: maxReservation === null ? null : calls.worstCaseCalls * maxReservation, currency: input.limits.currency } };
  for (const code of ['not-paid-authorization', 'acceptance-not-frozen', 'reservation-not-billing', 'budget-may-stop-early'] as const) warning(code);
  if (calls.worstCaseCalls > input.limits.maxCalls) warning('call-envelope-exceeds-budget');
  if (budget.envelope.worstCaseTokens > input.limits.maxTokens) warning('token-envelope-exceeds-budget');
  if (budget.envelope.worstCaseEstimatedCost !== null && budget.envelope.worstCaseEstimatedCost > input.limits.maxCost) warning('cost-envelope-exceeds-budget');
  if (input.implementationEvidencePolicy === 'source-bound-v1') warning('source-bound-not-real-validated');
  if (input.acceptanceStrategy === 'planned-groups-v1') warning('planned-groups-not-real-validated');
  let startupGuard: ProductionLaunchPreflightReport['startupGuard'];
  if (assertStartupSafe) {
    let safe = false;
    try { assertStartupSafe(input); safe = true; } catch { add('startup-public-contract-rejected'); }
    startupGuard = { version: STARTUP_PUBLIC_GUARD_VERSION, publicCollisionGuardVersion: PUBLIC_COLLISION_GUARD_VERSION, ready: safe };
    warning('startup-guard-not-guarantee');
  }
  const payload = { version: PRODUCTION_LAUNCH_PREFLIGHT_VERSION, ready: !issues.length, paidAuthorized: false as const, finalGate: null, modelRequests: 0 as const, input, models, execution, budget, issues, warnings: warn, ...(input.acceptanceStrategy === 'planned-groups-v1' ? { configuration: { promptVersion: PHASE_READY_GROUPED_PROMPT_VERSION, pmOutputPolicyVersion: PM_OUTPUT_POLICY_VERSION, roleSchemaDiagnosticsVersion: ROLE_SCHEMA_DIAGNOSTICS_VERSION, acceptanceStepAuditVersion: ACCEPTANCE_STEP_AUDIT_VERSION, acceptanceReviewProjectionVersion: ACCEPTANCE_REVIEW_PROJECTION_VERSION, outputEnvelopeVersion: OUTPUT_ENVELOPE_VERSION, phaseReadinessVersion: PHASE_READINESS_VERSION } } : {}) };
  const checkedPayload = { ...payload, ...(startupGuard ? { startupGuard } : {}) };
  return { ...checkedPayload, reportHash: createHash('sha256').update(JSON.stringify(checkedPayload)).digest('hex') };
}
