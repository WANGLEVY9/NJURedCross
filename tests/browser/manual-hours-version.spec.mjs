import {test,expect} from '@playwright/test';

async function fixture(page,{restored=false}={}){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event={_id:'version-event',活动ID:'version-code',活动名称:'合成补录版本核对',报名日期:'2030-01-01',报名时段:'09:00-12:00',地点:'合成场地',岗位:'合成服务岗',工作内容:'合成服务',服务时长:3,培训时长:1,交通时长:1};
 const existing={id:'existing',name:'原有合成同学',studentId:'00000000',department:'合成学院',serviceHours:7,trainingHours:0,travelHours:0,decision:'pass'};
 const control={token:'v1',status:'review',canEdit:true,committed:false,readFailure:false},writes=[];
 const state=()=>({token:control.token,status:control.status,canEdit:control.canEdit,positions:[{id:event._id,name:'合成场地 · 上午',event}],rows:[existing,...(control.committed?[{...existing,id:'new',name:'待补录合成同学',studentId:'00000001',serviceHours:3}]:[])]});
 await page.route('**/workflow/events/version-event/final-hours',route=>route.fulfill(control.readFailure?{status:503,json:{ok:false,message:'合成读取失败'}}:{json:{ok:true,result:state()}}));
 await page.route('**/workflow/events/version-event/final-hours-participants',async route=>{
  const body=route.request().postDataJSON();writes.push(body);
  if(body.token!==control.token)return route.fulfill({status:409,json:{ok:false,code:'manual_hours_version_conflict',message:'时长表已更新，请刷新后重新补录'}});
  control.committed=true;await route.fulfill({json:{ok:true,result:{id:'new'}}});
 });
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async({event,initial,restored})=>{
  const {request,getSessionState}=await import('/app/core/api.js'),{activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  window.manualFreshReads=[];
  if(restored){
   const submitted={requestId:'11111111-2222-4333-8444-555555555555',eventId:event._id,name:'待补录合成同学',studentId:'00000001',department:'合成学院',email:'',details:{location:'合成场地',dates:'2030-01-01 09:00-12:00',work:'合成服务',serviceHours:3,trainingHours:1,travelHours:1,remark:''},reason:'合成纸质名单核验',evidenceChecked:true,token:'obsolete-token'};
   const user=getSessionState().user;sessionStorage.setItem(`manual-hours:${user.username||user.accountId}:/version-final.xlsx`,JSON.stringify({...submitted,submitted}));
  }
  const ui=activityFinalHoursWorkspace({initial,downloadUrl:'/version-final.xlsx',actionsNode:document.createElement('span'),load:async options=>{window.manualFreshReads.push(options?.fresh===true);return (await request('/api/volunteer/workflow/events/version-event/final-hours',options?.fresh?{fresh:true}:{})).result;},addParticipant:body=>request('/api/volunteer/workflow/events/version-event/final-hours-participants',{method:'POST',body})});
  document.getElementById('main').replaceChildren(ui.node);
 },{event,initial:state(),restored});
 await page.getByRole('button',{name:'手动添加人员',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'手动添加时长人员',exact:true});await expect(dialog).toBeVisible();
 if(!restored){await dialog.getByLabel(/^姓名/).fill('待补录合成同学');await dialog.getByLabel(/^学号/).fill('00000001');await dialog.getByLabel(/^院系/).fill('合成学院');await dialog.getByLabel(/^补录依据/).fill('合成纸质名单核验');await dialog.getByLabel('已核对实际服务及补录依据',{exact:true}).check();}
 return {control,writes,dialog};
}

test('version conflict retries with a fresh token and the same immutable request, preserving other people',async({page})=>{
 const {control,writes,dialog}=await fixture(page);control.token='v2';
 await dialog.getByRole('button',{name:'添加人员',exact:true}).click();await expect(dialog).toContainText('填写内容已保留');expect(writes).toHaveLength(1);
 control.readFailure=true;await dialog.getByRole('button',{name:'核对并重试',exact:true}).click();await expect(dialog.getByRole('button',{name:'核对并重试',exact:true})).toBeEnabled();expect(writes).toHaveLength(1);await expect(dialog.getByLabel(/^姓名/)).toHaveValue('待补录合成同学');
 control.readFailure=false;await dialog.getByRole('button',{name:'核对并重试',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual({...writes[0],token:'v2'});
 const fresh=await page.evaluate(()=>window.manualFreshReads);expect(fresh.slice(0,-1).every(Boolean)).toBe(true);
 await expect(page.getByRole('row').filter({hasText:'原有合成同学'})).toContainText('7');await expect(page.getByText('待补录合成同学',{exact:true})).toBeVisible();
});

test('a stored failed draft refreshes its obsolete token on reopening without losing the request identity',async({page})=>{
 const {writes,dialog}=await fixture(page,{restored:true});await expect(dialog.getByLabel(/^姓名/)).toBeDisabled();
 await dialog.getByRole('button',{name:'核对并重试',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({token:'v1',requestId:'11111111-2222-4333-8444-555555555555',studentId:'00000001',reason:'合成纸质名单核验'});
});

for(const kind of ['exported','revoked'])test(`retry stops when the latest sheet is ${kind}`,async({page})=>{
 const {control,writes,dialog}=await fixture(page);control.token='v2';await dialog.getByRole('button',{name:'添加人员',exact:true}).click();await expect(dialog).toContainText('填写内容已保留');
 if(kind==='exported')control.status='exported';else control.canEdit=false;
 await dialog.getByRole('button',{name:'核对并重试',exact:true}).click();await expect(dialog.getByRole('button',{name:'核对并重试',exact:true})).toBeEnabled();
 expect(writes).toHaveLength(1);expect(control.committed).toBe(false);await expect(dialog.getByLabel(/^姓名/)).toHaveValue('待补录合成同学');
});
