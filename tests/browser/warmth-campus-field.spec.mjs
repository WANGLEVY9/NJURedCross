import { test, expect } from '@playwright/test';

test('内建广场 campus slider preselects 鼓楼 and follows the member choice', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer', password: 'synthetic' } });
  await page.route('**/api/portal/me', (route) => route.fulfill({ json: { ok: true, enrollments: [], profile: {} } }));
  await page.route('**/api/public/warmth/capabilities', (route) => route.fulfill({ json: { ok: true, birthday: { enabled: true, ready: true, automaticDelivery: false }, morning: { enabled: true, ready: true } } }));

  await page.goto('/community');
  await page.locator('.community-program__participation button').first().click();

  const field = page.locator('.campus-segmented-field');
  const thumb = field.locator('.segmented__thumb');
  await expect(field).toBeVisible();

  // 初次报名默认落在第一个校区，而且必须是“真选中”：指示块可见、文字为白色。
  await expect(thumb).toHaveCSS('opacity', '1');
  await expect(field.getByRole('radio', { name: '鼓楼' })).toHaveAttribute('aria-checked', 'true');
  await expect(field.getByRole('radio', { name: '鼓楼' })).toHaveCSS('color', 'rgb(255, 255, 255)');

  await field.getByRole('radio', { name: '苏州' }).click();
  await expect(field.getByRole('radio', { name: '苏州' })).toHaveAttribute('aria-checked', 'true');
  await expect(field.getByRole('radio', { name: '鼓楼' })).toHaveAttribute('aria-checked', 'false');
});
