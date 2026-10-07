import path from 'node:path';
import type { ProductionRun } from '../shared/production-schema.js';
import type { JevEvaluation } from '../shared/jev-schema.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import { isUnresolvedJevIntent, projectProductionLedger } from '../shared/production-ledger.js';
import { packagePath } from './production-public-safety.js';

export const SUBMISSION_BASELINE = 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466';
export const MATERIALS_VERSION = 'production-materials-v4';
const SOURCE_REPOSITORY = 'https://github.com/litianyi-007/city-agent';
export const PACKAGE_DOCS = ['README.md', 'RUNBOOK.md', 'DESIGN.md', 'EVALUATION.md', 'REQUIREMENTS.md', 'EXPERIMENTS.md', 'VALIDATION.md', 'ISOLATION.md', 'SUBMISSION.md', 'NEXT-STEPS.md', 'REVIEW.md'] as const;
/** New reviewer documents are optional for historical packages. */
export const OPTIONAL_PACKAGE_DOCS = ['REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'SUBMISSION-INTRODUCTION.md', 'POST-SUBMISSION-PLAN.md', 'CAMERA-04-RESULT.md', 'JEV-RESILIENCE-V3-DESIGN.md', 'JEV-PROTOCOL-AUDIT-CAMERA-03.md', 'BATCH-CAMERA03-CHECKS.md', 'BATCH-CAMERA04-CHECKS.md'] as const;
export function reviewerInstallInstructions(reportCommit: string): string {
  if (!/^[a-f0-9]{40}$/.test(reportCommit)) throw new Error('Reviewer installation requires the immutable complete report commit');
  return `Node.js >=22.19 (validated 22.22.3); an available local port 4420.\ngit clone --branch feature/autonomous-production --single-branch ${SOURCE_REPOSITORY}.git city-agent-production-review\ncd city-agent-production-review\ngit checkout ${reportCommit}\nnpm ci\nnpx playwright install chromium\n# Optional camera-scene-v1: prepare pinned assets BEFORE a paid run\nnpx tsx scripts/prepare-camera-assets.ts\nnpx tsx scripts/prepare-camera-assets.ts --verify\n# Mock/offline review may skip the two camera preparation commands\nnpm run build\nnpm start\nOpen http://127.0.0.1:4420/#production\nModel/JeV keys are newly entered on the LOCAL page; public GitHub Pages neither receives keys nor runs this backend. Do not run generated Node/shell scripts or reuse another worktree's credentials.`;
}
export function realGenerationMaterialRecords(runs: ProductionRun[]) {
  return runs.filter(run => run.evidenceKind === 'real-model').map(run => {
    const harness = run.calls.filter(call => call.executionSource === 'harness');
    const providerCounts = harness.map(call => knownInteger(call.providerRequests?.requests) ? call.providerRequests!.requests : null);
    const roleUsage = harness.map(call => call.usage);
    const knownRoleCost = roleUsage.every(usage => usage.currency === 'USD' && knownCost(usage.estimatedCost));
    const roleCost = knownRoleCost ? roleUsage.reduce((sum, usage) => sum + usage.estimatedCost!, 0) : null;
    const roleSum = (key: 'inputTokens' | 'outputTokens') => roleUsage.every(usage => knownInteger(usage[key])) && knownInteger(roleUsage.reduce((sum, usage) => sum + usage[key]!, 0)) ? roleUsage.reduce((sum, usage) => sum + usage[key]!, 0) : null;
    return { runId: run.id, requirementId: run.input.requirement.id, platformCommit: run.platformCommit ?? null, promptVersion: [...new Set(run.calls.map(call => call.promptVersion))], capability: run.input.capability ?? 'offline-single-html', status: run.status, brief: run.input.brief, acceptance: run.input.requirement.acceptance, input: run.input, lastPhase: run.calls.at(-1)?.phase ?? run.events.at(-1)?.phase ?? null, gateState: run.gate ? run.gate.passed ? 'passed' : 'failed' : 'not-reached', gateCount: run.gateHistory.length, boundedScenePassed: run.cameraVerification?.boundedScenePassed ?? null, fullRequirementVerified: run.input.capability === 'camera-scene-v1' ? false : run.status === 'completed' && run.gate?.passed === true, roleCallCounts: Object.fromEntries([...new Set(run.calls.map(call => call.role))].map(role => [role, run.calls.filter(call => call.role === role).length])), harnessInvocations: harness.length, providerRequests: providerCounts.every(knownInteger) && knownInteger(providerCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)) ? providerCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null, knownProviderRequests: providerCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0), unknownProviderCounts: providerCounts.filter(value => value === null).length, roleOnlyUsage: { inputTokens: roleSum('inputTokens'), outputTokens: roleSum('outputTokens'), estimatedCost: knownCost(roleCost) ? roleCost : null, currency: 'USD' }, jevRequestIntents: run.jevCalls?.length ?? 0, jevRequests: run.jevCalls?.every(call => !isUnresolvedJevIntent(call.evaluation) && knownInteger(call.evaluation.providerRequests)) ? run.jevCalls.reduce((sum, call) => sum + call.evaluation.providerRequests, 0) : (run.jevCalls?.length ?? 0) === 0 ? 0 : null, usage: run.usage, durationMs: run.durationMs ?? null, repairs: run.repairs, interventions: run.interventions, error: run.error ?? null };
  });
}
export function realGenerationMaterialRows(runs: ProductionRun[]): unknown[][] {
  return realGenerationMaterialRecords(runs).map(run => [run.requirementId, run.runId, `${run.platformCommit ?? 'unknown'} / ${run.promptVersion.join(',')}`, run.brief, run.lastPhase ?? 'unknown', `${run.status}; Gate:${run.gateState}`, run.durationMs === null ? 'unknown' : `${run.durationMs} ms`, `${run.harnessInvocations} / ${run.providerRequests ?? 'unknown'} / ${run.jevRequests ?? 'unknown'}`, `${run.usage.inputTokens ?? 'unknown'} / ${run.usage.outputTokens ?? 'unknown'}`, `${formatMaterialCost(run.usage.estimatedCost)} ${run.usage.currency}`, run.error ? run.error.length > 240 ? `${run.error.slice(0, 240)}... (full original error in run.json)` : run.error : 'none']);
}
type Benchmark = Pick<JevBenchmarkRun, 'id' | 'status' | 'policyVersion' | 'cases'> & Partial<Pick<JevBenchmarkRun, 'evidenceSource'>> & { platformCommit?: string };
export interface MaterialRequest {
  origin: 'jev-benchmark' | 'production-jev';
  runId: string;
  itemId: string;
  status: string;
  requests: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  complete: boolean;
}
const knownInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const knownCost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function total(records: MaterialRequest[], key: 'requests' | 'inputTokens' | 'outputTokens' | 'estimatedCost'): number | null {
  const validate = key === 'estimatedCost' ? knownCost : knownInteger;
  if (records.some(record => !validate(record[key]))) return null;
  const value = records.reduce((sum, record) => sum + record[key]!, 0);
  return validate(value) ? value : null;
}
function request(origin: MaterialRequest['origin'], runId: string, itemId: string, status: string, evaluation: JevEvaluation | null): MaterialRequest {
  return { origin, runId, itemId, status, requests: evaluation && !isUnresolvedJevIntent(evaluation) && knownInteger(evaluation.providerRequests) ? evaluation.providerRequests : null, inputTokens: evaluation && knownInteger(evaluation.usage.inputTokens) ? evaluation.usage.inputTokens : null, outputTokens: evaluation && knownInteger(evaluation.usage.outputTokens) ? evaluation.usage.outputTokens : null, estimatedCost: evaluation && evaluation.usage.currency === 'USD' && knownCost(evaluation.usage.estimatedCost) ? evaluation.usage.estimatedCost : null, complete: Boolean(evaluation?.usage.complete) };
}
function uniqueIds(values: Array<{ id: string }>, name: string) {
  if (new Set(values.map(value => value.id)).size !== values.length) throw new Error(`${name}: duplicate run IDs would double-count evidence`);
}

