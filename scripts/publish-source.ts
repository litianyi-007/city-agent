import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';

// An isolated, ordinary main-branch commit: never add the user's dirty worktree.
const root = path.resolve('.'); const remote = 'https://github.com/litianyi-007/city-agent.git';
const destination = mkdtempSync(path.join(tmpdir(), 'city-agent-source-publish-'));
const run = (program: string, args: string[]) => execFileSync(program, args, { cwd: destination, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
run('git', ['clone', '--single-branch', '--branch', 'main', remote, destination]);
const roots = ['README.md', '.gitignore', '.nvmrc', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'src', 'server', 'shared', 'tests', 'scripts', 'data', 'public', 'docs'];
function files(relative: string): string[] {
  if (relative.startsWith('docs/reviews/') || relative.startsWith('docs/archive/')) return [];
  const full = path.join(root, relative);
  const entries = readdirSync(path.dirname(full), { withFileTypes: true }); const entry = entries.find(entry => entry.name === path.basename(full));
  if (!entry) throw new Error(`发布源不存在: ${relative}`);
  return entry.isDirectory() ? readdirSync(full).flatMap(name => files(`${relative}/${name}`)) : [relative];
}
const selected = roots.flatMap(files);
// Compare actual locally configured secrets in memory; never print or copy them.
const privateKeys: string[] = [];
if (existsSync(path.join(root, '.city-agent/encryption.key'))) {
  const cipherKey = readFileSync(path.join(root, '.city-agent/encryption.key'));
  const db = new DatabaseSync(path.join(root, '.city-agent/city-agent.sqlite'), { readOnly: true });
  for (const table of ['agents', 'resident_agents']) for (const row of db.prepare(`SELECT secret FROM ${table} WHERE secret IS NOT NULL`).all()) {
    const payload = Buffer.from(String(row.secret), 'base64'); const decipher = createDecipheriv('aes-256-gcm', cipherKey, payload.subarray(0, 12)); decipher.setAuthTag(payload.subarray(12, 28));
    privateKeys.push(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
  }
  db.close();
}
for (const relative of selected) {
  const bytes = readFileSync(path.join(root, relative));
  if (privateKeys.some(key => key && bytes.includes(Buffer.from(key)))) throw new Error(`检测到实际凭证，阻止发布: ${relative}`);
  if (/\.(ts|tsx|json|md|html|txt|yml)$/.test(relative)) {
    const text = readFileSync(path.join(root, relative), 'utf8');
    if (/sk-[A-Za-z0-9_-]{25,}/.test(text)) throw new Error(`疑似凭证文本: ${relative}`);
  }
  mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
  cpSync(path.join(root, relative), path.join(destination, relative), { recursive: true });
  if (relative.startsWith('docs/') && relative.endsWith('.md')) {
    const text = readFileSync(path.join(destination, relative), 'utf8').replace(/https:\/\/docs\.popo\.netease\.com\/[^)\s>]+/g, '#internal-brief-not-published');
    writeFileSync(path.join(destination, relative), text);
  }
}
// Preserve public project-document archives (not private reviews, queues or raw POPO downloads).
for (const name of ['2026-09-23-before-demo', '2026-09-23-before-population', '2026-10-07-before-audit-fixes', '2026-10-07-before-milestone-report']) {
  const relative = `docs/archive/${name}`;
  if (existsSync(path.join(root, relative))) { cpSync(path.join(root, relative), path.join(destination, relative), { recursive: true }); selected.push(relative); }
}
run('git', ['config', 'user.name', 'City Agent Release']); run('git', ['config', 'user.email', 'release@users.noreply.github.com']);
run('git', ['add', '--', ...roots]);
for (const relative of run('git', ['ls-files', '-z']).split('\0').filter(Boolean)) {
  const bytes = readFileSync(path.join(destination, relative));
  if (privateKeys.some(key => key && bytes.includes(Buffer.from(key)))) throw new Error(`暂存公开文件存在实际凭证: ${relative}`);
  if (relative.startsWith('docs/') && relative.endsWith('.md')) writeFileSync(path.join(destination, relative), bytes.toString('utf8').replace(/https:\/\/docs\.popo\.netease\.com\/[^)\s>]+/g, '#internal-brief-not-published'));
}
run('git', ['add', '--', ...roots]);
if (process.argv.includes('--audit-only')) { console.log(JSON.stringify({ audit: 'passed', files: selected.length, actualSecretsFound: false, directory: destination })); process.exit(0); }
if (run('git', ['status', '--porcelain'])) {
  run('git', ['commit', '-m', 'feat: publish traceable survey runtime and audited submission evidence']);
  run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'main']);
}
console.log(JSON.stringify({ branch: 'main', commit: run('git', ['rev-parse', 'HEAD']), files: selected.length, excluded: ['.city-agent', '.hopper', 'doc', 'docs/reviews', 'other archives', 'output', 'node_modules'], directory: destination }));
