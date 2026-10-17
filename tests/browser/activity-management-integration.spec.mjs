import {test,expect} from '@playwright/test';

test('management draft continues to notice editing before approval',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events');
 if((await page.viewportSize()).width<=800){await page.locator('.activity-mobile-filters > summary').click();await page.locator('.activity-page-tools > summary').click();}
 await page.getByRole('combobox',{name:'活动地区',exact:true}).click();
 await page.getByRole('option',{name:'苏州地区',exact:true}).click();
 await page.getByRole('button',{name:'新建活动',exact:true}).click();
 const form=page.locator('.activity-create-form');
 await expect(form).toBeVisible();
 await form.getByLabel('活动名称').fill('合成管理合并验收');
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();
 await page.getByRole('option',{name:'一加助残专项',exact:true}).click();
 await form.getByLabel('活动开始时间').fill('2030-01-12T08:30');
 await form.getByLabel('活动结束时间').fill('2030-01-12T12:00');
 await form.getByLabel('服务时长（小时）').fill('3.5');
 await form.getByLabel('活动地点').fill('合成测试报告厅');
 await form.getByLabel('活动内容').fill('合成活动内容');
 await form.getByLabel('工作内容').fill('合成现场引导');
 await expect(form.getByLabel('服务时长（小时）')).toHaveValue('3.5');
 await page.getByRole('button',{name:'保存并继续：岗位安排',exact:true}).click();
 await expect(form).toBeHidden();
 await page.getByRole('button',{name:'下一步：报名通知',exact:true}).click();
 await expect(page.locator('.activity-detail h2').first()).toHaveText('合成管理合并验收');
 await expect.poll(async()=>{
  const data=await (await page.request.get('/api/volunteer/workflow')).json();
  return JSON.parse(data.events.find(e=>e['活动名称']==='合成管理合并验收')['报名页配置']).center;
 }).toBe('一加助残专项');
 await expect(page.getByLabel('报名通知正文',{exact:true})).toHaveValue(/南大红会/);
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeDisabled();
 await page.getByLabel('报名通知正文',{exact:true}).fill('合成通知：先编辑通知，再提交审批。');
 await page.getByRole('button',{name:'保存通知',exact:true}).click();
 await expect.poll(async()=>{
  const data=await (await page.request.get('/api/volunteer/workflow')).json();
  const row=data.events.find(e=>e['活动名称']==='合成管理合并验收');
  return [row['状态'],row['通知草稿']];
 }).toEqual(['草稿','合成通知：先编辑通知，再提交审批。']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('management-publication.png'),fullPage:true,animations:'disabled'});
});

test('management approval immediately publishes success without finalizing all registrations',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const headers={'x-csrf-token':'synthetic-ui'};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成名单合并验收',date:'2030-01-12',slot:'09:00-12:00',capacity:2,registrationLimit:3,serviceHours:3,location:'合成地点',work:'合成服务',category:'生命类'}});
 expect(created.ok()).toBe(true);const id=(await created.json()).result._id;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-life-chair'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/portal/workflow/events/${id}/register`,{headers,data:{consent:true}})).ok()).toBe(true);
 await page.goto(`/console/events?event=${id}&tab=roster`);
 await expect(page.locator('.activity-roster')).toBeVisible();
 await page.locator('.activity-roster-selection .check').click();
 await page.getByRole('button',{name:'批准录取并通知',exact:true}).click();
 await page.getByRole('button',{name:'批准并发送成功邮件',exact:true}).click();

 const resultDrawer=page.getByRole('dialog',{
  name:'报名处理结果',
  exact:true,
 });
 await expect(resultDrawer).toBeVisible();
 await expect(resultDrawer.getByText('已保存',{exact:true}))
  .toHaveCount(1);
 await expect(resultDrawer).toContainText('录取已保存');
 await resultDrawer.getByRole('button',{name:'完成',exact:true}).click();
 await expect(resultDrawer).toHaveCount(0);

 await expect(page.locator('.activity-roster')).toContainText('已录取');
 const own=await (await page.request.get('/api/portal/workflow/me')).json();
 expect(own.registrations.find(r=>r.eventId===id).status).toBe('已确认');
 await expect(page.getByRole('button',{name:'最终确认并发送邮件通知',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'报名成功 1',exact:true}).click();
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
 if((await page.viewportSize()).width<=860)await page.locator('.activity-records .activity-legacy-roster__more > summary').first().click();
 await page.locator('.activity-records').getByRole('button',{name:'更多资料',exact:true}).first().click();
 const drawer=page.getByRole('dialog');await expect(drawer).toBeVisible();
 for(const name of ['活动类别','地区','备注2','注意事项','资料来源','关联状态'])await expect(drawer).toContainText(name);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('booking-profile.png'),fullPage:true,animations:'disabled'});
});

test('publication does not fetch unused source catalogue or directory',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const created=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'合成后台加载验收',date:'2030-01-12',slot:'09:00-12:00',capacity:2,serviceHours:3,location:'合成地点',work:'合成服务',submit:false}});
 expect(created.ok()).toBe(true);const id=(await created.json()).result._id;
 let release;const hold=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/volunteer/workflow/sources',async route=>{await hold;await route.continue();});
 let directoryReads=0;
 await page.route('**/api/volunteer/workflow/directory',async route=>{directoryReads++;await route.continue();});
 try{
  await page.goto(`/console/events?event=${id}&tab=publish&mode=all`);
  const body=page.getByLabel('报名通知正文',{exact:true});await body.fill('合成：尚未保存的通知正文');
  release();
  expect(directoryReads).toBe(0);
  await expect(body).toHaveValue('合成：尚未保存的通知正文');
  await expect(page.getByRole('button',{name:'保存通知',exact:true})).toBeEnabled();
 }finally{release();}
});
