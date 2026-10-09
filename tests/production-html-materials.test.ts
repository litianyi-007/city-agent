import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { ProductionRun } from '../shared/production-schema.js';
import { buildSelectedHtmlMaterials, HTML_MATERIALS_FILENAME, HTML_MATERIALS_VERSION, readSelectedHtmlMaterials, SELECTED_HTML_MATERIAL_ARCHIVES, SELECTED_HTML_MATERIAL_FILES, verifySelectedHtmlMaterials } from '../scripts/production-html-materials.js';

const publisher = 'a'.repeat(40), root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const snapshots = Promise.all(SELECTED_HTML_MATERIAL_ARCHIVES.flatMap(id => SELECTED_HTML_MATERIAL_FILES.map(async name => [`${id}/${name}`, await readFile(new URL(`../docs/production/experiments/${id}/${name}`, import.meta.url))] as const))).then(entries => new Map<string, Buffer>(entries));
const run = (files: ReadonlyMap<string, Buffer>, id = 'HTML-08') => JSON.parse(files.get(`${id}/run.json`)!.toString('utf8')) as ProductionRun;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2));
function changeRun(originals: ReadonlyMap<string, Buffer>, id: string, mutate: (value: ProductionRun) => void) {
  const files = new Map(originals), value = run(files, id); mutate(value);
  files.set(`${id}/run.json`, encoded(value)); files.set(`${id}/evidence.json`, encoded(value));
  const manifest = JSON.parse(files.get(`${id}/delivery-manifest.json`)!.toString());
  Object.assign(manifest, { runId: value.id, platformCommit: value.platformCommit, status: value.status, evidenceKind: value.evidenceKind, capability: value.input.capability, requirement: value.input.requirement, usage: value.usage, durationMs: value.durationMs, repairs: value.repairs, models: value.agentSnapshot, failure: value.error ?? null });
  files.set(`${id}/delivery-manifest.json`, encoded(manifest));
  const metadata = JSON.parse(files.get(`${id}/platform-metadata.json`)!.toString()); metadata.platformCommit = value.platformCommit; metadata.build.platformCommit = value.platformCommit;
  files.set(`${id}/platform-metadata.json`, encoded(metadata)); return files;
}

test('exact eight public tuning archives preserve raw bytes, independent hashes and original provenance without claiming stability', async () => {
  const files = await snapshots, before = [...files].map(([path, bytes]) => [path, hash(bytes)]);
  const value = buildSelectedHtmlMaterials(publisher, files);
  assert.equal(value.version, HTML_MATERIALS_VERSION); assert.equal(value.filename, HTML_MATERIALS_FILENAME);
  assert.deepEqual(value.selection, SELECTED_HTML_MATERIAL_ARCHIVES); assert.equal(value.entries.length, 8);
  assert.equal(value.stabilityExperiment, false); assert.equal(value.autonomyCertified, false); assert.equal(value.generatedCodeExecutedInVisitorBrowser, false);
  assert.match(value.scope, /not all historical production/); assert.match(value.scope, /not embedded originals or authenticity signatures/);
  for (const entry of value.entries) {
    assert.deepEqual(Buffer.from(entry.originalRunUtf8), files.get(`${entry.requirementId}/run.json`));
    const original = run(files, entry.requirementId); assert.equal(entry.summary.platformCommit, original.platformCommit); assert.notEqual(entry.summary.platformCommit, publisher);
    assert.deepEqual(entry.summary.usage, original.usage); assert.equal(entry.summary.status, original.status);
    assert.match(entry.summary.candidateBoundary, /N=1.*not multi-candidate/); assert.equal(entry.summary.recordedBehaviorGateDelivery, false);
    for (const artifact of entry.originalArtifacts) {
      assert.equal(artifact.sha256, hash(files.get(artifact.path)!)); assert.equal(artifact.bytes, files.get(artifact.path)!.length);
      assert.equal(artifact.href, `https://github.com/litianyi-007/city-agent/blob/${publisher}/${artifact.sourcePath}`);
    }
    assert.equal(entry.resultHref, `https://github.com/litianyi-007/city-agent/blob/${publisher}/docs/production/experiments/${entry.requirementId}/RESULT.md`);
  }
  assert.deepEqual([...files].map(([path, bytes]) => [path, hash(bytes)]), before);
});

