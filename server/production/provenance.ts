import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { productionEnvironment } from '../../config/production-environment.js';

export const PRODUCTION_EXECUTION_IDENTITY_VERSION = 'production-boot-disk-v1' as const;
export const EXECUTION_IDENTITY_LIMITATION = 'Boot disk snapshot and subsequent freshness checks; not proof of already-loaded TS module bytes or an atomic filesystem/security sandbox.' as const;
const SOURCE_DIRECTORIES = ['config', 'server', 'shared', 'src'] as const;
const ROOT_SOURCE_FILES = ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'scripts/production-build-stamp.ts'] as const;
/** The default reader also fingerprints all public .ts/.tsx/.mjs/.css files
 * within the bounded source directories, not just this required minimum. */
export const EXECUTION_IDENTITY_REQUIRED_SOURCES = [
  ...ROOT_SOURCE_FILES,
  'config/production-environment.ts', 'server/index.ts', 'server/types.ts', 'server/gate.ts',
  'server/harness.ts', 'server/harness-literal-prompt.mjs', 'server/usage-observer.ts',
  'server/production/provenance.ts', 'server/production/index.ts', 'server/production/service.ts',
  'server/production/store.ts', 'server/production/pipeline.ts', 'server/production/contracts.ts',
  'server/production/jev.ts', 'server/production/review-context.ts', 'server/production/acceptance-preflight.ts',
  'server/production/camera-gate.ts', 'server/production/preview.ts',
  'shared/production-schema.ts', 'shared/jev-schema.ts', 'shared/production-verifier-rubric.ts',
  'shared/production-coverage.ts', 'shared/production-ledger.ts', 'shared/camera-scene-runtime.ts',
  'shared/camera-hand-worker.ts', 'shared/camera-test-semantics.ts', 'shared/camera-asset-manifest.ts',
  'src/main.tsx', 'src/WorkspaceRouter.tsx', 'src/ProductionWorkspace.tsx', 'src/JevSettings.tsx', 'src/production.css',
] as const;
const MAX_FILE_BYTES = 8_000_000;
const MAX_TOTAL_BYTES = 32_000_000;
const MAX_FILES = 400;
const MAX_DEPTH = 8;
const MAX_DIRECTORY_ENTRIES = 2000;
const ISSUE_CODES: readonly ExecutionIdentityIssue[] = ['git-unknown', 'dirty-worktree', 'source-evidence-invalid', 'source-read-failed', 'build-missing', 'build-invalid', 'build-read-failed', 'build-not-clean', 'build-commit-mismatch', 'snapshot-changed', 'commit-drift', 'source-drift', 'build-drift', 'read-unavailable'];
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const sourceExtension = /\.(?:ts|tsx|mjs|css)$/;

export interface ProductionBuildSnapshot { platformCommit: string; sourceClean: boolean; builtAt: string; }
export interface ExecutionIdentityFile { path: string; sha256: string; bytes: number; }
export type ExecutionIdentityIssue = 'git-unknown' | 'dirty-worktree' | 'source-evidence-invalid' | 'source-read-failed' | 'build-missing' | 'build-invalid' | 'build-read-failed' | 'build-not-clean' | 'build-commit-mismatch' | 'snapshot-changed' | 'commit-drift' | 'source-drift' | 'build-drift' | 'read-unavailable';
/** Trusted pure-test injection, never an HTTP option. No file contents, Keys,
 * environment values, data files or logs cross this evidence boundary. */
