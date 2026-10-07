import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { fingerprint } from '../../shared/evidence';
import { createResponsesProbeCases, RESPONSES_PROBE_MODEL, RESPONSES_PROBE_SCOPE, type ResponsesProbeCase } from '../../shared/responses-probe-plan';
import { captureOfflineSources } from './offline-source-seal';

// A separately approved small revalidation grant. Earlier sealed grants are never resumed or credited.
export const PROBE_AUTHORIZATION_ID = 'approved-2026-10-08-responses-knowledge11-cny1-2';
export const PROBE_CREDENTIAL_STORE = path.resolve(fileURLToPath(new URL('../../', import.meta.url)), '../city-agent/.city-agent');
export const PROBE_PREDECESSOR = Object.freeze({ authorizationId: 'approved-2026-10-08-responses-cny1-2',
  experimentId: 'c1e0f2aa-47e0-4909-ae0c-da6068b68e31', reportSha256: '7596f8c051eca17aff526a76436c43f7e279444c750c70a51c1fc8aef5be7146',
  providerRequests: 0, apiCostCny: 0, evidenceKind: 'operator-observation-not-provider-attestation' } as const);
export const PROBE_SEALED_PRIOR_TRIAL = Object.freeze({ authorizationId: 'approved-2026-10-08-responses-cny1-2-original-store',
  experimentId: 'f3ae4289-85a8-4b34-b8ea-8d0e5a264469', reportSha256: '3e298567c2429bd5002475192e8ac852ccf041733eb1146b46f3397dc43903ed',
  ledgerSha256: 'd7878f730a70de18103cc0a00ce3c84f7017e9131f360b107d66e211a4e0e847',
  providerOriginalSha256: '3227d52b5aada9ee0ebc78871308ca404df35fba8ce3b91d70876476104bbff7', providerOriginalBytes: 45_699,
  providerRequests: 1, ledgerState: 'halted', storageStatus: 'durable', usageStatus: 'incomplete', committedOrReservedCny: 0.06465,
  previousReservationCanFundThisGrant: false, evidenceKind: 'sealed-prior-trial-not-new-budget-credit' } as const);
export const PROBE_SEALED_PHASE_TRIAL = Object.freeze({ authorizationId: 'approved-2026-10-08-responses-phase11-cny1-2',
  experimentId: '143651dd-3e97-42d1-bf38-3ef3dcc603d8', reportSha256: '388dc10b22b850b1cac5e04c9a9b116761b32a1c8c488d29f55b3994d6c80886',
  ledgerSha256: '877c8193ce7eb04deb11e9d5e33f3f97f3ae3145b2afc17680b5ee5a0dcd2d2b',
  childProviderOriginalSha256: '0e6d92b8be2eceddaa2e6b05ebb67f27c5ae123a1af3f89a9d3be3c50550c2f8', childProviderOriginalBytes: 45_702,
  petProviderOriginalSha256: '5ce4f0a7dd1e339473703f299b3d69b7ab2ef1f2b4f4a0365721eec49a00ce80', petProviderOriginalBytes: 47_187,
  providerRequests: 2, passed: 1, failed: 1, notStarted: 0, ledgerState: 'halted', storageStatus: 'durable', usageStatus: 'reported',
  inputTokens: 9677, outputTokens: 288, committedOrReservedCny: 0.021658,
  previousReservationCanFundThisGrant: false, evidenceKind: 'sealed-prior-trial-not-new-budget-credit' } as const);
export const PROBE_PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pricingSchema = z.object({ url: z.literal(PROBE_PRICING_URL), checkedAt: z.string().datetime(), htmlSha256: hash,
  currency: z.literal('CNY'), inputPerMillion: z.literal(2), outputPerMillion: z.literal(8),
  basis: z.literal('peak-cache-miss-input-and-peak-output; estimate-not-invoice') }).strict();
export type ProbePricing = z.infer<typeof pricingSchema>;