test('HTML08 actual failed PM loop remains distinct from source v4 engineering checks and candidate accepts', async () => {
  const value = buildSelectedHtmlMaterials(publisher, await snapshots).entries.at(-1)!;
  assert.equal(value.summary.runId, '966fc3b9-1308-4e19-832f-ea4960fb07f2'); assert.equal(value.summary.platformCommit, 'f21256f8fe280b619c295ec17842fdc941b36545');
  assert.equal(value.summary.status, 'failed'); assert.equal(value.summary.providerRequests, 18); assert.equal(value.summary.logicalCalls, 18);
  assert.deepEqual(value.summary.usage, { inputTokens: 166317, outputTokens: 13317, estimatedCost: 0.0658755, currency: 'USD', complete: true });
  assert.deepEqual(value.summary.promptVersions, ['production-html-grouped-v4']); assert.equal(value.summary.repairs, 2);
  assert.equal(value.summary.frozenContractReached, false); assert.equal(value.summary.gateState, 'not-reached'); assert.equal(value.summary.gateCheckCount, null);
  assert.equal(value.summary.recordedBehaviorGateDelivery, false); assert.match(value.summary.error!, /研发前规划revise/);
  assert.equal(value.summary.models.length, 6); assert.ok(value.summary.models.every(model => model.modelId === 'deepseek-flash'));
  assert.equal(JSON.stringify(value.summary).includes('hasApiKey'), false); assert.match(value.summary.costBoundary, /not a provider invoice/);
});

test('zero-dispatch failure and missing historical usage are retained without inventing zero spending or successful Gate', async () => {
  const entries = buildSelectedHtmlMaterials(publisher, await snapshots).entries;
  assert.equal(entries[5].summary.status, 'failed'); assert.equal(entries[5].summary.logicalCalls, 0); assert.equal(entries[5].summary.providerRequests, 0);
  assert.deepEqual(entries[5].summary.promptVersions, []); assert.equal(entries[5].summary.gateState, 'not-reached');
  assert.equal(entries[0].summary.usage.estimatedCost, null); assert.equal(entries[0].summary.usage.inputTokens, null);
  assert.equal(entries[0].summary.usage.complete, false); assert.equal(entries[0].summary.gateState, 'failed'); assert.equal(entries[0].summary.frozenContractReached, true);
  assert.equal(entries[0].summary.providerRequests, 19); assert.equal(entries[0].summary.unknownProviderCounts, 0, 'HTTP observations and unknown usage are independent');
});

// Fully synthetic consistency fixture, not a new delivered product or model execution.
function completedFixture(files: ReadonlyMap<string, Buffer>) {
  const html = '<!doctype html><html><body><ul id="items"></ul></body></html>';
  const changed = changeRun(files, 'HTML-08', value => {
    value.status = 'completed'; delete value.error; delete value.input.acceptanceStrategy;
    const checks = [{ name: 'Synthetic empty-list behavior', steps: [{ action: 'assertCount', selector: '#items', count: 0 }] }];
    value.frozenContract = { version: 'synthetic-consistency-only', frozenAt: value.createdAt, requirementHash: hash(JSON.stringify({ requirement: value.input.requirement, brief: value.input.brief })), validationContractHash: hash(JSON.stringify(value.validationContract)), hash: hash(JSON.stringify({ validationContract: value.validationContract, requirement: value.input.requirement, brief: value.input.brief, checks })), checks };
    value.gate = { passed: true, checks: [{ name: 'Synthetic empty-list behavior', passed: true }] }; value.gateHistory = [structuredClone(value.gate)];
    value.artifacts.push({ name: 'index.html', type: 'text/html' });
    const call = structuredClone(value.calls[0]); call.id = 'synthetic-developer-call'; call.role = 'developer'; call.phase = 'implement'; call.candidateId = 'synthetic-selected-candidate'; call.selected = true; call.rawOutput = JSON.stringify({ html }); call.usage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD' }; call.providerRequests!.requests = 0;
    value.calls.push(call); value.outputs.push({ role: 'developer', phase: 'implement', selectedCandidateId: call.candidateId, value: { html } });
  });
  const manifest = JSON.parse(changed.get('HTML-08/delivery-manifest.json')!.toString());
  manifest.frozenContract = run(changed).frozenContract; manifest.source = 'index.html'; manifest.sourceSha256 = hash(html);
  changed.set('HTML-08/delivery-manifest.json', encoded(manifest)); return changed;
}

