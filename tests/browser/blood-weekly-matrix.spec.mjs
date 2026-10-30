import {test,expect} from '@playwright/test';
test('weekly matrix fixes seven positions and seven days and preserves unplanned cells',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await(await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(e=>JSON.parse(e['报名页配置']||'{}').source?.kind==='generated_blood');
 await page.goto(`/console/events?event=${event._id}&scheduleTask=registration&rosterView=board`);
 await expect(page.getByRole('button',{name:'通知信息编辑',exact:true})).toBeVisible();await expect(page.locator('details.activity-blood-directory')).toHaveCount(0);await expect(page.getByRole('button',{name:'选择排班周',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'选择排班周',exact:true}).click();
 const calendar=page.getByRole('dialog',{name:'选择排班周（整周选择）'});await expect(calendar).toBeVisible();
 await expect(calendar.locator('button.blood-week-calendar__row:disabled').first()).toBeDisabled();
 const available=calendar.locator('button.blood-week-calendar__row:not(:disabled)');
 const lastLabel=await available.last().getAttribute('aria-label');await available.last().click();await expect(calendar).toBeHidden();
 await expect(page.locator('.blood-card-grid__heading').first()).toContainText(lastLabel.slice(0,10));
 await page.getByRole('button',{name:'选择排班周',exact:true}).click();await page.getByRole('dialog',{name:'选择排班周（整周选择）'}).locator('button.blood-week-calendar__row:not(:disabled)').first().click();

 const cards=page.locator('.blood-schedule-card');await expect(cards).toHaveCount(49);await expect(page.locator('.blood-card-grid__heading')).toHaveCount(7);
 await expect(cards.nth(0)).toContainText('印象汇');await expect(cards.nth(7)).toContainText('印象汇');await expect(cards.nth(14)).toContainText('中央');await expect(cards.nth(28)).toContainText('弘阳广场');await expect(cards.nth(42)).toContainText('学则路');
 const sizes=await cards.evaluateAll(nodes=>nodes.slice(0,7).map(n=>({w:Math.round(n.getBoundingClientRect().width),h:Math.round(n.getBoundingClientRect().height)})));expect(new Set(sizes.map(s=>s.w)).size).toBe(1);expect(new Set(sizes.map(s=>s.h)).size).toBe(1);
 await cards.first().click();await expect(page.getByRole('dialog',{name:'班次详情'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'班次详情'})).toBeHidden();
 await page.screenshot({path:test.info().outputPath('weekly-matrix.png'),fullPage:true});
 await page.getByRole('button',{name:'切换为列表',exact:true}).click();await expect(page.locator('.activity-legacy-roster')).toBeVisible();
 for(const [task,title] of [['checkins','签到审核'],['hours','时长审核与导出']]){
  await page.goto(`/console/events?event=${event._id}&scheduleTask=${task}`);
  await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();
  if(task==='hours'){await expect(page.locator('.blood-card-grid')).toHaveCount(0);await page.getByRole('button',{name:'切换为排班看板',exact:true}).click();}
  await expect(page.locator('.blood-card-grid')).toBeVisible();await expect(page.locator('.blood-schedule-card')).toHaveCount(49);
  await expect(page.locator('.blood-inline-selection').getByRole('button',{name:'批量操作',exact:true})).toBeVisible();
  if(task==='checkins'){await expect(page.getByRole('combobox',{name:'岗位',exact:true})).toHaveCount(0);await expect(page.getByRole('combobox',{name:'场次',exact:true})).toHaveCount(0);await expect(page.locator('.service-sort-options')).toHaveCount(0);await expect(page.locator('input[type=date]')).toBeVisible();}

  await expect(page.getByRole('button',{name:'选择排班周',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath(task+'-board.png'),fullPage:true});
  await page.getByRole('button',{name:'切换为列表',exact:true}).click();await expect(page.locator('.blood-card-grid')).toHaveCount(0);
  await page.getByRole('button',{name:'切换为排班看板',exact:true}).click();await expect(page.locator('.blood-card-grid')).toBeVisible();
 }
 await page.goto('/console/admin');await expect(page.getByRole('link',{name:'历史活动查看',exact:true})).toHaveAttribute('href','/console/events?history=1');
});

test('card selection separates registration decisions from leave approvals',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{
  const {bloodRegistrationBoard}=await import('/app/console/pages/blood-registration-board.js');
  const event={_id:'synthetic-event',活动ID:'synthetic-event',报名日期:'2030-10-23',地点:'新街口印象汇',报名时段:'上午 10~14点',状态:'报名中',容量:2};
  const rows=[{_id:'one',活动ID:event['活动ID'],姓名:'模拟甲',学号:'999990001',报名状态:'待筛选'},{_id:'two',活动ID:event['活动ID'],姓名:'模拟乙',学号:'999990002',报名状态:'已确认',请假状态:'待审批'},{_id:'three',活动ID:event['活动ID'],姓名:'模拟丙',学号:'999990003',报名状态:'已确认'}];
  document.body.append(bloodRegistrationBoard({events:[event],registrations:rows,state:{selected:new Set()},canManage:true,onRenotify:rows=>{window.noticeIds=rows.map(row=>row._id);},onBatchLeave:approved=>{window.leaveResult=approved;}}));
 });
 const board=page.getByRole('region',{name:'献血车排班看板'});await board.getByRole('button',{name:'批量审批报名',exact:true}).click();await expect(board.getByRole('checkbox',{name:'选择 模拟甲',exact:true})).toBeVisible();await board.getByRole('checkbox',{name:'全选 2030-10-23',exact:true}).check();await expect(board.getByRole('checkbox',{name:'选择 模拟甲',exact:true})).toBeChecked();
 await board.getByRole('button',{name:'退出批量操作',exact:true}).click();await board.getByRole('button',{name:'批量处理请假',exact:true}).click();await expect(board.getByRole('checkbox',{name:'选择 模拟甲',exact:true})).toHaveCount(0);
 await board.getByRole('checkbox',{name:'选择 模拟乙',exact:true}).check();await expect(board.getByRole('button',{name:'批量报名成功并通知',exact:true})).toBeHidden();
 await board.getByRole('button',{name:'批量批准请假',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.leaveResult)).toBe(true);
 await board.getByRole('button',{name:'退出批量操作',exact:true}).click();await board.getByRole('button',{name:'再次通知',exact:true}).click();await board.getByRole('button',{name:'全选当前待处理记录',exact:true}).click();await board.getByRole('button',{name:'确认再次通知',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.noticeIds)).toEqual(['three']);
});

