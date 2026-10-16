import { defineConfig, devices } from '@playwright/test';

const previewPort = process.env.PLAYWRIGHT_PREVIEW_PORT || '3121';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  retries: 0,
  // The fixture has one synthetic session; serialize changes to its authentication state.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/browser.xml' }]],
  use: { baseURL: `http://127.0.0.1:${previewPort}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/preview-workflow.mjs',
    url: `http://127.0.0.1:${previewPort}/api/auth/session`,
    reuseExistingServer: false,
    env: { PORT: previewPort, PREVIEW_START_SIGNED_OUT: '1' },
  },
});
