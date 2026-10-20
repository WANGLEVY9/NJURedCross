import { test, expect } from '@playwright/test';

test('desktop header preserves route hierarchy, scroll state and overlay focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  await page.request.post('/api/auth/logout');
  for (const width of [1280, 1440, 1920, 2048]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: '主页', exact: true })).toHaveAttribute('aria-current', 'page');
    const boxes = await page.locator('.phead__inner > :not(.spacer)').evaluateAll(els => els.filter(el => getComputedStyle(el).display !== 'none').map(el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right}; }));
    for (let i=1;i<boxes.length;i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i-1].right - 1);
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(page.locator('.phead')).toHaveAttribute('data-stuck', 'true');
    await expect(page.locator('.phead')).toHaveCSS('backdrop-filter', 'none');
    await nav.getByRole('link', { name: '活动广场', exact: true }).click();
    await expect(page.locator('.event-browser--aligned')).toBeVisible();
    await expect(nav.getByRole('link', { name: '活动广场', exact: true })).toHaveAttribute('aria-current', 'page');
    const marker = await nav.getByRole('link', { name: '活动广场', exact: true }).evaluate(el => getComputedStyle(el, '::after').display);
    expect(marker).not.toBe('none');
  }
  const theme = page.getByRole('button', {name:'外观主题', exact:true});
  await theme.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(theme).toBeFocused();
  await page.reload();
  await expect(page.locator('.pnav__link[aria-current="page"]')).toHaveAttribute('href','/events');
});

test('home artwork stays available on API failure with reduced motion and working actions', async ({ page }) => {
  await page.route('**/api/public/events**', r => r.fulfill({status:503,json:{error:'合成服务暂不可用'}}));
  await page.route('**/api/public/overview', r => r.fulfill({status:503,json:{error:'合成服务暂不可用'}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.locator('.home-banner__stage .home-photo')).toBeVisible();
  await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.home-impact__item b')).toHaveText(['—','—','—','—']);
  await expect(page.getByRole('heading',{name:'让善意，乘风而行',exact:true})).toBeVisible();
  if(await page.getByRole('button',{name:'展开导航',exact:true}).isVisible())await page.getByRole('button',{name:'展开导航',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'会员中心',exact:true}).click();
  await expect(page).toHaveURL(/\/(me|login)/);
});
