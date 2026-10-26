import {test,expect} from '@playwright/test';
import axe from 'axe-core';
import {mkdir} from 'node:fs/promises';
const pages=['/','/events','/workflow-events?type=blood&week=2026-10-12','/outreach','/community','/materials','/about','/login'];
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});
test('P11 keyboard tooltip is associated, hoverable and dismissible',async({page})=>{
 await page.goto('/');await page.locator('.home-banner').waitFor();
 const trigger=page.getByRole('button',{name:'外观主题',exact:true});await trigger.focus();
 await expect(page.getByRole('tooltip')).toBeVisible();const id=await page.getByRole('tooltip').getAttribute('id');await expect(trigger).toHaveAttribute('aria-describedby',id);
 await page.getByRole('tooltip').hover();await page.waitForTimeout(160);await expect(page.getByRole('tooltip')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(trigger).toBeFocused();await expect(trigger).not.toHaveAttribute('aria-describedby',id);
});
test('P11 theme dialog keyboard loop, focus return and accessibility',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/events');
 const trigger=page.getByRole('button',{name:'外观主题',exact:true});await trigger.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await page.evaluate(axe.source);const issues=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});expect(issues).toEqual([]);
 const complete=dialog.getByRole('button',{name:'完成',exact:true});await complete.focus();await page.keyboard.press('Tab');expect(await dialog.evaluate(n=>n.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
});
test('P11 125 percent layout zoom, missing fonts and forced colors',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');test.setTimeout(120000);
 await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.route('**/*.woff2',r=>r.abort());
 for(const url of pages){await page.goto(url);await page.locator('#main').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>document.documentElement.style.zoom='1.25');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await page.locator('.discovery-filters .filter-segments button').evaluateAll(ns=>ns.every(n=>[...n.querySelectorAll('span')].filter(s=>s.getBoundingClientRect().width).every(s=>s.getBoundingClientRect().width<=n.getBoundingClientRect().width-4)))).toBe(true);
  if(process.env.P11_CAPTURE){await mkdir(process.env.P11_CAPTURE,{recursive:true});await page.screenshot({path:`${process.env.P11_CAPTURE}/zoom-font-${url.split('?')[0].replaceAll('/','')||'home'}.png`,fullPage:true});}
  await page.evaluate(()=>document.documentElement.style.zoom='1');await page.emulateMedia({forcedColors:'active'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'外观主题',exact:true}).focus();expect(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle)).not.toBe('none');
  if(process.env.P11_CAPTURE)await page.screenshot({path:`${process.env.P11_CAPTURE}/forced-${url.split('?')[0].replaceAll('/','')||'home'}.png`,fullPage:true});
  await page.emulateMedia({forcedColors:'none'});
 }
});
test('P11 long title and empty filtering preserve readable layout and keyboard focus',async({page})=>{
 await page.route('**/api/public/events**',r=>r.fulfill({json:{events:[{eventId:'qa-long',name:'合成测试长标题：'+ '校园急救培训与生命教育志愿服务'.repeat(12),description:'合成说明'.repeat(100),type:'急救培训',status:'报名中',campus:'仙林',location:'合成地点',remaining:3,capacity:3,confirmed:0}],facets:{campuses:['仙林']}}}));
 const longCard=page.locator('.event-row[data-flip-key="qa-long"]');
 await page.setViewportSize({width:1280,height:900});await page.goto('/events');await longCard.waitFor();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const search=page.getByRole('searchbox');await search.fill('无此活动');await expect(page.getByText('没有符合条件的活动',{exact:true})).toBeVisible();await expect(search).toBeFocused();
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(search).toBeFocused();await expect(longCard).toBeVisible();
});
