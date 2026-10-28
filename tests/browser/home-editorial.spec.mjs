import {test,expect} from '@playwright/test';

test('article banner preserves geometry, keyboard focus and text when photographs fail',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');
 await page.emulateMedia({reducedMotion:'reduce'});await page.route('https://mmbiz.qpic.cn/**',r=>r.abort());await page.route('**/assets/volunteers/optimized/**',r=>r.abort());await page.goto('/');
 for(const width of [1280,1440,1920,2048]){
  await page.setViewportSize({width,height:1080});
  const stage=page.locator('.home-banner');const initial=await stage.boundingBox();
  for(const dot of await page.locator('.home-banner__dots button').all()){
   await dot.click();const box=await stage.boundingBox();
   expect(Math.abs(box.height-initial.height)).toBeLessThan(1);expect(Math.abs(box.x-initial.x)).toBeLessThan(1);
   await expect(dot).toBeFocused();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await expect(page.locator('.home-banner__stage .home-photo__empty')).toBeVisible();
 await expect(page.getByRole('heading',{name:'让善意，乘风而行',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'志愿者风采',exact:true})).toBeVisible();
 await expect(page.locator('.home-banner__stage a')).toHaveAttribute('href',/^https:\/\/mp\.weixin\.qq\.com\/s\//);
 await page.screenshot({path:info.outputPath('without-photographs.png'),fullPage:true});
});
