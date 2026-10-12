import {test,expect} from '@playwright/test';

for(const feed of ['legacy','unavailable'])test(`autumn first aid registration handles ${feed} personal records`,async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const event={eventId:'autumn-first-aid',name:'秋季急救员活动',status:'报名中',startAt:'2026-12-01T14:00:00+08:00',endAt:'2026-12-01T16:00:00+08:00',capacity:20,remaining:10,sessions:[]};
 await page.route('**/api/public/events/autumn-first-aid',r=>r.fulfill({json:{event,related:[]}}));
 await page.route('**/api/auth/account',r=>r.fulfill({json:{account:{realName:'合成同学',email:'fixture@smail.nju.edu.cn',emailVerified:true,campus:'仙林'}}}));
 let unavailable=feed==='unavailable';
 await page.route('**/api/portal/me',r=>unavailable?r.fulfill({status:503,json:{message:'synthetic outage'}}):r.fulfill({json:{registrations:[{code:'AUTUMN-SYNTHETIC',eventName:event.name,startAt:event.startAt,status:'已确认',createdAt:'2026-10-12T10:00:00+08:00'}]}}));
 await page.goto('/events/autumn-first-aid');
 if(unavailable){
  await expect(page.getByRole('button',{name:'重新读取报名记录',exact:true})).toBeVisible();
  await expect(page.locator('.blood-detail-submit').getByRole('button',{name:'确认报名此活动',exact:true})).toHaveCount(0);
  unavailable=false;
  await page.getByRole('button',{name:'重新读取报名记录',exact:true}).click();
 }
 await expect(page.locator('.blood-detail-submit').getByRole('button',{name:'已报名',exact:true})).toBeDisabled();
 await expect(page.locator('.blood-registration')).toContainText(event.name);
 await expect(page.locator('.blood-registration')).toContainText('AUTUMN-SYNTHETIC');
 await expect(page.locator('.blood-detail-submit input[type="checkbox"]')).toHaveCount(0);
});

test('full ordinary workflow activities replace consent and submission with a disabled full label',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{events:[{id:'full-ordinary',name:'合成满额活动',category:'博爱中心',date:'2026-10-12',slot:'下午',position:'服务岗',location:'合成地点',capacity:2,remaining:0,work:'合成活动说明',blood:null}]}}));
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{registrations:[],participant:{realName:'合成同学',email:'fixture@example.invalid',campus:'仙林'}}}));
 await page.goto('/workflow-events?event=full-ordinary');
 await expect(page.getByRole('heading',{name:'合成满额活动',exact:true})).toBeVisible();
 await expect(page.locator('.blood-detail-submit').getByRole('button',{name:'已报满',exact:true})).toBeDisabled();
 await expect(page.locator('.blood-detail-submit input[type="checkbox"]')).toHaveCount(0);
});

test('current activity records show the latest pending submission with cancellation first',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{events:[{id:'current',name:'当前活动',date:'2026-10-12',slot:'下午',capacity:5,remaining:1}]}}));
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{participant:{},registrations:[
  {eventId:'current',code:'old',eventName:'最早报名记录',createdAt:'2026-10-01T10:00:00Z',date:'2026-12-01',slot:'下午',status:'已确认',eventStatus:'已结束'},
  {eventId:'current',code:'middle',eventName:'已签到记录',createdAt:'2026-10-02T10:00:00Z',date:'2026-10-12',slot:'下午',status:'已签到',eventStatus:'已结束'},
  {eventId:'current',code:'new',eventName:'最新报名记录',createdAt:'2026-10-03T10:00:00Z',date:'2026-08-30',slot:'上午',status:'待筛选',eventStatus:'报名中'},
 {eventId:'other',code:'foreign',eventName:'另一个活动的记录',date:'2026-12-01',status:'已签到'},
 ]}}));
 await page.goto('/workflow-events?event=current');
 await expect(page.locator('.blood-registration__heading h3')).toHaveText(['最新报名记录','已签到记录','最早报名记录']);
 await expect(page.locator('.blood-registration').first().locator('summary').getByText('取消报名',{exact:true})).toBeVisible();
 await expect(page.locator('.blood-registration').first().locator('summary').getByText('申请请假',{exact:true})).toHaveCount(0);
});

for(const source of ['workflow','managed'])test(`${source} activity shows the wishlist and can subscribe or cancel`,async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const id=source==='workflow'?'full-workflow':'managed:EVT-full';
 const event={eventId:source==='workflow'?'workflow:full-workflow':'EVT-full',workflowId:source==='workflow'?'full-workflow':undefined,name:'合成心愿清单活动',type:'博爱中心',status:'报名中',startAt:'2026-12-01T14:00:00+08:00',capacity:2,remaining:0,full:true,sessions:[]};
 let subscribed=false;
 await page.route('**/api/public/events',r=>r.fulfill({json:{events:[event],facets:{campuses:[]}}}));
 await page.route('**/api/portal/workflow/wishlist',r=>r.fulfill({json:{wishlist:subscribed?[{eventId:id}]:[]}}));
 await page.route('**/api/portal/workflow/events/*/wishlist',r=>{
  subscribed=r.request().method()==='POST';return r.fulfill({json:{ok:true}});
 });
 await page.route('**/api/auth/account',r=>r.fulfill({json:{account:{realName:'合成同学',email:'fixture@smail.nju.edu.cn',emailVerified:true,campus:'仙林'}}}));
 await page.route('**/api/portal/me',r=>r.fulfill({json:{registrations:[]}}));
 await page.route('**/api/public/events/EVT-full',r=>r.fulfill({json:{event,related:[]}}));
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{events:[{id:'full-workflow',name:event.name,category:'博爱中心',date:'2026-12-01',slot:'下午',capacity:2,remaining:0}]}}));
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{registrations:[],participant:{realName:'合成同学',campus:'仙林'}}}));
 await page.goto(source==='workflow'?'/workflow-events?event=full-workflow':'/events/EVT-full');
 await expect(page.getByRole('heading',{name:'我的心愿清单',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'加入心愿清单',exact:true}).click();
 await expect(page.locator('.blood-wish-row')).toContainText(event.name);
 await expect(page.locator('.blood-wish-row a')).toHaveAttribute('href',source==='workflow'?'/workflow-events?event=full-workflow':'/events/EVT-full');
 await page.locator('.blood-wish-row').getByRole('button',{name:'取消空位提醒',exact:true}).click();
 await expect(page.locator('.blood-wish-row')).toHaveCount(0);
});
