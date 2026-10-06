import { productionEnvironment } from '../config/production-environment.js';
// Trusted one-shot stdin importer; no argv/env/file secret, no credential output.
// Prefer the front-end settings page for normal use and rotation.
const environment = productionEnvironment();
const apiKey = await new Promise<string>((resolve, reject) => {
  let buffer = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; if (buffer.length > 1000) reject(new Error('Credential too long')); if (buffer.includes('\n')) { process.stdin.pause(); resolve(buffer.slice(0, buffer.indexOf('\n')).trim()); } });
  process.stdin.on('end', () => resolve(buffer.trim())); process.stdin.on('error', reject);
});
if (!apiKey || apiKey.length > 500) throw new Error('Credential missing or invalid');
const response = await fetch(`http://127.0.0.1:${environment.apiPort}/api/production/jev/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey, enabled: true }), signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error(`Settings API returned ${response.status}`);
const publicConfig = await response.json() as { enabled: boolean; hasApiKey: boolean };
console.log(JSON.stringify({ configured: publicConfig.hasApiKey, enabled: publicConfig.enabled }));
process.exit(0);
