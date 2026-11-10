import { test, expect } from '@playwright/test';

/**
 * Regression for the two UNO complaints: the game entry used to appear only
 * after capability discovery (and was rebuilt once more on refresh), and an
 * early click started a cold module waterfall. These checks keep the entry
 * synchronous/stable and the game module graph warm before navigation.
 */
const UNO_MODULES = [
  '/app/portal/pages/uno.js',
  '/app/games/uno/engine.js',
  '/app/games/uno/ai.js',
  '/app/games/uno/client.js',
  '/app/games/uno/bgm.js',
  '/app/games/uno/announce.js',
  '/app/games/uno/hand-sort.js',
];

async function openPlaza(page, { holdCapabilities = false } = {}) {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/public/warmth/capabilities', async route => {
    if (holdCapabilities) await gate;
    return route.fulfill({ json: { birthday: { enabled: true, ready: true } } });
  });
  return { release };
}

test('UNO entry paints with the first frame and is not rebuilt later', async ({ page }) => {
  const { release } = await openPlaza(page, { holdCapabilities: true });
  await page.goto('/community');
  // Capability discovery is still blocked; the game entry must already exist.
  await expect(page.locator('#uno-entry')).toBeVisible({ timeout: 1500 });
  console.log('[uno-entry]', JSON.stringify({
    visibleAtMs: await page.evaluate(() => Math.round(performance.now())),
    capabilitiesHeld: true,
  }));
  await expect(page.locator('#uno-entry a[href="/games/uno"]')).toBeVisible();
  await page.locator('#uno-entry').evaluate(node => { node.dataset.probe = 'stable'; });

  release();
  await expect(page.locator('.community-programs--loading')).toHaveCount(0);
  await expect(page.locator('#uno-entry')).toBeVisible();
  // Same DOM node after the real page replaces the skeleton and after the
  // signed-in refresh: no flash, no replayed entrance animation.
  await expect(page.locator('#uno-entry')).toHaveAttribute('data-probe', 'stable');
  await expect(page.locator('.stagger > #uno-entry')).toHaveCSS('animation-name', 'none');
});

test('plaza warms the full UNO module graph before an early click', async ({ page }) => {
  await openPlaza(page);
  const modulePaths = new Set();
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/app/games/uno/') || path.endsWith('/pages/uno.js')) modulePaths.add(path);
  });
  await page.goto('/community');
  await expect(page.locator('#uno-entry')).toBeVisible();
  for (const module of UNO_MODULES) {
    await expect(page.locator(`link[rel="modulepreload"][href*="${module}"]`)).toHaveCount(1);
  }
  await expect(page.locator('link[rel="preload"][as="style"][href*="/styles/uno.css"]')).toHaveCount(1);
  await expect.poll(() => UNO_MODULES.every(module => modulePaths.has(module))).toBe(true);

  const warmed = new Set(modulePaths);
  await page.locator('#uno-entry a[href="/games/uno"]').click();
  await expect(page.locator('.uno-page')).toBeVisible();
  // Clicking must not discover any new game module: the waterfall is gone.
  expect([...modulePaths].filter(path => !warmed.has(path))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('.uno-page img[width="400"][height="610"]').count()).toBeGreaterThan(0);
});
