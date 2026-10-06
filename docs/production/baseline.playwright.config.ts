import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseline from '../../playwright.config';

// Preparation-only regression configuration; no production runtime is changed.
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.PRODUCTION_E2E_PORT ?? 4421);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PRODUCTION_E2E_PORT must be an integer from 1024 to 65535.');
}
const workspace = mkdtempSync(path.join(root, '.city-agent-preparation-'));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...baseline,
  testDir: path.join(root, 'tests/browser'),
  outputDir: path.join(workspace, 'test-results'),
  use: { ...baseline.use, baseURL },
  webServer: {
    command: 'npm start',
    cwd: root,
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: String(port), CITY_AGENT_DATA_DIR: path.join(workspace, 'data') },
  },
});
