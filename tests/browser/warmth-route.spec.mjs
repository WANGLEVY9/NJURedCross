import { test, expect } from '@playwright/test';

const CAPABILITIES = '**/api/public/warmth/capabilities';

test('内建广场 renders the birthday view and only asks once per remembered window', async ({ page }) => {
  let calls = 0;
  await page.route(CAPABILITIES, async (route) => {
    calls += 1;
    await route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.community-eyebrow')).toBeVisible();

  const afterFirstVisit = calls;
  await page.locator('a[href="/"]:visible').first().click();
  await expect(page.locator('.home-page')).toBeVisible();
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.community-eyebrow')).toBeVisible();
  expect(calls).toBe(afterFirstVisit);
});

test('内建广场 falls back to the legacy view when the pilot is off', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await route.fulfill({ json: { ok: true, birthday: { enabled: false, ready: false }, morning: { enabled: false, ready: false } } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.plaza-intro')).toBeVisible();
  await expect(page.locator('.community-eyebrow')).toHaveCount(0);
});
