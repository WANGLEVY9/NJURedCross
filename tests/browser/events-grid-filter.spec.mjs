import {test,expect} from '@playwright/test';

test('status filtering preserves equal card widths and leaves the odd final card in one column',async({page,isMobile})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const events=['进行中',...Array(3).fill('已结束'),...Array(4).fill('报名中')].map((status,index)=>({eventId:`grid-${index}`,name:`合成活动${index}`,type:'生命中心',status,startAt:'2026-10-25T09:00:00+08:00',endAt:'2026-10-25T12:00:00+08:00',location:'合成服务点',remaining:5}));
 await page.route('**/api/public/events',route=>route.fulfill({json:{ok:true,events,facets:{categories:['生命中心'],campuses:[]}}}));
 for(const width of isMobile?[390]:[1280,1024]){
  await page.setViewportSize({width,height:900});
  await page.goto('/events');
  const statusFilter=page.getByRole('radiogroup',{name:'按状态筛选',exact:true});
  for(const [status,count] of [['进行中',1],['已结束',3],['报名中',5],['全部',9]]){
   await statusFilter.getByRole('radio',{name:status,exact:true}).click();
   await expect(page.locator('.event-row')).toHaveCount(count);
   const layout=await page.locator('.event-list').evaluate(list=>{
    const bounds=list.getBoundingClientRect();
    return {width:bounds.width,left:bounds.left,cards:[...list.children].map(card=>{const rect=card.getBoundingClientRect();return {width:rect.width,left:rect.left,top:rect.top};})};
   });
   const first=layout.cards[0],last=layout.cards.at(-1);
   for(const card of layout.cards){
    expect(Math.abs(card.width-first.width)).toBeLessThan(1);
    expect(card.width/layout.width).toBeLessThan(isMobile?1.01:0.51);
    expect(card.width/layout.width).toBeGreaterThan(isMobile?0.99:0.45);
   }
   expect(Math.abs(last.left-layout.left)).toBeLessThan(1);
   if(!isMobile&&count>1){
    expect(Math.abs(layout.cards[1].top-first.top)).toBeLessThan(1);
    expect(layout.cards[1].left).toBeGreaterThan(first.left+first.width);
   }
   await expect(page.locator('.event-row--featured')).toHaveCount(0);
  }
 }
});
