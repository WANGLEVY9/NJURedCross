import { test, expect } from '@playwright/test';

const apiCalls = page => {
  const seen = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
  });
  return seen;
};

test('hovering a console module warms its first-screen reads before the click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'hover 预取面向桌面指针设备');
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  const seen = apiCalls(page);
  await page.goto('/console/overview');
  await expect(page.locator('.operations-overview')).toBeVisible();
  seen.length = 0;

  await page.getByRole('complementary', { name: '管理端导航' }).getByRole('link', { name: '活动管理', exact: true }).hover();
  await expect.poll(() => seen.some(path => path.includes('/workflow/catalog'))).toBe(true);
});

test('hovering a portal module warms the member centre reads before the click', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'hover 预取面向桌面指针设备');
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  const seen = apiCalls(page);
  await page.goto('/');
  await expect(page.locator('.pnav')).toBeVisible();
  seen.length = 0;

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '会员中心', exact: true }).hover();
  await expect.poll(() => seen.some(path => path === '/api/portal/workflow/me')).toBe(true);
});
