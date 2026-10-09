import { test, expect } from '@playwright/test';

// The server is an in-memory fixture. No production tokens, SMTP or database writes.
for (const path of ['/', '/events', '/materials', '/outreach', '/community', '/about', '/login', '/console/login']) {
  test(`page boots and fits viewport: ${path}`, async ({ page }) => {
    const errors = [];
    const brokenAssets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (/\/(app|styles|assets)\//.test(response.url()) && response.status() >= 400) brokenAssets.push(response.url());
    });
    await page.goto(path);
    await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(brokenAssets).toEqual([]);
  });
}

test('anonymous member and administrator routes redirect to the correct sign-in', async ({ page }) => {
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/console/workflow');
  await expect(page).toHaveURL(/\/console\/login\?next=/);
});

test('blood calendar renders synthetic slots and supports week navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.getByRole('heading', { name: '献血车报名日历' })).toBeVisible();
  await expect(page.getByText('新街口中央', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /下周/ }).click();
  await expect(page.getByText(/2026\/10\/19/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
