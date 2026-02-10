import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', // since audit.spec.ts is in the root
  testMatch: ['**/*audit.spec.ts'], // only run this spec
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'artifacts/playwright-html-report' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://www.reserval.com',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'Desktop Chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  outputDir: 'artifacts/test-results',
});
