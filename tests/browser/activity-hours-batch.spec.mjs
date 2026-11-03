import {test,expect} from '@playwright/test';

async function mount(page,kind,allowed=true){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async({kind,allowed})=>{
  window.batchWrites=[];window.batchFail=false;
  const names=['合成甲','合成乙','合成丙'],rows=names.map((name,index)=>({id:`reg-${index}`,name,studentId:`0000000${index}`,department:'合成学院',location:'合成场地',dates:'2030-01-01 上午',work:'合成服务',serviceHours:index+2,trainingHours:1,travelHours:0,decision:'pass',reason:'',evidenceChecked:false}));
  const state={token:'v1',canEdit:allowed,status:'review',rows,positions:[]};let version=1;
  const save=async body=>{window.batchWrites.push(structuredClone(body));if(window.batchFail)throw Object.assign(Error('合成版本冲突'),{status:409});for(const item of body.items){const row=rows.find(row=>row.id===item.id);Object.assign(row,item);}state.token=`v${++version}`;};
  let ui;
  if(kind==='initial'){
   const event={_id:'job',活动ID:'job-code',活动名称:'合成活动',岗位:'合成岗位',状态:'进行中',服务时长:4,培训时长:1,交通时长:0,报名页配置:'{}'};
   const other={...event,_id:'peer',活动ID:'peer-code',岗位:'另一岗位',服务时长:9};
   const data={events:[event,other],registrations:[...rows.map(row=>({_id:row.id,活动ID:'job-code',姓名:row.name,学号:row.studentId,报名状态:'已确认'})),{_id:'peer-reg',活动ID:'peer-code',姓名:'合成甲',学号:'00000000',报名状态:'已确认'}],ledger:[],checkins:[]};
   const entries=[];
   const review=()=>({token:state.token,canRecord:allowed,status:'draft',entries:structuredClone(entries)});
   ui=(await import('/app/console/pages/activity-running-workspace.js')).activityRunningWorkspace({event,data,actionsNode:document.createElement('span'),reviewState:review(),loadReview:async()=>review(),reload:async()=>structuredClone(data),saveReview:async body=>{await save(body);for(const item of body.items){const index=entries.findIndex(row=>row.id===item.id);if(index<0)entries.push(item);else entries[index]=item;}},loadInformation:async()=>({})});
  }else ui=(await import('/app/console/pages/activity-final-hours-workspace.js')).activityFinalHoursWorkspace({initial:structuredClone(state),actionsNode:document.createElement('span'),load:async()=>structuredClone(state),save,loadInformation:async()=>({})});
  const {h}=await import('/app/core/dom.js');document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2'},ui.node));
 },{kind,allowed});
}

for(const kind of ['initial','final']){
 test(`${kind} bulk review saves selected records, requires rejection reason and keeps the layout contained`,async({page},info)=>{
  await mount(page,kind);
  await expect(page.getByRole('button',{name:'批量审核',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'选择 合成甲 00000000',exact:true}).check();
  await page.getByRole('button',{name:'批量审核',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:kind==='initial'?'批量负责人初审':'批量时长终审',exact:true});
  await dialog.getByRole('button',{name:'确认审核',exact:true}).click();await expect(dialog).toHaveCount(0);
  let writes=await page.evaluate(()=>window.batchWrites);expect(writes).toHaveLength(1);expect(writes[0].items).toHaveLength(1);expect(writes[0].items[0]).toMatchObject({id:'reg-0',decision:'pass',reason:''});
  if(kind==='initial')expect(writes[0].items[0]).toMatchObject({serviceHours:4,trainingHours:1,travelHours:0,evidenceChecked:false});
  else expect(writes[0].items[0]).toEqual({id:'reg-0',decision:'pass',reason:''});
  await page.getByRole('button',{name:'全选当前名单',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:/^选择/}).nth(2)).toBeChecked();
  await page.screenshot({path:info.outputPath(`${kind}-bulk-roster.png`),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'批量审核',exact:true}).click();dialog=page.getByRole('dialog',{name:kind==='initial'?'批量负责人初审':'批量时长终审',exact:true});
  await dialog.getByRole('combobox',{name:'审核结果',exact:true}).click();await page.getByRole('listbox').getByRole('option',{name:'不通过',exact:true}).click();
  await dialog.getByRole('button',{name:'确认审核',exact:true}).click();expect(await page.evaluate(()=>window.batchWrites.length)).toBe(1);
  await dialog.getByLabel(/^不通过原因/).fill('纸质名单核对未参加');
  await dialog.getByRole('button',{name:'确认审核',exact:true}).click();await expect(dialog).toHaveCount(0);
  writes=await page.evaluate(()=>window.batchWrites);expect(writes[1].token).toBe('v2');expect(writes[1].items.map(row=>row.id)).toEqual(['reg-0','reg-1','reg-2']);expect(writes[1].items.every(row=>row.decision==='fail'&&row.reason==='纸质名单核对未参加')).toBe(true);
  if(kind==='initial'){
   await page.getByRole('button',{name:'全选当前名单',exact:true}).click();await page.getByRole('tab',{name:'另一岗位',exact:true}).click();
   await expect(page.getByRole('button',{name:'批量审核',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox',{name:'选择 合成甲 00000000',exact:true})).not.toBeChecked();
  }
 });
 test(`${kind} bulk review preserves uncertain input and refreshes before another write`,async({page})=>{
  await mount(page,kind);await page.getByRole('button',{name:'全选当前名单',exact:true}).click();await page.getByRole('button',{name:'批量审核',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:kind==='initial'?'批量负责人初审':'批量时长终审',exact:true});await page.evaluate(()=>{window.batchFail=true;});
  await dialog.getByRole('button',{name:'确认审核',exact:true}).click();await expect(dialog.getByRole('button',{name:'确认审核',exact:true})).toBeDisabled();await expect(dialog).toContainText('保存结果待核对');
  await dialog.getByRole('button',{name:'刷新名单后重新选择',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'批量审核',exact:true})).toBeDisabled();expect(await page.evaluate(()=>window.batchWrites.length)).toBe(1);
 });
 test(`${kind} read-only view has no batch write controls`,async({page})=>{
  await mount(page,kind,false);await expect(page.getByRole('button',{name:'批量审核',exact:true})).toBeHidden();await expect(page.getByRole('checkbox',{name:/^选择/})).toHaveCount(0);
 });
}


