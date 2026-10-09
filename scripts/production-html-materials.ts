import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ProductionRun } from '../shared/production-schema.js';
import { productionRequestCounts, productionUsageLedger } from '../shared/production-ledger.js';
import { assertNoPublishedSecrets, checkedFile } from './production-public-safety.js';

/** Selected public archives only. Never enumerate a store, task directory or private state. */
export const SELECTED_HTML_MATERIAL_ARCHIVES = ['HTML-01', 'HTML-02', 'HTML-03', 'HTML-04', 'HTML-05', 'HTML-06', 'HTML-07', 'HTML-08'] as const;
export const SELECTED_HTML_MATERIAL_FILES = ['run.json', 'evidence.json', 'delivery-manifest.json', 'platform-metadata.json'] as const;
export const HTML_MATERIALS_VERSION = 'production-selected-html-v1';
export const HTML_MATERIALS_FILENAME = 'HTML-DELIVERY-STATUS.json';
const BASELINE = 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466';
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const MAX_ORIGINAL_BYTES = 4_000_000, MAX_INDEX_BYTES = 16_000_000;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function fail(detail: string): never { throw new Error('Selected HTML materials: ' + detail); }
type JsonObject = Record<string, unknown>;
const object = (value: unknown, label: string): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : fail(label + ' must be an object');
const text = (value: unknown, label: string): string => typeof value === 'string' && value.length > 0 ? value : fail(label + ' must be a nonempty string');
const count = (value: unknown, label: string): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fail(label + ' is invalid');
const nullableCount = (value: unknown, label: string): number | null => value == null ? null : count(value, label);
const nullableCost = (value: unknown, label: string): number | null => value == null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fail(label + ' is invalid');
const equal = (a: unknown, b: unknown, label: string) => { if (!isDeepStrictEqual(a, b)) fail(label + ' conflicts with its original run'); };
function date(value: unknown, label: string): string {
  const result = text(value, label); if (!Number.isFinite(Date.parse(result))) fail(label + ' is invalid'); return result;
}
function parse(bytes: Buffer, label: string): JsonObject {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_ORIGINAL_BYTES || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) fail(label + ' bytes are invalid or oversized');
  assertNoPublishedSecrets(bytes, label);
  try { return object(JSON.parse(bytes.toString('utf8')), label); } catch { return fail(label + ' JSON is invalid'); }
}
function sourceLink(publisherCommit: string, sourcePath: string): string {
  if (!COMMIT.test(publisherCommit)) fail('publisher must be an immutable full commit');
  return `https://github.com/litianyi-007/city-agent/blob/${publisherCommit}/${sourcePath}`;
}
function assertMixed(run: JsonObject, mixedRuns: readonly ProductionRun[]) {
  for (const mixed of mixedRuns) if (mixed.id === run.id) equal(mixed, run, 'existing mixed run ' + run.id);
}
function completedSource(run: JsonObject): string {
  const frozen = object(run.frozenContract, 'completed frozen contract'), gate = object(run.gate, 'completed Gate');
  if (!Array.isArray(frozen.checks) || !frozen.checks.length || !Array.isArray(gate.checks) || !gate.checks.length || !Array.isArray(run.gateHistory) || !run.gateHistory.length) fail('completed archive lacks nonempty frozen checks/Gate/history');
  text(frozen.version, 'frozen version'); date(frozen.frozenAt, 'frozenAt');
  const input = object(run.input, 'input');
  const requirementHash = digest(JSON.stringify({ requirement: input.requirement, brief: input.brief }));
  equal(frozen.requirementHash, requirementHash, 'completed requirement hash');
  equal(frozen.validationContractHash, digest(JSON.stringify(run.validationContract)), 'completed validation contract hash');
  equal(frozen.hash, digest(JSON.stringify({ validationContract: run.validationContract, requirement: input.requirement, brief: input.brief, checks: frozen.checks, ...(input.acceptanceStrategy === 'planned-groups-v1' ? { acceptanceConstruction: run.acceptanceConstruction } : {}) })), 'completed frozen payload hash');
  equal(run.gateHistory.at(-1), gate, 'completed final Gate/history');
  const actualChecks = gate.checks.map((value, i) => object(value, `Gate check ${i}`));
  if (gate.passed !== true || actualChecks.some(check => check.passed !== true)) fail('completed Gate must have passed every recorded behavior check');
  for (const value of frozen.checks) {
    const check = object(value, 'frozen check');
    if (!Array.isArray(check.steps) || !check.steps.length || !actualChecks.some(actual => actual.name === text(check.name, 'frozen check name'))) fail('completed frozen checks are not represented by actual Gate results');
  }
  if (!Array.isArray(run.artifacts) || !run.artifacts.some(value => object(value, 'artifact').name === 'index.html') || !Array.isArray(run.outputs) || !Array.isArray(run.calls)) fail('completed archive lacks generated HTML source evidence');
  const output = run.outputs.map(value => object(value, 'output')).filter(value => value.role === 'developer').at(-1);
  if (!output) fail('completed archive has no selected developer output');
  const html = text(object(output.value, 'developer output').html, 'developer HTML');
  const call = run.calls.map(value => object(value, 'call')).filter(value => value.role === 'developer' && value.selected === true && value.candidateId === output.selectedCandidateId && value.phase === output.phase);
  if (call.length !== 1) fail('completed source lacks one matching selected developer call');
  let candidate: JsonObject; try { candidate = object(JSON.parse(text(call[0].rawOutput, 'developer raw output')), 'developer JSON'); } catch { return fail('completed developer raw JSON is invalid'); }
  equal(candidate.html, html, 'completed developer raw/selected HTML');
  return html;
}
function assertCompletedManifest(run: JsonObject, manifest: JsonObject) {
  const html = completedSource(run);
  equal(manifest.frozenContract, run.frozenContract, 'completed manifest frozen contract');
  equal(manifest.source, 'index.html', 'completed manifest source'); equal(manifest.sourceSha256, digest(html), 'completed manifest source SHA');
}
function assertManifestBloodline(run: JsonObject, manifest: JsonObject, label: string) {
  if (manifest.version !== 'production-delivery-v1') fail('unregistered delivery manifest');
  for (const [key, value] of Object.entries({ runId: run.id, platformCommit: run.platformCommit, status: run.status, evidenceKind: run.evidenceKind, capability: 'offline-single-html', requirement: object(run.input, 'input').requirement, usage: run.usage, durationMs: run.durationMs, repairs: run.repairs, models: run.agentSnapshot })) equal(manifest[key], value, label + ' manifest ' + key);
  equal(manifest.failure, run.error ?? null, label + ' manifest failure');
  if (run.status === 'completed') assertCompletedManifest(run, manifest);
}
function summary(run: JsonObject) {
  const input = object(run.input, 'input'), requirement = object(input.requirement, 'requirement');
  if (!SELECTED_HTML_MATERIAL_ARCHIVES.includes(requirement.id as typeof SELECTED_HTML_MATERIAL_ARCHIVES[number])) fail('unregistered requirement');
  if (run.evidenceKind !== 'real-model' || input.mode !== 'live' || (input.capability ?? 'offline-single-html') !== 'offline-single-html') fail('not an actual HTML real-model archive');
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(String(run.status))) fail('run must be terminal');
  if (!COMMIT.test(text(run.platformCommit, 'platformCommit')) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(text(run.id, 'run id'))) fail('run/source provenance is invalid');
  if (!Array.isArray(run.calls) || !Array.isArray(run.agentSnapshot) || !Array.isArray(run.gateHistory) || !Array.isArray(run.artifacts)) fail('required run arrays are missing');
  const calls = run.calls.map((value, i) => object(value, `call ${i}`));
  if (calls.some(call => call.executionSource !== 'harness')) fail('real-model archive contains non-Harness role calls');
  const providerCounts = calls.map((call, i) => call.providerRequests == null ? null : nullableCount(object(call.providerRequests, 'providerRequests').requests, `call ${i} HTTP requests`));
  const knownProviderRequests = count(providerCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0), 'HTTP sum');
  const usage = object(run.usage, 'usage');
  if (typeof usage.complete !== 'boolean') fail('usage completeness is missing');
  if (run.jevCalls != null && !Array.isArray(run.jevCalls)) fail('Jev call ledger must be an array');
  const ledgerRun = run as unknown as ProductionRun, requests = productionRequestCounts(ledgerRun), usageLedger = productionUsageLedger(ledgerRun);
  for (const field of ['inputTokens', 'outputTokens', 'estimatedCost'] as const) {
    const observed = usage[field] == null ? null : field === 'estimatedCost' ? nullableCost(usage[field], field) : nullableCount(usage[field], field);
    const projection = usageLedger[field];
    if (observed !== null && (projection.unknownEntries || projection.overflow || usageLedger.entries && observed !== projection.knownSubtotal || !usageLedger.entries && observed !== 0)) fail('aggregate ' + field + ' conflicts with original usage entries; unknown is not zero');
  }
  if (usage.complete && (usageLedger.inputTokens.unknownEntries || usageLedger.outputTokens.unknownEntries)) fail('aggregate usage completeness conflicts with original entries');
  const models = run.agentSnapshot.map((value, i) => {
    const model = object(value, `model ${i}`); const baseUrl = text(model.baseUrl, 'baseUrl');
    let url: URL; try { url = new URL(baseUrl); } catch { return fail('model base URL is invalid'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('model base URL is not credential-free');
    const pricing = model.pricing == null ? null : object(model.pricing, 'pricing');
    return { id: text(model.id, 'model agent id'), role: text(model.role, 'model role'), provider: text(model.provider, 'provider'), baseUrl, modelId: text(model.modelId, 'model id'), declaredPricing: pricing ? { inputPerMillion: nullableCost(pricing.inputPerMillion, 'input price'), outputPerMillion: nullableCost(pricing.outputPerMillion, 'output price'), currency: text(pricing.currency, 'price currency') } : null };
  });
  const gate = run.gate == null ? null : object(run.gate, 'gate');
  if (gate && (typeof gate.passed !== 'boolean' || !Array.isArray(gate.checks))) fail('Gate is malformed');
  const frozen = run.frozenContract == null ? null : object(run.frozenContract, 'frozen contract');
  if (frozen && !SHA.test(text(frozen.hash, 'frozen hash'))) fail('frozen hash is invalid');
  if (gate && !frozen || run.status === 'completed' && (!gate?.passed || !frozen)) fail('delivery status lacks frozen behavior Gate');
  const completed = run.status === 'completed' && gate?.passed === true;
  if (completed) completedSource(run);
  return {
    requirementId: text(requirement.id, 'requirement id'), runId: text(run.id, 'run id'), platformCommit: text(run.platformCommit, 'platformCommit'),
    requirementKind: text(requirement.kind, 'requirement kind'), source: text(requirement.source, 'requirement source'), brief: text(input.brief, 'brief'),
    status: String(run.status), createdAt: date(run.createdAt, 'createdAt'), finishedAt: run.finishedAt == null ? null : date(run.finishedAt, 'finishedAt'),
    durationMs: nullableCost(run.durationMs, 'durationMs'), repairs: count(run.repairs, 'repairs'), candidateCount: count(input.candidateCount, 'candidateCount'),
    candidateBoundary: input.candidateCount === 1 ? 'N=1 checks acceptance/abstention; not multi-candidate best-answer selection.' : 'Candidate selection does not certify optimality or cost effectiveness.',
    acceptanceStrategy: input.acceptanceStrategy ?? 'legacy', verifierEngine: input.verifierEngine ?? 'llm-rubric', implementationEvidencePolicy: input.implementationEvidencePolicy ?? 'legacy',
    promptVersions: [...new Set(calls.map(call => text(call.promptVersion, 'call promptVersion')))], models,
    logicalCalls: requests.budgetRecords, harnessInvocations: calls.length, providerRequests: requests.actualProviderRequests, knownProviderRequests: requests.knownProviderRequests,
    unknownProviderCounts: requests.unknownRequestIntents, harnessProviderRequests: providerCounts.every(value => value !== null) ? knownProviderRequests : null,
    jevRequestIntents: run.jevCalls == null ? 0 : (run.jevCalls as unknown[]).length, jevProviderRequests: requests.jevProviderRequests,
    usage: { inputTokens: nullableCount(usage.inputTokens, 'inputTokens'), outputTokens: nullableCount(usage.outputTokens, 'outputTokens'), estimatedCost: nullableCost(usage.estimatedCost, 'estimatedCost'), currency: text(usage.currency, 'usage currency'), complete: usage.complete },
    costBoundary: 'Declared-price estimate, not a provider invoice; unknown is not zero. Run usage may include its Jev requests; never add those twice.',
    usageLedger,
    frozenContractReached: Boolean(frozen), frozenContractHash: frozen?.hash ?? null,
    gateState: gate ? gate.passed ? 'passed' : 'failed' : 'not-reached', gateAttempts: run.gateHistory.length, gateCheckCount: gate ? (gate.checks as unknown[]).length : null,
    recordedBehaviorGateDelivery: completed, autonomyCertified: false,
    artifactNames: run.artifacts.map((value, i) => text(object(value, `artifact ${i}`).name, 'artifact name')),
    error: run.error == null ? null : text(run.error, 'error'),
  };
}
export interface HtmlMaterialArtifact { path: string; sourcePath: string; bytes: number; sha256: string; href: string }
export interface SelectedHtmlMaterialEntry { requirementId: typeof SELECTED_HTML_MATERIAL_ARCHIVES[number]; originalRunUtf8: string; completedDeliveryManifestUtf8?: string; originalArtifacts: HtmlMaterialArtifact[]; resultHref: string; summary: ReturnType<typeof summary> }
export interface SelectedHtmlMaterials {
  version: typeof HTML_MATERIALS_VERSION; filename: typeof HTML_MATERIALS_FILENAME; publisherCommit: string;
  selection: readonly string[]; stabilityExperiment: false; autonomyCertified: false; generatedCodeExecutedInVisitorBrowser: false;
  scope: string; entries: SelectedHtmlMaterialEntry[];
}
function index(publisherCommit: string, entries: SelectedHtmlMaterialEntry[]): SelectedHtmlMaterials {
  return { version: HTML_MATERIALS_VERSION, filename: HTML_MATERIALS_FILENAME, publisherCommit, selection: [...SELECTED_HTML_MATERIAL_ARCHIVES], stabilityExperiment: false, autonomyCertified: false, generatedCodeExecutedInVisitorBrowser: false,
    scope: 'Selected different-configuration HTML tuning attempts, including zero-dispatch failures; not all historical production, a fixed-config stability experiment, three real business requirements or a certified L4/L5 result. Exact public run UTF-8 is retained; other original artifacts have independent archive byte hashes and pinned links, not embedded originals or authenticity signatures.', entries };
}
/** Pure projection from an explicit 32-file archive snapshot; no API, store or execution. */
export function buildSelectedHtmlMaterials(publisherCommit: string, files: ReadonlyMap<string, Buffer>, mixedRuns: readonly ProductionRun[] = []): SelectedHtmlMaterials {
  if (!COMMIT.test(publisherCommit)) fail('publisher must be an immutable full commit');
  const expectedPaths = SELECTED_HTML_MATERIAL_ARCHIVES.flatMap(id => SELECTED_HTML_MATERIAL_FILES.map(name => `${id}/${name}`));
  if (files.size !== expectedPaths.length || expectedPaths.some(name => !files.has(name))) fail('selected archive snapshot requires exactly all 32 registered files');
  const seenIds = new Map<string, Buffer>();
  const entries = SELECTED_HTML_MATERIAL_ARCHIVES.map(id => {
    const raw = files.get(`${id}/run.json`)!; const run = parse(raw, `${id}/run.json`), projection = summary(run);
    const previous = seenIds.get(projection.runId);
    if (previous) fail(previous.equals(raw) ? 'duplicate selected run id' : 'duplicate selected run id has conflicting original bytes');
    seenIds.set(projection.runId, raw);
    if (projection.requirementId !== id) fail('archive path/requirement id differs');
    assertMixed(run, mixedRuns);
    const evidence = parse(files.get(`${id}/evidence.json`)!, `${id}/evidence.json`); equal(evidence, run, id + ' evidence');
    const manifest = parse(files.get(`${id}/delivery-manifest.json`)!, `${id}/delivery-manifest.json`);
    assertManifestBloodline(run, manifest, id);
    const metadata = parse(files.get(`${id}/platform-metadata.json`)!, `${id}/platform-metadata.json`);
    equal(metadata.platformCommit, run.platformCommit, id + ' metadata source'); equal(metadata.frozenBaseline, BASELINE, id + ' frozen baseline');
    const build = object(metadata.build, 'metadata build'); equal(build.platformCommit, run.platformCommit, id + ' build source'); equal(build.sourceClean, true, id + ' build clean');
    const originalArtifacts = SELECTED_HTML_MATERIAL_FILES.map(name => {
      const relative = `${id}/${name}`, original = files.get(relative)!; const sourcePath = 'docs/production/experiments/' + relative;
      return { path: relative, sourcePath, bytes: original.length, sha256: digest(original), href: sourceLink(publisherCommit, sourcePath) };
    });
    return { requirementId: id, originalRunUtf8: raw.toString('utf8'), ...(run.status === 'completed' ? { completedDeliveryManifestUtf8: files.get(`${id}/delivery-manifest.json`)!.toString('utf8') } : {}), originalArtifacts, resultHref: sourceLink(publisherCommit, `docs/production/experiments/${id}/RESULT.md`), summary: projection };
  });
  const result = index(publisherCommit, entries); if (Buffer.byteLength(JSON.stringify(result)) > MAX_INDEX_BYTES) fail('index exceeds its byte bound'); return result;
}
/** Verify portable summary/links/run bytes. Optional originals also bind every independent artifact hash. */
export function verifySelectedHtmlMaterials(bytes: Buffer, publisherCommit: string, mixedRuns: readonly ProductionRun[] = [], originals?: ReadonlyMap<string, Buffer>): { index: SelectedHtmlMaterials; runs: ProductionRun[] } {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INDEX_BYTES || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail('index bytes are invalid or oversized');
  assertNoPublishedSecrets(bytes, HTML_MATERIALS_FILENAME);
  let value: JsonObject; try { value = object(JSON.parse(bytes.toString('utf8')), 'index'); } catch { return fail('index JSON is invalid'); }
  if (!COMMIT.test(publisherCommit) || !Array.isArray(value.entries) || value.entries.length !== SELECTED_HTML_MATERIAL_ARCHIVES.length) fail('index publisher/selection is invalid');
  const seen = new Map<string, Buffer>();
  const entries = value.entries.map((item, i): SelectedHtmlMaterialEntry => {
    const entry = object(item, 'entry'), id = SELECTED_HTML_MATERIAL_ARCHIVES[i];
    if (entry.requirementId !== id || typeof entry.originalRunUtf8 !== 'string') fail('index entry order/id/raw run is invalid');
    const raw = Buffer.from(entry.originalRunUtf8), run = parse(raw, id + '/run.json'), projection = summary(run);
    const previous = seen.get(projection.runId); if (previous) fail(previous.equals(raw) ? 'duplicate selected run id' : 'duplicate selected run id has conflicting original bytes'); seen.set(projection.runId, raw);
    if (projection.requirementId !== id) fail('index archive path/requirement id differs'); assertMixed(run, mixedRuns);
    if (!Array.isArray(entry.originalArtifacts) || entry.originalArtifacts.length !== SELECTED_HTML_MATERIAL_FILES.length) fail('original artifact hash inventory is missing');
    const originalArtifacts = entry.originalArtifacts.map((artifact, j): HtmlMaterialArtifact => {
      const a = object(artifact, 'original artifact'), path = `${id}/${SELECTED_HTML_MATERIAL_FILES[j]}`, sourcePath = 'docs/production/experiments/' + path;
      const result = { path, sourcePath, bytes: count(a.bytes, 'original bytes'), sha256: text(a.sha256, 'original sha256'), href: sourceLink(publisherCommit, sourcePath) };
      if (!SHA.test(result.sha256) || result.bytes === 0 || result.bytes > MAX_ORIGINAL_BYTES) fail('original hash/bytes is invalid');
      equal(a, result, 'original artifact inventory');
      if (j === 0 && (result.bytes !== raw.length || result.sha256 !== digest(raw))) fail('exact run bytes/hash differs');
      return result;
    });
    let completedDeliveryManifestUtf8: string | undefined;
    if (run.status === 'completed') {
      completedDeliveryManifestUtf8 = text(entry.completedDeliveryManifestUtf8, 'completed manifest original');
      const manifestBytes = Buffer.from(completedDeliveryManifestUtf8); assertManifestBloodline(run, parse(manifestBytes, id + '/delivery-manifest.json'), id);
      if (originalArtifacts[2].bytes !== manifestBytes.length || originalArtifacts[2].sha256 !== digest(manifestBytes)) fail('completed manifest original bytes/hash differs');
    }
    return { requirementId: id, originalRunUtf8: entry.originalRunUtf8, ...(completedDeliveryManifestUtf8 ? { completedDeliveryManifestUtf8 } : {}), originalArtifacts, resultHref: sourceLink(publisherCommit, `docs/production/experiments/${id}/RESULT.md`), summary: projection };
  });
  const result = index(publisherCommit, entries); equal(value, result, 'portable index');
  if (originals) equal(result, buildSelectedHtmlMaterials(publisherCommit, originals, mixedRuns), 'all archived originals');
  return { index: result, runs: result.entries.map(entry => JSON.parse(entry.originalRunUtf8) as ProductionRun) };
}
/** Read only the explicit public archives; no .city-agent-production access or model calls. */
export async function readSelectedHtmlMaterials(root: string, publisherCommit: string, mixedRuns: readonly ProductionRun[] = []) {
  const files = new Map<string, Buffer>();
  for (const id of SELECTED_HTML_MATERIAL_ARCHIVES) for (const name of SELECTED_HTML_MATERIAL_FILES) files.set(`${id}/${name}`, await checkedFile(root, `docs/production/experiments/${id}/${name}`));
  const materials = buildSelectedHtmlMaterials(publisherCommit, files, mixedRuns), bytes = Buffer.from(JSON.stringify(materials, null, 2));
  verifySelectedHtmlMaterials(bytes, publisherCommit, mixedRuns, files);
  return { index: materials, bytes, files, runs: materials.entries.map(entry => JSON.parse(entry.originalRunUtf8) as ProductionRun) };
}
