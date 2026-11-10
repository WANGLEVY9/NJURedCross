import { test, expect } from '@playwright/test';

/**
 * Lightweight visual regression matrix: four representative viewports across
 * the public routes. We assert the two things screenshots cannot argue with —
 * no horizontal overflow and the shared shell is actually rendered — and
 * attach one homepage screenshot per width for human review.
 */
const WIDTHS = [375, 768, 1024, 1440];
// /login redirects when a sibling spec has already signed in an administrator,
// so the matrix sticks to routes whose surface is stable across test order.
const ROUTES = ['/', '/events', '/outreach', '/community', '/materials', '/about'];

for (const width of WIDTHS) {
  test(`public routes fit a ${width}px viewport without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const offenders = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('#boot-screen')).toHaveCount(0);
      await expect(page.locator('.phead')).toBeVisible();
      const measured = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        body: document.body.scrollWidth,
      }));
      if (measured.document > width + 1 || measured.body > width + 1) {
        offenders.push({ route, ...measured });
      }
      if (route === '/') {
        await test.info().attach(`home-${width}.png`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    }
    expect(offenders).toEqual([]);
  });
}
