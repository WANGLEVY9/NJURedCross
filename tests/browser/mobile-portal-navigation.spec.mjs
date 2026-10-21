import { test, expect } from '@playwright/test';

const paths = ['/events', '/outreach', '/', '/community', '/materials'];
test('mobile navigation puts home in the center and personal services in the header', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/outreach');
  const dock = page.getByRole('navigation', { name: '广场导航', exact: true });
  await expect(dock.locator('a')).toHaveText(['活动', '宣传', '首页', '内建', '物资']);
  expect(await dock.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(paths);
  const mine = page.locator('.phead [data-mobile-account]');
  await expect(mine).toBeVisible();
  await expect(mine).toHaveText('我的');
  await mine.click();
  await expect(page).toHaveURL(/\/login\?next=%2Fme/);
  await expect(mine).toHaveAttribute('aria-current', 'page');
  await expect(dock.locator('[aria-current="page"]')).toHaveCount(0);
  for (const path of paths) {
    await dock.locator(`a[href="${path}"]`).click();
    await expect(dock.locator('[aria-current="page"]')).toHaveAttribute('href', path);
    await expect(mine).not.toHaveAttribute('aria-current', 'page');
  }
  for (const width of [320, 390, 768, 960]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const box = await mine.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await page.route('**/api/auth/session', route => route.fulfill({ json: { ok: true, authenticated: true, csrfToken: 'synthetic', user: { username: 'synthetic-member', role: 'member', consoleAccess: false, permissions: [] } } }));
  await page.goto('/outreach');
  await expect(mine).toHaveAttribute('href', '/me');
  await mine.click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(mine).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mine).toBeHidden();
  await expect(dock).toBeHidden();
  await expect(page.locator('#portal-navigation a[href="/me"]')).toBeVisible();
});
