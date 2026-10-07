import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_CAPABILITIES, productionRunInputSchema } from '../shared/production-schema.js';
import {
  PRODUCTION_REPOSITORY_CONTRACT_VERSION, PRODUCTION_REPOSITORY_FILES_VERSION, PRODUCTION_REPOSITORY_READINESS_VERSION,
  PRODUCTION_REPOSITORY_SAFETY_SUITE_VERSION, PRODUCTION_REPOSITORY_TEMPLATE_ID, PRODUCTION_REPOSITORY_LIMITS,
  repositoryTaskInputSchema, repositoryFileManifestSchema, repositoryChangeSetSchema, repositoryFileDescriptorSchema,
  repositoryPathSchema, repositoryWritablePathSchema, repositoryExecutorReadinessSchema, repositoryResourceLimitsSchema,
  assertRepositoryChangeSet, assertRepositoryExecutorReady, RepositoryContractError,
  type RepositoryTaskInput, type RepositoryChangeSet, type RepositoryFileManifest, type RepositoryExecutorReadiness,
} from '../shared/production-repository-contract.js';

// Pure declarations only: no files, container, SDK, browser or network executes.
const sha = 'a'.repeat(64); const otherSha = 'b'.repeat(64); const baseCommit = 'c'.repeat(40);
const resources = { cpuCores: 1, memoryMiB: 512, pids: 32, wallClockMs: 30000, outputBytes: 65536, diskBytes: 16777216, tmpBytes: 4194304 };
const copy = <T>(value: T): T => structuredClone(value);
function task(operation: RepositoryTaskInput['operation'] = 'feature'): RepositoryTaskInput {
  return { version: PRODUCTION_REPOSITORY_CONTRACT_VERSION, operation,
    source: operation === 'create' ? { kind: 'template', templateId: PRODUCTION_REPOSITORY_TEMPLATE_ID } : { kind: 'repository', repositoryId: 'controlled-fixture' },
    baseCommit, baseTreeHash: sha, brief: 'Add a bounded application behavior', acceptance: 'The frozen behavior assertions pass',
    scope: { readablePaths: ['server.mjs', 'package.json', 'package-lock.json'], writablePaths: ['server.mjs', 'public/app.js'], mutationKinds: ['create', 'replace'],
      execution: { runtimeProfile: 'node22-zero-deps-v1', entryFile: 'server.mjs', buildTarget: 'node-syntax-v1', testTarget: 'frozen-node-http-browser-v1',
        preview: 'loopback-only', network: 'none', dependencyInstall: 'none', hostExecution: 'forbidden', resources: copy(resources) } } };
}
function files(): RepositoryFileManifest {
  return { version: PRODUCTION_REPOSITORY_FILES_VERSION, baseCommit, baseTreeHash: sha,
    files: ['server.mjs', 'package.json', 'package-lock.json'].map(path => ({ path, type: 'regular-file', sha256: sha, bytes: 100 })) };
}
function changes(): RepositoryChangeSet {
  return { version: PRODUCTION_REPOSITORY_CONTRACT_VERSION, baseCommit, baseTreeHash: sha,
    files: [{ operation: 'replace', type: 'regular-file', path: 'server.mjs', previousSha256: sha, content: '// Unexecuted synthetic source\n' },
      { operation: 'create', type: 'regular-file', path: 'public/app.js', previousSha256: null, content: '// Unexecuted synthetic client\n' }] };
}
function readiness(): RepositoryExecutorReadiness {
  return { version: PRODUCTION_REPOSITORY_READINESS_VERSION, source: 'controller-verification',
    verificationId: '00000000-0000-4000-8000-000000000001', verificationReportSha256: sha, configurationSha256: otherSha,
    verifiedAt: '2026-10-07T00:00:00.000Z', suiteVersion: PRODUCTION_REPOSITORY_SAFETY_SUITE_VERSION,
    runtime: { engine: 'docker', version: '27.5.1', platform: 'linux/arm64', imageDigest: `sha256:${sha}` },
    isolation: { mounts: 'task-directory-only', rootFilesystem: 'read-only', runUser: 'non-root', capabilities: 'drop-all', noNewPrivileges: true,
      network: 'none', secrets: 'control-plane-only', dockerSocket: 'not-mounted', hostExecution: 'forbidden' }, resources: copy(resources),
    verified: { runtimeReady: true, onlyTaskDirectoryMounted: true, noSensitiveMounts: true, nonRoot: true, capabilitiesDropped: true,
      noPrivilegeEscalation: true, readOnlyRootFilesystem: true, networkDenied: true, noSecretsInEnvironment: true,
      symbolicLinkEscapeDenied: true, pathTraversalDenied: true, frozenGateImmutable: true, processNamespaceIsolated: true, ipcNamespaceIsolated: true, cpuLimitEnforced: true, memoryLimitEnforced: true,
      pidLimitEnforced: true, wallClockLimitEnforced: true, outputLimitEnforced: true, diskQuotaEnforced: true,
      cancelStopsProcesses: true, cancelRemovesResources: true, restartDoesNotResume: true } };
}
const binding = () => ({ imageDigest: `sha256:${sha}`, configurationSha256: otherSha, resources: copy(resources) });
const refused = (callback: () => unknown, code: RepositoryContractError['code']) =>
  assert.throws(callback, error => error instanceof RepositoryContractError && error.code === code);

