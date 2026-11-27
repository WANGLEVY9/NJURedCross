import {test,expect} from '@playwright/test';

async function mount(page,access={}){
  await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
  await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
  await page.evaluate(async access=>{
    const event={_id:'hours-one',活动ID:'hours-one',活动名称:'合成时长活动',岗位:'鼓楼服务岗',负责人账号ID:'synthetic-super',状态:'进行中',报名日期:'2030-01-01',报名时段:'09:00-12:00',容量:10,服务时长:'4',培训时长:'1',交通时长:'0.5',报名页配置:'{}',approvalAccess:{canManageRegistration:true,canReopenRegistration:access.canReopenRegistration===true,...access}};
    const registrations=[{_id:'hours-row',活动ID:'hours-one',姓名:'合成时长同学',学号:'999990001',报名日期:'2030-01-01',报名时段:'09:00-12:00',报名状态:'已确认'}];
    const data={events:[event],registrations,ledger:[],checkins:[]},review={entries:[],canRecord:true,token:'synthetic-token'};
    const {h}=await import('/app/core/dom.js');
    const actionsNode=h('div',{class:'activity-v2-more__host'},h('details',{class:'activity-v2-more'},h('summary',{text:'更多操作'}),h('div',{class:'activity-v2-more__menu'})));
    const options={event,data,actionsNode,reviewState:review,reload:async()=>structuredClone(data),loadReview:async()=>structuredClone(review),loadInformation:async()=>({}),
      saveReview:async()=>({saved:true}),importFile:async()=>({items:[]}),previewReview:async()=>({items:[],rows:[],token:'synthetic-preview'}),submitReview:async()=>({submitted:true}),
      loadAttendance:async()=>({name:'合成时长同学'}),decideLeave:async()=>{},reopen:async()=>{}};
    const ui=(await import('/app/console/pages/activity-running-workspace.js')).activityRunningWorkspace(options);
    document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2',data:{actions:'true'}},ui.node,actionsNode));
  },access);
}

test('running page shows configured travel, training and service hours and prefills the first review',async({page},info)=>{
  await mount(page);
  const row=page.getByRole('row').filter({hasText:'合成时长同学'});
  await expect(row).toContainText('服务 4 · 培训 1 · 交通 0.5');
  await page.getByRole('button',{name:'上传及预览时长表',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'上传与预览时长表'});
  const nameCell=dialog.locator('tbody tr').first().locator('td').first();
  expect(await nameCell.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap');
  const cellBox=await nameCell.boundingBox();expect(cellBox.height).toBeLessThan(90);
  await dialog.screenshot({path:info.outputPath('compact-running-review.png')});
  await expect(dialog.getByRole('spinbutton',{name:'合成时长同学 服务时长'})).toHaveValue('4');
  await expect(dialog.getByRole('spinbutton',{name:'合成时长同学 培训时长'})).toHaveValue('1');
  await expect(dialog.getByRole('spinbutton',{name:'合成时长同学 交通时长'})).toHaveValue('0.5');
});

test('disabled edit button states the blocking reason instead of staying a silent grey control',async({page})=>{
  await mount(page,{canEditInformation:false,canEditReason:'活动已开始，日期、时段与岗位不再开放修改'});
  const edit=page.getByRole('button',{name:'活动信息修改',exact:true});
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAttribute('title','活动已开始，日期、时段与岗位不再开放修改');
});

test('reopen to registration follows final-review authority instead of project owner role',async({page})=>{
 for(const allowed of [false,true]){
  await mount(page,{canReopenRegistration:allowed});
   await page.getByText('更多操作',{exact:true}).click();
  const reopen=page.getByRole('button',{name:'回退报名中',exact:true});
  await expect(reopen).toHaveCount(allowed?1:0);
 }
});
