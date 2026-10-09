import { test, expect } from '@playwright/test';
const profile={realName:'合成同学',studentId:'999990099',gender:'女',campus:'仙林',email:'fixture@example.invalid',missing:[]};
const card={id:'fixture-card',nickname:'合成同行',campus:'仙林',interestTags:['摄影'],note:'一起记录校园',notePreview:'一起记录校园',commentCount:0,status:'已发布'};
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});});
test('morning signup uses shared components and submits a reviewed card',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{ok:true,tags:['摄影','跑步']}}));
 await page.route('**/api/morning/card',r=>r.fulfill({json:r.request().method()==='POST'?{ok:true,card:{...card,status:'待审核'}}:{ok:true,profile,card:null}}));
 await page.goto('/morning');
 await expect(page.getByRole('heading',{name:'早安晚安，从认识彼此开始'})).toBeVisible();
 await page.getByLabel('昵称',{exact:false}).fill('合成同行');
 await page.getByRole('button',{name:'摄影',exact:true}).click();
 await page.getByText('我自愿报名，并接受管理员审核',{exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-signup.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:/提交.*审核|提交报名/}).click();
 await expect(page.locator('#main').getByText('报名已提交',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
test('morning plaza opens a shared detail drawer with private identity omitted',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/morning/cards**',r=>{
 const path=new URL(r.request().url()).pathname;
 return r.fulfill({json:path.endsWith('/comments')?{ok:true,comments:[],card,canComment:true}:path.endsWith('/fixture-card')?{ok:true,card}:{ok:true,cards:[card],stats:{page:1,totalPages:1,total:1,hasPrevious:false,hasNext:false}}});
 });
 await page.goto('/morning/plaza');
 await page.getByRole('link',{name:'查看 合成同行 的名片详情'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog')).toContainText('一起记录校园');
 await expect(page.getByRole('dialog')).not.toContainText(profile.studentId);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-detail.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).last().click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('published members can withdraw using the shared management drawer',async({page})=>{
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{ok:true,tags:['摄影']}}));
 await page.route('**/api/morning/card',r=>r.fulfill({json:{ok:true,profile,card}}));
 await page.route('**/api/morning/cards/*/comments',r=>r.fulfill({json:{ok:true,comments:[]}}));
 await page.route('**/api/morning/card/withdraw',r=>r.fulfill({json:{ok:true,card:{...card,status:'已退出'}}}));
 await page.goto('/morning');await page.getByRole('button',{name:'管理报名'}).click();
 await page.getByRole('button',{name:'退出计划',exact:true}).click();
 await page.getByRole('button',{name:'确认退出',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('已退出计划',{exact:true})).toBeVisible();
});
test('administrators can reach the morning review, report and member views',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/community/morning/**',r=>r.fulfill({json:{ok:true,cards:[],reports:[],members:[],blacklist:[],stats:{}}}));
 await page.goto('/console/community/morning');
 await expect(page.getByRole('radio',{name:'名片审核',exact:true})).toBeVisible();
 await page.getByRole('radio',{name:'举报处理',exact:true}).click();
 await page.getByRole('radio',{name:'成员管理',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-admin.png'),fullPage:true,animations:'disabled'});
 expect(errors).toEqual([]);
});
