import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('dist-pages'); const url = 'https://litianyi-007.github.io/city-agent/';
function files(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const checks = await Promise.all(files(root).map(async file => {
  const response = await fetch(url + file, { signal: AbortSignal.timeout(30_000) }); const bytes = new Uint8Array(await response.arrayBuffer());
  return { path: file, status: response.status, contentType: response.headers.get('content-type'), bytes: bytes.length, sha256: sha(bytes), sha256Matches: response.ok && sha(bytes) === sha(readFileSync(path.join(root, file))) };
}));
mkdirSync('output/pages-qa', { recursive: true });
writeFileSync('output/pages-qa/public-health.json', JSON.stringify({ checkedAt: new Date().toISOString(), url, checks }, null, 2));
console.log(JSON.stringify({ url, files: checks.length, passed: checks.filter(check => check.sha256Matches).length, failures: checks.filter(check => !check.sha256Matches) }));
if (checks.some(check => !check.sha256Matches)) process.exitCode = 1;
