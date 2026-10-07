import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runGate } from '../server/gate.ts';
import { codeSchema, contractProfile, testsSchema } from '../server/production/contracts.ts';
import { buildJevCandidateRequest } from '../server/production/jev.ts';
import { VERIFIER_HTML_B_CORPUS, VERIFIER_HTML_B_CORPUS_VERSION, VERIFIER_HTML_B_DOM_CONTRACTS, VERIFIER_HTML_B_EXPECTATIONS, VERIFIER_HTML_B_ORACLE_VERSION, verifierHtmlBReviewSnapshot } from '../shared/production-verifier-html-corpus-b.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const sourceHash = (html: string) => createHash('sha256').update(html, 'utf8').digest('hex');

test('H07–H12 have twelve structurally legal candidates, neutral same-pool DOM and independent labels', () => {
  assert.deepEqual(VERIFIER_HTML_B_CORPUS.map(pool => pool.id), ['H07', 'H08', 'H09', 'H10', 'H11', 'H12']);
  const candidates = VERIFIER_HTML_B_CORPUS.flatMap(pool => pool.candidates);
  assert.equal(candidates.length, 12);
  assert.equal(new Set(candidates.map(item => item.id)).size, 12);
  assert.equal(new Set(candidates.map(item => sourceHash(item.value.html))).size, 12);
  assert.equal(VERIFIER_HTML_B_EXPECTATIONS.length, 12);
  for (const pool of VERIFIER_HTML_B_CORPUS) {
    testsSchema.parse({ checks: pool.checks });
    assert.ok(Object.isFrozen(pool) && Object.isFrozen(pool.candidates) && Object.isFrozen(pool.checks));
    for (const candidate of pool.candidates) {
      codeSchema.parse(candidate.value);
      assert.ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.value));
      assert.deepEqual(Object.keys(candidate.value), ['html']);
      assert.match(candidate.value.html, /^<!doctype html>/);
      assert.match(candidate.value.html, /<\/script><\/body><\/html>$/);
      for (const selector of Object.values(VERIFIER_HTML_B_DOM_CONTRACTS[pool.id]).filter(value => value.startsWith('#'))) {
        assert.equal(candidate.value.html.match(new RegExp(`id="${selector.slice(1)}"`, 'g'))?.length, 1, `${pool.id} ${selector}`);
      }
      assert.doesNotMatch(candidate.value.html, /https?:\/\/|fetch\s*\(|XMLHttpRequest|new\s+Worker|<iframe|<form|<script[^>]+src=/i);
      assert.doesNotMatch(candidate.id, /good|bad|gold|correct|wrong/i);
      assert.doesNotMatch(candidate.value.html, /正确版|错误版|\b(?:good|bad|gold|correct|wrong)\b/i);
      assert.equal(VERIFIER_HTML_B_EXPECTATIONS.filter(item => item.poolId === pool.id && item.candidateId === candidate.id).length, 1);
    }
    assert.throws(() => pool.checks.push(pool.checks[0]), TypeError);
  }
  assert.deepEqual(VERIFIER_HTML_B_CORPUS.map(pool => pool.candidates.map(candidate => VERIFIER_HTML_B_EXPECTATIONS.find(item => item.candidateId === candidate.id)!.expectedPass)), [[true, true], [false, false], [false, true], [false, false], [true, true], [true, false]]);
});

