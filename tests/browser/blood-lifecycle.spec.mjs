import {test,expect} from '@playwright/test';

test('blood management keeps a single phone viewport and every day through Sunday reachable',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const {events}=await(await page.request.get('/api/volunteer/workflow/catalog')).json();const event=events.find(e=>JSON.parse(e['报名页配置']||'{}').source?.kind==='generated_blood');
 for(const task of ['registration','checkins','hours']){
  await page.goto(`/console/events?event=${event._id}&scheduleTask=${task}`);
  const pane=page.getByRole('region',{name:'活动操作工作区'});
  if(task==='hours')await pane.getByRole('button',{name:'切换为排班看板',exact:true}).click();
  const scroll=pane.locator('.blood-registration-board__grid').first();await expect(scroll).toBeVisible();await scroll.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  const outer=await scroll.boundingBox();expect(outer.width).toBeLessThanOrEqual(page.viewportSize().width);
  await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect.poll(()=>scroll.evaluate(el=>el.scrollWidth-el.clientWidth-el.scrollLeft)).toBeLessThan(2);
  const sunday=scroll.locator('.blood-card-grid__heading').last(),box=await sunday.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(outer.x+outer.width+2);
  await page.screenshot({path:info.outputPath(`blood-${task}-sunday.png`),fullPage:true,animations:'disabled'});
 }
});

test('my registrations separates active blood follow-up from archived history without embedding the calendar',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{participant:{realName:'合成同学',campus:'仙林'},ledger:[],profile:null,registrations:[
  {code:'LATE-PHOTO',eventId:'late',eventName:'待补签到的献血车',date:'2026-10-12',slot:'上午 11~15点',blood:true,status:'已确认',result:'报名成功',eventStatus:'已结束',attendanceOpen:true,attendanceSubmitted:false},
  {code:'ARCHIVED-WEEK',eventId:'archive',eventName:'已归档的献血车',date:'2026-10-05',slot:'上午 11~15点',blood:true,status:'已签到',result:'报名成功',eventStatus:'已结束',attendanceOpen:false,weekArchived:true},
 ]}}));
 await page.goto('/workflow-events?view=records');
 await expect(page.getByRole('heading',{name:'待补签到的献血车',exact:true})).toBeVisible();await expect(page.getByText('待补签到',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'已归档的献血车',exact:true})).toHaveCount(0);await expect(page.locator('.blood-calendar')).toHaveCount(0);
 await page.getByText('现场签到',{exact:true}).click();await expect(page.getByRole('button',{name:'提交照片签到',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'历史报名',exact:true}).click();await expect(page.getByRole('heading',{name:'已归档的献血车',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'待补签到的献血车',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'提交照片签到',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'已归档的献血车',exact:true})).toBeVisible();
});


