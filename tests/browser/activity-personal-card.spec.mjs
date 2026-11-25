import {test,expect} from '@playwright/test';
test('ended details show only this activity registrations, posted hours and reserved feedback',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 let unavailable=true;
 await page.route('**/api/portal/workflow/me',route=>unavailable?route.fulfill({status:503,json:{ok:false,message:'合成服务暂不可用'}}):route.fulfill({json:{registrations:[{eventId:'position-one',status:'已确认',result:'报名成功',position:'合成引导岗',hours:{summarySynced:true,label:'已写入汇总表',hours:{serviceHours:2,trainingHours:1,travelHours:0}}},{eventId:'outside',status:'未入选',position:'不应显示的其他活动'}]}}));
 await page.evaluate(async()=>{
  const {closedActivityPage}=await import('/app/portal/closed-activity.js');const {withPersonalActivity}=await import('/app/portal/activity-personal-card.js');
  const event={name:'合成结束活动',workflowId:'parent',status:'已结束',sessions:[{sessionId:'position-one'}]};
  const page=withPersonalActivity(closedActivityPage(event),event);document.getElementById('main').replaceChildren(page.node);
 });
 await expect(page.getByText('个人参与进度暂时无法加载',{exact:true})).toBeVisible();unavailable=false;
 await page.getByRole('button',{name:'重试加载参与进度',exact:true}).click();
 const card=page.getByRole('region',{name:'我的参与进度'});
 await expect(card).toContainText('报名成功');await expect(card).toContainText('已入账');await expect(card).toContainText('服务 2 小时');
 await expect(card).not.toContainText('不应显示');await expect(card.getByRole('button',{name:'活动反馈暂未开放',exact:true})).toBeDisabled();
});
test('personal card retains pending hours and next steps for rejected and waitlisted records',async({page})=>{
 await page.goto('/events');await page.waitForLoadState('networkidle');await page.evaluate(async()=>{
  const {personalActivityCard}=await import('/app/portal/activity-personal-card.js');
  document.getElementById('main').replaceChildren(personalActivityCard([{status:'候补',hours:{label:'待负责人确认'}},{status:'未入选',reason:'合成原因'}]));
 });
 await expect(page.getByLabel('我的参与进度')).toContainText('处理中');
 await expect(page.getByLabel('我的参与进度')).toContainText('请等待递补通知');
 await expect(page.getByLabel('我的参与进度')).toContainText('本次未通过');
});
