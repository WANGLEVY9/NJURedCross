import {test,expect} from '@playwright/test';

test('special activity tools live in administrator center, not the activity toolbar',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.route('**/workflow/management-tools',route=>route.fulfill({json:{ok:true,capabilities:{enableRegistry:true,bloodSchedule:true}}}));
 await page.goto('/console/events');
 await expect(page.getByRole('heading',{name:'活动管理',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'启用长期登记项目',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'献血车排班',exact:true})).toHaveCount(0);
 await page.goto('/console/admin');
 await expect(page.getByRole('button',{name:'献血车排班',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'启用长期登记项目',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'启用长期登记项目',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'启用并开始登记',exact:true})).toBeEnabled();
});

test('administrator center hides unavailable tools and supports scheduling-only permission',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 let permitted=false;
 await page.route('**/workflow/management-tools',route=>route.fulfill({json:{ok:true,capabilities:{enableRegistry:false,bloodSchedule:permitted}}}));
 await page.goto('/console/admin');await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'启用长期登记项目',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'献血车排班',exact:true})).toHaveCount(0);
 permitted=true;await page.reload();await expect(page.getByRole('button',{name:'献血车排班',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'启用长期登记项目',exact:true})).toHaveCount(0);
});
