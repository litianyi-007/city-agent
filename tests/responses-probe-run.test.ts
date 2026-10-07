import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { encodeAnswerContract } from '../shared/answer-contract';
import { fingerprint } from '../shared/evidence';
import { createResponsesProbeCases, RESPONSES_PROBE_MODEL, RESPONSES_PROBE_SCOPE, type ResponsesProbeCase } from '../shared/responses-probe-plan';
import { createExperimentBudget } from '../server/research/experiment-budget';
import { PROBE_AUTHORIZATION_ID, PROBE_CREDENTIAL_STORE, PROBE_PREDECESSOR, PROBE_PRICING_URL, PROBE_SEALED_PRIOR_TRIAL, PROBE_SEALED_PHASE_TRIAL,
  validateProbeApproval, validateProbeRegistration, validateProbeSealedTrialEvidence, validateProbeSealedPhaseTrialEvidence,
  verifyProbePredecessor, verifyProbePricingHtml, verifyProbeSealedPriorTrial, verifyProbeSealedPhaseTrial } from '../server/research/responses-probe-registration';
import { createProbeRecorder, runResponsesProbe, type ProbeSlot } from '../server/research/responses-probe-run';

const html = '<table><tr><th>模型</th><th>deepseek-flash (1)</th><th>deepseek-v4-pro</th></tr><tr><td>百万tokens输入 （缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr><tr><td>高峰时段</td><td>2元</td><td>9.0元</td></tr><tr><td>百万tokens输出</td><td>空闲时段</td><td>4元</td><td>13.5元</td></tr><tr><td>高峰时段</td><td>8元</td><td>27.0元</td></tr></table>';
function plan() {
  const cases = createResponsesProbeCases(), sourceFiles = [{ name: 'synthetic-source', sha256: '0'.repeat(64) }];
  return validateProbeRegistration({ version: 'responses-probe-registration-1.3', id: randomUUID(), authorizationId: PROBE_AUTHORIZATION_ID,
    credentialStore: PROBE_CREDENTIAL_STORE, predecessor: PROBE_PREDECESSOR, sealedPriorTrial: PROBE_SEALED_PRIOR_TRIAL, sealedPhaseTrial: PROBE_SEALED_PHASE_TRIAL,
    registeredAt: new Date().toISOString(), scope: RESPONSES_PROBE_SCOPE, model: RESPONSES_PROBE_MODEL, cases, casesHash: fingerprint(cases),
    sourceHead: '0'.repeat(40), sourceFiles, sourceHash: fingerprint(sourceFiles), pricing: verifyProbePricingHtml(html, new Date().toISOString()),
    historicalHash: '0'.repeat(64), historicalCount: 42,
    reservationCeilingCny: cases.reduce((sum, probe) => sum + ((probe.frozenRequest.bodyUtf8Bytes + 1024) * 2 + 3000 * 8) / 1_000_000, 0),
    notice: '2 fixed synthetic knowledge-boundary slots; not a preference cohort, market validation, or provider keyword-enforcement proof' });
}
function raw(probe: ResponsesProbeCase) {
  const known = new Map(probe.knowledgeBoundary.knownAnswers.map(answer => [answer.questionId, answer.value]));
  return encodeAnswerContract(probe.profile.id, probe.task.questionnaire.questions.map(question => ({ questionId: question.id,
    value: known.get(question.id) ?? (!question.required ? null : question.type === 'multiple' ? ['unknown'] : 'unknown') })));
}
function sse(text: string, usage: unknown = { input_tokens: 17, output_tokens: 9, total_tokens: 26 }) {
  const part = { type: 'output_text', text, annotations: [] }, item = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [part] };
  const response = { id: 'resp_fixture', object: 'response', model: 'deepseek-flash', status: 'completed', output: [item], usage, error: null, incomplete_details: null };
  const packets = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [], usage: null } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text },
    { type: 'response.content_part.done', item_id: item.id, output_index: 0, content_index: 0, part },
    { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
  return packets.map((packet, sequence_number) => `event: ${packet.type}\ndata: ${JSON.stringify({ ...packet, sequence_number })}\n\n`).join('');
}
function fixture(transform: (probe: ResponsesProbeCase, index: number) => { body: string; status?: number; mime?: string } = probe => ({ body: sse(raw(probe)) })) {
  const registration = plan(), directory = mkdtempSync(path.join(os.tmpdir(), 'city-live-probe-offline-'));
  const guard = createExperimentBudget({ ledgerPath: path.join(directory, 'ledger.json'), experimentId: 'synthetic-two-call-capability', budgetCny: 1, maxProviderRequests: 2,
    pricing: { provider: 'deepseek', modelId: 'deepseek-flash', currency: 'CNY', inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8,
      sourceUrl: PROBE_PRICING_URL, checkedAt: registration.pricing.checkedAt } });
  let calls = 0; const checkpoints: ProbeSlot[][] = [], originals: Buffer[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const index = calls++; assert.equal(String(url), 'https://api.deepseek.com/v1/responses');
    assert.equal(init?.body, registration.cases[index].frozenRequest.body); assert.equal(init?.redirect, 'error');
    const output = transform(registration.cases[index], index);
    return new Response(output.body, { status: output.status ?? 200, headers: { 'content-type': output.mime ?? 'text/event-stream' } });
  };
  const input = { plan: registration, guard, model: { ...RESPONSES_PROBE_MODEL, apiKey: 'synthetic-live-probe-canary' }, signal: new AbortController().signal,
    assertSources: async () => {}, fetchImpl,
    checkpoint: async (slots: ProbeSlot[], original?: { id: ProbeSlot['id']; bytes: Buffer }) => { checkpoints.push(slots); if (original) originals.push(original.bytes); } };
  return { input, checkpoints, originals, calls: () => calls, close() { guard.close(); rmSync(directory, { recursive: true, force: true }); } };
}

