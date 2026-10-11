import { test, expect } from '@playwright/test';

test('内建广场 campus slider stays unselected until the member picks one', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer', password: 'synthetic' } });
  await page.route('**/api/portal/me', (route) => route.fulfill({ json: { ok: true, enrollments: [], profile: {} } }));
  await page.route('**/api/public/warmth/capabilities', (route) => route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } }));

  await page.goto('/community');
  await page.locator('.community-program__participation button').first().click();

  const field = page.locator('.campus-segmented-field');
  const thumb = field.locator('.segmented__thumb');
  await expect(field).toBeVisible();

  // Nothing chosen yet: the indicator must not park on 鼓楼 and paint it grey-on-red.
  await expect(thumb).toHaveCSS('opacity', '0');
  await expect(field.getByRole('radio', { name: '鼓楼' })).toHaveAttribute('aria-checked', 'false');

  await field.getByRole('radio', { name: '鼓楼' }).click();
  await expect(thumb).toHaveCSS('opacity', '1');
  await expect(field.getByRole('radio', { name: '鼓楼' })).toHaveCSS('color', 'rgb(255, 255, 255)');
});
