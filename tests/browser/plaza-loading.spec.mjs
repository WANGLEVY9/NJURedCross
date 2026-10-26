import { test, expect } from '@playwright/test';

test('community paints its own heading while schema discovery is still pending', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/public/warmth/capabilities', async route => {
    await gate;
    await route.fulfill({ json: { birthday: { enabled: true, ready: true } } });
  });
  await page.goto('/community');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('把温暖', { timeout: 1500 });
  await expect(page.getByText('正在加载参与计划…')).toBeVisible();
  release();
  await expect(page.locator('.community-programs')).toBeVisible();
});

test('community content does not wait for private member state or enable premature enrollment', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/public/warmth/capabilities', route => route.fulfill({ json: { birthday: { enabled: true, ready: true } } }));
  await page.route('**/api/portal/me?view=warmth', async route => {
    await gate;
    await route.fulfill({ json: { enrollments: [] } });
  });
  await page.route('**/api/morning/card', route => route.fulfill({ json: { card: null } }));
  await page.goto('/community');
  await expect(page.locator('.community-programs')).toBeVisible({ timeout: 1500 });
  await expect(page.locator('.community-program--birthday button')).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: '加入生日祝福', exact: true })).toBeEnabled();
});

test('leaving a pending community page cannot overwrite the next page', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/public/warmth/capabilities', async route => {
    await gate;
    await route.fulfill({ json: { birthday: { enabled: true, ready: true } } });
  });
  await page.goto('/community');
  await expect(page.getByText('正在加载参与计划…')).toBeVisible();
  if (await page.getByRole('button', { name: '展开导航', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
  }
  await page.locator('#portal-navigation').getByRole('link', { name: '活动广场', exact: true }).click();
  release();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.locator('.community-programs')).toHaveCount(0);
});
