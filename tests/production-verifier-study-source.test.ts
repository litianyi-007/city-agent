import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertVerifierStudySourceFresh, snapshotVerifierStudySource, VERIFIER_STUDY_SOURCE_FILES, VERIFIER_STUDY_SOURCE_VERSION, type VerifierStudySourceSnapshot } from '../server/production/verifier-study-source.ts';

// Only read this actual worktree. No test mutates source files, Git refs/index,
// configuration, credentials, services or a provider endpoint.
const snapshot = () => snapshotVerifierStudySource();
const mutate = (value: VerifierStudySourceSnapshot) => structuredClone(value);

test('source snapshot is fixed, complete, immutable actual repository SHA evidence', () => {
  const value = snapshot();
  assert.equal(VERIFIER_STUDY_SOURCE_VERSION, 'verifier-study-source-v2');
  assert.deepEqual(Object.keys(value).sort(), ['clean', 'commit', 'hashes']);
  assert.match(value.commit, /^[a-f0-9]{40}$/); assert.equal(typeof value.clean, 'boolean');
  assert.deepEqual(Object.keys(value.hashes), [...VERIFIER_STUDY_SOURCE_FILES]);
  assert.equal(value.hashes['server/harness.ts'], createHash('sha256').update(readFileSync(new URL('../server/harness.ts', import.meta.url))).digest('hex'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('server/production/verifier-study-source.ts'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('scripts/run-production-verifier-study-engineering.ts'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('shared/camera-hand-worker.ts'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('server/production/verifier-study-control.ts'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('server/production/index.ts'));
  assert.ok(VERIFIER_STUDY_SOURCE_FILES.includes('shared/verifier-study-control-schema.ts'));
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.hashes), true);
  assert.throws(() => { value.hashes['server/harness.ts'] = 'a'.repeat(64); }, TypeError);
  assert.throws(() => { value.clean = !value.clean; }, TypeError);
});

test('engineering freshness checks real files and HEAD even when the snapshot is dirty', () => {
  const value = snapshot(); assert.doesNotThrow(() => assertVerifierStudySourceFresh(value, false));
  const dirty = mutate(value); dirty.clean = false;
  assert.doesNotThrow(() => assertVerifierStudySourceFresh(dirty, false));
  assert.throws(() => assertVerifierStudySourceFresh(dirty, true), /Verifier study source/);
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' }).trim();
  if (value.clean && branch === 'feature/autonomous-production') assert.doesNotThrow(() => assertVerifierStudySourceFresh(value, true));
  else assert.throws(() => assertVerifierStudySourceFresh(value, true), /Verifier study source/);
});

test('changed snapshot HEAD or any recorded file SHA fails without changing the worktree', () => {
  const value = snapshot();
  const wrongCommit = mutate(value); wrongCommit.commit = value.commit === 'a'.repeat(40) ? 'b'.repeat(40) : 'a'.repeat(40);
  assert.throws(() => assertVerifierStudySourceFresh(wrongCommit, false), /Verifier study source/);
  for (const relative of VERIFIER_STUDY_SOURCE_FILES) {
    const changed = mutate(value); changed.hashes[relative] = value.hashes[relative] === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    assert.throws(() => assertVerifierStudySourceFresh(changed, false), /Verifier study source/);
  }
});

test('source file set cannot be omitted, extended, redirected or decorated', () => {
  const value = snapshot();
  const missing = mutate(value); delete missing.hashes[VERIFIER_STUDY_SOURCE_FILES[0]];
  assert.throws(() => assertVerifierStudySourceFresh(missing, false));
  for (const path of ['../package.json', '/tmp/outside-source.ts', 'server/unknown.ts', '__proto__']) {
    const extended = mutate(value); Object.defineProperty(extended.hashes, path, { value: 'a'.repeat(64), enumerable: true });
    assert.throws(() => assertVerifierStudySourceFresh(extended, false));
  }
  for (const extra of [{ root: '/tmp/arbitrary-root' }, { branch: 'main' }, { authorization: null }]) {
    assert.throws(() => assertVerifierStudySourceFresh(Object.assign(mutate(value), extra), false));
  }
  assert.throws(() => (snapshotVerifierStudySource as (...args: unknown[]) => unknown)('/tmp/arbitrary-root'));
});

test('strict source schema rejects coercion, accessors, proxies and non-JSON metadata', () => {
  const value = snapshot();
  for (const change of [{ clean: 'true' }, { commit: 'not-a-commit' }, { hashes: [] }, { hashes: null }]) {
    assert.throws(() => assertVerifierStudySourceFresh(Object.assign(mutate(value), change) as VerifierStudySourceSnapshot, false));
  }
  const accessor = mutate(value); Object.defineProperty(accessor, 'commit', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => assertVerifierStudySourceFresh(accessor, false), /Verifier study source/);
  const hashAccessor = mutate(value); Object.defineProperty(hashAccessor.hashes, VERIFIER_STUDY_SOURCE_FILES[0], { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => assertVerifierStudySourceFresh(hashAccessor, false), /Verifier study source/);
  const decorated = mutate(value); Object.defineProperty(decorated, Symbol('hidden'), { value: 'not-public' });
  assert.throws(() => assertVerifierStudySourceFresh(decorated, false));
  assert.throws(() => assertVerifierStudySourceFresh(new Proxy(value, {}), false));
  const hashProxy = mutate(value); hashProxy.hashes = new Proxy(hashProxy.hashes, {});
  assert.throws(() => assertVerifierStudySourceFresh(hashProxy, false));
  assert.throws(() => assertVerifierStudySourceFresh(value, 'true' as unknown as boolean));
});
