import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../shared/evidence';
import { assertPublicText } from '../shared/publishing-contract';
import { assertReviewPagesPreserved, parseReviewUpdateOptions, REVIEW_UPDATE_ARCHIVE, REVIEW_UPDATE_BRANCH, REVIEW_UPDATE_DIRECTORY, REVIEW_UPDATE_FILES,
  REVIEW_UPDATE_REPOSITORY, REVIEW_UPDATE_TAG, selectReviewUpdateBuildFiles, verifyReviewLiveSummary, verifyReviewOfflineProof, verifyReviewUpdateFiles } from '../shared/review-update-publication';
import { captureOfflineSources } from '../server/research/offline-source-seal';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';

// Deliberately independent of publish-source, all credential/SQLite code, model APIs and build commands.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const remote = `https://github.com/${REVIEW_UPDATE_REPOSITORY}.git`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: 'en_US.UTF-8' };
async function regular(filename: string, directory = false, maxBytes = 64 * 1024 * 1024) {
  const info = await lstat(filename);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || await realpath(filename) !== filename
    || !directory && info.size > maxBytes) throw new Error('Noncanonical, nonregular or oversized publication input.');
}
async function read(filename: string, maxBytes?: number) { await regular(filename, false, maxBytes); return readFile(filename); }
async function list(directory: string, prefix = ''): Promise<string[]> {
  await regular(directory, true);
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name), name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Publication directory contains a symlink.');
    if (entry.isDirectory()) result.push(...await list(full, name + '/'));
    else { await regular(full); result.push(name); }
  }
  return result.sort();
}
function command(cwd: string, program: 'git' | 'gh', args: string[]): Buffer {
  try { return execFileSync(program, args, { cwd, env, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }); }
  catch { throw new Error(`Fixed ${program} publication command failed; external stderr is withheld.`); }
}
const git = (cwd: string, args: string[]) => command(cwd, 'git', args);
function sourceHead() { return git(root, ['rev-parse', 'HEAD']).toString().trim(); }
async function ensurePagesConfiguration() {
  const pages = JSON.parse(command(root, 'gh', ['api', `repos/${REVIEW_UPDATE_REPOSITORY}/pages`]).toString());
  if (pages.source?.branch !== 'gh-pages' || pages.source?.path !== '/' || pages.html_url !== 'https://litianyi-007.github.io/city-agent/') throw new Error('Existing Pages branch/root configuration differs; settings will not be changed.');
}
async function trackedSnapshot(directory: string) {
  const snapshot: Record<string, string> = {};
  for (const entry of git(directory, ['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean)) {
    const match = /^(100644|100755) [a-f0-9]{40} 0\t([^\u0000-\u001f]+)$/.exec(entry);
    if (!match || match[2].startsWith('/') || match[2].split('/').some(part => !part || ['.', '..'].includes(part)) || /\\/.test(match[2])) throw new Error('Nonregular or unsafe tracked Pages input.');
    snapshot[match[2]] = hash(await read(path.join(directory, match[2]), 512 * 1024 * 1024));
  }
  return snapshot;
}
async function main() {
  const options = parseReviewUpdateOptions(process.argv.slice(2));
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node22 is required.');
  await regular(root, true);
  if (git(root, ['branch', '--show-current']).toString().trim() !== REVIEW_UPDATE_BRANCH) throw new Error('Only the existing virtual-society feature branch is authorized.');
  const proofDirectory = path.join(root, options.proof); await regular(proofDirectory, true);
  const publicDirectory = path.join(root, 'public', REVIEW_UPDATE_DIRECTORY);
  if (fingerprint(await list(publicDirectory)) !== fingerprint([...REVIEW_UPDATE_FILES].sort())) throw new Error('Public review directory must contain exactly three files.');
  const payload: Record<string, Buffer> = Object.fromEntries(await Promise.all(REVIEW_UPDATE_FILES.map(async name => [name, await read(path.join(publicDirectory, name), 256_000)] as const)));
  const status = verifyReviewUpdateFiles(payload);
  if (status.engineering.proofId !== path.basename(options.proof)) throw new Error('Public status selects a different offline proof.');
  const logs: Record<string, Buffer> = Object.fromEntries(await Promise.all(['unit', 'browser', 'responses', 'pages-build'].flatMap(job => ['stdout', 'stderr'].map(async kind => {
    const name = `${job}.${kind}.log`; return [name, await read(path.join(proofDirectory, name), 16 * 1024 * 1024)] as const;
  }))));
  const reportBytes = await read(path.join(proofDirectory, 'report.json'), 4_000_000), report = JSON.parse(reportBytes.toString('utf8'));
  const historyBytes = await read(path.join(proofDirectory, 'historical-integrity.json'), 2_000_000), history = JSON.parse(historyBytes.toString('utf8'));
  const responseSummary = JSON.parse(logs['responses.stdout.log'].toString('utf8'));
  const childDirectory = responseSummary.directory;
  if (typeof childDirectory !== 'string' || !/^responses-[A-Za-z0-9]{6}$/.test(path.basename(childDirectory))
    || path.dirname(childDirectory) !== path.join(root, 'output/offline-review') || path.resolve(childDirectory) !== childDirectory) throw new Error('Unregistered Responses child proof path.');
  await regular(childDirectory, true);
  const currentSources = await captureOfflineSources(root), currentHistory = await verifyHistoricalEvidence(root, 'local-full');
  const engineering = verifyReviewOfflineProof({ proofId: status.engineering.proofId, report, logs, history, currentSources, currentHistory,
    responses: { report: JSON.parse((await read(path.join(childDirectory, 'report.json'), 1_000_000)).toString('utf8')),
      tap: await read(path.join(childDirectory, 'tests.tap'), 2_000_000), history: JSON.parse((await read(path.join(childDirectory, 'historical-integrity.json'), 2_000_000)).toString('utf8')) } });
  if (fingerprint(engineering) !== fingerprint(status.engineering)) throw new Error('Public engineering summary differs from complete tested proof.');
  const liveHashes: Record<string, string> = {};
  for (const summary of status.liveRuns) {
    const directory = path.join(root, 'output/live-capability-proof', summary.experimentId); await regular(directory, true);
    const bytes = await read(path.join(directory, 'report.json'), 2_000_000);
    verifyReviewLiveSummary(summary, JSON.parse(bytes.toString('utf8')), JSON.parse((await read(path.join(directory, 'budget-ledger.json'), 512_000)).toString('utf8')), bytes);
    liveHashes[summary.experimentId] = hash(bytes);
  }
  const buildDirectory = path.join(root, 'dist-pages'), buildNames = selectReviewUpdateBuildFiles(await list(buildDirectory));
  const build: Record<string, Buffer> = Object.fromEntries(await Promise.all(buildNames.map(async name => [name, await read(path.join(buildDirectory, name))] as const)));
  for (const [name, bytes] of Object.entries(build)) assertPublicText(name, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const guide = await read(path.join(root, 'public/review-guide.html'));
  if (!build['review-guide.html'].equals(guide) || !guide.toString('utf8').includes(`./${REVIEW_UPDATE_DIRECTORY}/`)
    || !guide.toString('utf8').includes(REVIEW_UPDATE_TAG)) throw new Error('Built reviewer guide is stale or missing the fixed release/update entry.');
  const recheckInputs = async () => {
    if (fingerprint(await captureOfflineSources(root)) !== fingerprint(currentSources) || fingerprint(await verifyHistoricalEvidence(root, 'local-full')) !== fingerprint(currentHistory)
      || hash(await read(path.join(proofDirectory, 'report.json'))) !== hash(reportBytes) || hash(await read(path.join(proofDirectory, 'historical-integrity.json'))) !== hash(historyBytes)) throw new Error('Source/proof/history drifted during publication.');
    for (const [name, bytes] of Object.entries(payload)) if (hash(await read(path.join(publicDirectory, name))) !== hash(bytes)) throw new Error('Public projection drifted during publication.');
    for (const [name, bytes] of Object.entries(build)) if (hash(await read(path.join(buildDirectory, name))) !== hash(bytes)) throw new Error('Built UI drifted during publication.');
    for (const [id, digest] of Object.entries(liveHashes)) if (hash(await read(path.join(root, 'output/live-capability-proof', id, 'report.json'))) !== digest) throw new Error('Closed live original report drifted during publication.');
  };
  await recheckInputs();
  if (!options.execute) {
    console.log(JSON.stringify({ dryRun: true, validated: true, externalWrites: 0, newProviderRequests: 0, proofId: engineering.proofId,
      engineering, publicFiles: REVIEW_UPDATE_FILES.length, liveRunSummaries: status.liveRuns.length, sourceHead: sourceHead(), sourceTagChecked: false,
      proofMeaning: 'Working-tree runtime bytes match the offline run; this is not a test performed at a new publication commit.',
      preserves: ['main', 'old-tags', 'all-existing-Pages-files-except-archived-entries', 'L4/L5'] }, null, 2));
    return;
  }
  const head = sourceHead();
  if (git(root, ['rev-parse', `${REVIEW_UPDATE_TAG}^{commit}`]).toString().trim() !== head) throw new Error('Fixed source tag must point to the current committed HEAD.');
  const remoteRefs = git(root, ['ls-remote', remote, `refs/heads/${REVIEW_UPDATE_BRANCH}`, `refs/tags/${REVIEW_UPDATE_TAG}`, `refs/tags/${REVIEW_UPDATE_TAG}^{}`]).toString().trim().split('\n');
  const refs = Object.fromEntries(remoteRefs.filter(Boolean).map(line => line.split('\t').reverse()));
  if (refs[`refs/heads/${REVIEW_UPDATE_BRANCH}`] !== head || (refs[`refs/tags/${REVIEW_UPDATE_TAG}^{}`] ?? refs[`refs/tags/${REVIEW_UPDATE_TAG}`]) !== head) throw new Error('Reviewed source branch/tag must already be published at HEAD.');
  for (const file of currentSources) if (hash(git(root, ['show', `${head}:${file.name}`])) !== file.sha256) throw new Error('Tested runtime bytes are not fully included in the source commit.');
  for (const [name, bytes] of Object.entries(payload)) if (hash(git(root, ['show', `${head}:public/${REVIEW_UPDATE_DIRECTORY}/${name}`])) !== hash(bytes)) throw new Error('Public projection must already be included in the source commit.');
  if (!git(root, ['show', `${head}:public/review-guide.html`]).equals(guide)) throw new Error('Reviewer guide is not included in the source commit.');
  await ensurePagesConfiguration();
  const deployment = await mkdtemp(path.join(await realpath(tmpdir()), 'city-agent-reviewed-pages-'));
  git(deployment, ['clone', '--depth', '1', '--single-branch', '--branch', 'gh-pages', remote, deployment]);
  const previousHead = git(deployment, ['rev-parse', 'HEAD']).toString().trim(), before = await trackedSnapshot(deployment);
  for (const required of ['submission/', 'submission-next/', 'submission-contract11/']) if (!Object.keys(before).some(name => name.startsWith(required))) throw new Error('An existing historical material tree is missing.');
  for (const directory of [REVIEW_UPDATE_DIRECTORY, REVIEW_UPDATE_ARCHIVE]) {
    try { await lstat(path.join(deployment, directory)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('This update/archive already exists; automatic overwrite or redeployment is prohibited.');
  }
  const planned: Record<string, Buffer> = {};
  for (const name of ['index.html', 'review-guide.html']) {
    const original = await read(path.join(deployment, name)); assertPublicText(name, new TextDecoder('utf-8', { fatal: true }).decode(original));
    planned[`${REVIEW_UPDATE_ARCHIVE}/${name}`] = original;
  }
  for (const [name, bytes] of Object.entries(build)) {
    if (name.startsWith('assets/') && Object.hasOwn(before, name) && before[name] !== hash(bytes)) throw new Error('Existing hashed asset collides with different bytes.');
    planned[name] = bytes;
  }
  for (const [name, bytes] of Object.entries(payload)) planned[`${REVIEW_UPDATE_DIRECTORY}/${name}`] = bytes;
  for (const [name, bytes] of Object.entries(planned)) {
    const destination = path.join(deployment, name); await mkdir(path.dirname(destination), { recursive: true });
    if (Object.hasOwn(before, name)) { if (name === 'index.html' || name === 'review-guide.html') await writeFile(destination, bytes); }
    else await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    if (hash(await read(destination)) !== hash(bytes)) throw new Error('Deployed copy differs from reviewed bytes.');
  }
  const after: Record<string, string> = {};
  for (const name of Object.keys(before)) after[name] = hash(await read(path.join(deployment, name), 512 * 1024 * 1024));
  const archives = Object.fromEntries(await Promise.all(['index.html', 'review-guide.html'].map(async name => {
    const relative = `${REVIEW_UPDATE_ARCHIVE}/${name}`; return [relative, hash(await read(path.join(deployment, relative)))];
  })));
  assertReviewPagesPreserved(before, after, archives);
  await recheckInputs(); await ensurePagesConfiguration();
  if (sourceHead() !== head) throw new Error('Source HEAD changed before Pages commit.');
  git(deployment, ['config', 'user.name', 'City Agent Deployment']); git(deployment, ['config', 'user.email', 'deployment@users.noreply.github.com']);
  git(deployment, ['add', '--', ...Object.keys(planned).sort()]);
  const staged = git(deployment, ['diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean).sort();
  const expected = Object.keys(planned).filter(name => before[name] !== hash(planned[name])).sort();
  if (fingerprint(staged) !== fingerprint(expected) || git(deployment, ['diff', '--name-only', '-z']).length !== 0) throw new Error('Staged/unstaged Pages changes exceed the reviewed explicit file list.');
  git(deployment, ['commit', '-m', 'deploy: publish reviewed virtual society rc3 and capability evidence']);
  const deployedHead = git(deployment, ['rev-parse', 'HEAD']).toString().trim();
  git(deployment, ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'HEAD:gh-pages']);
  const receiptParent = path.join(root, 'output/pages-review-publish'); await mkdir(receiptParent, { recursive: true, mode: 0o700 }); await regular(receiptParent, true);
  const receiptDirectory = await mkdtemp(path.join(receiptParent, 'review-'));
  const receipt = { version: 'review-update-publication-receipt-1.0', pushedAt: new Date().toISOString(), repository: REVIEW_UPDATE_REPOSITORY,
    sourceBranch: REVIEW_UPDATE_BRANCH, sourceTag: REVIEW_UPDATE_TAG, sourceHead: head, previousPagesHead: previousHead, pagesHead: deployedHead,
    proofId: engineering.proofId, sourceInventorySha256: engineering.sourceInventorySha256, proofReportSha256: hash(reportBytes), historicalFiles: 179,
    existingTrackedFiles: Object.keys(before).length, existingTrackedInventorySha256: fingerprint(before), existingNonentryFilesPreserved: true,
    archivedEntries: Object.keys(archives), changedFiles: staged, files: Object.entries(planned).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: hash(bytes) })),
    liveRunReportHashes: liveHashes, publicUrl: `https://litianyi-007.github.io/city-agent/${REVIEW_UPDATE_DIRECTORY}/`,
    newProviderRequests: 0, pagesSettingsChanged: false, liveHttpVerified: false, sourceWorkspaceModifiedByPublisher: false };
  await writeFile(path.join(receiptDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ pushed: true, pagesHead: deployedHead, previousPagesHead: previousHead, sourceHead: head, publicUrl: receipt.publicUrl,
    receipt: path.relative(root, path.join(receiptDirectory, 'receipt.json')), newProviderRequests: 0, liveHttpVerified: false }, null, 2));
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : 'Reviewed Pages publication failed.'); process.exitCode = 1; }
