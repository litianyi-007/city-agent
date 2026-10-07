import { sha256 } from 'js-sha256';
import { z } from 'zod';

export const FROZEN_SUBMISSION_TAG = 'submission-milestone-2026-10-07';
export const PUBLISHED_DEMO_URL = 'https://litianyi-007.github.io/city-agent/';
export const FROZEN_SUBMISSION_FILES = [
  'delivery-acceptance.json', 'delivery-attempts.json', 'delivery-gate.json', 'delivery-manifest.json', 'delivery-run.json',
  'delivery-source.txt', 'demo.mp4', 'evaluation-summary.json', 'experiment-runs.json', 'index.html', 'live-run.json',
  'metrics.json', 'milestone-files.json', 'milestone-report.md', 'milestone.json', 'population-pack.json', 'prior-attempts.json',
  'project-materials.md', 'project-materials.pdf', 'prompts.txt', 'sample-profiles.json', 'sample-questionnaire.json', 'sample-run.json',
  'sources.json', 'sources/binjiang-2023-yearbook.pdf', 'sources/binjiang-2024-communique.pdf',
  'sources/binjiang-2025-communique.pdf', 'sources/binjiang-census-yearbook.pdf', 'video-script.md',
] as const;
const caseFiles = ['logic-audit.json', 'presets.json', 'prompts.txt', 'questionnaire.json', 'raw-responses.json', 'statistics.json', 'survey-run.json'];
export const PUBLIC_REVIEW_FILES = [
  'README.md', 'business-proof/business-proof.json', 'business-proof/manifest.json', 'business-proof/proof-report.md',
  ...['child-snacks', 'pet-snacks'].flatMap(id => caseFiles.map(name => `business-proof/${id}/${name}`)),
  'captions.json', 'demo-next.mp4', 'demo-next.vtt', 'historical/delivery-attempts.json', 'historical/evaluation-summary.json',
  'historical/experiment-runs.json', 'historical/live-run.json', 'historical/metrics.json', 'historical/milestone.json',
  'historical/prior-attempts.json',
  ...['manifest.json', 'persona-proof.json', 'presets.json', 'proof-report.md', 'questionnaire.json', 'survey-run.json'].map(name => `historical/persona-proof/${name}`),
  'index.html', 'methods/business-proof.md', 'methods/evaluation-next.md', 'methods/judge-quickstart.md',
  'methods/old-persona-proof.md', 'methods/population-methodology.md', 'methods/resident-construction.md',
  'persona-source-register.json', 'population-pack.json', 'population-sources.json', 'project-materials.md', 'project-materials.pdf',
  'recorded-child-proof.json', 'recorded-pet-proof.json', 'sources/binjiang-2023-yearbook.pdf',
  'sources/binjiang-2024-communique.pdf', 'sources/binjiang-2025-communique.pdf', 'sources/binjiang-census-yearbook.pdf', 'verification.json',
] as const;
export const PUBLIC_LIVE_PROOF_FILES = [
  ...['report.md', 'report.json', 'budget-ledger.json', 'plan.json', 'pricing-source.json', 'planning-child.json', 'planning-pet.json', 'cors-checks.json'].map(name => `live-proof/${name}`),
  ...['child-snacks', 'pet-snacks'].flatMap(id => [...caseFiles, 'qualification-audit.json'].map(name => `live-proof/${id}/${name}`)),
] as const;

