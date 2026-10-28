import {test,expect} from '@playwright/test';
for(const division of ['主席团','生命','博爱','综事','志愿者'])test(`member profile opens first and department ${division} has appropriate border`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const account={accountId:'synthetic-organizer',role:'member',email:'999990001@smail.nju.edu.cn',realName:'合成测试同学',studentId:'999990001',emailVerified:true};
 await page.route('**/api/auth/account',route=>route.fulfill({json:{ok:true,account,profileMapping:{state:'已同步',readonly:{division},options:{}}}}));
 await page.route('**/api/portal/me',route=>route.fulfill({json:{ok:true,account,registrations:[],submissions:[],enrollments:[]}}));
 await page.goto('/me');const tabs=page.getByRole('tablist',{name:'会员功能'});await expect(tabs.getByRole('tab').first()).toHaveText('个人资料');await expect(page.getByRole('tab',{name:'个人资料',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.plaza-intro__note')).toHaveCount(0);const label=page.locator('.member-department,.member-department-plain');await expect(label).toHaveText(division);
 if(division==='志愿者')await expect(label).toHaveClass('member-department-plain');else expect(await label.evaluate(node=>getComputedStyle(node).borderTopStyle)).toBe('solid');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(division==='生命')await page.screenshot({path:info.outputPath('member-profile.png'),animations:'disabled'});
});