export interface ExecutionDiskEvidence {
  commit: string | null;
  sourceClean: boolean | null;
  sourceFiles: ExecutionIdentityFile[];
  buildSnapshot: ProductionBuildSnapshot | null;
  buildFiles: ExecutionIdentityFile[];
  issues?: ExecutionIdentityIssue[];
}
export interface ProductionExecutionIdentity {
  version: typeof PRODUCTION_EXECUTION_IDENTITY_VERSION;
  bootId: string;
  startedAt: string;
  commit: string | null;
  sourceClean: boolean | null;
  sourceFingerprint: string | null;
  sourceFiles: readonly Readonly<ExecutionIdentityFile>[];
  buildSnapshot: Readonly<ProductionBuildSnapshot> | null;
  buildFingerprint: string | null;
  buildFiles: readonly Readonly<ExecutionIdentityFile>[];
  ready: boolean;
  issues: readonly ExecutionIdentityIssue[];
  limitation: typeof EXECUTION_IDENTITY_LIMITATION;
}
export class ExecutionIdentityError extends Error {
  constructor(readonly code: 'execution-identity-unready' | 'execution-identity-drift', readonly issues: readonly ExecutionIdentityIssue[]) {
    super(`生产执行身份不可用于付费请求：${code} (${issues.join(', ')})；请在干净构建后重启本服务。`);
    this.name = 'ExecutionIdentityError';
  }
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const unique = <T>(values: readonly T[]) => [...new Set(values)];
const safeRelative = (value: string) => value !== '' && !value.startsWith('/') && !value.includes('\\') && value.split('/').every(component => component !== '' && component !== '.' && component !== '..' && !component.startsWith('.'));
const allowedSource = (value: string) => safeRelative(value) && ((ROOT_SOURCE_FILES as readonly string[]).includes(value) || SOURCE_DIRECTORIES.some(directory => value.startsWith(`${directory}/`)) && sourceExtension.test(value));
const allowedBuild = (value: string) => safeRelative(value) && (value === 'dist/index.html' || value === 'dist/production-build.json' || value.startsWith('dist/assets/'));

function ordinaryPath(root: string, relative: string, directory = false): string {
  if (!safeRelative(relative)) throw new Error('Invalid public evidence path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Evidence path is outside this worktree');
  const components = relative.split('/'); let cursor = root;
  for (const [index, component] of components.entries()) {
    cursor = path.join(cursor, component); const stat = lstatSync(cursor);
    if (stat.isSymbolicLink() || (index < components.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Evidence must use ordinary files and directories');
  }
  if (realpathSync(target) !== target) throw new Error('Evidence path must not escape through aliases');
  return target;
}
function readOrdinaryFile(root: string, relative: string): Buffer {
  const target = ordinaryPath(root, relative);
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Public evidence file is not bounded');
    const contents = readFileSync(descriptor); const current = lstatSync(target);
    if (contents.length > MAX_FILE_BYTES || contents.length !== stat.size || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino || realpathSync(target) !== target) throw new Error('Public evidence changed during reading');
    return contents;
  } finally { closeSync(descriptor); }
}
function publicFiles(root: string, relative: string, accept: (name: string) => boolean, depth = 0, traversal = { entries: 0 }): string[] {
  if (depth > MAX_DEPTH) throw new Error('Public source directory exceeds traversal limit');
  const target = ordinaryPath(root, relative, true); const files: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (++traversal.entries > MAX_DIRECTORY_ENTRIES) throw new Error('Public evidence directory exceeds entry limit');
    // Hidden state/environment/credentials are not inspected or read.
    if (entry.name.startsWith('.')) continue;
    const child = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Public source directory contains a symbolic link');
    if (entry.isDirectory()) files.push(...publicFiles(root, child, accept, depth + 1, traversal));
    else if (accept(child)) { if (!entry.isFile()) throw new Error('Public evidence is not an ordinary file'); files.push(child); }
    if (files.length > MAX_FILES) throw new Error('Public evidence file count exceeds limit');
  }
  return files;
}
function fingerprints(root: string, names: string[]): ExecutionIdentityFile[] {
  const result = unique(names).sort().map(relative => { const contents = readOrdinaryFile(root, relative); return { path: relative, sha256: digest(contents), bytes: contents.length }; });
  if (result.length > MAX_FILES || result.reduce((sum, file) => sum + file.bytes, 0) > MAX_TOTAL_BYTES) throw new Error('Public evidence exceeds the total byte limit');
  return result;
}
function readGitEvidence(root: string) {
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 5000, maxBuffer: 2_000_000 };
  return { commit: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(), sourceClean: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim() === '' };
}
function validBuild(value: unknown): value is ProductionBuildSnapshot {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'builtAt,platformCommit,sourceClean' && typeof value.platformCommit === 'string' && commitPattern.test(value.platformCommit) && typeof value.sourceClean === 'boolean' && typeof value.builtAt === 'string' && value.builtAt.length <= 40 && Number.isFinite(Date.parse(value.builtAt)) && new Date(value.builtAt).toISOString() === value.builtAt;
}
function readExecutionDiskEvidence(): ExecutionDiskEvidence {
  const result: ExecutionDiskEvidence = { commit: null, sourceClean: null, sourceFiles: [], buildSnapshot: null, buildFiles: [], issues: [] };
  const root = path.resolve(productionEnvironment().root);
  try { if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw new Error('Invalid worktree root'); }
  catch { result.issues!.push('read-unavailable'); return result; }
  try { Object.assign(result, readGitEvidence(root)); } catch { result.issues!.push('git-unknown'); }
  try { result.sourceFiles = fingerprints(root, [...ROOT_SOURCE_FILES, ...SOURCE_DIRECTORIES.flatMap(directory => publicFiles(root, directory, allowedSource))]); }
  catch { result.issues!.push('source-read-failed'); }
  try {
    const contents = readOrdinaryFile(root, 'dist/production-build.json'); const parsed: unknown = JSON.parse(contents.toString('utf8'));
    if (validBuild(parsed)) result.buildSnapshot = parsed; else result.issues!.push('build-invalid');
    result.buildFiles = fingerprints(root, ['dist/production-build.json', 'dist/index.html', ...publicFiles(root, 'dist/assets', allowedBuild)]);
    if (result.buildFiles.find(file => file.path === 'dist/production-build.json')?.sha256 !== digest(contents)) result.issues!.push('snapshot-changed');
  } catch { result.issues!.push('build-read-failed'); }
  try {
    const after = readGitEvidence(root);
    if (after.commit !== result.commit || after.sourceClean !== result.sourceClean) result.issues!.push('snapshot-changed');
  } catch { result.issues!.push('git-unknown'); }
  return result;
}
function validatedFiles(value: unknown, allowed: (name: string) => boolean): ExecutionIdentityFile[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) return null;
  const result: ExecutionIdentityFile[] = [];
  for (const file of value) {
    if (!isRecord(file) || Object.keys(file).sort().join(',') !== 'bytes,path,sha256' || typeof file.path !== 'string' || !allowed(file.path) || typeof file.sha256 !== 'string' || !hashPattern.test(file.sha256) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0 || Number(file.bytes) > MAX_FILE_BYTES) return null;
    result.push({ path: file.path, sha256: file.sha256, bytes: Number(file.bytes) });
  }
  if (new Set(result.map(file => file.path)).size !== result.length || result.reduce((sum, file) => sum + file.bytes, 0) > MAX_TOTAL_BYTES) return null;
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const item of Object.values(value)) freezeDeep(item); Object.freeze(value); }
  return value;
}
function snapshot(reader: () => ExecutionDiskEvidence, bootId: string, startedAt: string): ProductionExecutionIdentity {
  let evidence: ExecutionDiskEvidence;
  try { evidence = reader(); if (!isRecord(evidence)) throw new Error('Unknown disk evidence'); }
  catch { evidence = { commit: null, sourceClean: null, sourceFiles: [], buildSnapshot: null, buildFiles: [], issues: ['read-unavailable'] }; }
  const issues: ExecutionIdentityIssue[] = [];
  if (evidence.issues !== undefined) {
    if (!Array.isArray(evidence.issues) || evidence.issues.some(issue => !ISSUE_CODES.includes(issue))) issues.push('read-unavailable');
    else issues.push(...evidence.issues);
  }
  const commit = typeof evidence.commit === 'string' && commitPattern.test(evidence.commit) ? evidence.commit : null;
  const sourceClean = typeof evidence.sourceClean === 'boolean' ? evidence.sourceClean : null;
  if (commit === null || sourceClean === null) issues.push('git-unknown'); else if (!sourceClean) issues.push('dirty-worktree');
  const sourceFiles = validatedFiles(evidence.sourceFiles, allowedSource);
  if (!sourceFiles || EXECUTION_IDENTITY_REQUIRED_SOURCES.some(name => !sourceFiles.some(file => file.path === name))) issues.push('source-evidence-invalid');
  const buildFiles = validatedFiles(evidence.buildFiles, allowedBuild);
  const buildSnapshot = validBuild(evidence.buildSnapshot) ? { ...evidence.buildSnapshot } : null;
  if (!buildSnapshot) issues.push(evidence.buildSnapshot === null ? 'build-missing' : 'build-invalid');
  if (!buildFiles || !['dist/index.html', 'dist/production-build.json'].every(name => buildFiles.some(file => file.path === name)) || !buildFiles.some(file => file.path.startsWith('dist/assets/'))) issues.push('build-invalid');
  if (buildSnapshot) {
    if (!buildSnapshot.sourceClean) issues.push('build-not-clean');
    if (buildSnapshot.platformCommit !== commit) issues.push('build-commit-mismatch');
    if (Date.parse(buildSnapshot.builtAt) > Date.parse(startedAt)) issues.push('build-invalid');
  }
  const knownIssues = unique(issues);
  return freezeDeep({ version: PRODUCTION_EXECUTION_IDENTITY_VERSION, bootId, startedAt, commit, sourceClean,
    sourceFingerprint: sourceFiles ? digest(JSON.stringify(sourceFiles)) : null, sourceFiles: sourceFiles ?? [],
    buildSnapshot, buildFingerprint: buildFiles ? digest(JSON.stringify({ buildSnapshot, files: buildFiles })) : null, buildFiles: buildFiles ?? [],
    ready: knownIssues.length === 0, issues: knownIssues, limitation: EXECUTION_IDENTITY_LIMITATION });
}

