import { test, expect } from '@playwright/test';

test('cards keep their proportions and the hand remains visible', async ({ page }) => {
  await page.goto('/games/uno');
  const deck = page.locator('.uno-pile--draw .uno-pile__img');
  const hand = page.locator('.uno-hand__cards .uno-card').first();
  await expect(deck).toBeVisible();
  await expect(hand).toBeVisible();
  const d = await deck.boundingBox(), h = await hand.boundingBox();
  expect(d.height / d.width).toBeGreaterThan(1.45);
  expect(d.height / d.width).toBeLessThan(1.6);
  expect(h.height / h.width).toBeGreaterThan(1.45);
  expect(h.height / h.width).toBeLessThan(1.6);
  const felt = await page.locator('.uno-board__felt').boundingBox();
  expect(h.y + h.height).toBeLessThanOrEqual(felt.y + felt.height + 1);
  expect(d.y + d.height).toBeLessThanOrEqual(felt.y + felt.height + 1);
});

/**
 * 第十三版起，飞牌动画由 motion.js 的 DOM 投射改成纯 CSS：
 * 弃牌堆顶牌变化时挂 `.is-dealt`，由 `@keyframes uno-flip` 播放。
 * 这里改为断言「契约仍在」——动画定义与降级规则不被误删——而不是抓瞬时节点。
 */
test('deal animation is CSS-driven and degrades under reduced motion', async ({ page, request }) => {
  const css = await (await request.get('/styles/uno.css')).text();
  expect(css).toContain('@keyframes uno-flip');
  expect(css).toContain('.uno-pile--discard .uno-card.is-dealt');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games/uno');
  await expect(page.getByRole('button', { name: '开新一局' })).toBeVisible();
  await page.getByRole('button', { name: '开新一局' }).click();
  await expect(page.locator('.uno-pile--discard .uno-card').first()).toBeVisible();
  await expect(page.locator('.uno-hand__cards .uno-card').first()).toBeVisible();
});

test('playing a card lands on the discard pile', async ({ page }) => {
  await page.goto('/games/uno');
  const playable = page.locator('.uno-hand__cards .uno-card.is-playable:not(.uno-card--wild):not(.uno-card--wild4)');
  for (let i = 0; i < 8 && await playable.count() === 0; i += 1) await page.getByRole('button', { name: '开新一局' }).click();
  await expect(playable.first()).toBeVisible();
  const before = await page.locator('.uno-pile--discard .uno-card').first().getAttribute('alt');
  await playable.first().click();
  await expect(page.locator('.uno-pile--discard .uno-card').first()).not.toHaveAttribute('alt', before ?? '');
});

test('drawing adds a card to the hand', async ({ page }) => {
  await page.goto('/games/uno');
  const hand = page.locator('.uno-hand__cards .uno-card');
  const before = await hand.count();
  await page.getByRole('button', { name: '摸一张牌' }).click();
  await expect.poll(() => hand.count()).toBeGreaterThan(before);
});
