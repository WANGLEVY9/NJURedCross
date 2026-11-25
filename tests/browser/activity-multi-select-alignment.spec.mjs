import {test,expect} from '@playwright/test';

test('people dropdown opens beside its trigger and all draft panels align',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const session=await (await page.request.get('/api/auth/session')).json();
 const content={qqGroup:'123456789',name:'合成对齐检查',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-01',deadline:'2029-12-31T18:00',positions:[{id:'align-a',name:'岗位一',date:'2030-01-01',start:'08:00',end:'11:00',location:'合成地点',capacity:'2',serviceHours:'3',trainingHours:'1',travelHours:'0',work:'合成工作'}]};
 const created=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':session.csrfToken},data:{requestId:crypto.randomUUID(),content}});
 expect(created.ok()).toBe(true);const id=(await created.json()).result.id;
 await page.goto(`/console/events?workspace=v2&draft=${id}`);
 const trigger=page.getByRole('combobox',{name:'协作负责人（可多选）',exact:true});
 await expect(trigger).toBeVisible();await trigger.click();
 const geometry=await page.evaluate(()=>{
  const triggerBox=document.querySelectorAll('.activity-multi-select__trigger')[0].getBoundingClientRect();
  const popup=document.querySelectorAll('.activity-multi-select__popup')[0];
  const popupBox=popup.getBoundingClientRect();
  const gap=popup.dataset.side==='top'?triggerBox.top-popupBox.bottom:popupBox.y-triggerBox.bottom;
  return {deltaX:Math.abs(popupBox.x-triggerBox.x),gap,width:popupBox.width,triggerWidth:triggerBox.width};
 });
 expect(geometry.deltaX).toBeLessThan(2);
 expect(geometry.gap).toBeGreaterThan(-8);expect(geometry.gap).toBeLessThan(20);
 expect(geometry.width).toBeGreaterThanOrEqual(Math.min(geometry.triggerWidth,260));
 expect(geometry.width).toBeLessThanOrEqual(Math.min(Math.max(geometry.triggerWidth,260),340));
 await trigger.press('Escape');
 const panels=await page.locator('.activity-draft-workspace__form .panel').evaluateAll(nodes=>nodes.map(node=>{
  const box=node.getBoundingClientRect();return {left:Math.round(box.left),right:Math.round(box.right),width:Math.round(box.width)};
 }));
 expect(panels.length).toBeGreaterThan(3);
 expect(new Set(panels.map(row=>row.left)).size).toBe(1);
 expect(new Set(panels.map(row=>row.right)).size).toBe(1);
 expect(new Set(panels.map(row=>row.width)).size).toBe(1);
});
