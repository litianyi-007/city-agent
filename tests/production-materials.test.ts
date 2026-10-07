import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchmarkMaterialRows, CAMERA_DELIVERY_NOTICE, CAMERA_DELIVERY_SCOPE, CAMERA_MATERIAL_ARCHIVES, cameraMaterialAppendPlan, cameraMaterialFiles, formatMaterialCost, immutableSourceLink, inheritedMaterialFile, materialAccounting, materialInheritancePaths, MATERIALS_VERSION, OPTIONAL_PACKAGE_DOCS, packageDocLinks, publicMaterialUrl, realGenerationMaterialRecords, realGenerationMaterialRows, reviewerInstallInstructions, SUBMISSION_BASELINE } from '../scripts/production-materials.js';
import { readCheckedPackage, sha256 } from '../scripts/production-public-safety.js';
import { VERIFIER_REAL02_MATERIAL_FILES } from '../scripts/production-study-materials.js';
import { createJevBenchmarkSnapshot } from '../server/production/jev-benchmark.js';
import { DEFAULT_JEV_CONFIG, type JevEvaluation } from '../shared/jev-schema.js';
import { productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';

const originalCommit = '891fedcab0f3c5994c7e92f7874e610b3b6354b8';
function fixture(id: string): ProductionRun {
  return { id, platformCommit: originalCommit, evidenceKind: 'fixture', input: productionRunInputSchema.parse({ brief: 'Offline test task', agentIds: Array.from({ length: 6 }, () => '00000000-0000-4000-8000-000000000001'), requirement: { id, source: 'unit fixture, not real business', acceptance: 'Add and delete task' } }), status: 'completed', createdAt: '2026-10-06T21:00:00.000Z', agentSnapshot: [], events: [], calls: [], verifications: [], outputs: [], gateHistory: [], gate: { passed: true, checks: [] }, repairs: 0, usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: true }, interventions: [], artifacts: [] };
}
function evaluation(status: JevEvaluation['status'], input: number, output: number): JevEvaluation {
  return { policyVersion: 'unit-fixture', status, selectedCandidateId: status === 'accepted' ? 'candidate-b' : null, reason: 'injected fixture, no external API', requestSnapshot: null, rawResponse: null, scores: [], choice: null, modelIdRequested: 'fixture', modelIdReturned: 'fixture', httpStatus: 200, providerRequests: 1, durationMs: 1, usage: { inputTokens: input, outputTokens: output, estimatedCost: input * 0.042 / 1e6, currency: 'USD', complete: true } };
}
function mockExperiment(): { fixtures: ProductionRun[]; benchmarks: ReturnType<typeof createJevBenchmarkSnapshot>[]; supplemental: ProductionRun[] } {
  const v1 = createJevBenchmarkSnapshot({ ...DEFAULT_JEV_CONFIG, enabled: true }, { id: 'old-failed' });
  v1.policyVersion = 'jev-candidate-v1'; v1.status = 'failed';
  v1.cases[0].evaluationInvoked = true; v1.cases[0].status = 'failed'; v1.cases[0].evaluation = evaluation('error', 3386, 177); v1.cases[0].comparison.firstPassed = false;
  for (const item of v1.cases.slice(1)) item.status = 'skipped';
  const v2 = createJevBenchmarkSnapshot({ ...DEFAULT_JEV_CONFIG, enabled: true }, { id: 'new-complete' });
  v2.status = 'completed';
  for (const [index, item] of v2.cases.entries()) {
    item.evaluationInvoked = true; item.status = 'completed'; item.evaluation = evaluation(index === 1 ? 'uncertain' : 'accepted', [3386, 3432, 3442][index], 177); item.selectedCandidateId = item.evaluation.selectedCandidateId; item.comparison.firstPassed = index === 1; item.comparison.selectedPassed = index === 1 ? null : true;
  }
  const mixed = { ...fixture('mixed-failed'), evidenceKind: 'fixture-with-real-jev' as const, status: 'failed' as const, input: { ...fixture('mixed-failed').input, mode: 'mock-jev' as const }, gate: undefined, jevCalls: [{ id: 'mixed-call', phase: 'product', startedAt: '2026-10-06T21:00:00.000Z', configHash: 'fixture', evaluation: evaluation('uncertain', 1381, 166) }] };
  return { fixtures: [fixture('MOCK-01'), fixture('MOCK-02'), fixture('MOCK-03')], benchmarks: [v1, v2], supplemental: [mixed] };
}

