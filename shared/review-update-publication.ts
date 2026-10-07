import { sha256 } from 'js-sha256';
import { z } from 'zod';
import { fingerprint } from './evidence';
import { assertPublicText } from './publishing-contract';

export const REVIEW_UPDATE_REPOSITORY = 'litianyi-007/city-agent';
export const REVIEW_UPDATE_BRANCH = 'feature/virtual-society-next';
export const REVIEW_UPDATE_TAG = 'society-responses-review-2026-10-08-rc3';
export const REVIEW_UPDATE_DIRECTORY = 'review-updates/2026-10-08';
export const REVIEW_UPDATE_ARCHIVE = `milestones/before-${REVIEW_UPDATE_TAG}`;
export const REVIEW_UPDATE_FILES = ['index.html', 'README.md', 'status.json'] as const;
export const ORIGINAL_RESPONSES_RUN = 'f3ae4289-85a8-4b34-b8ea-8d0e5a264469';
export const ORIGINAL_RESPONSES_REPORT_SHA256 = '3e298567c2429bd5002475192e8ac852ccf041733eb1146b46f3397dc43903ed';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
const cost = z.number().nonnegative().finite();
const completeCount = z.object({ passed: count, total: count }).strict().refine(value => value.total > 0 && value.passed === value.total);
const liveSummary = z.object({
  experimentId: z.string().uuid(), status: z.enum(['stopped', 'passed']), providerAttempts: count.max(2), providerRequests: count.max(2),
  passed: count.max(2), failed: count.max(2), notStarted: count.max(2), knownUsageRequestCount: count.max(2), inputTokens: count.nullable(), outputTokens: count.nullable(),
  usageStatus: z.enum(['reported', 'incomplete']), conservativeKnownUsageCostCny: cost.nullable(), committedOrReservedCny: cost.max(1),
  actualInvoiceCostCny: z.null(), reportSha256: digest, failureCode: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).nullable(), ledgerFinalized: z.literal(true),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.passed + value.failed + value.notStarted !== 2 || value.providerAttempts !== value.providerRequests
    || value.providerRequests !== value.passed + value.failed) fail('Two immutable slots and exact attempts/forwarded counts are required.');
  if (value.status === 'passed' && (value.passed !== 2 || value.failed !== 0 || value.notStarted !== 0 || value.failureCode !== null || value.usageStatus !== 'reported')) fail('Failed or unstarted slots cannot be presented as passed.');
  if (value.status === 'stopped' && (value.failed < 1 || value.failureCode === null)) fail('Stopped trial requires its failure.');
  if (value.knownUsageRequestCount === 0 && (value.inputTokens !== null || value.outputTokens !== null || value.conservativeKnownUsageCostCny !== null)) fail('No validated usage is unknown, never zero or a forensic billing estimate.');
  if (value.knownUsageRequestCount > 0 && (value.inputTokens === null || value.outputTokens === null || value.conservativeKnownUsageCostCny === null)) fail('Known partial/full usage requires token counts and estimate.');
  if (value.knownUsageRequestCount > value.providerRequests || value.usageStatus === 'reported' && value.knownUsageRequestCount !== value.providerRequests
    || value.usageStatus === 'incomplete' && value.knownUsageRequestCount >= value.providerRequests) fail('Usage coverage must match the known request count.');
});
export const reviewUpdateStatusSchema = z.object({
  schemaVersion: z.literal('society-review-update-1.0'), generatedAt: z.string().datetime(), branch: z.literal(REVIEW_UPDATE_BRANCH),
  sourceTag: z.literal(REVIEW_UPDATE_TAG), demoUrl: z.literal('https://litianyi-007.github.io/city-agent/#research'),
  engineering: z.object({
    proofId: z.string().regex(/^system-[A-Za-z0-9]{6}$/), unit: completeCount, browser: completeCount, responses: completeCount,
    sourceInventorySha256: digest, historicalFiles: z.literal(179), providerRequests: z.literal(0), apiCostCny: z.literal(0),
    proofMeaning: z.literal('working-tree-byte-match-not-commit-attestation'),
  }).strict(),
  responsesCandidate: z.object({ protocolVersion: z.literal('responses-text-stream-1.1'), productionApiActivated: z.literal(false), productionUiActivated: z.literal(false) }).strict(),
  liveRuns: z.array(liveSummary).min(1).max(8),
  marketResearchValidated: z.literal(false), personaContributionValidated: z.literal(false),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(value.liveRuns.map(run => run.experimentId)).size !== value.liveRuns.length) fail('Independent trial IDs cannot be pooled or duplicated.');
  const old = value.liveRuns.find(run => run.experimentId === ORIGINAL_RESPONSES_RUN);
  if (!old || old.status !== 'stopped' || old.providerRequests !== 1 || old.providerAttempts !== 1 || old.passed !== 0 || old.failed !== 1
    || old.notStarted !== 1 || old.usageStatus !== 'incomplete' || old.knownUsageRequestCount !== 0 || old.committedOrReservedCny !== 0.06465
    || old.reportSha256 !== ORIGINAL_RESPONSES_REPORT_SHA256 || old.failureCode !== 'RESPONSES_SDK_NON_COMPLETION') fail('Original failed trial must be preserved without posthoc promotion.');
});
export type ReviewUpdateStatus = z.infer<typeof reviewUpdateStatusSchema>;
export type ReviewLiveSummary = z.infer<typeof liveSummary>;
const toBytes = (value: string | Uint8Array) => typeof value === 'string' ? new TextEncoder().encode(value) : value;
const text = (value: string | Uint8Array) => typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
const same = (left: unknown, right: unknown) => fingerprint(left) === fingerprint(right);

