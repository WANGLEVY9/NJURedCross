import {test,expect} from '@playwright/test';
test('blood board uses project snapshot, switches views and scopes selection without page overflow',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await(await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(e=>JSON.parse(e['报名页配置']||'{}').source?.kind==='generated_blood');expect(event).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}&scheduleTask=registration`);
 await page.getByRole('button',{name:'切换为排班看板',exact:true}).click();const board=page.getByRole('region',{name:'献血车排班看板'});await expect(board).toBeVisible();
 await expect(board.getByRole('button',{name:'批量报名成功并通知',exact:true})).toBeDisabled();
 await expect(board.locator('.blood-registration-board__day').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBeTruthy();
 await page.getByRole('button',{name:'切换为列表',exact:true}).click();await expect(page.locator('.activity-legacy-roster')).toBeVisible();
});

test('board date and point filters scope batch rejection and preserve vacancy choice',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {bloodRegistrationBoard}=await import('/app/console/pages/blood-registration-board.js');
  const events=[{_id:'a',活动ID:'a',报名日期:'2030-10-23',地点:'中央',报名时段:'11:00-15:00',状态:'报名中',容量:2},{_id:'b',活动ID:'b',报名日期:'2030-10-24',地点:'印象汇',报名时段:'14:00-18:00',状态:'报名中',容量:2}];
  const rows=events.map(e=>({_id:'r'+e._id,活动ID:e['活动ID'],姓名:'模拟'+e._id,学号:'999990001',报名状态:'待筛选'}));
  const node=bloodRegistrationBoard({events,registrations:rows,state:{selected:new Set()},canManage:true,onBatch:async(rows,decision,reopen,reason)=>{window.boardResult={ids:rows.map(r=>r._id),decision,reopen,reason};}});document.body.append(node);
 });
 const board=page.getByRole('region',{name:'献血车排班看板'});
 await board.locator('select').first().selectOption('2030-10-23');
 await board.getByRole('button',{name:'选择当前筛选待确认',exact:true}).click();await expect(board).toContainText('当前筛选已选 1 人');
 await board.getByRole('button',{name:'批量报名失败并通知',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:/失败原因/}).fill('模拟不再补招');await dialog.locator('select').selectOption('closed');await dialog.getByRole('button',{name:'确认失败并通知',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.boardResult)).toEqual({ids:['ra'],decision:'reject',reopen:false,reason:'模拟不再补招'});
});
