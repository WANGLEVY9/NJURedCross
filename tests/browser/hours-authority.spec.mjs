import {test,expect} from './legacy-activity-fixture.mjs';

test('super-admin configuration lives in admin center and archived activity information stays editable',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/admin');
 await expect(page.getByRole('button',{name:'活动权限与负责人配置',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'历史活动审核人配置',exact:true})).toBeVisible();
 await page.goto('/console/events');
 await expect(page.getByRole('button',{name:'活动权限与负责人配置',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'历史活动审核人配置',exact:true})).toHaveCount(0);
 await page.evaluate(async()=>{
  const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  const editor=activityFinalHoursWorkspace({initial:{status:'exported',rows:[],canEdit:false},adminEditInformation:async()=>{window.__adminInfoOpened=true;}});
  document.body.replaceChildren(editor.node);
 });
 const edit=page.getByRole('button',{name:'活动信息修改',exact:true});await expect(edit).toBeEnabled();await edit.click();
 expect(await page.evaluate(()=>window.__adminInfoOpened)).toBe(true);
 let saved;
 await page.goto('/console/events');
 await page.route('**/workflow/events/synthetic-info/admin-information',route=>{
  if(route.request().method()==='PATCH'){saved=route.request().postDataJSON();return route.fulfill({json:{ok:true}});}
  return route.fulfill({json:{ok:true,token:'synthetic-token',values:{name:'合成原名称'}}});
 });
 await page.evaluate(async()=>{const {editAdminActivityInformation}=await import('/app/console/pages/activity-admin-information.js');await editAdminActivityInformation({_id:'synthetic-info'});});
 const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'活动信息修改',exact:true})});
 await dialog.getByLabel('活动名称').fill('合成更正名称');await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(saved.values.name).toBe('合成更正名称');expect(saved.token).toBe('synthetic-token');
});

test('hours workspace preserves super-admin controls and respects scoped denials',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event={_id:'synthetic-hours-access',活动ID:'E',活动名称:'合成权限复核',状态:'进行中',报名页配置:'{}',hoursAccess:{canReview:false},hoursSubmission:{phase:'submitted'}};
 const entry={_id:'ledger',活动ID:'E',报名行ID:'registration',状态:'待批准',姓名:'合成同学',学号:'999990001',核对人:'another-checker',服务时长:2};
 await page.route('**/workflow/events/synthetic-hours-access/hours-review',route=>route.fulfill({json:{events:[event],registrations:[],entries:[entry],rows:[{姓名:entry.姓名,学号:entry.学号,服务时长:2}],groups:[{ids:['ledger']}]}}));
 await page.goto('/console/events');
 for(const superAdmin of [true,false]){
  await page.evaluate(async({event,superAdmin})=>{
   const {hoursWorkspace}=await import('/app/console/pages/hours-workspace.js');
   document.body.replaceChildren(hoursWorkspace({event,actor:'synthetic-super',superAdmin,state:{},onSaved:async()=>{}}));
  },{event,superAdmin});
  const workspace=page.getByRole('region',{name:'时长审核与导出',exact:true});
  await expect(workspace).toContainText('合成同学');
  if(superAdmin){
   await expect(workspace.getByRole('button',{name:'导出 Excel',exact:true})).toBeVisible();
   await expect(workspace.getByRole('button',{name:'编辑信息',exact:true}).first()).toBeVisible();
  }else{
   await expect(workspace.getByRole('button',{name:'导出 Excel',exact:true})).toBeHidden();
   await expect(workspace.getByRole('button',{name:'编辑信息',exact:true})).toHaveCount(0);
  }
 }
});