test('material scopes preserve all five Jev requests including old and mixed failures, without relabelling Mock as generation', () => {
  const source = mockExperiment(); const before = JSON.stringify(source);
  const { measuredScope } = materialAccounting(source.fixtures, source.benchmarks, source.supplemental);
  assert.equal(measuredScope.fixtureGeneration.gatePassed, 3); assert.equal(measuredScope.fixtureGeneration.generatorProviderRequests, 0);
  assert.equal(measuredScope.realGeneration.started, 0); assert.equal(measuredScope.realGeneration.recordedGatePassRate, null); assert.equal(measuredScope.realGeneration.autonomyCertified, false);
  assert.equal(measuredScope.jevDecisions.providerRequests, 5); assert.equal(measuredScope.jevDecisions.inputTokens, 15027); assert.equal(measuredScope.jevDecisions.outputTokens, 874);
  assert.equal(formatMaterialCost(measuredScope.jevDecisions.estimatedCost), '0.000631134'); assert.equal(measuredScope.jevDecisions.complete, true);
  assert.equal(measuredScope.jevDecisions.records[0].status, 'error'); assert.equal(measuredScope.jevDecisions.records.at(-1)?.runId, 'mixed-failed');
  assert.equal(JSON.stringify(source), before); assert.equal(source.fixtures[0].platformCommit, originalCommit); assert.notEqual(originalCommit, SUBMISSION_BASELINE);
});

test('missing usage or a saved paid intent without response stays unknown, not zero or silently excluded', () => {
  const source = mockExperiment();
  source.benchmarks[0].cases[0].evaluation = null;
  const usage = materialAccounting(source.fixtures, source.benchmarks, source.supplemental).measuredScope.jevDecisions;
  assert.equal(usage.unknownRequestIntents, 1); assert.equal(usage.providerRequests, null); assert.equal(usage.knownProviderRequests, 4); assert.equal(usage.inputTokens, null); assert.equal(usage.estimatedCost, null); assert.equal(usage.complete, false);
  source.benchmarks[0].cases[0].evaluation = evaluation('error', 3386, 177);
  source.benchmarks[0].cases[0].evaluation!.usage = { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false };
  const missing = materialAccounting(source.fixtures, source.benchmarks, source.supplemental).measuredScope.jevDecisions;
  assert.equal(missing.providerRequests, 5); assert.equal(missing.estimatedCost, null); assert.equal(missing.complete, false);
});

