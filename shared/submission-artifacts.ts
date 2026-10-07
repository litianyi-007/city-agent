import { z } from 'zod';
import { sha256 } from 'js-sha256';
import { fingerprint } from './evidence';
import { BUSINESS_DEMO_VERSION, BUSINESS_FIXTURE_POLICY_ID, BUSINESS_DEMO_NOTICE } from './research-demo';
import { parseBusinessProofSnapshot } from '../src/business-proof-history';
import { preflightResearchTask } from '../server/research/contract';

export const SUBMISSION_ARTIFACT_VERIFIER_VERSION = 'submission-artifacts-verifier-1.0';
const scenarios = ['child-snacks', 'pet-snacks'] as const;
const caseFiles = ['questionnaire.json', 'presets.json', 'survey-run.json', 'logic-audit.json', 'raw-responses.json', 'statistics.json', 'prompts.txt'] as const;
/** Exactly these payloads, plus the separately validated manifest.json, may be copied. */
export const SUBMISSION_BUSINESS_FILE_NAMES = Object.freeze([
  'business-proof.json', 'proof-report.md', ...scenarios.flatMap(id => caseFiles.map(name => `${id}/${name}`)),
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  schemaVersion: z.literal('1.0'), proofVersion: z.literal(BUSINESS_DEMO_VERSION), id: z.string().uuid(),
  mode: z.literal('fixture'), policyId: z.literal(BUSINESS_FIXTURE_POLICY_ID), modelCalls: z.literal(0), notice: z.literal(BUSINESS_DEMO_NOTICE),
  files: z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative(), sha256: hash }).strict()).length(16),
}).strict();
const proofSchema = z.object({
  schemaVersion: z.literal('1.0'), proofVersion: z.literal(BUSINESS_DEMO_VERSION), id: z.string().uuid(), createdAt: z.string().datetime(),
  mode: z.literal('fixture'), notice: z.literal(BUSINESS_DEMO_NOTICE), seed: z.number().int().min(0).max(2147483647),
  scenarios: z.tuple([z.literal('child-snacks'), z.literal('pet-snacks')]), countPerScenario: z.literal(12), modelCalls: z.literal(0), apiCostCny: z.literal(0),
  sourceFiles: z.array(z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: hash }).strict()), stableEvidenceHash: hash,
  realModelQuality: z.literal('not-tested'), personaBehaviorValidated: z.literal(false), businessRecommendation: z.literal('not-supported'),
  qualificationAndBusinessData: z.literal('needs-data'), sourceVerification: z.literal('registered-local-bytes-not-independent-truth-certification'),
  cases: z.array(z.record(z.string(), z.unknown())).length(2),
}).strict();

export function submissionPromptsText(run: ReturnType<typeof parseBusinessProofSnapshot>['run']): string {
  return `SYSTEM\n${run.prompt.system}\n\n${run.prompt.users.map(user => `RESIDENT ${user.residentId} SHA256 ${user.hash}\n${user.text}`).join('\n\n')}`;
}

