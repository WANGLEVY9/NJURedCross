import { test, expect } from '@playwright/test';

function gate() {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  return { ready, release };
}
const overview = { stats: { openSeats: 7, totalRegistrations: 20, inventoryCategories: 3 } };

async function emptyEvents(page) {
  await page.route('**/api/public/events**', route => route.fulfill({ json: { events: [] } }));
}

test('homepage is usable while its session request is still pending', async ({ page }) => {
  const held = gate(), started = gate();
  await emptyEvents(page);
  await page.route('**/api/public/overview', route => route.fulfill({ json: overview }));
  await page.route('**/api/auth/session', async route => {
    started.release();
    await held.ready;
    await route.fulfill({ json: { ok: true, authenticated: false } });
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await started.ready;
    await expect(page.locator('.home-cranes h1')).toBeVisible();
    await expect(page.getByRole('button', { name: '写下寄语', exact: true })).toBeVisible();
    await expect(page.locator('.home-impact__item b')).toHaveText(['0', '7', '20', '3']);
  } finally {
    held.release();
  }
});

test('activity count appears before a slow overview and survives its failure', async ({ page }) => {
  const held = gate(), finished = gate();
  await emptyEvents(page);
  await page.route('**/api/public/overview', async route => {
    await held.ready;
    await route.fulfill({ status: 403, json: { ok: false, message: 'synthetic overview failure' } });
    finished.release();
  });
  try {
    await page.goto('/');
    const cranes = page.getByRole('heading', { name: '让善意，乘风而行', exact: true });
    await expect(cranes).toBeVisible();
    await expect(page.locator('.home-impact__item b').first()).toHaveText('0');
    await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy', 'true');
    held.release();
    await finished.ready;
    await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy', 'false');
    await expect(cranes).toBeVisible();
    await expect(page.locator('.home-impact__item').nth(1)).toContainText('暂未更新');
    await expect(page.locator('.home-impact__item b')).toHaveText(['0', '—', '—', '—']);
  } finally {
    held.release();
  }
});

test('overview figures appear while the activity request is still pending', async ({ page }) => {
  const held = gate();
  await page.route('**/api/public/events**', async route => {
    await held.ready;
    await route.fulfill({ json: { events: [] } });
  });
  await page.route('**/api/public/overview', route => route.fulfill({ json: overview }));
  try {
    await page.goto('/');
    await expect(page.locator('.home-impact__item b')).toHaveText(['—', '7', '20', '3']);
    held.release();
    await expect(page.locator('.home-impact__item b')).toHaveText(['0', '7', '20', '3']);
  } finally {
    held.release();
  }
});

test('navigation reuses the delivered shared bundle without extra specialised requests', async ({ page }) => {
  const requests = [];
  const specialised = new Set(['warmth.css', 'morning.css', 'calendar.css', 'booking.css', 'material-services.css']);
  page.on('request', request => {
    const name = new URL(request.url()).pathname.split('/').at(-1);
    if (specialised.has(name)) requests.push(name);
  });
  await emptyEvents(page);
  await page.route('**/api/public/overview', route => route.fulfill({ json: overview }));
  await page.goto('/');
  await expect(page.locator('.home-cranes h1')).toBeVisible();
  expect(requests).toEqual([]);
  const before = await page.locator('head link[rel="stylesheet"]').evaluateAll(links =>
    links.map(link => link.getAttribute('href') || link.dataset.pageStyle));
  const bundled=await page.locator('link[data-bundled-styles]').getAttribute('data-bundled-styles');
  for(const name of specialised)expect(bundled.split(' ')).toContain('/styles/'+name);
  await expect(page.locator('link[data-bundled-styles]')).toHaveAttribute('data-deferred-style','loaded');
  await page.getByRole('link', { name: '关于平台', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  expect(requests).toEqual([]);
  const after = await page.locator('head link[rel="stylesheet"]').evaluateAll(links =>
    links.map(link => link.getAttribute('href') || link.dataset.pageStyle));
  expect(after).toEqual(before);
  await page.getByRole('link', { name: '南京大学红十字会首页', exact: true }).first().click();
  await expect(page.locator('.home-cranes h1')).toBeVisible();
  expect(requests).toHaveLength(0);
});
