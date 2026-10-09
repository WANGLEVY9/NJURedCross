import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.request.post('/api/auth/logout'); });

// The server is an in-memory fixture. No production tokens, SMTP or database writes.
for (const path of ['/', '/events', '/materials', '/outreach', '/community', '/about', '/login', '/console/login']) {
  test(`page boots and fits viewport: ${path}`, async ({ page }) => {
    const errors = [];
    const brokenAssets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (/\/(app|styles|assets)\//.test(response.url()) && response.status() >= 400) brokenAssets.push(response.url());
    });
    await page.goto(path);
    await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(brokenAssets).toEqual([]);
  });
}

test('anonymous member and administrator routes redirect to the correct sign-in', async ({ page }) => {
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/console/workflow');
  await expect(page).toHaveURL(/\/console\/login\?next=/);
});

test('blood calendar renders synthetic slots and supports week navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.getByRole('heading', { name: '献血车报名日历' })).toBeVisible();
  await expect(page.getByRole('button', { name: /2026-10-12 新街口中央/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /下周/ }).click();
  await expect(page.getByText(/2026\/10\/19/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

async function adminSignIn(page, username='synthetic-reviewer') {
  await page.request.post('/api/auth/login',{data:{username}});
}

test('seven management sections, centre tabs and legacy routes work', async ({page},testInfo) => {
  await adminSignIn(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/console/admin');
  await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
  if(testInfo.project.name.startsWith('mobile'))await page.getByRole('button',{name:'全部模块',exact:true}).click();
  const nav=page.locator('#console-navigation');
  for(const name of ['总览','管理员中心','活动管理','宣传管理','内建管理','物资管理','红会语录墙'])await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
  if(testInfo.project.name.startsWith('mobile'))await nav.getByRole('button',{name:'关闭导航',exact:true}).click();
  await page.getByRole('tab',{name:'工作区偏好',exact:true}).click();
  await expect(page.getByRole('heading',{name:'信息密度与导航'})).toBeVisible();
  await page.goto('/console/settings');
  await expect(page).toHaveURL(/\/console\/admin\?view=status/);
  await expect(page.getByRole('tab',{name:'系统状态',exact:true})).toHaveAttribute('aria-selected','true');
  expect(errors).toEqual([]);
});

test('limited administrator keeps personal centre but cannot enter quote management',async({page})=>{
  await adminSignIn(page,'synthetic-events-only');
  await page.goto('/console/admin');
  await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'系统状态',exact:true})).toHaveCount(0);
  await page.goto('/console/quotes');
  await expect(page).toHaveURL(/\/console\/overview\?forbidden=community/);
  const denied=await page.request.get('/api/community/quotes');expect(denied.status()).toBe(403);
});

test('quote wall supports drafting, publishing and offline retention',async({page},testInfo)=>{
  const content=`合成浏览器测试语录 ${testInfo.project.name}`;
  await adminSignIn(page);
  await page.goto('/console/quotes');
  await expect(page.getByRole('heading',{name:'红会语录墙',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新增语录',exact:true}).click();
  await page.getByLabel(/^语录内容/).fill(content);
  await page.getByLabel(/^署名/).fill('合成审核人');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  const item=page.locator('.quote-wall__item').filter({hasText:content});
  await expect(item).toBeVisible();
  await item.getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('tab',{name:'已发布',exact:true}).click();
  await expect(item).toBeVisible();
  await item.getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('tab',{name:'已下架',exact:true}).click();
  await expect(item).toBeVisible();
});
