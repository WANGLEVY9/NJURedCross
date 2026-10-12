import {test,expect} from '@playwright/test';

test('pending workflow registration can cancel and re-register; confirmed registration only offers leave',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const token=(await (await page.request.get('/api/auth/session')).json()).csrfToken;
 const headers={'x-csrf-token':token};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成取消报名测试',date:'2026-12-01',slot:'下午',position:'服务岗',capacity:3,serviceHours:2,trainingHours:0,travelHours:0,location:'合成地点',work:'仅用于浏览器测试'}});
 expect(created.ok()).toBe(true);
 const payload=await created.json();
 const id=payload.result._id;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 await page.goto(`/workflow-events?event=${id}`);
 await page.locator('.blood-detail-submit .check').click();
 await page.getByRole('button',{name:'确认报名此班次',exact:true}).click();
 const cancellation=page.locator('.blood-registration summary').getByText('取消报名',{exact:true});
 await expect(cancellation).toBeVisible();
 await expect(page.getByRole('button',{name:'确认取消报名',exact:true})).toBeHidden();
 await expect(page.locator('.blood-registration summary').getByText('申请请假',{exact:true})).toHaveCount(0);
 await cancellation.click();
 await page.getByRole('button',{name:'确认取消报名',exact:true}).click();
 await expect(page.locator('.blood-detail-submit .check')).toBeVisible();
 await page.locator('.blood-detail-submit .check').click();
 await page.getByRole('button',{name:'确认报名此班次',exact:true}).click();
 await expect(cancellation).toBeVisible();
 const overview=await (await page.request.get('/api/volunteer/workflow')).json();
 const booking=overview.registrations.find(row=>row['活动名称']==='合成取消报名测试'&&row['报名状态']==='待筛选');
 expect((await page.request.post(`/api/volunteer/workflow/registrations/${booking._id}/confirm`,{headers,data:{}})).ok()).toBe(true);
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(cancellation).toHaveCount(0);
 await expect(page.locator('.blood-registration summary').getByText('申请请假',{exact:true})).toBeVisible();
});

test('Hongyang blood booking returns immediate success',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const catalogue=await (await page.request.get('/api/public/workflow/events')).json();
 const event=catalogue.events.find(row=>row.location==='浦口弘阳广场'&&row.date==='2026-10-13'&&row.remaining>0);
 expect(event).toBeTruthy();
 await page.goto(`/workflow-events?type=blood&slot=${encodeURIComponent(event.id)}`);
 await page.locator('.blood-detail-submit .check').click();
 await page.getByRole('button',{name:'确认报名此班次',exact:true}).click();
 await expect(page.locator('.registration-callout')).toContainText('报名成功');
 await expect(page.getByRole('button',{name:'取消报名',exact:true})).toHaveCount(0);
 await expect(page.locator('.blood-registration summary').getByText('申请请假',{exact:true})).toBeVisible();
});
