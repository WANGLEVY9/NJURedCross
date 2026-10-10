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
