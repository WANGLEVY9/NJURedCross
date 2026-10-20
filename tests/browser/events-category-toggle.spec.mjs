import {test,expect} from '@playwright/test';

test('category shortcuts clear the filter and touch highlight on a second activation',async({page,isMobile})=>{
 const categories=['生命中心','主席团专项','排班专项'];
 await page.route('**/api/public/events**',route=>route.fulfill({json:{
  events:categories.map((activityCategory,index)=>({eventId:`toggle-${index}`,activityCategory,name:`合成${activityCategory}活动`,status:'报名中',remaining:5,full:false,startAt:'2026-10-25T09:00:00+08:00',endAt:'2026-10-25T12:00:00+08:00',campus:'仙林校区',location:'合成服务点'})),
  facets:{campuses:[],categories},
 }}));
 await page.goto('/events');
 await expect(page.locator('.event-row')).toHaveCount(3);
 for(const category of categories){
  const tile=page.locator(`.events-category[data-category="${category}"]`);
  const appearance=()=>tile.evaluate(node=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderTopColor}));
  const initial=await appearance();
  if(isMobile)await tile.tap();else await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.event-row')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('kind')).toBe(category);
  if(isMobile)await tile.tap();else await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.event-row')).toHaveCount(3);
  expect(new URL(page.url()).searchParams.has('kind')).toBe(false);
  if(isMobile)expect(await appearance()).toEqual(initial);
 }
});
