/** Read-only browser QA against the isolated preview server. */
/* global document, innerWidth, window, getComputedStyle */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge' });
const previewUrl = process.env.PLAZA_PREVIEW_URL || 'http://127.0.0.1:3137';
const workflowUrl = process.env.PLAZA_WORKFLOW_URL || 'http://127.0.0.1:3138';
try {
  await mkdir('reports', { recursive: true });
  for (const width of [1280, 1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${previewUrl}/design/events-plaza.html`);
    await page.locator('.event-row').first().waitFor();
    assert.equal(await page.locator('.event-row').count(), 6);
    await page.getByRole('combobox',{name:'排序方式'}).click();
    await page.getByRole('option',{name:'时间由远到近',exact:true}).click();
    assert.equal(await page.locator('.event-row h3').first().textContent(),'献血车志愿服务');
    await page.getByRole('combobox',{name:'排序方式'}).click();
    await page.getByRole('option',{name:'按活动时间',exact:true}).click();
    await page.getByRole('combobox',{name:'按校区筛选'}).click();
    assert.equal(await page.locator('.events-results-controls .select-menu__popup:popover-open').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('option',{name:'仙林校区',exact:true}).click();
    assert.equal(await page.locator('.event-row').count(),3);
    await page.getByRole('combobox',{name:'按校区筛选'}).click();
    await page.getByRole('option',{name:'按校区筛选',exact:true}).click();
    assert.equal(await page.locator('.event-row').count(),6);
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    assert.equal(await page.locator('h1').textContent(), '把善意，化作行动');
    assert.equal(await page.locator('.events-hero__motto').textContent(),'人道 · 博爱 · 奉献');
    assert.equal(await page.getByRole('button',{name:'切换到第 2 张'}).getAttribute('aria-current'),'true');
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
  await live.goto(`${workflowUrl}/events`);
  await live.locator('.events-hero').waitFor();
  await live.locator('.event-row').first().waitFor();
  await live.getByRole('combobox',{name:'按校区筛选'}).click();
  await live.getByRole('option',{name:'仙林',exact:true}).click();
  assert.equal(await live.evaluate(()=>new URL(globalThis.location.href).searchParams.get('campus')),'仙林');
  await live.getByRole('combobox',{name:'按校区筛选'}).click();
  await live.getByRole('option',{name:'按校区筛选',exact:true}).click();
  await live.getByRole('combobox',{name:'活动状态'}).click();
  await live.getByRole('option',{name:'已结束',exact:true}).click();
  assert.ok((await live.locator('.event-row').count())>0);
  await live.getByRole('combobox',{name:'活动状态'}).click();
  await live.getByRole('option',{name:'全部状态',exact:true}).click();
  assert.equal(await live.locator('.events-category').count(), 6);
  assert.equal(await live.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(liveErrors, []);
  await live.screenshot({ path: 'reports/events-plaza-integrated.png', fullPage: true });
  for (const width of [1024,390]) {
    await live.setViewportSize({width,height:1000});
    await live.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await live.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    await live.screenshot({path:`reports/events-plaza-integrated-${width}.png`,fullPage:true});
  }
  await live.setViewportSize({width:1280,height:1000});
  await live.locator('.phead .plogo').click();
  await live.locator('.home-page').waitFor();
  await live.locator('.events-page').waitFor({state:'detached'});
  assert.equal(await live.evaluate(()=>document.documentElement.hasAttribute('data-events-typography')),false);
  assert.ok(!await live.locator('.home-page h1').evaluate(element=>getComputedStyle(element).fontFamily.includes('Plaza')));
  await live.close();
  console.log('PASS integrated /events against synthetic workflow server');
} finally { await browser.close(); }
