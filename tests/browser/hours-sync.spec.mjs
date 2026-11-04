import {test,expect} from '@playwright/test';

test('member sees confirmed components and weekly progress without adding pending hours to official totals',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,platformHours:{totalHours:30,academicYearHours:10},registrations:[{code:'synthetic-code',eventName:'合成献血周',status:'已确认',date:'2030-01-01',location:'合成场地',hours:{code:'profile_pending',label:'已入账 · 待同步个人主页',tone:'info',summarySynced:true,profileSynced:false,hours:{serviceHours:3,trainingHours:1,travelHours:1,totalHours:5}}}]}}));
 await page.goto('/me?view=records');
 await expect(page.locator('.member-hours__metrics strong')).toHaveText(['30','10']);await expect(page.locator('.member-hours__record')).toContainText('核定 5 小时（服务 3 · 培训 1 · 交通 1）');await expect(page.locator('.member-hours__record')).toContainText('已入账 · 待同步个人主页');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.locator('.member-hours').screenshot({path:info.outputPath('member-hours-sync.png'),animations:'disabled'});
});

test('super sync dialog separates retry from confirmed immediate profile synchronization and fits the viewport',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});const writes=[];
 await page.route('**/api/volunteer/workflow/hours-sync',async route=>{
  if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,result:{queued:true}}});}
  await route.fulfill({json:{ok:true,result:{nextProfileSyncAt:'2026-11-08T22:00:00Z',lastRun:{at:'2026-11-04T01:00:00Z',failures:[]},receipts:[{key:'FINAL:synthetic',source:{name:'合成甲',studentId:'000001',activityName:'合成献血周',totalHours:5},legacyStatus:'done',websiteStatus:'done',profileStatus:'pending'}]}}});
 });
 await page.goto('/console/admin');await page.evaluate(async()=>{await(await import('/app/console/pages/hours-sync.js')).openHoursSync();});
 const dialog=page.getByRole('dialog',{name:'时长入账与同步',exact:true});await expect(dialog).toContainText('已入汇总表 · 待同步个人主页');
 await dialog.getByRole('button',{name:'重试汇总与到期同步',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({});
 await dialog.getByRole('button',{name:'立即同步个人主页',exact:true}).click();const confirm=page.getByRole('dialog',{name:'立即同步个人主页？',exact:true});await expect(confirm).toBeVisible();expect(writes.length).toBe(1);
 await confirm.getByRole('button',{name:'立即同步',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toEqual({profiles:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('admin-hours-sync.png'),animations:'disabled'});
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
