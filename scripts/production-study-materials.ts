import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { inspectVerifierStudyArchive, VERIFIER_STUDY_ARCHIVE_LIMITS } from '../server/production/verifier-study-archive.js';

export const VERIFIER_REAL02_ARCHIVE_SHA256 = '8dac4a031c2f289f2d0bd2893eeeb0294890ae2eefb85c43a2f1cf7f81c7ed28';
export const VERIFIER_REAL02_MATERIAL_FILES = Object.freeze(['PRE-REGISTRATION.md', 'RESULT.md', 'archive-inspection.json', 'metrics.json', 'result-page.jpg', 'run-ledger.tar.gz', 'control/consent-consumed.json', 'control/running.json', 'control/terminal.json', 'control/terminal.confirmed.json'].map(name => 'VERIFIER-REAL-02/' + name));
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const fail = (): never => { throw new Error('REAL-02 public evidence is missing, unsafe or inconsistent with its pinned actual ledger.'); };
const secretLike = /apikey_[A-Za-z0-9_=-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\/Users\/|\.city-agent-production(?:\/|\\)/i;
function publicJson(text: string): any { try { return JSON.parse(text); } catch { return fail(); } }
// Archive integrity is not a secrecy check. Scan every validated JSON member,
// including keys and provider strings, without reading any credentials/state.
export function assertStudyMaterialPublic(bytes: Buffer, name: string): void {
  const text = bytes.toString('utf8');
  if (secretLike.test(text)) fail();
  if (!name.endsWith('.json')) return;
  const pending: unknown[] = [publicJson(text)]; let visited = 0;
  while (pending.length) {
    if (++visited > 1_000_000) fail();
    const item = pending.pop();
    if (typeof item === 'string' && secretLike.test(item)) fail();
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      if (secretLike.test(key)) fail();
      if (/^(api[_-]?key|authorization|password|master[_-]?key|encryption[_-]?key|secret)$/i.test(key) && typeof value === 'string' && value.trim()) fail();
      pending.push(value);
    }
  }
}
interface Event { sequence: number; time: string; type: string; payload: Record<string, any> }
interface Usage { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }
const emptyUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
const rounded = (value: number) => Number(value.toFixed(9));
function usage(calls: Event[]): Usage {
  const result = emptyUsage();
  for (const event of calls) {
    const value = event.payload.usage;
    if (event.payload.actualProviderHttpAttempts !== 1 || value?.complete !== true || value.currency !== 'USD' || !Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0 || !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0 || !Number.isFinite(value.estimatedCost) || value.estimatedCost < 0) fail();
    result.calls++; result.inputTokens += value.inputTokens; result.outputTokens += value.outputTokens; result.estimatedCostUsd += value.estimatedCost;
  }
  result.estimatedCostUsd = rounded(result.estimatedCostUsd); return result;
}
/** Second, bounded, in-memory pass over an already pin/integrity-validated tar.
 * No extraction, paths from the archive opened, replay, repair or dispatch. */
