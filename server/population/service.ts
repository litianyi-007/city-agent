import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { verifySourceFiles, type SourceFileCheck } from '../../scripts/population.ts';
import { auditPack, compilePopulation, hashPopulationPack, regionPackSchema, type RegionPack } from './model.ts';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOT = path.join(WORKSPACE_ROOT, 'data/population/sources');
const PACK_PATH = path.join(WORKSPACE_ROOT, 'data/population/regions/binjiang-2020.json');
const RECENT_PATH = path.join(WORKSPACE_ROOT, 'data/population/evidence/binjiang-recent.json');
const TEMPLATE_PATH = path.join(WORKSPACE_ROOT, 'data/population/regions/new-region-template.json');
const sourceFileReferenceSchema = z.object({
  id: z.string().min(1), localPath: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(),
});
type FileReference = z.infer<typeof sourceFileReferenceSchema>;

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function allowedSourcePath(source: FileReference) {
  if (path.isAbsolute(source.localPath)) throw new Error('证据路径必须为 data/population/sources 内的相对路径');
  const absolute = path.resolve(WORKSPACE_ROOT, source.localPath);
  if (!isInside(SOURCE_ROOT, absolute) || absolute === SOURCE_ROOT) throw new Error('证据路径必须位于 data/population/sources 内');
  const resolvedRoot = realpathSync(SOURCE_ROOT);
  const resolved = realpathSync(absolute);
  if (!isInside(resolvedRoot, resolved) || !statSync(resolved).isFile()) throw new Error('证据路径不允许通过符号链接离开专用来源目录');
  return resolved;
}

function verifySourceSync(source: FileReference): SourceFileCheck {
  const check: SourceFileCheck = {
    sourceId: source.id, localPath: source.localPath, expectedSha256: source.sha256, expectedBytes: source.bytes, passed: false, detail: '',
  };
  try {
    const bytes = readFileSync(allowedSourcePath(source));
    check.actualBytes = bytes.byteLength;
    check.actualSha256 = createHash('sha256').update(bytes).digest('hex');
    check.passed = check.actualBytes === source.bytes && check.actualSha256 === source.sha256;
    check.detail = check.passed ? '本地原件字节数与 SHA-256 相符；不代替统计真实性及摘录核验。' : '本地原件 SHA-256 或字节数不符';
  } catch (error) {
    check.detail = error instanceof Error ? error.message : String(error);
  }
  return check;
}

export function getPopulationPack(): RegionPack {
  return regionPackSchema.parse(JSON.parse(readFileSync(PACK_PATH, 'utf8')));
}

export function getPopulationModel() {
  const pack = getPopulationPack();
  const checks = pack.sources.map(verifySourceSync);
  if (checks.some((check) => !check.passed)) throw new Error(`人口原件完整性校验失败：${checks.filter((check) => !check.passed).map((check) => check.sourceId).join(', ')}`);
  return compilePopulation(pack);
}

export function getRecentPopulationEvidence(): Record<string, unknown> | null {
  return existsSync(RECENT_PATH) ? JSON.parse(readFileSync(RECENT_PATH, 'utf8')) as Record<string, unknown> : null;
}

export function getPopulationTemplate(): RegionPack {
  return regionPackSchema.parse(JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')));
}

function recentSourceReferences(recent: Record<string, unknown> | null): FileReference[] {
  if (!recent || !Array.isArray(recent.sources)) return [];
  return recent.sources.map((source: unknown) => sourceFileReferenceSchema.parse(source));
}

export async function getPopulationOverview() {
  const pack = getPopulationPack();
  const recent = getRecentPopulationEvidence();
  const references = [...pack.sources, ...recentSourceReferences(recent)];
  const sourceFiles = references.map(verifySourceSync);
  const model = compilePopulation(pack);
  return { status: sourceFiles.every((check) => check.passed) ? 'ready' as const : 'blocked' as const, model, sourceFiles, recent };
}

/** Read-only intake audit; no upload is activated and no supplied URL is fetched. */
export async function validatePopulationIntake(input: unknown) {
  const parsed = regionPackSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked' as const, schemaErrors: parsed.error.issues, sourceFiles: [] };
  const pack = parsed.data;
  const audit = auditPack(pack);
  // Reject paths before passing any of them to the general CLI verifier: this API
  // must never become a hash/read oracle for private workspace files.
  const rejected = pack.sources.flatMap((source) => {
    try { allowedSourcePath(source); return []; }
    catch { return [{ sourceId: source.id, localPath: source.localPath, passed: false, expectedSha256: source.sha256, expectedBytes: source.bytes, detail: '证据不存在或不在 data/population/sources 专用目录内；未读取内容。' }]; }
  });
  if (rejected.length) return { status: 'blocked' as const, packId: pack.id, datasetHash: hashPopulationPack(pack), audit, sourceFiles: rejected };
  const sourceFiles = await verifySourceFiles(pack, WORKSPACE_ROOT);
  return {
    status: audit.status === 'ready' && sourceFiles.every((source) => source.passed) ? 'ready' as const : 'blocked' as const,
    packId: pack.id, datasetHash: hashPopulationPack(pack), audit, sourceFiles,
  };
}

/** Returns already verified bytes from a source registered in trusted built-in data only. */
export function getPopulationSource(id: string): { filename: string; bytes: Buffer } | null {
  const source = [...getPopulationPack().sources, ...recentSourceReferences(getRecentPopulationEvidence())].find((row) => row.id === id);
  if (!source) return null;
  const filename = allowedSourcePath(source);
  const bytes = readFileSync(filename);
  if (bytes.byteLength !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('登记原件的 SHA-256 或字节数不符');
  return { filename: path.basename(filename), bytes };
}
