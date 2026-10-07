import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../shared/evidence';
import { containsKnownSecret } from '../shared/redaction';
import { createResponsesProbeCases, RESPONSES_PROBE_MODEL, RESPONSES_PROBE_SCOPE } from '../shared/responses-probe-plan';
import { createExperimentBudget } from '../server/research/experiment-budget';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';
import { getPopulationModel } from '../server/population/service';
import { loadProbeCredential } from '../server/research/probe-credential';
import { captureProbeSources, PROBE_AUTHORIZATION_ID, PROBE_CREDENTIAL_STORE, PROBE_PRICING_URL, validateProbeApproval, validateProbeRegistration,
  verifyProbePredecessor, verifyProbePricingHtml, verifyProbeSealedPriorTrial, verifyProbeSealedPhaseTrial, type ProbeRegistration } from '../server/research/responses-probe-registration';
import { runResponsesProbe, type ProbeSlot } from '../server/research/responses-probe-run';

const root = fileURLToPath(new URL('..', import.meta.url));
async function main() {
  const args = process.argv.slice(2), switches = args.filter(arg => ['--preflight', '--execute'].includes(arg));
  if (switches.length !== 1 || args.length !== new Set(args).size
    || args.some(arg => !['--preflight', '--execute'].includes(arg) && !arg.startsWith('--credential-store='))
    || args.filter(arg => arg.startsWith('--credential-store=')).length > 1
    || args.includes('--preflight') && args.some(arg => arg.startsWith('--credential-store='))) throw new Error('Invalid probe flags.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node22 required.');
  const credentialArgument = args.find(arg => arg.startsWith('--credential-store='))?.slice('--credential-store='.length);
  if (credentialArgument !== undefined && path.resolve(credentialArgument) !== PROBE_CREDENTIAL_STORE) throw new Error('Unapproved credential source.');
  await verifyProbePredecessor(root);
  await verifyProbeSealedPriorTrial(root);
  await verifyProbeSealedPhaseTrial(root);
  const directory = path.join(root, 'output/live-evaluation-authorizations', PROBE_AUTHORIZATION_ID);
  const ledgerPath = path.join(directory, 'budget-ledger.json');
  const exists = async (filename: string) => { try { await lstat(filename); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
  const checkPath = async (filename: string, kind: 'file' | 'directory') => {
    const info = await lstat(filename);
    if (info.isSymbolicLink() || (kind === 'file' ? !info.isFile() : !info.isDirectory()) || await realpath(filename) !== filename
      || kind === 'file' && info.size > 2_000_000) throw new Error('Unsafe probe artifact path.');
  };
  await mkdir(directory, { recursive: true, mode: 0o700 }); await checkPath(directory, 'directory');
  const read = async (name: string) => { const filename = path.join(directory, name); await checkPath(filename, 'file'); return readFile(filename, 'utf8'); };
  const save = async (name: string, value: string | Uint8Array) => writeFile(path.join(directory, name), value, { flag: 'wx', mode: 0o600 });
  let plan: ProbeRegistration;
  if (args.includes('--preflight') && !await exists(path.join(directory, 'plan.json'))) {
    // Public documentation only; no Key, model API, model listing or balance call.
    const response = await fetch(PROBE_PRICING_URL, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/html') || !response.body) throw new Error('Pricing unavailable.');
    const chunks: Uint8Array[] = []; let length = 0; const reader = response.body.getReader();
    try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length;
      if (length > 512_000) throw new Error('Pricing source oversized.'); chunks.push(next.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const pricing = verifyProbePricingHtml(html, new Date().toISOString());
    const cases = createResponsesProbeCases(getPopulationModel()), sourceFiles = await captureProbeSources(root);
    const history = await verifyHistoricalEvidence(root);
    const env = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
    plan = validateProbeRegistration({ version: 'responses-probe-registration-1.3', id: randomUUID(), authorizationId: PROBE_AUTHORIZATION_ID,
      credentialStore: PROBE_CREDENTIAL_STORE, predecessor: await verifyProbePredecessor(root), sealedPriorTrial: await verifyProbeSealedPriorTrial(root),
      sealedPhaseTrial: await verifyProbeSealedPhaseTrial(root),
      registeredAt: new Date().toISOString(), scope: RESPONSES_PROBE_SCOPE, model: RESPONSES_PROBE_MODEL, cases, casesHash: fingerprint(cases),
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env, encoding: 'utf8' }).trim(), sourceFiles, sourceHash: fingerprint(sourceFiles),
      pricing, historicalHash: fingerprint(history), historicalCount: history.verifiedCount,
      reservationCeilingCny: cases.reduce((sum, probe) => sum + ((probe.frozenRequest.bodyUtf8Bytes + 1024) * 2 + 3000 * 8) / 1_000_000, 0),
      notice: '2 fixed synthetic knowledge-boundary slots; not a preference cohort, market validation, or provider keyword-enforcement proof' });
    await save('pricing-source.html', html); await save('plan.json', JSON.stringify(plan, null, 2) + '\n');
  } else plan = validateProbeRegistration(JSON.parse(await read('plan.json')));
  let authorizationSnapshot: { approvalHash: string; bindingHash: string } | null = null;
  const verifyCurrent = async () => {
    await verifyProbePredecessor(root);
    await verifyProbeSealedPriorTrial(root);
    await verifyProbeSealedPhaseTrial(root);
    if (fingerprint(validateProbeRegistration(JSON.parse(await read('plan.json')))) !== fingerprint(plan)
      || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, encoding: 'utf8' }).trim() !== plan.sourceHead
      || fingerprint(await captureProbeSources(root)) !== plan.sourceHash || fingerprint(createResponsesProbeCases(getPopulationModel())) !== plan.casesHash
      || fingerprint(await verifyHistoricalEvidence(root)) !== plan.historicalHash
      || fingerprint(verifyProbePricingHtml(await read('pricing-source.html'), plan.pricing.checkedAt)) !== fingerprint(plan.pricing)) throw new Error('Frozen probe changed.');
    if (authorizationSnapshot) {
      const approval = JSON.parse(await read('approval.json')), binding = JSON.parse(await read('authorized-plan.json'));
      validateProbeApproval(plan, approval, binding);
      if (fingerprint(approval) !== authorizationSnapshot.approvalHash || fingerprint(binding) !== authorizationSnapshot.bindingHash) throw new Error('Probe authorization changed.');
    }
  };
  await verifyCurrent();
  if (args.includes('--preflight')) {
    console.log(JSON.stringify({ status: 'preflight-frozen-no-model-call', authorizationId: PROBE_AUTHORIZATION_ID, experimentId: plan.id,
      planHash: fingerprint(plan), scope: plan.scope, reservationCeilingCny: plan.reservationCeilingCny,
      consumed: await exists(ledgerPath) || await exists(ledgerPath + '.lock'), approvalCreatedByScript: false, providerRequests: 0,
      planPath: path.relative(root, path.join(directory, 'plan.json')) }, null, 2)); return;
  }
  const approval = JSON.parse(await read('approval.json')), binding = JSON.parse(await read('authorized-plan.json'));
  validateProbeApproval(plan, approval, binding);
  authorizationSnapshot = { approvalHash: fingerprint(approval), bindingHash: fingerprint(binding) };
  await verifyCurrent();
  if (await exists(ledgerPath) || await exists(ledgerPath + '.lock')) throw new Error('Probe ledger already consumed.');
  // Only after all public registration gates: read ONE existing configured model.
  const model = await loadProbeCredential(plan.credentialStore, RESPONSES_PROBE_MODEL);
  await verifyCurrent();
  const runDirectory = path.join(root, 'output/live-capability-proof', plan.id);
  await mkdir(path.dirname(runDirectory), { recursive: true, mode: 0o700 }); await mkdir(runDirectory, { mode: 0o700 }); await checkPath(runDirectory, 'directory');
  const safeSave = async (name: string, value: string | Buffer) => {
    const text = typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
    if (containsKnownSecret(text, model.apiKey)) throw new Error('Unsafe probe evidence.');
    await writeFile(path.join(runDirectory, name), value, { flag: 'wx', mode: 0o600 });
  };
  await safeSave('plan.json', JSON.stringify(plan, null, 2) + '\n');
  const guard = createExperimentBudget({ ledgerPath, experimentId: PROBE_AUTHORIZATION_ID, budgetCny: 1, maxProviderRequests: 2,
    pricing: { provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
      sourceUrl: plan.pricing.url, checkedAt: plan.pricing.checkedAt } });
  const controller = new AbortController(), cancel = () => controller.abort(); let checkpointIndex = 0;
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  let result: Awaited<ReturnType<typeof runResponsesProbe>> | null = null, executionError = false, journalClosureSucceeded = false;
  const startedAt = new Date().toISOString(), start = performance.now();
  try {
    result = await runResponsesProbe({ plan, guard, model, signal: controller.signal, assertSources: verifyCurrent,
      checkpoint: async (slots: ProbeSlot[], original) => {
        await safeSave(`checkpoint-${String(checkpointIndex++).padStart(2, '0')}.json`, JSON.stringify({ slots }, null, 2) + '\n');
        if (original) await safeSave(`${original.id}.provider-original.txt`, original.bytes);
      } });
  } catch { executionError = true; if (guard.snapshot().state === 'active') guard.stop('probe-execution-failed'); }
  finally {
    try { guard.close(); journalClosureSucceeded = true; } catch { executionError = true; }
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  }
  const ledger = guard.snapshot();
  await safeSave('budget-ledger.json', JSON.stringify(ledger, null, 2) + '\n');
  const report = { version: 'responses-live-capability-report-1.0', authorizationId: PROBE_AUTHORIZATION_ID, experimentId: plan.id,
    startedAt, endedAt: new Date().toISOString(), durationMs: performance.now() - start,
    status: !executionError && result?.status === 'passed' ? 'passed' : 'stopped', executionError,
    result, journalClosureAttempted: true, journalClosureSucceeded,
    ledgerFinalized: journalClosureSucceeded && ledger.storageStatus === 'durable' && ledger.state !== 'active',
    ledger, providerDispatches: result?.slots.reduce((sum, slot) => sum + (slot.recorder?.forwarded ?? 0), 0) ?? null,
    predecessor: plan.predecessor, sealedPriorTrial: plan.sealedPriorTrial, sealedPhaseTrial: plan.sealedPhaseTrial,
    independentAuthorization: { budgetCny: 1, maxProviderRequests: 2,
      currentGrantProviderDispatches: result?.slots.reduce((sum, slot) => sum + (slot.recorder?.forwarded ?? 0), 0) ?? null,
      priorSealedGrantProviderDispatches: plan.sealedPriorTrial.providerRequests + plan.sealedPhaseTrial.providerRequests,
      priorSealedGrantCount: 2, priorReservationCanFundThisGrant: false,
      meaning: 'Separately approved fixed revalidation grant; both prior halted grants are sealed. Unknown prior reserve stays retained; neither prior reserve nor remaining allowance is resumed or credited to this grant.' },
    inputTokens: ledger.knownUsageRequestCount ? ledger.reservations.reduce((sum, entry) => sum + (entry.usage?.inputTokens ?? 0), 0) : null,
    outputTokens: ledger.knownUsageRequestCount ? ledger.reservations.reduce((sum, entry) => sum + (entry.usage?.outputTokens ?? 0), 0) : null,
    tokenCoverage: ledger.usageStatus, conservativeKnownUsageCostCny: ledger.knownUsageCostCny, committedOrReservedCny: ledger.committedCny,
    keywordExecution: 'unknown', marketResearchValidated: false, personaContributionValidated: false,
    notice: 'Real API capability calls, synthetic knowledge-boundary slots, not mock responses or a preference survey. Complete original hashes are separate from any projection; no provider invoice or keyword enforcement certified.' };
  await safeSave('report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ directory: runDirectory, status: report.status, planned: result?.planned ?? 2, passed: result?.passed ?? 0,
    failed: result?.failed ?? null, notStarted: result?.notStarted ?? null, stopReason: result ? result.stopReason : 'probe-execution-failed',
    providerDispatches: report.providerDispatches, inputTokens: report.inputTokens, outputTokens: report.outputTokens,
    tokenCoverage: report.tokenCoverage, conservativeKnownUsageCostCny: report.conservativeKnownUsageCostCny,
    committedOrReservedCny: report.committedOrReservedCny, ledgerState: ledger.state, durationMs: report.durationMs }, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
// Never serialize exceptions, credentials, provider messages or argv contents.
try { await main(); } catch { console.error('Responses capability probe stopped before completion; no automatic retry or ledger resume.'); process.exitCode = 1; }
