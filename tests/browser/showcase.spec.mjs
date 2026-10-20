import {test,expect} from '@playwright/test';
import {HOME_CONTENT} from '../../public/app/portal/home-content.js';
const links=HOME_CONTENT.slides.map(slide=>slide.link);

test('article carousel preserves selection, focus and secure article destinations',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 const root=page.locator('.home-banner');await expect(root).toBeVisible();
 for(let i=0;i<links.length;i++){
  const dot=root.locator('.home-banner__dots button').nth(i);await dot.click();
  await expect(dot).toBeFocused();await expect(dot).toHaveAttribute('aria-pressed','true');
  await expect(root.locator('.home-banner__stage a')).toHaveAttribute('href',links[i]);
  await expect(root.locator('.home-banner__stage a')).toHaveAttribute('target','_blank');
  await expect(root.locator('.home-banner__stage a')).toHaveAttribute('rel','noopener noreferrer');
  await expect(root.locator('.home-banner__dots [aria-pressed=true]')).toHaveCount(1);
 }
 await root.getByRole('button',{name:'下一张图片',exact:true}).click();
 await expect(root.locator('.home-banner__stage a')).toHaveAttribute('href',links[0]);
});

test('article autoplay pauses for hover, focus, visibility and disposal',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.clock.install();await page.goto('/');
 const root=page.locator('.home-banner');await expect(root).toBeVisible();await page.mouse.move(0,0);
 const current=root.locator('.home-banner__dots button[aria-pressed=true]');
 await page.clock.fastForward(6600);await expect(current).toHaveAttribute('aria-label',/^第 2 张/);
 await root.hover();await page.clock.fastForward(14000);await expect(current).toHaveAttribute('aria-label',/^第 2 张/);
 await page.mouse.move(0,0);await root.locator('.home-banner__dots button').nth(1).focus();
 await page.clock.fastForward(14000);await expect(current).toHaveAttribute('aria-label',/^第 2 张/);
 await page.locator('.phead .plogo').focus();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.fastForward(14000);await expect(current).toHaveAttribute('aria-label',/^第 2 张/);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
 await page.clock.fastForward(6600);await expect(current).toHaveAttribute('aria-label',/^第 3 张/);
 await page.emulateMedia({reducedMotion:'reduce'});await page.clock.fastForward(14000);await expect(current).toHaveAttribute('aria-label',/^第 3 张/);
 await page.evaluate(async()=>{const {homeCarousel}=await import('/app/portal/home-carousel.js');const c=homeCarousel();c.update([{image:'/assets/nju-red-cross-emblem.jpg',title:'one'},{image:'/assets/nju-red-cross-emblem.jpg',title:'two'}]);document.body.append(c.node);c.dispose();window.disposedCarousel=c.node;});
 await page.clock.fastForward(14000);expect(await page.evaluate(()=>window.disposedCarousel.querySelector('[aria-pressed=true]').getAttribute('aria-label'))).toBe('第 1 张：one');
});

test('five themes retain bounded homepage composition and readable article controls',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');test.setTimeout(120000);
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 for(const width of [1280,1440,1920])for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.setViewportSize({width,height:1080});
  await page.evaluate(async t=>{const {selectTheme}=await import('/app/core/themes.js');selectTheme('portal',t);await document.fonts.ready;},theme);
  for(const dot of await page.locator('.home-banner__dots button').all()){
   await dot.click();await expect(dot).toBeFocused();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await expect(page.locator('.home-cranes h1')).toBeVisible();
 }
 await page.emulateMedia({forcedColors:'active'});await expect(page.locator('.home-banner')).toBeVisible();
});

test('homepage stories and shared service navigation remain available',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.home-stories>section h2')).toHaveText(['志愿者风采','红会足迹']);
 await expect(page.locator('.home-impact__item')).toHaveCount(4);
 const nav=page.locator('#portal-navigation');
 for(const path of ['/events','/outreach','/community','/materials','/me'])await expect(nav.locator(`a[href="${path}"]`)).toHaveCount(1);
});
