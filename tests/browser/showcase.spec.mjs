import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const names=['活动广场','宣传广场','内建广场','物资广场','会员中心'];
const paths=['/events','/outreach','/community','/materials','/me'];
test('showcase topics, focus, reduced motion and navigation',async({page})=>{
 await page.request.post('/api/auth/logout');await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 const root=page.locator('.hero-showcase');await expect(root).toBeVisible();
 for(let i=0;i<names.length;i++){
  const dot=root.getByRole('button',{name:`显示${names[i]}`,exact:true});await dot.click();await expect(dot).toBeFocused();
  await expect(root.locator('.showcase__slide:visible')).toHaveCount(1);
  await expect(root.locator('.showcase__slide:visible a')).toHaveAttribute('href',paths[i]);
  await expect(root.locator('.showcase__slide:visible')).toHaveCSS('animation-name','none');
  expect(await root.locator('.showcase__slide[hidden]').evaluateAll(ns=>ns.every(n=>n.getBoundingClientRect().height===0))).toBe(true);
 }
 await root.getByRole('button',{name:'下一专题',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await expect(root.locator('.showcase__count')).toHaveText('01 / 05');
 await expect(root.getByRole('button',{name:'下一专题',exact:true})).toBeFocused();
 for(let i=0;i<names.length;i++){
  await root.getByRole('button',{name:`显示${names[i]}`,exact:true}).click();await root.locator('.showcase__slide:visible a').click();
  await expect(page).toHaveURL(i===4?/\/(me|login)/:new RegExp(`${paths[i]}(?:\\?|$)`));
  await page.goto('/');
 }
});
test('autoplay pauses for hover, focus, interaction, visibility and disposal',async({page})=>{
 await page.clock.install();await page.goto('/');await page.locator('.hero-showcase').waitFor();
 const count=page.locator('.showcase__count');await page.mouse.move(0,0);
 await page.clock.fastForward(7100);await expect(count).toHaveText('02 / 05');
 await page.locator('.hero-showcase').hover();await page.clock.fastForward(15000);await expect(count).toHaveText('02 / 05');
 await page.mouse.move(0,0);await page.locator('.showcase__dot').first().focus();await page.clock.fastForward(15000);await expect(count).toHaveText('02 / 05');
 await page.getByRole('button',{name:'下一专题',exact:true}).click();await page.locator('.hero__cta a').first().focus();await page.clock.fastForward(15000);await expect(count).toHaveText('03 / 05');
 await page.getByRole('button',{name:'播放专题轮播',exact:true}).click();await page.locator('.hero__cta a').first().focus();await page.mouse.move(0,0);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(15000);await expect(count).toHaveText('03 / 05');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await page.clock.fastForward(7100);await expect(count).toHaveText('04 / 05');
 await page.evaluate(()=>document.documentElement.dataset.motion='reduced');await page.clock.fastForward(15000);await expect(count).toHaveText('04 / 05');
 await page.evaluate(async()=>{const {heroShowcase}=await import('/app/portal/hero-showcase.js');const c=heroShowcase();document.body.append(c.node);c.dispose();window.disposedShowcase=c.node;document.documentElement.dataset.motion='full';});
 await page.clock.fastForward(15000);expect(await page.evaluate(()=>window.disposedShowcase.querySelector('.showcase__count').textContent)).toBe('01 / 05');
 await page.locator('.hero__cta a').first().click();await expect(page.locator('.home-page')).toHaveCount(0);
});
test('five themes and topics remain bounded with A/B art directions',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');test.setTimeout(120000);await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 for(const width of[1440,1920]){
  await page.setViewportSize({width,height:width===1440?900:1080});
  for(const theme of['dawn','sail','garden','iris','amber']){
   await page.evaluate(async t=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal',t);await document.fonts.ready;},theme);
   const readable=await page.locator('.square-card').evaluateAll(cards=>cards.every(card=>{
    const rgb=value=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=value;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3);};
    const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const a=lum(rgb(getComputedStyle(card).backgroundColor)),b=lum(rgb(getComputedStyle(card.querySelector('p')).color));
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;
   }));expect(readable).toBe(true);
   for(let i=0;i<names.length;i++){
    await page.getByRole('button',{name:`显示${names[i]}`,exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(process.env.SHOWCASE_CAPTURE){await mkdir(process.env.SHOWCASE_CAPTURE,{recursive:true});await page.screenshot({path:`${process.env.SHOWCASE_CAPTURE}/${theme}-${width}-${i+1}.png`});}
   }
  }
 }
 await page.evaluate(async()=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal','dawn');});
 await page.getByRole('button',{name:'显示活动广场',exact:true}).click();
 for(const direction of['editorial','spotlight']){
  await page.evaluate(d=>document.querySelector('.home-page').dataset.artDirection=d,direction);
  if(process.env.SHOWCASE_CAPTURE)await page.screenshot({path:`${process.env.SHOWCASE_CAPTURE}/direction-${direction}.png`,fullPage:true});
 }
 await page.emulateMedia({forcedColors:'active'});await expect(page.locator('.hero-showcase')).toHaveCSS('background-color','rgb(255, 255, 255)');
});