test('pending zero-count Jev placeholder means unknown request intent; a completed preflight error remains known zero', () => {
  const source = mockExperiment();
  const pending: JevEvaluation = { ...evaluation('error', 0, 0), providerRequests: 0, durationMs: 0, requestSnapshot: null, rawResponse: null, httpStatus: null, modelIdReturned: null, reason: 'Any language; not a reliable completion signal', usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD', complete: false } };
  source.supplemental[0].jevCalls![0].evaluation = pending;
  const unresolved = materialAccounting(source.fixtures, source.benchmarks, source.supplemental).measuredScope.jevDecisions;
  assert.equal(unresolved.providerRequests, null); assert.equal(unresolved.knownProviderRequests, 4); assert.equal(unresolved.unknownRequestIntents, 1); assert.equal(unresolved.estimatedCost, null);
  pending.error = 'Completed preflight validation rejected the request before dispatch';
  const preflight = materialAccounting(source.fixtures, source.benchmarks, source.supplemental).measuredScope.jevDecisions;
  assert.equal(preflight.providerRequests, 4); assert.equal(preflight.knownProviderRequests, 4); assert.equal(preflight.unknownRequestIntents, 0);
});

test('only truly skipped cases display not requested; protocol error is not labelled abstention', () => {
  const source = mockExperiment(); const rows = benchmarkMaterialRows(source.benchmarks);
  assert.equal(rows[0][2], 'error'); assert.equal(rows[0][4], '未选择'); assert.equal(rows[0][7], '0.000142212');
  assert.equal(rows[1][2], 'skipped'); assert.equal(rows[1][3], '未执行'); assert.equal(rows[1][4], '未选择'); assert.equal(rows[1][6], '未请求'); assert.equal(rows[1][7], '未请求');
  assert.equal(rows[4][2], 'uncertain'); assert.equal(rows[4][4], '系统弃权');
  assert.equal(rows[5][7], '0.000144564'); assert.equal(String(rows[5][7]).includes('00000000002'), false);
});

test('zero-call fixture assertion rejects actual calls, unknown cost and duplicate evidence rather than hiding it', () => {
  const source = mockExperiment();
  source.fixtures[0].jevCalls = source.supplemental[0].jevCalls;
  assert.throws(() => materialAccounting(source.fixtures, source.benchmarks, source.supplemental), /Fixture zero-call/);
  source.fixtures[0].jevCalls = []; source.fixtures[0].usage.estimatedCost = null;
  assert.throws(() => materialAccounting(source.fixtures, source.benchmarks, source.supplemental), /Fixture zero-call/);
  assert.throws(() => materialAccounting([fixture('same'), fixture('same')], [], []), /duplicate/);
});

test('real generation records are separate from mixed Jev evidence and do not imply certified autonomy', () => {
  const source = mockExperiment();
  const real = { ...fixture('real-failed'), evidenceKind: 'real-model' as const, status: 'failed' as const, gate: undefined };
  source.supplemental.push(real);
  const result = materialAccounting(source.fixtures, source.benchmarks, source.supplemental).measuredScope;
  assert.equal(result.realGeneration.started, 1); assert.equal(result.realGeneration.recordedGatePassRate, 0); assert.equal(result.realGeneration.autonomyCertified, false); assert.equal(result.jevDecisions.providerRequests, 5);
});

test('immutable source links fix absent package references without moving original run provenance', () => {
  const doc = '[Tasks](NEXT-STEPS.md) [Archive](archive/README.md) [Schema](../../shared/production-benchmarks.ts) [External](https://example.org) [Mock raw](MOCK-01/run.json) [Camera raw](CAMERA-04/run.json)';
  const result = packageDocLinks(doc, originalCommit, ['NEXT-STEPS.md', 'MOCK-01/run.json', 'CAMERA-04/run.json']);
  assert.ok(result.includes('[Tasks](NEXT-STEPS.md)'));
  assert.ok(result.includes(`/blob/${originalCommit}/docs/production/archive/README.md`)); assert.ok(result.includes(`/blob/${originalCommit}/shared/production-benchmarks.ts`));
  assert.ok(result.includes('[External](https://example.org)')); assert.throws(() => immutableSourceLink('main', 'docs/production/README.md'), /immutable/); assert.throws(() => immutableSourceLink(originalCommit, '../secret'), /Invalid/);
  assert.ok(result.includes('[Mock raw](MOCK-01/run.json)')); assert.ok(result.includes('[Camera raw](CAMERA-04/run.json)'));
});

test('public material URL supports only explicit safe HTTPS static entry and does not enable API operations', () => {
  assert.equal(publicMaterialUrl(undefined), null); assert.equal(publicMaterialUrl('https://litianyi-007.github.io/city-agent/production'), 'https://litianyi-007.github.io/city-agent/production/');
  for (const value of ['http://example.org/', 'https://user:secret@example.org/', 'https://example.org/?key=value', 'https://example.org/#live']) assert.throws(() => publicMaterialUrl(value));
});

test('cost presentation removes floating artifacts but retains unknown and very small nonzero values', () => {
  assert.equal(formatMaterialCost(null), 'unknown'); assert.equal(formatMaterialCost(Number.NaN), 'unknown'); assert.equal(formatMaterialCost(0), '0'); assert.equal(formatMaterialCost(1e-12), '0.000000000001');
});

test('inherited reads cannot access files absent from the verified manifest snapshot or outside the package allowlist', () => {
  const snapshot = new Map([['requirements.json', Buffer.from('["original"]')]]);
  assert.equal(inheritedMaterialFile(snapshot, 'requirements.json').toString(), '["original"]');
  assert.throws(() => inheritedMaterialFile(snapshot, 'MOCK-01/run.json'), /not registered and verified/);
  assert.throws(() => inheritedMaterialFile(snapshot, '../private.json'), /Invalid/);
  assert.throws(() => inheritedMaterialFile(snapshot, 'settings.json'), /allowlist/);
});

const requiredEvidence = ['requirements.json', 'submission-evidence.json', 'jev-benchmarks.json', 'mixed-and-live-runs.json', 'production-mock-submission.pdf', 'demo.webm', ...['01', '02', '03'].flatMap(id => ['input.json', 'run.json', 'gate.json', 'index.html', 'delivery-manifest.json', 'evidence.json'].map(name => `MOCK-${id}/${name}`))];
async function evidencePackage(directory: string, omit: string | null = null) {
  const files: Array<{ path: string; sha256: string }> = [];
  for (const name of requiredEvidence) {
    if (name === omit) continue;
    const bytes = Buffer.from(name.endsWith('.json') ? '{}' : 'unit test bytes, not a PDF/video artifact');
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await writeFile(path.join(directory, name), bytes);
    files.push({ path: name, sha256: sha256(bytes) });
  }
  await writeFile(path.join(directory, 'package-manifest.json'), JSON.stringify({ version: 'mock-package-v1', generatedAt: '2026-10-06T21:00:00.000Z', platformCommit: originalCommit, submissionBaseline: SUBMISSION_BASELINE, files }));
}

test('offline package rejects omitted required JSON even when an unregistered symlink exists on disk', async t => {
  const directory = await mkdtemp(path.join(process.cwd(), '.city-agent-materials-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'); await mkdir(source); await evidencePackage(source, 'requirements.json');
  const sidecar = path.join(directory, 'sidecar.json'); await writeFile(sidecar, '{"notEvidence":true}'); await symlink(sidecar, path.join(source, 'requirements.json'));
  await assert.rejects(readCheckedPackage(source), /Required public evidence is missing: requirements.json/);
});

test('ordinary manifest, every registered hash, and bounded count are mandatory before any inherited record is read', async t => {
  const directory = await mkdtemp(path.join(process.cwd(), '.city-agent-materials-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'); await mkdir(source); await evidencePackage(source);
  const checked = await readCheckedPackage(source); const before = inheritedMaterialFile(checked.files, 'requirements.json');
  await writeFile(path.join(source, 'requirements.json'), '{"changed":true}');
  assert.equal(inheritedMaterialFile(checked.files, 'requirements.json').equals(before), true);
  await assert.rejects(readCheckedPackage(source), /hash mismatch/);
  const manifestAlias = path.join(directory, 'alias'); await mkdir(manifestAlias); await symlink(path.join(source, 'package-manifest.json'), path.join(manifestAlias, 'package-manifest.json'));
  await assert.rejects(readCheckedPackage(manifestAlias), /ordinary publication files/);
  const oversized = path.join(directory, 'oversized'); await mkdir(oversized);
  await writeFile(path.join(oversized, 'package-manifest.json'), JSON.stringify({ version: 'mock-package-v1', platformCommit: originalCommit, submissionBaseline: SUBMISSION_BASELINE, files: Array.from({ length: 101 }, () => ({ path: 'requirements.json', sha256: '0'.repeat(64) })) }));
  await assert.rejects(readCheckedPackage(oversized), /registered frozen/);
});

test('reviewer instructions pin the complete report commit and document correct independent installation and camera preparation', () => {
  const instructions = reviewerInstallInstructions(originalCommit);
  for (const clause of ['Node.js >=22.19', '--branch feature/autonomous-production --single-branch', `git checkout --detach ${originalCommit}`, 'npm ci', 'npx playwright install chromium', 'npm run build', 'npm start', 'http://127.0.0.1:4420/#production', 'npx tsx scripts/prepare-camera-assets.ts', '--verify', 'public GitHub Pages neither receives keys nor runs this backend']) assert.ok(instructions.includes(clause), clause);
  assert.throws(() => reviewerInstallInstructions('main'), /complete report commit/); assert.throws(() => reviewerInstallInstructions(originalCommit.slice(0, 7)), /complete report commit/);
  assert.equal(MATERIALS_VERSION, 'production-materials-v6'); assert.ok(OPTIONAL_PACKAGE_DOCS.includes('REVIEWER-GUIDE.md')); assert.ok(OPTIONAL_PACKAGE_DOCS.includes('SUBMISSION-REPORT.md'));
});
test('v6 checked package requires complete pinned REAL02 appendix, while historical materials retain their smaller contract', async t => {
  const directory = await mkdtemp(path.join(process.cwd(), '.city-agent-materials-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source'); await mkdir(source); await evidencePackage(source);
  const manifest = JSON.parse(await readFile(path.join(source, 'package-manifest.json'), 'utf8'));
  for (const name of VERIFIER_REAL02_MATERIAL_FILES) {
    const bytes = await readFile(new URL('../docs/production/experiments/' + name, import.meta.url));
    await mkdir(path.dirname(path.join(source, name)), { recursive: true }); await writeFile(path.join(source, name), bytes);
    manifest.files.push({ path: name, sha256: sha256(bytes) });
  }
  await writeFile(path.join(source, 'package-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(readCheckedPackage(source), /requires the reviewed v6/);
  manifest.version = 'mock-package-v2'; manifest.materialsVersion = 'production-materials-v6';
  await writeFile(path.join(source, 'package-manifest.json'), JSON.stringify(manifest));
  const result = await readCheckedPackage(source); assert.equal(result.verifierStudy?.valueVerdict.highValue, false);
  manifest.files = manifest.files.filter((file: { path: string }) => file.path !== 'VERIFIER-REAL-02/control/terminal.confirmed.json');
  await writeFile(path.join(source, 'package-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(readCheckedPackage(source), /pinned actual ledger/);
  manifest.files = Array.from({ length: 121 }, () => ({ path: 'requirements.json', sha256: '0'.repeat(64) }));
  await writeFile(path.join(source, 'package-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(readCheckedPackage(source), /registered frozen/);
});

test('four archived real camera failures are represented without changing input/raw bytes or claiming stable success', async () => {
  const paths = ['01', '02', '03', '04'].map(number => new URL(`../docs/production/experiments/CAMERA-${number}/run.json`, import.meta.url));
  const bytes = await Promise.all(paths.map(source => readFile(source))); const runs = bytes.map(value => JSON.parse(value.toString('utf8')) as ProductionRun);
  assert.equal(runs.length, 4); assert.ok(runs.every(run => run.evidenceKind === 'real-model' && run.status === 'failed'));
  const accounting = materialAccounting([], [], runs).measuredScope; assert.equal(accounting.realGeneration.started, 4); assert.equal(accounting.realGeneration.terminalDenominator, 4); assert.equal(accounting.realGeneration.fullRequirementDelivered, 0); assert.equal(accounting.realGeneration.fullRequirementDeliveryRate, 0); assert.equal(accounting.realGeneration.autonomyCertified, false); assert.match(accounting.realGeneration.scope, /Different-configuration tuning ledger/);
  const records = realGenerationMaterialRecords(runs); const rows = realGenerationMaterialRows(runs); assert.equal(rows.length, 4);
  for (const [index, record] of records.entries()) { assert.equal(record.runId, runs[index].id); assert.deepEqual(record.input, runs[index].input); assert.deepEqual(record.usage, runs[index].usage); assert.equal(record.gateState, 'not-reached'); assert.equal(record.fullRequirementVerified, false); assert.equal(record.harnessInvocations, runs[index].calls.filter(call => call.executionSource === 'harness').length); assert.equal(record.jevRequestIntents, runs[index].jevCalls?.length ?? 0); assert.ok(rows[index].includes(runs[index].input.brief)); }
  for (const [index, source] of paths.entries()) assert.deepEqual(await readFile(source), bytes[index], 'source evidence remains byte-identical');
});

test('camera synthetic passes stay in the real terminal denominator but never prove full delivery; unknown POST counts are not logical call lengths', () => {
  const input = productionRunInputSchema.parse({ ...fixture('camera').input, mode: 'live', capability: 'camera-scene-v1' });
  const camera = { ...fixture('camera'), input, evidenceKind: 'real-model' as const, cameraVerification: { scope: 'scene-behavior-synthetic' as const, boundedScenePassed: true, visionModelVerified: false as const, physicalCameraVerified: false as const, fullRequirementVerified: false as const, runtimeVersion: 'unit', runtimeHash: 'unit', limitations: [] }, calls: [{ id: 'call-one', role: 'developer' as const, phase: 'implement', executionSource: 'harness' as const, usage: { inputTokens: null, outputTokens: null, estimatedCost: null, currency: 'USD' } }] as ProductionRun['calls'] };
  const scope = materialAccounting([], [], [camera]).measuredScope; assert.equal(scope.realGeneration.recordedGatePassed, 1); assert.equal(scope.realGeneration.boundedCameraScenePassed, 1); assert.equal(scope.realGeneration.terminalDenominator, 1); assert.equal(scope.realGeneration.fullRequirementDelivered, 0);
  const record = scope.realGeneration.records[0]; assert.equal(record.harnessInvocations, 1); assert.equal(record.providerRequests, null); assert.equal(record.unknownProviderCounts, 1); assert.equal(record.roleOnlyUsage.inputTokens, null); assert.equal(record.roleOnlyUsage.estimatedCost, null); assert.equal(formatMaterialCost(record.roleOnlyUsage.estimatedCost), 'unknown');
});

test('v5 copies exactly seven CAMERA09 originals, regenerates summaries once and never silently overwrites inherited evidence or video', () => {
  assert.deepEqual(CAMERA_MATERIAL_ARCHIVES, ['01', '02', '03', '04', '05', '06', '07', '08', '09']);
  const names = cameraMaterialFiles('09');
  assert.deepEqual(names, ['run.json', 'evidence.json', 'delivery-manifest.json', 'platform-metadata.json', 'scene.json', 'camera-runtime-manifest.json', 'index.html.txt']);
  for (const number of CAMERA_MATERIAL_ARCHIVES.slice(0, -1)) assert.equal(cameraMaterialFiles(number).length, 4);
  const oldRun = Buffer.from('{"original":"preserved"}'); const video = Buffer.from('original Mock MP4 bytes, source c21c588; not CAMERA09');
  const inherited = new Map([['CAMERA-04/run.json', oldRun], ['demo.mp4', video], ['real-camera-runs.json', Buffer.from('old summary')], ['materials-summary.json', Buffer.from('old accounting')], ['SUBMISSION-REPORT.md', Buffer.from('old presentation')]]);
  const paths = materialInheritancePaths([...inherited.keys()], ['SUBMISSION-REPORT.md']);
  assert.deepEqual(paths, ['CAMERA-04/run.json', 'demo.mp4']);
  const archived = [{ path: 'CAMERA-04/run.json', sourcePath: 'docs/production/experiments/CAMERA-04/run.json', bytes: Buffer.from(oldRun) }, ...names.map(name => ({ path: `CAMERA-09/${name}`, sourcePath: `docs/production/experiments/CAMERA-09/${name}`, bytes: Buffer.from(`new original ${name}`) }))];
  const append = cameraMaterialAppendPlan(inherited, archived);
  assert.deepEqual(append.map(item => item.path), names.map(name => `CAMERA-09/${name}`));
  assert.equal(new Set([...paths, ...append.map(item => item.path), 'real-camera-runs.json', 'materials-summary.json', 'SUBMISSION-REPORT.md']).size, paths.length + append.length + 3);
  assert.equal(inherited.get('CAMERA-04/run.json'), oldRun); assert.equal(inherited.get('demo.mp4'), video);
  assert.throws(() => cameraMaterialAppendPlan(inherited, [{ ...archived[0], bytes: Buffer.from('{"rewritten":true}') }]), /conflicts with the immutable archive/);
  assert.throws(() => cameraMaterialAppendPlan(inherited, [archived[0], archived[0]]), /Duplicate camera archive/);
  assert.throws(() => materialInheritancePaths(['real-camera-runs.json', 'real-camera-runs.json'], []), /Duplicate inherited/);
  assert.throws(() => cameraMaterialAppendPlan(null, [{ path: 'CAMERA-09/index.html', sourcePath: 'untrusted', bytes: Buffer.from('<script>not allowed</script>') }]), /allowlist/);
});

test('v5 nine-configuration camera ledger records its first bounded DSL delivery without recertifying hardware, full delivery or stability', async () => {
  const files = CAMERA_MATERIAL_ARCHIVES.map(number => new URL(`../docs/production/experiments/CAMERA-${number}/run.json`, import.meta.url));
  const bytes = await Promise.all(files.map(file => readFile(file))); const runs = bytes.map(value => JSON.parse(value.toString('utf8')) as ProductionRun);
  const before = JSON.stringify(runs); const scope = materialAccounting([], [], runs).measuredScope.realGeneration;
  assert.equal(scope.started, 9); assert.equal(scope.terminalDenominator, 9); assert.equal(scope.cameraTerminalDenominator, 9);
  assert.equal(scope.recordedGatePassed, 1); assert.equal(scope.boundedCameraScenePassed, 1);
  assert.equal(scope.fullRequirementDelivered, 0); assert.equal(scope.fullRequirementDeliveryRate, 0); assert.equal(scope.autonomyCertified, false); assert.equal(scope.stabilityExperiment, false);
  assert.equal(scope.cameraDeliveryScope, CAMERA_DELIVERY_SCOPE); assert.match(scope.scope, /not a fixed-configuration stability experiment/);
  assert.match(CAMERA_DELIVERY_SCOPE, /not arbitrary software source/); assert.match(CAMERA_DELIVERY_NOTICE, /DSL＋平台可信 runtime/); assert.match(CAMERA_DELIVERY_NOTICE, /完整需求仍未验收/);
  const camera09 = runs.at(-1)!;
  assert.deepEqual(scope.firstBoundedCameraScenePass, { runId: camera09.id, requirementId: 'CAMERA-09', platformCommit: '24256f96165f0be3156be037a2fea42492e31117' });
  const record = scope.records.at(-1)!;
  assert.equal(record.implementationKind, 'model-scene-dsl-with-trusted-runtime'); assert.equal(record.candidateCount, 1); assert.equal(record.gateCheckCount, 11);
  assert.equal(record.boundedScenePassed, true); assert.equal(record.visionModelVerified, false); assert.equal(record.physicalCameraVerified, false); assert.equal(record.fullRequirementVerified, false);
  assert.equal(record.providerRequests, 12); assert.equal(record.jevRequests, 6); assert.equal(record.usage.complete, true);
  assert.equal(record.usage.inputTokens, 143680); assert.equal(record.usage.outputTokens, 8715); assert.ok(Math.abs(record.usage.estimatedCost! - 0.037964112) < 1e-12);
  assert.equal(scope.records.find(item => item.requirementId === 'CAMERA-05')!.usage.estimatedCost, null, 'Unknown old totals are not changed to zero after a later bounded success');
  assert.equal(JSON.stringify(runs), before, 'No original run or configuration is rewritten by the new summary');
  for (const [index, file] of files.entries()) assert.deepEqual(await readFile(file), bytes[index]);
});
