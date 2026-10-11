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

test('内建广场 renders before a slow capability answer arrives', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();
  // The check is still in flight: the page module alone decides the first paint.
  await expect(page.locator('.community-eyebrow')).toBeVisible({ timeout: 2500 });
  await expect(page.locator('.plaza-intro')).toHaveCount(0);
});

test('内建广场 corrects the view when the pilot turns out to be off', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({ json: { ok: true, birthday: { enabled: false, ready: false }, morning: { enabled: false, ready: false } } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.community-eyebrow')).toBeVisible({ timeout: 2500 });

  await expect(page.locator('.plaza-intro')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.community-eyebrow')).toHaveCount(0);
});

test('内建广场 shows its own preview while the view resolves, then replaces it', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } });
  });
  // The page module is what the preview now covers: the capability answer no
  // longer sits on the critical path.
  await page.route('**/app/portal/pages/warmth-birthday.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
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
    const { warmthPreview } = await import('/app/portal/pages/warmth.js');
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

test('内建广场 entry is warmed before the click, from another board', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } });
  });
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/outreach');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');

  await expect.poll(() => requested.some((url) => url.endsWith('/app/portal/pages/warmth.js')), { timeout: 8000 }).toBe(true);
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.community-eyebrow')).toBeVisible({ timeout: 10_000 });
});

test('the warm-up never fetches another board', async ({ page }) => {
  const requested = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/events');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
  await page.waitForTimeout(2500);

  const modules = requested.filter((url) => url.includes('/app/portal/pages/'));
  expect(modules.some((url) => url.endsWith('/app/portal/pages/warmth.js'))).toBe(true);
  expect(modules.filter((url) => !url.endsWith('/app/portal/pages/events.js'))).toEqual(
    modules.filter((url) => url.endsWith('/app/portal/pages/warmth.js')),
  );
});

test('内建广场 keeps the birthday view when the capability check fails', async ({ page }) => {
  await page.route(CAPABILITIES, async (route) => {
    await route.fulfill({ status: 500, json: { ok: false, message: 'capability check unavailable' } });
  });

  await page.goto('/');
  await page.locator('a[href="/community"]:visible').first().click();
  await expect(page.locator('.community-eyebrow')).toBeVisible({ timeout: 10_000 });
  // A transport failure must not be read as "the pilot is off".
  await page.waitForTimeout(700);
  await expect(page.locator('.community-eyebrow')).toBeVisible();
  await expect(page.locator('.plaza-intro')).toHaveCount(0);
});
