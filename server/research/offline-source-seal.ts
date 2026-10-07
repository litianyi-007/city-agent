import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fixedFiles = ['package.json', 'package-lock.json', 'playwright.config.ts', 'vite.config.ts', 'tsconfig.json', 'index.html'] as const;
const sourceDirectories = ['src', 'server', 'shared', 'scripts', 'tests'] as const;
const runtimeInput = /\.(?:ts|tsx|mjs|mts|css|js|jsx|cjs|cts|json|html)$/i;
export interface OfflineSourceFile { name: string; sha256: string }

/** Re-enumerate the complete fixed local source scope on every invocation; never reuse an old inventory. */
export async function captureOfflineSources(root: string): Promise<OfflineSourceFile[]> {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('Offline source root must be a non-empty path.');
  const suppliedRoot = path.resolve(root), rootInfo = await fs.lstat(suppliedRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Offline source root must be a regular directory, not a symlink.');
  const canonicalRoot = await fs.realpath(suppliedRoot);
  if (canonicalRoot !== suppliedRoot) throw new Error('Offline source root path must not contain symlink aliases.');
  const names: string[] = [];
  async function infoFor(name: string) {
    const filename = path.join(canonicalRoot, name), info = await fs.lstat(filename);
    if (info.isSymbolicLink() || await fs.realpath(filename) !== filename) throw new Error(`Offline source symlink refused: ${name}`);
    return { filename, info };
  }
  for (const name of fixedFiles) {
    if (!(await infoFor(name)).info.isFile()) throw new Error(`Offline source fixed input must be a regular file: ${name}`);
    names.push(name);
  }
  async function enumerate(directory: string): Promise<void> {
    if (!(await infoFor(directory)).info.isDirectory()) throw new Error(`Offline source scope must be a regular directory: ${directory}`);
    for (const entry of await fs.readdir(path.join(canonicalRoot, directory), { withFileTypes: true })) {
      // Hidden paths are deliberately included. Refuse symlinks even if their names have an unrecognized extension.
      const relative = `${directory}/${entry.name}`, { info } = await infoFor(relative);
      if (info.isDirectory()) await enumerate(relative);
      else if (info.isFile() && runtimeInput.test(entry.name)) names.push(relative);
      else if (runtimeInput.test(entry.name)) throw new Error(`Offline source input must be a regular file: ${relative}`);
    }
  }
  for (const directory of sourceDirectories) await enumerate(directory);
  names.sort();
  return Promise.all(names.map(async name => {
    const { filename, info } = await infoFor(name);
    if (!info.isFile()) throw new Error(`Offline source input changed type: ${name}`);
    return { name, sha256: createHash('sha256').update(await fs.readFile(filename)).digest('hex') };
  }));
}
