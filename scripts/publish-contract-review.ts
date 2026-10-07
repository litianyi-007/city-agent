import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CONTRACT_REVIEW_EXPERIMENT, CONTRACT_REVIEW_FILES, parseContractPublicationOptions, verifyContractReviewFiles } from '../shared/contract-review-publication';
import { assertPublicText, FROZEN_SUBMISSION_FILES, selectPagesBuildFiles } from '../shared/publishing-contract';
import { fingerprint } from '../shared/evidence';

const root = path.resolve(import.meta.dirname, '..');
const { execute } = parseContractPublicationOptions(process.argv.slice(2));
const appendix = path.join(root, 'output/contract-review-appendix', CONTRACT_REVIEW_EXPERIMENT, 'submission-contract11');
const raw = path.join(root, 'output/live-proof', CONTRACT_REVIEW_EXPERIMENT);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const list = (directory: string, prefix = ''): string[] => {
  if (lstatSync(directory).isSymbolicLink()) throw new Error('禁止符号链接发布目录。');
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('禁止符号链接发布文件。');
    const name = prefix + entry.name;
    if (entry.isDirectory()) return list(path.join(directory, entry.name), name + '/');
    if (!entry.isFile()) throw new Error('仅允许普通文件。');
    return [name];
  }).sort();
};
if (JSON.stringify(list(appendix)) !== JSON.stringify([...CONTRACT_REVIEW_FILES, 'manifest.json'].sort())) throw new Error('公开目录与白名单不一致。');
const bytes = Object.fromEntries(CONTRACT_REVIEW_FILES.map(name => [name, readFileSync(path.join(appendix, name))]));
const manifest = verifyContractReviewFiles(JSON.parse(readFileSync(path.join(appendix, 'manifest.json'), 'utf8')), bytes);
for (const name of CONTRACT_REVIEW_FILES.filter(name => !['README.md', 'index.html', 'appendix.pdf'].includes(name))) {
  if (!bytes[name].equals(readFileSync(path.join(raw, name)))) throw new Error(`原始实验副本不一致，禁止回填：${name}`);
}
const plan = JSON.parse(bytes['plan.json'].toString()); const report = JSON.parse(bytes['report.json'].toString());
if (manifest.planHash !== fingerprint(plan) || report.planHash !== manifest.planHash || report.id !== CONTRACT_REVIEW_EXPERIMENT
  || report.realModelCalls !== 5 || report.conservativeCostCny !== 0.042032 || report.budgetState !== 'closed'
  || report.marketResearchValidated !== false || report.mockUsed !== false) throw new Error('实验结果、冻结计划、费用或负结果边界不一致。');
for (const source of plan.sourceFiles) if (hash(readFileSync(path.join(root, source.path))) !== source.sha256) throw new Error(`调用源文件已漂移：${source.path}`);
const build = path.join(root, 'dist-pages'); const buildFiles = selectPagesBuildFiles(list(build));
if (!readFileSync(path.join(build, 'review-guide.html')).equals(readFileSync(path.join(root, 'public/review-guide.html')))
  || !readFileSync(path.join(build, 'review-guide.html'), 'utf8').includes('./submission-contract11/')) throw new Error('评委指南构建过期或缺本轮补充入口；必须重新build:pages。');
