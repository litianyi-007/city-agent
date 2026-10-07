import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VERIFIER_CHALLENGE_IDS } from '../shared/production-verifier-challenge-corpus.js';
import { jevConfigSchema, type JevCandidateContext } from '../shared/jev-schema.js';
import { buildJevCandidateRequest, evaluateJevCandidates } from '../server/production/jev.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { VerifierStudyLedger } from '../server/production/verifier-study-ledger.js';
import { runInjectedVerifierStudy, runStudyChromiumOracle, type InjectedStudyOptions, type InjectedStudyPorts, type StudyBudget } from '../server/production/verifier-study.js';

const directory = () => join(mkdtempSync(join(realpathSync(tmpdir()), 'verifier-study-runner-')), 'run');
const budget: StudyBudget = { maxCalls: 54, maxInputTokens: 1_080_000, maxOutputTokens: 54_000, maxEstimatedCost: 54, currency: 'USD',
  maxDurationMs: 30_000, callTimeoutMs: 1000, oracleTimeoutMs: 20_000, perCallInputTokens: 20_000, perCallOutputTokens: 1000, perCallEstimatedCost: 1 };
const usage = { inputTokens: 101, outputTokens: 7, estimatedCost: 0.01, currency: 'USD' as const, complete: true };
const llmDecision = (logical: { userPrompt: string }) => {
  const candidates = JSON.parse(logical.userPrompt).candidates as Array<{ id: string }>;
  return JSON.stringify({ decision: 'accept', selectedCandidateId: candidates[0].id,
    scores: candidates.map(candidate => ({ candidateId: candidate.id, score: 3, reason: 'Injected first-choice policy, not model quality' })), reason: 'Injected fixture only' });
};
const jevConfig = { ...jevConfigSchema.parse({ enabled: true }), apiKey: 'study-runner-fixture-not-a-real-credential' };
const uncertainWire = (context: JevCandidateContext) => {
  const request = buildJevCandidateRequest(jevConfig.modelId, context); const answers: Record<string, unknown> = {};
  context.candidates.forEach((_candidate, index) => {
    for (const dimension of ['coverage', 'consistency', 'scope']) {
      const name = `c${index}_${dimension}`;
      answers[name] = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
        legend: Object.fromEntries((request.questions[name].criteria as string[]).map((label, level) => [String(level), label])) };
    }
    answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
  });
  answers.best = { type: 'choice', choice: 'abstain', confidence: 1, probabilities: { ...Object.fromEntries(context.candidates.map(candidate => [candidate.id, 0])), abstain: 1 } };
  return { model: jevConfig.modelId, answers, usage: { input_tokens: 101, output_tokens: 7 } };
};
const ports = (): InjectedStudyPorts => ({
  llm: async logical => ({ text: llmDecision(logical), usage }),
  jev: async (context, signal) => evaluateJevCandidates(jevConfig, context, signal, { fetch: async () => new Response(JSON.stringify(uncertainWire(context)), { status: 200 }) }),
  oracle: async () => ({ passed: true, healthy: true, details: { evidence: 'injected-oracle-not-Chromium' } }),
});
const options = (overrides: Partial<InjectedStudyOptions> = {}): InjectedStudyOptions => ({ directory: directory(), executionSource: 'injected-test', poolIds: ['H01'], strategies: ['baseline', 'llm', 'jev-cascade'], budget: { ...budget }, ports: ports(), ...overrides });
const events = (path: string) => VerifierStudyLedger.open(path).readEvents();

test('full 18-pool manifest fits without truncation; all 54 blind decisions precede 36 Oracle callbacks', async () => {
  const config = options({ poolIds: [...VERIFIER_CHALLENGE_IDS] }); let llm = 0; let jev = 0; let oracle = 0;
  const original = config.ports;
  config.ports = {
    llm: async (request, signal) => {
      llm++; const observed = events(config.directory);
      assert.equal(observed.at(-1)!.type, 'call-intent'); assert.equal(observed.at(-1)!.payload.cachePolicy, 'bypass');
      assert.equal(observed.some(event => event.type === 'oracle-intent'), false);
      assert.deepEqual(request, observed.at(-1)!.payload.requestSnapshot);
      assert.equal(/expectedPass|Oracle result|goldAnswer|priorStrategy/.test(request.userPrompt), false);
      return original.llm(request, signal);
    },
    jev: async (request, signal) => { jev++; assert.equal(events(config.directory).at(-1)!.type, 'call-intent'); return original.jev(request, signal); },
    oracle: async () => { oracle++; assert.equal(events(config.directory).filter(event => event.type === 'decision-result').length, 54); return { passed: true, healthy: true, details: 'Injected Oracle' }; },
  };
  const actual = await runInjectedVerifierStudy(config);
  assert.equal(actual.status, 'completed'); assert.equal(actual.ledgerTerminalPersisted, true);
  assert.equal(llm, 36); assert.equal(jev, 18); assert.equal(oracle, 36); assert.equal(actual.callbackIntents, 54);
  assert.equal(actual.actualProviderHttpAttempts, null); assert.equal(actual.usage.scope, 'injected-fixture-accounting-not-model-measurement');
  assert.equal(actual.usage.complete, true); assert.equal(actual.notStartedDecisions, 0); assert.equal(actual.completedOracles, 36);
  const manifest = VerifierStudyLedger.open(config.directory).readManifest();
  assert.equal((manifest.manifest.inputSnapshots as unknown[]).length, 18);
  assert.ok(readFileSync(join(config.directory, 'manifest.json')).length > 1_048_576);
});

