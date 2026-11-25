import {test,expect} from '@playwright/test';

test('activity details open each feedback template and refill a saved submission',async({page})=>{
 const session={authenticated:true,user:{username:'synthetic',role:'member'},csrfToken:'synthetic-csrf'};
 const event={eventId:'workflow:synthetic-event',workflowId:'synthetic-event',name:'合成已结束活动',status:'已结束',type:'公益活动',sessions:[]};
 let currentTemplate='rating',saved=null;
 await page.route('**/api/auth/session',route=>route.fulfill({json:session}));
 await page.route('**/api/public/events/workflow%3Asynthetic-event',route=>route.fulfill({json:{event}}));
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{registrations:[{eventId:event.workflowId,code:'WR-test',date:'2030-01-01',slot:'上午',activityFeedback:{submitted:Boolean(saved)}}]}}));
 await page.route('**/api/portal/workflow/activity-feedback?registration=WR-test',async route=>{
  if(route.request().method()==='PUT'){
   expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf');
   saved={template:currentTemplate,...route.request().postDataJSON(),version:1};
  }
  await route.fulfill({json:{name:event.name,template:currentTemplate,result:saved}});
 });
 for(const [template,count] of [['rating',1],['summary',4],['ihl',5]]){
  currentTemplate=template;saved=null;
  await page.goto('/events/'+encodeURIComponent(event.eventId));
  await page.getByRole('button',{name:'填写反馈',exact:true}).click();
  const drawer=page.getByRole('dialog');
  await expect(drawer.locator('textarea')).toHaveCount(count);
  if(template==='ihl')await expect(drawer.getByLabel('5. 提高效果的建议')).toBeVisible();
  if(template==='rating')await drawer.locator('select[name="rating"]').evaluate(select=>{select.value='5';select.dispatchEvent(new Event('change',{bubbles:true}));});
  for(const [index,input] of (await drawer.locator('textarea').all()).entries())await input.fill(`合成答案 ${index+1}`);
  await drawer.getByRole('button',{name:'提交反馈',exact:true}).click();
  await page.getByRole('button',{name:'修改反馈',exact:true}).click();
  await expect(drawer.locator('textarea').last()).toHaveValue(`合成答案 ${count}`);
  await drawer.getByRole('button',{name:'关闭',exact:true}).last().click();
 }
});
