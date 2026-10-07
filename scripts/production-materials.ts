import path from 'node:path';
import type { ProductionRun } from '../shared/production-schema.js';
import type { JevEvaluation } from '../shared/jev-schema.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import { isUnresolvedJevIntent } from '../server/production/index.js';
import { packagePath } from './production-public-safety.js';

export const SUBMISSION_BASELINE = 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466';
export const MATERIALS_VERSION = 'production-materials-v2';
const SOURCE_REPOSITORY = 'https://github.com/litianyi-007/city-agent';
export const PACKAGE_DOCS = ['README.md', 'RUNBOOK.md', 'DESIGN.md', 'EVALUATION.md', 'REQUIREMENTS.md', 'EXPERIMENTS.md', 'VALIDATION.md', 'ISOLATION.md', 'SUBMISSION.md', 'NEXT-STEPS.md', 'REVIEW.md'] as const;
type Benchmark = Pick<JevBenchmarkRun, 'id' | 'status' | 'policyVersion' | 'cases'> & { platformCommit?: string };
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
  const records: MaterialRequest[] = [];
  for (const batch of benchmarks) { uniqueIds(batch.cases, 'benchmark cases'); for (const item of batch.cases) if (item.evaluationInvoked || item.evaluation) records.push(request('jev-benchmark', batch.id, item.id, item.evaluation?.status ?? item.status, item.evaluation)); }
  for (const run of supplemental) { uniqueIds(run.jevCalls ?? [], 'production Jev calls'); for (const call of run.jevCalls ?? []) records.push(request('production-jev', run.id, call.id, call.evaluation.status, call.evaluation)); }
  const generation = supplemental.filter(run => run.evidenceKind === 'real-model');
  const requests = total(records, 'requests'); const inputTokens = total(records, 'inputTokens'); const outputTokens = total(records, 'outputTokens'); const estimatedCost = total(records, 'estimatedCost');
  return {
    version: MATERIALS_VERSION,
    measuredScope: {
      fixtureGeneration: { scope: 'Only the copied Mock generation runs; not the entire package', runIds: fixtures.map(run => run.id), started: fixtures.length, gatePassed: fixtures.filter(run => run.status === 'completed' && run.gate?.passed).length, generatorProviderRequests: 0, generatorInputTokens: 0, generatorOutputTokens: 0, estimatedGeneratorCost: 0 },
      realGeneration: { scope: 'Real internal generation tasks, not Jev decisions or outside platform development', runIds: generation.map(run => run.id), started: generation.length, recordedGatePassed: generation.filter(run => run.status === 'completed' && run.gate?.passed).length, recordedGatePassRate: generation.length ? generation.filter(run => run.status === 'completed' && run.gate?.passed).length / generation.length : null, autonomyCertified: false },
      jevDecisions: { scope: 'All recorded Jev intents/responses, including protocol errors, abstention, mixed/live failures and cancellations; skipped cases made no request', benchmarkIds: benchmarks.map(batch => batch.id), supplementalRunIds: supplemental.filter(run => (run.jevCalls?.length ?? 0) > 0).map(run => run.id), providerRequests: requests, knownProviderRequests: records.reduce((sum, item) => sum + (item.requests ?? 0), 0), unknownRequestIntents: records.filter(item => item.requests === null).length, inputTokens, outputTokens, estimatedCost, currency: 'USD', complete: requests !== null && inputTokens !== null && outputTokens !== null && estimatedCost !== null && records.every(item => item.complete), records },
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