/** Pure in-memory validation. No IO, model calls, new scoring, or rewriting frozen evidence. */
export function verifySubmissionArtifacts(input: {
  proofId: string; proof: unknown; manifest: unknown; files: Readonly<Record<string, string | Uint8Array>>;
}) {
  const proof = proofSchema.parse(input.proof); const manifest = manifestSchema.parse(input.manifest);
  const forbiddenField = (value: unknown): boolean => !!value && typeof value === 'object'
    && Object.entries(value).some(([key, child]) => /^(apiKey|authorization|secret|secrets)$/i.test(key) || forbiddenField(child));
  if (forbiddenField(proof)) throw new Error('业务总账包含凭据字段，不可进入申报附件。');
  if (proof.id !== input.proofId || manifest.id !== input.proofId || manifest.notice !== proof.notice) throw new Error('申报业务总账与manifest身份不一致。');
  const names = [...SUBMISSION_BUSINESS_FILE_NAMES].sort();
  if (fingerprint(Object.keys(input.files).sort()) !== fingerprint(names)
    || fingerprint(manifest.files.map(file => file.name).sort()) !== fingerprint(names)) throw new Error('业务附件清单须精确匹配16个登记文件；拒绝遗漏、重复、额外或路径式文件。');
  const bytes = (name: string) => typeof input.files[name] === 'string' ? new TextEncoder().encode(input.files[name]) : input.files[name] as Uint8Array;
  const text = (name: string) => new TextDecoder('utf-8', { fatal: true }).decode(bytes(name));
  const json = (name: string): unknown => JSON.parse(text(name));
  for (const file of manifest.files) {
    const value = bytes(file.name);
    if (value.byteLength !== file.bytes || sha256(value) !== file.sha256) throw new Error(`业务附件字节不一致：${file.name}`);
  }
  if (fingerprint(json('business-proof.json')) !== fingerprint(proof)) throw new Error('业务总账附件与输入总账不一致。');
  const cases = scenarios.map(id => {
    const snapshot = parseBusinessProofSnapshot({ schemaVersion: '1.0', kind: 'business-demo-proof', execution: 'fixture-only', realModelCalls: 0,
      run: json(`${id}/survey-run.json`), logicAudit: json(`${id}/logic-audit.json`) });
    const { run, logicAudit } = snapshot;
    if (run.task.id !== `business-${id}` || run.experiment?.arm !== id || run.experiment.id !== proof.proofVersion
      || run.seed !== proof.seed || run.state !== 'completed' || (run.exposure ?? 'full') !== 'full'
      || run.profiles.length !== 12 || run.metrics.valid !== 12 || run.metrics.structurallyValid !== 12
      || logicAudit.status !== 'checked' || logicAudit.passed !== 12 || logicAudit.failed !== 0
      || run.task.questionnaire.questions.length !== (id === 'child-snacks' ? 17 : 18)
      || !run.presetSnapshots?.length || fingerprint(run.models) !== fingerprint(run.presetSnapshots.map(preset =>
        ({ presetId: preset.id, provider: preset.provider, baseUrl: preset.baseUrl, modelId: preset.modelId })))
      || run.models.some(model => model.modelId !== 'fixture-no-model')) throw new Error(`业务场景/seed/模型标识或完成门限不一致：${id}`);
    const mirrors: [string, unknown][] = [
      ['questionnaire.json', run.task], ['presets.json', run.presetSnapshots], ['raw-responses.json', run.responses],
      ['statistics.json', { summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }],
    ];
    for (const [name, expected] of mirrors) if (fingerprint(json(`${id}/${name}`)) !== fingerprint(expected)) throw new Error(`业务附件与冻结run不一致：${id}/${name}`);
    if (text(`${id}/prompts.txt`) !== submissionPromptsText(run)) throw new Error(`可读Prompt与冻结run不一致：${id}`);
    const reports = proof.cases.filter(report => report.demoId === id);
    if (reports.length !== 1) throw new Error(`业务总账场景缺失或重复：${id}`);
    const report = reports[0];
    const evidenceHash = fingerprint({ taskHash: run.taskHash, populationHash: run.populationHash, profilesHash: run.profileHash,
      rawResponses: run.responses.map(response => ({ residentId: response.residentId, raw: response.raw })), rulesHash: logicAudit.rulesHash, verifierVersion: logicAudit.verifierVersion });
    const promptLinks = run.profiles.map(profile => {
      const user = run.prompt.users.find(item => item.residentId === profile.id)!;
      return { residentId: profile.id, presetId: profile.presetId, personaHash: fingerprint(profile.persona), promptHash: user.hash,
        frozenPersonaMatches: fingerprint(JSON.parse(user.text).resident.persona) === fingerprint(profile.persona),
        rawHash: fingerprint(run.responses.find(response => response.residentId === profile.id)!.raw) };
    });
    const expected: Record<string, unknown> = { schemaVersion: '1.0', demoId: id, proofVersion: proof.proofVersion, mode: 'fixture', policyId: BUSINESS_FIXTURE_POLICY_ID,
      notice: proof.notice, questions: run.task.questionnaire.questions.length, planned: 12, structurallyValid: run.metrics.structurallyValid,
      independentLogicPassed: logicAudit.passed, realModelQuality: 'not-tested', realResidentPreferenceValidated: false, personaBehaviorValidated: false,
      businessRecommendation: 'not-supported', targetPopulationDenominator: null, promptLinks, qualificationPreflight: preflightResearchTask(run.task, run.populationSnapshot!),
      metrics: run.metrics, sampling: run.sampling, hashes: { task: run.taskHash, population: run.populationHash, profiles: run.profileHash, rules: logicAudit.rulesHash, evidence: evidenceHash }, limitations: run.limitations };
    for (const [key, value] of Object.entries(expected)) if (fingerprint(report[key]) !== fingerprint(value)) throw new Error(`业务总账与冻结证据或效度边界不一致：${id}/${key}`);
    return { id, run, audit: logicAudit, evidenceHash };
  });
  if (proof.stableEvidenceHash !== fingerprint(cases.map(value => ({ demoId: value.id, evidenceHash: value.evidenceHash })))) throw new Error('业务稳定证据总指纹不一致。');
  return { cases, verification: { verifierVersion: SUBMISSION_ARTIFACT_VERIFIER_VERSION, registeredFiles: [...SUBMISSION_BUSINESS_FILE_NAMES],
    sourceAndExecutionAuthenticity: 'not-independently-attested', marketResearchValidated: false, rawEvidenceModified: false } as const };
}
