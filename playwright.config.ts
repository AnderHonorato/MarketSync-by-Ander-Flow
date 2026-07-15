import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5180',
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
});