test('H07–H12 review serialization is immutable and excludes control-plane labels and prior results', t => {
  const forbidden = new Set(['expectedPass', 'defect', 'gold', 'oracleResults', 'evaluation', 'jevOpinions', 'selectedCandidateId']);
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  }
  for (const pool of VERIFIER_HTML_B_CORPUS) {
    const frozen = { version: contractProfile('offline-single-html').acceptanceVersion, hash: hash({ version: VERIFIER_HTML_B_ORACLE_VERSION, goal: pool.goal, acceptance: pool.acceptance, checks: pool.checks }) };
    const snapshot = verifierHtmlBReviewSnapshot(pool.id, frozen);
    inspect(snapshot);
    assert.equal(snapshot.phase, 'implement');
    assert.deepEqual(snapshot.candidates, pool.candidates);
    assert.deepEqual(snapshot.reviewContext.frozenContract.checks, pool.checks);
    assert.equal(snapshot.reviewContext.feedback, null);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.reviewContext.frozenContract.checks));
    for (const label of VERIFIER_HTML_B_EXPECTATIONS.filter(item => item.defect)) assert.equal(JSON.stringify(snapshot).includes(label.defect!), false);
    const request = buildJevCandidateRequest('jev-1.13.0', snapshot);
    inspect(request);
    const stateBytes = Buffer.byteLength(JSON.stringify(request.state), 'utf8');
    const maxQuestionBytes = Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question), 'utf8')));
    const totalBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    assert.ok(stateBytes + maxQuestionBytes <= 32000, `${pool.id} per-question context ceiling`);
    assert.ok(totalBytes <= 64000, `${pool.id} overall context ceiling`);
    t.diagnostic(JSON.stringify({ poolId: pool.id, evidenceKind: 'offline-serialized-not-dispatched', stateBytes, maxQuestionBytes, perQuestionBytes: stateBytes + maxQuestionBytes, totalBytes, modelRequests: 0 }));
  }
  assert.throws(() => verifierHtmlBReviewSnapshot('H07', { version: 'production-acceptance-v3', hash: 'not-a-hash' }));
  assert.throws(() => verifierHtmlBReviewSnapshot('DEV-01' as 'H07', { version: 'production-acceptance-v3', hash: '0'.repeat(64) }));
});

test('request-denying Chromium validates twelve H07–H12 construction labels through actual interactions', { timeout: 240000 }, async t => {
  // Preparation Oracle only: no model decision, paid request or autonomous delivery.
  for (const pool of VERIFIER_HTML_B_CORPUS) for (const candidate of pool.candidates) {
    const expectation = VERIFIER_HTML_B_EXPECTATIONS.find(item => item.poolId === pool.id && item.candidateId === candidate.id)!;
    const beforeChecksHash = hash(pool.checks), beforeSourceHash = sourceHash(candidate.value.html);
    const actual = await runGate(candidate.value.html, structuredClone(pool.checks));
    t.diagnostic(JSON.stringify({ corpusVersion: VERIFIER_HTML_B_CORPUS_VERSION, oracleVersion: VERIFIER_HTML_B_ORACLE_VERSION, poolId: pool.id, candidateId: candidate.id, evidenceKind: 'outer-authored-challenge-preparation-oracle', expectedPass: expectation.expectedPass, actual, checksHash: beforeChecksHash, sourceHash: beforeSourceHash, modelRequests: 0 }));
    assert.equal(actual.failureKind, undefined, `${pool.id}/${candidate.id}: infrastructure failure cannot receive a business label`);
    assert.equal(actual.checks.length, pool.checks.length + 1, `${pool.id}/${candidate.id}: every independent Oracle item must run`);
    assert.equal(actual.checks[0].passed, true, `${pool.id}/${candidate.id}: initial page/JavaScript must be healthy`);
    for (const item of actual.checks) assert.doesNotMatch(item.detail ?? '', /JavaScript|网络|跳转|弹窗|下载|超过|timeout|Chromium/i, `${pool.id}/${candidate.id}: business failure cannot be syntax, execution or infrastructure failure`);
    if (!expectation.expectedPass) {
      const failures = actual.checks.filter(item => !item.passed);
      assert.ok(failures.length > 0);
      for (const item of failures) assert.match(item.detail ?? '', /文本不精确等于|元素数量不等于|的值不是/, `${pool.id}/${candidate.id}: negative label needs an exact business mismatch`);
    }
    assert.equal(actual.passed, expectation.expectedPass, `${pool.id}/${candidate.id}: actual Oracle disagrees with construction label`);
    assert.equal(hash(pool.checks), beforeChecksHash);
    assert.equal(sourceHash(candidate.value.html), beforeSourceHash);
  }
});
