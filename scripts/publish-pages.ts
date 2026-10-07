import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertPublicText, FROZEN_SUBMISSION_FILES, FROZEN_SUBMISSION_TAG, parsePublishingOptions, selectPagesBuildFiles, verifyPublicSubmission } from '../shared/publishing-contract';

// Never publish the source/dirty worktree or the unreviewed public/submission-next.
const root = path.resolve(import.meta.dirname, '..');
const options = parsePublishingOptions(process.argv.slice(2));
const source = path.join(root, 'dist-pages');
const submission = path.resolve(root, options.submission);
const repository = 'litianyi-007/city-agent'; const remote = `https://github.com/${repository}.git`;
if (!existsSync(source) || !existsSync(submission)) throw new Error('先生成公开审查包并完成build:pages。');
function files(directory: string, prefix = ''): string[] {
  if (lstatSync(directory).isSymbolicLink()) throw new Error('发布目录不可为符号链接。');
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`发布文件不可为符号链接：${prefix}${entry.name}`);
    if (entry.isDirectory()) return files(filename, `${prefix}${entry.name}/`);
    if (!entry.isFile()) throw new Error('发布包只能包含普通文件。');
    return [`${prefix}${entry.name}`];
  }).sort();
}
if (realpathSync(submission) !== submission) throw new Error('审查包目录不可通过符号链接重定向。');
const buildFiles = selectPagesBuildFiles(files(source));
const submissionFiles = files(submission);
if (!submissionFiles.includes('manifest.json')) throw new Error('审查包缺少manifest.json。');
const manifest = verifyPublicSubmission({ manifest: JSON.parse(readFileSync(path.join(submission, 'manifest.json'), 'utf8')),
  files: Object.fromEntries(submissionFiles.filter(name => name !== 'manifest.json').map(name => [name, readFileSync(path.join(submission, name))])) });
