import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductionRun } from '../shared/production-schema.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { demoHtml } from '../server/production/fixtures.js';
import { productionEnvironment } from '../config/production-environment.js';
import { historicalIframeVideo, renderProductionPortal, type ProductionPortalRequirement } from './production-portal.js';
import { MATERIALS_VERSION } from './production-materials.js';
import { buildMaterialZipSnapshot } from './production-material-zip.js';
import { assertNoPublishedSecrets, assertWorktreeDirectory, PUBLIC_PROJECT_ID, publicPath, readCheckedPackage, sha256, type PackageManifest } from './production-public-safety.js';
import { verifyVerifierReal02Materials } from './production-study-materials.js';

export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function productionReviewLayout(commit: string) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Public reviewer snapshots require a full immutable publisher commit.');
  const base = 'reviews/' + commit + '/';
  return { base, materialsBase: base + 'submission/', previewsBase: base + 'previews/', versionedEntry: base + 'index.html' };
}
export function preferredPublicVideo(files: ReadonlyMap<string, Buffer>): 'demo.mp4' | 'demo.webm' {
  if (files.has('demo.mp4')) return 'demo.mp4';
  if (files.has('demo.webm')) return 'demo.webm';
  throw new Error('Public materials need a registered MP4 or historical WebM recording.');
}
/** Probe the checked bytes, never the mutable original package path. A seekable
 * private snapshot also avoids ffprobe closing a large stdin pipe early. */