export function parseReviewUpdateOptions(args: string[]): { proof: string; execute: boolean } {
  const paths = args.filter(arg => /^--proof=output\/offline-review\/system-[A-Za-z0-9]{6}$/.test(arg));
  if (paths.length !== 1 || args.length !== new Set(args).size || args.some(arg => arg !== '--execute' && !paths.includes(arg))) throw new Error('One fixed offline --proof is required; only optional --execute is accepted.');
  return { proof: paths[0].slice('--proof='.length), execute: args.includes('--execute') };
}

/** Pure, exact three-file public projection. No raw response, approval or ledger is accepted. */
export function verifyReviewUpdateFiles(files: Record<string, string | Uint8Array>): ReviewUpdateStatus {
  if (Object.keys(files).length !== REVIEW_UPDATE_FILES.length || Object.keys(files).some(name => !REVIEW_UPDATE_FILES.includes(name as typeof REVIEW_UPDATE_FILES[number]))) throw new Error('Review update must contain exactly its three registered files.');
  for (const name of REVIEW_UPDATE_FILES) {
    if (!Object.hasOwn(files, name) || toBytes(files[name]).length === 0 || toBytes(files[name]).length > 256_000) throw new Error('Missing or oversized public review file.');
    assertPublicText(name, text(files[name]));
  }
  return reviewUpdateStatusSchema.parse(JSON.parse(text(files['status.json'])));
}

const tapKeys = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'] as const;
export function completeReviewTap(stdout: string): Record<typeof tapKeys[number], number> {
  const values: Record<string, number> = {};
  for (const match of stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)) {
    if (Object.hasOwn(values, match[1])) throw new Error('Duplicate TAP completion summary.');
    values[match[1]] = Number(match[2]);
  }
  if (!tapKeys.every(key => Number.isSafeInteger(values[key]) && values[key] >= 0) || values.tests < 1 || values.pass !== values.tests
    || ['fail', 'cancelled', 'skipped', 'todo'].some(key => values[key] !== 0)) throw new Error('Incomplete or failed TAP result.');
  return values as Record<typeof tapKeys[number], number>;
}

const sourceEntry = z.object({ name: z.string().min(1), sha256: digest }).strict();
const sourceFiles = z.array(sourceEntry).min(1).refine(value => new Set(value.map(file => file.name)).size === value.length);
const countsSchema = z.object({ tests: count.positive(), pass: count.positive(), fail: z.literal(0), cancelled: z.literal(0), skipped: z.literal(0), todo: z.literal(0) }).strict().refine(value => value.tests === value.pass);
const jobSchema = z.object({ name: z.enum(['unit', 'browser', 'responses', 'pages-build']), exitCode: z.literal(0), signal: z.null(),
  timedOut: z.literal(false), cancelled: z.literal(false), logTruncated: z.literal(false), startFailed: z.literal(false), orphanedGroupDetected: z.literal(false),
  stdoutBytes: count.max(16 * 1024 * 1024), stderrBytes: count.max(16 * 1024 * 1024), stdoutSha256: digest, stderrSha256: digest }).strict();

