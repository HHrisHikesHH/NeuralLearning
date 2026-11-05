// Browser smoke tests: the real owner app against the in-browser fake GitHub (tests/e2e.html).
// No real GitHub repositories or tokens are involved; see e2e/helpers.mjs.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8766;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 tests/serve.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