test('preparation-only version is independent and does not expose a production capability or API input', () => {
  assert.equal(PRODUCTION_REPOSITORY_CONTRACT_VERSION, 'production-task-repo-v1');
  assert.deepEqual(PRODUCTION_CAPABILITIES, ['offline-single-html', 'camera-scene-v1']);
  assert.equal(productionRunInputSchema.safeParse({ ...task(), capability: 'task-repo-v1' }).success, false);
});

test('create, feature and Bug declarations require the matching fixed-template or controlled-repository source', () => {
  for (const operation of ['create', 'feature', 'bugfix'] as const) assert.equal(repositoryTaskInputSchema.safeParse(task(operation)).success, true);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task('create'), source: task().source }).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), source: task('create').source }).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task('create'), source: { kind: 'template', templateId: 'arbitrary-template' } }).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), source: { kind: 'repository', repositoryId: '/Users/private/repo' } }).success, false);
});

test('base commit and tree identity are required, exact bounded hex and cannot float to HEAD or a branch', () => {
  for (const baseCommit of ['', 'main', 'HEAD', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40)])
    assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), baseCommit }).success, false);
  for (const baseTreeHash of [null, '', 'sha256:' + sha, 'A'.repeat(64), 'a'.repeat(63)])
    assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), baseTreeHash }).success, false);
  const missing = { ...task() } as Record<string, unknown>; delete missing.baseCommit;
  assert.equal(repositoryTaskInputSchema.safeParse(missing).success, false);
});

test('relative paths reject absolute, traversal, aliases, empty segments, backslashes, controls and hidden/secret locations', () => {
  for (const path of ['/tmp/a.js', '//host/a.js', 'C:/a.js', '../a.js', 'src/../a.js', './a.js', 'src//a.js', 'src/', 'a\\b.js', 'src/\na.js', 'a\0.js',
    '.git/config', 'src/.Git/hooks/post-checkout', '.env', '.env.production', '.ssh/id_rsa', 'ssh/key.txt', 'secrets/token.txt',
    'credentials/token.json', 'id_ed25519', 'id_rsa.backup', 'cert/private.key', 'cert/private.pem', 'src/%2e%2e/a.js', 'src/*.js', 'src/a?.js', 'src/中文.js']) {
    assert.equal(repositoryPathSchema.safeParse(path).success, false, `Unsafe path was accepted: ${JSON.stringify(path)}`);
  }
  for (const path of ['server.mjs', 'src/module_name-1.js', 'public/app.min.js', 'README.md', 'package-lock.json']) assert.equal(repositoryPathSchema.safeParse(path).success, true);
  assert.equal(repositoryPathSchema.safeParse('a'.repeat(81) + '/index.js').success, false);
});

