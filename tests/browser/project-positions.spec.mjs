import {test,expect} from './legacy-activity-fixture.mjs';
async function openActivityTasks(page) {
 const menu=page.locator('.activity-task-menu');
 await expect(menu).toBeVisible();
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
}

test('pending grouped activity copies positions with four campuses and publishes only after approval',async({page},info)=>{
 const headers={'x-csrf-token':'synthetic-ui'};
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:`合成岗位项目${info.project.name}`,center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:20,serviceHours:2,trainingHours:0,travelHours:0,location:'合成场馆',work:'合成服务'}});
 expect(response.ok()).toBe(true);const parent=(await response.json()).result;
 await page.goto(`/console/events?legacy=1&event=${parent._id}&mode=all`);
 await page.getByRole('button',{name:'配置报名岗位',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'配置报名岗位'});
 for(const [label,value]of [['统一报名截止（北京时间）','2030-10-28T00:00'],['岗位名称','现场引导'],['服务地点','合成逸夫馆'],['岗位开始时间','2030-10-29T08:30:01'],['岗位结束时间','2030-10-29T10:30:01'],['可报名人数','10']])await drawer.getByLabel(label).fill(value);
 await expect(drawer.locator('select[name="campus"] option')).toHaveText(['鼓楼校区','仙林校区','浦口校区','苏州校区']);
 await drawer.locator('select[name="campus"]').selectOption('浦口');
 await drawer.getByLabel('岗位工作内容').fill('合成引导岗位：核验入场并指引路线。');
 await drawer.getByRole('button',{name:'复制岗位',exact:true}).click();
 await expect(drawer.getByLabel('岗位名称').nth(1)).toHaveValue('现场引导');
 await expect(drawer.locator('select[name="campus"]').nth(1)).toHaveValue('浦口');
 await drawer.getByRole('button',{name:'保存岗位安排'}).click();
 await expect(drawer.getByRole('alert')).toContainText('重复岗位');
 await drawer.getByLabel('岗位名称').nth(1).fill('签到登记');
 await drawer.getByLabel('岗位工作内容').nth(1).fill('合成签到岗位：登记签到并发放材料。');
 await drawer.getByRole('button',{name:'选择日期与时间',exact:true}).first().click();
 await expect(drawer.getByRole('dialog',{name:'选择日期与时间'})).toBeVisible();
 await page.screenshot({path:info.outputPath('position-editor-calendar.png'),fullPage:true,animations:'disabled'});
 await page.keyboard.press('Escape');
 await expect(drawer).toBeVisible();
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await drawer.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`position-editor-${width}.png`),fullPage:true,animations:'disabled'});
 }
 await drawer.getByRole('button',{name:'保存岗位安排'}).click();await expect(drawer).toHaveCount(0);
 await expect(page.getByRole('button',{name:'统一发布岗位',exact:true})).toHaveCount(0);
 await page.setViewportSize({width:1280,height:900});
 await openActivityTasks(page);await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await expect(page.locator('.activity-detail-head .badge').first()).toHaveText('待发布');
 await openActivityTasks(page);await page.getByRole('button',{name:'前往发布报名',exact:true}).click();
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();return data.events.find(e=>e._id===parent._id)['状态'];}).toBe('报名中');
 const publicData=await(await page.request.get('/api/public/workflow/events')).json();
 // Read-only anonymous workflow catalogue excludes the unbookable parent.
 expect(publicData.ok).toBe(true);
 expect(publicData.events.some(e=>e.id===parent._id)).toBe(false);
 const positions=publicData.events.filter(e=>e.name===`合成岗位项目${info.project.name}`);
 expect(positions).toHaveLength(2);expect(new Set(positions.map(e=>e.ordinary.groupId)).size).toBe(1);
 await page.goto(`/console/events?legacy=1&event=${positions[0].id}&mode=all&tab=publish`);
 await expect(page.getByRole('region',{name:'发布工作区'})).toBeVisible();
 await expect(page.getByLabel('报名通知正文',{exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeEnabled();
 await page.goto(`/console/events?legacy=1&event=${parent._id}&mode=all&tab=overview&scope=session`);
 await page.getByRole('button',{name:'配置报名岗位',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'配置报名岗位'}).getByLabel('岗位名称').first()).toBeEditable();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const editor=page.getByRole('dialog',{name:'配置报名岗位'});
 await editor.getByLabel('岗位工作内容').first().fill('更新后引导岗位：核验入场、引导无障碍路线。');
 await editor.getByRole('button',{name:'保存岗位安排',exact:true}).click();
 await page.getByRole('dialog',{name:'保存并暂停项目报名？'}).getByRole('button',{name:'保存岗位安排',exact:true}).click();
 await expect(editor).toHaveCount(0);
 const closed=await(await page.request.get('/api/public/workflow/events')).json();
 expect(closed.events.filter(e=>e.parentEventId===parent._id)).toHaveLength(0);
 await openActivityTasks(page);await page.getByRole('button',{name:'前往发布报名',exact:true}).click();
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/public/workflow/events')).json();return data.events.filter(e=>e.parentEventId===parent._id&&e.registrationOpen).length;}).toBe(2);
 const reopened=(await(await page.request.get('/api/public/workflow/events')).json()).events.filter(e=>e.parentEventId===parent._id);
 const expectedWork=['更新后引导岗位：核验入场、引导无障碍路线。','合成签到岗位：登记签到并发放材料。'];
 expect(reopened.map(e=>e.work).sort()).toEqual([...expectedWork].sort());
 for(const event of reopened){
  await page.goto(`/workflow-events?event=${event.id}`);
  await expect(page.locator('.blood-detail-information').getByText(event.work,{exact:true})).toBeVisible();
 }
});
test('position editor retains conflict inputs, guards drafts and distinguishes a saved write from refresh failure',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events?legacy=1');
 await page.evaluate(async()=>{
  const {configureProjectPositions}=await import('/app/console/pages/activity-positions.js');
  configureProjectPositions({_id:'synthetic-position-ui',活动名称:'合成保存保护',容量:20,状态:'待审核',positionToken:'synthetic-token',报名页配置:JSON.stringify({bookingMode:'grouped',window:{start:'2030-10-29T08:00:00+08:00',end:'2030-10-30T18:00:00+08:00'},positionDraft:{deadline:'2030-10-28T00:00:00+08:00',positions:[{name:'引导',capacity:10,location:'合成地点',campus:'鼓楼',start:'2030-10-29T08:30:00+08:00',end:'2030-10-29T10:30:00+08:00'}]}})},async()=>{throw Error('synthetic refresh failure');});
 });
 const drawer=page.getByRole('dialog',{name:'配置报名岗位'});
 await drawer.getByLabel('岗位名称').fill('已修改岗位');
 await drawer.getByRole('button',{name:'取消',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'放弃未保存的修改？'});
 await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'取消',exact:true}).click();
 let attempts=0;
 await page.route('**/events/synthetic-position-ui/configure-positions',async route=>{
  attempts++;
  await route.fulfill({status:attempts===1?409:200,contentType:'application/json',body:JSON.stringify(attempts===1?{ok:false,message:'活动已变化，请刷新后配置'}:{ok:true,result:{draft:true}})});
 });
 await drawer.getByRole('button',{name:'保存岗位安排'}).click();
 await expect(drawer.getByLabel('岗位名称')).toHaveValue('已修改岗位');
 await expect(drawer.getByRole('button',{name:'保存岗位安排'})).toBeEnabled();
 expect(attempts).toBe(1);
 await drawer.getByRole('button',{name:'保存岗位安排'}).click();
 await expect(drawer).toHaveCount(0);
 await expect(page.getByText('岗位已保存，请刷新活动列表',{exact:true})).toBeVisible();
 expect(attempts).toBe(2);
});
for(const refreshed of [false,true])test(`position editor ${refreshed?'continues after refresh':'warns without continuation when refresh returns false'}`,async({page})=>{
 await page.goto('/login');
 await page.evaluate(async refreshed=>{
  const {configureProjectPositions}=await import('/app/console/pages/activity-positions.js');
  window.positionCallbacks=[];
  configureProjectPositions({_id:'synthetic-callback',活动名称:'合成刷新回调',容量:2,状态:'草稿',positionToken:'synthetic-token',报名页配置:JSON.stringify({registrationLimit:5,bookingMode:'grouped',window:{start:'2030-10-29T08:00:00+08:00',end:'2030-10-30T18:00:00+08:00'},positionDraft:{deadline:'2030-10-28T00:00:00+08:00',positions:[{name:'引导',capacity:4,location:'合成地点',campus:'鼓楼',start:'2030-10-29T08:30:00+08:00',end:'2030-10-29T10:30:00+08:00'}]}})},async result=>{window.positionCallbacks.push({step:'saved',result});return refreshed;},{onContinue:async result=>{window.positionCallbacks.push({step:'continue',result});}});
 },refreshed);
 const result={draft:true,capacity:4,previousCapacity:2,capacityAdjusted:true,registrationLimit:5,previousRegistrationLimit:5,registrationLimitAdjusted:false};
 let writes=0;await page.route('**/events/synthetic-callback/configure-positions',route=>{writes++;return route.fulfill({json:{ok:true,result}});});
 const drawer=page.getByRole('dialog',{name:'配置报名岗位'}),overview=drawer.locator('.position-editor__overview');
 await expect(overview).toContainText('保存后活动容量将从 2 提升至 4 人');
 await expect(overview).not.toContainText('报名上限将从');
 await drawer.getByRole('button',{name:'复制岗位',exact:true}).click();
 await drawer.getByLabel('岗位名称').nth(1).fill('登记');
 await drawer.getByLabel('可报名人数').first().fill('100000');
 await expect(overview).toContainText('岗位总名额不能超过 100000 人');
 await drawer.getByRole('button',{name:'保存并继续通知',exact:true}).click();
 await expect(drawer.getByRole('alert')).toContainText('岗位总名额不能超过 100000 人');expect(writes).toBe(0);
 await drawer.getByRole('button',{name:'移除此岗位',exact:true}).nth(1).click();
 await drawer.getByLabel('可报名人数').fill('4');
 await drawer.getByRole('button',{name:'保存并继续通知',exact:true}).click();
 await expect(drawer).toHaveCount(0);expect(writes).toBe(1);
 await expect.poll(()=>page.evaluate(()=>window.positionCallbacks)).toEqual(refreshed?[{step:'saved',result},{step:'continue',result}]:[{step:'saved',result}]);
 if(!refreshed)await expect(page.getByText('岗位已保存，请刷新活动列表',{exact:true})).toBeVisible();
});
