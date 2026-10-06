import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function port(value: string | undefined, fallback: number, name: string): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1024 || result > 65535) throw new Error(`${name} must be a port between 1024 and 65535.`);
  return result;
}

/** One branch-local configuration; no mutable default directory shared with the other worktree. */
export function productionEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const apiPort = port(env.PORT ?? env.PRODUCTION_API_PORT, 4420, 'PRODUCTION_API_PORT');
  const webPort = port(env.PRODUCTION_WEB_PORT, 5420, 'PRODUCTION_WEB_PORT');
  const previewPort = port(env.PRODUCTION_PREVIEW_PORT, 4422, 'PRODUCTION_PREVIEW_PORT');
  const e2ePort = port(env.PRODUCTION_E2E_PORT, 4421, 'PRODUCTION_E2E_PORT');
  if (new Set([apiPort, webPort, previewPort]).size !== 3 || ((e2ePort === apiPort && !env.PORT) || e2ePort === webPort || e2ePort === previewPort)) throw new Error('Production ports must be distinct (PORT may select the isolated E2E server).');
  const dataDir = path.resolve(root, env.PRODUCTION_DATA_DIR ?? env.CITY_AGENT_DATA_DIR ?? '.city-agent-production');
  if (dataDir === root || !dataDir.startsWith(`${root}${path.sep}`)) throw new Error('Production data must be inside this worktree, not its root.');
  let ancestor = dataDir;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = realpathSync(ancestor);
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) throw new Error('Production data must not escape through a symlink.');
  return { root, apiPort, webPort, previewPort, e2ePort, dataDir };
}
