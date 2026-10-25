import {test,expect} from '@playwright/test';

test('super-admin edits a selected mail template and ordinary administrators cannot access settings',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/admin');await page.getByRole('button',{name:'邮件模板与参与说明',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'邮件模板与参与说明',exact:true});await expect(modal).toBeVisible();await expect(modal.locator('.mail-template-preview')).toContainText('QQ群号：123456789（示例）');await expect(modal.locator('.mail-template-preview')).toContainText('注意事项（示例）');
 await modal.getByRole('combobox',{name:'邮件类型',exact:true}).click();await page.getByRole('option',{name:'活动参与提醒',exact:true}).click();
 await modal.getByRole('textbox',{name:'邮件正文',exact:true}).fill('亲爱的 {姓名}：明日请参加 {活动名称}。');
 await expect(modal.locator('.mail-template-preview')).toContainText('亲爱的 示例志愿者');
 const text=modal.getByRole('textbox',{name:'邮件正文',exact:true});await text.focus();await text.evaluate(node=>node.setSelectionRange(node.value.length,node.value.length));await modal.getByRole('button',{name:'报名信息',exact:true}).click();await expect(text).toHaveValue(/\{报名信息\}$/);await modal.getByRole('button',{name:'入群信息',exact:true}).click();await expect(text).toHaveValue(/\{报名信息\}\{入群信息\}$/);await expect(modal.getByRole('button',{name:'姓名',exact:true})).toHaveCount(0);
 await expect(modal.getByLabel('请假反馈表链接',{exact:true})).toHaveValue(/page_id=v1h4/);
 await page.screenshot({path:info.outputPath('mail-settings.png'),animations:'disabled'});
 await modal.getByRole('button',{name:'保存模板与说明',exact:true}).click();await expect(modal).toHaveCount(0);
 const saved=await page.request.get('/api/console/mail-settings');expect(saved.ok()).toBe(true);expect((await saved.json()).settings.templates['participation-reminder'].text).toContain('明日请参加');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto('/console/admin');await expect(page.getByRole('button',{name:'邮件模板与参与说明',exact:true})).toHaveCount(0);
 expect((await page.request.get('/api/console/mail-settings')).status()).toBe(403);
});

test('blood participation links open native split guides and recorded attendance shows the two evidence examples',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,registrations:[{eventId:'guide-event',code:'synthetic-guide-record',date:'2030-10-23',slot:'11:00-15:00',position:'服务岗',status:'已确认',result:'报名成功',eventStatus:'报名中',eventName:'合成献血车服务',location:'新街口中央',blood:true,attendanceOpen:true}],ledger:[]}}));
 await page.goto('/workflow-events?view=records');
 const record=page.locator('.blood-registration').filter({hasText:'合成献血车服务'});await expect(record).toBeVisible();
 await record.getByText('活动详情',{exact:true}).click();await expect(record.locator('.blood-participation-summary').first()).toContainText('报名编号');await expect(record.locator('.definition-list')).toHaveCount(0);
 await record.getByRole('link',{name:'前期培训',exact:true}).click();const drawer=page.getByRole('dialog',{name:'前期培训',exact:true});await expect(drawer).toContainText('申请成为志愿者');await expect(drawer).toContainText('短信屏蔽');
 await expect(drawer.locator('img')).toBeVisible();await expect.poll(()=>drawer.locator('img').evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('blood-training-guide.png'),animations:'disabled'});
 await drawer.getByRole('button',{name:'关闭',exact:true}).click();
 await record.getByText('现场签到',{exact:true}).click();await expect(record).toContainText('粉色纸质签到表');await expect(record).toContainText('志愿者工时记录');
 await page.screenshot({path:info.outputPath('blood-checkin-guide.png'),animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
