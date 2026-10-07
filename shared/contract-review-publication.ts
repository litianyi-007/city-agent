import { z } from 'zod';
import { sha256 } from 'js-sha256';
import { assertPublicText } from './publishing-contract';

export const CONTRACT_REVIEW_EXPERIMENT = 'f736fda5-2b12-4918-b843-1421e1c76454';
export const CONTRACT_REVIEW_FILES = [
  'plan.json', 'pricing-source.json', 'budget-ledger.json', 'report.json', 'report.md',
  'planning-child.json', 'planning-pet.json', 'cors-checks.json',
  ...['child-snacks', 'pet-snacks'].flatMap(scenario => ['survey-run.json', 'questionnaire.json', 'raw-responses.json',
    'statistics.json', 'presets.json', 'qualification-audit.json', 'logic-audit.json', 'prompts.txt'].map(file => `${scenario}/${file}`)),
  'README.md', 'index.html', 'appendix.pdf',
] as const;

export function parseContractPublicationOptions(args: string[]) {
  if (args.length !== 1 || !['--dry-run', '--execute'].includes(args[0])) throw new Error('必须选择且仅选择--dry-run或--execute，不接受路径/模型/预算覆盖。');
  return { execute: args[0] === '--execute' };
}

/** Independent negative-result appendix; never replace or merge historical trial denominators. */
export function verifyContractReviewFiles(manifestInput: unknown, files: Record<string, Uint8Array>) {
  const manifest = z.object({
    schemaVersion: z.literal('contract-review-appendix-1.0'), experimentId: z.literal(CONTRACT_REVIEW_EXPERIMENT),
    protocolVersion: z.literal('live-business-smoke-1.1'), planHash: z.string().regex(/^[a-f0-9]{64}$/),
    realModelCalls: z.literal(5), conservativeCostCny: z.literal(0.042032), publicationKind: z.literal('negative-result-supplement'),
    files: z.array(z.object({ name: z.string(), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).length(27),
  }).passthrough().parse(manifestInput);
  assertPublicText('manifest.json', JSON.stringify(manifest));
  const expected = new Set<string>(CONTRACT_REVIEW_FILES);
  if (new Set(manifest.files.map(file => file.name)).size !== 27 || Object.keys(files).length !== 27
    || Object.keys(files).some(name => !expected.has(name)) || manifest.files.some(file => !expected.has(file.name))) throw new Error('补充包缺失、重复或包含白名单以外文件。');
  for (const file of manifest.files) {
    const bytes = files[file.name];
    if (!bytes || bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`补充包字节校验失败：${file.name}`);
    if (/\.(json|md|txt|html)$/.test(file.name)) assertPublicText(file.name, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  return manifest;
}
