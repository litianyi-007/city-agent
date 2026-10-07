import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

// Frozen before this offline batch. Never replace these with hashes learned at the end.
const anchors = [
  { name: 'public/submission/live-run.json', sha256: 'ecd7a3385f706a27cd06034926ee250fded61f6626cf09a69ec7704fb6c57b5f', manifest: false },
  {"name":"public/submission-next/live-proof/budget-ledger.json","sha256":"768b9f47274fc8130ed80190a94a42cf38682434dd1204637a168605fe2995f5","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/logic-audit.json","sha256":"ce815b79da6598dbb973d51afda1a7ecf80d0dfa7924700b219c83f1ffe0342e","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/presets.json","sha256":"adf7cf8e03215d4459dc8d41aaf3a0df9fe5c7ead83814c0f0e951d8e2e0e908","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/prompts.txt","sha256":"e73e662f9bd2e3469913f561efb9204f0a13eca48a202717e3ff3f52b5f246b7","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/qualification-audit.json","sha256":"687730d91dcb4cf0b502ba3e301e46278ebb82c24dae70de369e8b8e5f2655b4","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/questionnaire.json","sha256":"6aa692f9a660c3a37e6302b884c6707db8d2d618f80c68f9a65bc76107ac66c7","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/raw-responses.json","sha256":"8a1fe71b424e26a6f35b58641b9cc45c8a3295e0a9a81d005a89fe5248afa1c5","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/statistics.json","sha256":"225e06d9ac6e937eeb79541522a2f3a84884b96d6cff83885dbfead01e91ad42","manifest":false},
  {"name":"public/submission-next/live-proof/child-snacks/survey-run.json","sha256":"8d621ffc4004bcd9d240bca3db5d2f054e43098443be766899a42e4fc0c27595","manifest":false},
  {"name":"public/submission-next/live-proof/cors-checks.json","sha256":"6c8d8291c689b88aa818426919e8e06d04d91691e0afb8c45aa920fd09952c35","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/logic-audit.json","sha256":"0ec79d4d07c8c5fa733a44a68c0ea368f83a4df8bd23cecc845850985c6da125","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/presets.json","sha256":"db25e39ba522d46c525033640cc02f49d90961dd05443ac70fd8a57cfffb1d80","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/prompts.txt","sha256":"e80b399c063a6953717ef9e23e6725ec08eee5e9ce622977a609c12e18c2569e","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/qualification-audit.json","sha256":"13f170d8a57d043ef93aa814209d0dc985686f7b1a15260525398388ffd4b867","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/questionnaire.json","sha256":"1d5b1822c465ea15c9abfc72bea88d49cf5262ef10ad884a1f39fc8daf743a5b","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/raw-responses.json","sha256":"dbca152cfa2b955c8207d0d96b737d68b14fdd7f5594a3140ea63b08008984c9","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/statistics.json","sha256":"8ada851fb3361fd319ac33fec72fc9d224c957f83dc592dd946cdc56678f7414","manifest":false},
  {"name":"public/submission-next/live-proof/pet-snacks/survey-run.json","sha256":"739f2054c9cf7528b55359e901ebf7e200b806041bfbee2bff17b14161bf4e15","manifest":false},
  {"name":"public/submission-next/live-proof/plan.json","sha256":"fb1f03b56daff26000cb6afb9037aaab5e2c3a6003730552f468bf244bcb714e","manifest":false},
  {"name":"public/submission-next/live-proof/planning-child.json","sha256":"b846988b15d410728d992009a504f6381fda6c61bf269edfa2a2325f3894d5c0","manifest":false},
  {"name":"public/submission-next/live-proof/planning-pet.json","sha256":"2e1e93cbde46aac6d90c0e8989c9c76e016147cdc2d2cabbbcdc5d3f96ec5c12","manifest":false},
  {"name":"public/submission-next/live-proof/pricing-source.json","sha256":"c5eee3d82240a513ce48d2e0af5a737d32eb9ec19032b6a00dcd97eacd41c7a1","manifest":false},
  {"name":"public/submission-next/live-proof/report.json","sha256":"2bc30b2d4d5f234386089ff03493aba7052ce345ee88b0237c4453995cea4efd","manifest":false},
  {"name":"public/submission-next/live-proof/report.md","sha256":"6b0df912337e2a358f85d559fac815fbc5850a70a5f11867827260531f78759b","manifest":false},
  { name: 'public/submission-next/business-proof/manifest.json', sha256: '93920ecc3730adf8416c5ea5439ea0f4b2bbb56c07cb3928b3c69f8d1dcbe6f9', manifest: true },
  { name: 'output/contract-review-appendix/f736fda5-2b12-4918-b843-1421e1c76454/submission-contract11/manifest.json', sha256: 'bf0e32a746720265ac33e7432a783e996d8a08028f8c620d277ed419a803b1e8', manifest: true },
  { name: 'output/submission-offline/2026-10-07-offline-v2/manifest.json', sha256: 'c11896a3757885d0c1968ee538ce11ca74d60ed25af1de1e3d6afe65ca3e9451', manifest: true },
] as const;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function verifyHistoricalEvidence(root: string, scope: 'repository' | 'local-full' = 'repository') {
  root = await realpath(root);
  const verified: { name: string; bytes: number; sha256: string }[] = [];
  const read = async (name: string, expectedHash: string, expectedBytes?: number) => {
    if (path.isAbsolute(name) || name.split('/').some(part => ['..', '.', ''].includes(part))) throw new Error('历史清单路径不合法。');
    const filename = path.join(root, name); const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename) throw new Error(`历史原件不可为符号链接：${name}`);
    const bytes = await readFile(filename);
    if (hash(bytes) !== expectedHash || expectedBytes !== undefined && bytes.length !== expectedBytes) throw new Error(`历史字节校验失败：${name}`);
    verified.push({ name, bytes: bytes.length, sha256: expectedHash }); return bytes;
  };
  for (const anchor of anchors) {
    if (scope === 'repository' && anchor.name.startsWith('output/')) continue;
    const bytes = await read(anchor.name, anchor.sha256);
    if (!anchor.manifest) continue;
    const manifest: { files: { name: string; bytes: number; sha256: string }[] } = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(manifest.files) || new Set(manifest.files.map(file => file.name)).size !== manifest.files.length) throw new Error('冻结历史manifest条目重复或缺失。');
    for (const entry of manifest.files) {
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || path.isAbsolute(entry.name) || entry.name.split('/').some(part => ['..', '.', ''].includes(part))) throw new Error('冻结历史manifest条目不合法。');
      await read(path.posix.join(path.posix.dirname(anchor.name), entry.name), entry.sha256, entry.bytes);
      if (anchor.name.includes('contract-review-appendix') && !['appendix.pdf', 'index.html', 'README.md'].includes(entry.name)) {
        await read(`output/live-proof/f736fda5-2b12-4918-b843-1421e1c76454/${entry.name}`, entry.sha256, entry.bytes);
      }
    }
  }
  return { version: 'historical-byte-integrity-1.0', scope, verifiedCount: verified.length, anchors: anchors.filter(anchor => scope === 'local-full' || !anchor.name.startsWith('output/')).map(anchor => ({ ...anchor })), files: verified,
    meaning: '固定预登记hash证明字节一致，不认证现实真值、模型质量、账单或正式提交。' };
}
