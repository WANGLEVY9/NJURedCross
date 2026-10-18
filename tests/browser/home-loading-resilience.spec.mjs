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
    await expect(page.locator('.home-page .hero h1')).toBeVisible();
    await expect(page.getByRole('link', { name: '浏览开放活动', exact: true })).toBeVisible();
    await expect(page.locator('.hero__figure b')).toHaveText(['0', '7', '20', '3']);
  } finally {
    held.release();
  }
});

test('activity results appear before a slow overview and survive its failure', async ({ page }) => {
  const held = gate(), finished = gate();
  await emptyEvents(page);
  await page.route('**/api/public/overview', async route => {
    await held.ready;
    await route.fulfill({ status: 403, json: { ok: false, message: 'synthetic overview failure' } });
    finished.release();
  });
  try {
    await page.goto('/');
    const empty = page.getByRole('heading', { name: '目前没有开放报名的活动', exact: true });
    await expect(empty).toBeVisible();
    await expect(page.locator('.hero__figure b').first()).toHaveText('0');
    await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy', 'true');
    held.release();
    await finished.ready;
    await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy', 'false');
    await expect(empty).toBeVisible();
    await expect(page.getByText('暂时无法读取活动数据', { exact: true })).toHaveCount(0);
    await expect(page.locator('.hero__figure b')).toHaveText(['0', '—', '—', '—']);
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
    await expect(page.locator('.hero__figure b')).toHaveText(['—', '7', '20', '3']);
    held.release();
    await expect(page.locator('.hero__figure b')).toHaveText(['0', '7', '20', '3']);
  } finally {
    held.release();
  }
});

test('homepage skips specialised styles and navigation loads them once in their original positions', async ({ page }) => {
  const requests = [];
  const specialised = new Set(['warmth.css', 'morning.css', 'calendar.css', 'booking.css', 'material-services.css']);
  page.on('request', request => {
    const name = new URL(request.url()).pathname.split('/').at(-1);
    if (specialised.has(name)) requests.push(name);
  });
  await emptyEvents(page);
  await page.route('**/api/public/overview', route => route.fulfill({ json: overview }));
  await page.goto('/');
  await expect(page.locator('.home-page .hero h1')).toBeVisible();
  expect(requests).toEqual([]);
  const before = await page.locator('head link[rel="stylesheet"]').evaluateAll(links =>
    links.map(link => link.getAttribute('href') || link.dataset.pageStyle));
  await page.getByRole('link', { name: '平台与隐私说明', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.locator('link[data-page-style][data-loaded="true"]')).toHaveCount(5);
  expect([...requests].sort()).toEqual([...specialised].sort());
  const after = await page.locator('head link[rel="stylesheet"]').evaluateAll(links =>
    links.map(link => link.getAttribute('href') || link.dataset.pageStyle));
  expect(after).toEqual(before);
  await page.getByRole('link', { name: '南京大学红十字会首页', exact: true }).first().click();
  await expect(page.locator('.home-page .hero h1')).toBeVisible();
  expect(requests).toHaveLength(5);
});
