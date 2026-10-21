import {test,expect} from './legacy-activity-fixture.mjs';
const headers={'x-csrf-token':'synthetic-ui'};
async function draft(page){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成通知专项',center:'博爱中心',date:'2030-01-12',slot:'09:00-12:00',capacity:2,serviceHours:3,location:'合成地点',work:'合成服务',submit:false}});
 expect(response.ok()).toBe(true);return (await response.json()).result._id;
}
test('notice preview, failed save, dirty exit, template confirmation and draft save',async({page},info)=>{
 const id=await draft(page);await page.goto(`/console/events?legacy=1&event=${id}&mode=all&tab=publish`);
 const text=page.getByLabel('报名通知正文',{exact:true});await text.fill('合成自定义正文\n保留这段内容');
 await expect(page.getByLabel('报名通知实时预览')).toContainText('保留这段内容');
 await expect(page.getByRole('button',{name:'保存通知并提交审批',exact:true})).toBeEnabled();
 await page.route(`**/events/${id}/notice`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'合成网络故障'})}));
 await page.getByRole('button',{name:'保存通知',exact:true}).click();await expect(text).toHaveValue('合成自定义正文\n保留这段内容');
 await page.getByRole('tab',{name:'活动信息',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(text).toHaveValue(/保留/);
 await page.getByRole('button',{name:'恢复预设模板',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.unroute(`**/events/${id}/notice`);await page.getByRole('button',{name:'保存通知',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存通知',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'保存通知并提交审批',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('notification-workspace.png'),fullPage:true});
 await page.getByRole('tab',{name:'活动信息',exact:true}).click();await expect(page.getByRole('button',{name:'前往编辑',exact:true})).toBeVisible();await expect(page.getByLabel('报名通知正文',{exact:true})).toHaveCount(0);
});
test('optional success mail editor saves without sending or changing event approval',async({page},info)=>{
 const id=await draft(page);
 await page.request.post(`/api/volunteer/workflow/events/${id}/submit`,{headers,data:{}});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 await page.goto(`/console/events?legacy=1&event=${id}&tab=roster`);
 await page.getByRole('button',{name:'编辑成功邮件（可选）',exact:true}).click();
 await page.getByRole('radio',{name:/使用自定义邮件/}).check();await page.getByLabel('成功邮件主题',{exact:true}).fill('{活动名称}：欢迎加入');await page.getByLabel('成功邮件正文',{exact:true}).fill('{姓名}，请于{日期}到{地点}参加。');
 await expect(page.getByLabel('成功邮件预览')).toContainText('合成通知专项：欢迎加入');
 await page.screenshot({path:info.outputPath('success-mail-workspace.png'),fullPage:true});
 await page.getByRole('button',{name:'保存邮件草稿',exact:true}).click();await expect(page.locator('.success-mail-state')).toContainText('邮件草稿已保存');await page.locator('.drawer__foot').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const data=await(await page.request.get('/api/volunteer/workflow')).json(),e=data.events.find(e=>e._id===id);expect(e['状态']).toBe('报名中');expect(JSON.parse(e['报名页配置']).rosterReview.successMail.subject).toBe('{活动名称}：欢迎加入');
});

test('refresh preserves the live editor and browser back can cancel or discard',async({page})=>{
 const id=await draft(page);await page.goto('/console/events?legacy=1');await page.locator('.activity-page-tools').waitFor();
 await page.evaluate(async id=>{const {navigate}=await import('/app/core/router.js');await navigate(`/console/events?legacy=1&event=${id}&mode=all&tab=publish`);},id);
 const text=page.getByLabel('报名通知正文',{exact:true});await text.fill('合成未保存导航内容');
 await text.evaluate(node=>{node.dataset.retained='yes';node.setSelectionRange(3,3);});
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(text).toHaveAttribute('data-retained','yes');await expect(text).toHaveValue('合成未保存导航内容');
 await page.evaluate(()=>history.back());await expect(page.getByRole('dialog')).toBeVisible();
 // Simulate a late view refresh attempting to sync its query while navigation awaits consent.
 await page.evaluate(async()=>{const {patchQuery}=await import('/app/core/router.js');patchQuery({tab:'publish'});});
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page).toHaveURL(/tab=publish/);await expect(text).toHaveValue('合成未保存导航内容');
 await page.evaluate(()=>history.back());await page.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(text).toHaveCount(0);
});

test('in-flight notice save prevents navigation until the write is acknowledged',async({page})=>{
 const id=await draft(page);await page.goto(`/console/events?legacy=1&event=${id}&mode=all&tab=publish`);
 const text=page.getByLabel('报名通知正文',{exact:true});await text.fill('合成慢速保存');let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route(`**/events/${id}/notice`,async route=>{await gate;await route.continue();});
 await page.getByRole('button',{name:'保存通知',exact:true}).click();await expect(text).toBeDisabled();
 await page.getByRole('tab',{name:'活动信息',exact:true}).click();await expect(text).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 release();await expect(text).toBeEnabled();await expect(page.getByRole('button',{name:'保存通知',exact:true})).toBeDisabled();
});

test('published notice reaches the public booking page as safe plain text',async({page},info)=>{
 const id=await draft(page),text='合成正式公告\n请提前十分钟到场。\n<img src=x onerror=alert(1)>';
 expect((await page.request.patch(`/api/volunteer/workflow/events/${id}/notice`,{headers,data:{text}})).ok()).toBe(true);
 const before=await(await page.request.get('/api/public/workflow/events')).json();expect(before.events.some(e=>e.id===id)).toBe(false);
 await page.request.post(`/api/volunteer/workflow/events/${id}/submit`,{headers,data:{}});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 await page.goto(`/workflow-events?event=${id}`);await expect(page.getByRole('region',{name:'报名通知',exact:true})).toHaveText('报名通知'+text);await expect(page.locator('.workflow-published-notice img')).toHaveCount(0);await page.screenshot({path:info.outputPath('published-notice.png'),fullPage:true});
 await page.goto(`/console/events?legacy=1&event=${id}&tab=publish`);await expect(page.getByLabel('报名通知正文',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'保存通知',exact:true})).toHaveCount(0);
});

test('late redraw from the previous activity page cannot replace the current notification URL',async({page})=>{
 const id=await draft(page);await page.goto('/console/events?legacy=1');await page.locator('.activity-region[data-ready="true"]').waitFor();
 await page.evaluate(()=>{window.previousActivityRegion=document.querySelector('.activity-region');});
 await page.evaluate(async id=>{const {navigate}=await import('/app/core/router.js');await navigate(`/console/events?legacy=1&event=${id}&mode=all&tab=publish`);},id);
 const text=page.getByLabel('报名通知正文',{exact:true});await text.fill('合成新页面未保存内容');
 await page.evaluate(()=>window.previousActivityRegion.redraw());await expect(page).toHaveURL(new RegExp(`event=${id}.*tab=publish`));await expect(text).toHaveValue('合成新页面未保存内容');
});
