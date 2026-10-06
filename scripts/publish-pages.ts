import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Publish only generated public assets, never the project's dirty worktree.
const source = path.resolve('dist-pages'); const repository = 'litianyi-007/city-agent';
const remote = `https://github.com/${repository}.git`;
if (!existsSync(path.join(source, 'submission/demo.mp4')) || !existsSync(path.join(source, 'submission/project-materials.pdf'))) throw new Error('先生成PDF/录屏并完成build:pages。');
function files(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
}
const published = files(source);
const permitted = /^(index\.html|assets\/[A-Za-z0-9_-]+\.(js|css)|submission\/(index\.html|project-materials\.(md|pdf)|demo\.mp4|video-script\.md|prompts\.txt|delivery-source\.txt|[a-z-]+\.json|sources\/[a-z0-9-]+\.pdf))$/;
if (published.some(file => !permitted.test(file))) throw new Error('发布白名单检查失败。');
for (const file of published.filter(file => /\.(js|json|html|txt|md)$/.test(file))) {
  const text = readFileSync(path.join(source, file), 'utf8');
  if (text.includes('/Users/litianyi/') || text.includes('qa-only-not-a-real-credential') || text.includes('docs.popo.netease.com')) throw new Error(`发现非公开内容: ${file}`);
}
const deployment = mkdtempSync(path.join(tmpdir(), 'city-agent-pages-publish-'));
const run = (program: string, args: string[], input?: string) => execFileSync(program, args, { cwd: deployment, encoding: 'utf8', ...(input ? { input } : {}), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const existing = run('git', ['ls-remote', '--heads', remote, 'gh-pages']);
if (existing) run('git', ['clone', '--single-branch', '--branch', 'gh-pages', remote, deployment]);
else { run('git', ['init', '--initial-branch=gh-pages']); run('git', ['remote', 'add', 'origin', remote]); }
run('git', ['config', 'user.name', 'City Agent Deployment']); run('git', ['config', 'user.email', 'deployment@users.noreply.github.com']);
cpSync(source, deployment, { recursive: true }); writeFileSync(path.join(deployment, '.nojekyll'), '');
run('git', ['add', '--', ...published, '.nojekyll']);
if (run('git', ['status', '--porcelain'])) { run('git', ['commit', '-m', 'deploy: publish City Agent survey demo and submission evidence']); run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '--set-upstream', 'origin', 'gh-pages']); }
let pages: { html_url: string; status?: string };
try { pages = JSON.parse(run('gh', ['api', `repos/${repository}/pages`])); }
catch (error) {
  if (!String((error as { stderr?: string }).stderr).includes('404')) throw error;
  try { pages = JSON.parse(run('gh', ['api', '--method', 'POST', `repos/${repository}/pages`, '--input', '-'], JSON.stringify({ source: { branch: 'gh-pages', path: '/' }, build_type: 'legacy' }))); }
  catch (creationError) {
    if (!String((creationError as { stderr?: string }).stderr).includes('409')) throw creationError;
    // A first gh-pages push can enable the site before GET has propagated.
    pages = JSON.parse(run('gh', ['api', `repos/${repository}/pages`]));
  }
}
console.log(JSON.stringify({ url: pages.html_url, pagesStatus: pages.status, commit: run('git', ['rev-parse', 'HEAD']), branch: 'gh-pages', files: published.length, deploymentDirectory: deployment }));
