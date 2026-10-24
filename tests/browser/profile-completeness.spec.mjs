import {test,expect} from '@playwright/test';
test('profile reminder persists across navigation and disappears after cached profile update',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});let reads=0;const account={accountId:'synthetic-organizer',role:'member',realName:'合成同学',studentId:'999990001',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:''};
 await page.route('**/api/auth/account',route=>{if(route.request().method()==='PATCH'){account.campus='鼓楼';return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步'}}});}reads++;return route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步'}}});});
 await page.goto('/');const reminder=page.locator('.portal-profile-reminder');await expect(reminder).toContainText('校区');await expect(reminder.getByRole('link',{name:'去补全资料',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {navigate}=await import('/app/core/router.js');navigate('/events');});await expect(reminder).toContainText('校区');expect(reads).toBe(1);
 await page.evaluate(async()=>{const {updateAccountProfile}=await import('/app/core/api.js');await updateAccountProfile({campus:'鼓楼'});});await expect(reminder).toBeEmpty();expect(reads).toBe(1);
});
