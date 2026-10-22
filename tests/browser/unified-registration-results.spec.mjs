import {test,expect} from '@playwright/test';
const headers={'x-csrf-token':'synthetic-ui'};
async function published(page,name){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name,date:'2030-10-23',slot:'11:00-15:00',capacity:4,serviceHours:4,location:'合成地点',work:'合成服务',category:'生命类'}});expect(response.ok()).toBe(true);const event=(await response.json()).result;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/publish`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/portal/workflow/events/${event._id}/register`,{headers,data:{consent:true}})).ok()).toBe(true);
 return event;
}
test('unified entry publishes historical-workspace rejection immediately without closing booking',async({page},info)=>{
 const event=await published(page,'统一拒绝通知-'+info.project.name);await page.goto(`/console/events?event=${event._id}`);
 const roster=page.locator('.activity-roster');await expect(roster).toBeVisible();await expect(page.getByRole('button',{name:'最终确认并发送邮件通知',exact:true})).toHaveCount(0);
 await roster.getByRole('checkbox',{name:'选择 合成测试同学',exact:true}).check({force:true});await page.getByRole('button',{name:'批量报名失败并通知',exact:true}).click();await page.getByRole('textbox',{name:'补充说明',exact:true}).fill('合成课程冲突');
 await page.getByRole('button',{name:'确认 1 人报名失败并通知',exact:true}).click();const result=page.getByRole('dialog',{name:'报名处理结果',exact:true});await expect(result).toContainText('报名失败结果已保存');await result.getByRole('button',{name:'完成',exact:true}).click();
 const own=await(await page.request.get('/api/portal/workflow/me')).json();expect(own.registrations.find(r=>r.eventId===event._id).status).toBe('未入选');
 const detail=await(await page.request.get(`/api/volunteer/workflow/events/${event._id}/detail`)).json();const current=detail.events.find(e=>e._id===event._id),review=JSON.parse(current['报名页配置']).rosterReview;expect(current['状态']).toBe('报名中');expect(review.closed).not.toBe(true);expect(review.drafts).toEqual({});
 await page.screenshot({path:info.outputPath('unified-results.png'),fullPage:true,animations:'disabled'});
});

test('historical workspace shows leave inside the result and replaces decisions with review actions',async({page},info)=>{
 const event=await published(page,'统一请假审批-'+info.project.name);const own=await(await page.request.get('/api/portal/workflow/me')).json(),booking=own.registrations.find(r=>r.eventId===event._id);
 expect((await page.request.post(`/api/portal/workflow/registrations/${booking.code}/leave`,{headers,data:{reason:'合成请假原因'}})).ok()).toBe(true);
 await page.goto(`/console/events?event=${event._id}`);const row=page.getByRole('row').filter({hasText:'合成请假原因'});await expect(row).toContainText('请假待审批');await expect(row.getByRole('button',{name:'批准录取',exact:true})).toHaveCount(0);
 await row.getByRole('button',{name:'批准请假',exact:true}).click();await page.getByRole('dialog',{name:'批准请假',exact:true}).getByRole('button',{name:'确认批准请假',exact:true}).click();await expect(row).toContainText('请假已批准');
 const after=await(await page.request.get('/api/portal/workflow/me')).json();expect(after.registrations.find(r=>r.code===booking.code).status).toBe('已请假');
});

test('saved historical drafts are never auto-published and can be published individually',async({page},info)=>{
 const event=await published(page,'历史暂存兼容-'+info.project.name);const detail=await(await page.request.get(`/api/volunteer/workflow/events/${event._id}/detail`)).json(),row=detail.registrations.find(r=>r['活动ID']===event['活动ID']),current=detail.events.find(e=>e._id===event._id);
 expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/batch-decide`,{headers,data:{ids:[row._id],decision:'reject',reason:'保留的原理由',token:current.rosterToken,immediate:false}})).ok()).toBe(true);
 await page.goto(`/console/events?event=${event._id}`);const roster=page.locator('.activity-roster');await expect(roster).toContainText('有历史暂存结果尚未公布');
 let own=await(await page.request.get('/api/portal/workflow/me')).json();expect(own.registrations.find(r=>r.eventId===event._id).status).toBe('待筛选');
 const person=page.getByRole('row').filter({hasText:'合成测试同学'});await person.locator('summary').filter({hasText:'处理选项'}).click();await person.getByRole('button',{name:'发布此结果并通知',exact:true}).click();await expect(page.getByRole('dialog',{name:'报名处理结果',exact:true})).toBeVisible();
 own=await(await page.request.get('/api/portal/workflow/me')).json();expect(own.registrations.find(r=>r.eventId===event._id).status).toBe('未入选');expect(own.registrations.find(r=>r.eventId===event._id).reason).toBe('保留的原理由');
});
