import { z } from 'zod';
import { fingerprint, validateAnswers, type SurveyRun } from './survey-engine';
import { samplingReport } from './survey-analysis';
import { parseSurveyEvidenceWithVerification } from '../src/run-history';

export const COMPLETENESS_EVALUATION_VERSION = 'completeness-audit-1.1';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const completenessPlanSchema = z.object({
  schemaVersion: z.literal('1.0'), id: z.string().trim().min(1).max(80),
  registeredAt: z.string().datetime({ offset: true }),
  taskHash: hash, populationHash: hash, profileHash: hash, systemPromptHash: hash, executionConfigHash: hash,
  plannedResidentIds: z.array(z.string().min(1).max(100)).min(1).max(30),
  minimumCompletionRate: z.number().finite().min(0).max(1),
  requireRealModel: z.boolean(), requireUniqueProfiles: z.boolean(),
  exposure: z.enum(['full', 'no-persona', 'demographics-only']),
}).strict().refine(plan => new Set(plan.plannedResidentIds).size === plan.plannedResidentIds.length, '计划居民ID须唯一');
export type CompletenessPlan = z.infer<typeof completenessPlanSchema>;

/** Convenience for BEFORE execution. Hashes are reproducibility, not authenticity signatures. */
export function createCompletenessPlan(runFrame: Pick<SurveyRun, 'taskHash' | 'populationHash' | 'profileHash' | 'profiles' | 'prompt' | 'exposure' | 'models' | 'parameters' | 'version'>, options: { id: string; registeredAt: string; requireRealModel?: boolean; minimumCompletionRate?: number }): CompletenessPlan {
  return completenessPlanSchema.parse({ schemaVersion: '1.0', id: options.id, registeredAt: options.registeredAt,
    taskHash: runFrame.taskHash, populationHash: runFrame.populationHash, profileHash: runFrame.profileHash,
    systemPromptHash: runFrame.prompt.systemHash, plannedResidentIds: runFrame.profiles.map(profile => profile.id),
    executionConfigHash: fingerprint({ version: runFrame.version, models: runFrame.models, parameters: runFrame.parameters }),
    minimumCompletionRate: options.minimumCompletionRate ?? .95, requireRealModel: options.requireRealModel ?? true,
    requireUniqueProfiles: true, exposure: runFrame.exposure ?? 'full' });
}

/** Pure offline audit, never dispatches a model or rewrites submitted evidence. */
export function evaluateCompleteness(planInput: unknown, evidenceInput: unknown) {
  const plan = completenessPlanSchema.parse(planInput);
  const { run, verification } = parseSurveyEvidenceWithVerification(evidenceInput);
  const ids = new Set(plan.plannedResidentIds);
  const sampling = samplingReport(run.profiles);
  const checks = [
    { id: 'task', passed: plan.taskHash === run.taskHash },
    { id: 'population', passed: plan.populationHash === run.populationHash },
    { id: 'profiles', passed: plan.profileHash === run.profileHash },
    { id: 'prompt', passed: plan.systemPromptHash === run.prompt.systemHash },
    { id: 'execution-config', passed: plan.executionConfigHash === fingerprint({ version: run.version, models: run.models, parameters: run.parameters }) },
    { id: 'cohort', passed: run.profiles.length === ids.size && run.profiles.every(profile => ids.has(profile.id)) },
    { id: 'exposure', passed: plan.exposure === (run.exposure ?? 'full') },
    { id: 'declared-before-execution', passed: Number.isFinite(Date.parse(run.startedAt)) && Date.parse(plan.registeredAt) <= Date.parse(run.startedAt) },
    { id: 'unique-profiles', passed: !plan.requireUniqueProfiles || sampling.uniqueProfiles === ids.size },
    { id: 'frozen-preset-scope', passed: verification.frozenPresetScope === 'internally-checked' },
    { id: 'no-cache-or-retry', passed: run.parameters?.answerCache === false && run.parameters.retries === 0 },
    { id: 'real-mode', passed: !plan.requireRealModel || run.mode === 'live' },
    { id: 'terminal', passed: ['completed', 'cancelled', 'stopped'].includes(run.state ?? '') },
  ];
  const responses = new Map(run.responses.map(response => [response.residentId, response]));
  const eligible = plan.plannedResidentIds.map(id => responses.get(id));
  const valid = eligible.filter(response => response?.status === 'valid').length;
  const planned = ids.size;
  const structurallyComplete = eligible.filter(response => {
    if (!response || !['valid', 'invalid'].includes(response.status)) return false;
    try { validateAnswers(run.task, response.residentId, response.raw); return true; } catch { return false; }
  }).length;
  const counts = {
    planned, valid, structurallyComplete,
    invalid: eligible.filter(response => response?.status === 'invalid').length,
    failed: eligible.filter(response => response?.status === 'failed').length,
    notStartedOrMissing: eligible.filter(response => !response || response.status === 'not-started').length,
    completionRate: valid / planned, minimumValid: Math.ceil(plan.minimumCompletionRate * planned),
    uniqueProfiles: sampling.uniqueProfiles, duplicateProfiles: sampling.duplicateProfiles,
  };
  const integrityPassed = checks.every(check => check.passed);
  const report = {
    schemaVersion: '1.0', evaluationVersion: COMPLETENESS_EVALUATION_VERSION, evidenceVerification: verification,
    evaluationId: plan.id, planHash: fingerprint(plan), evidenceHash: fingerprint(run),
    runId: run.id, mode: run.mode, executionIdentity: 'declared-mode-not-independently-attested', registrationIdentity: 'declared-not-independently-attested',
    status: !integrityPassed ? 'not-qualified' : counts.completionRate >= plan.minimumCompletionRate ? 'threshold-met' : 'threshold-not-met',
    checks, counts,
    realThirtyResidentGate: integrityPassed && counts.completionRate >= plan.minimumCompletionRate && run.mode === 'live' && plan.exposure === 'full' && planned === 30 && valid >= 29 ? 'threshold-met-requires-provider-evidence' : 'not-met',
    declaredCoherence: { scope: 'declared-rules-only', configuredRules: run.task.validationRules?.length ?? 0,
      contradictions: eligible.filter(response => response?.coherence?.status === 'contradiction').length,
      applicable: (run.exposure ?? 'full') === 'full', openTextAndFamilyBlindReview: 'not-performed' },
    metrics: { modelCalls: run.metrics.modelCalls, inputTokens: run.metrics.inputTokens, outputTokens: run.metrics.outputTokens, estimatedApiCostCny: run.metrics.apiCostCny },
    externalValidity: 'not-validated', populationWeighted: false,
    limitations: ['计划时间和live字段来自证据声明，不是不可伪造的外部认证；哈希不证明实际付费请求或真人身份。',
      '所有计划居民保留在分母，取消/拒答/超时/缺答不可删除；此工具不将多个重复小批拼成新30人批次。',
      '结构与登记硬规则完整性不是商品偏好准确率；消融组未见属性时不可把其硬约束诊断当同等质量惩罚。',
      '未知Token或费用保持null；费用估算不是账单，重复画像不是独立真人。'],
  };
  return { ...report, reportHash: fingerprint(report) };
}