test('identical repeated runs have unique run/decision/call IDs and fresh callback invocations, not cached answers', async () => {
  let calls = 0; const ids = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const config = options({ strategies: ['llm'] }); const original = config.ports.llm;
    config.ports.llm = async (...args) => { calls++; return original(...args); };
    const result = await runInjectedVerifierStudy(config); assert.equal(result.status, 'completed');
    for (const id of [result.runId, ...events(config.directory).filter(event => event.type === 'decision-start').map(event => String(event.payload.decisionId)), ...events(config.directory).filter(event => event.type === 'call-intent').map(event => String(event.payload.callId))]) {
      assert.equal(ids.has(id), false); ids.add(id);
    }
  }
  assert.equal(calls, 3); assert.equal(ids.size, 9);
});

test('manifest or intent persistence failure dispatches zero callbacks and does not reuse the directory', async () => {
  for (const failing of ['manifest', 'call-intent'] as const) {
    const config = options({ strategies: ['llm'], ledgerOptions: { beforePersist: (operation, context) => {
      if (failing === 'manifest' ? operation === 'manifest' : context.eventType === 'call-intent') throw new Error('Injected EIO');
    } } }); let calls = 0; config.ports.llm = async () => { calls++; throw new Error('must not run'); };
    if (failing === 'manifest') await assert.rejects(runInjectedVerifierStudy(config), /EIO/);
    else {
      const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.callbackIntents, 0);
      assert.equal(existsSync(join(config.directory, 'manifest.json')), true); assert.equal(events(config.directory)[0].type, 'run-start');
      await assert.rejects(runInjectedVerifierStudy(config), /EEXIST/);
    }
    assert.equal(calls, 0);
  }
});

test('response persistence failure leaves intent unknown and never runs fallback, Oracle, or a next decision', async () => {
  const config = options({ strategies: ['jev-cascade'], ledgerOptions: { beforePersist: (_operation, context) => {
    if (context.eventType === 'call-result') throw new Error('Injected observation EIO');
  } } }); let llm = 0; let oracle = 0;
  config.ports.llm = async () => { llm++; throw new Error('not allowed'); }; config.ports.oracle = async () => { oracle++; throw new Error('not allowed'); };
  const actual = await runInjectedVerifierStudy(config);
  assert.equal(actual.status, 'failed'); assert.equal(actual.ledgerTerminalPersisted, false); assert.equal(actual.usage.complete, false); assert.equal(actual.usage.unknownCalls, 1);
  assert.equal(llm, 0); assert.equal(oracle, 0); assert.equal(events(config.directory).at(-1)!.type, 'call-intent');
  const recovered = VerifierStudyLedger.open(config.directory).recoverInterrupted(); assert.equal(recovered.recovered, true);
  assert.equal(events(config.directory).at(-1)!.payload.status, 'interrupted'); assert.equal(llm, 0);
});

test('known zero reservation and whole-study call budget are checked before dispatch', async () => {
  for (const change of [{ maxCalls: 0 }, { maxInputTokens: 19_999 }, { maxOutputTokens: 999 }, { maxEstimatedCost: 0.9 }]) {
    const config = options({ strategies: ['llm'], budget: { ...budget, ...change } }); let calls = 0;
    config.ports.llm = async () => { calls++; throw new Error('not dispatched'); };
    const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.callbackIntents, 0); assert.equal(calls, 0);
  }
});

test('last response overshooting any reservation is recorded and fails even with no further planned calls', async () => {
  for (const change of [{ inputTokens: 20_001 }, { outputTokens: 1001 }, { estimatedCost: 1.01 }]) {
    const config = options({ strategies: ['llm'] }); config.ports.llm = async logical => ({ text: llmDecision(logical), usage: { ...usage, ...change } });
    const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.match(actual.reason!, /reservation/); assert.equal(actual.attemptedOracles, 0);
    const response = events(config.directory).find(event => event.type === 'call-result')!; assert.deepEqual(response.payload.usage, { ...usage, ...change });
    assert.equal(actual.usage.complete, true); assert.equal(actual.callbackIntents, 1);
  }
});