test('completed labels cannot manufacture a delivery without real nonempty frozen checks, Gate history and source/manifest bloodline', async () => {
  const files = await snapshots;
  const counterexample = changeRun(files, 'HTML-08', value => { value.status = 'completed'; delete value.error; value.frozenContract = { hash: 'a'.repeat(64), checks: [] } as unknown as NonNullable<ProductionRun['frozenContract']>; value.gate = { passed: true, checks: [] }; });
  assert.throws(() => buildSelectedHtmlMaterials(publisher, counterexample), /nonempty frozen checks/);
  const complete = completedFixture(files), index = buildSelectedHtmlMaterials(publisher, complete);
  assert.equal(index.entries[7].summary.recordedBehaviorGateDelivery, true); assert.equal(index.autonomyCertified, false);
  assert.ok(index.entries[7].completedDeliveryManifestUtf8); assert.deepEqual(verifySelectedHtmlMaterials(encoded(index), publisher, [], complete).index, index);
  for (const mutate of [
    (value: ProductionRun) => { value.gateHistory = []; }, (value: ProductionRun) => { value.gateHistory[0].passed = false; },
    (value: ProductionRun) => { value.gate!.checks[0].passed = false; }, (value: ProductionRun) => { value.frozenContract!.checks = []; },
    (value: ProductionRun) => { value.frozenContract!.requirementHash = '0'.repeat(64); }, (value: ProductionRun) => { value.frozenContract!.hash = '0'.repeat(64); },
    (value: ProductionRun) => { value.artifacts = value.artifacts.filter(artifact => artifact.name !== 'index.html'); },
    (value: ProductionRun) => { value.outputs = value.outputs.filter(output => output.role !== 'developer'); },
    (value: ProductionRun) => { value.calls.at(-1)!.selected = false; }, (value: ProductionRun) => { value.calls.at(-1)!.rawOutput = '{"html":"different"}'; },
  ]) assert.throws(() => buildSelectedHtmlMaterials(publisher, changeRun(complete, 'HTML-08', mutate)));
  for (const mutation of [{ source: null }, { source: 'anything.html' }, { sourceSha256: '0'.repeat(64) }, { frozenContract: null }]) {
    const corrupted = new Map(complete), manifest = JSON.parse(corrupted.get('HTML-08/delivery-manifest.json')!.toString()); Object.assign(manifest, mutation); corrupted.set('HTML-08/delivery-manifest.json', encoded(manifest));
    assert.throws(() => buildSelectedHtmlMaterials(publisher, corrupted), /completed manifest/);
  }
  const missingManifest = structuredClone(index); delete missingManifest.entries[7].completedDeliveryManifestUtf8; assert.throws(() => verifySelectedHtmlMaterials(encoded(missingManifest), publisher), /completed manifest/);
  const corruptManifest = structuredClone(index); corruptManifest.entries[7].completedDeliveryManifestUtf8 += '\n'; assert.throws(() => verifySelectedHtmlMaterials(encoded(corruptManifest), publisher), /manifest original bytes/);
  for (const change of [{ status: 'failed' }, { runId: 'wrong' }, { platformCommit: 'b'.repeat(40) }, { usage: { estimatedCost: 0 } }]) {
    const corrupted = structuredClone(index), manifest = JSON.parse(corrupted.entries[7].completedDeliveryManifestUtf8!); Object.assign(manifest, change);
    const manifestBytes = encoded(manifest); corrupted.entries[7].completedDeliveryManifestUtf8 = manifestBytes.toString(); corrupted.entries[7].originalArtifacts[2].bytes = manifestBytes.length; corrupted.entries[7].originalArtifacts[2].sha256 = hash(manifestBytes);
    assert.throws(() => verifySelectedHtmlMaterials(encoded(corrupted), publisher), /manifest .*conflicts/);
  }
});

