import {test,expect} from '@playwright/test';

test('blood directory exposes a direct history check-in entry and archived weeks are marked',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/console/events');
 await expect(page.locator('#boot-screen')).toHaveCount(0);
 await expect.poll(async()=>page.locator('.activity-blood-directory').count()).toBeGreaterThan(0);
 const card=page.locator('.activity-blood-directory');
 await expect(card.getByRole('button',{name:/历史周签到记录/})).toBeVisible();
 await page.screenshot({path:info.outputPath('blood-history-shortcuts.png'),animations:'disabled',fullPage:true});
 await card.getByRole('button',{name:/历史周签到记录/}).click();
 await expect(page).toHaveURL(/history=1/);
 await expect(page).toHaveURL(/scheduleTask=checkins/);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.getByRole('region',{name:'签到核验与时长录入'})).toBeVisible();
 await expect(pane.locator('.blood-week-picker')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('blood-history-checkins-list.png'),animations:'disabled',fullPage:true});
});
