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

test('photo wall shows the console photographs at their own ratio and opens a lightbox', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  // 总览页不再插主视觉，照片集中在独立模块。
  await page.goto('/console/overview');
  await expect(page.locator('.overview-hero')).toHaveCount(0);
  await page.goto('/console/gallery');
  const cards = page.locator('.gallery-card');
  await expect(cards.first()).toBeVisible({ timeout: 20000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  const first = cards.first();
  const image = first.locator('img');
  expect(await image.getAttribute('src')).toContain('/assets/volunteers/optimized/');
  // 网格卡片里的影像不能溢出卡片，否则又会退回“整幅照片被放大裁切”的样子。
  const cardBox = await first.boundingBox();
  const imageBox = await image.boundingBox();
  expect(imageBox.width).toBeLessThanOrEqual(cardBox.width + 1);
  expect(imageBox.height).toBeLessThanOrEqual(cardBox.height + 1);
  await first.click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.locator('.lightbox').getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.lightbox')).toHaveCount(0);
  // 活动工作区顶部同样不再有横幅。
  await page.goto('/console/events');
  await expect(page.locator('.workspace-hero')).toHaveCount(0);
});
