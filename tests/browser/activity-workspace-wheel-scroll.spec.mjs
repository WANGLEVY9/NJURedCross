import {test,expect} from '@playwright/test';

test('draft editor keeps wheel scrolling through long position and notice sections',async({page})=>{
 test.skip((page.viewportSize()?.width||0)<1000,'Desktop detail pane owns the form scroll.');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const session=await (await page.request.get('/api/auth/session')).json();
 const positions=Array.from({length:8},(_,i)=>({id:`wheel-${i}`,name:`合成岗位${i}`,date:'2030-01-01',start:'08:00',end:'11:00',location:'合成场地',capacity:'2',serviceHours:'3',trainingHours:'1',travelHours:'0',work:'合成服务'}));
 const content={name:'合成连续滚轮草稿',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-01',deadline:'2029-12-31T18:00',positions,qqGroup:'123456789',notice:'合成通知\n'.repeat(60)};
 const created=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':session.csrfToken},data:{requestId:crypto.randomUUID(),content}});
 expect(created.ok()).toBe(true);const draft=(await created.json()).result;
 await page.goto(`/console/events?workspace=v2&draft=${draft.id}`);
 const form=page.locator('.activity-draft-workspace__form');
 await expect(form).toBeVisible();
 const geometry=()=>form.evaluate(node=>({top:node.scrollTop,max:Math.max(0,node.scrollHeight-node.clientHeight),overscroll:getComputedStyle(node).overscrollBehaviorY}));
 const initial=await geometry();
 expect(initial.max).toBeGreaterThan(1500);
 expect(initial.overscroll).not.toBe('contain');
 await form.hover({position:{x:400,y:200}});
 let previous=initial.top;
 for(let step=0;step<5;step++){
  await page.mouse.wheel(0,500);
  await expect.poll(()=>form.evaluate(node=>node.scrollTop)).toBeGreaterThan(previous);
  previous=await form.evaluate(node=>node.scrollTop);
 }
 for(let step=0;step<12;step++){
  await page.mouse.wheel(0,600);
  await page.waitForTimeout(40);
  if((await geometry()).top>=initial.max-1)break;
 }
 const final=await geometry();
 expect(final.top).toBeGreaterThanOrEqual(initial.max-1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
