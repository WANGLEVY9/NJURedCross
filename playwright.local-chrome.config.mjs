/**
 * 本地临时配置（不入库）：复用系统已安装的 Chrome，绕过 Playwright 浏览器下载。
 * 用途：本机缺少 chromium-1248 且 CDN 下载速率仅约 30 KB/s 时的等效回归验证。
 * 运行：node node_modules/@playwright/test/cli.js test --config=playwright.local-chrome.config.mjs
 */
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
});