/** Byte-integrity/engineering gate, deliberately not a live-model or market claim. */
export function verifyReviewOfflineProof(input: {
  proofId: string; report: unknown; logs: Record<string, Uint8Array>; history: unknown; currentHistory: unknown; currentSources: unknown;
  responses: { report: unknown; tap: Uint8Array; history: unknown };
}): ReviewUpdateStatus['engineering'] {
  if (!/^system-[A-Za-z0-9]{6}$/.test(input.proofId)) throw new Error('Invalid fixed proof ID.');
  const report = z.object({ version: z.literal('offline-system-review-1.1'), status: z.literal('passed'), cancelled: z.literal(false), loadCheck: z.literal(true), counts: countsSchema,
    jobs: z.array(jobSchema).length(4), providerRequests: z.literal(0), apiCostCny: z.literal(0), realProviderSchemaSupport: z.literal('not-tested'), productionRouteActivated: z.literal(false),
    source: z.object({ files: sourceFiles, filesAfter: sourceFiles, sourceMatched: z.literal(true), verificationState: z.literal('matched'), inventorySha256: digest, workingTreeSnapshotNotNewPublishedCommit: z.literal(true) }).passthrough(),
    historicalIntegrity: z.object({ scope: z.literal('local-full'), verifiedCount: z.literal(179), beforeCount: z.literal(179), matched: z.literal(true), verificationState: z.literal('matched') }).strict(),
  }).passthrough().parse(input.report);
  if (new Set(report.jobs.map(job => job.name)).size !== 4) throw new Error('Four unique registered jobs are required.');
  const expectedLogs = report.jobs.flatMap(job => [`${job.name}.stdout.log`, `${job.name}.stderr.log`]).sort();
  if (!same(Object.keys(input.logs).sort(), expectedLogs)) throw new Error('Exact eight proof logs are required.');
  for (const job of report.jobs) for (const kind of ['stdout', 'stderr'] as const) {
    const bytes = input.logs[`${job.name}.${kind}.log`];
    if (bytes.length !== job[`${kind}Bytes`] || sha256(bytes) !== job[`${kind}Sha256`]) throw new Error('Proof job log byte/hash mismatch.');
  }
  if (report.jobs.some(job => job.stdoutBytes + job.stderrBytes > 16 * 1024 * 1024)) throw new Error('Proof combined job log cap exceeded.');
  if (!same(completeReviewTap(text(input.logs['unit.stdout.log'])), report.counts)) throw new Error('Unit log and report counts differ.');
  if (!same(report.source.files, report.source.filesAfter) || !same(report.source.files, input.currentSources)
    || fingerprint(report.source.files) !== report.source.inventorySha256) throw new Error('Tested runtime source inventory has drifted.');
  const history = z.object({ before: z.unknown(), after: z.unknown(), verificationState: z.literal('matched') }).strict().parse(input.history);
  if (!same(history.before, history.after) || !same(history.after, input.currentHistory)) throw new Error('Historical local-full evidence has drifted.');
  z.object({ scope: z.literal('local-full'), verifiedCount: z.literal(179) }).passthrough().parse(input.currentHistory);
  const browser = text(input.logs['browser.stdout.log']);
  const starts = [...browser.matchAll(/^Running (\d+) tests using \d+ workers?$/gm)], ends = [...browser.matchAll(/^\s*(\d+) passed \([^\r\n]+\)\s*$/gm)];
  if (starts.length !== 1 || ends.length !== 1 || Number(starts[0][1]) < 1 || starts[0][1] !== ends[0][1]
    || /^\s*\d+ (?:failed|skipped|flaky|interrupted|did not run)\b/m.test(browser)) throw new Error('Browser completion is missing, ambiguous or not wholly passed.');
  const child = z.object({ version: z.literal('offline-responses-review-1.0'), counts: countsSchema, providerRequests: z.literal(0), apiCostCny: z.literal(0),
    productionRouteActivated: z.literal(false), realProviderSchemaSupport: z.literal('not-tested'), syntheticUsageIsNotBilling: z.literal(true), logicOrMarketQualityCertified: z.literal(false),
    historicalIntegrity: z.object({ scope: z.literal('local-full'), verifiedCount: z.literal(179), beforeHash: digest, afterHash: digest, matched: z.literal(true) }).strict(),
    source: z.object({ files: sourceFiles, workingTreeSnapshotNotNewPublishedCommit: z.literal(true) }).passthrough(),
  }).passthrough().parse(input.responses.report);
  const childSummary = z.object({ counts: countsSchema, providerRequests: z.literal(0), apiCostCny: z.literal(0), verifiedHistoricalFiles: z.literal(179) }).passthrough().parse(JSON.parse(text(input.logs['responses.stdout.log'])));
  if (!same(completeReviewTap(text(input.responses.tap)), child.counts) || !same(child.counts, childSummary.counts)) throw new Error('Responses child TAP, report and parent summary differ.');
  if (!same(input.responses.history, input.currentHistory) || child.historicalIntegrity.beforeHash !== fingerprint(input.currentHistory)
    || child.historicalIntegrity.afterHash !== fingerprint(input.currentHistory)) throw new Error('Responses child historical proof differs.');
  const current = sourceFiles.parse(input.currentSources);
  for (const file of child.source.files) if (!current.some(entry => entry.name === file.name && entry.sha256 === file.sha256)) throw new Error('Responses child source no longer matches runtime inventory.');
  return { proofId: input.proofId, unit: { passed: report.counts.pass, total: report.counts.tests }, browser: { passed: Number(ends[0][1]), total: Number(starts[0][1]) },
    responses: { passed: child.counts.pass, total: child.counts.tests }, sourceInventorySha256: report.source.inventorySha256,
    historicalFiles: 179, providerRequests: 0, apiCostCny: 0, proofMeaning: 'working-tree-byte-match-not-commit-attestation' };
}