const bundle = buildFiles.filter(name => name.endsWith('.js')).map(name => readFileSync(path.join(build, name), 'utf8')).join('\n');
if (!bundle.includes('resident-json-contract-1.1') || !bundle.includes('coverage-survey-2.2-json-contract')) throw new Error('Pages构建没有登记的新居民契约/证据版本。');
const localGit = (args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
if (localGit(['branch', '--show-current']).toString().trim() !== 'feature/virtual-society-next') throw new Error('只能从虚拟社会分支发布。');
for (const name of buildFiles.filter(name => /\.(js|css|html|json|txt|md)$/.test(name))) assertPublicText(name, readFileSync(path.join(build, name), 'utf8'));
const oldFiles = localGit(['ls-tree', '-r', '--name-only', 'society-review-2026-10-07-rc1', 'public/submission-next']).toString().trim().split('\n');
const preserved = [...FROZEN_SUBMISSION_FILES.map(name => ({ name: `submission/${name}`, tag: 'submission-milestone-2026-10-07' })),
  ...oldFiles.map(name => ({ name: name.slice('public/'.length), tag: 'society-review-2026-10-07-rc1' }))];
for (const file of preserved) if (!readFileSync(path.join(root, 'public', file.name)).equals(localGit(['show', `${file.tag}:public/${file.name}`]))) throw new Error(`历史本地材料漂移：${file.name}`);
if (!execute) {
  console.log(JSON.stringify({ dryRun: true, publicPayloads: 27, realModelCalls: 5, newPaidCalls: 0,
    planHash: manifest.planHash, preserves: ['submission', 'submission-next', 'main', 'old-tags', 'L4/L5'], externalWrites: 0 }));
  process.exit(0);
}
const deployment = mkdtempSync(path.join(tmpdir(), 'city-agent-contract11-pages-'));
const run = (program: string, args: string[]) => execFileSync(program, args, { cwd: deployment, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
run('git', ['clone', '--single-branch', '--branch', 'gh-pages', 'https://github.com/litianyi-007/city-agent.git', deployment]);
const previousHead = run('git', ['rev-parse', 'HEAD']);
for (const file of preserved) if (!readFileSync(path.join(deployment, file.name)).equals(localGit(['show', `${file.tag}:public/${file.name}`]))) throw new Error(`远端历史材料漂移：${file.name}`);
if (existsSync(path.join(deployment, 'submission-contract11'))) throw new Error('新实验已发布，禁止覆盖/自动重发。');
const archive = 'milestones/society-review-2026-10-07-rc1/index.html';
if (existsSync(path.join(deployment, archive))) throw new Error('RC1入口归档已存在，需先只读核实，不覆盖。');
const original = readFileSync(path.join(deployment, 'index.html'));
assertPublicText(archive, original.toString());
if (/\b(?:src|href)=["'](?:\.\.?\/)?assets\//i.test(original.toString())) throw new Error('RC1相对资源需独立归档方案。');
mkdirSync(path.dirname(path.join(deployment, archive)), { recursive: true }); writeFileSync(path.join(deployment, archive), original, { flag: 'wx' });
for (const name of buildFiles.filter(name => !name.startsWith('submission/'))) {
  const destination = path.join(deployment, name);
  if (name.startsWith('assets/') && existsSync(destination)) {
    if (!readFileSync(destination).equals(readFileSync(path.join(build, name)))) throw new Error(`已存在hash资源字节不一致，禁止破坏历史入口：${name}`);
    continue;
  }
  mkdirSync(path.dirname(path.join(deployment, name)), { recursive: true }); cpSync(path.join(build, name), path.join(deployment, name));
}
cpSync(appendix, path.join(deployment, 'submission-contract11'), { recursive: true, force: false, errorOnExist: true });
for (const name of [...CONTRACT_REVIEW_FILES, 'manifest.json']) if (!readFileSync(path.join(deployment, 'submission-contract11', name)).equals(readFileSync(path.join(appendix, name)))) throw new Error('补充包复制后字节校验失败。');
for (const file of preserved) if (!readFileSync(path.join(deployment, file.name)).equals(localGit(['show', `${file.tag}:public/${file.name}`]))) throw new Error('历史材料在部署中被改变。');
run('git', ['config', 'user.name', 'City Agent Deployment']); run('git', ['config', 'user.email', 'deployment@users.noreply.github.com']);
run('git', ['add', '--', archive, 'submission-contract11', ...buildFiles.filter(name => !name.startsWith('submission/'))]);
run('git', ['commit', '-m', 'deploy: publish contract11 trial supplement and updated demo']);
run('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'HEAD:gh-pages']);
console.log(JSON.stringify({ url: 'https://litianyi-007.github.io/city-agent/submission-contract11/',
  commit: run('git', ['rev-parse', 'HEAD']), previousHead, publicPayloads: 27, archivedRC1: archive,
  historicalMaterialsUnchanged: true, newPaidCalls: 0, deploymentDirectory: deployment }));
