import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import { fingerprint } from '../shared/evidence';
import { assertReviewPagesPreserved, completeReviewTap, ORIGINAL_RESPONSES_REPORT_SHA256, ORIGINAL_RESPONSES_RUN, parseReviewUpdateOptions,
  REVIEW_UPDATE_ARCHIVE, REVIEW_UPDATE_BRANCH, REVIEW_UPDATE_DIRECTORY, REVIEW_UPDATE_TAG, reviewUpdateStatusSchema, selectReviewUpdateBuildFiles,
  verifyReviewLiveSummary, verifyReviewOfflineProof, verifyReviewUpdateFiles } from '../shared/review-update-publication';

const bytes = (value: string) => new TextEncoder().encode(value);
function statusFixture() {
  return { schemaVersion: 'society-review-update-1.0', generatedAt: '2026-10-08T01:00:00.000Z', branch: REVIEW_UPDATE_BRANCH, sourceTag: REVIEW_UPDATE_TAG,
    demoUrl: 'https://litianyi-007.github.io/city-agent/#research', engineering: { proofId: 'system-abc123', unit: { passed: 2, total: 2 }, browser: { passed: 2, total: 2 },
      responses: { passed: 2, total: 2 }, sourceInventorySha256: 'a'.repeat(64), historicalFiles: 179, providerRequests: 0, apiCostCny: 0, proofMeaning: 'working-tree-byte-match-not-commit-attestation' },
    responsesCandidate: { protocolVersion: 'responses-text-stream-1.1', productionApiActivated: false, productionUiActivated: false },
    liveRuns: [{ experimentId: ORIGINAL_RESPONSES_RUN, status: 'stopped', providerAttempts: 1, providerRequests: 1, passed: 0, failed: 1, notStarted: 1,
      knownUsageRequestCount: 0, inputTokens: null, outputTokens: null, usageStatus: 'incomplete', conservativeKnownUsageCostCny: null, committedOrReservedCny: 0.06465,
      actualInvoiceCostCny: null, reportSha256: ORIGINAL_RESPONSES_REPORT_SHA256, failureCode: 'RESPONSES_SDK_NON_COMPLETION', ledgerFinalized: true }],
    marketResearchValidated: false, personaContributionValidated: false };
}
const payload = () => ({ 'index.html': '<html>审查补充入口</html>', 'README.md': '独立工程与真实试验分层记录。', 'status.json': JSON.stringify(statusFixture()) });
test('review publication accepts only fixed proof plus unique explicit execute, default is read-only', () => {
  const proof = '--proof=output/offline-review/system-abc123';
  assert.deepEqual(parseReviewUpdateOptions([proof]), { proof: proof.slice(8), execute: false });
  assert.equal(parseReviewUpdateOptions(['--execute', proof]).execute, true);
  for (const args of [[], ['--execute'], [proof, proof], [proof, '--execute', '--execute'], [proof, '--dry-run'], [proof, '--force'], [proof, '--url=other'],
    ['--proof=/tmp/system-abc123'], ['--proof=output/offline-review/system-abc123/../system-abc123'], ['--proof=output/offline-review/system-abc12!']]) assert.throws(() => parseReviewUpdateOptions(args));
});
test('public update projection is exactly three regular-text payloads and strictly typed status', () => {
  const input = payload(), before = structuredClone(input); const result = verifyReviewUpdateFiles(input);
  assert.equal(result.liveRuns[0].conservativeKnownUsageCostCny, null); assert.deepEqual(input, before);
  for (const name of ['approval.json', '../status.json', 'provider-original.txt', 'budget-ledger.json', 'private.db']) assert.throws(() => verifyReviewUpdateFiles({ ...payload(), [name]: '{}' }));
  const missing = payload(); delete (missing as Partial<typeof missing>)['README.md']; assert.throws(() => verifyReviewUpdateFiles(missing));
  assert.throws(() => verifyReviewUpdateFiles({ ...payload(), 'README.md': '' }));
  assert.throws(() => verifyReviewUpdateFiles({ ...payload(), 'README.md': 'a'.repeat(256_001) }));
});
test('public text gate refuses credentials, internal links, local paths and malformed encoded text', () => {
  for (const value of ['sk-private-canary-string-12345', '/Users/PrivateUser/Documents/evidence', 'https://docs.popo.netease.com/secret', String.raw`\u002fUsers\u002fPrivateUser\u002f`, '%2FUsers%2FPrivateUser%2F']) assert.throws(() => verifyReviewUpdateFiles({ ...payload(), 'README.md': value }), /非公开/);
  assert.throws(() => verifyReviewUpdateFiles({ ...payload(), 'status.json': JSON.stringify({ apiKey: 'private-fixture' }) }), /凭据/);
  assert.throws(() => verifyReviewUpdateFiles({ ...payload(), 'README.md': new Uint8Array([0xff]) }));
});
test('strict status cannot activate production, replace original failure or inflate engineering into market proof', () => {
  for (const mutate of [
    (value: ReturnType<typeof statusFixture>) => { value.responsesCandidate.productionApiActivated = true; },
    (value: ReturnType<typeof statusFixture>) => { value.responsesCandidate.productionUiActivated = true; },
    (value: ReturnType<typeof statusFixture>) => { value.marketResearchValidated = true; },
    (value: ReturnType<typeof statusFixture>) => { value.personaContributionValidated = true; },
    (value: ReturnType<typeof statusFixture>) => { value.liveRuns = []; },
    (value: ReturnType<typeof statusFixture>) => { value.liveRuns[0].reportSha256 = 'b'.repeat(64); },
    (value: ReturnType<typeof statusFixture>) => { value.liveRuns[0].status = 'passed'; },
    (value: ReturnType<typeof statusFixture>) => { value.liveRuns[0].committedOrReservedCny = 0; },
    (value: ReturnType<typeof statusFixture>) => { value.liveRuns.push(structuredClone(value.liveRuns[0])); },
  ]) { const value = statusFixture(); mutate(value); assert.throws(() => reviewUpdateStatusSchema.parse(value)); }
  assert.throws(() => reviewUpdateStatusSchema.parse({ ...statusFixture(), rawResponses: [] }));
});
test('unknown usage/invoice cannot be encoded as zero, while known partial usage retains incomplete coverage', () => {
  const old = statusFixture().liveRuns[0];
  for (const field of ['inputTokens', 'outputTokens', 'conservativeKnownUsageCostCny', 'actualInvoiceCostCny']) assert.throws(() => reviewUpdateStatusSchema.parse({ ...statusFixture(), liveRuns: [{ ...old, [field]: 0 }] }));
  const partial = { ...old, experimentId: '70000000-0000-4000-8000-000000000001', providerAttempts: 2, providerRequests: 2, passed: 1, failed: 1, notStarted: 0,
    knownUsageRequestCount: 1, inputTokens: 100, outputTokens: 20, conservativeKnownUsageCostCny: 0.001, committedOrReservedCny: 0.05, reportSha256: 'c'.repeat(64) };
  assert.equal(reviewUpdateStatusSchema.parse({ ...statusFixture(), liveRuns: [old, partial] }).liveRuns[1].usageStatus, 'incomplete');
  assert.throws(() => reviewUpdateStatusSchema.parse({ ...statusFixture(), liveRuns: [old, { ...partial, usageStatus: 'reported' }] }));
});