const fileEntry = z.object({ name: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const publicationManifestSchema = z.object({
  schemaVersion: z.literal('1.0'), kind: z.literal('city-agent-review-candidate'), generatedAt: z.string().datetime(),
  proofId: z.string().uuid(), sourceHead: z.string().regex(/^[a-f0-9]{40}$/), sourceDirty: z.boolean(),
  branch: z.literal('feature/virtual-society-next'), releaseStatus: z.literal('public-reviewed-candidate'),
  formalSubmission: z.literal('not-confirmed'), realModelCallsThisBatch: z.number().int().min(0).max(24),
  publishedDemo: z.literal(PUBLISHED_DEMO_URL), localDemo: z.literal('http://127.0.0.1:4320/#research').optional(),
  frozenTag: z.literal(FROZEN_SUBMISSION_TAG), historicalArtifactsModified: z.literal(false),
  businessArtifactsVerification: z.object({
    verifierVersion: z.literal('submission-artifacts-verifier-1.0'), registeredFiles: z.array(z.string()),
    sourceAndExecutionAuthenticity: z.literal('not-independently-attested'), marketResearchValidated: z.literal(false), rawEvidenceModified: z.literal(false),
  }).strict(),
  checksumMeaning: z.literal('byte-integrity-not-source-or-execution-attestation'),
  publicationReview: z.object({
    status: z.literal('public-reviewed'), reviewedAt: z.string().datetime(), localPathsRemoved: z.literal(true),
    internalLinksRemoved: z.literal(true), credentialsRemoved: z.literal(true), privateDataExcluded: z.literal(true),
  }).strict(), files: z.array(fileEntry),
}).strict();
export type PublicationManifest = z.infer<typeof publicationManifestSchema>;

function decodedForms(text: string): string[] {
  const forms: string[] = [text];
  for (let i = 0; i < 4; i++) {
    let next = forms.at(-1)!.replace(/\\u([a-f0-9]{4})/gi, (_match, value: string) => String.fromCharCode(Number.parseInt(value, 16)))
      .replace(/\\\//g, '/').replace(/\\\\/g, '\\')
      .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_match, hex: string, decimal: string) => {
        const point = Number.parseInt(hex || decimal, hex ? 16 : 10); return point <= 0x10ffff ? String.fromCodePoint(point) : _match;
      })
      .replace(/&(?:sol|colon|bsol);/gi, value => ({ '&sol;': '/', '&colon;': ':', '&bsol;': '\\' }[value.toLowerCase()]!));
    next = next.replace(/(?:%[a-f0-9]{2})+/gi, value => { try { return decodeURIComponent(value); } catch { return value; } });
    if (next === forms.at(-1)) break;
    forms.push(next);
  }
  return forms;
}

/** Public-content gate, not a proof against encryption or arbitrary covert credentials. */
export function assertPublicText(name: string, text: string): void {
  const forbidden = /\/Users\/|[A-Z]:[\\/]Users[\\/]|docs\.popo\.netease\.com|qa-only-not-a-real-credential|synthetic-only-not-a-real-key|\bsk-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9][A-Za-z0-9._-]{11,}\b/i;
  if (decodedForms(text).some(value => forbidden.test(value))) throw new Error(`发现非公开内容：${name}`);
  if (!name.endsWith('.json')) return;
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(api[_-]?key|authorization|password|access[_-]?token|credential|credentials|secret)$/i.test(key)
        && child !== null && child !== '' && !(typeof child === 'string' && /^\[REDACTED\]$|^<API_KEY>$|^YOUR_API_KEY$/.test(child))) throw new Error(`发现凭据字段：${name}`);
      inspect(child);
    }
  };
  try { inspect(JSON.parse(text)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error(`公开JSON无法解析：${name}`); throw error; }
}

function bytes(input: string | Uint8Array): Uint8Array { return typeof input === 'string' ? new TextEncoder().encode(input) : input; }

/** No I/O and no mutation; require exact payload, registered names and byte hashes. */
export function verifyPublicSubmission(input: { manifest: unknown; files: Record<string, string | Uint8Array> }): PublicationManifest {
  const manifest = publicationManifestSchema.parse(input.manifest);
  assertPublicText('manifest.json', JSON.stringify(manifest));
  const names = manifest.files.map(file => file.name); const supplied = Object.keys(input.files);
  const hasLive = names.some(name => name.startsWith('live-proof/'));
  const expected: readonly string[] = hasLive ? [...PUBLIC_REVIEW_FILES, ...PUBLIC_LIVE_PROOF_FILES] : PUBLIC_REVIEW_FILES;
  if (names.length !== expected.length || new Set(names).size !== expected.length || names.some(name => !expected.includes(name))
    || supplied.length !== expected.length || supplied.some(name => !expected.includes(name))) throw new Error('公开附件清单缺失、重复、越界或含未登记文件。');
  if (manifest.realModelCallsThisBatch > 0 && !hasLive) throw new Error('新增真实调用必须附完整登记的live-proof附件。');
  for (const file of manifest.files) {
    if (!Object.hasOwn(input.files, file.name)) throw new Error(`缺少公开附件：${file.name}`);
    const value = bytes(input.files[file.name]);
    if (value.byteLength !== file.bytes || sha256(value) !== file.sha256) throw new Error(`公开附件字节校验失败：${file.name}`);
    if (/\.(json|html|txt|md|vtt)$/.test(file.name)) assertPublicText(file.name, new TextDecoder('utf-8', { fatal: true }).decode(value));
  }
  return manifest;
}

export function parsePublishingOptions(args: string[]): { dryRun: boolean; submission: string } {
  if (args.some(arg => arg !== '--dry-run' && !/^--submission=output\/release-candidate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/submission-next$/.test(arg))) throw new Error('仅允许--dry-run和output/release-candidate/<UUID>/submission-next审查包。');
  const selections = args.filter(arg => arg.startsWith('--submission='));
  if (selections.length !== 1 || args.filter(arg => arg === '--dry-run').length > 1) throw new Error('必须且仅指定一个--submission公开审查包。');
  return { dryRun: args.includes('--dry-run'), submission: selections[0].slice('--submission='.length) };
}

/** The unreviewed dist-pages/submission-next tree is deliberately never selected. */
export function selectPagesBuildFiles(names: readonly string[]): string[] {
  const selected = names.filter(name => !name.startsWith('submission-next/'));
  const permitted = /^(index\.html|review-guide\.html|assets\/[A-Za-z0-9_-]+\.(js|css))$/;
  if (selected.some(name => !permitted.test(name) && !FROZEN_SUBMISSION_FILES.some(file => name === `submission/${file}`))) throw new Error('Pages构建发布白名单检查失败。');
  if (new Set(names).size !== names.length || !selected.includes('index.html') || !selected.includes('review-guide.html') || !selected.some(name => name.startsWith('assets/'))
    || FROZEN_SUBMISSION_FILES.some(name => !selected.includes(`submission/${name}`))) throw new Error('Pages构建缺少必须文件或有重复路径。');
  return [...selected].sort();
}