const repositoryRead = (args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
if (repositoryRead(['branch', '--show-current']).toString('utf8').trim() !== manifest.branch) throw new Error('发布仅可从登记的虚拟社会分支执行。');
const frozenFiles = repositoryRead(['ls-tree', '-r', '--name-only', FROZEN_SUBMISSION_TAG, 'public/submission']).toString('utf8').trim().split('\n').map(name => name.slice('public/submission/'.length)).sort();
if (JSON.stringify(frozenFiles) !== JSON.stringify([...FROZEN_SUBMISSION_FILES].sort())) throw new Error('冻结Tag旧submission集合与登记白名单不一致。');
for (const name of FROZEN_SUBMISSION_FILES) {
  const expected = repositoryRead(['show', `${FROZEN_SUBMISSION_TAG}:public/submission/${name}`]);
  for (const directory of [path.join(root, 'public/submission'), path.join(source, 'submission')]) {
    if (!readFileSync(path.join(directory, name)).equals(expected)) throw new Error(`旧submission必须与冻结Tag逐字节相同：${name}`);
  }
}
for (const file of buildFiles.filter(file => /\.(js|css|json|html|txt|md)$/.test(file))) assertPublicText(file, readFileSync(path.join(source, file), 'utf8'));

// Record only registered public filenames/bytes/checksums; no Key, source paths or private data.
const published = [...buildFiles, ...submissionFiles.map(name => `submission-next/${name}`)];
const checksums = published.map(name => {
  const value = readFileSync(name.startsWith('submission-next/') ? path.join(submission, name.slice('submission-next/'.length)) : path.join(source, name));
  return { name, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') };
});
if (options.dryRun) {
  console.log(JSON.stringify({ dryRun: true, validated: true, branch: 'gh-pages', reviewedAt: manifest.publicationReview.reviewedAt,
    frozenTag: FROZEN_SUBMISSION_TAG, frozenSubmissionUnchanged: true, unreviewedCandidateIgnored: true,
    publicModelCalls: manifest.realModelCallsThisBatch, files: checksums, externalWrites: 0 }, null, 2));
  process.exit(0);
}
const deployment = mkdtempSync(path.join(tmpdir(), 'city-agent-pages-publish-'));
const run = (program: string, args: string[], input?: string) => execFileSync(program, args, { cwd: deployment, encoding: 'utf8', ...(input ? { input } : {}), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const existing = run('git', ['ls-remote', '--heads', remote, 'gh-pages']);
if (!existing) throw new Error('本次要求保留现有gh-pages，不创建空发布历史。');
run('git', ['clone', '--single-branch', '--branch', 'gh-pages', remote, deployment]);

// A remote pre-existing old submission must be identical as well; never repair it by overwriting.
if (JSON.stringify(files(path.join(deployment, 'submission'))) !== JSON.stringify([...FROZEN_SUBMISSION_FILES].sort())) throw new Error('远端旧submission文件集合与冻结Tag不一致；停止，不删除/修复。');
for (const name of FROZEN_SUBMISSION_FILES) {
  const target = path.join(deployment, 'submission', name);
  if (!existsSync(target) || !readFileSync(target).equals(repositoryRead(['show', `${FROZEN_SUBMISSION_TAG}:public/submission/${name}`]))) throw new Error(`远端旧submission与冻结Tag不一致，停止发布：${name}`);
}
const archive = `milestones/${FROZEN_SUBMISSION_TAG}/index.html`;
if (existsSync(path.join(deployment, archive))) assertPublicText(archive, readFileSync(path.join(deployment, archive), 'utf8'));
if (!existsSync(path.join(deployment, archive))) {
  if (!existsSync(path.join(deployment, 'index.html'))) throw new Error('现有公网入口缺失，无法留底。');
  const legacy = readFileSync(path.join(deployment, 'index.html')); assertPublicText(archive, legacy.toString('utf8'));
  // Preserve the original bytes. Vite's existing /city-agent/assets URLs keep
  // working from the archival path because all old hashed assets are retained.
  if (/\b(?:src|href)=["'](?:\.\.?\/)?assets\//i.test(legacy.toString('utf8'))) throw new Error('旧入口使用相对assets路径；需要独立设计可用归档，不能修改原件。');
  mkdirSync(path.dirname(path.join(deployment, archive)), { recursive: true });
  writeFileSync(path.join(deployment, archive), legacy, { flag: 'wx' });
}
run('git', ['config', 'user.name', 'City Agent Deployment']); run('git', ['config', 'user.email', 'deployment@users.noreply.github.com']);
for (const name of buildFiles.filter(name => !name.startsWith('submission/'))) {
  mkdirSync(path.dirname(path.join(deployment, name)), { recursive: true }); cpSync(path.join(source, name), path.join(deployment, name), { errorOnExist: false });
}
for (const name of submissionFiles) {
  const destination = path.join(deployment, 'submission-next', name); mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(submission, name), destination, { errorOnExist: false });
}
// Refuse stale/unregistered files rather than deleting potentially historical evidence.
if (JSON.stringify(files(path.join(deployment, 'submission-next'))) !== JSON.stringify(submissionFiles)) throw new Error('远端submission-next含未登记旧文件；停止，不自动删除。');
for (const file of checksums) {
  const value = readFileSync(path.join(deployment, file.name));
  if (value.length !== file.bytes || createHash('sha256').update(value).digest('hex') !== file.sha256) throw new Error(`复制后字节复核失败；停止，不提交：${file.name}`);
}
writeFileSync(path.join(deployment, '.nojekyll'), '');
run('git', ['add', '--', ...published.filter(name => !name.startsWith('submission/')), archive, '.nojekyll']);
if (run('git', ['status', '--porcelain'])) {
  run('git', ['commit', '-m', 'deploy: publish reviewed virtual society demo and evidence']);
  run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '--set-upstream', 'origin', 'gh-pages']);
}
// Only update an already configured Pages service; do not change repository settings.
const pages = JSON.parse(run('gh', ['api', `repos/${repository}/pages`])) as { html_url: string; status?: string };
console.log(JSON.stringify({ url: pages.html_url, pagesStatus: pages.status, commit: run('git', ['rev-parse', 'HEAD']), branch: 'gh-pages',
  files: published.length, archivedEntrance: `${pages.html_url}${archive}`, frozenSubmissionUnchanged: true, deploymentDirectory: deployment }));