/** Presentation accounting only: no provider calls, config changes, or evidence mutation. */
export function materialAccounting(fixtures: ProductionRun[], benchmarks: Benchmark[], supplemental: ProductionRun[]) {
  uniqueIds(fixtures, 'fixtures'); uniqueIds(benchmarks, 'benchmarks'); uniqueIds(supplemental, 'supplemental');
  if (fixtures.some(run => run.evidenceKind !== 'fixture' || run.input.mode !== 'demo' || run.input.requirement.kind !== 'illustrative' || run.calls.some(call => call.executionSource !== 'mock' || (call.providerRequests?.requests ?? 0) !== 0) || (run.jevCalls?.length ?? 0) !== 0 || run.usage.inputTokens !== 0 || run.usage.outputTokens !== 0 || run.usage.estimatedCost !== 0 || !run.usage.complete)) throw new Error('Fixture zero-call scope is inconsistent with its original evidence');
  if (supplemental.some(run => fixtures.some(fixture => fixture.id === run.id))) throw new Error('A run appears in both fixture and supplemental scope');
  const injected = supplemental.filter(run => run.evidenceKind === 'injected-test');
  const providerSupplemental = supplemental.filter(run => run.evidenceKind !== 'injected-test');
  const injectedBenchmarks = benchmarks.filter(batch => batch.evidenceSource === 'injected-test');
  // Keep legacy benchmark classification; absent provenance is not rewritten.
  const providerBenchmarks = benchmarks.filter(batch => batch.evidenceSource !== 'injected-test');
  const records: MaterialRequest[] = [];
  for (const batch of benchmarks) uniqueIds(batch.cases, 'benchmark cases');
  for (const batch of providerBenchmarks) for (const item of batch.cases) if (item.evaluationInvoked || item.evaluation) records.push(request('jev-benchmark', batch.id, item.id, item.evaluation?.status ?? item.status, item.evaluation));
  for (const run of supplemental) uniqueIds(run.jevCalls ?? [], 'production Jev calls');
  for (const run of providerSupplemental) for (const call of run.jevCalls ?? []) records.push(request('production-jev', run.id, call.id, call.evaluation.status, call.evaluation));
  const generation = supplemental.filter(run => run.evidenceKind === 'real-model');
  const generationRecords = realGenerationMaterialRecords(generation);
  const terminal = generation.filter(run => !['queued', 'running'].includes(run.status));
  const fullDelivered = terminal.filter(run => run.status === 'completed' && run.gate?.passed && run.input.capability !== 'camera-scene-v1');
  const requests = total(records, 'requests'); const inputTokens = total(records, 'inputTokens'); const outputTokens = total(records, 'outputTokens'); const estimatedCost = total(records, 'estimatedCost');
  return {
    version: MATERIALS_VERSION,
    measuredScope: {
      fixtureGeneration: { scope: 'Only the copied Mock generation runs; not the entire package', runIds: fixtures.map(run => run.id), started: fixtures.length, gatePassed: fixtures.filter(run => run.status === 'completed' && run.gate?.passed).length, generatorProviderRequests: 0, generatorInputTokens: 0, generatorOutputTokens: 0, estimatedGeneratorCost: 0 },
      realGeneration: { scope: 'Different-configuration tuning ledger of actual internal generation attempts; not a fixed-configuration stability experiment. Per-run usage includes its Jev requests; do not add it to all-Jev totals.', runIds: generation.map(run => run.id), started: generation.length, recordedGatePassed: generation.filter(run => run.status === 'completed' && run.gate?.passed).length, recordedGatePassRate: generation.length ? generation.filter(run => run.status === 'completed' && run.gate?.passed).length / generation.length : null, terminalDenominator: terminal.length, fullRequirementDelivered: fullDelivered.length, fullRequirementDeliveryRate: terminal.length ? fullDelivered.length / terminal.length : null, boundedCameraScenePassed: terminal.filter(run => run.cameraVerification?.boundedScenePassed === true).length, autonomyCertified: false, records: generationRecords },
      jevDecisions: { scope: 'Recorded non-injected Jev intents/responses, including protocol errors, abstention, mixed/live failures and cancellations; skipped cases made no request. Explicitly injected production/benchmark evidence is retained separately, never added to these provider totals. Legacy benchmark classification is preserved, not recertified.', benchmarkIds: providerBenchmarks.map(batch => batch.id), supplementalRunIds: providerSupplemental.filter(run => (run.jevCalls?.length ?? 0) > 0).map(run => run.id), providerRequests: requests, knownProviderRequests: records.reduce((sum, item) => sum + (item.requests ?? 0), 0), unknownRequestIntents: records.filter(item => item.requests === null).length, inputTokens, outputTokens, estimatedCost, currency: 'USD', complete: requests !== null && inputTokens !== null && outputTokens !== null && estimatedCost !== null && records.every(item => item.complete), records },
      injectedEngineering: {
        scope: 'Injected engineering records, not real generation or verified provider spending. Jev dispatch observations do not prove HTTP. Any explicit Harness HTTP observations remain in the per-run ledger; unknown is not zero.',
        runIds: injected.map(run => run.id), started: injected.length, countedAsRealGeneration: false, countedInJevDecisions: false,
        records: injected.map(run => ({ runId: run.id, status: run.status, evidenceKind: run.evidenceKind, ledger: projectProductionLedger(run), usageScope: 'Injected usage observations only; not verified real spending and not included in real Jev totals.', originalRun: structuredClone(run) })),
        benchmarkIds: injectedBenchmarks.map(batch => batch.id), benchmarkStarted: injectedBenchmarks.length,
        benchmarkRecords: injectedBenchmarks.map(batch => ({
          benchmarkId: batch.id, status: batch.status, evidenceSource: batch.evidenceSource, originalBenchmark: structuredClone(batch),
          cases: batch.cases.filter(item => item.evaluationInvoked || item.evaluation).map(item => ({
            itemId: item.id, status: item.status, evaluationInvoked: item.evaluationInvoked, unresolvedEvaluationIntent: item.evaluationInvoked && !item.evaluation,
            // Projection metadata is not a synthetic model call or a rewrite
            // of the benchmark. A missing response remains an unknown ledger.
            ledger: item.evaluation ? projectProductionLedger({ evidenceKind: 'injected-test', calls: [], jevCalls: [{ id: item.id, phase: 'benchmark', startedAt: item.startedAt ?? 'unknown', configHash: 'projection-only', evaluation: item.evaluation }], usage: item.evaluation.usage }) : null,
            usageScope: 'Injected usage observations only; not verified real spending and not included in real Jev totals.',
          })),
        })),
      },
      excludes: ['Outside platform developer/model cost', 'Device and recording cost', 'Provider invoice verification', 'Measured same-scope human baseline'],
    },
  };
}