export async function probeCheckedVideoDuration(videoBytes: Buffer, root: string, ownedPublicationDirectory: string): Promise<number> {
  if (!videoBytes.length || videoBytes.length > 30_000_000) throw new Error('Video snapshot exceeds the checked publication file bounds.');
  const snapshot = Buffer.from(videoBytes);
  await assertWorktreeDirectory(root, ownedPublicationDirectory, 'output/production-public');
  const directory = await mkdtemp(path.join(ownedPublicationDirectory, '.video-probe-'));
  const filename = path.join(directory, 'video.bin');
  let failure: unknown;
  try {
    await writeFile(filename, snapshot, { flag: 'wx', mode: 0o600 });
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '-i', filename], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 1_000_000 })) as { format?: { duration?: string } };
    const duration = Number(info?.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('Video duration could not be verified.');
    return duration;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rmdir(directory);
    } catch (cleanupError) {
      if (failure !== undefined) throw new AggregateError([failure, cleanupError], 'Video probe failed and its owned snapshot could not be removed.');
      throw cleanupError;
    }
  }
}
export function assertCurrentReviewedPackage(manifest: Record<string, unknown>, files: ReadonlyMap<string, Buffer>, commit: string): void {
  if (manifest.version !== 'mock-package-v2' || manifest.materialsVersion !== MATERIALS_VERSION || manifest.publisherCommit !== commit || !['REVIEW.md', 'materials-summary.json', 'REVIEWER-GUIDE.md', 'SUBMISSION-REPORT.md'].every(name => files.has(name))) throw new Error('Export the current reviewed material snapshot and reviewer documents before publication; a historical PDF cannot impersonate this report commit.');
}
export function trustedFixturePreview(run: ProductionRun, original: Buffer) {
  const demo = PRODUCTION_DEMO_CASES.find(item => item.id === run.input.requirement.id);
  // An iframe CSP does not block self-navigation. Only this byte-identical,
  // platform-authored fixture is allowed to execute in the public visitor UI.
  if (run.evidenceKind !== 'fixture' || !demo || run.input.brief !== demo.brief || run.input.requirement.acceptance !== demo.acceptance || run.input.demoCaseId !== demo.operation || original.toString('utf8') !== demoHtml(run.input)) throw new Error('Public interactive preview accepts only exact registered trusted fixture bytes.');
  return original.toString('utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">');
}
interface PublicRenderMetadata { publisherCommit: string; generatedAt: string; videoDurationSeconds: number; videoName: string; videoSourceCommit: string; sourcePackageManifestSha256: string; materialsBase: string; previewsBase: string; versionedEntry: string; evidencePlatformCommit: string; materialsVersion: unknown }
export function buildReviewedPublicRenders(metadata: PublicRenderMetadata, packageManifest: PackageManifest, files: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const commit = metadata.publisherCommit, layout = productionReviewLayout(commit);
  assertCurrentReviewedPackage(packageManifest, files, commit);
  if (metadata.materialsVersion !== MATERIALS_VERSION || metadata.materialsVersion !== packageManifest.materialsVersion || metadata.sourcePackageManifestSha256 !== sha256(files.get('package-manifest.json')!) || metadata.evidencePlatformCommit !== packageManifest.platformCommit || metadata.materialsBase !== layout.materialsBase || metadata.previewsBase !== layout.previewsBase || metadata.versionedEntry !== layout.versionedEntry || metadata.videoName !== preferredPublicVideo(files) || metadata.videoSourceCommit !== String(packageManifest.videoSourceCommit ?? packageManifest.platformCommit) || !/^[a-f0-9]{40}$/.test(metadata.videoSourceCommit) || typeof metadata.generatedAt !== 'string' || !Number.isFinite(Date.parse(metadata.generatedAt)) || new Date(metadata.generatedAt).toISOString() !== metadata.generatedAt || typeof metadata.videoDurationSeconds !== 'number' || !Number.isFinite(metadata.videoDurationSeconds) || metadata.videoDurationSeconds <= 0 || metadata.videoDurationSeconds > 86400) throw new Error('Public render metadata differs from the checked reviewer snapshot.');
  const json = <T>(name: string) => JSON.parse(files.get(name)!.toString('utf8')) as T;
  const runs = ['01', '02', '03'].map(id => json<ProductionRun>('MOCK-' + id + '/run.json'));
  const rendered = new Map<string, Buffer>();
  for (const run of runs) {
    if (run.platformCommit !== packageManifest.platformCommit || run.input.requirement.kind !== 'illustrative' || run.evidenceKind !== 'fixture') throw new Error('The public cases are not from the frozen fixture cohort.');
    rendered.set(layout.previewsBase + run.input.requirement.id + '/index.html', Buffer.from(trustedFixturePreview(run, files.get(run.input.requirement.id + '/index.html')!)));
  }
  if (rendered.size !== 3) throw new Error('Reviewed previews require three distinct registered fixture IDs.');
  const cameraRuns = files.has('real-camera-runs.json') ? json<ProductionRun[]>('real-camera-runs.json') : [];
  if (!Array.isArray(cameraRuns) || cameraRuns.some(run => run.evidenceKind !== 'real-model' || run.input.capability !== 'camera-scene-v1') || new Set(cameraRuns.map(run => run.id)).size !== cameraRuns.length) throw new Error('Camera evidence ledger must contain unique real declarative-scene attempts.');
  const input = { packageManifest, report: json('submission-evidence.json'), requirements: json<ProductionPortalRequirement[]>('requirements.json'), runs, jevBenchmarks: json<JevBenchmarkRun[]>('jev-benchmarks.json'), mixedRuns: json<ProductionRun[]>('mixed-and-live-runs.json'), cameraRuns, verifierStudy: verifyVerifierReal02Materials(files), recordedBuildInfo: { deploymentCommit: commit, generatedAt: metadata.generatedAt, videoDurationSeconds: metadata.videoDurationSeconds, videoSourceCommit: metadata.videoSourceCommit, historicalIframeRecording: historicalIframeVideo(packageManifest, metadata.videoSourceCommit) }, trustedFixtureIds: runs.map(run => run.input.requirement.id), sourceHref: 'https://github.com/litianyi-007/city-agent/tree/' + commit };
  rendered.set('index.html', Buffer.from(renderProductionPortal({ ...input, submissionBase: './' + layout.materialsBase, previewBase: './' + layout.previewsBase, virtualSocietyHref: '../', snapshotHref: './' + layout.versionedEntry })));
  rendered.set(layout.versionedEntry, Buffer.from(renderProductionPortal({ ...input, submissionBase: './submission/', previewBase: './previews/', virtualSocietyHref: '../../../', snapshotHref: './' })));
  return rendered;
}
/** Reconstruct every executable publication byte from checked source evidence;
 * a replaced portal/preview cannot impersonate a reviewed static renderer. */