/** A failed settled report remains failed; forensic/posthoc output is never consulted. */
export function verifyReviewLiveSummary(summaryInput: unknown, reportInput: unknown, ledgerInput: unknown, reportBytes: Uint8Array): ReviewLiveSummary {
  const summary = liveSummary.parse(summaryInput);
  if (summary.experimentId === ORIGINAL_RESPONSES_RUN && summary.reportSha256 !== ORIGINAL_RESPONSES_REPORT_SHA256) throw new Error('Frozen original failed report cannot be rehashed after mutation.');
  if (sha256(reportBytes) !== summary.reportSha256 || !same(JSON.parse(text(reportBytes)), reportInput)) throw new Error('Live report original-byte hash mismatch.');
  const report = z.object({ version: z.literal('responses-live-capability-report-1.0'), experimentId: z.string().uuid(), status: z.enum(['stopped', 'passed']),
    executionError: z.literal(false), journalClosureAttempted: z.literal(true), journalClosureSucceeded: z.literal(true), ledgerFinalized: z.literal(true),
    providerDispatches: count.max(2), inputTokens: count.nullable(), outputTokens: count.nullable(), tokenCoverage: z.enum(['reported', 'incomplete']),
    conservativeKnownUsageCostCny: cost, committedOrReservedCny: cost.max(1), marketResearchValidated: z.literal(false), personaContributionValidated: z.literal(false),
    result: z.object({ planned: z.literal(2), status: z.enum(['stopped', 'passed']), passed: count.max(2), failed: count.max(2), notStarted: count.max(2), stopReason: z.string().nullable(),
      slots: z.array(z.object({ id: z.enum(['child-snacks', 'pet-snacks']), status: z.enum(['passed', 'failed', 'not-started']),
        recorder: z.object({ attempts: count.max(1), forwarded: count.max(1) }).passthrough().nullable(),
        evidence: z.object({ transport: z.object({ requestAttempts: count.max(1), forwardedRequests: count.max(1), deniedRequests: z.literal(0) }).passthrough() }).passthrough().nullable(),
      }).passthrough()).length(2),
    }).passthrough(), ledger: z.unknown(),
  }).passthrough().parse(reportInput);
  const ledger = z.object({ schemaVersion: z.literal('experiment-budget-1.0'), state: z.enum(['closed', 'halted']), storageStatus: z.literal('durable'),
    requestCount: count.max(2), committedCny: cost.max(1), knownUsageCostCny: cost, knownUsageRequestCount: count.max(2), usageStatus: z.enum(['reported', 'incomplete']),
    budgetCny: z.literal(1), maxProviderRequests: z.literal(2), pricing: z.object({ provider: z.literal('deepseek'), modelId: z.literal('deepseek-flash'), currency: z.literal('CNY') }).passthrough(),
  }).passthrough().parse(ledgerInput);
  if (!same(report.ledger, ledgerInput) || report.experimentId !== summary.experimentId || report.status !== summary.status || report.result.status !== summary.status
    || report.providerDispatches !== summary.providerRequests || ledger.requestCount !== summary.providerRequests || report.inputTokens !== summary.inputTokens
    || report.outputTokens !== summary.outputTokens || report.tokenCoverage !== summary.usageStatus || ledger.usageStatus !== summary.usageStatus || ledger.knownUsageRequestCount !== summary.knownUsageRequestCount
    || report.committedOrReservedCny !== summary.committedOrReservedCny || ledger.committedCny !== summary.committedOrReservedCny
    || report.result.passed !== summary.passed || report.result.failed !== summary.failed || report.result.notStarted !== summary.notStarted || report.result.stopReason !== summary.failureCode) throw new Error('Live summary contradicts its immutable closed report/ledger.');
  if (new Set(report.result.slots.map(slot => slot.id)).size !== 2) throw new Error('Two unique scenarios are required.');
  for (const status of ['passed', 'failed', 'not-started'] as const) {
    const expected = status === 'passed' ? summary.passed : status === 'failed' ? summary.failed : summary.notStarted;
    if (report.result.slots.filter(slot => slot.status === status).length !== expected) throw new Error('Live slot denominators differ.');
  }
  const attempts = report.result.slots.reduce((sum, slot) => sum + (slot.recorder?.attempts ?? 0), 0);
  const forwarded = report.result.slots.reduce((sum, slot) => sum + (slot.recorder?.forwarded ?? 0), 0);
  if (attempts !== summary.providerAttempts || forwarded !== summary.providerRequests) throw new Error('Live original recorder attempts/forwarding differs.');
  for (const slot of report.result.slots) {
    if (slot.status === 'not-started' && (slot.recorder !== null || slot.evidence !== null)) throw new Error('Unstarted slot has dispatch evidence.');
    if (slot.status !== 'not-started' && (!slot.recorder || !slot.evidence || slot.recorder.attempts !== 1 || slot.recorder.forwarded !== 1
      || slot.evidence.transport.requestAttempts !== 1 || slot.evidence.transport.forwardedRequests !== 1)) throw new Error('Live slot exact request evidence is missing.');
  }
  if (summary.knownUsageRequestCount > 0 && (report.conservativeKnownUsageCostCny !== summary.conservativeKnownUsageCostCny
    || ledger.knownUsageCostCny !== summary.conservativeKnownUsageCostCny)) throw new Error('Known partial/full usage estimate differs.');
  if (summary.knownUsageRequestCount === 0 && (report.conservativeKnownUsageCostCny !== 0 || ledger.knownUsageCostCny !== 0)) throw new Error('Unvalidated forensic cost must not be admitted as known usage.');
  if (summary.usageStatus === 'incomplete' && ledger.knownUsageRequestCount === ledger.requestCount) throw new Error('Incomplete usage cannot be fully reported.');
  return summary;
}

