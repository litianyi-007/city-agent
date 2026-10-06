import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { productionEnvironment } from './config/production-environment';

const environment = productionEnvironment();
const workspace = mkdtempSync(path.join(environment.root, '.city-agent-production-test-'));
const baseURL = `http://127.0.0.1:${environment.e2ePort}`;

export default defineConfig({
  testDir: path.join(environment.root, 'tests/browser'),
  outputDir: path.join(workspace, 'test-results'),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start', cwd: environment.root, url: `${baseURL}/api/health`, timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: String(environment.e2ePort), PRODUCTION_DATA_DIR: path.join(workspace, 'data') },
  },
});
