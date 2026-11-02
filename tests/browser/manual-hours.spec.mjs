import {test,expect} from '@playwright/test';

for(const kind of ['blood','final'])test(`${kind} hours manual addition preserves the draft and request identity on an uncertain response`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event={_id:'manual-event',活动ID:'manual-code',活动名称:'合成补录活动',状态:'进行中',地点:'合成场地',报名日期:'2026-10-12',报名时段:'上午',岗位:'服务岗',工作内容:'合成服务',服务时长:2,培训时长:1,交通时长:0,报名页配置:JSON.stringify({blood:{week:46}})};
 let committed=false;const submitted=[];
 await page.route('**/workflow/events/manual-event/hours-review*',route=>route.fulfill({json:{events:[event],registrations:committed?[{_id:'manual-reg',报名日期:'2026-10-12',报名时段:'上午'}]:[],entries:committed?[{_id:'manual-ledger',报名行ID:'manual-reg',活动ID:'manual-code',状态:'待批准',核对人:'manual-admin',姓名:'合成补录',学号:'00123456',服务时长:2}]:[],rows:committed?[{姓名:'合成补录',学号:'00123456',院系:'合成学院',服务时长:2}]:[],groups:committed?[{ids:['manual-ledger']}]:[]}}));
 await page.route(`**/workflow/events/manual-event/${kind==='blood'?'hours-participants':'final-hours-participants'}`,async route=>{
  submitted.push(route.request().postDataJSON());committed=true;
  await route.fulfill(submitted.length===1?{status:503,json:{ok:false,message:'合成响应丢失'}}:{json:{ok:true,result:{id:'manual-reg'}}});
 });
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async({event,kind})=>{
  const main=document.getElementById('main');
  if(kind==='blood'){
   const {hoursWorkspace}=await import('/app/console/pages/hours-workspace.js');
   main.replaceChildren(hoursWorkspace({event,actor:'synthetic-super',superAdmin:true,state:{},onSaved:async()=>{}}));
  }else{
   const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
   const {request}=await import('/app/core/api.js');
   const state={name:'合成补录活动',token:'first-token',status:'review',canEdit:true,rows:[],positions:[{id:event._id,name:'合成场地 · 上午',event}]};
   const editor=activityFinalHoursWorkspace({initial:state,downloadUrl:'/synthetic-manual-final.xlsx',load:async()=>({...state,rows:[{id:'manual-reg',name:'合成补录',studentId:'00123456',department:'合成学院',decision:'pass',serviceHours:2,trainingHours:1,travelHours:0}]}),addParticipant:body=>request('/api/volunteer/workflow/events/manual-event/final-hours-participants',{method:'POST',body})});main.replaceChildren(editor.node);
  }
 },{event,kind});
 await page.getByRole('button',{name:'手动添加人员',exact:true}).click();
 const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'手动添加时长人员',exact:true})});
 await dialog.getByLabel(/^姓名/).fill('合成补录');await dialog.getByLabel(/^学号/).fill('00123456');await dialog.getByLabel(/^院系/).fill('合成学院');await dialog.getByLabel(/^补录依据/).fill('合成现场核验名单');
 await dialog.getByLabel('已核对实际服务及补录依据',{exact:true}).check();
 await page.screenshot({path:info.outputPath(`${kind}-manual-hours.png`),animations:'disabled'});
 await dialog.getByRole('button',{name:'添加人员',exact:true}).click();await expect(dialog).toContainText('填写内容已保留');
 await expect(dialog.getByLabel(/^姓名/)).toBeDisabled();
 await dialog.getByRole('button',{name:'核对并重试',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(submitted).toHaveLength(2);expect(submitted[1]).toEqual(submitted[0]);expect(submitted[0].studentId).toBe('00123456');expect(submitted[0].evidenceChecked).toBe(true);
 if(kind==='final')expect(submitted[0].token).toBe('first-token');
 await expect(page.locator(':is(td,strong):visible').filter({hasText:/^合成补录$/}).first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
