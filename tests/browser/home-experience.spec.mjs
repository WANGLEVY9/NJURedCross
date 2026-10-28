import { test, expect } from '@playwright/test';
test.use({ reducedMotion: 'reduce' });

test('carousel changes image and opens the corresponding supplied article', async ({ page }) => {
  await page.route('**/assets/volunteers/optimized/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="342"><rect width="900" height="342" fill="#eed"/></svg>' }));
  await page.goto('/');
  const banner = page.locator('.home-banner');
  await expect(banner.locator('.home-banner__stage a')).toHaveAttribute('href', 'https://mp.weixin.qq.com/s/c5LPrlYEmRNtbpblDvED7w');
  await banner.getByRole('button', { name: '下一张图片' }).click();
  await expect(banner.locator('.home-banner__stage a')).toHaveAttribute('href', 'https://mp.weixin.qq.com/s/skdvg_VPFqt2D0GaoCoFzQ');
  await banner.getByRole('button', { name: '下一张图片' }).click();
  await expect(banner.locator('.home-banner__stage a')).toHaveAttribute('href', 'https://mp.weixin.qq.com/s/WZ5kcdhNIJnHe1kSSeFB6A');
  await expect(banner.locator('.home-banner__stage a')).toHaveAttribute('rel', 'noopener noreferrer');
  await banner.getByRole('button', { name: '暂停轮播' }).click();
  await expect(banner.getByRole('button', { name: '播放轮播' })).toBeVisible();
});

test('homepage content keeps the shared shell and exposes crane messages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-redesign')).toBeVisible();
  await expect(page.getByRole('heading', { name: '让善意，乘风而行' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '志愿者风采' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '红会足迹' })).toBeVisible();
  await expect(page.locator('.home-impact__item')).toHaveCount(4);
  await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy', 'false');
  const crane = page.getByRole('button', { name: '展开合成纸鹤的寄语', exact: true });
  await expect(crane).toBeVisible();
  await crane.click();
  await expect(crane.locator('..').locator('.home-crane__note')).toBeVisible();
  await expect(crane.locator('..').locator('.home-crane__note')).toContainText('合成测试寄语');
  await page.keyboard.press('Escape');
  await expect(crane).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('crane submission requires login and stays hidden until it is approved', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  await page.goto('/');
  await page.getByRole('button', { name: '写下寄语', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-member', password: 'synthetic' } });
  await page.goto('/');
  await page.getByRole('button', { name: '写下寄语', exact: true }).click();
  await page.getByLabel('你的寄语').fill('合成测试：愿善意继续飞。');
  await page.getByLabel('署名（选填）').fill('合成小纸鹤');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '折成纸鹤，送出善意' }).click();
  await expect(page.getByRole('heading', { name: '寄语已提交' })).toBeVisible();
  await expect(page.getByText('您的寄言已提交，正在审核中，审核通过后将在主页进行展示。')).toBeVisible();
  const messages = await (await page.request.get('/api/public/cranes')).json();
  expect(messages.items.some(item => item.author === '合成小纸鹤')).toBe(false);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.home-crane__note').first()).not.toContainText('合成测试：愿善意继续飞。');
  const wall = await (await page.request.get('/api/community/messages')).json();
  expect(wall.items.some(item => item.author === '合成小纸鹤')).toBe(false);
  await page.request.post('/api/auth/logout');
});
