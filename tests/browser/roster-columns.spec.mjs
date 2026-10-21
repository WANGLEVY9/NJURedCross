import {test,expect} from '@playwright/test';

async function mount(page,kind){
 await page.evaluate(async kind=>{
  const {h}=await import('/app/core/dom.js');
  const event={_id:'columns-'+kind,活动ID:'columns-event',活动名称:'献血车志愿服务 · 报名名单预览',状态:'报名中',容量:10,岗位:'现场引导',报名日期:'2030-10-23',报名时段:'11:00-15:00',地点:'新街口中央',报名页配置:'{}',approvalAccess:{canManageRegistration:true}};
  const registrations=['林同学','陈同学','周同学'].map((姓名,index)=>({_id:'columns-row-'+index,活动ID:event.活动ID,账号ID:'columns-account-'+index,姓名,学号:'99999000'+index,部门:['生命中心','博爱中心','综事中心'][index],校区:'仙林校区',报名日期:'2030-10-23',报名时段:'11:00-15:00',岗位:'现场引导',报名状态:'待筛选',创建时间:'2030-10-01T00:00:00Z'}));
  let node;
  if(kind==='legacy'){
   const {legacyRosterPanel}=await import('/app/console/pages/activity-legacy-roster.js');
   node=legacyRosterPanel({event,events:[event],registrations,state:{},directory:[],compact:true,context:r=>({date:r.报名日期,slot:r.报名时段,session:r.活动ID,position:r.岗位,location:event.地点}),matches:()=>true});
  }else if(kind==='native'){
   const {activityRegistrationWorkspace}=await import('/app/console/pages/activity-registration-workspace.js');
   node=activityRegistrationWorkspace({event,data:{events:[event],registrations},decide:async()=>{},close:async()=>{},reload:async()=>({events:[event],registrations})}).node;
  }else{
   const {rosterPanel}=await import('/app/console/pages/activity-management.js');node=rosterPanel(event,registrations,{refresh:async()=>{},directory:[],events:[event]});
  }
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2'},h('h1',{text:'报名审核与通知'}),node));
 },kind);
}

test('all activity roster variants show sequential numbers, a department after student ID, and retain local column choices',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 for(const kind of ['legacy','native','historical']){
  await mount(page,kind);
  const table=page.locator('table').first();
  const headers=await table.locator('thead th').allTextContents();expect(headers[0]).toBe('序号');expect(headers.indexOf('部门')).toBe(headers.indexOf('学号')+1);
  await expect(table.locator('tbody [data-roster-column="序号"]')).toHaveText(['1','2','3']);
  await expect(table.locator('tbody [data-roster-column="部门"]').first()).toHaveText('生命中心');
  const picker=page.locator('.roster-column-picker');await picker.locator('summary').click();await picker.getByLabel('部门',{exact:true}).uncheck();
  await expect(table.locator('tbody [data-roster-column="部门"]').first()).toHaveJSProperty('hidden',true);
  if(kind==='native')await page.getByRole('button',{name:'批量操作',exact:true}).click();
  await expect(table.locator('tbody [data-roster-column="部门"]').first()).toHaveJSProperty('hidden',true);
  await mount(page,kind);await expect(page.locator('tbody [data-roster-column="部门"]').first()).toHaveJSProperty('hidden',true);
  await page.locator('.roster-column-picker summary').click();await page.getByRole('button',{name:'恢复默认栏目',exact:true}).click();await expect(page.locator('tbody [data-roster-column="部门"]').first()).toHaveJSProperty('hidden',false);
 }
 await mount(page,'legacy');await page.locator('.roster-column-picker summary').click();
 await page.locator('#main').evaluate(node=>{node.scrollTop=0;});
 await page.screenshot({path:info.outputPath('roster-columns-preview.png'),fullPage:true,animations:'disabled'});
 await page.locator('.roster-column-picker summary').click();await page.locator('#main').evaluate(node=>{node.scrollTop=0;});
 await page.screenshot({path:info.outputPath('roster-columns-closed.png'),fullPage:true,animations:'disabled'});
});
