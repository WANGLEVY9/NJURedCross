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

test('内建广场 shows its own preview while the view resolves, then replaces it', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();

  const preview = page.locator('#main .warmth-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.warmth-preview__card')).toHaveCount(3);
  const box = await preview.boundingBox();
  const viewport = page.viewportSize();
  expect(box.height).toBeGreaterThan(200);
  expect(box.width).toBeLessThanOrEqual(viewport.width + 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await expect(page.locator('.community-eyebrow')).toBeVisible({ timeout: 15_000 });
  await expect(preview).toHaveCount(0);
});

test('内建广场 preview only reveals itself once the wait is noticeable', async ({ page }) => {
  await page.goto('/');
  const states = await page.evaluate(async () => {
    const { warmthPreview } = await import('/app/portal/warmth-preview.js');
    const node = warmthPreview();
    // Attach outside the router outlet: this case only checks the reveal
    // contract, and the outlet is replaced while the page boots.
    document.body.appendChild(node);
    const read = () => getComputedStyle(node).visibility;
    const early = read();
    await new Promise((resolve) => setTimeout(resolve, 420));
    const later = read();
    node.remove();
    return { early, later };
  });
  expect(states.early).toBe('hidden');
  expect(states.later).toBe('visible');
});
