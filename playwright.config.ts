import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Buyer credentials come from .env (gitignored). Loaded here so tests can read them; never printed.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: the PayPal popup may need a manual login (headed page.pause()).
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    headless: !process.env.PW_HEADED,
    // OFF for the whole project: the buyer login runs inside these tests, so no trace/screenshot/video may capture it.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    // The public read-only seller view (tests/e2e/seller-public.spec.ts). Merged over process.env by Playwright.
    env: { SELLER_PUBLIC_VIEW: '1' },
    timeout: 120_000,
  },
});
