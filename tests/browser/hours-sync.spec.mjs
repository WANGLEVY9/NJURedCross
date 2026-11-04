import {test,expect} from '@playwright/test';

test('member sees confirmed components and weekly progress without adding pending hours to official totals',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,platformHours:{totalHours:30,academicYearHours:10},registrations:[{code:'synthetic-code',eventName:'合成献血周',status:'已确认',date:'2030-01-01',location:'合成场地',hours:{code:'profile_pending',label:'已入账 · 待同步个人主页',tone:'info',summarySynced:true,profileSynced:false,hours:{serviceHours:3,trainingHours:1,travelHours:1,totalHours:5}}}]}}));
 await page.goto('/me?view=records');
 await expect(page.locator('.member-hours__metrics strong')).toHaveText(['30','10']);await expect(page.locator('.member-hours__record')).toContainText('志愿时长 3 小时（培训 1 · 交通 1 另列）');await expect(page.locator('.member-hours__record')).toContainText('已入账 · 待同步个人主页');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.locator('.member-hours').screenshot({path:info.outputPath('member-hours-sync.png'),animations:'disabled'});
});

test('super sync dialog retries summaries and delegates all profile writes to table automation',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});const writes=[];
 await page.route('**/api/volunteer/workflow/hours-sync',async route=>{
  if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,result:{queued:true}}});}
  await route.fulfill({json:{ok:true,result:{nextProfileSyncAt:'2026-11-08T22:00:00Z',lastRun:{at:'2026-11-04T01:00:00Z',failures:[]},receipts:[{key:'FINAL:synthetic',source:{name:'合成甲',studentId:'000001',activityName:'合成献血周',totalHours:5},legacyStatus:'done',websiteStatus:'done',profileStatus:'pending'}]}}});
 });
 await page.goto('/console/admin');await page.evaluate(async()=>{await(await import('/app/console/pages/hours-sync.js')).openHoursSync();});
 const dialog=page.getByRole('dialog',{name:'时长入账与同步',exact:true});await expect(dialog).toContainText('已写入两张汇总表 1 条');await expect(dialog).toContainText('不直接写入');
 await dialog.getByRole('button',{name:'重试汇总表写入',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({});
 await expect(dialog.getByRole('button',{name:'立即同步个人主页',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('admin-hours-sync.png'),animations:'disabled'});
});

test('empty sync workspace has useful content and a readable desktop width',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.route('**/api/volunteer/workflow/hours-sync',route=>route.fulfill({json:{ok:true,result:{receipts:[],lastRun:null}}}));
 await page.goto('/console/admin');await page.evaluate(async()=>{await(await import('/app/console/pages/hours-sync.js')).openHoursSync();});
 const dialog=page.getByRole('dialog',{name:'时长入账与同步',exact:true});await expect(dialog).toContainText('暂无核定时长记录');await expect(dialog).not.toContainText('共 0 条');
 const box=await dialog.boundingBox();if(page.viewportSize().width>720)expect(box.width).toBeGreaterThan(800);
 expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);await dialog.screenshot({path:info.outputPath('empty-sync.png')});
});

test('ended activity keeps the final table and exposes the same posting progress as the member view',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 await page.evaluate(async()=>{
  const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  const row={id:'synthetic',name:'合成甲',studentId:'000001',department:'合成学院',location:'合成场地',dates:'2030-01-01 上午',work:'合成服务',decision:'pass',serviceHours:3,trainingHours:1,travelHours:1};
  const initial={status:'exported',rows:[row],canEdit:false,mailStatus:'sent',hoursProgress:[{...row,code:'profile_pending',label:'已入账 · 待同步个人主页',summarySynced:true,profileSynced:false,hours:{totalHours:5}}]};
  const ui=activityFinalHoursWorkspace({initial,downloadUrl:'/synthetic-unused.xlsx',actionsNode:document.createElement('span'),loadInformation:async()=>({})});document.getElementById('main').replaceChildren(ui.node);
 });
 await expect(page.getByText(/已写入两张汇总表 1\/1 条/)).toBeVisible();await page.getByText('查看人员入账进度',{exact:true}).click();await expect(page.getByText('合成甲 · 000001 · 已入账 · 待同步个人主页',{exact:true})).toBeVisible();await expect(page.getByRole('caption')).toHaveText('分工时长表');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const kind of ['revision'])test(`super ${kind} review requires a reason and explicit check before submitting`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let confirmed=false;const writes=[];
 const row={key:'FINAL:synthetic',source:{name:'合成甲',studentId:'000001',activityName:'合成献血周',serviceHours:3,totalHours:5},legacyStatus:'done',websiteStatus:'done',profileStatus:kind==='year-base'?'failed':'done',error:kind==='year-base'?'原学年列已有历史时长':''};
 await page.route('**/api/volunteer/workflow/hours-sync',route=>route.fulfill({json:{ok:true,result:{receipts:confirmed?[]:[row],lastRun:{failures:kind==='revision'&&!confirmed?[{key:row.key,step:'revision',message:'底表明细变化，等待超管核对修订'}]:[]}}}}));
 await page.route(`**/api/volunteer/workflow/hours-sync/${kind}**`,async route=>{
  if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());confirmed=true;return route.fulfill({json:{ok:true,result:{accepted:true}}});}
  const common={key:row.key,name:'合成甲',studentId:'000001',token:'bound-snapshot'};
  await route.fulfill({json:{ok:true,result:kind==='revision'?{...common,before:{serviceHours:3,trainingHours:1,travelHours:1},after:{serviceHours:5,trainingHours:1,travelHours:1},previousCreditedHours:3,legacyHours:13,delta:2}:{...common,yearHours:10,siteHours:3,records:[{name:'合成献血周',dates:'2026-10-31',serviceHours:3}]}}});
 });
 await page.goto('/console/admin');await page.evaluate(async()=>{await(await import('/app/console/pages/hours-sync.js')).openHoursSync();});
 const main=page.getByRole('dialog',{name:'时长入账与同步',exact:true});await main.getByRole('button',{name:kind==='revision'?'核对底表修订':'核对学年基数',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:kind==='revision'?'核对底表时长修订':'核对学年历史基数',exact:true});
 await dialog.getByRole('button',{name:'确认并同步',exact:true}).click();expect(writes.length).toBe(0);
 await dialog.getByLabel(/^核对原因/).fill('超管核对纸质记录及原表历史数据');if(kind==='year-base')await dialog.getByLabel(/^原学年值中已包含的本站服务时长/).fill('3');
 await dialog.getByRole('button',{name:'确认并同步',exact:true}).click();await expect(dialog).toContainText('请先勾选');expect(writes.length).toBe(0);
 await dialog.getByRole('checkbox',{name:'已核对原表和本次修订',exact:true}).check();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await dialog.screenshot({path:info.outputPath(`${kind}-confirmation.png`),animations:'disabled'});
 await dialog.getByRole('button',{name:'确认并同步',exact:true}).click();await expect(dialog).toHaveCount(0);expect(writes).toEqual([{key:row.key,token:'bound-snapshot',confirmed:true,reason:'超管核对纸质记录及原表历史数据',...(kind==='year-base'?{includedHours:'3'}:{})}]);
});
