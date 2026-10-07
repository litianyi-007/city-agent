import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const candidate = path.join(root, 'public/submission-next');
const manifest = JSON.parse(await readFile(path.join(candidate, 'manifest.json'), 'utf8'));
if (manifest.kind !== 'city-agent-review-candidate') throw new Error('只打包登记的申报候选，不读私有配置。');
for (const file of manifest.files) {
  const target = path.resolve(candidate, file.name);
  if (!target.startsWith(candidate + path.sep)) throw new Error('候选附件路径越界。');
  const bytes = await readFile(target);
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`附件不一致：${file.name}`);
}
const directory = path.join(root, 'output/review-packages', randomUUID()); await mkdir(directory, { recursive: true });
const materialsZip = path.join(directory, 'city-agent-review-materials.zip');
execFileSync('zip', ['-q', '-r', materialsZip, '.'], { cwd: candidate });
const sourceDirectory = path.join(directory, 'city-agent-review-source'); await mkdir(sourceDirectory);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0');
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0');
// Deliberate allowlist: no DB, key file, .git, cache, logs, session transcripts, dependencies or output artifacts.
const allowed = /^(?:src\/|server\/|shared\/|scripts\/|tests\/|data\/|public\/|docs\/(?:guides\/|population\/|research\/|prd\/|SOCIETY-NEXT\.md$|ARCHITECTURE\.md$|EVALUATION\.md$)|README\.md$|TRACKER\.md$|package(?:-lock)?\.json$|tsconfig\.json$|vite\.config\.ts$|playwright\.config\.ts$|index(?:-pages)?\.html$|\.nvmrc$|\.gitignore$)/;
const files: { name: string; bytes: number; sha256: string }[] = [];
for (const name of [...new Set([...tracked, ...added])].filter(name => name && allowed.test(name)).sort()) {
  const source = path.resolve(root, name);
  if (!source.startsWith(root + path.sep) || !(await stat(source)).isFile() || /(?:^|\/)(?:\.env|\.city-agent|node_modules|output)(?:\b|\/)/.test(name)) throw new Error('源码白名单包含非法路径。');
  const bytes = await readFile(source); const destination = path.join(sourceDirectory, name);
  await mkdir(path.dirname(destination), { recursive: true }); await cp(source, destination, { errorOnExist: true });
  files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const snapshotHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
await writeFile(path.join(sourceDirectory, 'SOURCE-SNAPSHOT.json'), JSON.stringify({ schemaVersion: '1.0', kind: 'city-agent-local-review-source',
  createdAt: new Date().toISOString(), sourceHead: manifest.sourceHead, branch: manifest.branch, sourceDirty: true,
  publiclyPublished: false, snapshotHash, files, excludes: ['private DB/Key/env', '.git', 'output', 'node_modules', 'docs/archive', 'session transcripts'],
  instructions: 'Node22.22.3: npm ci; npm run setup; npm run build; npm run doctor; npm run start:review. Use a new directory. No Key is needed for complete business fixtures.',
}, null, 2), { flag: 'wx' });
const sourceZip = path.join(directory, 'city-agent-review-source.zip'); execFileSync('zip', ['-q', '-r', sourceZip, path.basename(sourceDirectory)], { cwd: directory });
const archiveHashes = await Promise.all([materialsZip, sourceZip].map(async file => { const bytes = await readFile(file); return { name: path.basename(file), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }));
await writeFile(path.join(directory, 'package-manifest.json'), JSON.stringify({ schemaVersion: '1.0', candidateProofId: manifest.proofId, snapshotHash, sourceFiles: files.length,
  publicRelease: false, archives: archiveHashes }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ directory, materialsZip, sourceZip, snapshotHash, sourceFiles: files.length, privateStoreIncluded: false, published: false }, null, 2));
