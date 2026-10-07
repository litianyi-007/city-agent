import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { productionEnvironment } from '../config/production-environment.js';
import { assertNoPublishedSecrets, assertUnrelatedTreesPreserved, assertWorktreeDirectory, checkedFile, PUBLIC_PROJECT_ID, PUBLIC_SUBTREE, sha256, type GitTreeEntry } from './production-public-safety.js';

const executeFile = promisify(execFile);
const REPOSITORY = 'litianyi-007/city-agent';
interface PublicManifest { version: string; sourceBranch: string; publisherCommit: string; evidencePlatformCommit: string; materialsBase?: string; versionedEntry?: string; files: Array<{ path: string; sha256: string; bytes: number }> }
export function publishPath(name: string, publisherCommit?: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || !/^(index\.html|publication-manifest\.json|submission\/[A-Za-z0-9._/-]+|previews\/MOCK-0[1-3]\/index\.html|reviews\/[a-f0-9]{40}\/(index\.html|submission\/[A-Za-z0-9._/-]+|previews\/MOCK-0[1-3]\/index\.html))$/.test(name)) throw new Error('Invalid production publication path.');
  const snapshot = /^reviews\/([a-f0-9]{40})\//.exec(name);
  if (snapshot && snapshot[1] !== publisherCommit) throw new Error('Cannot publish another source revision snapshot.');
  return PUBLIC_SUBTREE + name;
}
export async function publishProduction(directory: string, root: string, execute = false) {
  await assertWorktreeDirectory(root, directory, 'output/production-public');
  const git = async (args: string[]) => (await executeFile('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 })).stdout.trim();
  const branch = await git(['branch', '--show-current']); const commit = await git(['rev-parse', 'HEAD']);
  if (branch !== 'feature/autonomous-production' || await git(['status', '--porcelain'])) throw new Error('Publish only a clean, committed production branch.');
  const markerBytes = await checkedFile(directory, 'publication-manifest.json');
  assertNoPublishedSecrets(markerBytes, 'publication-manifest.json');
  const manifest = JSON.parse(markerBytes.toString('utf8')) as PublicManifest;
  if (manifest.version !== PUBLIC_PROJECT_ID || manifest.sourceBranch !== branch || manifest.publisherCommit !== commit || !Array.isArray(manifest.files) || manifest.files.length > 110) throw new Error('Publication provenance differs from the clean production branch.');
  const bytes = new Map<string, Buffer>(); let total = markerBytes.length;
  for (const item of manifest.files) {
    publishPath(item.path, commit); if (bytes.has(item.path) || item.path === 'publication-manifest.json') throw new Error('Duplicate publication path.');
    const content = await checkedFile(directory, item.path); total += content.length;
    if (sha256(content) !== item.sha256 || content.length !== item.bytes) throw new Error('Public file changed after QA: ' + item.path);
    assertNoPublishedSecrets(content, item.path); bytes.set(item.path, content);
  }
  if (total > 100_000_000) throw new Error('Production publication exceeds the total bound.');
  if (manifest.materialsBase !== undefined && manifest.materialsBase !== `reviews/${commit}/submission/`) throw new Error('Materials base differs from the reviewed revision.');
  if (manifest.versionedEntry !== undefined && manifest.versionedEntry !== `reviews/${commit}/index.html`) throw new Error('Versioned entry differs from the reviewed revision.');
  bytes.set('publication-manifest.json', markerBytes);
  const gh = async <T>(endpoint: string, method = 'GET', body?: unknown): Promise<T> => {
    const args = ['api', 'repos/' + REPOSITORY + '/' + endpoint, '--method', method];
    if (body !== undefined) args.push('--input', '-');
    const output = await new Promise<string>((resolve, reject) => {
      // execFile's callback waits for close (stdout drained), enforces maxBuffer
      // and timeout. Do not echo API bodies or CLI stderr into evidence/logs.
      const child = execFile('gh', args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 60_000_000 }, (error, stdout) => error ? reject(new Error('GitHub API refused: ' + method + ' ' + endpoint + '; no forced update attempted.')) : resolve(stdout));
      child.stdin!.on('error', () => reject(new Error('GitHub API input failed: ' + method + ' ' + endpoint)));
      if (body !== undefined) child.stdin!.end(JSON.stringify(body));
    });
    return JSON.parse(output) as T;
  };
  if (!execute) return { dryRun: true, target: 'gh-pages:' + PUBLIC_SUBTREE, publisherCommit: commit, evidencePlatformCommit: manifest.evidencePlatformCommit, files: bytes.size, bytes: total, prohibited: ['root/index.html', 'root/assets/', 'root/submission/', 'main', 'frozen tags'] };
  const sourceRef = await gh<{ object: { sha: string } }>('git/ref/heads/feature/autonomous-production');
  if (sourceRef.object.sha !== commit) throw new Error('Push the reviewed source production commit before publishing.');
  const priorRef = await gh<{ object: { sha: string } }>('git/ref/heads/gh-pages');
  const prior = await gh<{ sha: string; tree: { sha: string } }>('git/commits/' + priorRef.object.sha);
  const priorTree = await gh<{ tree: GitTreeEntry[]; truncated: boolean }>('git/trees/' + prior.tree.sha);
  if (priorTree.truncated) throw new Error('Truncated root tree cannot be safely published.');
  if (priorTree.tree.some(item => item.path === 'production')) {
    const priorMarker = await gh<{ content: string; encoding: string }>('contents/production/publication-manifest.json?ref=gh-pages');
    if (priorMarker.encoding !== 'base64') throw new Error('Unknown existing production subtree.');
    const old = JSON.parse(Buffer.from(priorMarker.content, 'base64').toString('utf8')) as PublicManifest;
    if (old.version !== PUBLIC_PROJECT_ID || old.sourceBranch !== branch) throw new Error('Existing production subtree belongs to another task; refusing to overwrite.');
  }
  const entries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  // Bounded concurrency. Only reviewed allowlisted bytes are uploaded; no GitHub
  // token extraction, repository checkout, deletion, or force-push is involved.
  const queue = [...bytes]; let position = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (position < queue.length) {
      const [name, content] = queue[position++];
      const blob = await gh<{ sha: string }>('git/blobs', 'POST', { content: content.toString('base64'), encoding: 'base64' });
      entries.push({ path: publishPath(name, commit), mode: '100644', type: 'blob', sha: blob.sha });
    }
  }));
  const tree = await gh<{ sha: string }>('git/trees', 'POST', { base_tree: prior.tree.sha, tree: entries });
  const composed = await gh<{ tree: GitTreeEntry[]; truncated: boolean }>('git/trees/' + tree.sha);
  if (composed.truncated) throw new Error('Cannot verify the composed publication tree.');
  assertUnrelatedTreesPreserved(priorTree.tree, composed.tree);
  const latest = await gh<{ object: { sha: string } }>('git/ref/heads/gh-pages');
  if (latest.object.sha !== priorRef.object.sha) throw new Error('Another publisher advanced gh-pages; stop and rebuild on the latest tree. No update was made.');
  const deployment = await gh<{ sha: string }>('git/commits', 'POST', { message: 'deploy(production): publish audited fixture demo and evidence ' + commit.slice(0, 7), tree: tree.sha, parents: [priorRef.object.sha] });
  await gh('git/refs/heads/gh-pages', 'PATCH', { sha: deployment.sha, force: false });
  const finalRef = await gh<{ object: { sha: string } }>('git/ref/heads/gh-pages');
  if (finalRef.object.sha !== deployment.sha) throw new Error('Publication ref changed concurrently after update; inspect the recorded deployment, do not force it.');
  const publicBase = 'https://litianyi-007.github.io/city-agent/production/';
  const result = { version: 'production-publication-receipt-v1', generatedAt: new Date().toISOString(), sourceCommit: commit, evidencePlatformCommit: manifest.evidencePlatformCommit, deploymentCommit: deployment.sha, priorDeploymentCommit: priorRef.object.sha, outsideProductionTreesUnchanged: true, sourceFiles: bytes.size, url: publicBase, versionedUrl: manifest.versionedEntry ? publicBase + manifest.versionedEntry : null, materials: publicBase + (manifest.materialsBase ?? 'submission/') + 'production-mock-submission.pdf', rootTrees: priorTree.tree.filter(item => item.path !== 'production') };
  await writeFile(path.join(directory, 'publication-receipt.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = productionEnvironment(); const index = process.argv.indexOf('--directory');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: npm run production:publish -- --directory output/production-public/review-... [--execute]');
  const directory = path.resolve(environment.root, process.argv[index + 1]);
  if (!directory.startsWith(path.join(environment.root, 'output/production-public') + path.sep)) throw new Error('Publication must use this worktree reviewed public build.');
  console.log(JSON.stringify(await publishProduction(directory, environment.root, process.argv.includes('--execute'))));
}
