import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const portText = process.env.CITY_AGENT_TEST_PORT || '4321';
if (!/^[1-9]\d{0,4}$/.test(portText) || Number(portText) > 65535) throw new Error('CITY_AGENT_TEST_PORT must be 1–65535.');
const baseURL = `http://127.0.0.1:${portText}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start', url: `${baseURL}/api/health`, timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: portText, CITY_AGENT_DATA_DIR: path.join(mkdtempSync(path.join(tmpdir(), 'city-agent-ui-test-')), '.city-agent') },
  },
});
