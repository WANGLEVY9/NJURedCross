async function openActivityTasks(page) {
 const menu=page.locator('.activity-task-menu');
 await expect(menu).toBeVisible();
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
}
import {test,expect} from '@playwright/test';

const headers={'x-csrf-token':'synthetic-ui'};
const draft={name:'模拟·类别主席审批验收',center:'博爱中心',category:'志愿服务',date:'2030-10-15',slot:'09:00-12:00',capacity:8,serviceHours:3,location:'模拟活动室',work:'模拟现场服务'};
const login=(page,username)=>page.request.post('/api/auth/login',{data:{username}});

test('super administrator sees all categories in pending review and can approve or return another chair task',async({page},info)=>{
 await login(page,'synthetic-organizer');
 const events=[];
 for(const [center,name] of [['生命中心','模拟·生命全局审批验收'],['综事中心','模拟·综事全局审批验收']]){
  const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{...draft,center,name}});expect(created.ok()).toBe(true);events.push((await created.json()).result);
 }
 await login(page,'synthetic-super');await page.goto(`/console/events?mode=mine&event=${events[0]._id}`);
 for(const event of events)await expect(page.locator('.activity-list')).toContainText(event['活动名称']);
 await openActivityTasks(page);await expect(page.getByRole('button',{name:'审批通过',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'退回修改',exact:true})).toBeVisible();
 await page.locator('.activity-approval-status').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('super-global-approval.png'),fullPage:true,animations:'disabled'});
 await openActivityTasks(page);await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();return data.events.find(e=>e._id===events[0]._id)['审批人'];}).toBe('synthetic-super');
 await page.goto(`/console/events?mode=mine&event=${events[1]._id}`);await page.getByRole('button',{name:'退回修改',exact:true}).click();await page.getByLabel('退回原因').fill('模拟全局审核：请补充活动安排');await page.getByRole('button',{name:'确认退回',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();return JSON.parse(data.events.find(e=>e._id===events[1]._id)['报名页配置']).approvalReturn?.reviewerName;}).toBe('模拟超级管理员');
 expect((await page.request.post(`/api/volunteer/workflow/events/${events[0]._id}/approve`,{headers,data:{}})).status()).toBe(409);
});

test('category selects its chair, only that chair sees the task, return and resubmit keep the workflow usable',async({page},info)=>{
 await login(page,'synthetic-organizer');await page.goto('/console/events');
 if((await page.viewportSize()).width<=800)await page.locator('.activity-page-tools > summary').click();
 await page.getByRole('button',{name:'新建活动',exact:true}).click();
 await page.locator('.activity-create-form').getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:'博爱中心',exact:true}).click();
 await expect(page.locator('.activity-approval-recipient strong')).toHaveText('模拟博爱主席');
 for(const [category,name] of [['主席团专项','模拟主席团审核人'],['生命中心','模拟生命主席'],['综事中心','模拟综事主席'],['博爱中心','模拟博爱主席']]){
  await page.locator('.activity-create-form').getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:category,exact:true}).click();await expect(page.locator('.activity-approval-recipient strong')).toHaveText(name);
 }
 await page.locator('.activity-approval-recipient').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('category-chair-recipient.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'退出编辑',exact:true}).click();
 await page.getByRole('button',{name:'放弃修改',exact:true}).click();
 const create=await page.request.post('/api/volunteer/workflow/events',{headers,data:draft});expect(create.ok()).toBe(true);const id=(await create.json()).result._id;
 await page.goto(`/console/events?event=${id}&mode=review`);
 await expect(page.getByText('待 模拟博爱主席 审核',{exact:true})).toBeVisible();await openActivityTasks(page);await expect(page.getByRole('button',{name:'审批通过',exact:true})).toBeDisabled();
 await login(page,'synthetic-second-chair');await page.goto('/console/events?mode=mine');
 await expect(page.locator('.activity-list')).not.toContainText(draft.name);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).status()).toBe(403);
 await login(page,'synthetic-reviewer');await page.goto(`/console/events?event=${id}&mode=mine`);
 await expect(page.locator('.activity-detail h2').first()).toHaveText(draft.name);
 await openActivityTasks(page);await expect(page.getByRole('button',{name:'审批通过',exact:true})).toBeVisible();
 await page.locator('.activity-approval-status').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('category-chair-review.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'退回修改',exact:true}).click();await page.getByLabel('退回原因').fill('模拟：请明确活动集合地点');await page.getByRole('button',{name:'确认退回',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();return data.events.find(e=>e._id===id)['状态'];}).toBe('草稿');
 await login(page,'synthetic-organizer');await page.goto(`/console/events?event=${id}&mode=all`);
 await expect(page.getByText(/已退回修改：模拟：请明确活动集合地点/)).toBeVisible();await openActivityTasks(page);await page.getByRole('button',{name:'提交审批',exact:true}).click();
 await expect(page.getByText('待 模拟博爱主席 审核',{exact:true})).toBeVisible();
 await login(page,'synthetic-reviewer');await page.reload();await openActivityTasks(page);await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await expect(page.locator('.activity-detail-head .badge').first()).toHaveText('待发布');
 await openActivityTasks(page);await expect(page.getByRole('button',{name:'前往发布报名',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('legacy fixture administrator configures defaults while ordinary administrators cannot',async({page},info)=>{
 await login(page,'synthetic-organizer');await page.goto('/console/events');await expect(page.getByRole('button',{name:'默认审核人配置',exact:true})).toHaveCount(0);
 await login(page,'synthetic-super');const originalSettings=await(await page.request.get('/api/volunteer/workflow/approval-routing')).json();await page.reload();if((await page.viewportSize()).width<=800)await page.locator('.activity-page-tools > summary').click();await page.getByRole('button',{name:'默认审核人配置',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'默认审核人配置'}).locator('section').filter({has:page.getByRole('heading',{name:'生命中心',exact:true})});
 await expect(picker.locator('.people-picker__remove').first()).toBeVisible();
 while(await picker.locator('.people-picker__remove').count())await picker.locator('.people-picker__remove').first().click();
 await picker.locator('summary').click();await picker.getByRole('searchbox').fill('模拟综事主席');await picker.getByRole('searchbox').press('Enter');
 await page.screenshot({path:info.outputPath('category-chair-settings.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'保存默认审核人',exact:true}).click();await expect(page.getByRole('dialog',{name:'默认审核人配置'})).toHaveCount(0);
 expect((await(await page.request.get('/api/volunteer/workflow/approval-routing')).json()).mappings['生命中心']).toEqual(['synthetic-second-chair']);
 await login(page,'synthetic-organizer');
 const create=await page.request.post('/api/volunteer/workflow/events',{headers,data:{...draft,name:'模拟·类别默认审核人分配',center:'生命中心'}});expect(create.ok()).toBe(true);
 expect(JSON.parse((await create.json()).result['报名页配置']).approval.reviewerId).toBe('synthetic-second-chair');
 const settings=await(await page.request.get('/api/volunteer/workflow/approval-routing')).json();expect((await page.request.put('/api/volunteer/workflow/approval-routing',{headers,data:{version:settings.version,mappings:{}}})).status()).toBe(403);
 // Restore this fixture's mapping so other browser suites remain independent.
 await login(page,'synthetic-super');expect((await page.request.put('/api/volunteer/workflow/approval-routing',{headers,data:{version:settings.version,mappings:originalSettings.mappings}})).ok()).toBe(true);
});
