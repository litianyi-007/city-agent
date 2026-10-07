import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { captureProductionExecutionIdentity, EXECUTION_IDENTITY_LIMITATION, EXECUTION_IDENTITY_REQUIRED_SOURCES, ExecutionIdentityError, PRODUCTION_EXECUTION_IDENTITY_VERSION, type ExecutionDiskEvidence, type ExecutionIdentityFile, type ExecutionIdentityIssue } from '../server/production/provenance.js';

// Pure fingerprints/readers only: no Git mutation/real Key/data/env reads,
// filesystem fixture creation, model/network dispatch, browser or SDK process.
const commitA = 'a'.repeat(40); const commitB = 'b'.repeat(40);
const startedAt = '2026-10-07T10:00:00.000Z'; const builtAt = '2026-10-07T09:00:00.000Z';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const file = (path: string, contents = `public-fixture:${path}`): ExecutionIdentityFile => ({ path, sha256: sha(contents), bytes: Buffer.byteLength(contents) });
function evidence(): ExecutionDiskEvidence {
  return {
    commit: commitA, sourceClean: true,
    sourceFiles: EXECUTION_IDENTITY_REQUIRED_SOURCES.map(name => file(name)),
    buildSnapshot: { platformCommit: commitA, sourceClean: true, builtAt },
    buildFiles: [file('dist/index.html'), file('dist/production-build.json'), file('dist/assets/app-fixture.js')],
  };
}
function capture(current: ExecutionDiskEvidence) {
  return captureProductionExecutionIdentity({ reader: () => current, startedAt, bootId: 'pure-engineering-boot' });
}
function rejected(operation: () => void, code: ExecutionIdentityError['code'], issues: ExecutionIdentityIssue[]) {
  assert.throws(operation, error => error instanceof ExecutionIdentityError && error.code === code && issues.every(issue => error.issues.includes(issue)));
}

test('clean boot identity is captured once, deeply immutable and stable through unchanged freshness checks', () => {
  let reads = 0; const current = evidence();
  const control = captureProductionExecutionIdentity({ reader: () => { reads++; return current; }, startedAt, bootId: 'pure-engineering-boot' });
  const identity = control.bootIdentity; const snapshot = JSON.stringify(identity);
  assert.equal(reads, 1); assert.equal(identity.version, PRODUCTION_EXECUTION_IDENTITY_VERSION);
  assert.equal(identity.version, 'production-boot-disk-v1'); assert.equal(identity.bootId, 'pure-engineering-boot'); assert.equal(identity.startedAt, startedAt);
  assert.equal(identity.commit, commitA); assert.equal(identity.sourceClean, true); assert.equal(identity.ready, true); assert.deepEqual(identity.issues, []);
  assert.equal(identity.limitation, EXECUTION_IDENTITY_LIMITATION); assert.match(identity.limitation, /not proof of already-loaded TS module bytes/);
  assert.match(identity.sourceFingerprint!, /^[a-f0-9]{64}$/); assert.match(identity.buildFingerprint!, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(identity), true); assert.equal(Object.isFrozen(identity.sourceFiles), true); assert.equal(Object.isFrozen(identity.sourceFiles[0]), true);
  assert.equal(Object.isFrozen(identity.buildSnapshot), true); assert.equal(Object.isFrozen(control), true);
  assert.throws(() => { (identity.sourceFiles[0] as ExecutionIdentityFile).sha256 = sha('tamper'); }, TypeError);
  control.assertFresh(); control.assertFresh(); assert.equal(reads, 3);
  assert.equal(control.bootIdentity, identity); assert.equal(JSON.stringify(identity), snapshot);
});

test('HEAD and matching new build never relabel the old boot; a next paid-dispatch guard fails before any call', () => {
  const current = evidence(); const control = capture(current); const original = JSON.stringify(control.bootIdentity);
  current.commit = commitB; current.buildSnapshot!.platformCommit = commitB; current.buildFiles[1] = file('dist/production-build.json', 'new B build');
  let dispatches = 0;
  rejected(() => { control.assertFresh(); dispatches++; }, 'execution-identity-drift', ['commit-drift', 'build-drift']);
  assert.equal(dispatches, 0); assert.equal(control.bootIdentity.commit, commitA); assert.equal(JSON.stringify(control.bootIdentity), original);
});

