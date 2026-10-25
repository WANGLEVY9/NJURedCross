import { test, expect } from '@playwright/test';

const plazas = [['/outreach', '宣传广场'], ['/community', '内建广场']];
const member = { username: 'synthetic-registered-member', consoleAccess: false, permissions: [], role: 'member', label: '合成普通用户' };
async function ordinarySession(page) {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { ok: true, authenticated: true, csrfToken: 'synthetic', user: member } }));
}

for (const [path, name] of plazas) {
  test(`guest sees ${name} preparation page and must log in first`, async ({ page }) => {
    await page.request.post('/api/auth/logout');
    await page.goto(path);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('请先登录后，再申请查看权限')).toBeVisible();
    await expect(page.getByRole('button', { name: '申请查看权限', exact: true })).toHaveCount(0);
    const login = page.getByRole('link', { name: '登录后申请查看权限' });
    await expect(login).toHaveAttribute('href', `/login?next=${encodeURIComponent(path)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
  test(`ordinary member can submit the ${name} presentation without a business write`, async ({ page }) => {
    await ordinarySession(page);
    const writes = [], featureReads = [];
    page.on('request', request => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()) && !request.url().includes('/telemetry/')) writes.push(request.url());
      if (/\/api\/(public\/warmth|morning|materials|outreach)/.test(request.url())) featureReads.push(request.url());
    });
    await page.goto(path);
    await page.getByRole('button', { name: '申请查看权限', exact: true }).click();
    await expect(page.getByText('申请已提交，请等待管理员审批', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '已提交申请', exact: true })).toBeDisabled();
    await expect(page.locator('.development-gate__status')).toBeFocused();
    expect(writes).toEqual([]);
    expect(featureReads).toEqual([]);
    await page.getByRole('link', { name: '先去活动广场' }).click();
    await expect(page.locator('.events-hero')).toBeVisible();
    const menu = page.getByRole('button', { name: '展开导航', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator('#portal-navigation').getByRole('link', { name, exact: true }).click();
    await expect(page.getByText('申请已提交，请等待管理员审批', { exact: true })).toBeVisible();
  });
}

test('member deep links use the same development gate without importing feature pages', async ({ page }) => {
  await ordinarySession(page);
  for (const path of ['/submit', '/photos', '/tasks', '/showcase', '/warmth', '/morning/plaza/synthetic']) {
    await page.goto(path);
    await expect(page.locator('.development-gate')).toBeVisible();
  }
});

test('guests can open the materials hub while isolated services remain hidden', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  const writes = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()) && !request.url().includes('/telemetry/')) writes.push(request.url());
  });
  await page.goto('/materials');
  await expect(page.getByRole('heading', { name: '每一件物资，都服务一场公益' })).toBeVisible();
  await expect(page.locator('.development-gate')).toHaveCount(0);
  await expect(page.locator('.square-card[href="/materials/borrow"]')).toBeVisible();
  await expect(page.locator('.square-card[href="/materials/reimburse"]')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('administrator can still open the developing feature pages', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  for (const [path] of plazas) {
    await page.goto(path);
    await expect(page.locator('#main h1').first()).toBeVisible();
    await expect(page.locator('.development-gate')).toHaveCount(0);
  }
});