test('aggregate unknown cannot be rewritten as zero and same-currency known totals must match original role/Jev entries', async () => {
  const files = await snapshots;
  const counterexample = changeRun(files, 'HTML-08', value => { value.calls.forEach(call => { call.usage.inputTokens = null; call.usage.outputTokens = null; call.usage.estimatedCost = null; }); value.usage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0, currency: 'USD', complete: false }; });
  assert.throws(() => buildSelectedHtmlMaterials(publisher, counterexample), /unknown is not zero/);
  const partial = changeRun(files, 'HTML-08', value => { value.calls[0].usage.estimatedCost = null; value.usage.estimatedCost = null; });
  const entry = buildSelectedHtmlMaterials(publisher, partial).entries[7]; assert.equal(entry.summary.usage.estimatedCost, null); assert.equal(entry.summary.usageLedger.estimatedCost.unknownEntries, 1); assert.ok(entry.summary.usageLedger.estimatedCost.knownSubtotal! > 0);
  for (const field of ['inputTokens', 'outputTokens', 'estimatedCost'] as const) assert.throws(() => buildSelectedHtmlMaterials(publisher, changeRun(files, 'HTML-08', value => { value.usage[field] = 0; })), /aggregate/);
  const crossCurrency = changeRun(files, 'HTML-08', value => { value.calls[0].usage.currency = 'CNY'; }); assert.throws(() => buildSelectedHtmlMaterials(publisher, crossCurrency), /aggregate estimatedCost/);
});

test('portable index checks every derived field, exact run hash, publisher and pinned links; source option verifies all four originals', async () => {
  const files = await snapshots, value = buildSelectedHtmlMaterials(publisher, files), bytes = encoded(value);
  assert.deepEqual(verifySelectedHtmlMaterials(bytes, publisher).index, value); assert.deepEqual(verifySelectedHtmlMaterials(bytes, publisher, [], files).index, value);
  const changes: Array<(candidate: typeof value) => void> = [
    v => { v.entries[7].summary.status = 'completed'; }, v => { v.entries[7].summary.providerRequests = 0; },
    v => { v.entries[7].summary.usage.estimatedCost = 0; }, v => { v.entries[7].summary.gateState = 'passed'; },
    v => { v.entries[7].summary.models[0].modelId = 'fabricated-model'; }, v => { v.publisherCommit = 'b'.repeat(40); },
    v => { v.entries[7].originalArtifacts[0].sha256 = '0'.repeat(64); }, v => { v.entries[7].originalArtifacts[0].bytes++; },
    v => { v.entries[7].originalArtifacts[1].href = 'https://example.invalid/raw'; }, v => { v.entries[7].resultHref = 'https://github.com/litianyi-007/city-agent/blob/main/result'; },
    v => { v.entries[7].originalArtifacts.reverse(); }, v => { v.entries.reverse(); }, v => { v.selection = ['HTML-08']; },
    v => { (v as { stabilityExperiment: boolean }).stabilityExperiment = true; },
  ];
  for (const change of changes) { const changed = structuredClone(value); change(changed); assert.throws(() => verifySelectedHtmlMaterials(encoded(changed), publisher)); }
  const changedHash = structuredClone(value); changedHash.entries[7].originalArtifacts[1].sha256 = '0'.repeat(64);
  assert.throws(() => verifySelectedHtmlMaterials(encoded(changedHash), publisher, [], files), /archived originals/);
  assert.throws(() => verifySelectedHtmlMaterials(bytes, 'main')); assert.throws(() => verifySelectedHtmlMaterials(bytes, 'b'.repeat(40)));
});