// Entirely synthetic metadata, not a copy of private provider text or a billable run.
function sealedTrialFixture() {
  const ledger = { schemaVersion: 'experiment-budget-1.0', experimentId: PROBE_SEALED_PRIOR_TRIAL.authorizationId,
    state: 'halted', storageStatus: 'durable', requestCount: 1, maxProviderRequests: 2, budgetCny: 1,
    committedNanoCny: 64_650_000, committedCny: 0.06465, knownUsageCostCny: 0, knownUsageRequestCount: 0,
    usageStatus: 'incomplete', stopReason: 'request-failed',
    reservations: [{ requestId: 'capability.child-snacks.001', state: 'uncertain', outcome: 'failed',
      reservationNanoCny: 64_650_000, committedNanoCny: 64_650_000 }] };
  const report = { version: 'responses-live-capability-report-1.0', authorizationId: PROBE_SEALED_PRIOR_TRIAL.authorizationId,
    experimentId: PROBE_SEALED_PRIOR_TRIAL.experimentId, status: 'stopped', executionError: false,
    journalClosureAttempted: true, journalClosureSucceeded: true, ledgerFinalized: true, providerDispatches: 1,
    result: { version: 'responses-probe-run-1.0', status: 'stopped', planned: 2, passed: 0, failed: 1, notStarted: 1,
      slots: [{ id: 'child-snacks', status: 'failed', failureCode: 'RESPONSES_SDK_NON_COMPLETION',
        recorder: { attempts: 1, forwarded: 1, state: 'eof-complete', receivedBytes: 45_699, retainedBytes: 45_699,
          completeSha256: PROBE_SEALED_PRIOR_TRIAL.providerOriginalSha256, overflow: false, cleanupFailed: false, unsafeReason: null } },
      { id: 'pet-snacks', status: 'not-started', recorder: null }] },
    predecessor: PROBE_PREDECESSOR,
    aggregateAuthorization: { budgetCny: 1, maxProviderRequests: 2, priorProviderDispatches: 0, cumulativeProviderDispatches: 1 },
    inputTokens: null, outputTokens: null, tokenCoverage: 'incomplete', conservativeKnownUsageCostCny: 0,
    committedOrReservedCny: 0.06465, ledger };
  return { report, ledger: structuredClone(ledger), runLedger: structuredClone(ledger) };
}

