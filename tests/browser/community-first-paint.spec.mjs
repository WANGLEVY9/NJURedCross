import { test, expect } from '@playwright/test';

/**
 * Regression for the community plaza first-paint bug: the hero/card layout CSS
 * travels in JS-inserted route bundles, so on a slow link the first frame used
 * to be one unstyled full-width photograph (~1500px tall) with the headline
 * pushed below the viewport for several seconds. The critical bundle now carries
 * the structural declarations, so the first frame must be correct even while
 * both the route stylesheets and capability discovery are still pending.
 */
test('community first paint stays laid out while route styles and data are pending', async ({ page }) => {
  // The plaza is behind a development gate for anonymous visitors.
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.route('**/styles/app-route-*.css*', async route => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    return route.continue();
  });
  await page.route('**/api/public/warmth/capabilities', async route => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    return route.fulfill({ json: { birthday: { enabled: true, ready: true } } });
  });

  // `commit` avoids waiting for `load`, which would hide the very first frame.
  await page.goto('/community', { waitUntil: 'commit' });
  await expect(page.locator('.events-hero')).toBeAttached({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('link[href^="/styles/app.css"]')?.media)).toBe('all');

  const frame = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
    const programs = document.querySelector('.community-programs');
    const routeLink = document.querySelector('link[href*="app-route-events.css"]');
    return {
      heroHeight: Math.round(rect('.events-hero')?.height || 0),
      imgHeight: Math.round(rect('.events-hero__art img')?.height || 0),
      copyTop: Math.round(rect('.events-hero__copy')?.top || 0),
      artPosition: getComputedStyle(document.querySelector('.events-hero__art')).position,
      columns: getComputedStyle(programs).gridTemplateColumns.split(' ').length,
      routeStyleApplied: routeLink ? routeLink.media === 'all' && Boolean(routeLink.sheet) : false,
    };
  });
  console.log('[community-first-paint]', JSON.stringify(frame));
  // Narrow viewports use the taller stacked hero and a single card column.
  const viewport = page.viewportSize();
  const narrow = Boolean(viewport && viewport.width <= 768);
  const maxHero = narrow ? 800 : 500;
  expect(frame.heroHeight).toBeLessThanOrEqual(maxHero);
  expect(frame.imgHeight).toBeLessThanOrEqual(maxHero);
  expect(frame.copyTop).toBeLessThan(600);
  expect(frame.artPosition).toBe('absolute');
  expect(frame.columns).toBeGreaterThanOrEqual(narrow ? 1 : 2);
  // The proof: the geometry above holds while the route bundle is still absent.
  expect(frame.routeStyleApplied).toBe(false);
});
