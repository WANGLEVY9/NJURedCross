import { test, expect } from '@playwright/test';

const account = {
  accountId: 'synthetic-organizer', role: 'member', realName: '合成同学', studentId: '999990001',
  email: '999990001@smail.nju.edu.cn', emailVerified: true, campus: '鼓楼', department: '合成院系',
  qq: '123456789', wechat: 'synthetic_wechat', gender: '女', phone: '13800000000', grade: '历史年级',
  certificate: '', notificationEmail: '',
};

test('member centre offers a delivery mailbox, validates it and saves only the change', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  const writes = [];
  await page.route('**/api/auth/account', route => {
    if (route.request().method() === 'PATCH') writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, account, profileMapping: { state: '已同步', options: {}, readonly: { firstAid: '是，CPR+AED/红十字救护证' } } } });
  });
  await page.goto('/me?view=profile');
  const field = page.locator('[name="notificationEmail"]');
  await expect(field).toBeVisible();
  await expect(page.locator('.profile-fields')).toContainText('收信邮箱');
  await field.fill('not-an-email');
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  expect(writes).toHaveLength(0);
  await field.fill('me@qq.com');
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ notificationEmail: 'me@qq.com' });
});

test('registration collects an optional delivery mailbox and rejects a malformed one locally', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  await page.route('**/api/auth/registration-config', route => route.fulfill({
    json: { ok: true, enabled: true, minimumPasswordLength: 8, emailDomains: ['smail.nju.edu.cn', 'nju.edu.cn'], message: '' },
  }));
  const posts = [];
  await page.route('**/api/auth/register', route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, email: '230000001@smail.nju.edu.cn', deliveryStatus: 'sent', expiresInSeconds: 600, message: 'ok' } });
  });
  await page.goto('/register');
  await page.locator('[name="studentId"]').fill('230000001');
  await page.locator('[name="realName"]').fill('合成同学');
  await page.locator('[name="password"]').fill('Password123!');
  await page.locator('[name="confirmPassword"]').fill('Password123!');
  const field = page.locator('[name="notificationEmail"]');
  await expect(field).toBeVisible();
  await field.fill('not-an-email');
  await page.getByRole('button', { name: '注册并获取验证码' }).click();
  expect(posts).toHaveLength(0);
  await field.fill('me@qq.com');
  await page.getByRole('button', { name: '注册并获取验证码' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].notificationEmail).toBe('me@qq.com');
});
