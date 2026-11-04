import {test,expect} from '@playwright/test';

test('existing source qualification removes reminder without a duplicate declaration or resubmitting unchanged selections',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const account={accountId:'synthetic-organizer',role:'member',realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',phone:'13800000000',grade:'历史年级',certificate:''};const writes=[];
 await page.route('**/api/auth/account',route=>{if(route.request().method()==='PATCH'){writes.push(route.request().postDataJSON());Object.assign(account,writes.at(-1));}return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步',options:{grade:['26本']},readonly:{firstAid:'是，CPR+AED/红十字救护证'}}}});});
 await page.goto('/me?view=profile');await expect(page.locator('[name="certificate"]')).toHaveCount(0);await expect(page.getByText('是，CPR+AED/红十字救护证',{exact:true})).toBeVisible();await expect(page.locator('.portal-profile-reminder')).toBeEmpty();
 await page.locator('[name="qq"]').fill('123456780');await page.getByRole('button',{name:'保存个人资料',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({qq:'123456780'});await expect(page.locator('.portal-profile-reminder')).toBeEmpty();
 await page.screenshot({path:info.outputPath('source-certificate-profile.png')});
});

test('super duplicate report displays conflicts without offering automatic destructive actions',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.route('**/api/auth/duplicate-people',route=>route.fulfill({json:{ok:true,total:1,checkedAccounts:2,checkedProfiles:1,groups:[{studentId:'000001',identityConflict:true,rows:[{source:'账号表',id:'a',name:'合成甲'},{source:'个人主页表',id:'p',name:'合成乙'}]}]}}));
 await page.goto('/console/admin');await page.getByRole('button',{name:'检测重复人员',exact:true}).click();const dialog=page.getByRole('dialog',{name:'重复人员检测'});await expect(dialog).toContainText('姓名冲突');await expect(dialog).toContainText('合成乙');await expect(dialog.getByRole('button',{name:/删除|合并/})).toHaveCount(0);await dialog.screenshot({path:info.outputPath('duplicate-report.png')});
});
test('profile reminder persists across navigation and disappears after cached profile update',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});let reads=0;const account={accountId:'synthetic-organizer',role:'member',realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',certificate:'否',phone:''};
 await page.route('**/api/auth/account',route=>{if(route.request().method()==='PATCH'){account.phone='13800000000';return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步'}}});}reads++;return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步'}}});});
 await page.goto('/');const reminder=page.locator('.portal-profile-reminder');await expect(reminder).toContainText('手机号');await expect(reminder.locator('.notice')).toHaveClass(/error/);await expect(reminder.getByRole('link',{name:'去补全资料',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {navigate}=await import('/app/core/router.js');navigate('/events');});await expect(reminder).toContainText('手机号');expect(reads).toBe(1);
 await page.evaluate(async()=>{const {updateAccountProfile}=await import('/app/core/api.js');await updateAccountProfile({phone:'13800000000'});});await expect(reminder).toBeEmpty();expect(reads).toBe(1);
});

test('every required contact clears its reminder after a successful saved update',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const complete={accountId:'synthetic-organizer',role:'member',realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'鼓楼',department:'合成院系',qq:'123456789',wechat:'synthetic_wechat',gender:'女',certificate:'是，CPR+AED/红十字救护证',phone:'13800000000'};let account;
 await page.route('**/api/auth/account',route=>{if(route.request().method()==='PATCH')Object.assign(account,route.request().postDataJSON());return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步',readonly:{firstAid:complete.certificate}}}});});
 for(const [key,label]of [['phone','手机号'],['qq','QQ号'],['wechat','微信号'],['gender','性别'],['campus','校区'],['department','院系']]){
  account={...complete,[key]:''};await page.goto('/');const reminder=page.locator('.portal-profile-reminder');await expect(reminder).toContainText(label);
  await page.evaluate(async patch=>{await(await import('/app/core/api.js')).updateAccountProfile(patch);},{[key]:complete[key]});await expect(reminder).toBeEmpty();
 }
});
