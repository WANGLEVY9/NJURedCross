import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('community editorial desktop viewports', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  await page.request.post('/api/auth/logout');
  await page.route('**/api/public/warmth/capabilities', route => route.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width,height] of [[1280,800],[1440,900],[1920,1080],[2048,980]]) {
    await page.setViewportSize({width,height});
    await page.goto('/community');
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if(process.env.COMMUNITY_CAPTURE) {
      await mkdir(process.env.COMMUNITY_CAPTURE,{recursive:true});
      await page.screenshot({path:`${process.env.COMMUNITY_CAPTURE}/${width}.png`,fullPage:true});
    }
  }
});

async function communityFixture(page, { memberError = false, lettersError = false } = {}) {
  await page.request.post('/api/auth/login', {data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities', r => r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.route('**/api/portal/me', r => r.fulfill(memberError ? {status:503,json:{message:'synthetic unavailable'}} : {json:{enrollments:[{program:'birthday',status:'已确认'}]}}));
  await page.route('**/api/morning/card', r => r.fulfill({json:{profile:{missing:[]},card:{status:'待审核'}}}));
  await page.route('**/api/public/warmth/blessings/mine', r => r.fulfill(lettersError ? {status:503,json:{message:'synthetic unavailable'}} : {json:{blessings:[],stats:{limit:3}}}));
  await page.route('**/api/public/warmth/blessings/delivered', r => r.fulfill({json:{blessings:[]}}));
}
test('community member sees eligible actions and private panels', async ({page}) => {
  await communityFixture(page);
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/community');
  await expect(page.getByRole('button',{name:'写生日祝福',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'加入生日祝福',exact:true})).toHaveCount(0);
  await expect(page.getByText('待审核',{exact:true})).toBeVisible();
  await expect(page.locator('#community-warmth-delivered')).toBeVisible();
  await page.getByText('了解祝福投递规则',{exact:true}).click();
  await expect(page.getByText(/生日当天会按已审核的投稿数量匹配祝福/)).toBeVisible();
  await page.getByRole('button',{name:'写生日祝福',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
test('community failed state is not shown as nonmembership',async({page})=>{
  await communityFixture(page,{memberError:true});
  await page.goto('/community');
  await expect(page.getByText('参与状态暂未读取')).toBeVisible();
  await expect(page.getByText('尚未加入',{exact:true})).toHaveCount(0);
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
});
test('community missing letters do not look like an empty inbox',async({page})=>{
  await communityFixture(page,{lettersError:true});
  await page.goto('/community');
  await expect(page.getByText('祝福记录暂未完整读取，请重试后查看。')).toBeVisible();
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'写生日祝福',exact:true})).toHaveCount(0);
});
test('community guest privacy disclosure and login entry',async({page})=>{
  await page.request.post('/api/auth/logout');
  await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.goto('/community');
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
  const disclosure=page.locator('.community-program--birthday summary');
  await disclosure.click();
  await expect(page.getByText('不把你的邮箱交给投稿人',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'加入生日祝福',exact:true}).click();
  await expect(page).toHaveURL(/\/login/);
});
test('community themes, reduced motion and return navigation remain scoped',async({page})=>{
  await page.request.post('/api/auth/logout');
  await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/community');
  await expect(page.locator('#ambient')).toBeHidden();
  for(const theme of ['dawn','sail','garden','iris','amber']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    const expected=await page.evaluate(()=>{const e=document.createElement('i');e.style.color='var(--canvas-raised)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;});
    await expect(page.locator('.community-program--morning')).toHaveCSS('color',expected);
    await expect(page.locator('.community-art').first()).toHaveCSS('transition-duration','0s');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  }
  await page.goto('/events');
  await expect(page.locator('#ambient')).toBeHidden();
});
