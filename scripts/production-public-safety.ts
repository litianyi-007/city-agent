import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_SUBTREE = 'production/';
export const PUBLIC_PROJECT_ID = 'city-agent-autonomous-production-public-v1';
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const isFrozenPackageVersion = (value: unknown): value is string => ['mock-package-v1', 'mock-package-v1-qa1', 'mock-package-v2'].includes(value as string);
export function packagePath(name: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid public package path.');
  const rootFiles = new Set(['package-manifest.json', 'requirements.json', 'submission-evidence.json', 'jev-benchmarks.json', 'mixed-and-live-runs.json', 'real-camera-runs.json', 'submission.html', 'production-mock-submission.pdf', 'demo.webm', 'demo.mp4', 'workspace.png', 'metrics.png', 'README.md', 'RUNBOOK.md', 'DESIGN.md', 'EVALUATION.md', 'REQUIREMENTS.md', 'EXPERIMENTS.md', 'VALIDATION.md', 'ISOLATION.md', 'SUBMISSION.md', 'NEXT-STEPS.md', 'PACKAGE-NOTES.md', 'REVIEW.md', 'materials-summary.json', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md', 'CAMERA-04-RESULT.md', 'JEV-RESILIENCE-V3-DESIGN.md', 'JEV-PROTOCOL-AUDIT-CAMERA-03.md', 'BATCH-CAMERA03-CHECKS.md', 'BATCH-CAMERA04-CHECKS.md']);
  if (!rootFiles.has(name) && !['SUBMISSION-INTRODUCTION.md', 'POST-SUBMISSION-PLAN.md'].includes(name) && !/^MOCK-0[1-3]-preview\.png$/.test(name) && !/^CAMERA-0[1-7]\/(?:run\.json|evidence\.json|delivery-manifest\.json|platform-metadata\.json)$/.test(name) && !/^MOCK-0[1-3]\/(?:input\.json|run\.json|intermediate\.json|frozen-contract\.json|gate\.json|events\.ndjson|index\.html|delivery-manifest\.json|evidence\.json)$/.test(name)) throw new Error('File is outside the publication allowlist: ' + name);
  return name;
}
export function publicPath(name: string) { packagePath(name); return /^MOCK-0[1-3]\/index\.html$/.test(name) ? name + '.txt' : name; }
export function assertNoPublishedSecrets(bytes: Buffer, name: string) {
  const text = bytes.toString('utf8');
  if (/apikey_[A-Za-z0-9_=-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) throw new Error('Secret-like material detected in ' + name);
  if (!name.endsWith('.json')) return;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(api[_-]?key|authorization|password|master[_-]?key|secret)$/i.test(key) && typeof child === 'string' && child.trim()) throw new Error('Nonempty credential field detected in ' + name);
      visit(child);
    }
  };
  visit(JSON.parse(text));
}
/** Bind even the directory itself to the isolated worktree, not only its files. */
export async function assertWorktreeDirectory(root: string, directory: string, relativePrefix: string) {
  const prefix = path.resolve(root, relativePrefix);
  if (!path.resolve(directory).startsWith(prefix + path.sep)) throw new Error('Directory is outside this worktree publication scope.');
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Publication directory must be an ordinary directory.');
  const actual = await realpath(directory);
  const actualPrefix = path.resolve(await realpath(root), relativePrefix);
  if (!actual.startsWith(actualPrefix + path.sep)) throw new Error('Publication directory escaped the worktree through a symlink.');
}
export async function checkedFile(root: string, name: string) {
  const destination = path.resolve(root, name);
  if (!destination.startsWith(path.resolve(root) + path.sep)) throw new Error('File escaped publication root.');
  const info = await lstat(destination);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Only ordinary publication files are accepted.');
  const actual = await realpath(destination);
  if (!actual.startsWith(await realpath(root) + path.sep)) throw new Error('Publication file escaped through a symlink.');
  if (info.size > 30_000_000) throw new Error('Publication file exceeds the 30 MB limit.');
  return readFile(actual);
}
export interface PackageManifest {
  version: string; generatedAt: string; platformCommit: string; submissionBaseline: string;
  reportPublisherCommit?: string; publisherCommit?: string; files: Array<{ path: string; sha256: string }>;
  [key: string]: unknown;
}
export async function readCheckedPackage(root: string) {
  const manifestBytes = await checkedFile(root, 'package-manifest.json');
  assertNoPublishedSecrets(manifestBytes, 'package-manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as PackageManifest;
  if (!isFrozenPackageVersion(manifest.version) || !/^[a-f0-9]{40}$/.test(manifest.platformCommit) || manifest.submissionBaseline !== 'b66122c21604fdb2ecdcbafb89c3d5ad8cde1466' || !Array.isArray(manifest.files) || manifest.files.length > 100) throw new Error('Not a registered frozen production demonstration package.');
  const files = new Map<string, Buffer>();
  let total = manifestBytes.length;
  for (const item of manifest.files) {
    packagePath(item.path);
    if (files.has(item.path) || item.path === 'package-manifest.json' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Duplicate or invalid manifest item.');
    const bytes = await checkedFile(root, item.path); total += bytes.length;
    if (total > 100_000_000) throw new Error('Public package exceeds the total size bound.');
    if (sha256(bytes) !== item.sha256) throw new Error('Package hash mismatch: ' + item.path);
    assertNoPublishedSecrets(bytes, item.path); files.set(item.path, bytes);
  }
  for (const required of ['requirements.json', 'submission-evidence.json', 'jev-benchmarks.json', 'mixed-and-live-runs.json', 'production-mock-submission.pdf', 'demo.webm', ...['01', '02', '03'].flatMap(id => ['input.json', 'run.json', 'gate.json', 'index.html', 'delivery-manifest.json', 'evidence.json'].map(name => 'MOCK-' + id + '/' + name))]) if (!files.has(required)) throw new Error('Required public evidence is missing: ' + required);
  files.set('package-manifest.json', manifestBytes);
  return { manifest, files };
}
export interface GitTreeEntry { path: string; sha: string; mode: string; type: string; }
/** Compare whole root subtrees, not just visible landing-page bytes. */
export function assertUnrelatedTreesPreserved(before: GitTreeEntry[], after: GitTreeEntry[]) {
  const stable = (entries: GitTreeEntry[]) => entries.filter(item => item.path !== 'production').map(item => JSON.stringify([item.path, item.sha, item.mode, item.type])).sort();
  if (JSON.stringify(stable(before)) !== JSON.stringify(stable(after))) throw new Error('Publication would modify virtual-society or another root subtree.');
}
