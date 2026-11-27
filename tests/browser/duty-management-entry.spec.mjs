import {test,expect} from '@playwright/test';

test('duty exposes information editing and registration download outside the more menu',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 let values={name:'省红会组宣部值班',description:'合成介绍',notice:'合成通知',qqGroup:'123456789',invitation:'',notes:''};
 await page.route('**/events/duty-entry/admin-information',async route=>{
  if(route.request().method()==='PATCH')values=route.request().postDataJSON().values;
  await route.fulfill({json:{ok:true,token:'synthetic-version',values}});
 });
 await page.route('**/events/duty-entry/schedule-total',route=>route.fulfill({json:{ok:true,weeks:['2030-11-04','2030-11-11']}}));
 await page.route('**/events/duty-entry/registration-export?*',route=>route.fulfill({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:'synthetic-workbook'}));
 await page.evaluate(async()=>{
  const {h}=await import('/app/core/dom.js');
  const {legacyActivityWorkspace}=await import('/app/console/pages/legacy-activity-workspace.js');
  const event={_id:'duty-entry',活动ID:'DUTY-2030-11-04-09',活动名称:'省红会组宣部值班',状态:'报名中',报名日期:'2030-11-04',报名时段:'09:00-12:00',地点:'合成地点',容量:'2',负责人账号ID:'synthetic-super',approvalAccess:{canManageRegistration:true},报名页配置:JSON.stringify({recurringDuty:true,bookingMode:'grouped',special:{v:1,type:'schedule',rootId:'PROVINCE-PUBLICITY-DUTY',week:'2030-11-04'},ordinary:{groupId:'DUTY-2030-11-04',start:'2030-11-04T09:00:00+08:00',end:'2030-11-04T12:00:00+08:00'}})};
  const ui=legacyActivityWorkspace({event,events:[event],data:{events:[event],registrations:[],ledger:[],checkins:[]}});
  document.getElementById('main').replaceChildren(h('div',{class:'activity-v2'},ui.node));
 });
 const toolbar=page.locator('[aria-label="排班并行工作"]');
 const edit=toolbar.getByRole('button',{name:'活动信息修改',exact:true});
 await expect(edit).toBeVisible();
 expect(await edit.evaluate(el=>Boolean(el.closest('details')))).toBe(false);
 await edit.click();
 const dialog=page.getByRole('dialog',{name:'活动信息修改',exact:true});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('textbox',{name:'活动介绍',exact:true}).fill('合成值班介绍更新');
 await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(values.description).toBe('合成值班介绍更新');
 await toolbar.getByRole('button',{name:'下载报名信息表',exact:true}).click();
 const exportDialog=page.getByRole('dialog',{name:'选择导出周次',exact:true});
 await expect(exportDialog.getByRole('checkbox',{name:'2030-11-04 起的一周'})).toBeChecked();
 await exportDialog.getByRole('checkbox',{name:'2030-11-11 起的一周'}).check();
 const responsePromise=page.waitForResponse(r=>r.url().includes('/registration-export?'));
 await exportDialog.getByRole('button',{name:'下载所选周次',exact:true}).click();
 const response=await responsePromise;
 expect(new URL(response.url()).searchParams.get('weeks')).toBe('2030-11-04,2030-11-11');
 expect(response.request().method()).toBe('GET');expect(response.status()).toBe(200);
});

test('administrator can save explicit duty weeks without changing the enabled switch',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 let saved;
 await page.route('**/api/volunteer/workflow/recurring-duty',async route=>{
  if(route.request().method()==='POST')saved=route.request().postDataJSON();
  await route.fulfill({json:{ok:true,result:{enabled:true,mode:'rolling',weeks:[],currentWeek:'2030-12-02',...saved}}});
 });
 await page.evaluate(async()=>{const {openRecurringDuty}=await import('/app/console/pages/special-registry-enable.js');await openRecurringDuty();});
 const dialog=page.getByRole('dialog',{name:'省红会组宣部值班',exact:true});
 await dialog.getByRole('combobox',{name:'开放周次方式'}).click();
 await page.getByRole('option',{name:'手动选择开放周次',exact:true}).click();
 await expect(dialog.getByRole('checkbox',{name:'2030-12-02 起的一周'})).toBeChecked();
 await dialog.getByRole('checkbox',{name:'2030-12-09 起的一周'}).uncheck();
 await dialog.getByRole('checkbox',{name:'2030-12-16 起的一周'}).uncheck();
 await dialog.getByRole('checkbox',{name:'2030-12-30 起的一周'}).check();
 await dialog.getByRole('button',{name:'保存开放周次',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(saved).toEqual({enabled:true,mode:'manual',weeks:['2030-12-02','2030-12-30']});
});

