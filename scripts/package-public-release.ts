import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertPublicText, FROZEN_SUBMISSION_TAG, verifyPublicSubmission } from '../shared/publishing-contract';

// Reproducible fixed-tree packaging only: no credentials, model calls, Git writes,
// tag creation, network, worktree snapshots, material rewriting or publication.
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2); const tag = 'society-review-2026-10-07-rc1';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
if (args.length !== 3 || args.some(arg => !new RegExp(`^--(?:ref=${tag}|id=${uuid}|submission=output/release-candidate/${uuid}/submission-next)$`).test(arg))) throw new Error('仅接受固定--ref=society-review-2026-10-07-rc1、--id=新UUID及登记公开--submission路径。');
const ref = args.find(arg => arg.startsWith('--ref='))?.slice(6);
const id = args.find(arg => arg.startsWith('--id='))?.slice(5);
const submission = args.find(arg => arg.startsWith('--submission='))?.slice(13);
if (!ref || !id || !submission) throw new Error('必须分别指定一个ref/id/submission，不接受重复选项。');
const git = (arguments_: string[]) => execFileSync('git', arguments_, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
if (git(['branch', '--show-current']).toString('utf8').trim() !== 'feature/virtual-society-next') throw new Error('仅可在虚拟社会分支只读打包，不触main或L4/L5工作树。');
let sourceCommit: string;
try { sourceCommit = git(['rev-parse', '--verify', `refs/tags/${ref}^{commit}`]).toString('utf8').trim(); }
catch { throw new Error(`固定Tag ${ref}尚不存在；先由发布负责人提交源码并创建Tag，脚本不会自动创建或移动Tag。`); }
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('固定源码commit无法解析。');
for (const program of ['zip', 'unzip']) {
  try { execFileSync(program, ['-v'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }); }
  catch { throw new Error(`缺少系统${program}或执行失败。macOS/Linux请安装zip/unzip；Windows请在具备这两个工具的环境中打包。没有生成替代或不完整ZIP。`); }
}
if (git(['check-ignore', '--', `output/public-release-packages/${id}`]).toString('utf8').trim() !== `output/public-release-packages/${id}`) throw new Error('output打包目录必须由gitignore隔离。');
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

async function regularFiles(directory: string, prefix = ''): Promise<string[]> {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('包目录不能为符号链接。');
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`包内不能含符号链接：${prefix}${entry.name}`);
    if (entry.isDirectory()) result.push(...await regularFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`));
    else if (entry.isFile()) result.push(`${prefix}${entry.name}`);
    else throw new Error('包内只允许普通文件。');
  }
  return result.sort();
}
const candidate = path.join(root, submission);
if ((await realpath(candidate)) !== candidate) throw new Error('公开审查包路径不可通过符号链接转向。');
const materialNames = await regularFiles(candidate);
if (!materialNames.includes('manifest.json')) throw new Error('公开审查包缺少manifest。');
const materialManifest = JSON.parse(await readFile(path.join(candidate, 'manifest.json'), 'utf8'));
verifyPublicSubmission({ manifest: materialManifest, files: Object.fromEntries(await Promise.all(materialNames.filter(name => name !== 'manifest.json').map(async name => [name, await readFile(path.join(candidate, name))]))) });
if (materialManifest.files.length !== 77) throw new Error('本次必须打包含24项真实轮的77项完整公开载荷，不接受仅mock包。');

type TreeFile = { name: string; mode: string; type: string; object: string };
function tree(commit: string): TreeFile[] {
  return git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map(record => {
    const match = /^(\d+) (\S+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Git树登记格式无法解析。');
    return { mode: match[1], type: match[2], object: match[3], name: match[4] };
  });
}
const frozen = new Map(tree(FROZEN_SUBMISSION_TAG).map(file => [file.name, file]));
const sourceTree = tree(sourceCommit);
const fixedMaterialNames = sourceTree.filter(file => file.name.startsWith('public/submission-next/')).map(file => file.name.slice('public/submission-next/'.length)).sort();
if (JSON.stringify(fixedMaterialNames) !== JSON.stringify(materialNames)) throw new Error('固定Tag必须包含与审查包相同的77载荷+manifest，不能留下本机材料404或额外未审查文件。');
const fixedMaterials = Object.fromEntries(fixedMaterialNames.map(name => [name, git(['show', `${sourceCommit}:public/submission-next/${name}`])]));
verifyPublicSubmission({ manifest: JSON.parse(fixedMaterials['manifest.json'].toString('utf8')),
  files: Object.fromEntries(Object.entries(fixedMaterials).filter(([name]) => name !== 'manifest.json')) });
for (const name of materialNames) if (!fixedMaterials[name].equals(await readFile(path.join(candidate, name)))) throw new Error(`固定Tag材料与输入审查包逐字节不同：${name}`);
const isPrivatePath = (name: string) => /(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|\.city-agent[^/]*|\.hopper|node_modules|output|dist(?:-pages)?|tmp|session(?:s|-transcripts?)?|transcripts?)(?:\/|$)/i.test(name)
  || /\.(?:db|sqlite(?:3)?|key|pem|p12|pfx)$/i.test(name) || /(?:^|\/)(?:encryption\.key|credentials?\.json|\.DS_Store)$/i.test(name);
const allowed = /^(?:src\/|server\/|shared\/|scripts\/|tests\/|data\/|public\/|docs\/|README\.md$|TRACKER\.md$|package(?:-lock)?\.json$|tsconfig\.json$|vite\.config\.ts$|playwright\.config\.ts$|index(?:-pages)?\.html$|\.nvmrc$|\.gitignore$)/;
const selected: TreeFile[] = []; const excluded: { name: string; reason: string }[] = [];
for (const file of sourceTree) {
  if (file.name.includes('\\') || file.name.startsWith('/') || file.name.split('/').some(part => part === '..' || part === '.')) throw new Error('Git树包含不安全路径。');
  if (!allowed.test(file.name) || isPrivatePath(file.name)) {
    excluded.push({ name: file.name, reason: '源文件白名单/私有与生成目录排除' }); continue;
  }
  if (file.name.startsWith('docs/archive/')) {
    const prior = frozen.get(file.name);
    if (!prior || prior.object !== file.object || prior.mode !== file.mode) { excluded.push({ name: file.name, reason: '新增或变更archive不公开；仅保留冻结Tag已公开且逐字节不变的合法历史' }); continue; }
  }
  if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode)) throw new Error(`源ZIP不支持符号链接/子模块：${file.name}`);
  // Code/tests can contain safe synthetic credential canaries and policy strings.
  // Documents/public metadata must not newly expose internal URLs or local paths.
  if (/^(?:docs\/|README\.md$|TRACKER\.md$|public\/)/.test(file.name) && /\.(?:md|json|html|txt|vtt)$/.test(file.name)) {
    const value = git(['show', `${sourceCommit}:${file.name}`]).toString('utf8');
    try { assertPublicText(file.name, value); }
    catch { throw new Error(`固定Tag文档无法直接公开：${file.name}。请讨论后提供安全固定源码版本或明确排除此文档；脚本不自动改写历史/源码。`); }
  }
  selected.push(file);
}
for (const required of ['package.json', 'package-lock.json', 'README.md', 'src/PagesApp.tsx', 'server/index.ts', 'scripts/launch-review.mjs', 'scripts/doctor.mjs']) {
  if (!selected.some(file => file.name === required)) throw new Error(`固定Tag缺少完整安装源码：${required}`);
}
if (!selected.length) throw new Error('固定Tag源码白名单为空。');

const packagesRoot = path.join(root, 'output/public-release-packages'); await mkdir(packagesRoot, { recursive: true });
const directory = path.join(packagesRoot, id); await mkdir(directory, { recursive: false });
const sourceZip = path.join(directory, 'city-agent-review-source.zip');
git(['archive', '--format=zip', '--prefix=city-agent-review-source/', `--output=${sourceZip}`, sourceCommit, '--', ...selected.map(file => file.name)]);
execFileSync('unzip', ['-q', sourceZip, '-d', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
const sourceDirectory = path.join(directory, 'city-agent-review-source');
const actualNames = await regularFiles(sourceDirectory);
if (JSON.stringify(actualNames) !== JSON.stringify(selected.map(file => file.name).sort()) || actualNames.some(isPrivatePath)) throw new Error('git archive展开结果与登记源码不一致，拒绝交付。');
const sourceFiles = await Promise.all(actualNames.map(async name => {
  const value = await readFile(path.join(sourceDirectory, name));
  if (!value.equals(git(['show', `${sourceCommit}:${name}`]))) throw new Error(`源码归档与固定commit逐字节不一致：${name}`);
  return { name, bytes: value.length, sha256: hash(value) };
}));
const snapshotHash = hash(JSON.stringify(sourceFiles));
const snapshot = { schemaVersion: '1.0', kind: 'city-agent-fixed-tag-review-source', createdAt: new Date().toISOString(),
  fixedTag: tag, sourceCommit, branchScope: 'feature/virtual-society-next', sourceBasis: 'git-archive-fixed-commit-not-dirty-worktree',
  snapshotHash, files: sourceFiles, checksumMeaning: 'byte-integrity-of-selected-fixed-git-tree-not-market-or-model-attestation',
  privateStoreIncluded: false, credentialsIncluded: false, outputIncluded: false, hopperIncluded: false,
  syntheticSecurityTestCanariesMayBePresent: true,
  archivePolicy: 'Only previously public frozen-tag archives with unchanged Git blob/mode are included. Newly added or changed archives/session transcripts are excluded. All public documents, including selected historical archives, pass the strict public-text gate without an exception.',
  reviewedMaterialsIncluded: 'public/submission-next fixed Git tree is independently verified and byte-identical to the explicit reviewed 77-payload material bundle; no unreviewed candidate copy is included.',
  excludes: ['private DB/Key/env directories', '.git', '.hopper', 'output/dist/tmp/node_modules', 'sessions/transcripts', 'unreviewed candidate material tree', 'new or modified docs/archive'],
  excludedFiles: excluded,
  instructions: 'Node22.22.3 (minimum22.19): npm ci; npm run setup; npm run build; npm run doctor; npm run start:review. Use a new directory. No Key is needed for complete engineering fixtures. Published materials are a separate ZIP.',
};
await writeFile(path.join(sourceDirectory, 'SOURCE-SNAPSHOT.json'), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
execFileSync('zip', ['-q', sourceZip, 'city-agent-review-source/SOURCE-SNAPSHOT.json'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
const materialDirectory = path.join(directory, 'city-agent-review-materials'); await mkdir(materialDirectory);
for (const name of materialNames) { const target = path.join(materialDirectory, name); await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(candidate, name), target, { errorOnExist: true }); }
verifyPublicSubmission({ manifest: JSON.parse(await readFile(path.join(materialDirectory, 'manifest.json'), 'utf8')),
  files: Object.fromEntries(await Promise.all(materialNames.filter(name => name !== 'manifest.json').map(async name => [name, await readFile(path.join(materialDirectory, name))]))) });
const materialsZip = path.join(directory, 'city-agent-review-materials.zip');
execFileSync('zip', ['-q', '-r', materialsZip, '.'], { cwd: materialDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
for (const filename of [sourceZip, materialsZip]) execFileSync('unzip', ['-tq', filename], { stdio: ['ignore', 'pipe', 'pipe'] });
const archives = await Promise.all([sourceZip, materialsZip].map(async filename => { const value = await readFile(filename); return { name: path.basename(filename), bytes: value.length, sha256: hash(value) }; }));
await writeFile(path.join(directory, 'package-manifest.json'), JSON.stringify({ schemaVersion: '1.0', fixedTag: tag, sourceCommit,
  sourceSnapshotHash: snapshotHash, sourceFiles: sourceFiles.length, sourceSnapshotJsonSha256: hash(await readFile(path.join(sourceDirectory, 'SOURCE-SNAPSHOT.json'))),
  materialsManifestSha256: hash(await readFile(path.join(materialDirectory, 'manifest.json'))), materialsPayloads: materialManifest.files.length,
  privateStoreIncluded: false, dirtyWorktreeRead: false, publishedByThisScript: false, formalSubmission: 'not-confirmed', archives }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ directory, sourceZip, materialsZip, fixedTag: tag, sourceCommit, sourceFiles: sourceFiles.length,
  sourceSnapshotHash: snapshotHash, materialsPayloads: materialManifest.files.length, privateStoreIncluded: false, published: false, externalWrites: 0 }, null, 2));
