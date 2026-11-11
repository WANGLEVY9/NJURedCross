import { test, expect } from '@playwright/test';

async function openCenter(page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/volunteer/workflow/management-tools');
  await page.goto('/console/admin');
  const result = await response;
  expect(result.ok()).toBe(true);
  const { capabilities } = await result.json();
  const actions = ['邮件模板与参与说明', '活动权限与负责人配置', '历史活动审核人配置', '人员资料核对', '时长入账与同步', '历史活动', '数据维护', '系统状态', '操作日志'];
  if (capabilities.enableRegistry) actions.push('启用长期登记项目','省红会组宣部值班');
  if (capabilities.bloodSchedule) actions.push('献血车排班');
  // Wait for the asynchronous permission projection and verify each entry, not just its count.
  for (const title of actions) await expect(page.locator(`.admin-action[aria-label="${title}"]`)).toHaveCount(1);
  await expect(page.locator('.admin-action')).toHaveCount(actions.length);
  for (const [key, title] of [['enableRegistry', '启用长期登记项目'], ['bloodSchedule', '献血车排班']]) {
    if (!capabilities[key]) await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  }
}

test('admin centre presents a two-column workspace with grouped action rows', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await openCenter(page);
  await expect(page.locator('.admin-center')).toBeVisible();
  await expect(page.locator('.admin-card--profile')).toContainText('当前账号');
  await expect(page.locator('.admin-card__title')).toContainText(['当前账号', '通知与内容', '权限与人员', '数据与历史', '会话与权限', '快捷入口']);
  // 操作行的可访问名称只取标题，描述不并入名称。
  await expect(page.getByRole('button', { name: '邮件模板与参与说明', exact: true })).toBeVisible();
  // 快捷入口切换到系统状态视图，离开账号布局。
  await page.getByRole('button', { name: '系统状态', exact: true }).click();
  await expect(page.locator('.admin-center')).toHaveCount(0);
});

test('admin centre stacks into one column on mobile without overflow', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await openCenter(page);
  await expect(page.locator('.admin-center')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