test('dependency/Gate files remain readable but cannot enter any writable or patch path', () => {
  for (const path of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock',
    'tests/check.js', 'src/unit.test.js', 'src/unit.spec.ts', 'gate.js', 'gates/frozen.json', 'acceptance/checks.json', 'contracts/spec.json', 'node_modules/pkg/index.js']) {
    assert.equal(repositoryPathSchema.safeParse(path).success, true);
    assert.equal(repositoryWritablePathSchema.safeParse(path).success, false, `Protected path was writable: ${path}`);
    const next = changes(); next.files[0].path = path; assert.equal(repositoryChangeSetSchema.safeParse(next).success, false);
  }
});

test('permissions are explicit finite profiles rather than arbitrary commands, wildcards, installs or host fallbacks', () => {
  const original = task(); const withExecution = (patch: Record<string, unknown>) => ({ ...original, scope: { ...original.scope, execution: { ...original.scope.execution, ...patch } } });
  for (const patch of [{ network: 'host' }, { dependencyInstall: 'npm-ci' }, { hostExecution: 'allowed' }, { buildTarget: 'sh -c generated' },
    { runtimeProfile: 'arbitrary-runtime' }, { mounts: ['/'] }, { command: 'generated command' }, { entryFile: '../../secret' }])
    assert.equal(repositoryTaskInputSchema.safeParse(withExecution(patch)).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...original, scope: { ...original.scope, mutationKinds: [] } }).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...original, scope: { ...original.scope, mutationKinds: ['replace', 'replace'] } }).success, false);
});

test('duplicate and case-folded aliases are refused within and across all file/scope lists', () => {
  const input = task(); input.scope.writablePaths = ['server.mjs', 'SERVER.mjs']; assert.equal(repositoryTaskInputSchema.safeParse(input).success, false);
  const alias = task(); alias.scope.writablePaths = ['Server.mjs']; assert.equal(repositoryTaskInputSchema.safeParse(alias).success, false);
  const base = files(); base.files.push({ ...base.files[0], path: 'SERVER.mjs' }); assert.equal(repositoryFileManifestSchema.safeParse(base).success, false);
  const change = changes(); change.files.push({ ...change.files[0] }); assert.equal(repositoryChangeSetSchema.safeParse(change).success, false);
});

test('only ordinary-file descriptors/patches are accepted; symlinks, devices, executable modes and raw diff paths cannot be hidden', () => {
  for (const type of ['symlink', 'hardlink', 'directory', 'fifo', 'device', 'socket']) {
    assert.equal(repositoryFileDescriptorSchema.safeParse({ ...files().files[0], type }).success, false);
    const input = changes(); assert.equal(repositoryChangeSetSchema.safeParse({ ...input, files: [{ ...input.files[0], type }] }).success, false);
  }
  assert.equal(repositoryFileDescriptorSchema.safeParse({ ...files().files[0], target: '/private/key' }).success, false);
  assert.equal(repositoryChangeSetSchema.safeParse({ ...changes(), files: [{ ...changes().files[0], mode: 0o4755 }] }).success, false);
  assert.equal(repositoryChangeSetSchema.safeParse({ ...changes(), diff: '--- a/server.mjs\n+++ b/../secret' }).success, false);
});

test('file and total limits use actual UTF-8 output bytes and bounded declared base snapshot bytes', () => {
  const input = changes(); input.files = [{ operation: 'replace', path: 'server.mjs', type: 'regular-file', previousSha256: sha, content: 'x'.repeat(PRODUCTION_REPOSITORY_LIMITS.changedFileBytes) }];
  assert.equal(repositoryChangeSetSchema.safeParse(input).success, true);
  input.files[0].content = '中'.repeat(Math.floor(PRODUCTION_REPOSITORY_LIMITS.changedFileBytes / 3) + 1);
  assert.equal(repositoryChangeSetSchema.safeParse(input).success, false);
  const total = changes(); total.files = Array.from({ length: 9 }, (_, i) => ({ operation: 'create', path: `public/file${i}.js`, type: 'regular-file', previousSha256: null, content: 'x'.repeat(PRODUCTION_REPOSITORY_LIMITS.changedFileBytes) }));
  assert.equal(repositoryChangeSetSchema.safeParse(total).success, false);
  total.files = Array.from({ length: 65 }, (_, i) => ({ operation: 'create', path: `public/file${i}.js`, type: 'regular-file', previousSha256: null, content: '' }));
  assert.equal(repositoryChangeSetSchema.safeParse(total).success, false);
  const base = files(); base.files = Array.from({ length: 9 }, (_, i) => ({ path: `src/file${i}.js`, type: 'regular-file', sha256: sha, bytes: PRODUCTION_REPOSITORY_LIMITS.baseFileBytes }));
  assert.equal(repositoryFileManifestSchema.safeParse(base).success, false);
  assert.equal(repositoryFileDescriptorSchema.safeParse({ ...files().files[0], bytes: Infinity }).success, false);
  assert.equal(repositoryChangeSetSchema.safeParse({ ...changes(), files: [{ ...changes().files[0], content: 'binary\0text' }] }).success, false);
});