export function assertReviewedPublicRender(manifest: unknown, sourceFiles: ReadonlyMap<string, Buffer>, publicationBytes: ReadonlyMap<string, Buffer>): void {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !sourceFiles.has('package-manifest.json')) throw new Error('Public render requires its checked source manifest.');
  const metadata = manifest as PublicRenderMetadata;
  const packageManifest = JSON.parse(sourceFiles.get('package-manifest.json')!.toString('utf8')) as PackageManifest;
  for (const [name, expected] of buildReviewedPublicRenders(metadata, packageManifest, sourceFiles)) if (!publicationBytes.get(name)?.equals(expected)) throw new Error('Executable public file differs from the reviewed trusted renderer.');
}
export async function buildProductionPublic(source: string, root: string) {
  await assertWorktreeDirectory(root, source, 'output/pdf');
  const checked = await readCheckedPackage(source);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  if (branch !== 'feature/autonomous-production' || execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit and freeze the clean production branch before public packaging.');
  assertCurrentReviewedPackage(checked.manifest, checked.files, commit);
  const layout = productionReviewLayout(commit);
  const json = <T>(name: string) => JSON.parse(checked.files.get(name)!.toString('utf8')) as T;
  const runs = ['01', '02', '03'].map(id => json<ProductionRun>('MOCK-' + id + '/run.json'));
  for (const run of runs) if (run.platformCommit !== checked.manifest.platformCommit || run.input.requirement.kind !== 'illustrative' || run.evidenceKind !== 'fixture') throw new Error('The public cases are not from the frozen fixture cohort.');
  const outputRoot = path.join(root, 'output/production-public'); await mkdir(outputRoot, { recursive: true });
  const destination = await mkdtemp(path.join(outputRoot, 'review-'));
  const publications: Array<{ path: string; sourcePath?: string; sha256: string; bytes: number }> = [];
  const save = async (name: string, value: Buffer | string, sourcePath?: string) => {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;
    assertNoPublishedSecrets(bytes, name);
    await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
    await writeFile(path.join(destination, name), bytes, { flag: 'wx' });
    publications.push({ path: name, ...(sourcePath ? { sourcePath } : {}), sha256: sha256(bytes), bytes: bytes.length });
  };
  for (const [name, bytes] of checked.files) await save(layout.materialsBase + publicPath(name), bytes, name);
  const videoName = preferredPublicVideo(checked.files);
  const videoDurationSeconds = await probeCheckedVideoDuration(checked.files.get(videoName)!, root, destination);
  const generatedAt = new Date().toISOString();
  const videoSourceCommit = String(checked.manifest.videoSourceCommit ?? checked.manifest.platformCommit);
  const renderMetadata = { publisherCommit: commit, generatedAt, videoDurationSeconds, videoName, videoSourceCommit, sourcePackageManifestSha256: sha256(checked.files.get('package-manifest.json')!), ...layout, evidencePlatformCommit: checked.manifest.platformCommit, materialsVersion: checked.manifest.materialsVersion };
  for (const [name, bytes] of buildReviewedPublicRenders(renderMetadata, checked.manifest, checked.files)) await save(name, bytes);
  // ZIP keeps original artifact names/bytes. On Pages, raw source is .html.txt
  // instead of executable same-origin HTML, with a public sourcePath mapping.
  await save(layout.materialsBase + 'materials.zip', buildMaterialZipSnapshot(checked.files));
  const publication = { version: PUBLIC_PROJECT_ID, ...renderMetadata, sourceBranch: branch, submissionBaseline: checked.manifest.submissionBaseline, mode: 'trusted-fixture-interaction-and-static-evidence', doesNotRunHarnessBackend: true, generatedCodeExecutedInVisitorBrowser: false, trustedFixtureExecutedInVisitorBrowser: true, l4Satisfied: false, preservesVirtualSocietyRoot: true, preservesHistoricalProductionMaterials: true, files: publications };
  await writeFile(path.join(destination, 'publication-manifest.json'), JSON.stringify(publication, null, 2), { flag: 'wx' });
  return { directory: destination, publication };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = productionEnvironment(); const index = process.argv.indexOf('--package');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: npm run production:public -- --package output/pdf/frozen-package');
  const source = path.resolve(environment.root, process.argv[index + 1]);
  if (!source.startsWith(path.join(environment.root, 'output/pdf') + path.sep)) throw new Error('Use a reviewed package inside this production worktree output/pdf.');
  const built = await buildProductionPublic(source, environment.root); console.log(JSON.stringify(built));
}