test('same HEAD changes to backend, prompt, lockfile, literal plugin or frontend reject the subsequent paid boundary', () => {
  for (const name of ['server/production/pipeline.ts', 'server/production/contracts.ts', 'shared/production-verifier-rubric.ts', 'package-lock.json', 'server/harness-literal-prompt.mjs', 'src/ProductionWorkspace.tsx', 'src/production.css']) {
    const current = evidence(); const control = capture(current); const original = JSON.stringify(control.bootIdentity);
    current.sourceFiles[current.sourceFiles.findIndex(item => item.path === name)] = file(name, `changed:${name}`);
    rejected(() => control.assertFresh(), 'execution-identity-drift', ['source-drift']);
    assert.equal(control.bootIdentity.commit, commitA); assert.equal(JSON.stringify(control.bootIdentity), original);
  }
});

test('dist index, compiled asset or build stamp drift is independent from source cleanliness and rejects paid use', () => {
  for (const name of ['dist/index.html', 'dist/assets/app-fixture.js', 'dist/production-build.json']) {
    const current = evidence(); const control = capture(current);
    current.buildFiles[current.buildFiles.findIndex(item => item.path === name)] = file(name, `changed:${name}`);
    rejected(() => control.assertFresh(), 'execution-identity-drift', ['build-drift']);
    assert.equal(control.bootIdentity.ready, true, 'The immutable ready flag describes boot evidence, not mutable live disk status');
  }
});

test('dirty boot stays unready even if files are later cleaned; dirty runtime stops further paid requests', () => {
  const current = evidence(); current.sourceClean = false; const unready = capture(current);
  assert.equal(unready.bootIdentity.ready, false); assert.deepEqual(unready.bootIdentity.issues, ['dirty-worktree']);
  current.sourceClean = true; rejected(() => unready.assertFresh(), 'execution-identity-unready', ['dirty-worktree']);
  const ready = capture(current); current.sourceClean = false;
  rejected(() => ready.assertFresh(), 'execution-identity-drift', ['dirty-worktree']);
});

test('unknown Git and missing, mismatched, dirty or future build evidence never authorize a paid run', () => {
  const cases: Array<[ExecutionIdentityIssue, (value: ExecutionDiskEvidence) => void]> = [
    ['git-unknown', value => { value.commit = null; value.sourceClean = null; }],
    ['build-missing', value => { value.buildSnapshot = null; }],
    ['build-commit-mismatch', value => { value.buildSnapshot!.platformCommit = commitB; }],
    ['build-not-clean', value => { value.buildSnapshot!.sourceClean = false; }],
    ['build-invalid', value => { value.buildSnapshot!.builtAt = '2026-10-07T11:00:00.000Z'; }],
    ['build-invalid', value => { value.buildSnapshot!.builtAt = 'unknown'; }],
  ];
  for (const [issue, mutate] of cases) {
    const current = evidence(); mutate(current); const control = capture(current);
    assert.equal(control.bootIdentity.ready, false); rejected(() => control.assertFresh(), 'execution-identity-unready', [issue]);
  }
});

test('missing mandatory sources and malformed fingerprints are unknown rather than an empty successful snapshot', () => {
  const mutations: Array<(value: ExecutionDiskEvidence) => void> = [
    value => { value.sourceFiles = []; },
    value => { value.sourceFiles = value.sourceFiles.filter(item => item.path !== 'server/harness-literal-prompt.mjs'); },
    value => { value.sourceFiles[0].sha256 = 'not-a-hash'; },
    value => { value.sourceFiles[0].bytes = -1; },
    value => { value.sourceFiles[0].bytes = Number.MAX_SAFE_INTEGER; },
    value => { value.sourceFiles.push({ ...value.sourceFiles[0] }); },
  ];
  for (const mutate of mutations) {
    const current = evidence(); mutate(current); const control = capture(current);
    assert.equal(control.bootIdentity.ready, false); rejected(() => control.assertFresh(), 'execution-identity-unready', ['source-evidence-invalid']);
  }
});