test('missing, extra, malformed JSON and invalid UTF8 archives are rejected before rendering', async () => {
  const files = await snapshots;
  for (const path of files.keys()) { const missing = new Map(files); missing.delete(path); assert.throws(() => buildSelectedHtmlMaterials(publisher, missing), /all 32/); }
  const extra = new Map(files); extra.set('HTML-09/run.json', Buffer.from('{}')); assert.throws(() => buildSelectedHtmlMaterials(publisher, extra), /all 32/);
  for (const invalid of [Buffer.from('{broken'), Buffer.from('[]'), Buffer.from([0xff]), Buffer.alloc(0), Buffer.alloc(4_000_001)]) {
    const changed = new Map(files); changed.set('HTML-08/run.json', invalid); assert.throws(() => buildSelectedHtmlMaterials(publisher, changed));
  }
  for (const revision of ['main', publisher.slice(0, 7), publisher.toUpperCase(), '../outside']) assert.throws(() => buildSelectedHtmlMaterials(revision, files), /immutable/);
});

test('non-real, non-terminal, bad source, mismatched directory and invented completion fail closed', async () => {
  const files = await snapshots;
  const mutations: Array<(run: ProductionRun) => void> = [
    r => { r.evidenceKind = 'fixture'; }, r => { r.status = 'running'; }, r => { r.status = 'queued'; },
    r => { r.platformCommit = 'main'; }, r => { r.id = 'not-a-uuid'; }, r => { r.input.capability = 'camera-scene-v1'; },
    r => { r.input.mode = 'demo'; }, r => { r.input.requirement.id = 'HTML-09'; }, r => { r.input.requirement.id = 'HTML-07'; },
    r => { r.status = 'completed'; }, r => { r.calls[0].executionSource = 'injected'; }, r => { r.agentSnapshot[0].baseUrl = 'https://secret@api.example.org'; },
    r => { r.usage.inputTokens = -1; }, r => { r.calls[0].providerRequests!.requests = -1; }, r => { r.repairs = -1; },
  ];
  for (const mutate of mutations) assert.throws(() => buildSelectedHtmlMaterials(publisher, changeRun(files, 'HTML-08', mutate)));
});

test('each evidence/manifest/metadata is checked independently without normalizing their original byte representations', async () => {
  const files = await snapshots;
  const mismatch: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['evidence.json', value => { value.status = 'completed'; }], ['delivery-manifest.json', value => { value.runId = 'wrong'; }],
    ['delivery-manifest.json', value => { value.platformCommit = 'b'.repeat(40); }], ['delivery-manifest.json', value => { value.usage = { estimatedCost: 0 }; }],
    ['platform-metadata.json', value => { value.platformCommit = 'b'.repeat(40); }], ['platform-metadata.json', value => { value.frozenBaseline = 'b'.repeat(40); }],
    ['platform-metadata.json', value => { (value.build as Record<string, unknown>).sourceClean = false; }],
  ];
  for (const [name, mutate] of mismatch) { const changed = new Map(files), value = JSON.parse(changed.get('HTML-08/' + name)!.toString()); mutate(value); changed.set('HTML-08/' + name, encoded(value)); assert.throws(() => buildSelectedHtmlMaterials(publisher, changed), /conflicts/); }
  const reformatted = new Map(files), original = files.get('HTML-08/evidence.json')!;
  reformatted.set('HTML-08/evidence.json', Buffer.from(original.toString() + '\n\n'));
  const entry = buildSelectedHtmlMaterials(publisher, reformatted).entries.at(-1)!;
  assert.notEqual(entry.originalArtifacts[1].sha256, hash(original)); assert.equal(entry.originalArtifacts[1].sha256, hash(reformatted.get('HTML-08/evidence.json')!));
});