test('change validation freezes copies and binds unchanged input/base, precise scope and previous-file hash', () => {
  const input = task(); const output = changes(); const base = files(); const before = copy({ input, output, base });
  const parsed = assertRepositoryChangeSet(input, output, base); assert.deepEqual({ input, output, base }, before);
  assert.equal(Object.isFrozen(parsed), true); assert.equal(Object.isFrozen(parsed.files[0]), true);
  output.files[0].content = 'modified after assertion'; assert.notEqual(parsed.files[0].content, output.files[0].content);
  refused(() => assertRepositoryChangeSet(input, { ...changes(), baseTreeHash: otherSha }, base), 'base-mismatch');
  refused(() => assertRepositoryChangeSet(input, changes(), { ...base, baseCommit: 'd'.repeat(40) }), 'base-mismatch');
  const denied = changes(); denied.files[0].path = 'unauthorized.js'; refused(() => assertRepositoryChangeSet(input, denied, base), 'scope-mismatch');
  const wrongPrevious = changes(); wrongPrevious.files[0].previousSha256 = otherSha; refused(() => assertRepositoryChangeSet(input, wrongPrevious, base), 'previous-file-mismatch');
  const absent = changes(); absent.files = [{ operation: 'replace', path: 'public/app.js', type: 'regular-file', previousSha256: sha, content: '' }];
  refused(() => assertRepositoryChangeSet(input, absent, base), 'previous-file-mismatch');
});

test('create cannot overwrite a base file and delete requires both an explicit permission and matching base hash', () => {
  const create = changes(); create.files = [{ operation: 'create', path: 'server.mjs', type: 'regular-file', previousSha256: null, content: '' }];
  refused(() => assertRepositoryChangeSet(task('create'), create, files()), 'previous-file-mismatch');
  const deletion = changes(); deletion.files = [{ operation: 'delete', path: 'server.mjs', type: 'regular-file', previousSha256: sha, content: null }];
  refused(() => assertRepositoryChangeSet(task(), deletion, files()), 'scope-mismatch');
  const authorized = task('bugfix'); authorized.scope.mutationKinds = ['delete']; assert.doesNotThrow(() => assertRepositoryChangeSet(authorized, deletion, files()));
  assert.equal(repositoryChangeSetSchema.safeParse({ ...deletion, files: [{ ...deletion.files[0], content: 'retained text' }] }).success, false);
  const unreadable = task(); unreadable.scope.readablePaths = ['package.json'];
  refused(() => assertRepositoryChangeSet(unreadable, changes(), files()), 'previous-file-mismatch');
});

test('a valid pure controller declaration has an explicit digest/config/resource binding and immutable copy, not real sandbox evidence', () => {
  const evidence = readiness(); const result = assertRepositoryExecutorReady(evidence, binding());
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.verified), true); assert.equal(Object.isFrozen(result.resources), true);
  evidence.runtime.imageDigest = `sha256:${otherSha}`; assert.equal(result.runtime.imageDigest, `sha256:${sha}`);
  assert.equal(result.source, 'controller-verification'); assert.equal(result.suiteVersion, PRODUCTION_REPOSITORY_SAFETY_SUITE_VERSION);
});