/** Capture exactly once per service boot, never relabel a cached service after
 * disk changes. Caller asserts freshness before every actual paid dispatch.
 * Mock/injected execution does not need this paid guard. */
export function captureProductionExecutionIdentity(options: { reader?: () => ExecutionDiskEvidence; bootId?: string; startedAt?: string } = {}): { bootIdentity: ProductionExecutionIdentity; assertFresh(): void } {
  const reader = options.reader ?? readExecutionDiskEvidence;
  const bootId = options.bootId ?? randomUUID(); const startedAt = options.startedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error('Execution identity start time must be known');
  const bootIdentity = snapshot(reader, bootId, startedAt);
  return Object.freeze({ bootIdentity, assertFresh() {
    if (!bootIdentity.ready) throw new ExecutionIdentityError('execution-identity-unready', bootIdentity.issues);
    const current = snapshot(reader, bootId, new Date().toISOString()); const issues = [...current.issues];
    if (current.commit !== bootIdentity.commit) issues.push('commit-drift');
    if (current.sourceFingerprint !== bootIdentity.sourceFingerprint) issues.push('source-drift');
    if (current.buildFingerprint !== bootIdentity.buildFingerprint) issues.push('build-drift');
    if (issues.length) throw new ExecutionIdentityError('execution-identity-drift', Object.freeze(unique(issues)));
  } });
}

// Legacy read-only metadata helpers. New paid runs use the captured identity.
export function platformCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: productionEnvironment().root, encoding: 'utf8', timeout: 5000 }).trim();
}
export function buildProvenance(): ProductionBuildSnapshot | null {
  try { const value: unknown = JSON.parse(readOrdinaryFile(productionEnvironment().root, 'dist/production-build.json').toString('utf8')); return validBuild(value) ? value : null; }
  catch { return null; }
}
