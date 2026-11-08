import { test, expect } from '@playwright/test';

const feed = {
  ok: true, registrations: [], ledger: [], attendanceRequests: [], events: [],
  participant: { realName: '王泰杰', studentId: '231250082', department: '软件学院', grade: '23本' },
  platformHours: { totalHours: 53, academicYearHours: 28.5, rank: 42 },
  sync: { lastRunAt: '2026-11-06T14:00:00.000Z', nextAt: null, label: '由平台统一核对' },
};

test('member hero shows identity and three equal hour cards', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/portal/workflow/hours', route => route.fulfill({ json: feed }));
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
  let attempts = 0; const urls = [];
  await page.route('**/api/portal/workflow/hours*', route => {
    urls.push(route.request().url()); attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { ok: false, message: '暂时无法读取' } })
      : route.fulfill({ json: feed });
  });
  await page.goto('/me');

  await expect(page.locator('.mc-dashboard--failed')).toBeVisible();
  await expect(page.locator('.mc-dashboard__note')).toContainText('时长暂时无法读取');

  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.locator('.mc-hcard--lead')).toContainText('53');
  await expect(page.locator('.mc-dashboard--failed')).toHaveCount(0);
  expect(urls.some(url => url.includes('fresh='))).toBe(true);
});

test('hours remain visible when activity records fail', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/portal/workflow/me', route => route.fulfill({ status: 503, json: { ok: false, message: '活动记录暂不可用' } }));
  await page.route('**/api/portal/workflow/hours', route => route.fulfill({ json: feed }));
  await page.goto('/me');
  await expect(page.locator('.mc-hcard--lead')).toContainText('53');
  await expect(page.locator('.mc-dashboard--failed')).toHaveCount(0);
});


test('notification preference forms two aligned columns with matching labels', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/auth/account', route => route.fulfill({ json: {
    ok: true,
    account: { role: 'member', realName: '王泰杰', studentId: '231250082', email: '231250082@smail.nju.edu.cn',
      phone: '13802903512', department: '软件学院', grade: '23本', gender: '男', campus: '鼓楼',
      notificationEmail: '231250082@smail.nju.edu.cn', wechat: 'WANGLEVY9', qq: '2216622760',
      certificate: '否', accountId: 'ACC-1', memberCode: 'RC-1' },
    profileMapping: { state: '已同步', options: {}, readonly: { division: '主席团 & 指导组', totalHours: '53' } },
  } }));
  await page.goto('/me');
  const pref = page.locator('.pf-preference');
  await expect(pref).toBeVisible();
  await expect(pref.locator('.pf-preference__aside-label')).toHaveText('投递说明');
  const geometry = await page.evaluate(() => {
    const label = document.querySelector('.pf-preference__field .field__label');
    const aside = document.querySelector('.pf-preference__aside-label');
    const input = document.querySelector('.pf-preference__field .input, .pf-preference__field input');
    const note = document.querySelector('.pf-preference__note');
    const top = node => node ? Math.round(node.getBoundingClientRect().top) : null;
    const height = node => node ? Math.round(node.getBoundingClientRect().height) : null;
    return { label: top(label), aside: top(aside), input: top(input), note: top(note), noteHeight: height(note) };
  });
  // 移动端为单列，只要求说明文字可读且无横向溢出。
  if (testInfo.project.name.includes('mobile')) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    return;
  }
  // 桌面：左右两栏标题同一行；说明与输入框同一内容行且等高。
  expect(Math.abs(geometry.label - geometry.aside)).toBeLessThanOrEqual(2);
  expect(geometry.noteHeight).toBeGreaterThanOrEqual(40);
  expect(geometry.note).toBeGreaterThanOrEqual(geometry.aside + 10);
});
