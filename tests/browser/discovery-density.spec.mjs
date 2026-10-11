import {test,expect} from '@playwright/test';
const ordinary = i => ({eventId:`sample-${i}`,name:`合成公益活动 ${i}`,type:'公益活动',status:'报名中',capacity:10,confirmed:2,remaining:8,campus:'仙林',location:'合成测试地点',startAt:'2026-10-12T10:00:00+08:00',endAt:'2026-10-12T14:00:00+08:00',description:'仅用于界面回归的合成活动。'});
for(const count of [0,1,2,4]) test(`home and discovery adapt to ${count} ordinary activities`,async({page},info)=>{
 await page.route('**/api/public/events**',r=>r.fulfill({json:{events:Array.from({length:count},(_,i)=>ordinary(i)),facets:{campuses:['仙林']}}}));
 await page.route('**/api/public/overview',r=>r.fulfill({json:{stats:{openSeats:count*8,totalRegistrations:0,inventoryCategories:0}}}));
 await page.goto('/');
 await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.hero__figure b')).toHaveText([String(count),String(count*8),'0','0']);
 if(count){
  await expect(page.locator('.home-activities__featured .event')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'合成公益活动 0',exact:true})).toBeVisible();
  await expect(page.locator('.home-activities__list .event-row')).toHaveCount(count-1);
 }else await expect(page.getByRole('heading',{name:'目前没有开放报名的活动'})).toBeVisible();
 await expect(page.locator('.square-grid--home > a')).toHaveCount(5);
 expect(await page.locator('.square-grid--home > a').evaluateAll(els=>els.map(el=>el.getAttribute('href')))).toEqual(['/events','/outreach','/community','/materials','/me']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`home-${count}.png`),fullPage:true});
 await page.goto('/events');
 if(count) await expect(page.locator('.event-row')).toHaveCount(count);
 else await expect(page.getByRole('heading',{name:'暂时没有公开活动'})).toBeVisible();
 await page.getByRole('searchbox',{name:'搜索活动'}).fill('不存在');
 await expect(page.getByRole('heading',{name:'没有符合条件的活动'})).toBeVisible();
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('single blood programme retains all source shifts and dates',async({page},info)=>{
 const events=[{...ordinary(1),blood:true,location:'点位一',remaining:0},{...ordinary(2),blood:true,location:'点位二',remaining:3}];
 await page.route('**/api/public/events**',r=>r.fulfill({json:{events,facets:{campuses:[]}}}));
 for(const path of ['/','/events']){
  await page.goto(path);
  await expect(page.locator('.blood-entry')).toHaveCount(1);
  await expect(page.locator('.blood-entry')).toContainText('2 个点位 · 2 个班次');
  await expect(page.locator('.blood-entry')).toContainText('剩余 3 个名额');
  await expect(page.locator('.blood-entry')).toContainText('点位一 / 点位二');
  await expect(page.locator('.blood-entry a')).toHaveAttribute('href','/workflow-events?type=blood');
  await page.screenshot({path:info.outputPath(path==='/'?'home-blood.png':'events-blood.png'),fullPage:true});
 }
});