test('evidence path grammar rejects traversal, absolute/hidden paths and data/environment/log names without reading them', () => {
  for (const name of ['../city-agent/server/harness.ts', '/private/source.ts', 'server/../.env', 'server/.env.ts', '.city-agent-production/config.ts', 'server/keys.json', 'server/calls.log']) {
    const current = evidence(); current.sourceFiles.push(file(name)); const control = capture(current);
    assert.equal(control.bootIdentity.ready, false); rejected(() => control.assertFresh(), 'execution-identity-unready', ['source-evidence-invalid']);
  }
  const current = evidence(); current.buildFiles.push(file('dist/../server/harness.ts'));
  rejected(() => capture(current).assertFresh(), 'execution-identity-unready', ['build-invalid']);
});

test('missing dist entry/assets or an invalid build snapshot fails closed without preventing capture for mock service startup', () => {
  for (const omitted of ['dist/index.html', 'dist/production-build.json', 'dist/assets/app-fixture.js']) {
    const current = evidence(); current.buildFiles = current.buildFiles.filter(item => item.path !== omitted);
    const control = capture(current); assert.equal(control.bootIdentity.ready, false);
    rejected(() => control.assertFresh(), 'execution-identity-unready', ['build-invalid']);
  }
  const current = evidence(); current.buildSnapshot = { ...current.buildSnapshot!, extra: 'not-public-build-metadata' } as unknown as ExecutionDiskEvidence['buildSnapshot'];
  rejected(() => capture(current).assertFresh(), 'execution-identity-unready', ['build-invalid']);
});

test('reader faults and malformed diagnostics expose only fixed safe issue codes, never reader error contents', () => {
  const sensitiveDiagnostic = 'synthetic-reader-diagnostic-must-not-be-exposed';
  const failed = captureProductionExecutionIdentity({ reader: () => { throw new Error(sensitiveDiagnostic); }, startedAt });
  assert.equal(failed.bootIdentity.ready, false); assert.equal(JSON.stringify(failed.bootIdentity).includes(sensitiveDiagnostic), false);
  assert.throws(() => failed.assertFresh(), error => error instanceof ExecutionIdentityError && !error.message.includes(sensitiveDiagnostic));
  const current = evidence(); current.issues = [sensitiveDiagnostic] as unknown as ExecutionIdentityIssue[];
  const malformed = capture(current); assert.equal(malformed.bootIdentity.ready, false);
  assert.equal(JSON.stringify(malformed.bootIdentity).includes(sensitiveDiagnostic), false);
  rejected(() => malformed.assertFresh(), 'execution-identity-unready', ['read-unavailable']);
  const unknown = captureProductionExecutionIdentity({ reader: () => null as unknown as ExecutionDiskEvidence, startedAt });
  assert.equal(unknown.bootIdentity.ready, false);
});

test('fingerprint order is canonical and external reader object mutation cannot rewrite a captured snapshot', () => {
  const current = evidence(); const control = capture(current); const original = JSON.stringify(control.bootIdentity);
  current.sourceFiles.reverse(); current.buildFiles.reverse(); control.assertFresh();
  assert.equal(JSON.stringify(control.bootIdentity), original);
  current.sourceFiles[0].sha256 = sha('mutated'); current.buildSnapshot!.builtAt = '2026-10-07T09:01:00.000Z';
  rejected(() => control.assertFresh(), 'execution-identity-drift', ['source-drift', 'build-drift']);
  assert.equal(JSON.stringify(control.bootIdentity), original);
});

test('source/read failures and a snapshot changed during trusted reading are explicit unready evidence', () => {
  for (const issue of ['source-read-failed', 'build-read-failed', 'snapshot-changed'] as const) {
    const current = evidence(); current.issues = [issue]; const control = capture(current);
    assert.equal(control.bootIdentity.ready, false); rejected(() => control.assertFresh(), 'execution-identity-unready', [issue]);
  }
});