function validatedMembers(archive: Buffer): Map<string, Buffer> {
  const bytes = gunzipSync(archive, { maxOutputLength: VERIFIER_STUDY_ARCHIVE_LIMITS.decompressedBytes });
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
    const header = bytes.subarray(offset, offset + 512);
    const string = (start: number, end: number) => header.subarray(start, end).toString('ascii').split('\0')[0];
    const prefix = string(345, 500); const name = (prefix ? prefix + '/' : '') + string(0, 100);
    const size = Number.parseInt(string(124, 136).trim(), 8);
    if (header[156] === 0 || header[156] === 48) {
      const body = bytes.subarray(offset + 512, offset + 512 + size);
      if (/^run\/(?:manifest|event-[0-9]{6}(?:\.commit)?)\.json$/.test(name)) { assertStudyMaterialPublic(body, name); files.set(name, body); }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
export function verifyVerifierReal02Materials(files: ReadonlyMap<string, Buffer>) {
  const selected = new Map<string, Buffer>();
  for (const name of VERIFIER_REAL02_MATERIAL_FILES) {
    const bytes = files.get(name); if (!bytes || bytes.length > 30_000_000) return fail();
    if (!name.endsWith('.tar.gz')) assertStudyMaterialPublic(bytes, name);
    selected.set(name, bytes);
  }
  const json = (name: string): any => JSON.parse(selected.get('VERIFIER-REAL-02/' + name)!.toString('utf8'));
  const archive = selected.get('VERIFIER-REAL-02/run-ledger.tar.gz')!;
  const inspection = inspectVerifierStudyArchive(archive, VERIFIER_REAL02_ARCHIVE_SHA256);
  if (!isDeepStrictEqual(inspection, json('archive-inspection.json')) || inspection.recordedExecutionSource !== 'real-provider' || inspection.terminalStatus !== 'completed' || inspection.runId !== '1766a3be-fbd4-4217-894f-350a68a06d66') fail();
  const members = validatedMembers(archive);
  const manifestBytes = members.get('run/manifest.json')!;
  const manifest = JSON.parse(manifestBytes.toString('utf8')).manifest;
  const events: Event[] = [...members].filter(([name]) => /^run\/event-[0-9]{6}\.json$/.test(name)).map(([, bytes]) => JSON.parse(bytes.toString('utf8'))).sort((a, b) => a.sequence - b.sequence);
  const grant = json('control/consent-consumed.json'), running = json('control/running.json'), terminal = json('control/terminal.json'), confirmed = json('control/terminal.confirmed.json');
  const controlId = '6eaf79ac-0244-48b7-b2d2-aa8bef84ea9d';
  if ([grant, running, terminal].some(value => value.version !== 'verifier-study-control-v1') || confirmed.version !== 'verifier-study-terminal-confirmation-v1' || confirmed.directorySha256 !== 'c72226af2033539315c362630d94f112e55d6675424f4e7d4ab656c4328a8de0' || grant.run?.id !== controlId || running.run?.id !== controlId || terminal.run?.id !== controlId || confirmed.runId !== controlId || grant.run.status !== 'running' || running.run.status !== 'running' || terminal.run.status !== 'completed' || !isDeepStrictEqual(grant.run, running.run) || terminal.run.bootId !== grant.run.bootId || terminal.run.frozenStudySha256 !== grant.run.frozenStudySha256 || grant.run.frozenStudySha256 !== manifest.observedPlan.frozenStudySha256 || !isDeepStrictEqual(grant.frozenPlan, manifest.observedPlan) || !isDeepStrictEqual(grant.consent, manifest.consent) || running.grantSha256 !== digest(grant) || terminal.grantSha256 !== digest(grant) || confirmed.grantSha256 !== digest(grant) || confirmed.terminalSha256 !== digest(terminal) || !isDeepStrictEqual(terminal.run.summary, events.at(-1)?.payload.summary) || Date.parse(grant.consent.approvedAt) > Date.parse(events.find(event => event.type === 'call-intent')!.time)) fail();
  const decisions = events.filter(event => event.type === 'decision-result'), oracles = events.filter(event => event.type === 'oracle-result'), calls = events.filter(event => event.type === 'call-result');
  const lastDecisionEvent = Math.max(...decisions.map(event => event.sequence));
  const firstOracleIntentEvent = events.find(event => event.type === 'oracle-intent')!.sequence;
  if (decisions.length !== 54 || oracles.length !== 36 || calls.length !== 52 || events.filter(event => event.type === 'call-intent').length !== calls.length || lastDecisionEvent >= firstOracleIntentEvent || new Set(calls.map(event => event.payload.callId)).size !== calls.length) fail();
  const pools = manifest.observedPlan.poolIds.map((poolId: string) => {
    const actual = oracles.filter(event => event.payload.poolId === poolId);
    if (actual.length !== 2 || actual.some(event => event.payload.status !== 'completed' || event.payload.result?.healthy !== true || typeof event.payload.result?.passed !== 'boolean') || new Set(actual.map(event => event.payload.candidateId)).size !== 2) fail();
    const candidates = actual.map(event => ({ id: event.payload.candidateId as string, passed: event.payload.result.passed as boolean, oracleEvent: event.sequence }));
    const choices = ['baseline', 'llm', 'jev-cascade'].map(strategy => {
      const matching = decisions.filter(event => event.payload.poolId === poolId && event.payload.strategy === strategy); if (matching.length !== 1) fail();
      const event = matching[0], selected = event.payload.selection;
      if (event.payload.status !== 'completed' || !['accept', 'abstain'].includes(event.payload.decision) || selected.decision !== event.payload.decision) fail();
      const candidate = candidates.find((item: { id: string }) => item.id === selected.selectedCandidateId);
      if (selected.decision === 'accept' ? !candidate : selected.selectedCandidateId !== null) fail();
      return { strategy, decisionEvent: event.sequence, decision: selected.decision, selectedCandidateId: selected.selectedCandidateId, selectedPassed: candidate?.passed ?? null, engine: selected.engine, fallbackKind: selected.fallbackKind, usage: usage(calls.filter(call => call.payload.decisionId === event.payload.decisionId)) };
    });
    return { poolId, candidates, hasGoodCandidate: candidates.some((item: { passed: boolean }) => item.passed), choices };
  });
  const byStrategy = ['baseline', 'llm', 'jev-cascade'].map(strategy => {
    const choices = pools.map((pool: any) => ({ ...pool.choices.find((choice: any) => choice.strategy === strategy), hasGoodCandidate: pool.hasGoodCandidate }));
    return { strategy, planned: choices.length, goodSelected: choices.filter((choice: any) => choice.selectedPassed === true).length, badAccepted: choices.filter((choice: any) => choice.selectedPassed === false).length, abstained: choices.filter((choice: any) => choice.decision === 'abstain').length, correctAllBadAbstentions: choices.filter((choice: any) => choice.decision === 'abstain' && !choice.hasGoodCandidate).length, falseAbstentions: choices.filter((choice: any) => choice.decision === 'abstain' && choice.hasGoodCandidate).length, ...usage(calls.filter(call => call.payload.strategy === strategy)) };
  });
  const b = byStrategy[1], c = byStrategy[2], costDeltaUsd = rounded(c.estimatedCostUsd - b.estimatedCostUsd);
  const goodSelectedNotBelowB = c.goodSelected >= b.goodSelected, badAcceptedNotAboveB = c.badAccepted <= b.badAccepted, costBelowB = c.estimatedCostUsd < b.estimatedCostUsd;
  const derived = { version: 'verifier-real02-derived-metrics-v1', evidenceSource: 'retained call-result/decision-result and actual oracle-result events; no static labels substituted', sourceCommit: inspection.sourceCommit, sourceFiles: Object.keys(manifest.observedPlan.source.hashes).length, controlRunId: controlId, nativeRunId: inspection.runId, frozenStudySha256: manifest.observedPlan.frozenStudySha256, manifestBytesSha256: sha(manifestBytes), durationMs: terminal.run.summary.durationMs, events: events.length, blindDecisionCount: decisions.length, lastDecisionEvent, firstOracleIntentEvent, oracleCandidateCount: oracles.length, goodCandidates: oracles.filter(event => event.payload.result.passed).length, badCandidates: oracles.filter(event => !event.payload.result.passed).length, allBadPoolCount: pools.filter((pool: any) => !pool.hasGoodCandidate).length, hasGoodPoolCount: pools.filter((pool: any) => pool.hasGoodCandidate).length, byStrategy, cascadeJev: usage(calls.filter(event => event.payload.strategy === 'jev-cascade' && event.payload.kind === 'jev')), cascadeUpgradedLlm: usage(calls.filter(event => event.payload.strategy === 'jev-cascade' && event.payload.kind === 'llm')), totals: usage(calls), billing: { basis: 'declared non-cache conservative prices; not provider bill', actualProviderBill: null, unknownCalls: 0 }, valueVerdict: { goodSelectedNotBelowB, badAcceptedNotAboveB, costBelowB, highValue: goodSelectedNotBelowB && badAcceptedNotAboveB && costBelowB, costDeltaUsd, costDeltaPercent: costDeltaUsd / b.estimatedCostUsd * 100 }, pools };
  const recorded = json('metrics.json');
  // Percentages in the archived report came from unrounded IEEE sums. Preserve
  // original bytes, accepting only sub-picopercent arithmetic presentation noise.
  if (!Number.isFinite(recorded.valueVerdict?.costDeltaPercent) || Math.abs(recorded.valueVerdict.costDeltaPercent - derived.valueVerdict.costDeltaPercent) > 1e-12 || !isDeepStrictEqual(derived, { ...recorded, valueVerdict: { ...recorded.valueVerdict, costDeltaPercent: derived.valueVerdict.costDeltaPercent } })) fail();
  const cascade = decisions.filter(event => event.payload.strategy === 'jev-cascade');
  const recordedPolicies = [...new Set(calls.filter(event => event.payload.kind === 'jev').map(event => event.payload.responseSnapshot?.policyVersion))];
  if (recordedPolicies.length !== 1 || recordedPolicies[0] !== 'jev-candidate-v3') fail();
  return { ...derived, archiveSha256: inspection.archiveSha256, integrityAuthenticity: inspection.authenticity, arithmeticDriftUpgrades: cascade.filter(event => event.payload.selection.fallbackKind === 'arithmetic-drift').length, uncertainUpgrades: cascade.filter(event => event.payload.selection.engine === 'jev-llm-fallback').length, recordedJevPolicy: recordedPolicies[0] as 'jev-candidate-v3', currentPolicyExperimented: false as const };
}
export type VerifierStudyMaterialSummary = ReturnType<typeof verifyVerifierReal02Materials>;