export function formatMaterialCost(value: number | null | undefined): string {
  return knownCost(value) ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 12 }) : 'unknown';
}
export function benchmarkMaterialRows(benchmarks: Benchmark[]): unknown[][] {
  return benchmarks.flatMap(batch => batch.cases.map(item => {
    const unrequested = !item.evaluationInvoked && !item.evaluation;
    const status = item.evaluation?.status ?? item.status;
    const selected = item.selectedCandidateId ?? (status === 'uncertain' ? '系统弃权' : status === 'rejected' ? '拒绝/未选择' : '未选择');
    return [batch.id.slice(0, 8), item.id, status, unrequested ? '未执行' : item.comparison.firstPassed === null ? 'unknown' : item.comparison.firstPassed ? '通过' : '失败', selected, unrequested ? '未执行' : item.comparison.selectedPassed === null ? '未选择/unknown' : item.comparison.selectedPassed ? '通过' : '失败', unrequested ? '未请求' : item.evaluation?.usage.inputTokens ?? 'unknown', unrequested ? '未请求' : formatMaterialCost(item.evaluation?.usage.estimatedCost)];
  }));
}
export function immutableSourceLink(commit: string, sourcePath: string) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Source links require an immutable full commit');
  const normalized = path.posix.normalize(sourcePath);
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized === '..' || /[?#\\]/.test(normalized)) throw new Error('Invalid repository source path');
  return `${SOURCE_REPOSITORY}/blob/${commit}/${normalized.split('/').map(encodeURIComponent).join('/')}`;
}
/** Keep packaged sibling docs local; every absent source reference is pinned to its actual origin. */
export function packageDocLinks(markdown: string, commit: string, available: readonly string[]) {
  return markdown.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (original, label: string, target: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return original;
    const [withoutAnchor, anchor] = target.split('#', 2);
    if (available.includes(withoutAnchor)) return original;
    return `[${label}](${immutableSourceLink(commit, path.posix.join('docs/production', withoutAnchor))}${anchor ? `#${encodeURIComponent(anchor)}` : ''})`;
  });
}
export function publicMaterialUrl(value: string | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Public demo URL must be an HTTPS URL without credentials/query/hash');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
/** All inherited reads use the already checked in-memory snapshot, never a fresh unregistered path. */
export function inheritedMaterialFile(files: ReadonlyMap<string, Buffer> | null, name: string): Buffer {
  packagePath(name);
  const value = files?.get(name);
  if (!value) throw new Error(`Archived evidence was not registered and verified: ${name}`);
  return value;
}
