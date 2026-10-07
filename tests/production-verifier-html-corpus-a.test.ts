import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runGate } from '../server/gate.ts';
import { codeSchema, contractProfile, testsSchema } from '../server/production/contracts.ts';
import { buildJevCandidateRequest } from '../server/production/jev.ts';
import { VERIFIER_HTML_A_CORPUS, VERIFIER_HTML_A_CORPUS_VERSION, VERIFIER_HTML_A_DOM_CONTRACT, VERIFIER_HTML_A_EXPECTATIONS, VERIFIER_HTML_A_ORACLE_VERSION, verifierHtmlAReviewSnapshot } from '../shared/production-verifier-html-corpus-a.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const sourceHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function review(pool: (typeof VERIFIER_HTML_A_CORPUS)[number]) {
  return verifierHtmlAReviewSnapshot(pool.id, { version: contractProfile('offline-single-html').acceptanceVersion, hash: hash({ version: VERIFIER_HTML_A_ORACLE_VERSION, goal: pool.goal, acceptance: pool.acceptance, checks: pool.checks }) });
}

test('H01–H06 provide twelve complete legal inline candidates with immutable shared neutral business Oracles', () => {
  assert.deepEqual(VERIFIER_HTML_A_CORPUS.map(pool => pool.id), ['H01', 'H02', 'H03', 'H04', 'H05', 'H06']);
  assert.equal(VERIFIER_HTML_A_CORPUS.flatMap(pool => pool.candidates).length, 12);
  assert.equal(VERIFIER_HTML_A_EXPECTATIONS.length, 12);
  const ids = VERIFIER_HTML_A_CORPUS.flatMap(pool => pool.candidates.map(candidate => candidate.id));
  assert.equal(new Set(ids).size, 12);
  assert.equal(new Set(VERIFIER_HTML_A_CORPUS.flatMap(pool => pool.candidates.map(candidate => sourceHash(candidate.value.html)))).size, 12);
  assert.deepEqual(VERIFIER_HTML_A_CORPUS.map(pool => pool.candidates.map(candidate => VERIFIER_HTML_A_EXPECTATIONS.find(label => label.candidateId === candidate.id)!.expectedPass)), [[true, false], [false, false], [false, true], [true, true], [false, false], [true, false]]);
  for (const pool of VERIFIER_HTML_A_CORPUS) {
    testsSchema.parse({ checks: pool.checks });
    assert.ok(Object.isFrozen(pool) && Object.isFrozen(pool.checks) && Object.isFrozen(pool.checks[0].steps));
    assert.ok(pool.checks.some(check => check.steps.some(step => step.action === 'assertTextExact')));
    for (const candidate of pool.candidates) {
      codeSchema.parse(candidate.value);
      assert.ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.value));
      assert.deepEqual(Object.keys(candidate.value), ['html']);
      for (const selector of Object.values(VERIFIER_HTML_A_DOM_CONTRACT[pool.id])) {
        const id = selector.slice(1).split(' ')[0];
        assert.equal(candidate.value.html.match(new RegExp(`id="${id}"`, 'g'))?.length, 1, `${pool.id}/${selector}`);
      }
      assert.doesNotMatch(candidate.value.html, /https?:\/\/|fetch\s*\(|XMLHttpRequest|new\s+Worker|<iframe|<script[^>]+src=|<!--|\/\*/i);
      assert.doesNotMatch(candidate.id, /good|bad|gold|correct|wrong/i);
      assert.doesNotMatch(candidate.value.html, /正确版|错误版|\b(?:good|bad|gold)\b/i);
      assert.equal(VERIFIER_HTML_A_EXPECTATIONS.filter(label => label.poolId === pool.id && label.candidateId === candidate.id).length, 1);
    }
    assert.throws(() => pool.candidates.push(pool.candidates[0]), TypeError);
  }
});