/** Preserve the original zero-call observation; later grants cannot rewrite or open its journal. */
export async function verifyProbePredecessor(root: string) {
  const prior = path.join(root, 'output/live-evaluation-authorizations', PROBE_PREDECESSOR.authorizationId);
  for (const name of ['budget-ledger.json', 'budget-ledger.json.lock']) {
    try { await lstat(path.join(prior, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Predecessor has a request journal; the sealed zero-call observation is no longer intact.');
  }
  const filename = path.join(root, 'output/live-capability-proof', PROBE_PREDECESSOR.experimentId, 'pre-dispatch-report.json');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename || info.size > 512_000) throw new Error('Invalid predecessor observation path.');
  const bytes = await readFile(filename);
  if (createHash('sha256').update(bytes).digest('hex') !== PROBE_PREDECESSOR.reportSha256) throw new Error('Predecessor observation changed.');
  const report = JSON.parse(bytes.toString('utf8'));
  if (report.authorizationId !== PROBE_PREDECESSOR.authorizationId || report.experimentId !== PROBE_PREDECESSOR.experimentId
    || report.providerRequests !== 0 || report.apiCostCny !== 0 || report.ledgerCreated !== false || report.status !== 'pre-dispatch-stopped') throw new Error('Predecessor is not an unused registration.');
  return PROBE_PREDECESSOR;
}

const sealedLedgerSchema = z.object({ schemaVersion: z.literal('experiment-budget-1.0'), experimentId: z.literal(PROBE_SEALED_PRIOR_TRIAL.authorizationId),
  state: z.literal('halted'), storageStatus: z.literal('durable'), requestCount: z.literal(1), maxProviderRequests: z.literal(2), budgetCny: z.literal(1),
  committedNanoCny: z.literal(64_650_000), committedCny: z.literal(0.06465), knownUsageCostCny: z.literal(0), knownUsageRequestCount: z.literal(0),
  usageStatus: z.literal('incomplete'), stopReason: z.literal('request-failed'),
  reservations: z.array(z.object({ requestId: z.literal('capability.child-snacks.001'), state: z.literal('uncertain'), outcome: z.literal('failed'),
    reservationNanoCny: z.literal(64_650_000), committedNanoCny: z.literal(64_650_000) }).passthrough()).length(1) }).passthrough();
const sealedReportSchema = z.object({ version: z.literal('responses-live-capability-report-1.0'),
  authorizationId: z.literal(PROBE_SEALED_PRIOR_TRIAL.authorizationId), experimentId: z.literal(PROBE_SEALED_PRIOR_TRIAL.experimentId),
  status: z.literal('stopped'), executionError: z.literal(false), journalClosureAttempted: z.literal(true),
  journalClosureSucceeded: z.literal(true), ledgerFinalized: z.literal(true), providerDispatches: z.literal(1),
  result: z.object({ version: z.literal('responses-probe-run-1.0'), status: z.literal('stopped'), planned: z.literal(2), passed: z.literal(0),
    failed: z.literal(1), notStarted: z.literal(1), slots: z.tuple([
      z.object({ id: z.literal('child-snacks'), status: z.literal('failed'), failureCode: z.literal('RESPONSES_SDK_NON_COMPLETION'),
        recorder: z.object({ attempts: z.literal(1), forwarded: z.literal(1), state: z.literal('eof-complete'),
          receivedBytes: z.literal(PROBE_SEALED_PRIOR_TRIAL.providerOriginalBytes), retainedBytes: z.literal(PROBE_SEALED_PRIOR_TRIAL.providerOriginalBytes),
          completeSha256: z.literal(PROBE_SEALED_PRIOR_TRIAL.providerOriginalSha256), overflow: z.literal(false),
          cleanupFailed: z.literal(false), unsafeReason: z.null() }).passthrough() }).passthrough(),
      z.object({ id: z.literal('pet-snacks'), status: z.literal('not-started'), recorder: z.null() }).passthrough(),
    ]) }).passthrough(),
  predecessor: z.unknown(), aggregateAuthorization: z.object({ budgetCny: z.literal(1), maxProviderRequests: z.literal(2),
    priorProviderDispatches: z.literal(0), cumulativeProviderDispatches: z.literal(1) }).passthrough(),
  inputTokens: z.null(), outputTokens: z.null(), tokenCoverage: z.literal('incomplete'), conservativeKnownUsageCostCny: z.literal(0),
  committedOrReservedCny: z.literal(0.06465), ledger: z.unknown() }).passthrough();

/** Pure selected-metadata checks; full immutable file hashes, not this projection, are the outer authenticity gate. */
export function validateProbeSealedTrialEvidence(input: unknown) {
  const evidence = z.object({ report: sealedReportSchema, ledger: sealedLedgerSchema, runLedger: sealedLedgerSchema }).strict().parse(input);
  if (fingerprint(evidence.report.predecessor) !== fingerprint(PROBE_PREDECESSOR)
    || fingerprint(evidence.report.ledger) !== fingerprint(evidence.ledger) || fingerprint(evidence.ledger) !== fingerprint(evidence.runLedger)
    || evidence.ledger.reservations.some(entry => Object.hasOwn(entry, 'usage') || Object.hasOwn(entry, 'actualNanoCny'))) {
    throw new Error('Sealed prior trial metadata changed or unknown usage was settled.');
  }
  return PROBE_SEALED_PRIOR_TRIAL;
}

/** Operator-only experiment dependency: no Key/DB access, network, normalization writes, or prior-ledger resume. */
export async function verifyProbeSealedPriorTrial(root: string) {
  const prior = path.join(root, 'output/live-evaluation-authorizations', PROBE_SEALED_PRIOR_TRIAL.authorizationId);
  const run = path.join(root, 'output/live-capability-proof', PROBE_SEALED_PRIOR_TRIAL.experimentId);
  for (const filename of [path.join(prior, 'budget-ledger.json.lock'), path.join(run, 'budget-ledger.json.lock')]) {
    try { await lstat(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Sealed prior trial still has a journal lock.');
  }
  const files = [path.join(run, 'report.json'), path.join(prior, 'budget-ledger.json'), path.join(run, 'budget-ledger.json'),
    path.join(run, 'child-snacks.provider-original.txt')];
  // Check every path before any hash so missing/symlinked artifacts cannot be obscured by an earlier hash failure.
  for (const filename of files) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename || info.size > 512_000) throw new Error('Sealed prior trial artifact path invalid.');
  }
  const [reportBytes, ledgerBytes, runLedgerBytes, originalBytes] = await Promise.all(files.map(filename => readFile(filename)));
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (sha256(reportBytes) !== PROBE_SEALED_PRIOR_TRIAL.reportSha256 || sha256(ledgerBytes) !== PROBE_SEALED_PRIOR_TRIAL.ledgerSha256
    || sha256(runLedgerBytes) !== PROBE_SEALED_PRIOR_TRIAL.ledgerSha256 || !ledgerBytes.equals(runLedgerBytes)
    || originalBytes.length !== PROBE_SEALED_PRIOR_TRIAL.providerOriginalBytes || sha256(originalBytes) !== PROBE_SEALED_PRIOR_TRIAL.providerOriginalSha256) {
    throw new Error('Sealed prior trial artifact bytes changed.');
  }
  return validateProbeSealedTrialEvidence({ report: JSON.parse(reportBytes.toString('utf8')), ledger: JSON.parse(ledgerBytes.toString('utf8')),
    runLedger: JSON.parse(runLedgerBytes.toString('utf8')) });
}

const phaseReservationSchema = (requestId: string, inputTokens: number, outputTokens: number, reserved: number, committed: number) =>
  z.object({ requestId: z.literal(requestId), state: z.literal('settled'), outcome: z.literal('succeeded'),
    usage: z.object({ inputTokens: z.literal(inputTokens), outputTokens: z.literal(outputTokens) }).strict(),
    reservationNanoCny: z.literal(reserved), committedNanoCny: z.literal(committed), actualNanoCny: z.literal(committed) }).passthrough();
const phaseLedgerSchema = z.object({ schemaVersion: z.literal('experiment-budget-1.0'), experimentId: z.literal(PROBE_SEALED_PHASE_TRIAL.authorizationId),
  state: z.literal('halted'), storageStatus: z.literal('durable'), requestCount: z.literal(2), maxProviderRequests: z.literal(2), budgetCny: z.literal(1),
  committedNanoCny: z.literal(21_658_000), committedCny: z.literal(0.021658), knownUsageCostCny: z.literal(0.021658), knownUsageRequestCount: z.literal(2),
  usageStatus: z.literal('reported'), stopReason: z.literal('probe-first-failure'), reservations: z.tuple([
    phaseReservationSchema('capability.child-snacks.001', 4753, 140, 64_650_000, 10_626_000),
    phaseReservationSchema('capability.pet-snacks.001', 4924, 148, 65_836_000, 11_032_000),
  ]) }).passthrough();
const phaseRecorderSchema = (bytes: number, sha256: string) => z.object({ attempts: z.literal(1), forwarded: z.literal(1), state: z.literal('eof-complete'),
  receivedBytes: z.literal(bytes), retainedBytes: z.literal(bytes), completeSha256: z.literal(sha256), overflow: z.literal(false),
  cleanupFailed: z.literal(false), unsafeReason: z.null() }).passthrough();
const phaseReportSchema = z.object({ version: z.literal('responses-live-capability-report-1.0'),
  authorizationId: z.literal(PROBE_SEALED_PHASE_TRIAL.authorizationId), experimentId: z.literal(PROBE_SEALED_PHASE_TRIAL.experimentId),
  status: z.literal('stopped'), executionError: z.literal(false), journalClosureAttempted: z.literal(true),
  journalClosureSucceeded: z.literal(true), ledgerFinalized: z.literal(true), providerDispatches: z.literal(2),
  result: z.object({ version: z.literal('responses-probe-run-1.0'), status: z.literal('stopped'), planned: z.literal(2), passed: z.literal(1),
    failed: z.literal(1), notStarted: z.literal(0), stopReason: z.literal('probe-quality-rejected'), slots: z.tuple([
      z.object({ id: z.literal('child-snacks'), status: z.literal('passed'), failureCode: z.null(),
        recorder: phaseRecorderSchema(PROBE_SEALED_PHASE_TRIAL.childProviderOriginalBytes, PROBE_SEALED_PHASE_TRIAL.childProviderOriginalSha256) }).passthrough(),
      z.object({ id: z.literal('pet-snacks'), status: z.literal('failed'), failureCode: z.literal('probe-quality-rejected'),
        recorder: phaseRecorderSchema(PROBE_SEALED_PHASE_TRIAL.petProviderOriginalBytes, PROBE_SEALED_PHASE_TRIAL.petProviderOriginalSha256) }).passthrough(),
    ]) }).passthrough(),
  predecessor: z.unknown(), sealedPriorTrial: z.unknown(), independentAuthorization: z.object({ budgetCny: z.literal(1), maxProviderRequests: z.literal(2),
    currentGrantProviderDispatches: z.literal(2), priorSealedGrantProviderDispatches: z.literal(1), priorReservationCanFundThisGrant: z.literal(false) }).passthrough(),
  inputTokens: z.literal(9677), outputTokens: z.literal(288), tokenCoverage: z.literal('reported'), conservativeKnownUsageCostCny: z.literal(0.021658),
  committedOrReservedCny: z.literal(0.021658), ledger: z.unknown() }).passthrough();

/** The protocol can settle valid reported usage while a separate quality gate fails; preserve both layers verbatim. */
export function validateProbeSealedPhaseTrialEvidence(input: unknown) {
  const evidence = z.object({ report: phaseReportSchema, ledger: phaseLedgerSchema, runLedger: phaseLedgerSchema }).strict().parse(input);
  if (fingerprint(evidence.report.predecessor) !== fingerprint(PROBE_PREDECESSOR)
    || fingerprint(evidence.report.sealedPriorTrial) !== fingerprint(PROBE_SEALED_PRIOR_TRIAL)
    || fingerprint(evidence.report.ledger) !== fingerprint(evidence.ledger) || fingerprint(evidence.ledger) !== fingerprint(evidence.runLedger)) {
    throw new Error('Sealed phase trial metadata changed.');
  }
  return PROBE_SEALED_PHASE_TRIAL;
}

export async function verifyProbeSealedPhaseTrial(root: string) {
  const prior = path.join(root, 'output/live-evaluation-authorizations', PROBE_SEALED_PHASE_TRIAL.authorizationId);
  const run = path.join(root, 'output/live-capability-proof', PROBE_SEALED_PHASE_TRIAL.experimentId);
  for (const filename of [path.join(prior, 'budget-ledger.json.lock'), path.join(run, 'budget-ledger.json.lock')]) {
    try { await lstat(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Sealed phase trial still has a journal lock.');
  }
  const files = [path.join(run, 'report.json'), path.join(prior, 'budget-ledger.json'), path.join(run, 'budget-ledger.json'),
    path.join(run, 'child-snacks.provider-original.txt'), path.join(run, 'pet-snacks.provider-original.txt')];
  for (const filename of files) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename || info.size > 512_000) throw new Error('Sealed phase trial artifact path invalid.');
  }
  const [reportBytes, ledgerBytes, runLedgerBytes, childBytes, petBytes] = await Promise.all(files.map(filename => readFile(filename)));
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (sha256(reportBytes) !== PROBE_SEALED_PHASE_TRIAL.reportSha256 || sha256(ledgerBytes) !== PROBE_SEALED_PHASE_TRIAL.ledgerSha256
    || sha256(runLedgerBytes) !== PROBE_SEALED_PHASE_TRIAL.ledgerSha256 || !ledgerBytes.equals(runLedgerBytes)
    || childBytes.length !== PROBE_SEALED_PHASE_TRIAL.childProviderOriginalBytes || sha256(childBytes) !== PROBE_SEALED_PHASE_TRIAL.childProviderOriginalSha256
    || petBytes.length !== PROBE_SEALED_PHASE_TRIAL.petProviderOriginalBytes || sha256(petBytes) !== PROBE_SEALED_PHASE_TRIAL.petProviderOriginalSha256) {
    throw new Error('Sealed phase trial artifact bytes changed.');
  }
  return validateProbeSealedPhaseTrialEvidence({ report: JSON.parse(reportBytes.toString('utf8')), ledger: JSON.parse(ledgerBytes.toString('utf8')),
    runLedger: JSON.parse(runLedgerBytes.toString('utf8')) });
}

/** Deliberately fail closed if the official table/model order or registered rates change. */
export function verifyProbePricingHtml(html: string, checkedAt: string): ProbePricing {
  if (Buffer.byteLength(html) > 512_000 || !Number.isFinite(Date.parse(checkedAt))) throw new Error('Invalid pricing source.');
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)]
    .map(cell => cell[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()));
  const miss = rows.findIndex(row => row[0]?.replace(/\s/g, '') === '百万tokens输入（缓存未命中）');
  const out = rows.findIndex(row => row[0]?.replace(/\s/g, '') === '百万tokens输出');
  if (rows[0]?.[0] !== '模型' || !/^deepseek-flash(?:\s|$)/.test(rows[0]?.[1] ?? '')
    || rows[0]?.[2] !== 'deepseek-v4-pro' || miss < 0 || out < 0
    || rows[miss + 1]?.[0] !== '高峰时段' || rows[miss + 1]?.[1] !== '2元'
    || rows[out + 1]?.[0] !== '高峰时段' || rows[out + 1]?.[1] !== '8元') throw new Error('Official pricing differs from the registered conservative rates.');
  return pricingSchema.parse({ url: PROBE_PRICING_URL, checkedAt, htmlSha256: createHash('sha256').update(html).digest('hex'),
    currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8, basis: 'peak-cache-miss-input-and-peak-output; estimate-not-invoice' });
}