test('every safety verification is mandatory true: false, null, unknown strings or omission fail closed', () => {
  for (const key of Object.keys(readiness().verified)) {
    for (const bad of [false, null, undefined, 'unknown']) {
      const value: Record<string, unknown> = copy(readiness());
      (value.verified as Record<string, unknown>)[key] = bad;
      refused(() => assertRepositoryExecutorReady(value, binding()), 'executor-unready');
    }
    const value: Record<string, unknown> = copy(readiness()); delete (value.verified as Record<string, unknown>)[key];
    assert.equal(repositoryExecutorReadinessSchema.safeParse(value).success, false);
  }
});

test('unbounded or unknown resources, mutable images and missing isolation cannot claim readiness', () => {
  for (const key of Object.keys(resources)) {
    for (const bad of [null, undefined, 0, -1, Infinity, NaN, 1000000000, 'unknown'])
      assert.equal(repositoryResourceLimitsSchema.safeParse({ ...resources, [key]: bad }).success, false);
  }
  for (const patch of [{ runtime: { ...readiness().runtime, imageDigest: 'node:22' } }, { runtime: { ...readiness().runtime, version: 'unknown' } },
    { isolation: { ...readiness().isolation, mounts: 'user-home' } }, { isolation: { ...readiness().isolation, dockerSocket: 'mounted' } },
    { isolation: { ...readiness().isolation, secrets: 'passed-to-build' } }, { isolation: { ...readiness().isolation, network: 'host' } },
    { source: 'model-output' }, { verifiedAt: 'unknown' }, { verificationReportSha256: '' }])
    refused(() => assertRepositoryExecutorReady({ ...readiness(), ...patch }, binding()), 'executor-unready');
  const missing = copy(readiness()) as Record<string, unknown>; delete missing.isolation;
  refused(() => assertRepositoryExecutorReady(missing, binding()), 'executor-unready');
});

test('controller configuration, image or resource mismatches are refused without mutating evidence', () => {
  const evidence = readiness(); const original = copy(evidence);
  refused(() => assertRepositoryExecutorReady(evidence, { ...binding(), imageDigest: `sha256:${otherSha}` }), 'executor-binding-mismatch');
  refused(() => assertRepositoryExecutorReady(evidence, { ...binding(), configurationSha256: sha }), 'executor-binding-mismatch');
  refused(() => assertRepositoryExecutorReady(evidence, { ...binding(), resources: { ...resources, pids: 64 } }), 'executor-binding-mismatch');
  refused(() => assertRepositoryExecutorReady(evidence, undefined), 'executor-unready'); assert.deepEqual(evidence, original);
});

test('model task/patch cannot introduce, override or borrow controller readiness or arbitrary permissions', () => {
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), readiness: readiness() }).success, false);
  assert.equal(repositoryChangeSetSchema.safeParse({ ...changes(), readiness: readiness() }).success, false);
  assert.equal(repositoryChangeSetSchema.safeParse({ ...changes(), resources, apiKey: 'synthetic-token-do-not-use' }).success, false);
  assert.equal(repositoryTaskInputSchema.safeParse({ ...task(), allowedPaths: ['**'], allowAll: true }).success, false);
  const bad: Record<string, unknown> = copy(readiness()); (bad.verified as Record<string, unknown>).diskQuotaEnforced = false;
  refused(() => assertRepositoryExecutorReady(bad, binding()), 'executor-unready');
});

test('invalid input errors remain typed and do not echo source content or secret-like paths', () => {
  for (const [input, output, base, code] of [[null, changes(), files(), 'invalid-task'], [task(), null, files(), 'invalid-change-set'], [task(), changes(), null, 'invalid-base-files']] as const)
    refused(() => assertRepositoryChangeSet(input, output, base), code);
  const unknown = task(); unknown.scope.readablePaths.push('missing.js'); refused(() => assertRepositoryChangeSet(unknown, changes(), files()), 'unknown-read-path');
  try { assertRepositoryExecutorReady({ source: '/private/synthetic-secret-path' }, binding()); assert.fail('Expected rejection'); }
  catch (error) { assert.ok(error instanceof RepositoryContractError); assert.equal(error.message.includes('synthetic-secret'), false); }
});
