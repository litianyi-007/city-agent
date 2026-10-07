import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { cameraSceneCodeSchema } from '../shared/camera-scene-schema.js';
import { VERIFIER_SCENE_CORPUS, VERIFIER_SCENE_EXPECTATIONS, VERIFIER_SCENE_CORPUS_VERSION, VERIFIER_SCENE_ORACLE_VERSION, verifierSceneReviewSnapshot } from '../shared/production-verifier-scene-corpus.js';
import { testsSchema } from '../server/production/contracts.js';
import { runVerifierSceneOracle } from '../server/production/verifier-scene-oracle.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('six prepared scene challenges have twelve strict, frozen candidates and controller-only labels', () => {
  assert.deepEqual(VERIFIER_SCENE_CORPUS.map(pool => pool.id), ['C13', 'C14', 'C15', 'C16', 'C17', 'C18']);
  assert.equal(VERIFIER_SCENE_EXPECTATIONS.length, 12);
  const ids = VERIFIER_SCENE_CORPUS.flatMap(pool => pool.candidates.map(candidate => candidate.id));
  assert.equal(new Set(ids).size, 12);
  for (const pool of VERIFIER_SCENE_CORPUS) {
    testsSchema.parse({ checks: pool.checks });
    assert.ok(Object.isFrozen(pool) && Object.isFrozen(pool.checks) && Object.isFrozen(pool.required));
    for (const candidate of pool.candidates) {
      cameraSceneCodeSchema.parse(candidate.value);
      assert.ok(Object.isFrozen(candidate.value.scene.objects));
      assert.doesNotMatch(candidate.id, /good|bad|gold|correct|wrong|bug/i);
      assert.equal(VERIFIER_SCENE_EXPECTATIONS.filter(label => label.poolId === pool.id && label.candidateId === candidate.id).length, 1);
    }
  }
  assert.deepEqual(VERIFIER_SCENE_CORPUS.map(pool => pool.candidates.map(candidate => VERIFIER_SCENE_EXPECTATIONS.find(label => label.candidateId === candidate.id)!.expectedPass)), [[false, true], [false, false], [true, false], [true, true], [false, false], [false, true]]);
});

test('scene blind review includes legitimate exact requirements, but no labels, defects or executed Oracle results', () => {
  const forbidden = new Set(['expectedPass', 'defect', 'gold', 'oracleResults', 'stratum', 'evaluation', 'jevOpinions', 'selectedCandidateId']);
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  };
  for (const pool of VERIFIER_SCENE_CORPUS) {
    const snapshot = verifierSceneReviewSnapshot(pool.id, { version: 'verifier-challenge-preparation-v1', hash: hash({ goal: pool.goal, acceptance: pool.acceptance, checks: pool.checks, required: pool.required }) });
    inspect(snapshot);
    assert.equal(snapshot.phase, 'implement');
    assert.deepEqual(snapshot.candidates, pool.candidates);
    assert.deepEqual(snapshot.reviewContext.frozenContract.sceneBusinessRequirements, pool.required);
    assert.ok(Object.isFrozen(snapshot.reviewContext.frozenContract));
    for (const label of VERIFIER_SCENE_EXPECTATIONS) if (label.defect) assert.equal(JSON.stringify(snapshot).includes(label.defect), false);
  }
  assert.throws(() => verifierSceneReviewSnapshot('C13', { version: 'bad version', hash: '0'.repeat(64) }));
  assert.throws(() => verifierSceneReviewSnapshot('H01' as 'C13', { version: 'v1', hash: '0'.repeat(64) }));
});

test('all twelve scene labels are independently checked by actual Canvas and synthetic behavior without any media/model request', { timeout: 240000 }, async t => {
  for (const pool of VERIFIER_SCENE_CORPUS) for (const candidate of pool.candidates) {
    const before = hash({ pool, candidate });
    const label = VERIFIER_SCENE_EXPECTATIONS.find(item => item.poolId === pool.id && item.candidateId === candidate.id)!;
    const actual = await runVerifierSceneOracle(pool, candidate.value.scene);
    t.diagnostic(JSON.stringify({ corpusVersion: VERIFIER_SCENE_CORPUS_VERSION, oracleVersion: VERIFIER_SCENE_ORACLE_VERSION, poolId: pool.id, candidateId: candidate.id, expectedPass: label.expectedPass, actual, sourceHash: hash(candidate.value), checksHash: hash(pool.checks) }));
    assert.equal(actual.failureKind, undefined, `${pool.id}/${candidate.id}: infrastructure failure is not a business label`);
    assert.equal(actual.gate.failureKind, undefined);
    assert.equal(actual.gate.checks[0].passed, true, 'load/JavaScript must genuinely work');
    assert.equal(actual.passed, label.expectedPass, JSON.stringify(actual));
    assert.equal(actual.modelRequests, 0);
    assert.doesNotMatch(JSON.stringify(actual.gate.checks.filter(check => !check.passed)), /timed?\s*out|超时|超过.*秒|JavaScript错误|JavaScript 错误|未授权网络|初始化|连接失败/i);
    assert.equal(hash({ pool, candidate }), before, 'never mutate candidate/checks to satisfy an Oracle');
    if (['C13', 'C14', 'C17'].includes(pool.id)) assert.equal(actual.gate.passed, true, 'Generic consistency Gate is not the independent business Oracle');
    if (pool.id === 'C15' && !label.expectedPass) assert.match(actual.gate.checks.at(-1)?.detail ?? '', /可见雪不能替代完全不可见对象/);
    if (pool.id === 'C17') {
      assert.equal(actual.componentPixels!.cameraActive, false);
      assert.ok(actual.componentPixels!.total > 0);
      assert.equal(actual.componentDiagnostics!.length, 1);
      assert.equal(actual.componentDiagnostics![0].gate.passed, true);
      const hasCone = candidate.value.scene.objects.some(object => object.primitive === 'cone');
      assert.equal(actual.componentPixels!.left > 0, hasCone);
      assert.equal(actual.componentPixels!.right > 0, !hasCone);
    }
  }
});

test('the double-missing-component challenge Oracle accepts an independently constructed valid positive control', { timeout: 60000 }, async t => {
  const pool = VERIFIER_SCENE_CORPUS.find(item => item.id === 'C17')!;
  // Positive instrumentation control only: not a 37th scored candidate or an
  // answer supplied to a Verifier. The registered C17 remains double-bad.
  const scene = { ...structuredClone(pool.candidates[0].value.scene), objects: pool.candidates.flatMap(candidate => structuredClone(candidate.value.scene.objects)) };
  const before = hash(scene); const actual = await runVerifierSceneOracle(pool, scene);
  t.diagnostic(JSON.stringify({ evidenceKind: 'outer-authored-oracle-positive-control-not-scored', poolId: pool.id, actual }));
  assert.equal(actual.failureKind, undefined);
  assert.equal(actual.passed, true, JSON.stringify(actual));
  assert.ok(actual.componentPixels!.left > 0 && actual.componentPixels!.right > 0);
  assert.equal(actual.componentDiagnostics!.length, 2);
  assert.ok(actual.componentDiagnostics!.every(result => result.gate.passed));
  assert.equal(hash(scene), before);
});

test('cancelled challenge Oracle starts no browser or partial result', async () => {
  const controller = new AbortController(); controller.abort();
  const pool = VERIFIER_SCENE_CORPUS[0];
  await assert.rejects(runVerifierSceneOracle(pool, pool.candidates[0].value.scene, controller.signal), { name: 'AbortError' });
});