function sealedPhaseTrialFixture() {
  const entry = (requestId: string, inputTokens: number, outputTokens: number, reserved: number, committed: number) => ({ requestId,
    state: 'settled', outcome: 'succeeded', usage: { inputTokens, outputTokens }, reservationNanoCny: reserved, committedNanoCny: committed, actualNanoCny: committed });
  const ledger = { schemaVersion: 'experiment-budget-1.0', experimentId: PROBE_SEALED_PHASE_TRIAL.authorizationId,
    state: 'halted', storageStatus: 'durable', requestCount: 2, maxProviderRequests: 2, budgetCny: 1,
    committedNanoCny: 21_658_000, committedCny: 0.021658, knownUsageCostCny: 0.021658, knownUsageRequestCount: 2,
    usageStatus: 'reported', stopReason: 'probe-first-failure', reservations: [entry('capability.child-snacks.001', 4753, 140, 64_650_000, 10_626_000),
      entry('capability.pet-snacks.001', 4924, 148, 65_836_000, 11_032_000)] };
  const recorder = (bytes: number, sha256: string) => ({ attempts: 1, forwarded: 1, state: 'eof-complete', receivedBytes: bytes,
    retainedBytes: bytes, completeSha256: sha256, overflow: false, cleanupFailed: false, unsafeReason: null });
  const report = { version: 'responses-live-capability-report-1.0', authorizationId: PROBE_SEALED_PHASE_TRIAL.authorizationId,
    experimentId: PROBE_SEALED_PHASE_TRIAL.experimentId, status: 'stopped', executionError: false,
    journalClosureAttempted: true, journalClosureSucceeded: true, ledgerFinalized: true, providerDispatches: 2,
    result: { version: 'responses-probe-run-1.0', status: 'stopped', planned: 2, passed: 1, failed: 1, notStarted: 0, stopReason: 'probe-quality-rejected',
      slots: [{ id: 'child-snacks', status: 'passed', failureCode: null,
        recorder: recorder(PROBE_SEALED_PHASE_TRIAL.childProviderOriginalBytes, PROBE_SEALED_PHASE_TRIAL.childProviderOriginalSha256) },
      { id: 'pet-snacks', status: 'failed', failureCode: 'probe-quality-rejected',
        recorder: recorder(PROBE_SEALED_PHASE_TRIAL.petProviderOriginalBytes, PROBE_SEALED_PHASE_TRIAL.petProviderOriginalSha256) }] },
    predecessor: PROBE_PREDECESSOR, sealedPriorTrial: PROBE_SEALED_PRIOR_TRIAL,
    independentAuthorization: { budgetCny: 1, maxProviderRequests: 2, currentGrantProviderDispatches: 2,
      priorSealedGrantProviderDispatches: 1, priorReservationCanFundThisGrant: false },
    inputTokens: 9677, outputTokens: 288, tokenCoverage: 'reported', conservativeKnownUsageCostCny: 0.021658,
    committedOrReservedCny: 0.021658, ledger };
  return { report, ledger: structuredClone(ledger), runLedger: structuredClone(ledger) };
}

