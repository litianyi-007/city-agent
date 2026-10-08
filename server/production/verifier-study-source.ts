import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types as utilTypes } from 'node:util';

export const VERIFIER_STUDY_SOURCE_VERSION = 'verifier-study-source-v5' as const;
const BRANCH = 'feature/autonomous-production';
const BASELINE = 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466';
// There is deliberately no caller-selected root, filename, Git command or ref.
const ROOT = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));

/** Fixed repository source closure, not an attestation of installed node_modules,
 * Chromium binaries, the host, or an atomic OS-wide filesystem snapshot. */
export const VERIFIER_STUDY_SOURCE_FILES = Object.freeze([
  'server/production/verifier-wire-preflight.ts', 'server/production/verifier-study-preflight.ts',
  'scripts/prepare-production-verifier-study.ts', 'server/production/verifier-study.ts', 'server/production/verifier-study-ledger.ts',
  'server/production/verifier-study-strategy.ts', 'server/production/verifier-corpus-preparation.ts', 'server/production/jev.ts',
  'server/production/contracts.ts', 'server/production/review-context.ts', 'server/production/acceptance-preflight.ts',
  'shared/production-implementation-evidence.ts', 'server/production/implementation-evidence.ts',
  'server/production/output-diagnostics.ts', 'server/production/verifier-diagnostics.ts', 'server/production/verifier-scene-oracle.ts', 'server/production/camera-gate.ts',
  'server/gate.ts', 'server/harness.ts', 'server/harness-literal-prompt.mjs', 'server/usage-observer.ts',
  'shared/production-verifier-challenge-corpus.ts', 'shared/production-verifier-html-corpus-a.ts', 'shared/production-verifier-html-corpus-b.ts',
  'shared/production-verifier-scene-corpus.ts', 'shared/production-verifier-rubric.ts', 'shared/production-schema.ts',
  'shared/production-coverage.ts', 'shared/production-execution-profile.ts', 'shared/jev-schema.ts', 'shared/camera-scene-schema.ts',
  'shared/camera-scene-runtime.ts', 'shared/camera-test-semantics.ts', 'shared/camera-asset-manifest.ts', 'package.json', 'package-lock.json',
  'server/production/verifier-study-source.ts', 'server/production/verifier-study-observed-policy.ts',
  'server/production/verifier-study-transport.ts', 'scripts/run-production-verifier-study-engineering.ts',
  'server/production/store.ts', 'shared/camera-hand-worker.ts',
  'server/production/verifier-study-control.ts', 'server/production/verifier-study-engineering-fixture.ts',
  'server/production/index.ts', 'server/production/provenance.ts', 'config/production-environment.ts',
  'server/production/verifier-study-archive.ts', 'shared/verifier-study-control-schema.ts',
  'shared/production-launch-preflight.ts', 'server/production/launch-preflight.ts',
] as const);

export interface VerifierStudySourceSnapshot {
  commit: string;
  clean: boolean;
  hashes: Record<string, string>;
}

function fail(): never { throw new Error('Verifier study source is invalid, changed, unavailable or outside the fixed production worktree'); }
function git(args: string[]): string {
  try {
    // Do not inherit GIT_DIR / GIT_WORK_TREE / injected config or invoke a
    // configured fsmonitor. These are read-only commands in this module's root.
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return fail(); }
}
function identity(requireProductionBranch = false): { commit: string; clean: boolean } {
  try {
    const branch = git(['branch', '--show-current']);
    if (realpathSync(ROOT) !== ROOT || !lstatSync(ROOT).isDirectory() || lstatSync(ROOT).isSymbolicLink()
      || git(['rev-parse', '--show-toplevel']) !== ROOT || (branch !== BRANCH && (requireProductionBranch || branch !== ''))) return fail();
    const commit = git(['rev-parse', '--verify', 'HEAD']);
    if (!/^[a-f0-9]{40}$/.test(commit)) return fail();
    // Independent reviewer clones may have another directory name and inspect
    // a frozen detached commit. That is read-only engineering, never real mode.
    git(['merge-base', '--is-ancestor', BASELINE, commit]);
    return { commit, clean: git(['status', '--porcelain=v1', '--untracked-files=all']) === '' };
  } catch { return fail(); }
}
function sameFile(a: Stats, b: Stats): boolean {
  return a.isFile() && b.isFile() && a.nlink === 1 && b.nlink === 1
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function sourceHash(relative: typeof VERIFIER_STUDY_SOURCE_FILES[number]): string {
  const file = join(ROOT, relative); let fd: number | undefined;
  try {
    const before = lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 10 * 1024 * 1024 || realpathSync(file) !== file) return fail();
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!sameFile(before, opened)) return fail();
    const bytes = readFileSync(fd);
    if (bytes.byteLength !== opened.size || !sameFile(opened, fstatSync(fd)) || !sameFile(opened, lstatSync(file)) || realpathSync(file) !== file) return fail();
    return createHash('sha256').update(bytes).digest('hex');
  } catch { return fail(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function exactDataObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return fail();
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || names.some(name => !keys.includes(name))) return fail();
  for (const name of names) {
    const property = Object.getOwnPropertyDescriptor(value, name)!;
    if (!property.enumerable || property.get || property.set) return fail();
  }
}
function validateSnapshot(value: unknown): asserts value is VerifierStudySourceSnapshot {
  exactDataObject(value, ['commit', 'clean', 'hashes']);
  if (typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit) || typeof value.clean !== 'boolean') return fail();
  exactDataObject(value.hashes, VERIFIER_STUDY_SOURCE_FILES);
  for (const relative of VERIFIER_STUDY_SOURCE_FILES) if (typeof value.hashes[relative] !== 'string' || !/^[a-f0-9]{64}$/.test(value.hashes[relative] as string)) return fail();
}
function verify(snapshot: VerifierStudySourceSnapshot, requireClean: boolean): void {
  const before = identity(requireClean);
  if (before.commit !== snapshot.commit || (requireClean && (!snapshot.clean || !before.clean))) return fail();
  for (const relative of VERIFIER_STUDY_SOURCE_FILES) if (sourceHash(relative) !== snapshot.hashes[relative]) return fail();
  const after = identity(requireClean);
  if (after.commit !== before.commit || (requireClean && !after.clean)) return fail();
}

/** Actual read-only source evidence. Dirty snapshots are only suitable for
 * engineering; real dispatch must require both frozen and current cleanliness. */
export function snapshotVerifierStudySource(): VerifierStudySourceSnapshot {
  if (arguments.length !== 0) return fail();
  const before = identity();
  const hashes = Object.fromEntries(VERIFIER_STUDY_SOURCE_FILES.map(relative => [relative, sourceHash(relative)]));
  const snapshot = { ...before, hashes };
  // Catch source edits during collection. Callers must also recheck freshness
  // at every dispatch/post-call checkpoint; no check grants future authority.
  verify(snapshot, false);
  if (identity().clean !== before.clean) return fail();
  Object.freeze(hashes); return Object.freeze(snapshot);
}

export function assertVerifierStudySourceFresh(snapshot: VerifierStudySourceSnapshot, requireClean: boolean): void {
  if (arguments.length !== 2 || typeof requireClean !== 'boolean') return fail();
  validateSnapshot(snapshot); verify(snapshot, requireClean);
}
