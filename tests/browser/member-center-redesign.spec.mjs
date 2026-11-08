import { test, expect } from '@playwright/test';

const feed = {
  ok: true, registrations: [], ledger: [], attendanceRequests: [], events: [],
  participant: { realName: '王泰杰', studentId: '231250082', department: '软件学院', grade: '23本' },
  platformHours: { totalHours: 53, academicYearHours: 28.5, rank: 42 },
  sync: { lastRunAt: '2026-11-06T14:00:00.000Z', nextAt: null, label: '由平台统一核对' },
};

test('member hero shows identity and three equal hour cards', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/portal/workflow/me', route => route.fulfill({ json: feed }));
  await page.goto('/me');

  await expect(page.locator('.mc-hero__name')).toHaveText('王泰杰，你好');
  await expect(page.locator('.mc-hcard')).toHaveCount(3);
  await expect(page.locator('.mc-hcard--lead')).toContainText('53');
  await expect(page.locator('.mc-hcard').nth(1)).toContainText('28.5');
  await expect(page.locator('.mc-hcard').nth(2)).toContainText('第 42 名');

  if (!testInfo.project.name.includes('mobile')) {
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.mc-dashboard__cards')).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(3);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('a failed hours read is reported with a retry rather than shown as a dash', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  let attempts = 0;
  await page.route('**/api/portal/workflow/me', route => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { ok: false, message: '暂时无法读取' } })
      : route.fulfill({ json: feed });
  });
  await page.goto('/me');

  await expect(page.locator('.mc-dashboard--failed')).toBeVisible();
  await expect(page.locator('.mc-dashboard__note')).toContainText('时长暂时无法读取，数据未丢失');

  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.locator('.mc-hcard--lead')).toContainText('53');
  await expect(page.locator('.mc-dashboard--failed')).toHaveCount(0);
});
