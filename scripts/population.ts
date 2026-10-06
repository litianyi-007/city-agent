import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPack, compilePopulation, hashPopulationPack, regionPackSchema, type RegionPack } from '../server/population/model.ts';

export interface SourceFileCheck {
  sourceId: string;
  localPath: string;
  passed: boolean;
  expectedSha256: string;
  actualSha256?: string;
  expectedBytes: number;
  actualBytes?: number;
  detail: string;
}

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** No network requests. The task workspace is the sole allowed source-file root. */
export async function verifySourceFiles(pack: { sources: Pick<RegionPack['sources'][number], 'id' | 'localPath' | 'sha256' | 'bytes'>[] }, workspaceRoot = process.cwd()): Promise<SourceFileCheck[]> {
  const root = await realpath(workspaceRoot);
  return Promise.all(pack.sources.map(async (source) => {
    const result: SourceFileCheck = {
      sourceId: source.id, localPath: source.localPath, passed: false,
      expectedSha256: source.sha256, expectedBytes: source.bytes,
      detail: '',
    };
    try {
      const unresolved = path.resolve(root, source.localPath);
      if (path.isAbsolute(source.localPath) || !within(root, unresolved)) throw new Error('证据路径必须位于工作区内，使用相对路径');
      const resolved = await realpath(unresolved);
      if (!within(root, resolved)) throw new Error('证据符号链接指向工作区外');
      if (!(await stat(resolved)).isFile()) throw new Error('证据路径不是普通文件');
      const bytes = await readFile(resolved);
      result.actualBytes = bytes.byteLength;
      result.actualSha256 = createHash('sha256').update(bytes).digest('hex');
      result.passed = result.actualBytes === source.bytes && result.actualSha256 === source.sha256;
      result.detail = result.passed ? '本地证据字节数与 SHA-256 一致；不等于核实原始发布者或摘录准确性。' : '本地证据字节数或 SHA-256 不匹配';
    } catch (error) {
      result.detail = error instanceof Error ? error.message : String(error);
    }
    return result;
  }));
}

export async function runPopulationCli(args: string[], workspaceRoot = process.cwd()): Promise<number> {
  const [command, packPath, ...rest] = args;
  if (!['validate', 'compile'].includes(command) || !packPath || (command === 'validate' && rest.length) || (command === 'compile' && (rest.length !== 2 || rest[0] !== '--output' || !rest[1]))) {
    process.stderr.write('用法：tsx scripts/population.ts validate <pack.json>\n或：tsx scripts/population.ts compile <pack.json> --output <new-file.json>\n');
    return 2;
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path.resolve(workspaceRoot, packPath), 'utf8'));
    const parsed = regionPackSchema.safeParse(raw);
    if (!parsed.success) {
      process.stdout.write(`${JSON.stringify({ status: 'blocked', schemaErrors: parsed.error.issues }, null, 2)}\n`);
      return 1;
    }
    const pack = parsed.data;
    const audit = auditPack(pack);
    const sourceFiles = await verifySourceFiles(pack, workspaceRoot);
    const status = audit.status === 'ready' && sourceFiles.every((source) => source.passed) ? 'ready' : 'blocked';
    const report = { status, packId: pack.id, datasetHash: hashPopulationPack(pack), audit, sourceFiles };
    if (status === 'blocked' || command === 'validate') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return status === 'ready' ? 0 : 1;
    }
    const root = await realpath(workspaceRoot);
    const output = path.resolve(root, rest[1]);
    if (!within(root, output)) throw new Error('输出必须位于工作区内');
    if (!within(root, await realpath(path.dirname(output)))) throw new Error('输出目录符号链接指向工作区外');
    const compiled = compilePopulation(pack);
    await writeFile(output, `${JSON.stringify({ ...compiled, sourceFileAudit: sourceFiles }, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ ...report, output: path.relative(root, output) }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'blocked', error: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPopulationCli(process.argv.slice(2));
}
