import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the full stack in Docker Compose (`npm run e2e` starts it), or
 * against any running instance via E2E_BASE_URL.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // One worker: the probe tests share the API's demo-key pacing.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@responsive/ },
  ],
});
