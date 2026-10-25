import {test,expect} from '@playwright/test';

test('uncategorized activity date panels fill the left column',async({page})=>{
 let count=2;
 const events=[
  {eventId:'uncategorized-fill',name:'合成未分类活动'},
  {eventId:'categorized-fill',name:'合成生命中心活动',activityCategory:'生命中心'},
 ].map(event=>({...event,status:'报名中',remaining:5,full:false,startAt:'2026-10-25T09:00:00+08:00',endAt:'2026-10-25T12:00:00+08:00',campus:'仙林校区',location:'合成服务点'}));
 await page.route('**/api/public/events**',route=>route.fulfill({json:{events:events.slice(0,count),facets:{campuses:[],categories:['生命中心']}}}));
 for(count of [2,1]){
  await page.goto('/events');
  await expect(page.locator('.event-row')).toHaveCount(count+1);
  const card=page.locator('.event-row[data-category="未分类"]');
  await expect(card.locator('.activity-emblem')).toHaveCount(0);
  const bounds=await card.evaluate(node=>{
   const card=node.getBoundingClientRect(),panel=node.querySelector('.event-row__date').getBoundingClientRect();
   return {left:panel.left-card.left,top:panel.top-card.top,bottom:card.bottom-panel.bottom,width:panel.width,column:parseFloat(getComputedStyle(node).gridTemplateColumns)};
  });
  expect(Math.abs(bounds.left-1)).toBeLessThan(1);
  expect(Math.abs(bounds.top-1)).toBeLessThan(1);
  expect(Math.abs(bounds.bottom-1)).toBeLessThan(1);
  expect(Math.abs(bounds.width-bounds.column)).toBeLessThan(1);
 }
});
