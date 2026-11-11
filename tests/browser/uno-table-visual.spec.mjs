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

test('new round has a bounded deal animation and respects reduced motion', async ({ page }) => {
  await page.goto('/games/uno');
  await page.getByRole('button', { name: '开新一局' }).click();
  await expect(page.locator('.uno-flight')).not.toHaveCount(0);
  await expect(page.locator('.uno-flight')).toHaveCount(0, { timeout: 3000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '开新一局' }).click();
  await expect(page.locator('.uno-flight')).toHaveCount(0);
});

test('playing a card animates towards the discard pile', async ({ page }) => {
  await page.goto('/games/uno');
  const playable = page.locator('.uno-hand__cards .uno-card.is-playable:not(.uno-card--wild):not(.uno-card--wild4)');
  for (let i = 0; i < 8 && await playable.count() === 0; i += 1) await page.getByRole('button', { name: '开新一局' }).click();
  await expect(playable.first()).toBeVisible();
  await expect(page.locator('.uno-flight')).toHaveCount(0, { timeout: 3000 });
  await playable.first().click();
  await expect(page.locator('.uno-flight')).not.toHaveCount(0);
});

test('drawing produces a temporary card flight', async ({ page }) => {
  await page.goto('/games/uno');
  await expect(page.locator('.uno-flight')).toHaveCount(0, { timeout: 3000 });
  await page.getByRole('button', { name: '摸一张牌' }).click();
  await expect(page.locator('.uno-flight')).not.toHaveCount(0);
});
