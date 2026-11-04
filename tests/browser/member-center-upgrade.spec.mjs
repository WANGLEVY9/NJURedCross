import { test, expect } from '@playwright/test';

const payload = {
  ok: true,
  participant: { realName: '合成同学', studentId: '231250082', department: '软件学院', grade: '23 本' },
  platformHours: { totalHours: 53, academicYearHours: 28.5, rank: 42 },
  sync: { lastRunAt: '2026-11-02T22:00:00.000Z', nextAt: '2026-11-09T22:00:00.000Z', label: '每周一 06:00（北京时间）' },
  ledger: [],
  registrations: [
    { code: 'DONE-1', eventName: '10.31 会员大会', date: '2026-10-31', location: '仙林校区', status: '已签到', entryStatus: '网站已入账',
      hours: { code: 'synced', label: '已同步个人主页', tone: 'success', profileSynced: true, summarySynced: true,
        hours: { serviceHours: 3, trainingHours: 1, travelHours: 1, totalHours: 5 } } },
    { code: 'PENDING-1', eventName: '10.29 献血周志愿服务', date: '2026-10-29', location: '鼓楼校区', status: '已签到', entryStatus: '待录入',
      hours: { code: 'profile_pending', label: '已入账 · 待同步个人主页', tone: 'info', profileSynced: false, summarySynced: true,
        hours: { serviceHours: 6, trainingHours: 0, travelHours: 0, totalHours: 6 } } },
  ],
};

async function signIn(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/portal/workflow/me', route => route.fulfill({ json: payload }));
}

test('member centre hero, three statistics, weekly sync note and timeline render on desktop', async ({ page }) => {
  await signIn(page, { width: 1440, height: 900 });
  await page.goto('/me', { waitUntil: 'networkidle' });
  const hero = page.locator('.mc-hero');
  await expect(hero).toBeVisible();
  await expect(hero.getByRole('heading', { level: 1 })).toHaveText('每一份参与，都值得好好记录');
  const dashboard = hero.locator('.mc-dashboard');
  await expect(dashboard).toBeVisible();
  await expect(dashboard.locator('.mc-dashboard__total')).toHaveText('53');
  await expect(dashboard.locator('.mc-dashboard__grid')).toContainText('28.5');
  await expect(dashboard.locator('.mc-dashboard__grid')).toContainText('第 42 名');
  await expect(dashboard.locator('.mc-dashboard__note')).toContainText('每周一 06:00');
  await expect(hero.locator('.mc-chip--verified')).toBeVisible();
  await expect(hero.getByRole('link', { name: '浏览活动' })).toHaveAttribute('href', '/events');

  await page.goto('/me?view=records', { waitUntil: 'networkidle' });
  await expect(page.locator('.mc-stat')).toHaveCount(3);
  // The two official figures keep their original selectors and values.
  await expect(page.locator('.member-hours__metrics strong')).toHaveText(['53', '28.5']);
  await expect(page.locator('.mc-stat--pending')).toContainText('6');
  await expect(page.locator('.mc-sync')).toContainText('每周一 06:00');
  await expect(page.locator('.mc-timeline__node')).toHaveCount(2);
  await expect(page.locator('.member-hours__record[data-mc-state="done"]')).toHaveCount(1);
  await expect(page.locator('.member-hours__record[data-mc-state="active"]')).toHaveCount(1);
  await expect(page.locator('.mc-quick__item')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('member centre stacks into a single column on mobile without overflow', async ({ page }) => {
  await signIn(page, { width: 393, height: 852 });
  await page.goto('/me?view=records', { waitUntil: 'networkidle' });
  await expect(page.locator('.mc-hero')).toBeVisible();
  const heroColumns = await page.locator('.mc-hero').evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(heroColumns.trim().split(/\s+/).length).toBe(1);
  const statColumns = await page.locator('.mc-stats').evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(statColumns.trim().split(/\s+/).length).toBe(2);
  const quickColumns = await page.locator('.mc-quick').evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(quickColumns.trim().split(/\s+/).length).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.mc-sync')).toBeVisible();
  await expect(page.locator('.mc-quick__item').first()).toBeVisible();
});

test('missing academic-year totals remain unknown in both hero and records statistics',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{...payload,platformHours:{totalHours:53,academicYearHours:null}}}));
 await page.goto('/me?view=records',{waitUntil:'networkidle'});
 await expect(page.locator('.mc-dashboard__figure').first()).toHaveText('—');await expect(page.locator('.member-hours__metrics strong')).toHaveText(['53','—']);
});