test('unknown usage and mixed currency stop every next call; unknown is never zero', async () => {
  for (const replacement of [{ ...usage, inputTokens: null, complete: false }, { ...usage, currency: 'EUR' }]) {
    const config = options({ strategies: ['llm', 'jev-cascade'] }); let calls = 0; let jev = 0;
    config.ports.llm = async logical => { calls++; return { text: llmDecision(logical), usage: replacement as typeof usage }; };
    config.ports.jev = async () => { jev++; throw new Error('no subsequent call'); };
    const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.usage.complete, false); assert.equal(actual.usage.unknownCalls, 1);
    assert.equal(actual.notStartedDecisions, 1); assert.equal(calls, 1); assert.equal(jev, 0); assert.equal(actual.attemptedOracles, 0);
  }
});

test('cancellation/timeout with an uncooperative hook records unknown; late response cannot change terminal or start fallback', async () => {
  for (const mode of ['cancel', 'timeout'] as const) {
    const controller = new AbortController(); let resolve!: (value: { text: string; usage: typeof usage }) => void;
    const config = options({ strategies: ['llm', 'jev-cascade'], signal: controller.signal, budget: { ...budget, callTimeoutMs: mode === 'timeout' ? 10 : 1000 } });
    let logical!: { systemPrompt: string; userPrompt: string }; let started!: () => void; const ready = new Promise<void>(done => { started = done; });
    config.ports.llm = async request => { logical = request; started(); return new Promise(done => { resolve = done; }); };
    const running = runInjectedVerifierStudy(config); await ready; if (mode === 'cancel') controller.abort();
    const actual = await running; assert.equal(actual.status, mode === 'cancel' ? 'cancelled' : 'failed'); assert.equal(actual.usage.unknownCalls, 1);
    assert.equal(actual.ledgerTerminalPersisted, true); assert.equal(actual.notStartedDecisions, 1); assert.equal(actual.attemptedOracles, 0);
    const before = JSON.stringify(events(config.directory)); resolve({ text: llmDecision(logical), usage }); await new Promise(done => setTimeout(done, 20));
    assert.equal(JSON.stringify(events(config.directory)), before);
  }
});

test('monotonic overall deadline cannot be starved by immediately resolving hooks and synchronous manifest fsync', async () => {
  const config = options({ strategies: ['baseline'], budget: { ...budget, maxDurationMs: 1 } }); let oracles = 0;
  config.ports.oracle = async () => { oracles++; return { passed: true, healthy: true, details: 'Immediate promise' }; };
  const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.callbackIntents, 0); assert.equal(oracles, 0);
  assert.equal(events(config.directory)[0].type, 'run-start'); assert.equal(actual.ledgerTerminalPersisted, true);
});

test('synchronously blocking callback cannot starve per-call deadline; known late usage stays observed but never selected', async () => {
  const config = options({ strategies: ['llm'], budget: { ...budget, callTimeoutMs: 1 } });
  config.ports.llm = async logical => {
    const start = performance.now(); while (performance.now() - start < 12) { /* Trusted free timeout fixture only. */ }
    return { text: llmDecision(logical), usage };
  };
  const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.match(actual.reason!, /timeout/);
  assert.equal(actual.usage.complete, true); assert.equal(actual.usage.knownInputTokens, 101); assert.equal(actual.attemptedOracles, 0); assert.equal(actual.byStrategy[0].accepted, 0);
  const observation = events(config.directory).find(event => event.type === 'call-result')!; assert.equal(observation.payload.timeoutExceeded, true);
});

test('config mutation is detected after response with no downstream decisions or Oracle', async () => {
  const config = options({ strategies: ['llm', 'jev-cascade'] });
  config.ports.llm = async logical => { config.budget.maxCalls++; return { text: llmDecision(logical), usage }; };
  const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.callbackIntents, 1); assert.equal(actual.attemptedOracles, 0); assert.equal(actual.notStartedDecisions, 1);
});

