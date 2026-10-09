import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  retries: 0,
  // The fixture has one synthetic session; serialize changes to its authentication state.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/browser.xml' }]],
  use: { baseURL: 'http://127.0.0.1:3121', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/preview-workflow.mjs',
    url: 'http://127.0.0.1:3121/api/auth/session',
    reuseExistingServer: false,
    env: { PORT: '3121', PREVIEW_START_SIGNED_OUT: '1' },
  },
});
