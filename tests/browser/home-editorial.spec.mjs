import {test,expect} from '@playwright/test';
test('paper stage and topics preserve geometry, focus and SVG-free reading',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 for(const width of [1280,1440,1920,2048]){
  await page.setViewportSize({width,height:1080});
  const stage=page.locator('.hero-showcase');const start=await stage.boundingBox();
  for(const button of await page.locator('.showcase__dot').all()){
   await button.click();const box=await stage.boundingBox();
   expect(Math.abs(box.height-start.height)).toBeLessThan(1);
   expect(Math.abs(box.x-start.x)).toBeLessThan(1);
   await expect(button).toBeFocused();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.locator('.home-trust').scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect(page.getByRole('link',{name:'浏览开放活动',exact:true})).toBeInViewport();
 const original=await page.locator('.square-grid--home').boundingBox();
 await page.evaluate(()=>document.querySelectorAll('.home-page svg').forEach(n=>n.style.visibility='hidden'));
 const hidden=await page.locator('.square-grid--home').boundingBox();expect(hidden).toEqual(original);
 await expect(page.getByRole('heading',{name:'安心参与，清楚了解每一步'})).toBeVisible();
 await page.screenshot({path:info.outputPath('without-illustrations.png'),fullPage:true});
 await page.emulateMedia({forcedColors:'active'});await expect(page.locator('.home-paper')).toBeHidden();
});
