import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureOfflineSources } from '../server/research/offline-source-seal';

const fixedFiles = ['package.json', 'package-lock.json', 'playwright.config.ts', 'vite.config.ts', 'tsconfig.json', 'index.html'];
const scopes = ['src', 'server', 'shared', 'scripts', 'tests'];
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'city-source-seal-test-')));
  for (const directory of scopes) await fs.mkdir(path.join(root, directory));
  for (const name of fixedFiles) await fs.writeFile(path.join(root, name), `fixture:${name}`);
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1;');
  await fs.mkdir(path.join(root, 'outside'));
  await fs.writeFile(path.join(root, 'outside', 'ignored.ts'), 'not in the declared source scope');
  return root;
}
async function withFixture(work: (root: string) => Promise<void>) {
  const root = await fixture();
  try { await work(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('source seal independently hashes sorted fixed files and source bytes, stably excluding unrelated directories', async () => {
  await withFixture(async root => {
    const first = await captureOfflineSources(root), second = await captureOfflineSources(root);
    assert.deepEqual(first, second);
    assert.deepEqual(first.map(file => file.name), [...fixedFiles, 'src/index.ts'].sort());
    for (const file of first) assert.equal(file.sha256, createHash('sha256').update(await fs.readFile(path.join(root, file.name))).digest('hex'));
    first[0].sha256 = 'changed snapshot'; assert.notDeepEqual(first, await captureOfflineSources(root));
  });
});

test('every invocation discovers new source files, hidden files/directories, and all declared runtime-input formats', async () => {
  await withFixture(async root => {
    const first = await captureOfflineSources(root);
    await fs.mkdir(path.join(root, 'server', '.hidden'));
    await fs.mkdir(path.join(root, 'server', '.hidden', '.deeper'));
    const additions = ['server/.hidden/.deeper/new.ts', 'src/.private.ts', ...['ts', 'tsx', 'mjs', 'mts', 'css', 'js', 'jsx', 'cjs', 'cts', 'json', 'html']
      .map(extension => `shared/new.${extension}`), 'scripts/uppercase.JS'];
    for (const name of additions) await fs.writeFile(path.join(root, name), `new:${name}`);
    await fs.writeFile(path.join(root, 'tests', 'notes.md'), 'outside code-input formats');
    const second = await captureOfflineSources(root);
    assert.notDeepEqual(first, second);
    assert.deepEqual(second.map(file => file.name), [...first.map(file => file.name), ...additions].sort());
  });
});

test('source byte changes and deletions alter the fresh seal; fixed-file removal fails closed', async () => {
  await withFixture(async root => {
    const first = await captureOfflineSources(root);
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 2;');
    const changed = await captureOfflineSources(root);
    assert.deepEqual(first.map(file => file.name), changed.map(file => file.name)); assert.notDeepEqual(first, changed);
    await fs.unlink(path.join(root, 'src', 'index.ts'));
    const removed = await captureOfflineSources(root); assert.equal(removed.length, first.length - 1);
    assert.equal(removed.some(file => file.name === 'src/index.ts'), false);
    await fs.unlink(path.join(root, 'package.json')); await assert.rejects(captureOfflineSources(root), /ENOENT/);
  });
});

test('fixed file and source scope type errors are rejected rather than silently omitted', async () => {
  await withFixture(async root => {
    await fs.unlink(path.join(root, 'package-lock.json')); await fs.mkdir(path.join(root, 'package-lock.json'));
    await assert.rejects(captureOfflineSources(root), /regular file/);
  });
  await withFixture(async root => {
    await fs.rm(path.join(root, 'tests'), { recursive: true }); await fs.writeFile(path.join(root, 'tests'), 'not a directory');
    await assert.rejects(captureOfflineSources(root), /regular directory/);
  });
});

test('symlinks are refused at the root, fixed files, source roots, hidden directories and any child entry', async () => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'city-source-seal-link-test-'))), target = await fixture();
  try {
    const alias = path.join(parent, 'alias'); await fs.symlink(target, alias, 'dir');
    await assert.rejects(captureOfflineSources(alias), /symlink/);
    await assert.rejects(captureOfflineSources(path.join(alias, 'src')), /symlink/);
  } finally { await fs.rm(parent, { recursive: true, force: true }); await fs.rm(target, { recursive: true, force: true }); }
  for (const scenario of ['fixed', 'scope', 'hidden-directory', 'source-file', 'unrecognized-file'] as const) await withFixture(async root => {
    let link: string, target: string, kind: 'file' | 'dir' = 'file';
    if (scenario === 'fixed') { link = path.join(root, 'package.json'); await fs.unlink(link); target = path.join(root, 'package-lock.json'); }
    else if (scenario === 'scope') { link = path.join(root, 'tests'); await fs.rmdir(link); target = path.join(root, 'outside'); kind = 'dir'; }
    else if (scenario === 'hidden-directory') { link = path.join(root, 'src', '.hidden'); target = path.join(root, 'outside'); kind = 'dir'; }
    else { link = path.join(root, 'shared', scenario === 'source-file' ? 'linked.ts' : 'linked.dat'); target = path.join(root, 'src', 'index.ts'); }
    await fs.symlink(target, link, kind); await assert.rejects(captureOfflineSources(root), /symlink/);
  });
});

test('unreadable source input propagates a read error and never returns a partial successful seal', async context => {
  await withFixture(async root => {
    const original = fs.readFile, failedFile = path.join(await fs.realpath(root), 'src', 'index.ts');
    context.mock.method(fs, 'readFile', async (...args: Parameters<typeof fs.readFile>) => {
      if (args[0] === failedFile) throw Object.assign(new Error('synthetic source read failure'), { code: 'EIO' });
      return original(...args);
    });
    await assert.rejects(captureOfflineSources(root), /synthetic source read failure/);
    context.mock.restoreAll();
    assert.equal((await captureOfflineSources(root)).length, fixedFiles.length + 1);
  });
});

test('missing source scopes and invalid root inputs fail closed', async () => {
  await withFixture(async root => {
    await fs.rm(path.join(root, 'server'), { recursive: true }); await assert.rejects(captureOfflineSources(root), /ENOENT/);
    await assert.rejects(captureOfflineSources(path.join(root, 'package.json')), /regular directory/);
  });
  await assert.rejects(captureOfflineSources(''), /non-empty path/);
});