test('hours board approvals never include the same student from another week',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event={_id:'scope-week',活动ID:'inside',报名日期:'2026-10-12',地点:'新街口印象汇',报名时段:'上午 10~14点',状态:'进行中',报名页配置:JSON.stringify({blood:true})};
 const outside={...event,_id:'outside-week',活动ID:'outside',报名日期:'2026-10-19'};
 const entries=[{_id:'entry-inside',活动ID:'inside',报名行ID:'reg-inside',状态:'待批准',核对摘要:'a'},{_id:'entry-outside',活动ID:'outside',报名行ID:'reg-outside',状态:'待批准',核对摘要:'b'}];
 let submitted;
 await page.route('**/events/scope-week/hours-review*',route=>route.fulfill({json:{rows:[{姓名:'模拟甲',学号:'99990001',院系:'模拟院系',正式工作日期:'两周',服务时长:8}],groups:[{ids:entries.map(e=>e._id)}],entries,events:[event,outside],registrations:entries.map((e,i)=>({_id:e.报名行ID,活动ID:e.活动ID,姓名:'模拟甲',学号:'99990001',报名日期:i?'2026-10-19':'2026-10-12',报名时段:'上午 10~14点'})),columns:[]}}));
 await page.route('**/events/scope-week/hours-approve',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{succeeded:1,failed:0,results:[{id:'entry-inside',ok:true}]}});});
 await page.goto('/');await page.evaluate(async event=>{const {hoursWorkspace}=await import('/app/console/pages/hours-workspace.js');document.body.replaceChildren(hoursWorkspace({event,superAdmin:true,actor:'synthetic-super',state:{},bloodBoard:{view:'board',events:[event]},onSaved:async()=>{}}));},event);
 await expect(page.locator('.blood-schedule-card')).toHaveCount(49);await page.getByRole('button',{name:'批量操作',exact:true}).click();await page.getByRole('button',{name:'全选当前可审核名单',exact:true}).click();await page.getByRole('button',{name:'审核通过',exact:true}).click();
 await expect.poll(()=>submitted?.items.map(e=>e.id)).toEqual(['entry-inside']);
});

test('cancelled unconfirmed bookings leave a green available card without the cancelled name',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{const {bloodRegistrationBoard}=await import('/app/console/pages/blood-registration-board.js');document.body.replaceChildren(bloodRegistrationBoard({events:[{_id:'available-event',活动ID:'available',报名日期:'2030-10-21',地点:'新街口中央',报名时段:'上午 11~15点',状态:'报名中',报名页配置:'{}'}],registrations:[{_id:'cancelled-row',活动ID:'available',姓名:'模拟已取消',学号:'99990000',报名状态:'已请假',请假状态:'已批准'}],state:{selected:new Set()},canManage:true}));});
 await expect(page.locator('.blood-schedule-card')).toHaveCount(49);await expect(page.locator('.blood-schedule-card').filter({hasText:'可报名'})).toHaveCount(1);await expect(page.locator('.blood-schedule-card').filter({hasText:'模拟已取消'})).toHaveCount(0);
 await page.getByRole('button',{name:'批量审批报名',exact:true}).click();await expect(page.locator('.blood-card-grid')).toHaveClass(/is-selecting/);await expect(page.getByRole('checkbox',{name:'全选 中央 上午',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox',{name:'全选 2030-10-21',exact:true})).toBeDisabled();
});
