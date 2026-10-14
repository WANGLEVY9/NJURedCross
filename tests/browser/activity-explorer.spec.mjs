import {test,expect} from '@playwright/test';

const event=(id,extra={})=>({_id:id,活动ID:id,活动名称:'合成活动 '+id,状态:'报名中',报名日期:'2026-10-29',报名时段:'08:30–10:30',地点:'仙林校区',活动类别:'志愿服务',组织类别:'主席团',活动地区:'南京地区',岗位:'引导',容量:30,服务时长:2,培训时长:0,交通时长:0,报名页配置:'{}',...extra});
async function setup(page,events){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/volunteer/workflow',r=>r.fulfill({json:{events,registrations:[],ledger:[],sources:[],sourceWarnings:[]}}));
 await page.route('**/api/volunteer/workflow/sources',r=>r.fulfill({json:{sources:[]}}));
}
const sessions=()=>Array.from({length:16},(_,i)=>event(`session-${i}`,{活动名称:'合成献血周',报名日期:i<8?'2026-10-29':'2026-10-30',地点:i%2?'仙林校区':'鼓楼校区',报名页配置:JSON.stringify({ordinary:{groupId:'test-group',hoursPending:true}}),registrationControl:{groupName:'合成献血周',enabled:true,deadline:'2026-10-28T00:00:00+08:00'}}));

test('Explorer preserves explicit hierarchy, session URL, project settings and keyboard selection',async({page})=>{
 await setup(page,[...sessions(),event('other',{活动名称:'合成献血周'})]);
 await page.goto('/console/events?mode=all');
 await expect(page.locator('.activity-list-item')).toHaveCount(2);
 const expand=page.getByRole('button',{name:'展开合成献血周的班次'});
 await expand.focus();await expand.press('Enter');
 await expect(page.locator('.activity-explorer-session')).toHaveCount(16);
 await page.locator('.activity-explorer-session').last().click();
 await expect(page).toHaveURL(/scope=session/);
 await expect(page.getByText('普通活动项目 · 统一报名设置',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'返回活动项目'})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'返回活动项目'})).toBeVisible();
 await expect(page.locator('.activity-explorer-session[aria-pressed="true"]')).toHaveCount(1);
 await page.getByRole('button',{name:'返回活动项目'}).click();
 await page.getByRole('tab',{name:'统一报名设置'}).click();
 await expect(page.getByRole('tab',{name:'统一报名设置'})).toBeFocused();
 const cutoff=page.getByLabel('统一报名截止（北京时间）');
 await cutoff.fill('2026-10-26T12:00');
 await page.locator('.activity-explorer-toggle').click();
 await expect(cutoff).toHaveValue('2026-10-26T12:00');
 await page.getByRole('button',{name:'立即停止报名'}).click();
 await expect(page.getByRole('dialog')).toContainText('全部班次');
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.goto('/console/events?mode=all&event=session-15&scope=session&tab=hours');
 await expect(page.locator('.activity-detail')).toContainText('时长规则待确定');
 await expect(page.locator('.service-review')).toHaveCount(0);
});

for(const count of [100,520])test(`${count} activities remain scrollable and filtering does not lose selected details`,async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop workspace density');
 await page.setViewportSize({width:1440,height:1080});
 await setup(page,Array.from({length:count},(_,i)=>event(`large-${i}`)));
 await page.goto('/console/events?mode=all');
 await expect(page.locator('.activity-list-item')).toHaveCount(count);
 const target=`large-${count-10}`;
 await page.locator(`.activity-list-item[data-object-id="${target}"]`).click();
 const scroll=await page.locator('.activity-list').evaluate(n=>n.scrollTop);
 expect(scroll).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'收起活动列表'}).click();
 await expect(page.locator('.activity-master')).toBeHidden();
 await page.getByRole('button',{name:'显示活动列表'}).click();
 expect(await page.locator('.activity-list').evaluate(n=>n.scrollTop)).toBe(scroll);
 await page.getByRole('searchbox',{name:'搜索活动',exact:true}).fill(target);
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect(page.locator('.activity-detail h2').first()).toContainText(target);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`explorer-${count}-filtered.png`)});
});

test('mixed project status matches child and long names retain accessible labels',async({page})=>{
 const rows=sessions();rows[15]['状态']='待审核';
 const title='合成项目：南京大学红十字会跨校区志愿服务与应急知识宣传活动（超长活动名称的完整身份验证）';
 for(const row of rows)row.registrationControl.groupName=title;
 await setup(page,rows);
 await page.goto('/console/events?mode=review');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect(page.locator('.activity-list-item strong')).toHaveAttribute('title',title);
 await expect(page.locator('.activity-project-sessions article')).toHaveCount(16);
 await expect(page.locator('.activity-summary strong').nth(1)).toHaveText('1');
});

test('pending personal review matches an assigned child without exposing unrelated projects',async({page})=>{
 const rows=sessions();rows[15]['状态']='待审核';rows[15].approvalAccess={required:true,canReview:true};
 const other=event('foreign-review',{状态:'待审核',活动名称:'合成其他主席申请',approvalAccess:{required:true,canReview:false}});
 await setup(page,[...rows,other]);await page.goto('/console/events?mode=mine');
 await expect(page.getByRole('tab',{name:'待我审核',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);await expect(page.locator('.activity-list')).not.toContainText('合成其他主席申请');
 await page.getByRole('button',{name:'展开合成献血周的班次'}).click();
 await page.locator('.activity-explorer-session[data-object-id="session-15"]').click();
 await expect(page.getByRole('button',{name:'审批通过',exact:true})).toBeVisible();
 await page.locator('.activity-explorer-session[data-object-id="session-0"]').click();
 await expect(page.getByRole('button',{name:'审批通过',exact:true})).toHaveCount(0);
});

test('approval keeps the original permission and transition flow in the task header',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const created=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'合成审批工作区',center:'博爱中心',date:'2030-01-12',slot:'09:00-12:00',capacity:2,serviceHours:3,location:'合成地点',work:'合成引导',submit:true}});
 expect(created.ok()).toBe(true);
 const id=(await created.json()).result._id;
 await page.goto(`/console/events?mode=review&event=${id}`);
 await expect(page.getByRole('button',{name:'审批通过',exact:true})).toHaveCount(0);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.reload();
 await expect(page.getByRole('button',{name:'审批通过',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('approval-workspace.png')});
 await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await expect.poll(async()=>{const payload=await (await page.request.get('/api/volunteer/workflow')).json();return payload.events.find(e=>e._id===id)['状态'];}).toBe('可发布');
});

for(const width of [1440,1920])test(`desktop workspace ${width}: single, roster, attendance, hours`,async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop dimensions');
 await page.setViewportSize({width,height:1080});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.goto('/console/events?mode=all&event=synthetic-8');
 await expect(page.getByRole('tab',{name:'概览与审批'})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:info.outputPath(`workspace-${width}.png`)});
 for(const name of ['报名 30','签到核验','时长审核与导出']){
  await page.getByRole('tab',{name,exact:true}).click();
  if(name==='报名 30')await expect(page.locator('.activity-roster-table')).toBeVisible();
  else {await expect(page.locator('.service-workspace')).toBeVisible();await expect(page.locator('.activity-master')).toBeHidden();}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${width}-${name}.png`)});
 }
});
