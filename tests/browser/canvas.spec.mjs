import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const routes=[['home','/'],['events','/events'],['calendar','/workflow-events?type=blood&week=2026-10-12'],['community','/community'],['outreach','/outreach']];
test('route canvas desktop compositions',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');
 await page.request.post('/api/auth/logout');
 await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [1280,1440,1920,2048])for(const[name,url]of routes){
  await page.setViewportSize({width,height:980});await page.goto(url);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(process.env.CANVAS_CAPTURE){await mkdir(process.env.CANVAS_CAPTURE,{recursive:true});await page.screenshot({path:`${process.env.CANVAS_CAPTURE}/${name}-${width}.png`,fullPage:true});}
 }
});
test('route canvases reset across navigation, themes and contrast preferences',async({page})=>{
 await page.request.post('/api/auth/logout');
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.goto('/events');
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await expect(page.locator('#ambient')).toBeHidden();
  const accent=await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent'));
  await expect(page.locator('.discovery-intro')).toBeVisible();
  await page.locator('.phead .plogo').click();
  await expect(page.locator('.home-page')).toBeVisible();
  expect(await page.locator('.discovery-hero').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('gradient');
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent'))).toBe(accent);
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.locator('.blood-calendar')).toBeVisible();
  expect(await page.locator('.portal').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 }
 await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});
 await expect(page.locator('#ambient')).toBeHidden();
 await page.goto('/');
 await expect(page.locator('.discovery-hero__cross')).toBeHidden();
 expect(await page.locator('.portal').evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
});
