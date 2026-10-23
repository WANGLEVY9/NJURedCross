import {test,expect} from '@playwright/test';

async function mount(page,single=false){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 await page.evaluate(async single=>{
  const {h}=await import('/app/core/dom.js'),{activityRegistrationWorkspace}=await import('/app/console/pages/activity-registration-workspace.js');
  const job={_id:'leave-job-one',活动ID:'leave-one',活动名称:'合成请假演示',岗位:'鼓楼服务岗',状态:'报名中',报名页配置:'{}',approvalAccess:{canManageRegistration:true}};
  const second={...job,_id:'leave-job-two',活动ID:'leave-two',岗位:'鼓楼摄影岗'};
  const registrations=[
   {_id:'pending-one',活动ID:'leave-one',姓名:'待审批同学',学号:'1001',校区:'鼓楼',部门:'办公室',报名状态:'已确认',请假状态:'待审批',请假原因:'有课程安排'},
   {_id:'approved',活动ID:'leave-one',姓名:'已批准同学',学号:'1002',校区:'仙林',部门:'生命中心',报名状态:'已请假',请假状态:'已批准',请假原因:'需要参加考试'},
   {_id:'rejected',活动ID:'leave-one',姓名:'已驳回同学',学号:'1003',报名状态:'已确认',请假状态:'已驳回',请假原因:'临时有事，希望调整服务安排。'},
   {_id:'pending-two',活动ID:'leave-two',姓名:'摄影同学甲',学号:'1004',报名状态:'待筛选',请假状态:'待审批',请假原因:'<img src=x onerror=alert(1)> 合成原因'},
   {_id:'pending-three',活动ID:'leave-two',姓名:'摄影同学乙',学号:'1005',报名状态:'已确认',请假状态:'待审批',请假原因:'临时有事'},
  ];
  const data={events:single?[job]:[job,second],registrations:single?registrations.filter(row=>row.活动ID===job.活动ID):registrations};
  const ui=activityRegistrationWorkspace({event:job,data,reload:async()=>data,decideLeave:async(id,approved)=>{const row=data.registrations.find(row=>row._id===id);row.请假状态=approved?'已批准':'已驳回';if(approved)row.报名状态='已请假';}});
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2'},ui.node));
 },single);
}
async function choose(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}

test('position hints count pending leave independently of roster filters and link to its rows',async({page},info)=>{
 await mount(page);
 const service=page.getByRole('tab',{name:'鼓楼服务岗，1 条请假待审批',exact:true}),photo=page.getByRole('tab',{name:'鼓楼摄影岗，2 条请假待审批',exact:true});
 await expect(service).toBeVisible();await expect(photo).toBeVisible();
 const approved=page.getByRole('row').filter({hasText:'已批准同学'}),pending=page.getByRole('row').filter({hasText:'待审批同学'}),rejected=page.getByRole('row').filter({hasText:'已驳回同学'});
 await expect(approved.locator('.badge--success')).toHaveText('请假已批准');await expect(approved.locator('.activity-registration-leave-reason')).toHaveText('原因：需要参加考试');
 await expect(pending.locator('.badge--warning')).toHaveText('请假待审批');await expect(rejected.locator('.badge--error')).toHaveText('请假已驳回');await expect(rejected.locator('.activity-registration-leave-reason')).toContainText('临时有事');
 const positions=await approved.evaluate(row=>({status:row.querySelector('.badge').getBoundingClientRect().bottom,reason:row.querySelector('.activity-registration-leave-reason').getBoundingClientRect().top}));expect(positions.reason).toBeGreaterThanOrEqual(positions.status);
 await page.screenshot({path:info.outputPath('leave-indicators.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('searchbox',{name:'搜索报名'}).fill('不存在');await choose(page,'校区','仙林');await choose(page,'部门','生命中心');
 await expect(service).toContainText('请假待审批 1');await page.getByRole('button',{name:'查看待审批',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'搜索报名'})).toHaveValue('');await expect(page.locator('.activity-registration-table tbody tr')).toHaveCount(1);await expect(pending).toBeVisible();
 await photo.focus();await photo.press('Enter');await expect(page.locator('.activity-registration-table tbody tr')).toHaveCount(2);await expect(page.locator('.activity-registration-leave-hint')).toContainText('2 条请假待审批');await expect(page.locator('.activity-registration-table img')).toHaveCount(0);await expect(page.locator('.activity-registration-table')).toContainText('<img src=x onerror=alert(1)> 合成原因');
 await page.getByRole('tab',{name:'鼓楼服务岗，1 条请假待审批',exact:true}).focus();await page.getByRole('tab',{name:'鼓楼服务岗，1 条请假待审批',exact:true}).press('ArrowRight');await expect(photo).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('review refresh clears only the resolved position hint, including the single-position case',async({page})=>{
 await mount(page);
 await page.getByRole('row').filter({hasText:'待审批同学'}).getByRole('button',{name:'批准请假',exact:true}).click();
 await page.getByRole('dialog',{name:'批准请假',exact:true}).getByRole('button',{name:'确认批准请假',exact:true}).click();
 await expect(page.getByRole('tab',{name:'鼓楼服务岗',exact:true})).toBeVisible();await expect(page.locator('.activity-registration-leave-hint')).toBeHidden();await expect(page.getByRole('tab',{name:'鼓楼摄影岗，2 条请假待审批',exact:true})).toBeVisible();
 await expect(page.getByRole('row').filter({hasText:'待审批同学'}).locator('.badge--success')).toHaveText('请假已批准');
 await mount(page,true);await expect(page.getByRole('tab',{name:'鼓楼服务岗，1 条请假待审批',exact:true})).toBeVisible();
 await page.getByRole('row').filter({hasText:'待审批同学'}).getByRole('button',{name:'驳回请假',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'驳回请假',exact:true});await modal.getByRole('textbox',{name:/处理说明/}).fill('合成处理说明');await modal.getByRole('button',{name:'确认驳回请假',exact:true}).click();
 await expect(page.getByRole('tablist',{name:'活动岗位'})).toBeHidden();await expect(page.locator('.activity-registration-leave-hint')).toBeHidden();await expect(page.getByRole('row').filter({hasText:'待审批同学'}).locator('.badge--error')).toHaveText('请假已驳回');
});
