import { test, expect } from '@playwright/test';

/**
 * Route-scoped CSS is declared by the style manifest and inserted on demand.
 * These checks keep the delivery contract honest: the homepage must not pay for
 * other routes, /events must still be fully styled before startup completes,
 * and SPA navigation must add (not re-download) the target route's bundles.
 */
async function collectRouteRequests(page, action) {
  const seen = [];
  const listener = request => {
    const name = new URL(request.url()).pathname.split('/').at(-1);
    if (name.startsWith('app-route-')) seen.push(name);
  };
  page.on('request', listener);
  try { await action(); } finally { page.off('request', listener); }
  return seen;
}

test('homepage only downloads its own route bundle', async ({ page }) => {
  const seen = await collectRouteRequests(page, async () => {
    await page.goto('/');
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.locator('.home-cranes h1')).toBeVisible();
  });
  expect(seen).toEqual(['app-route-home.css']);
  await expect(page.locator('link[href^="/styles/app-route-home.css"]')).toHaveAttribute('data-deferred-style', 'loaded');
});

test('events plaza loads its layout and booking styles before readiness', async ({ page }) => {
  const seen = await collectRouteRequests(page, async () => {
    await page.goto('/events');
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toBeVisible();
  });
  expect(seen.slice().sort()).toEqual(['app-route-booking.css', 'app-route-events.css']);
  await expect(page.locator('link[href^="/styles/app-route-events.css"]')).toHaveAttribute('data-deferred-style', 'loaded');
});

test('SPA navigation inserts the target route bundles only once', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#boot-screen')).toHaveCount(0);
  const seen = await collectRouteRequests(page, async () => {
    // On phones the portal nav lives inside a collapsed menu; a DOM click
    // still reaches the delegated SPA router without depending on visibility.
    await page.locator('a[href="/materials"]').first().evaluate(node => node.click());
    await expect(page).toHaveURL(/\/materials$/);
    await expect(page.locator('.plaza-hero')).toBeVisible();
  });
  expect(seen).toEqual(['app-route-materials.css', 'app-route-events.css']);
  await expect(page.locator('link[href^="/styles/app-route-materials.css"]')).toHaveCount(1);
  await expect(page.locator('link[href^="/styles/app-route-materials.css"]')).toHaveAttribute('data-deferred-style', 'loaded');
});

test('console surface never downloads portal route bundles', async ({ page }) => {
  const seen = await collectRouteRequests(page, async () => {
    await page.goto('/console/login');
    await expect(page.locator('#boot-screen')).toHaveCount(0);
  });
  expect(seen).toEqual([]);
});
