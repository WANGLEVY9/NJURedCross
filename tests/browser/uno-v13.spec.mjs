import { test, expect } from '@playwright/test';

// 手机竖屏时只渲染「横屏游玩」引导，牌桌与顶栏控件都不在 DOM 里；
// 移动端分片统一切到横屏视口，与真实游玩姿态一致。
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) {
    await page.setViewportSize({ width: 915, height: 412 });
  }
});

test('UNO practice exposes sorting, sound and simplified rules', async ({ page }) => {
  await page.goto('/games/uno');
  await expect(page.getByRole('heading', { name: '南小红UNO' })).toBeVisible();
  await expect(page.getByRole('group', { name: '手牌排序' })).toBeVisible();
  await page.getByRole('button', { name: '按色' }).click();
  await expect(page.getByRole('button', { name: '按色' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'BGM · 关' })).toBeVisible();
  await expect(page.getByRole('button', { name: /语音播报/ })).toBeVisible();
  await page.getByRole('button', { name: '玩法说明' }).click();
  const rules = page.getByRole('dialog', { name: '玩法说明' });
  await expect(rules).toBeVisible();
  await expect(rules.getByText(/质疑 \+4/).first()).toBeVisible();
});

test('long press previews a card without playing it', async ({ page }) => {
  await page.goto('/games/uno');
  const cards = page.locator('.uno-hand__cards .uno-card--button');
  const first = cards.first();
  await expect(first).toBeVisible();
  const count = await cards.count();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.uno-zoom.is-show')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.uno-zoom.is-show')).toHaveCount(0);
  await expect(cards).toHaveCount(count);
});