test('new approval binds exact fixed two-case plan/scope/source/pricing and expires without widening', () => {
  const registration = plan(), approval = { version: 'responses-probe-approval-1.0', authorizationId: PROBE_AUTHORIZATION_ID, status: 'approved',
    approvedAt: new Date().toISOString(), confirmationReference: 'synthetic-only', scope: RESPONSES_PROBE_SCOPE, credentialStore: PROBE_CREDENTIAL_STORE };
  const binding = { version: 'responses-probe-binding-1.0', authorizationId: PROBE_AUTHORIZATION_ID, approvalHash: fingerprint(approval),
    planHash: fingerprint(registration), boundAt: new Date().toISOString() };
  assert.deepEqual(validateProbeApproval(registration, approval, binding), registration);
  for (const mutation of [(value: any) => { value.scope.budgetCny = 2; }, (value: any) => { value.cases.reverse(); },
    (value: any) => { value.cases[0].system += 'drift'; }, (value: any) => { value.pricing.inputPerMillion = 1; },
    (value: any) => { value.sourceFiles[0].sha256 = '1'.repeat(64); }, (value: any) => { value.credentialStore += '-other'; },
    (value: any) => { value.predecessor.providerRequests = 1; }, (value: any) => { value.predecessor.reportSha256 = '0'.repeat(64); },
    (value: any) => { value.sealedPriorTrial.providerRequests = 0; }, (value: any) => { value.sealedPriorTrial.reportSha256 = '0'.repeat(64); },
    (value: any) => { value.sealedPriorTrial.ledgerSha256 = '0'.repeat(64); }, (value: any) => { value.sealedPriorTrial.providerOriginalBytes = 0; },
    (value: any) => { value.sealedPriorTrial.previousReservationCanFundThisGrant = true; },
    (value: any) => { value.sealedPhaseTrial.providerRequests = 0; }, (value: any) => { value.sealedPhaseTrial.reportSha256 = '0'.repeat(64); },
    (value: any) => { value.sealedPhaseTrial.ledgerSha256 = '0'.repeat(64); }, (value: any) => { value.sealedPhaseTrial.petProviderOriginalSha256 = '0'.repeat(64); },
    (value: any) => { value.sealedPhaseTrial.previousReservationCanFundThisGrant = true; },
    (value: any) => { value.scope.maxProviderRequests = 20; }, (value: any) => { value.unregisteredScope = true; }]) {
    const changed = structuredClone(registration); mutation(changed); assert.throws(() => validateProbeApproval(changed, approval, binding));
  }
  assert.throws(() => validateProbeApproval(registration, { ...approval, status: 'pending' }, binding));
  assert.throws(() => validateProbeApproval(registration, { ...approval, credentialStore: '/other' }, binding));
  assert.throws(() => validateProbeApproval(registration, approval, { ...binding, planHash: '0'.repeat(64) }));
  assert.throws(() => validateProbeApproval(registration, approval, binding, Date.now() + 3 * 60 * 60 * 1000));
});

test('knowledge 1.1 registration is a new independent fixed grant, with immutable zero-call and two sealed trials', () => {
  const registration = plan();
  assert.equal(PROBE_AUTHORIZATION_ID, 'approved-2026-10-08-responses-knowledge11-cny1-2');
  assert.equal(registration.version, 'responses-probe-registration-1.3');
  assert.equal(registration.scope.budgetCny, 1); assert.equal(registration.scope.maxProviderRequests, 2);
  assert.equal(registration.sealedPriorTrial.providerRequests, 1);
  assert.equal(registration.sealedPriorTrial.previousReservationCanFundThisGrant, false);
  assert.equal(registration.sealedPhaseTrial.providerRequests, 2);
  assert.equal(registration.sealedPhaseTrial.previousReservationCanFundThisGrant, false);
  assert.deepEqual(registration.predecessor, PROBE_PREDECESSOR);
  assert.throws(() => validateProbeRegistration({ ...registration, version: 'responses-probe-registration-1.1' }));
  assert.throws(() => validateProbeRegistration({ ...registration, version: 'responses-probe-registration-1.2' }));
});

test('sealed phase trial preserves reported usage and transport settlement separately from its failed quality gate', () => {
  const input = sealedPhaseTrialFixture(), before = fingerprint(input);
  assert.deepEqual(validateProbeSealedPhaseTrialEvidence(input), PROBE_SEALED_PHASE_TRIAL);
  assert.equal(fingerprint(input), before);
  for (const mutation of [(value: any) => { value.report.authorizationId = PROBE_AUTHORIZATION_ID; },
    (value: any) => { value.report.experimentId = randomUUID(); }, (value: any) => { value.report.ledgerFinalized = false; },
    (value: any) => { value.report.journalClosureSucceeded = false; }, (value: any) => { value.report.providerDispatches = 1; },
    (value: any) => { value.report.result.slots[0].status = 'failed'; }, (value: any) => { value.report.result.slots[1].status = 'passed'; },
    (value: any) => { value.report.result.slots[1].recorder.completeSha256 = '0'.repeat(64); },
    (value: any) => { value.report.result.slots[0].recorder.retainedBytes = 1; },
    (value: any) => { value.ledger.state = 'active'; }, (value: any) => { value.ledger.storageStatus = 'uncertain'; },
    (value: any) => { value.ledger.requestCount = 1; }, (value: any) => { value.ledger.usageStatus = 'incomplete'; },
    (value: any) => { value.ledger.reservations[1].usage.inputTokens = 1; },
    (value: any) => { value.ledger.reservations[1].outcome = 'failed'; },
    (value: any) => { value.ledger.committedCny = 0; }, (value: any) => { value.runLedger.committedNanoCny = 0; },
    (value: any) => { value.report.ledger.state = 'closed'; }, (value: any) => { value.report.sealedPriorTrial.providerRequests = 0; },
    (value: any) => { value.report.independentAuthorization.priorReservationCanFundThisGrant = true; },
    (value: any) => { value.report.inputTokens = 0; }]) {
    const changed = structuredClone(input); mutation(changed); assert.throws(() => validateProbeSealedPhaseTrialEvidence(changed));
  }
});

