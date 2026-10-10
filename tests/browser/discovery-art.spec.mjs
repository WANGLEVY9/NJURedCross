import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});

test('plaza filter summary supports independent removal, URL state and reset focus',async({page})=>{
 await page.goto('/events?category=nanjing&status=报名中');
 await expect(page.getByRole('button',{name:'清除分类：南京地区',exact:true})).toBeVisible();
 await expect(page.locator('.event-row')).toHaveCount(1);
 await page.getByRole('searchbox',{name:'搜索活动'}).fill('不存在的活动');
 await expect(page.getByRole('heading',{name:'没有符合条件的活动'})).toBeVisible();
 await page.getByRole('button',{name:'清除搜索：不存在的活动',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
 await expect(page.locator('.event-row')).toHaveCount(1);
 await expect(page).not.toHaveURL(/q=/);
 await page.getByRole('button',{name:'清除分类：南京地区',exact:true}).click();
 await expect(page.getByRole('radiogroup',{name:'活动分类'}).getByRole('radio',{name:'全部',exact:true})).toBeFocused();
 await expect(page.getByRole('button',{name:'清除状态：报名中',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重置全部',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
 await expect(page.locator('.active-filters')).toBeHidden();
 await expect(page).not.toHaveURL(/status=|category=/);
 await expect(page.locator('.event-row')).toHaveCount(3);
});

test('home and plaza preserve content and fit desktop and small screens',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [1440,1280,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'校园急救培训',exact:true})).toBeVisible();
  await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.hero-services__identity img')).toHaveJSProperty('complete',true);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`home-${width}.png`),fullPage:true,animations:'disabled'});
  await page.goto('/events');
  await expect(page.getByRole('heading',{name:'献血车志愿服务',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`events-${width}.png`),fullPage:true,animations:'disabled'});
 }
});

test('global ambient stays inert and console uses a stable workspace canvas',async({page},info)=>{
 await page.goto('/');
 await expect(page.locator('#ambient')).toHaveAttribute('aria-hidden','true');
 await expect(page.locator('#ambient')).toHaveCSS('pointer-events','none');
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('.ambient__brand')).toHaveCSS('transform','none');
 await expect(page.locator('.ambient__mesh')).toHaveCSS('transform','none');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/console/admin');
 await expect(page.getByRole('button',{name:'账号菜单',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('console-background.png'),animations:'disabled'});
 expect(await page.locator('.console').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 await expect(page.locator('#ambient')).toBeHidden();
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await expect(page.locator('.blood-calendar')).toBeVisible();
 await page.screenshot({path:info.outputPath('calendar-background.png'),animations:'disabled'});
 await page.emulateMedia({forcedColors:'active'});
 await expect(page.locator('#ambient')).toBeHidden();
});


test('plaza theme and keyboard filters keep readable controls without layout animation',async({page})=>{
 await page.goto('/events');
 await page.evaluate(()=>document.documentElement.dataset.theme='sail');
 const categories=page.getByRole('radiogroup',{name:'活动分类'});
 await categories.getByRole('radio',{name:'全部',exact:true}).focus();
 await page.evaluate(()=>{
  window.__filterAnimations=0;
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(...args){
   if(this.matches('[data-flip-key]'))window.__filterAnimations++;
   return animate.apply(this,args);
  };
 });
 await page.keyboard.press('ArrowRight');
 await expect(categories.getByRole('radio',{name:'南京地区',exact:true})).toBeFocused();
 await expect(page.locator('.event-row')).toHaveCount(2);
 expect(await page.evaluate(()=>window.__filterAnimations)).toBe(0);
 await page.getByRole('button',{name:'清除分类：南京地区',exact:true}).click();
 await page.getByRole('searchbox',{name:'搜索活动'}).fill('很长的搜索条件'.repeat(12));
 await expect(page.getByRole('heading',{name:'没有符合条件的活动'})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});


test('reduced motion keeps hovered blood cards still',async({page,isMobile})=>{
 if(isMobile)return;
 await page.goto('/events');
 const entry=page.locator('.blood-entry');
 await entry.hover();
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(entry).toHaveCSS('transform','none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>document.documentElement.dataset.motion='reduced');
 await expect(entry).toHaveCSS('transform','none');
});
