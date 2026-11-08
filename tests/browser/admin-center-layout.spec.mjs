import { test, expect } from '@playwright/test';

test('admin centre presents a two-column workspace with grouped action rows', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.goto('/console/admin');
  await expect(page.locator('.admin-center')).toBeVisible();
  await expect(page.locator('.admin-card--profile')).toContainText('当前账号');
  await expect(page.locator('.admin-card__title')).toContainText(['当前账号', '通知与内容', '权限与人员', '数据与历史', '会话与权限', '快捷入口']);
  await expect(page.locator('.admin-action')).toHaveCount(9);
  // 操作行的可访问名称只取标题，描述不并入名称。
  await expect(page.getByRole('button', { name: '邮件模板与参与说明', exact: true })).toBeVisible();
  // 快捷入口切换到系统状态视图，离开账号布局。
  await page.getByRole('button', { name: '系统状态', exact: true }).click();
  await expect(page.locator('.admin-center')).toHaveCount(0);
});

test('admin centre stacks into one column on mobile without overflow', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.goto('/console/admin');
  await expect(page.locator('.admin-center')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
