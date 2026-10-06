import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4311', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start', url: 'http://127.0.0.1:4311/api/health', timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: '4311', CITY_AGENT_DATA_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'city-agent-ui-test-')), '.city-agent') },
  },
});
