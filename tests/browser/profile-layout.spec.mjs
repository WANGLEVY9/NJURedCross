import { test, expect } from '@playwright/test';

const account = {
  accountId: 'synthetic-organizer', role: 'member', realName: '合成同学', studentId: '999990001',
  email: '999990001@smail.nju.edu.cn', emailVerified: true, campus: '鼓楼', department: '合成院系',
  qq: '123456789', wechat: 'synthetic_wechat', gender: '女', phone: '13800000000', grade: '26本',
  certificate: '否', notificationEmail: '',
};

async function open(page) {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/auth/account', route => route.fulfill({
    json: { ok: true, account, profileMapping: { state: '已同步', options: {}, readonly: { division: '主席团', totalHours: '53' } } },
  }));
  await page.goto('/me?view=profile');
  await expect(page.locator('.pf-form')).toBeVisible();
}

test('profile form uses aligned two-column sections without orphan cells or stretched hints', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const sections = page.locator('.pf-section__title');
  await expect(sections).toHaveText(['账号信息', '基本资料', '通知偏好', '志愿资料']);
  const grid = page.locator('.pf-grid');
  const columns = await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(2);
  // 收信邮箱独占偏好区，不再与校区挤在同一行造成左右不等高。
  await expect(page.locator('.pf-preference [name="notificationEmail"]')).toBeVisible();
  await expect(grid.locator('[name="notificationEmail"]')).toHaveCount(0);
  const fields = await grid.evaluate(node => [...node.children].map(item => {
    const box = item.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
  }));
  expect(fields).toHaveLength(10);
  expect(new Set(fields.map(item => item.w)).size).toBe(1);
  expect(new Set(fields.map(item => item.y)).size).toBe(5);
  for (let index = 0; index < fields.length; index += 2) {
    expect(fields[index].h).toBe(fields[index + 1].h);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('profile form collapses to a single readable column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await open(page);
  const grid = page.locator('.pf-grid');
  const columns = await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(columns.trim().split(/\s+/)).toHaveLength(1);
  await expect(page.locator('.pf-preference [name="notificationEmail"]')).toBeVisible();
  const identity = await page.locator('.pf-identity').first().evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(identity.trim().split(/\s+/)).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
