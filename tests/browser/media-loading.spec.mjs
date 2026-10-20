import { test, expect } from '@playwright/test';

const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="342"><rect width="900" height="342" fill="#eeddd0"/></svg>';

test('activity carousel retains its decoded photograph during a slow or failed switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/volunteers/optimized/**', async route => {
    if (route.request().url().includes('/activity-2-')) await gate;
    if (route.request().url().includes('/activity-3-')) return route.abort();
    return route.fulfill({ contentType: 'image/svg+xml', body: picture });
  });
  await page.route('**/assets/events-carousel/activity-03.webp', route => route.abort());
  try {
    await page.goto('/events');
    const art = page.locator('.events-hero__art');
    await expect.poll(() => art.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const first = await art.locator('img').getAttribute('src');
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(art).toHaveAttribute('aria-busy', 'true');
    await expect(art.locator('img')).toHaveAttribute('src', first);
    release();
    await expect(art.locator('img')).toHaveAttribute('alt', '红十字会成员手持会旗与项目奖牌合影');
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(art).not.toHaveAttribute('aria-busy', 'true');
    await expect(art.locator('img')).toHaveAttribute('alt', '红十字会成员手持会旗与项目奖牌合影');
    await expect(page.getByRole('status').filter({ hasText: '这张影像暂未加载' })).toBeAttached();
  } finally { release(); }
});

test('homepage uses same-origin responsive media and prioritizes its first photograph', async ({ page }) => {
  const external = [];
  page.on('request', request => { if (request.url().includes('mmbiz.qpic.cn')) external.push(request.url()); });
  await page.route('**/assets/volunteers/optimized/**', route => route.fulfill({ contentType: 'image/svg+xml', body: picture }));
  await page.goto('/');
  const hero = page.locator('.home-banner__stage img');
  await expect.poll(() => hero.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(hero).toHaveAttribute('loading', 'eager');
  await expect(hero).toHaveAttribute('fetchpriority', 'high');
  await expect(hero).toHaveAttribute('srcset', /480w/);
  expect(await hero.evaluate(image => new URL(image.currentSrc).origin === location.origin)).toBe(true);
  await expect(page.locator('.home-volunteers__photos img').first()).toHaveAttribute('loading', 'lazy');
  expect(external).toEqual([]);
});

test('homepage keeps its current image and article link when a replacement fails', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/volunteers/optimized/**', async route => {
    if (route.request().url().includes('/cover-2-')) { await gate; return route.abort(); }
    return route.fulfill({ contentType: 'image/svg+xml', body: picture });
  });
  await page.route('https://mmbiz.qpic.cn/**', route => route.abort());
  try {
    await page.goto('/');
    const stage = page.locator('.home-banner__stage');
    await expect.poll(() => stage.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const source = await stage.locator('img').getAttribute('src');
    const link = await stage.locator('a').getAttribute('href');
    await page.getByRole('button', { name: '下一张图片' }).click();
    await expect(stage).toHaveAttribute('aria-busy', 'true');
    await expect(stage.locator('img')).toHaveAttribute('src', source);
    release();
    await expect(stage).not.toHaveAttribute('aria-busy', 'true');
    await expect(stage.locator('img')).toHaveAttribute('src', source);
    await expect(stage.locator('a')).toHaveAttribute('href', link);
  } finally { release(); }
});