export function selectReviewUpdateBuildFiles(names: readonly string[]): string[] {
  if (new Set(names).size !== names.length || names.some(name => name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..') || /[\\\u0000-\u001f]/.test(name))) throw new Error('Invalid or duplicate Pages paths.');
  const ignored = (name: string) => /^(submission|submission-next|submission-contract11)\//.test(name)
    || REVIEW_UPDATE_FILES.some(file => name === `${REVIEW_UPDATE_DIRECTORY}/${file}`);
  const selected = names.filter(name => !ignored(name));
  if (selected.some(name => !/^(index\.html|review-guide\.html|assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,16}\.(?:js|css))$/.test(name))
    || !selected.includes('index.html') || !selected.includes('review-guide.html') || !selected.some(name => name.endsWith('.js'))) throw new Error('Only both Pages entries and hashed JS/CSS assets are publishable.');
  return [...selected].sort();
}

/** Verify every pre-existing tracked byte, not merely the three known material trees. */
export function assertReviewPagesPreserved(before: Record<string, string>, after: Record<string, string>, archives: Record<string, string>): void {
  for (const [name, digest] of Object.entries(before)) {
    if (name === 'index.html' || name === 'review-guide.html') {
      if (archives[`${REVIEW_UPDATE_ARCHIVE}/${name}`] !== digest) throw new Error('Mutable Pages entry lacks exact pre-deployment archive.');
    } else if (after[name] !== digest) throw new Error('An existing tracked Pages file changed or disappeared.');
  }
  if (!Object.hasOwn(before, 'index.html') || !Object.hasOwn(before, 'review-guide.html')) throw new Error('Both previous Pages entries are required.');
}
