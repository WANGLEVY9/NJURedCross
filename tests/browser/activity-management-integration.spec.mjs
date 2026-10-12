import {test,expect} from '@playwright/test';

test('management draft uses shared form, half-hour schedule and independent publication review',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events');
 await page.getByRole('combobox',{name:'活动地区',exact:true}).click();
 await page.getByRole('option',{name:'苏州地区',exact:true}).click();
 await page.getByRole('button',{name:'新建活动',exact:true}).click();
 const form=page.locator('.activity-create-form');
 await expect(form).toBeVisible();
 await form.getByLabel('活动名称').fill('合成管理合并验收');
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();
 await page.getByRole('option',{name:'一加助残',exact:true}).click();
 await form.getByLabel('活动类型 / 专项').fill('志愿服务');
 await form.getByLabel('活动日期').fill('2030-01-12');
 await form.getByRole('combobox',{name:'开始时间',exact:true}).click();
 await page.getByRole('option',{name:'08:30',exact:true}).click();
 await form.getByRole('combobox',{name:'结束时间',exact:true}).click();
 await page.getByRole('option',{name:'12:00',exact:true}).click();
 await form.getByLabel('活动地点').fill('合成测试报告厅');
 await form.getByLabel('活动内容').fill('合成活动内容');
 await form.getByLabel('工作内容').fill('合成现场引导');
 await expect(form.getByLabel('服务时长（小时）')).toHaveValue('3.5');
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect(form).toBeHidden();
 await expect(page.locator('.activity-detail h2').first()).toHaveText('合成管理合并验收');
 await expect.poll(async()=>{
  const data=await (await page.request.get('/api/volunteer/workflow')).json();
  return JSON.parse(data.events.find(e=>e['活动名称']==='合成管理合并验收')['报名页配置']).center;
 }).toBe('一加助残');
 await page.getByRole('tab',{name:'发布报名',exact:true}).click();
 await expect(page.getByLabel('报名通知正文',{exact:true})).toHaveValue(/南大红会/);
 await page.getByLabel('报名开始日期（北京时间）',{exact:true}).fill('2030-01-11');
 await page.getByRole('combobox',{name:'报名开始时间（北京时间）',exact:true}).click();
 await page.getByRole('option',{name:'09:30',exact:true}).click();
 await page.getByRole('button',{name:'保存通知',exact:true}).click();
 await expect.poll(async()=>{
  const data=await (await page.request.get('/api/volunteer/workflow')).json();
  return JSON.parse(data.events.find(e=>e['活动名称']==='合成管理合并验收')['报名页配置']).publishAt;
 }).toBe('2030-01-11T09:30+08:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('management-publication.png'),fullPage:true,animations:'disabled'});
});

test('management roster stages outcomes without mail and requires explicit final confirmation',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const headers={'x-csrf-token':'synthetic-ui'};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成名单合并验收',date:'2030-01-12',slot:'09:00-12:00',capacity:2,registrationLimit:3,serviceHours:3,location:'合成地点',work:'合成服务',category:'生命类'}});
 expect(created.ok()).toBe(true);const id=(await created.json()).result._id;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/portal/workflow/events/${id}/register`,{headers,data:{consent:true}})).ok()).toBe(true);
 await page.goto(`/console/events?event=${id}&tab=roster`);
 await expect(page.locator('.activity-roster')).toBeVisible();
 await page.locator('.activity-roster-selection .check').click();
 await page.getByRole('button',{name:'批量拟录取',exact:true}).click();
 await page.getByRole('button',{name:'保存暂定结果',exact:true}).click();
 await expect(page.locator('.activity-roster')).toContainText('拟录取');
 const own=await (await page.request.get('/api/portal/workflow/me')).json();
 expect(own.registrations.find(r=>r.eventId===id).status).toBe('待筛选');
 await expect(page.getByRole('button',{name:'最终确认并发送邮件通知',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'拟录取 1',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.activity-roster-table')).toContainText('合成测试同学');
 await page.screenshot({path:info.outputPath('management-roster.png'),fullPage:true,animations:'disabled'});
});

test('blood and ordinary booking snapshots open in the shared private details drawer',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const data=await (await page.request.get('/api/volunteer/workflow')).json();
 const event=data.events.find(e=>JSON.parse(e['报名页配置']||'{}').blood&&data.registrations.some(r=>r['活动ID']===e['活动ID']));
 expect(event).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}&tab=roster`);
 await page.locator('.activity-records').getByRole('button',{name:'更多资料',exact:true}).first().click();
 const drawer=page.getByRole('dialog');await expect(drawer).toBeVisible();
 for(const name of ['活动类别','地区','备注2','注意事项','资料来源','关联状态'])await expect(drawer).toContainText(name);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('booking-profile.png'),fullPage:true,animations:'disabled'});
});