test('manager can attach a missing blood attendance photo without automatically approving it',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();let uploads=0,approvals=0;
 await page.route('**/api/volunteer/workflow/events/proof-event/members',r=>r.fulfill({json:{people:[]}}));
 await page.route('**/api/volunteer/workflow/registrations/proof-reg/attendance-detail',r=>r.fulfill({json:{studentId:'999990001',hasPhoto:false,legacy:[],warnings:[]}}));
 await page.route('**/api/volunteer/workflow/registrations/proof-reg/attendance-supplement',r=>{uploads++;expect(r.request().headers()['content-type']).toMatch(/^image\//);return r.fulfill({json:{ok:true,result:{submitted:true}}});});
 await page.route('**/api/volunteer/workflow/events/proof-event/attendance-batch',r=>{approvals++;return r.fulfill({json:{results:[]}});});
 await page.evaluate(async()=>{
  const {serviceWorkspace}=await import('/app/console/pages/activity-service.js');
  const event={_id:'proof-event',活动ID:'proof-event',活动名称:'合成补签活动',状态:'已结束',报名日期:'2026-10-12',报名时段:'上午 11~15点',地点:'新街口中央',服务时长:4,报名页配置:JSON.stringify({source:{kind:'generated_blood'},blood:{start:'2026-10-12T11:00:00+08:00',end:'2026-10-12T15:00:00+08:00'}})};
  const registration={_id:'proof-reg',活动ID:'proof-event',姓名:'合成补签同学',学号:'999990001',报名状态:'已确认',报名日期:'2026-10-12',报名时段:'上午 11~15点'};
  document.getElementById('main').replaceChildren(serviceWorkspace({event,events:[event],registrations:[registration],ledger:[],kind:'checkins',actor:'synthetic-super',superAdmin:true,state:{},onSaved:async()=>{}}));
 });
 await page.getByRole('button',{name:/^(查看签到(记录|详情)|核实到场与初审)$/}).first().click();
 const dialog=page.getByRole('dialog',{name:'合成补签同学 · 签到详情',exact:true});await expect(dialog.getByRole('button',{name:'上传签到凭证',exact:true})).toBeVisible();
 const bytes=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1];});
 await dialog.getByLabel('签到凭证照片',{exact:true}).setInputFiles({name:'synthetic-proof.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});
 await dialog.getByRole('button',{name:'上传签到凭证',exact:true}).click();await expect(dialog).toHaveCount(0);expect(uploads).toBe(1);expect(approvals).toBe(0);
});


test('missing online checkin allows individual initial review only after explicit on-site attestation',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();let saved;
 await page.route('**/events/attest-event/members',r=>r.fulfill({json:{people:[]}}));
 await page.route('**/registrations/attest-reg/attendance-detail',r=>r.fulfill({json:{studentId:'999990009',hasPhoto:false,legacy:[],warnings:[]}}));
 await page.route('**/events/attest-event/attendance-batch',r=>{saved=r.request().postDataJSON();return r.fulfill({json:{results:[{id:'attest-reg',ok:true}],succeeded:1,failed:0}});});
 await page.evaluate(async()=>{
  const {serviceWorkspace}=await import('/app/console/pages/activity-service.js');
  const event={_id:'attest-event',活动ID:'attest-event',活动名称:'合成核实活动',状态:'已结束',报名日期:'2026-10-12',报名时段:'上午 11~15点',地点:'新街口中央',服务时长:4,培训时长:0,交通时长:0,工作内容:'现场志愿服务',报名页配置:JSON.stringify({source:{kind:'generated_blood'},blood:{start:'2026-10-12T11:00:00+08:00',end:'2026-10-12T15:00:00+08:00'}})};
  const registration={_id:'attest-reg',活动ID:event.活动ID,姓名:'模拟无签到同学',学号:'999990009',报名状态:'已确认',报名日期:'2026-10-12',报名时段:'上午 11~15点'};
  document.getElementById('main').replaceChildren(serviceWorkspace({event,events:[event],registrations:[registration],ledger:[],kind:'checkins',actor:'synthetic-organizer',superAdmin:false,state:{},onSaved:async()=>{}}));
 });
 await page.getByRole('button',{name:'核实到场与初审',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'模拟无签到同学 · 签到详情',exact:true});
 const submit=dialog.getByRole('button',{name:'确认签到并录入时长',exact:true});await expect(submit).toBeDisabled();
 await dialog.locator('label.check').filter({hasText:'本人已核实该同学实际到场，确认初审信息真实'}).click();
 await expect(dialog.getByRole('checkbox',{name:'本人已核实该同学实际到场，确认初审信息真实',exact:true})).toBeChecked();
 await submit.click();expect(saved).toBeUndefined();
 await dialog.getByRole('textbox',{name:'到场核实说明 必填',exact:true}).fill('已与当天值班医生核对实际到场服务');
 const padding=await dialog.locator('.blood-attendance-inspector').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft));expect(padding).toBeGreaterThanOrEqual(16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.screenshot({path:info.outputPath('attendance-attestation.png'),fullPage:true});
 await submit.click();await expect(dialog).toHaveCount(0);
 expect(saved.items[0].attendanceConfirmation).toEqual({confirmed:true,reason:'已与当天值班医生核对实际到场服务'});
});
