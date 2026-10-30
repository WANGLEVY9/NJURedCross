import {test,expect} from '@playwright/test';

async function mount(page,kind,{readonly=false,fail=false,single=false}={}){
  await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
  await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
  await page.evaluate(async({kind,readonly,fail,single})=>{
    const event={_id:'attention-first',活动ID:'attention-first',活动名称:'合成请假待办',岗位:'鼓楼服务岗（一）',负责人账号ID:'synthetic-super',状态:kind==='registration'?'报名中':'进行中',报名页配置:'{}',容量:20,approvalAccess:{canManageRegistration:!readonly}};
    const second={...event,_id:'attention-second',活动ID:'attention-second',岗位:'鼓楼摄影岗（二）'};
    const registrations=[{_id:'normal',活动ID:event.活动ID,姓名:'合成正常同学',学号:'999990001',报名状态:'已确认'},{_id:'processed',活动ID:event.活动ID,姓名:'合成已处理',报名状态:'已请假',请假状态:'已批准'},
      ...['甲','乙'].map((name,index)=>({_id:'leave-'+index,活动ID:second.活动ID,姓名:'合成请假'+name,学号:'99999000'+(index+2),报名状态:kind==='registration'&&!index?'待筛选':'已确认',请假状态:'待审批',请假原因:'合成课程冲突'+name})),
      {_id:'outside',活动ID:'other-project',姓名:'其他项目',报名状态:'已确认',请假状态:'待审批'}];
    const data={events:single?[second]:[event,second],registrations,ledger:[]};window.leaveAttentionTest={data,decisions:[]};
    const options={event:single?second:event,data,reload:async()=>structuredClone(data),loadInformation:async()=>({}),loadReview:async()=>({entries:[],canRecord:false}),decide:async()=>{},close:async()=>{},decideLeave:async(id,approved,reason)=>{
      if(fail)throw Error('合成请假保存失败');
      window.leaveAttentionTest.decisions.push({id,approved,reason});const row=registrations.find(row=>row._id===id);row.请假状态=approved?'已批准':'已驳回';if(approved)row.报名状态='已请假';
    }};
    const ui=kind==='registration'?(await import('/app/console/pages/activity-registration-workspace.js')).activityRegistrationWorkspace(options):(await import('/app/console/pages/activity-running-workspace.js')).activityRunningWorkspace(options);
    const {h}=await import('/app/core/dom.js');document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2'},ui.node));
  },{kind,readonly,fail,single});
}

const kind='running';
{
  test(`${kind} position badges guide users to pending leave and clear after decisions`,async({page},info)=>{
    await mount(page,kind);
    await page.screenshot({path:info.outputPath(kind+'-leave-attention.png'),fullPage:true,animations:'disabled'});
    const tabs=page.getByRole('tablist',{name:'活动岗位'}),first=tabs.getByRole('tab',{name:'鼓楼服务岗（一）',exact:true}),second=tabs.getByRole('tab',{name:'鼓楼摄影岗（二）',exact:true});
    await expect(first.locator('.activity-position-leave-count')).toHaveCount(0);
    await expect(second.locator('.activity-position-leave-count')).toHaveText('2');await expect(second).toHaveAccessibleDescription('2 条请假待审批');
    const attention=page.getByRole('complementary',{name:'请假待办提示'});await expect(attention).toContainText('有 2 条请假待审批');
    await first.focus();await page.keyboard.press('ArrowRight');await expect(second).toBeFocused();await expect(second).toHaveAttribute('aria-selected','true');
    await first.click();
    await attention.getByRole('button',{name:'查看待审批请假',exact:true}).click();
    await expect(second).toHaveAttribute('aria-selected','true');
    if(kind==='registration')await expect(page.getByRole('combobox',{name:'报名状态',exact:true})).toContainText('请假待审批');
    await expect(page.getByRole('row').filter({hasText:'合成课程冲突甲'})).toBeVisible();await expect(page.getByRole('row').filter({hasText:'其他项目'})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.getByRole('row').filter({hasText:'合成课程冲突甲'}).getByRole('button',{name:'批准请假',exact:true}).click();
    await page.getByRole('dialog',{name:'批准请假',exact:true}).getByRole('button',{name:'确认批准请假',exact:true}).click();
    await expect(second.locator('.activity-position-leave-count')).toHaveText('1');
    await page.getByRole('row').filter({hasText:'合成课程冲突乙'}).getByRole('button',{name:'驳回请假',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'驳回请假',exact:true});await dialog.getByRole('textbox',{name:/处理说明/}).fill('合成排班核对后驳回');
    await dialog.getByRole('button',{name:'确认驳回请假',exact:true}).click();
    await expect(second.locator('.activity-position-leave-count')).toHaveCount(0);await expect(second).not.toHaveClass(/has-pending-leave/);await expect(attention).toBeHidden();
    expect(await page.evaluate(()=>window.leaveAttentionTest.decisions)).toHaveLength(2);
  });

  test(`${kind} read-only and single-position workspaces hide actionable reminders without granting review access`,async({page})=>{
    await mount(page,kind,{readonly:true,single:true});
    const tabs=page.getByRole('tablist',{name:'活动岗位'});await expect(tabs).toBeVisible();await expect(tabs.getByRole('tab')).toHaveCount(1);
    await expect(tabs.locator('.activity-position-leave-count')).toHaveText('2');
    await expect(page.getByRole('button',{name:'查看待审批请假',exact:true})).toBeHidden();
    await expect(page.getByRole('button',{name:'批准请假',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'驳回请假',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>window.leaveAttentionTest.decisions)).toEqual([]);
  });

  test(`${kind} failed decisions retain the pending indicator`,async({page})=>{
    await mount(page,kind,{fail:true});await page.getByRole('button',{name:'查看待审批请假',exact:true}).click();
    await page.getByRole('row').filter({hasText:'合成课程冲突甲'}).getByRole('button',{name:'批准请假',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'批准请假',exact:true});await dialog.getByRole('button',{name:'确认批准请假',exact:true}).click();
    await expect(dialog).toBeVisible();await expect(page.locator('.activity-position-leave-count')).toHaveText('2');
    await expect(page.getByRole('complementary',{name:'请假待办提示'})).toContainText('有 2 条请假待审批');
  });
}
