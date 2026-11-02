import { test, expect } from '@playwright/test';

// 四个广场共用同一套主视觉组件：结构、轮播控件与可达性一致，只有文案与影像不同。
const PLAZAS = ['/events', '/outreach', '/community', '/materials'];

test('every plaza shares the same hero carousel shell', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.route('**/api/public/warmth/capabilities', route => route.fulfill({ json: { birthday: { enabled: true, ready: true } } }));
  const firstImages = new Set();
  for (const path of PLAZAS) {
    await page.goto(path);
    const hero = page.locator('.plaza-hero');
    await expect(hero).toBeVisible();
    await expect(hero.locator('h1')).toBeVisible();
    await expect(hero.getByRole('button', { name: '下一张', exact: true })).toBeVisible();
    await expect(hero.getByRole('button', { name: '暂停轮播', exact: true })).toBeVisible();
    // 旧版页头不应与新主视觉并存。
    await expect(page.locator('.plaza-intro')).toHaveCount(0);
    const dots = hero.locator('.events-hero__dots button');
    // 各广场影像数量可以不同（活动广场 6 张、其余 3 张），只要求可轮播。
    await expect.poll(() => dots.count()).toBeGreaterThan(1);
    await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
    await hero.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(hero.getByRole('status').filter({ hasText: '第 2 张' })).toBeAttached();
    const alt = await hero.locator('.events-hero__art img').getAttribute('alt');
    expect(alt, path).toBeTruthy();
    firstImages.add(alt);
  }
  // 每个广场首图不同，后续替换各自影像时也不会退回同一套。
  expect(firstImages.size).toBe(PLAZAS.length);
});

test('console overview carries the campus hero instead of a workspace banner', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.goto('/console/overview');
  const hero = page.locator('.overview-hero');
  await expect(hero).toBeVisible({ timeout: 20000 });
  await expect(hero.getByRole('button', { name: '下一张', exact: true })).toBeVisible();
  await expect(hero.getByRole('button', { name: '暂停轮播', exact: true })).toBeVisible();
  // 品牌浮标签明影像归属，避免只有一张无上下文的照片。
  await expect(hero.locator('.overview-hero__tag')).toContainText('南京大学红十字会');
  const src = await hero.locator('.overview-hero__art img').getAttribute('src');
  expect(src).toContain('/assets/volunteers/optimized/console-');
  // 头图已经搬出活动工作区：工作区顶部不再有横幅占位。
  await page.goto('/console/events');
  await expect(page.locator('.workspace-hero')).toHaveCount(0);
  await expect(page.locator('.plaza-hero')).toHaveCount(0);
});