export async function captureProbeSources(root: string) {
  const files = await captureOfflineSources(root);
  for (const name of ['data/research/business-child-questionnaire.json', 'data/research/business-pet-questionnaire.json',
    'data/research/business-personas.json', 'data/population/regions/binjiang-2020.json']) {
    const filename = path.join(root, name), info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename || info.size > 512_000) throw new Error('Invalid registered data source.');
    files.push({ name, sha256: createHash('sha256').update(await readFile(filename)).digest('hex') });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

const planSchema = z.object({ version: z.literal('responses-probe-registration-1.3'), id: z.string().uuid(),
  authorizationId: z.literal(PROBE_AUTHORIZATION_ID), registeredAt: z.string().datetime(), scope: z.unknown(), model: z.unknown(),
  credentialStore: z.literal(PROBE_CREDENTIAL_STORE), predecessor: z.unknown(), sealedPriorTrial: z.unknown(), sealedPhaseTrial: z.unknown(),
  cases: z.array(z.unknown()).length(2), casesHash: hash, sourceHead: hash.refine(value => value.length === 64).or(z.string().regex(/^[a-f0-9]{40}$/)),
  sourceFiles: z.array(z.object({ name: z.string().min(1), sha256: hash }).strict()).min(1), sourceHash: hash,
  pricing: pricingSchema, historicalHash: hash, historicalCount: z.literal(42), reservationCeilingCny: z.number().positive().max(1),
  notice: z.literal('2 fixed synthetic knowledge-boundary slots; not a preference cohort, market validation, or provider keyword-enforcement proof') }).strict();
export type ProbeRegistration = Omit<z.infer<typeof planSchema>, 'cases' | 'scope' | 'model' | 'predecessor' | 'sealedPriorTrial' | 'sealedPhaseTrial'> & {
  cases: ResponsesProbeCase[]; scope: typeof RESPONSES_PROBE_SCOPE; model: typeof RESPONSES_PROBE_MODEL;
  predecessor: typeof PROBE_PREDECESSOR; sealedPriorTrial: typeof PROBE_SEALED_PRIOR_TRIAL; sealedPhaseTrial: typeof PROBE_SEALED_PHASE_TRIAL;
};

export function validateProbeRegistration(input: unknown): ProbeRegistration {
  const value = planSchema.parse(input), expected = createResponsesProbeCases();
  const ceiling = expected.reduce((sum, probe) => sum + ((probe.frozenRequest.bodyUtf8Bytes + 1024) * 2 + 3000 * 8) / 1_000_000, 0);
  if (fingerprint(value.scope) !== fingerprint(RESPONSES_PROBE_SCOPE) || fingerprint(value.model) !== fingerprint(RESPONSES_PROBE_MODEL)
    || fingerprint(value.predecessor) !== fingerprint(PROBE_PREDECESSOR)
    || fingerprint(value.sealedPriorTrial) !== fingerprint(PROBE_SEALED_PRIOR_TRIAL)
    || fingerprint(value.sealedPhaseTrial) !== fingerprint(PROBE_SEALED_PHASE_TRIAL)
    || fingerprint(value.cases) !== fingerprint(expected) || value.casesHash !== fingerprint(value.cases)
    || value.sourceHash !== fingerprint(value.sourceFiles) || new Set(value.sourceFiles.map(file => file.name)).size !== value.sourceFiles.length
    || Math.abs(value.reservationCeilingCny - ceiling) > 1e-12) throw new Error('Frozen capability registration differs from the authorized scope.');
  return value as ProbeRegistration;
}

const approvalSchema = z.object({ version: z.literal('responses-probe-approval-1.0'), authorizationId: z.literal(PROBE_AUTHORIZATION_ID),
  status: z.literal('approved'), approvedAt: z.string().datetime(), confirmationReference: z.string().min(1).max(2000),
  scope: z.unknown(), credentialStore: z.literal(PROBE_CREDENTIAL_STORE) }).strict();
const bindingSchema = z.object({ version: z.literal('responses-probe-binding-1.0'), authorizationId: z.literal(PROBE_AUTHORIZATION_ID),
  approvalHash: hash, planHash: hash, boundAt: z.string().datetime() }).strict();

/** CLI cannot generate its own approval: both separately recorded receipt and binding are required. */
export function validateProbeApproval(planInput: unknown, approvalInput: unknown, bindingInput: unknown, now = Date.now()) {
  const plan = validateProbeRegistration(planInput), approval = approvalSchema.parse(approvalInput), binding = bindingSchema.parse(bindingInput);
  if (fingerprint(approval.scope) !== fingerprint(RESPONSES_PROBE_SCOPE) || binding.approvalHash !== fingerprint(approval)
    || binding.planHash !== fingerprint(planInput) || Date.parse(binding.boundAt) < Date.parse(approval.approvedAt)
    || Date.parse(plan.pricing.checkedAt) > now + 60_000 || now - Date.parse(plan.pricing.checkedAt) > 2 * 60 * 60 * 1000) throw new Error('Approval binding or pricing freshness invalid.');
  return plan;
}

export function assertProbeRequest(plan: ProbeRegistration, index: number, candidate: ResponsesProbeCase) {
  validateProbeRegistration(plan);
  if (![0, 1].includes(index) || fingerprint(candidate) !== fingerprint(plan.cases[index])) throw new Error('Unregistered capability invocation.');
}