test('sealed phase files reject missing artifacts, locks, symlinks and changed bytes using only synthetic temp files', async () => {
  const names = ['report.json', 'budget-ledger.json', 'child-snacks.provider-original.txt', 'pet-snacks.provider-original.txt', 'authorization-ledger'];
  for (const failure of [...names.map(name => `missing:${name}`), ...names.map(name => `link:${name}`), 'locked', 'run-copy-locked', 'changed-bytes']) {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'city-probe-sealed-phase-'));
    try {
      const run = path.join(root, 'output/live-capability-proof', PROBE_SEALED_PHASE_TRIAL.experimentId);
      const auth = path.join(root, 'output/live-evaluation-authorizations', PROBE_SEALED_PHASE_TRIAL.authorizationId);
      mkdirSync(run, { recursive: true }); mkdirSync(auth, { recursive: true });
      for (const name of names) {
        const filename = name === 'authorization-ledger' ? path.join(auth, 'budget-ledger.json') : path.join(run, name);
        if (failure === `missing:${name}`) continue;
        if (failure === `link:${name}`) {
          const target = filename + '.synthetic-target'; writeFileSync(target, '{}'); symlinkSync(target, filename);
        } else writeFileSync(filename, '{}');
      }
      if (failure === 'locked') writeFileSync(path.join(auth, 'budget-ledger.json.lock'), 'synthetic-only');
      if (failure === 'run-copy-locked') writeFileSync(path.join(run, 'budget-ledger.json.lock'), 'synthetic-only');
      await assert.rejects(verifyProbeSealedPhaseTrial(root), /ENOENT|Sealed phase/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('sealed prior trial metadata remains halted and unknown; copies match without settling or crediting its reserve', () => {
  const input = sealedTrialFixture(), before = fingerprint(input);
  assert.deepEqual(validateProbeSealedTrialEvidence(input), PROBE_SEALED_PRIOR_TRIAL);
  assert.equal(fingerprint(input), before);
  for (const mutation of [(value: any) => { value.report.authorizationId = PROBE_AUTHORIZATION_ID; },
    (value: any) => { value.report.experimentId = randomUUID(); }, (value: any) => { value.report.ledgerFinalized = false; },
    (value: any) => { value.report.journalClosureSucceeded = false; }, (value: any) => { value.report.providerDispatches = 0; },
    (value: any) => { value.report.result.slots[0].status = 'passed'; }, (value: any) => { value.report.result.slots[1].status = 'passed'; },
    (value: any) => { value.report.result.slots[0].recorder.completeSha256 = '0'.repeat(64); },
    (value: any) => { value.report.result.slots[0].recorder.retainedBytes = 1; },
    (value: any) => { value.ledger.state = 'active'; }, (value: any) => { value.ledger.storageStatus = 'uncertain'; },
    (value: any) => { value.ledger.requestCount = 0; }, (value: any) => { value.ledger.usageStatus = 'reported'; },
    (value: any) => { value.ledger.reservations[0].usage = { inputTokens: 1, outputTokens: 1 }; },
    (value: any) => { value.ledger.committedCny = 0; }, (value: any) => { value.runLedger.committedNanoCny = 0; },
    (value: any) => { value.report.ledger.state = 'closed'; }, (value: any) => { value.report.predecessor.providerRequests = 1; }]) {
    const changed = structuredClone(input); mutation(changed); assert.throws(() => validateProbeSealedTrialEvidence(changed));
  }
});

test('sealed prior files reject missing artifacts, lock, symlink and changed bytes using only synthetic temp files', async () => {
  const names = ['report.json', 'budget-ledger.json', 'child-snacks.provider-original.txt', 'authorization-ledger'];
  for (const failure of [...names.map(name => `missing:${name}`), ...names.map(name => `link:${name}`), 'locked', 'changed-bytes']) {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'city-probe-sealed-history-'));
    try {
      const run = path.join(root, 'output/live-capability-proof', PROBE_SEALED_PRIOR_TRIAL.experimentId);
      const auth = path.join(root, 'output/live-evaluation-authorizations', PROBE_SEALED_PRIOR_TRIAL.authorizationId);
      mkdirSync(run, { recursive: true }); mkdirSync(auth, { recursive: true });
      for (const name of names) {
        const filename = name === 'authorization-ledger' ? path.join(auth, 'budget-ledger.json') : path.join(run, name);
        if (failure === `missing:${name}`) continue;
        if (failure === `link:${name}`) {
          const target = filename + '.synthetic-target'; writeFileSync(target, '{}'); symlinkSync(target, filename);
        } else writeFileSync(filename, '{}');
      }
      if (failure === 'locked') writeFileSync(path.join(auth, 'budget-ledger.json.lock'), 'synthetic-only');
      await assert.rejects(verifyProbeSealedPriorTrial(root), /ENOENT|Sealed prior/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('pricing parser binds actual model-column high-peak 2/8, rejects changed/reordered/oversized sources', () => {
  assert.equal(verifyProbePricingHtml(html, new Date().toISOString()).inputPerMillion, 2);
  for (const changed of [html.replace('2元', '3元'), html.replace('8元', '9元'), html.replace('deepseek-flash (1)', 'deepseek-v4-pro'), 'x'.repeat(512_001)])
    assert.throws(() => verifyProbePricingHtml(changed, new Date().toISOString()));
});

test('predecessor journal/lock or changed observation rejects a new allowance before any provider call', async () => {
  for (const marker of ['budget-ledger.json', 'budget-ledger.json.lock', 'changed-observation']) {
    const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'city-probe-predecessor-'));
    try {
      const prior = path.join(root, 'output/live-evaluation-authorizations', PROBE_PREDECESSOR.authorizationId);
      mkdirSync(prior, { recursive: true });
      if (marker !== 'changed-observation') writeFileSync(path.join(prior, marker), 'synthetic-only');
      else {
        const observation = path.join(root, 'output/live-capability-proof', PROBE_PREDECESSOR.experimentId);
        mkdirSync(observation, { recursive: true }); writeFileSync(path.join(observation, 'pre-dispatch-report.json'), '{"providerRequests":0}');
      }
      await assert.rejects(verifyProbePredecessor(root), /Predecessor|observation changed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('two actual Harness children are sequentially admitted only after checkpoint/independent audits', { timeout: 45_000 }, async () => {
  const f = fixture();
  try {
    const result = await runResponsesProbe(f.input); assert.equal(result.status, 'passed'); assert.equal(result.passed, 2); assert.equal(result.notStarted, 0);
    assert.equal(f.calls(), 2); assert.equal(f.originals.length, 2); assert.deepEqual(f.checkpoints[0].map(slot => slot.status), ['not-started', 'not-started']);
    assert.ok(f.checkpoints.some(slots => slots[0].status === 'passed' && slots[1].status === 'not-started'));
    for (const slot of result.slots) { assert.equal(slot.httpAccepted, true); assert.equal(slot.protocolCompleted, true); assert.equal(slot.keywordExecution, 'unknown');
      assert.equal(slot.evaluation!.content!.status, 'information-insufficient'); assert.equal(slot.recorder!.state, 'eof-complete'); assert.equal(slot.recorder!.cleanupFailed, false); }
    assert.equal(f.input.guard.snapshot().requestCount, 2); assert.equal(f.input.guard.snapshot().knownUsageRequestCount, 2);
  } finally { f.close(); }
});

for (const failure of ['structure', 'unknown-input', 'qualification', 'missing-usage', 'http-error', 'unexpected-2xx', 'secret-echo'] as const) {
  test(`first ${failure} stops all and preserves original/unknown/not-started evidence without retry`, { timeout: 45_000 }, async () => {
    const f = fixture(probe => {
      const answer = JSON.parse(raw(probe));
      if (failure === 'structure') delete answer.answers['child-own-taste'];
      if (failure === 'unknown-input') answer.answers['monthly-budget'] = 0;
      if (failure === 'qualification') answer.answers.eligibility = 'ineligible';
      if (failure === 'secret-echo') answer.answers['needed-evidence'] = 'synthetic-live-probe-canary';
      return failure === 'http-error' ? { body: '{"error":"synthetic schema rejection"}', status: 400, mime: 'application/json' }
        : { body: sse(JSON.stringify(answer), failure === 'missing-usage' ? null : undefined), status: failure === 'unexpected-2xx' ? 201 : 200 };
    });
    try {
      const result = await runResponsesProbe(f.input); assert.equal(result.status, 'stopped'); assert.equal(result.failed, 1); assert.equal(result.notStarted, 1);
      assert.equal(f.calls(), 1); assert.equal(f.input.guard.snapshot().requestCount, 1); assert.equal(f.input.guard.snapshot().state, 'halted');
      assert.equal(result.slots[1].status, 'not-started'); assert.equal(result.slots[1].durationMs, null);
      assert.equal(f.originals.length, failure === 'secret-echo' ? 0 : 1);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-live-probe-canary/);
      if (failure === 'structure') { assert.ok(result.slots[0].evaluation); assert.equal(result.slots[0].evaluation!.structure.status, 'conflict');
        assert.equal(result.slots[0].protocolCompleted, true); assert.ok(result.slots[0].evaluation!.nativeRaw.includes('"answers"')); }
      if (failure === 'unknown-input' || failure === 'qualification') assert.equal(f.input.guard.snapshot().knownUsageRequestCount, 1);
      if (failure === 'missing-usage') assert.equal(f.input.guard.snapshot().usageStatus, 'incomplete');
      if (failure === 'unexpected-2xx') { assert.equal(result.slots[0].httpAccepted, false); assert.equal(result.slots[0].failureCode, 'probe-http-not-accepted'); }
      assert.equal(result.slots[0].recorder?.providerMediaType, failure === 'http-error' ? 'application/json' : 'text/event-stream');
    } finally { f.close(); }
  });
}

test('pre-cancel, source drift or initial checkpoint failure causes zero provider calls', async () => {
  for (const failure of ['cancel', 'source', 'checkpoint']) {
    const f = fixture();
    try {
      if (failure === 'cancel') { const controller = new AbortController(); controller.abort('private-reason-not-exported'); f.input.signal = controller.signal; }
      if (failure === 'source') f.input.assertSources = async () => { throw new Error('private-source-failure'); };
      if (failure === 'checkpoint') f.input.checkpoint = async () => { throw new Error('private-storage-failure'); };
      const result = await runResponsesProbe(f.input); assert.equal(result.status, 'stopped'); assert.equal(result.notStarted, 2); assert.equal(f.calls(), 0);
      assert.equal(f.input.guard.snapshot().requestCount, 0); assert.doesNotMatch(JSON.stringify(result), /private-(?:reason|source|storage)/);
    } finally { f.close(); }
  }
});

test('first completed slot cannot start second when artifact persistence or inter-request source seal fails', { timeout: 45_000 }, async () => {
  for (const failure of ['checkpoint', 'source']) {
    const f = fixture(); let checks = 0;
    try {
      if (failure === 'checkpoint') f.input.checkpoint = async (_slots, original) => { if (original) throw new Error('private-storage'); };
      else f.input.assertSources = async () => { if (++checks > 1) throw new Error('private-source'); };
      const result = await runResponsesProbe(f.input); assert.equal(result.status, 'stopped'); assert.equal(f.calls(), 1);
      assert.equal(result.slots[1].status, 'not-started'); assert.equal(f.input.guard.snapshot().state, 'halted');
    } finally { f.close(); }
  }
});

test('host recorder has one exact dispatch, bounds raw bytes and never exports partial/secret originals', async () => {
  const probe = createResponsesProbeCases()[0], key = 'synthetic-host-recorder-key'; let calls = 0;
  const make = (body: string) => createProbeRecorder(probe, key, async () => { calls++; return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); });
  const request = { method: 'POST', redirect: 'error' as const, body: probe.frozenRequest.body,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: new AbortController().signal };
  const bad = make('unused'); await assert.rejects(bad.fetcher('https://example.invalid', request));
  await assert.rejects(bad.fetcher('https://api.deepseek.com/v1/responses', request)); assert.equal(calls, 0);
  for (const body of [key, 'x'.repeat(512_001)]) {
    const recorder = make(body), response = await recorder.fetcher('https://api.deepseek.com/v1/responses', request);
    await response.text().catch(() => {}); await recorder.finish(); const captured = recorder.snapshot(); assert.equal(captured.rawBytes, null);
    assert.equal(captured.completeSha256 !== null, body === key); assert.equal(captured.overflow, body !== key); assert.ok(captured.retainedBytes <= 512_000);
  }
});

test('recorder finish aborts a pending header fetch, awaits late-body cancellation and never accepts its late metadata', async () => {
  const probe = createResponsesProbeCases()[0], key = 'synthetic-late-recorder-key'; let cancelled = 0;
  let release!: (value: Response) => void; let signal: AbortSignal | undefined;
  const recorder = createProbeRecorder(probe, key, async (_url, init) => {
    signal = init!.signal!;
    return await new Promise<Response>(resolve => { release = resolve; });
  });
  const request = recorder.fetcher('https://api.deepseek.com/v1/responses', { method: 'POST', redirect: 'error', body: probe.frozenRequest.body,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: new AbortController().signal });
  const rejected = assert.rejects(request);
  const closing = recorder.finish(); assert.equal(signal!.aborted, true);
  release(new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  await closing; await rejected;
  const result = recorder.snapshot(); assert.equal(cancelled, 1); assert.equal(result.providerStatus, null);
  assert.equal(result.state, 'partial-or-no-body'); assert.equal(result.rawBytes, null); assert.equal(result.cleanupFailed, false);
  await assert.rejects(recorder.fetcher('https://api.deepseek.com/v1/responses', { method: 'POST' }));
});

test('cancelling a pending body read never promotes a received prefix to actual upstream EOF', async () => {
  const probe = createResponsesProbeCases()[0], key = 'synthetic-pending-body-key', prefix = Buffer.from('data: partial-unclosed-stream\n'); let cancelled = 0;
  const recorder = createProbeRecorder(probe, key, async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(prefix); }, cancel() { cancelled++; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  const response = await recorder.fetcher('https://api.deepseek.com/v1/responses', { method: 'POST', redirect: 'error', body: probe.frozenRequest.body,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: new AbortController().signal });
  const reader = response.body!.getReader(); assert.deepEqual((await reader.read()).value, prefix);
  const pending = reader.read(), rejected = assert.rejects(pending);
  await recorder.finish(); await rejected;
  const snapshot = recorder.snapshot(); assert.equal(cancelled, 1); assert.equal(snapshot.state, 'partial-or-no-body');
  assert.equal(snapshot.completeSha256, null); assert.equal(snapshot.rawBytes, null); assert.equal(snapshot.cleanupFailed, false);
  assert.equal(snapshot.receivedPrefixSha256, createHash('sha256').update(prefix).digest('hex'));
  assert.equal(snapshot.retainedBytes, prefix.length);
});

test('live CLI cannot broaden authority with budget/endpoint/model/count/key or missing explicit mode', () => {
  for (const args of [[], ['--execute', '--budget-cny=100'], ['--execute', '--model=other'], ['--preflight', '--credential-store=unused'],
    ['--execute', '--count=20'], ['--execute', '--api-key=synthetic'], ['--execute', '--endpoint=https://example.invalid'], ['--execute', '--execute'],
    ['--execute', '--credential-store=/other']]) {
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/run-live-responses-probe.ts', ...args],
      { env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' }, encoding: 'utf8', stdio: 'pipe' }), error => {
        const rejected = error as { stdout?: string; stderr?: string }; assert.equal(rejected.stdout, '');
        assert.match(rejected.stderr ?? '', /no automatic retry/); assert.doesNotMatch(rejected.stderr ?? '', /synthetic|example.invalid/); return true;
      });
  }
});
