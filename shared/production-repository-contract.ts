import { z } from 'zod';

/** Preparation-only contracts. No existing capability, API or executor is enabled. */
export const PRODUCTION_REPOSITORY_CONTRACT_VERSION = 'production-task-repo-v1' as const;
export const PRODUCTION_REPOSITORY_FILES_VERSION = 'production-repo-files-v1' as const;
export const PRODUCTION_REPOSITORY_READINESS_VERSION = 'production-repo-readiness-v1' as const;
export const PRODUCTION_REPOSITORY_SAFETY_SUITE_VERSION = 'production-repo-safety-v1' as const;
export const PRODUCTION_REPOSITORY_TEMPLATE_ID = 'node-http-static-v1' as const;
export const PRODUCTION_REPOSITORY_LIMITS = Object.freeze({
  pathCharacters: 200, segmentCharacters: 80, baseFiles: 256, baseFileBytes: 1048576,
  baseTotalBytes: 8388608, changedFiles: 64, changedFileBytes: 262144, changedTotalBytes: 2097152,
});

const sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected an explicit lowercase SHA-256');
const commit = z.string().regex(/^[a-f0-9]{40}$/, 'Expected an explicit 40-character commit');
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
const uniquePaths = (paths: string[]) => new Set(paths.map(path => path.toLowerCase())).size === paths.length;
const safePath = (value: string) => {
  // Deliberately narrow portable filenames: no URL encoding, shell/glob syntax,
  // Unicode normalization aliases, drive prefixes or hidden/config paths in v1.
  if (!/^[A-Za-z0-9_./-]+$/.test(value) || value.startsWith('/') || value.endsWith('/')) return false;
  return value.split('/').every(part => part.length > 0 && part.length <= PRODUCTION_REPOSITORY_LIMITS.segmentCharacters
    && part !== '.' && part !== '..' && !part.startsWith('.')
    && !/^(?:ssh|secrets?|credentials?|authorized_keys|known_hosts)$/i.test(part)
    && !/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(part)
    && !/\.(?:pem|key|p12|pfx)$/i.test(part));
};
export const repositoryPathSchema = z.string().min(1).max(PRODUCTION_REPOSITORY_LIMITS.pathCharacters)
  .refine(safePath, 'Only portable relative POSIX file paths without hidden/secret paths are permitted');
const protectedPath = (path: string) => path.split('/').some(part =>
  /^(?:tests?|__tests__|gates?|acceptance|contracts?|node_modules)$/i.test(part)
  || /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|gate(?:\.[A-Za-z0-9_-]+)*)$/i.test(part)
  || /\.(?:test|spec)\.[A-Za-z0-9_-]+$/i.test(part));
export const repositoryWritablePathSchema = repositoryPathSchema.refine(path => !protectedPath(path),
  'Dependency manifests, lockfiles and frozen test/Gate locations are controller-owned');

export const repositoryResourceLimitsSchema = z.object({
  cpuCores: z.number().finite().min(0.25).max(2), memoryMiB: z.number().int().min(128).max(2048),
  pids: z.number().int().min(8).max(128), wallClockMs: z.number().int().min(1000).max(120000),
  outputBytes: z.number().int().min(1024).max(1048576), diskBytes: z.number().int().min(8388608).max(134217728),
  tmpBytes: z.number().int().min(1048576).max(16777216),
}).strict().refine(value => value.tmpBytes <= value.diskBytes, 'Temporary storage must fit within the task disk hard quota');

const pathList = (schema: typeof repositoryPathSchema | typeof repositoryWritablePathSchema, maximum: number) =>
  z.array(schema).min(1).max(maximum).refine(uniquePaths, 'Duplicate or case-folded path aliases are forbidden');
