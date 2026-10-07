import { fileURLToPath } from 'node:url';
import { inspectVerifierStudyArchiveFile, VERIFIER_OBSERVED_01_ARCHIVE_SHA256 } from '../server/production/verifier-study-archive.js';

// Read-only portable archive inspection. No extraction, repair, resume, Key,
// config/store, model, service or shell invocation. Not an authenticity claim.
// npx tsx scripts/inspect-production-verifier-study.ts
// npx tsx scripts/inspect-production-verifier-study.ts --archive FILE.tar.gz --sha256 EXPECTED_64_HEX
try {
  const args = process.argv.slice(2);
  const defaults = args.length === 0;
  if (!defaults && (args.length !== 4 || args[0] !== '--archive' || args[2] !== '--sha256'
    || !args[1] || args[1].startsWith('--') || args[1].includes('\0') || !/^[a-f0-9]{64}$/.test(args[3]))) throw new Error('Invalid inspection arguments');
  const file = defaults ? fileURLToPath(new URL('../docs/production/experiments/VERIFIER-OBSERVED-01/run-ledger.tar.gz', import.meta.url)) : args[1];
  const expected = defaults ? VERIFIER_OBSERVED_01_ARCHIVE_SHA256 : args[3];
  const result = inspectVerifierStudyArchiveFile(file, expected);
  console.log(JSON.stringify(result, null, 2));
  if (result.state !== 'terminal') process.exitCode = 2;
} catch {
  console.error(JSON.stringify({ archiveVerified: false, resumed: false, repaired: false, extracted: false,
    reason: 'Read-only archive inspection failed; check arguments, expected hash and retained original evidence. No replay or repair.' }));
  process.exitCode = 1;
}
