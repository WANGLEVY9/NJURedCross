import {test,expect} from '@playwright/test';
const ordinary = i => ({eventId:`sample-${i}`,name:`合成公益活动 ${i}`,type:'公益活动',status:'报名中',capacity:10,confirmed:2,remaining:8,campus:'仙林',location:'合成测试地点',startAt:'2026-10-12T10:00:00+08:00',endAt:'2026-10-12T14:00:00+08:00',description:'仅用于界面回归的合成活动。'});
for(const count of [0,1,2,4]) test(`home and discovery adapt to ${count} ordinary activities`,async({page},info)=>{
 await page.route('**/api/public/events**',r=>r.fulfill({json:{events:Array.from({length:count},(_,i)=>ordinary(i)),facets:{campuses:['仙林']}}}));
 await page.route('**/api/public/overview',r=>r.fulfill({json:{stats:{openSeats:count*8,totalRegistrations:0,inventoryCategories:0}}}));
 await page.goto('/');
 await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('.home-impact__item b')).toHaveText([String(count),String(count*8),'0','0']);
 await expect(page.locator('.home-banner')).toBeVisible();
 await expect(page.locator('.home-stories>section')).toHaveCount(2);
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
 await page.goto('/');await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy','false');await expect(page.locator('.home-impact__item b').first()).toHaveText('1');
 for(const path of ['/events']){
  await page.goto(path);
  const entry=page.locator('.event-row[data-programme="blood"]');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('献血车专项');
  await expect(entry).toContainText('2 个点位 · 2 个班次');
  await expect(entry).toContainText('剩余 3 个名额');
  await expect(entry).toContainText('点位一 / 点位二');
  await expect(entry.locator('a')).toHaveAttribute('href','/workflow-events?type=blood');
  await page.screenshot({path:info.outputPath(path==='/'?'home-blood.png':'events-blood.png'),fullPage:true});
 }
});

test('blood and ordinary programmes share row layout and actions across themes',async({page},info)=>{
 const events=[{...ordinary(0),startAt:'2026-10-29',endAt:'2026-10-30',location:'仙林校区大活多功能厅 / 鼓楼校区逸夫馆报告厅',sessions:Array.from({length:16},()=>({}))},{...ordinary(1),blood:true,location:'点位一'},{...ordinary(2),blood:true,location:'点位二',startAt:'2026-11-01T08:00:00+08:00'}];
 await page.route('**/api/public/events**',r=>r.fulfill({json:{events,facets:{campuses:[]}}}));
 await page.goto('/');await expect(page.locator('.home-impact')).toHaveAttribute('aria-busy','false');await expect(page.locator('.home-impact__item b').first()).toHaveText('2');
 for(const path of ['/events']) {
 await page.goto(path);
 await expect(page.locator('.event-list > .event-row')).toHaveCount(2);
 await expect(page.locator('.discovery-results .blood-entry')).toHaveCount(0);
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  const styles=await page.locator('.event-row').evaluateAll(rows=>rows.map(row=>{
   const css=getComputedStyle(row),title=getComputedStyle(row.querySelector('h3')),action=getComputedStyle(row.querySelector('.event-row__action'));
   return {display:css.display,padding:css.padding,border:css.borderWidth,radius:css.borderRadius,font:title.fontSize,action:action.fontSize};
  }));
  expect(styles[0]).toEqual(styles[1]);
  for(const row of await page.locator('.event-row').all()){
   expect(await row.locator('.event-row__facts > [data-fact]').evaluateAll(els=>els.map(el=>el.dataset.fact))).toEqual(['date','location','sessions']);
   await expect(row.locator('[data-fact="date"]')).toContainText(/2026-\d{2}-\d{2} — 2026-\d{2}-\d{2}/);
   const spacing=await row.locator('.event-row__facts').evaluate(el=>{
    const location=el.querySelector('[data-fact="location"]'),arrangement=el.querySelector('[data-fact="sessions"]');
    return {excess:location.getBoundingClientRect().height-Math.max(...[...location.children].map(child=>child.getBoundingClientRect().height)),gap:arrangement.getBoundingClientRect().top-location.getBoundingClientRect().bottom};
   });
   expect(spacing.excess).toBeLessThanOrEqual(1);
   expect(spacing.gap).toBeGreaterThanOrEqual(0);
   expect(spacing.gap).toBeLessThanOrEqual(8);
  }
  if(info.project.name==='desktop-chromium'){
   const tops=await page.locator('.event-row__action').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top));
   expect(Math.abs(tops[0]-tops[1])).toBeLessThanOrEqual(1);
  }
 }
 await expect(page.locator('[data-programme="blood"] a')).toHaveAttribute('href','/workflow-events?type=blood');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(path==='/'?'unified-home-rows.png':'unified-activity-rows.png'),fullPage:true});
 }
});

for (const count of [0, 1, 3, 10]) test(`discovery ${count}: natural footer flow and retained filter navigation`, async ({page}, info) => {
 test.skip(info.project.name !== 'desktop-chromium', 'Desktop directory geometry');
 await page.route('**/api/public/events**', r => r.fulfill({json:{events:Array.from({length:count},(_,i)=>({...ordinary(i),name:i===1?'合成测试：校园公益与急救知识实践交流活动（长标题排版检查）':ordinary(i).name})),facets:{campuses:['仙林']}}}));
 for (const [width,height] of [[1920,1080],[2048,988]]) {
  await page.setViewportSize({width,height});
  await page.goto('/events');
  await expect(page.locator('.discovery-results')).toHaveAttribute('data-count',String(count));
  // 活动广场改版后结果区之后保留「参与流程」板块，页脚应以页面最后一个板块衡量。
  const geometry=await page.evaluate(()=>{
   const frame=document.querySelector('.events-page .plaza-frame');
   const tail=(frame?.lastElementChild || document.querySelector('.discovery-results')).getBoundingClientRect();
   const footer=document.querySelector('.pfoot').getBoundingClientRect();
   return {gap:footer.top-tail.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  expect(geometry.gap).toBeGreaterThanOrEqual(24);
  expect(geometry.gap).toBeLessThanOrEqual(64);
  expect(geometry.overflow).toBe(false);
  await page.screenshot({path:info.outputPath(`directory-${count}-${width}.png`),fullPage:true});
 }
 await page.getByRole('searchbox',{name:'搜索活动'}).fill('不存在');
 await expect(page.getByRole('heading',{name:'没有符合条件的活动'})).toBeVisible();
 await expect(page).toHaveURL(/q=/);
 await page.screenshot({path:info.outputPath('no-matches.png'),fullPage:true});
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
 await expect(page.locator('.discovery-results')).toHaveAttribute('data-count',String(count));
 if(count) {
  await expect(page.locator('.event-row').first().getByRole('link')).toHaveAttribute('href','/events/sample-0');
  await page.locator('.event-row').first().getByRole('link').click();
  await expect(page).toHaveURL(/\/events\/sample-0$/);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.discovery-results')).toHaveAttribute('data-count',String(count));
 }
});
