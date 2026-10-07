import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductionRun } from '../shared/production-schema.js';
import type { JevBenchmarkRun } from '../server/production/jev-benchmark.js';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks.js';
import { demoHtml } from '../server/production/fixtures.js';
import { productionEnvironment } from '../config/production-environment.js';
import { renderProductionPortal, type ProductionPortalRequirement } from './production-portal.js';
import { assertNoPublishedSecrets, assertWorktreeDirectory, PUBLIC_PROJECT_ID, publicPath, readCheckedPackage, sha256 } from './production-public-safety.js';

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
export function trustedFixturePreview(run: ProductionRun, original: Buffer) {
  const demo = PRODUCTION_DEMO_CASES.find(item => item.id === run.input.requirement.id);
  // An iframe CSP does not block self-navigation. Only this byte-identical,
  // platform-authored fixture is allowed to execute in the public visitor UI.
  if (run.evidenceKind !== 'fixture' || !demo || run.input.brief !== demo.brief || run.input.requirement.acceptance !== demo.acceptance || run.input.demoCaseId !== demo.operation || original.toString('utf8') !== demoHtml(run.input)) throw new Error('Public interactive preview accepts only exact registered trusted fixture bytes.');
  return original.toString('utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">');
}
export async function buildProductionPublic(source: string, root: string) {
  await assertWorktreeDirectory(root, source, 'output/pdf');
  const checked = await readCheckedPackage(source);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  if (branch !== 'feature/autonomous-production' || execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit and freeze the clean production branch before public packaging.');
  if (checked.manifest.version !== 'mock-package-v2' || checked.manifest.materialsVersion !== 'production-materials-v3' || checked.manifest.publisherCommit !== commit || !checked.files.has('REVIEW.md') || !checked.files.has('materials-summary.json') || !checked.files.has('REVIEWER-GUIDE.md') || !checked.files.has('SUBMISSION-REPORT.md')) throw new Error('Export the current reviewed v3 material snapshot and reviewer documents before publication; a historical PDF cannot impersonate this report commit.');
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
  for (const run of runs) await save(layout.previewsBase + run.input.requirement.id + '/index.html', trustedFixturePreview(run, checked.files.get(run.input.requirement.id + '/index.html')!));
  const videoName = preferredPublicVideo(checked.files);
  const videoInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(source, videoName)], { cwd: root, encoding: 'utf8' })) as { format: { duration: string } };
  const videoDurationSeconds = Number(videoInfo.format.duration);
  if (!Number.isFinite(videoDurationSeconds) || videoDurationSeconds <= 0) throw new Error('Video duration could not be verified.');
  const generatedAt = new Date().toISOString();
  const cameraRuns = checked.files.has('real-camera-runs.json') ? json<ProductionRun[]>('real-camera-runs.json') : [];
  if (!Array.isArray(cameraRuns) || cameraRuns.some(run => run.evidenceKind !== 'real-model' || run.input.capability !== 'camera-scene-v1') || new Set(cameraRuns.map(run => run.id)).size !== cameraRuns.length) throw new Error('Camera evidence ledger must contain unique real declarative-scene attempts.');
  const portalInput = { packageManifest: checked.manifest, report: json('submission-evidence.json'), requirements: json<ProductionPortalRequirement[]>('requirements.json'), runs, jevBenchmarks: json<JevBenchmarkRun[]>('jev-benchmarks.json'), mixedRuns: json<ProductionRun[]>('mixed-and-live-runs.json'), cameraRuns, recordedBuildInfo: { deploymentCommit: commit, generatedAt, videoDurationSeconds, videoSourceCommit: String(checked.manifest.videoSourceCommit ?? checked.manifest.platformCommit), historicalIframeRecording: checked.manifest.historicalIframeRecording === true || checked.manifest.historicalVideo === true }, trustedFixtureIds: runs.map(run => run.input.requirement.id), sourceHref: 'https://github.com/litianyi-007/city-agent/tree/' + commit };
  const portal = renderProductionPortal({ ...portalInput, submissionBase: './' + layout.materialsBase, previewBase: './' + layout.previewsBase, virtualSocietyHref: '../', snapshotHref: './' + layout.versionedEntry });
  await save('index.html', portal);
  await save(layout.versionedEntry, renderProductionPortal({ ...portalInput, submissionBase: './submission/', previewBase: './previews/', virtualSocietyHref: '../../../', snapshotHref: './' }));
  // ZIP keeps original artifact names/bytes. On Pages, raw source is .html.txt
  // instead of executable same-origin HTML, with a public sourcePath mapping.
  const archive = path.join(destination, layout.materialsBase, 'materials.zip');
  execFileSync('zip', ['-q', archive, '-@'], { cwd: source, input: [...checked.files.keys()].join('\n') + '\n' });
  const { readFile } = await import('node:fs/promises'); const archiveBytes = await readFile(archive);
  publications.push({ path: layout.materialsBase + 'materials.zip', sha256: sha256(archiveBytes), bytes: archiveBytes.length });
  const publication = { version: PUBLIC_PROJECT_ID, materialsVersion: checked.manifest.materialsVersion, materialsBase: layout.materialsBase, previewsBase: layout.previewsBase, versionedEntry: layout.versionedEntry, sourceBranch: branch, publisherCommit: commit, evidencePlatformCommit: checked.manifest.platformCommit, submissionBaseline: checked.manifest.submissionBaseline, sourcePackageManifestSha256: sha256(checked.files.get('package-manifest.json')!), generatedAt, videoName, videoSourceCommit: portalInput.recordedBuildInfo.videoSourceCommit, mode: 'trusted-fixture-interaction-and-static-evidence', doesNotRunHarnessBackend: true, generatedCodeExecutedInVisitorBrowser: false, trustedFixtureExecutedInVisitorBrowser: true, l4Satisfied: false, preservesVirtualSocietyRoot: true, preservesHistoricalProductionMaterials: true, files: publications };
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