export const repositoryTaskInputSchema = z.object({
  version: z.literal(PRODUCTION_REPOSITORY_CONTRACT_VERSION), operation: z.enum(['create', 'feature', 'bugfix']),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('template'), templateId: z.literal(PRODUCTION_REPOSITORY_TEMPLATE_ID) }).strict(),
    z.object({ kind: z.literal('repository'), repositoryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/) }).strict(),
  ]),
  baseCommit: commit, baseTreeHash: sha256,
  brief: z.string().trim().min(3).max(6000), acceptance: z.string().trim().min(1).max(3000),
  scope: z.object({
    readablePaths: pathList(repositoryPathSchema, PRODUCTION_REPOSITORY_LIMITS.baseFiles),
    writablePaths: pathList(repositoryWritablePathSchema, PRODUCTION_REPOSITORY_LIMITS.changedFiles),
    mutationKinds: z.array(z.enum(['create', 'replace', 'delete'])).min(1).max(3)
      .refine(values => new Set(values).size === values.length, 'Duplicate mutation permissions are forbidden'),
    execution: z.object({
      runtimeProfile: z.literal('node22-zero-deps-v1'), entryFile: z.literal('server.mjs'),
      buildTarget: z.literal('node-syntax-v1'), testTarget: z.literal('frozen-node-http-browser-v1'),
      preview: z.literal('loopback-only'), network: z.literal('none'), dependencyInstall: z.literal('none'),
      hostExecution: z.literal('forbidden'), resources: repositoryResourceLimitsSchema,
    }).strict(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if ((value.operation === 'create') !== (value.source.kind === 'template'))
    context.addIssue({ code: 'custom', message: 'Create requires the fixed template; feature/Bug requires a controlled repository', path: ['source'] });
  const allPaths = [...value.scope.readablePaths, ...value.scope.writablePaths];
  const aliases = new Map<string, string>();
  for (const path of allPaths) {
    const key = path.toLowerCase();
    if (aliases.has(key) && aliases.get(key) !== path)
      context.addIssue({ code: 'custom', message: 'Read/write path aliases may not differ by case', path: ['scope'] });
    aliases.set(key, path);
  }
});

export const repositoryFileDescriptorSchema = z.object({
  path: repositoryPathSchema, type: z.literal('regular-file'), sha256,
  bytes: z.number().int().min(0).max(PRODUCTION_REPOSITORY_LIMITS.baseFileBytes),
}).strict();
export const repositoryFileManifestSchema = z.object({
  version: z.literal(PRODUCTION_REPOSITORY_FILES_VERSION), baseCommit: commit, baseTreeHash: sha256,
  files: z.array(repositoryFileDescriptorSchema).min(1).max(PRODUCTION_REPOSITORY_LIMITS.baseFiles),
}).strict().superRefine((value, context) => {
  if (!uniquePaths(value.files.map(file => file.path))) context.addIssue({ code: 'custom', message: 'Duplicate base files are forbidden', path: ['files'] });
  if (value.files.reduce((sum, file) => sum + file.bytes, 0) > PRODUCTION_REPOSITORY_LIMITS.baseTotalBytes)
    context.addIssue({ code: 'custom', message: 'Base file total exceeds the bounded snapshot', path: ['files'] });
});

const content = z.string().refine(value => !value.includes('\0'), 'Binary/NUL-containing file output is unsupported')
  .refine(value => utf8Bytes(value) <= PRODUCTION_REPOSITORY_LIMITS.changedFileBytes, 'File UTF-8 content exceeds the byte limit');
const mutationFields = { path: repositoryWritablePathSchema, type: z.literal('regular-file') };
/** Whole-file patches, never raw diff text or model-specified filesystem modes. */
export const repositoryFilePatchSchema = z.discriminatedUnion('operation', [
  z.object({ ...mutationFields, operation: z.literal('create'), previousSha256: z.null(), content }).strict(),
  z.object({ ...mutationFields, operation: z.literal('replace'), previousSha256: sha256, content }).strict(),
  z.object({ ...mutationFields, operation: z.literal('delete'), previousSha256: sha256, content: z.null() }).strict(),
]);
export const repositoryChangeSetSchema = z.object({
  version: z.literal(PRODUCTION_REPOSITORY_CONTRACT_VERSION), baseCommit: commit, baseTreeHash: sha256,
  files: z.array(repositoryFilePatchSchema).min(1).max(PRODUCTION_REPOSITORY_LIMITS.changedFiles),
}).strict().superRefine((value, context) => {
  if (!uniquePaths(value.files.map(file => file.path))) context.addIssue({ code: 'custom', message: 'Duplicate patch paths are forbidden', path: ['files'] });
  if (value.files.reduce((sum, file) => sum + (file.content === null ? 0 : utf8Bytes(file.content)), 0) > PRODUCTION_REPOSITORY_LIMITS.changedTotalBytes)
    context.addIssue({ code: 'custom', message: 'Patch content total exceeds the bounded byte limit', path: ['files'] });
});

const verified = z.literal(true);
export const repositoryExecutorReadinessSchema = z.object({
  version: z.literal(PRODUCTION_REPOSITORY_READINESS_VERSION), source: z.literal('controller-verification'),
  verificationId: z.string().uuid(), verificationReportSha256: sha256, configurationSha256: sha256,
  verifiedAt: z.iso.datetime({ offset: false }), suiteVersion: z.literal(PRODUCTION_REPOSITORY_SAFETY_SUITE_VERSION),
  runtime: z.object({ engine: z.enum(['docker', 'podman']), version: z.string().max(80).regex(/^\d+\.\d+\.\d+(?:[A-Za-z0-9.+_-]*)$/),
    platform: z.enum(['linux/arm64', 'linux/amd64']), imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
  isolation: z.object({
    mounts: z.literal('task-directory-only'), rootFilesystem: z.literal('read-only'), runUser: z.literal('non-root'),
    capabilities: z.literal('drop-all'), noNewPrivileges: verified, network: z.literal('none'),
    secrets: z.literal('control-plane-only'), dockerSocket: z.literal('not-mounted'), hostExecution: z.literal('forbidden'),
  }).strict(), resources: repositoryResourceLimitsSchema,
  verified: z.object({ runtimeReady: verified, onlyTaskDirectoryMounted: verified, noSensitiveMounts: verified,
    nonRoot: verified, capabilitiesDropped: verified, noPrivilegeEscalation: verified, readOnlyRootFilesystem: verified,
    networkDenied: verified, noSecretsInEnvironment: verified, symbolicLinkEscapeDenied: verified, pathTraversalDenied: verified,
    frozenGateImmutable: verified, processNamespaceIsolated: verified, ipcNamespaceIsolated: verified,
    cpuLimitEnforced: verified, memoryLimitEnforced: verified, pidLimitEnforced: verified, wallClockLimitEnforced: verified,
    outputLimitEnforced: verified, diskQuotaEnforced: verified, cancelStopsProcesses: verified, cancelRemovesResources: verified,
    restartDoesNotResume: verified,
  }).strict(),
}).strict();
const readinessBindingSchema = z.object({ imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), configurationSha256: sha256,
  resources: repositoryResourceLimitsSchema }).strict();

export type RepositoryTaskInput = z.infer<typeof repositoryTaskInputSchema>;
export type RepositoryChangeSet = z.infer<typeof repositoryChangeSetSchema>;
export type RepositoryFileManifest = z.infer<typeof repositoryFileManifestSchema>;
export type RepositoryExecutorReadiness = z.infer<typeof repositoryExecutorReadinessSchema>;
export type RepositoryReadinessBinding = z.infer<typeof readinessBindingSchema>;
export type RepositoryContractIssue = 'invalid-task' | 'invalid-change-set' | 'invalid-base-files' | 'base-mismatch'
  | 'unknown-read-path' | 'scope-mismatch' | 'previous-file-mismatch' | 'executor-unready' | 'executor-binding-mismatch';
export class RepositoryContractError extends Error {
  constructor(readonly code: RepositoryContractIssue) { super(`Controlled repository contract refused: ${code}`); this.name = 'RepositoryContractError'; }
}
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

/** No I/O: callers must independently verify ordinary files, hashes and the actual snapshot tree. */
export function assertRepositoryChangeSet(taskInput: unknown, changeInput: unknown, baseInput: unknown): RepositoryChangeSet {
  const taskResult = repositoryTaskInputSchema.safeParse(taskInput); if (!taskResult.success) throw new RepositoryContractError('invalid-task');
  const changeResult = repositoryChangeSetSchema.safeParse(changeInput); if (!changeResult.success) throw new RepositoryContractError('invalid-change-set');
  const baseResult = repositoryFileManifestSchema.safeParse(baseInput); if (!baseResult.success) throw new RepositoryContractError('invalid-base-files');
  const task = taskResult.data; const changes = changeResult.data; const base = baseResult.data;
  if ([changes, base].some(value => value.baseCommit !== task.baseCommit || value.baseTreeHash !== task.baseTreeHash)) throw new RepositoryContractError('base-mismatch');
  const existing = new Map(base.files.map(file => [file.path, file]));
  if (task.scope.readablePaths.some(path => !existing.has(path))) throw new RepositoryContractError('unknown-read-path');
  const foldedBase = new Map(base.files.map(file => [file.path.toLowerCase(), file.path]));
  for (const file of changes.files) {
    if (!task.scope.writablePaths.includes(file.path) || !task.scope.mutationKinds.includes(file.operation)) throw new RepositoryContractError('scope-mismatch');
    const previous = existing.get(file.path);
    if (foldedBase.has(file.path.toLowerCase()) && foldedBase.get(file.path.toLowerCase()) !== file.path) throw new RepositoryContractError('previous-file-mismatch');
    if (file.operation === 'create' ? previous !== undefined : !previous || previous.sha256 !== file.previousSha256 || !task.scope.readablePaths.includes(file.path))
      throw new RepositoryContractError('previous-file-mismatch');
  }
  return freeze(changes);
}

/** Only accept a separately supplied trusted control-plane verification report.
 * A model cannot set readiness in the task/change schemas. This pure function
 * validates declarations; it does not authenticate a caller or prove a sandbox.
 */
export function assertRepositoryExecutorReady(controllerEvidence: unknown, controllerBinding: unknown): RepositoryExecutorReadiness {
  const result = repositoryExecutorReadinessSchema.safeParse(controllerEvidence);
  const binding = readinessBindingSchema.safeParse(controllerBinding);
  if (!result.success || !binding.success) throw new RepositoryContractError('executor-unready');
  const ready = result.data; const expected = binding.data;
  if (ready.runtime.imageDigest !== expected.imageDigest || ready.configurationSha256 !== expected.configurationSha256
    || (Object.keys(expected.resources) as Array<keyof typeof expected.resources>).some(key => ready.resources[key] !== expected.resources[key]))
    throw new RepositoryContractError('executor-binding-mismatch');
  return freeze(ready);
}