function offlineFixture() {
  const counts = { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const tap = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  const history = { version: 'historical-byte-integrity-1.0', scope: 'local-full', verifiedCount: 179, files: [{ name: 'synthetic-anchor', sha256: 'd'.repeat(64) }] };
  const sources = [{ name: 'shared/synthetic.ts', sha256: 'e'.repeat(64) }];
  const logs = { 'unit.stdout.log': bytes(tap), 'unit.stderr.log': bytes(''), 'browser.stdout.log': bytes('Running 2 tests using 1 worker\n  2 passed (1.0s)\n'), 'browser.stderr.log': bytes(''),
    'responses.stdout.log': bytes(JSON.stringify({ counts, providerRequests: 0, apiCostCny: 0, verifiedHistoricalFiles: 179 })), 'responses.stderr.log': bytes(''),
    'pages-build.stdout.log': bytes('vite build completed\n'), 'pages-build.stderr.log': bytes('') };
  const jobs = ['unit', 'browser', 'responses', 'pages-build'].map(name => ({ name, exitCode: 0, signal: null, timedOut: false, cancelled: false, logTruncated: false,
    startFailed: false, orphanedGroupDetected: false, stdoutBytes: logs[`${name}.stdout.log` as keyof typeof logs].length, stderrBytes: 0,
    stdoutSha256: sha256(logs[`${name}.stdout.log` as keyof typeof logs]), stderrSha256: sha256('') }));
  return { proofId: 'system-abc123', report: { version: 'offline-system-review-1.1', status: 'passed', cancelled: false, loadCheck: true, counts, jobs, providerRequests: 0, apiCostCny: 0,
      realProviderSchemaSupport: 'not-tested', productionRouteActivated: false, source: { files: sources, filesAfter: structuredClone(sources), sourceMatched: true, verificationState: 'matched', inventorySha256: fingerprint(sources), workingTreeSnapshotNotNewPublishedCommit: true },
      historicalIntegrity: { scope: 'local-full', verifiedCount: 179, beforeCount: 179, matched: true, verificationState: 'matched' } }, logs,
    history: { before: history, after: structuredClone(history), verificationState: 'matched' }, currentHistory: structuredClone(history), currentSources: structuredClone(sources),
    responses: { report: { version: 'offline-responses-review-1.0', counts, providerRequests: 0, apiCostCny: 0, productionRouteActivated: false, realProviderSchemaSupport: 'not-tested', syntheticUsageIsNotBilling: true, logicOrMarketQualityCertified: false,
        historicalIntegrity: { scope: 'local-full', verifiedCount: 179, beforeHash: fingerprint(history), afterHash: fingerprint(history), matched: true }, source: { files: structuredClone(sources), workingTreeSnapshotNotNewPublishedCommit: true } }, tap: bytes(tap), history: structuredClone(history) } };
}
test('offline proof requires four completed zero-provider jobs and byte-verified eight logs', () => {
  const value = offlineFixture(), before = structuredClone(value), result = verifyReviewOfflineProof(value);
  assert.deepEqual(result.unit, { passed: 2, total: 2 }); assert.equal(result.historicalFiles, 179); assert.deepEqual(value, before);
  const changed = offlineFixture(); changed.logs['unit.stdout.log'] = bytes('a forged complete-looking log'); assert.throws(() => verifyReviewOfflineProof(changed), /hash/);
  const duplicate = offlineFixture(); duplicate.report.jobs[1] = { ...duplicate.report.jobs[0] }; assert.throws(() => verifyReviewOfflineProof(duplicate), /unique/);
  for (const flag of ['timedOut', 'cancelled', 'logTruncated', 'startFailed', 'orphanedGroupDetected']) {
    const input = offlineFixture(); Object.assign(input.report.jobs[0], { [flag]: true }); assert.throws(() => verifyReviewOfflineProof(input));
  }
  for (const field of ['providerRequests', 'apiCostCny']) { const input = offlineFixture(); Object.assign(input.report, { [field]: 1 }); assert.throws(() => verifyReviewOfflineProof(input)); }
});
test('offline proof rejects runtime drift, failed or replaced historical evidence and stale child source', () => {
  const input = offlineFixture(); input.currentSources[0].sha256 = 'f'.repeat(64); assert.throws(() => verifyReviewOfflineProof(input), /source/);
  const history = offlineFixture(); history.currentHistory.files[0].sha256 = 'f'.repeat(64); assert.throws(() => verifyReviewOfflineProof(history), /Historical/);
  const child = offlineFixture(); child.responses.report.source.files[0].sha256 = 'f'.repeat(64); assert.throws(() => verifyReviewOfflineProof(child), /child source/);
  const childHistory = offlineFixture(); childHistory.responses.report.historicalIntegrity.afterHash = 'f'.repeat(64); assert.throws(() => verifyReviewOfflineProof(childHistory), /historical/);
  const scope = offlineFixture(); scope.report.historicalIntegrity.scope = 'repository'; assert.throws(() => verifyReviewOfflineProof(scope));
});
test('TAP counts and browser/Responses completion are extracted, not trusted from public status', () => {
  for (const suffix of ['', '# tests 2\n', '# skipped 1\n']) {
    const tap = suffix ? '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n' + suffix : '# tests 2\n# pass 2\n';
    assert.throws(() => completeReviewTap(tap));
  }
  for (const value of ['Running 2 tests using 1 worker\n  1 passed (1s)\n', 'Running 2 tests using 1 worker\n  2 passed (1s)\n  2 passed (1s)\n', 'Running 2 tests using 1 worker\n  2 passed (1s)\n  1 skipped\n']) {
    const input = offlineFixture(); input.logs['browser.stdout.log'] = bytes(value); input.report.jobs[1].stdoutBytes = bytes(value).length; input.report.jobs[1].stdoutSha256 = sha256(value); assert.throws(() => verifyReviewOfflineProof(input), /Browser/);
  }
  const child = offlineFixture(); child.responses.tap = bytes('# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'); assert.throws(() => verifyReviewOfflineProof(child), /Responses child TAP/);
});

function liveFixture() {
  const experimentId = '70000000-0000-4000-8000-000000000001';
  const ledger = { schemaVersion: 'experiment-budget-1.0', state: 'halted', storageStatus: 'durable', requestCount: 1, committedCny: 0.06465,
    knownUsageCostCny: 0, knownUsageRequestCount: 0, usageStatus: 'incomplete', budgetCny: 1, maxProviderRequests: 2,
    pricing: { provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY' } };
  const report = { version: 'responses-live-capability-report-1.0', experimentId, status: 'stopped', executionError: false, journalClosureAttempted: true,
    journalClosureSucceeded: true, ledgerFinalized: true, providerDispatches: 1, inputTokens: null, outputTokens: null, tokenCoverage: 'incomplete',
    conservativeKnownUsageCostCny: 0, committedOrReservedCny: 0.06465, marketResearchValidated: false, personaContributionValidated: false,
    result: { planned: 2, status: 'stopped', passed: 0, failed: 1, notStarted: 1, stopReason: 'RESPONSES_SDK_NON_COMPLETION', slots: [
      { id: 'child-snacks', status: 'failed', recorder: { attempts: 1, forwarded: 1 }, evidence: { transport: { requestAttempts: 1, forwardedRequests: 1, deniedRequests: 0 } } },
      { id: 'pet-snacks', status: 'not-started', recorder: null, evidence: null },
    ] }, ledger };
  const reportBytes = bytes(JSON.stringify(report));
  const summary = { ...statusFixture().liveRuns[0], experimentId, reportSha256: sha256(reportBytes) };
  return { summary, report, ledger, reportBytes };
}
test('independent live summary verifies its closed report, ledger and exact actual request evidence', () => {
  const value = liveFixture(), before = structuredClone(value);
  assert.equal(verifyReviewLiveSummary(value.summary, value.report, value.ledger, value.reportBytes).providerRequests, 1); assert.deepEqual(value, before);
  const changed = liveFixture(); changed.reportBytes = bytes('{}'); assert.throws(() => verifyReviewLiveSummary(changed.summary, changed.report, changed.ledger, changed.reportBytes), /hash/);
  for (const mutate of [
    (value: ReturnType<typeof liveFixture>) => { value.ledger.state = 'active'; },
    (value: ReturnType<typeof liveFixture>) => { value.report.ledgerFinalized = false; },
    (value: ReturnType<typeof liveFixture>) => { value.report.journalClosureSucceeded = false; },
    (value: ReturnType<typeof liveFixture>) => { value.report.result.slots[0].recorder!.attempts = 2; },
    (value: ReturnType<typeof liveFixture>) => { value.report.result.slots[0].evidence!.transport.deniedRequests = 1; },
  ]) { const input = liveFixture(); mutate(input); input.reportBytes = bytes(JSON.stringify(input.report)); input.summary.reportSha256 = sha256(input.reportBytes); assert.throws(() => verifyReviewLiveSummary(input.summary, input.report, input.ledger, input.reportBytes)); }
});
test('replay cannot promote stopped real trial or give unknown usage a zero invoice', () => {
  const input = liveFixture(); assert.throws(() => verifyReviewLiveSummary({ ...input.summary, status: 'passed', passed: 2, failed: 0, notStarted: 0 }, input.report, input.ledger, input.reportBytes));
  assert.throws(() => verifyReviewLiveSummary({ ...input.summary, actualInvoiceCostCny: 0 }, input.report, input.ledger, input.reportBytes));
  const rewritten = liveFixture(); rewritten.summary.experimentId = ORIGINAL_RESPONSES_RUN; assert.throws(() => verifyReviewLiveSummary(rewritten.summary, rewritten.report, rewritten.ledger, rewritten.reportBytes), /Frozen original/);
});
test('Pages build selection copies only entries and hashed JS/CSS, never old/private material payloads', () => {
  const files = ['index.html', 'review-guide.html', 'assets/index-Abcd1234.js', 'assets/index-Efgh5678.css', 'submission/demo.mp4', 'submission-next/manifest.json',
    'submission-contract11/report.json', `${REVIEW_UPDATE_DIRECTORY}/index.html`, `${REVIEW_UPDATE_DIRECTORY}/README.md`, `${REVIEW_UPDATE_DIRECTORY}/status.json`];
  assert.deepEqual(selectReviewUpdateBuildFiles(files), files.slice(0, 4).sort());
  for (const name of ['.env', 'assets/private.json', 'assets/unhashed.js', 'review-updates/other/secret.json', '../outside', 'assets/../../secret', 'private.sqlite']) assert.throws(() => selectReviewUpdateBuildFiles([...files, name]));
  assert.throws(() => selectReviewUpdateBuildFiles([...files, files[0]])); assert.throws(() => selectReviewUpdateBuildFiles(files.slice(1)));
});
test('every previous tracked Pages byte must remain, with exact pre-update entry archives', () => {
  const before = { 'index.html': 'a', 'review-guide.html': 'b', 'submission/live.json': 'c', 'assets/old-Abcd1234.js': 'd', 'other/legacy.txt': 'e' };
  const after = { ...before, 'index.html': 'new', 'review-guide.html': 'new-guide' }, archives = { [`${REVIEW_UPDATE_ARCHIVE}/index.html`]: 'a', [`${REVIEW_UPDATE_ARCHIVE}/review-guide.html`]: 'b' };
  assertReviewPagesPreserved(before, after, archives);
  for (const name of ['submission/live.json', 'assets/old-Abcd1234.js', 'other/legacy.txt']) assert.throws(() => assertReviewPagesPreserved(before, { ...after, [name]: 'changed' }, archives));
  assert.throws(() => assertReviewPagesPreserved(before, after, { ...archives, [`${REVIEW_UPDATE_ARCHIVE}/index.html`]: 'rewritten' }));
  assert.throws(() => assertReviewPagesPreserved(before, after, {}));
});
