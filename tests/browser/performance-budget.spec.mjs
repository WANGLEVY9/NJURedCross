import { test, expect } from '@playwright/test';

/**
 * Startup performance guard. The plaza hero must ship exactly one high-priority
 * frame: every other slide is warmed at low priority on demand. We also record
 * navigation timing and transferred bytes as a baseline attached to the test
 * result, so a later regression is visible instead of being guessed.
 */
test('startup keeps a bounded number of eager images and style bundles', async ({ page }) => {
  const scriptRequests = [];
  page.on('request', request => {
    if (request.resourceType() === 'script' || /\.js(?:\?|$)/.test(request.url())) scriptRequests.push(request.url());
  });

  await page.goto('/events');
  await expect(page.locator('#boot-screen')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '参与流程', exact: true })).toBeVisible();

  const budget = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return {
      highPriorityImages: document.querySelectorAll('img[loading="eager"][fetchpriority="high"]').length,
      eagerImages: document.querySelectorAll('img[loading="eager"]').length,
      styleBundles: document.querySelectorAll('link[data-bundled-styles]').length,
      heroFrames: document.querySelectorAll('.events-hero__art > img').length,
      loadEventEnd: Math.round(navigation?.loadEventEnd || 0),
      domContentLoaded: Math.round(navigation?.domContentLoadedEventEnd || 0),
      firstContentfulPaint: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
      transferredBytes: resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
      resourceCount: resources.length,
    };
  });

  // The startup crest is removed with the splash; at most the hero's first
  // frame may still be eager/high. Any extra high-priority slide is a regression.
  expect(budget.highPriorityImages).toBeLessThanOrEqual(1);
  expect(budget.heroFrames).toBeLessThanOrEqual(2);
  // critical + shared extra + at most two route groups for /events.
  expect(budget.styleBundles).toBeLessThanOrEqual(4);
  expect(budget.loadEventEnd).toBeGreaterThan(0);
  // Soft budgets against the recorded cold-start baseline (~673 KB / 65
  // resources / 44 scripts). Generous headroom keeps CI variance from failing
  // the build while still catching a new eager image or an extra CSS bundle.
  expect(budget.transferredBytes).toBeLessThan(900_000);
  expect(budget.resourceCount).toBeLessThan(90);
  expect(scriptRequests.length).toBeLessThan(60);

  const baseline = { ...budget, scriptRequests: scriptRequests.length };
  console.log('[startup-budget]', JSON.stringify(baseline));
  await test.info().attach('startup-budget.json', {
    body: Buffer.from(JSON.stringify(baseline, null, 2)),
    contentType: 'application/json',
  });
});
