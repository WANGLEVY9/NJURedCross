/** Read-only browser QA against the isolated preview server. */
/* global document, innerWidth */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge' });
try {
  await mkdir('reports', { recursive: true });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3137/design/events-plaza.html');
    await page.locator('.event-row').first().waitFor();
    assert.equal(await page.locator('.event-row').count(), 6);
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    assert.equal(await page.locator('h1').textContent(), '让关怀，成为日常');
    await page.getByRole('button', { name: '暂停轮播' }).click();
    await page.getByRole('button', { name: '生命中心 守护生命健康' }).click();
    assert.equal(await page.locator('.event-row').count(), 1);
    await page.getByRole('button', { name: '生命中心 守护生命健康' }).click();
    assert.equal(await page.locator('.event-row').count(), 6);
    await page.getByRole('searchbox').fill('不存在的活动');
    assert.equal(await page.locator('.event-row').count(), 0);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('button', { name: '切换到第 1 张' }).click();
    await page.getByRole('searchbox').blur();
    assert.ok(await page.locator('.event-row').first().evaluate(row => row.getBoundingClientRect().height < 350));
    if (width > 640) assert.ok(await page.locator('.event-row').nth(1).evaluate(row => row.getBoundingClientRect().x > innerWidth / 2));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `reports/events-plaza-${width}.png`, fullPage: true });
    console.log(`PASS ${width}px: carousel, category filters, search, overflow, runtime errors`);
    await page.close();
  }
  const live = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const liveErrors = [];
  live.on('pageerror', error => liveErrors.push(error.message));
  await live.goto('http://127.0.0.1:3138/events');
  await live.locator('.events-hero').waitFor();
  await live.locator('.event-row').first().waitFor();
  assert.equal(await live.locator('.events-category').count(), 6);
  assert.equal(await live.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(liveErrors, []);
  await live.screenshot({ path: 'reports/events-plaza-integrated.png', fullPage: true });
  await live.close();
  console.log('PASS integrated /events against synthetic workflow server');
} finally { await browser.close(); }