test('durable response and parsed selection share one immutable observation even when a persistence hook mutates retained provider reference', async () => {
  let returned!: { text: string; usage: typeof usage };
  const config = options({ strategies: ['llm'], ledgerOptions: { beforePersist: (operation, context) => {
    if (operation === 'directory-sync' && context.eventType === 'call-result') {
      const alternate = JSON.parse(returned.text); alternate.selectedCandidateId = alternate.scores[1].candidateId; returned.text = JSON.stringify(alternate); returned.usage.inputTokens = 9000;
    }
  } } });
  config.ports.llm = async logical => { returned = { text: llmDecision(logical), usage: { ...usage } }; return returned; };
  const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'completed'); assert.equal(actual.usage.knownInputTokens, 101);
  const persisted = events(config.directory); const response = persisted.find(event => event.type === 'call-result')!.payload.responseSnapshot as unknown as typeof returned;
  const selection = persisted.find(event => event.type === 'decision-result')!.payload.selection as unknown as { selectedCandidateId: string };
  assert.equal(selection.selectedCandidateId, JSON.parse(response.text).selectedCandidateId); assert.notEqual(selection.selectedCandidateId, JSON.parse(returned.text).selectedCandidateId);
});

test('protocol failure is not abstention; Oracle infrastructure failure is not business reject; terminal EIO cannot report success', async () => {
  const invalid = options({ strategies: ['llm'] }); invalid.ports.llm = async () => ({ text: '{broken', usage });
  const failed = await runInjectedVerifierStudy(invalid); assert.equal(failed.status, 'failed'); assert.equal(failed.byStrategy[0].errors, 1); assert.equal(failed.byStrategy[0].abstained, 0);
  const unhealthy = options({ strategies: ['baseline'] }); unhealthy.ports.oracle = async () => ({ passed: false, healthy: false, details: 'infrastructure' });
  const interrupted = await runInjectedVerifierStudy(unhealthy); assert.equal(interrupted.status, 'failed'); assert.equal(interrupted.byStrategy[0].selectedOracleFail, 0); assert.equal(interrupted.byStrategy[0].selectedOracleUnknown, 1);
  const invalidOracle = options({ strategies: ['baseline'] }); invalidOracle.ports.oracle = async () => ({ passed: 'yes', healthy: true, details: 'bad protocol' }) as never;
  const badOracle = await runInjectedVerifierStudy(invalidOracle); assert.equal(badOracle.status, 'failed'); assert.equal(badOracle.byStrategy[0].selectedOracleUnknown, 1);
  assert.equal(badOracle.byStrategy[0].selectedOraclePass + badOracle.byStrategy[0].selectedOracleFail + badOracle.byStrategy[0].selectedOracleUnknown, badOracle.byStrategy[0].accepted);
  const terminal = options({ strategies: ['baseline'], ledgerOptions: { beforePersist: (_operation, context) => { if (context.eventType === 'run-end') throw new Error('EIO'); } } });
  const uncommitted = await runInjectedVerifierStudy(terminal); assert.equal(uncommitted.status, 'failed'); assert.equal(uncommitted.ledgerTerminalPersisted, false);
  assert.equal(VerifierStudyLedger.open(terminal.directory).recoverInterrupted().recovered, true);
});

test('visible terminal without a successful directory-sync confirmation cannot reopen as a completed study', async () => {
  const config = options({ strategies: ['baseline'], ledgerOptions: { beforePersist: (operation, context) => {
    if (operation === 'directory-sync' && context.eventType === 'run-end' && context.phase === 'event') throw new Error('Terminal event barrier EIO');
  } } });
  const actual = await runInjectedVerifierStudy(config); assert.equal(actual.status, 'failed'); assert.equal(actual.ledgerTerminalPersisted, false);
  assert.equal(existsSync(join(config.directory, 'manifest.json')), true);
  assert.throws(() => VerifierStudyLedger.open(config.directory), /marker|confirm|unconfirmed/i);
});

test('fixed-input real Chromium Oracle executes good and bad H01 artifacts without model or cache', async () => {
  const request = verifierPreparationRequests('H01');
  for (const [index, candidate] of request.snapshot.candidates.entries()) {
    const actual = await runStudyChromiumOracle(request, candidate.id, new AbortController().signal);
    assert.equal(actual.healthy, true); assert.equal(actual.passed, index === 0);
  }
  const corrupted = structuredClone(request); corrupted.snapshot.goal += ' Modified';
  await assert.rejects(runStudyChromiumOracle(corrupted, request.snapshot.candidates[0].id, new AbortController().signal), /differs/);
});

test('live adapter identity, invalid budget or repeated pool schedule is rejected before ledger or callback', async () => {
  for (const change of [{ executionSource: 'real-model' }, { poolIds: ['H01', 'H01'] }, { budget: { ...budget, maxCalls: NaN } }] as unknown as Partial<InjectedStudyOptions>[]) {
    const config = options(change); await assert.rejects(runInjectedVerifierStudy(config)); assert.equal(existsSync(config.directory), false);
  }
});
