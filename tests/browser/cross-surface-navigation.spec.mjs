import { test, expect } from '@playwright/test';

test('leaving the console for the portal reloads the document instead of reusing console styles', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.goto('/console/overview');
  await expect(page.locator('.operations-overview')).toBeVisible();

  // 模拟浏览器后退 / 任何在 SPA 内跳回门户的路径。
  // 整页跳转会销毁当前执行上下文，这里主动忽略这个预期的导航错误。
  await page.evaluate(async () => {
    const { navigate } = await import('/app/core/router.js');
    void navigate('/');
  }).catch(() => {});

  await page.waitForURL(url => url.pathname === '/');
  // 移动端用底部 dock，桌面用顶栏；统一用 surface 标记判断已切到门户。
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.surface).catch(() => '')).toBe('portal');

  const state = await page.evaluate(() => ({
    surface: document.documentElement.dataset.surface,
    styles: [...document.querySelectorAll('link[rel=stylesheet]')].map(link => new URL(link.href).pathname.split('/').pop()),
    consoleShell: document.querySelectorAll('.console-shell, .console-nav, aside[aria-label="管理端导航"]').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

  expect(state.surface).toBe('portal');
  expect(state.styles).not.toContain('app-console.css');
  expect(state.consoleShell).toBe(0);
  expect(state.overflow).toBe(false);
});

test('entering the console from the portal also reloads, keeping the console bundle isolated', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.surface).catch(() => '')).toBe('portal');

  await page.evaluate(async () => {
    const { navigate } = await import('/app/core/router.js');
    void navigate('/console/overview');
  }).catch(() => {});

  await page.waitForURL(url => url.pathname === '/console/overview');
  await expect(page.locator('.operations-overview')).toBeVisible();

  const styles = await page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map(link => new URL(link.href).pathname.split('/').pop()));
  expect(styles).not.toContain('app.css');
});
