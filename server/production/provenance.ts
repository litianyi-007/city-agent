import { execFileSync } from 'node:child_process';
import { productionEnvironment } from '../../config/production-environment.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export function platformCommit(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: productionEnvironment().root, encoding: 'utf8', timeout: 5000 }).trim();
}
export function buildProvenance(): { platformCommit: string; sourceClean: boolean; builtAt: string } | null {
  try { const value = JSON.parse(readFileSync(path.join(productionEnvironment().root, 'dist', 'production-build.json'), 'utf8')); if (typeof value.platformCommit !== 'string' || typeof value.sourceClean !== 'boolean' || typeof value.builtAt !== 'string') return null; return value; } catch { return null; }
}