test('HTML challenge review snapshots exclude construction labels, defects and preparation outcomes', () => {
  const forbidden = new Set(['expectedPass', 'defect', 'gold', 'oracleResults', 'evaluation', 'jevOpinions', 'selectedCandidateId']);
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  }
  for (const pool of VERIFIER_HTML_A_CORPUS) {
    const snapshot = review(pool); inspect(snapshot);
    assert.equal(snapshot.phase, 'implement');
    assert.equal(snapshot.capability, 'offline-single-html');
    assert.deepEqual(snapshot.candidates, pool.candidates);
    assert.deepEqual(snapshot.reviewContext.frozenContract.checks, pool.checks);
    assert.equal(snapshot.reviewContext.feedback, null);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.reviewContext.frozenContract.checks));
    for (const label of VERIFIER_HTML_A_EXPECTATIONS.filter(item => item.defect)) assert.equal(JSON.stringify(snapshot).includes(label.defect!), false);
    assert.throws(() => Object.assign(snapshot.reviewContext, { gold: true }), TypeError);
  }
  assert.throws(() => verifierHtmlAReviewSnapshot('H01', { version: 'production-acceptance-v3', hash: 'not-a-hash' }));
  assert.throws(() => verifierHtmlAReviewSnapshot('DEV-01' as 'H01', { version: 'production-acceptance-v3', hash: '0'.repeat(64) }));
});

test('all six exact Jev request serializations stay within unchanged byte limits without label leakage', t => {
  for (const pool of VERIFIER_HTML_A_CORPUS) {
    const snapshot = review(pool); const before = JSON.stringify(snapshot);
    const request = buildJevCandidateRequest('jev-1.13.0', snapshot);
    const stateBytes = Buffer.byteLength(JSON.stringify(request.state), 'utf8');
    const questionBytes = Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question), 'utf8')));
    const totalBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    assert.ok(stateBytes + questionBytes <= 32000, `${pool.id} per-question request`);
    assert.ok(totalBytes <= 64000, `${pool.id} total request`);
    assert.equal(JSON.stringify(request).includes('expectedPass'), false);
    assert.equal(JSON.stringify(snapshot), before);
    t.diagnostic(JSON.stringify({ poolId: pool.id, requestKind: 'offline-serialized-not-dispatched', stateBytes, questionBytes, perQuestionBytes: stateBytes + questionBytes, totalBytes }));
  }
});

test('request-denying Chromium validates all twelve H01–H06 labels by shared real business interactions', { timeout: 360000 }, async t => {
  // Outer-authored preparation evidence, not formal Verifier results or autonomous delivery.
  for (const pool of VERIFIER_HTML_A_CORPUS) for (const candidate of pool.candidates) {
    const expectation = VERIFIER_HTML_A_EXPECTATIONS.find(item => item.poolId === pool.id && item.candidateId === candidate.id)!;
    const checksHash = hash(pool.checks); const candidateHash = sourceHash(candidate.value.html);
    const actual = await runGate(candidate.value.html, structuredClone(pool.checks));
    t.diagnostic(JSON.stringify({ corpusVersion: VERIFIER_HTML_A_CORPUS_VERSION, oracleVersion: VERIFIER_HTML_A_ORACLE_VERSION, poolId: pool.id, candidateId: candidate.id, evidenceKind: 'outer-authored-challenge-preparation-oracle', expectedPass: expectation.expectedPass, actual, checksHash, sourceHash: candidateHash, modelRequests: 0 }));
    assert.equal(actual.failureKind, undefined, `${pool.id}/${candidate.id}: infrastructure/timeout failure is not a business label`);
    assert.equal(actual.checks[0]?.passed, true, `${pool.id}/${candidate.id}: malformed/runtime-invalid page cannot enter the main challenge`);
    assert.equal(actual.checks.length, pool.checks.length + 1);
    assert.equal(actual.passed, expectation.expectedPass, `${pool.id}/${candidate.id}: actual Oracle disagrees with construction label`);
    if (!expectation.expectedPass) {
      const failures = actual.checks.slice(1).filter(check => !check.passed);
      assert.ok(failures.length > 0, `${pool.id}/${candidate.id}: business counterexample required`);
      for (const failure of failures) {
        assert.match(failure.detail ?? '', /文本不精确等于|元素数量不等于|的值不是/, `${pool.id}/${candidate.id}: a label must be demonstrated by business assertions`);
        assert.doesNotMatch(failure.detail ?? '', /JavaScript|页面错误|网络|跳转|超时|超过|Timeout|Executable|Chromium/i, `${pool.id}/${candidate.id}: execution faults cannot prove a business label`);
      }
    }
    assert.equal(hash(pool.checks), checksHash);
    assert.equal(sourceHash(candidate.value.html), candidateHash);
  }
});