test('duplicate selected run IDs reject conflicting original bytes; mixed duplicates must agree semantically', async () => {
  const files = await snapshots, first = run(files, 'HTML-01');
  const duplicate = changeRun(files, 'HTML-08', value => { value.id = first.id; });
  assert.throws(() => buildSelectedHtmlMaterials(publisher, duplicate), /duplicate selected run id has conflicting original bytes/);
  const existing = run(files); assert.doesNotThrow(() => buildSelectedHtmlMaterials(publisher, files, [existing, structuredClone(existing)]));
  const conflict = structuredClone(existing); conflict.repairs = 0;
  assert.throws(() => buildSelectedHtmlMaterials(publisher, files, [existing, conflict]), /existing mixed run/);
  const value = buildSelectedHtmlMaterials(publisher, files); assert.throws(() => verifySelectedHtmlMaterials(encoded(value), publisher, [conflict]), /existing mixed run/);
});

test('missing per-call HTTP observation stays unknown with known subtotal, never logical-count evidence', async () => {
  const files = changeRun(await snapshots, 'HTML-08', value => { delete value.calls[0].providerRequests; });
  const value = buildSelectedHtmlMaterials(publisher, files).entries.at(-1)!.summary;
  assert.equal(value.logicalCalls, 18); assert.equal(value.providerRequests, null); assert.equal(value.knownProviderRequests, 17); assert.equal(value.unknownProviderCounts, 1);
  assert.equal(value.usage.estimatedCost, 0.0658755);
});

test('secret fields and original artifact bytes cannot bypass publication checks through the raw UTF8 wrapper', async () => {
  const files = await snapshots, changed = new Map(files);
  const value = JSON.parse(changed.get('HTML-08/run.json')!.toString()); value.apiKey = 'not-publishable'; changed.set('HTML-08/run.json', encoded(value));
  assert.throws(() => buildSelectedHtmlMaterials(publisher, changed), /credential/);
  const materials = buildSelectedHtmlMaterials(publisher, files); materials.entries[7].originalRunUtf8 += 'apikey_' + 'x'.repeat(40);
  assert.throws(() => verifySelectedHtmlMaterials(encoded(materials), publisher), /Secret-like/);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(16_000_001), Buffer.from('{broken'), Buffer.from([0xff])]) assert.throws(() => verifySelectedHtmlMaterials(bytes, publisher));
});

test('read helper reads only the registered public snapshots and round-trips a portable index without model/store access', async () => {
  const result = await readSelectedHtmlMaterials(root, publisher);
  assert.equal(result.files.size, 32); assert.equal(result.runs.length, 8);
  assert.deepEqual(result.index, verifySelectedHtmlMaterials(result.bytes, publisher, [], result.files).index);
  assert.deepEqual(result.runs, verifySelectedHtmlMaterials(result.bytes, publisher).runs);
  assert.deepEqual([...result.files.keys()], SELECTED_HTML_MATERIAL_ARCHIVES.flatMap(id => SELECTED_HTML_MATERIAL_FILES.map(name => `${id}/${name}`)));
  assert.ok(result.bytes.length < 16_000_000);
});

test('portable index between 4MB and 16MB is distinct from the single-original 4MB limit', async () => {
  const files = changeRun(await snapshots, 'HTML-08', value => { (value as unknown as Record<string, unknown>).syntheticPaddingForLimitTest = 'z'.repeat(1_200_000); });
  const value = buildSelectedHtmlMaterials(publisher, files), bytes = encoded(value);
  assert.ok(bytes.length > 4_000_000 && bytes.length < 16_000_000); assert.ok(files.get('HTML-08/run.json')!.length < 4_000_000);
  assert.deepEqual(verifySelectedHtmlMaterials(bytes, publisher, [], files).index, value);
});
