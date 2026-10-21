import {test,expect} from '@playwright/test';
test('every console administrator retains the activity navigation and can open its page',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/auth/session',async route=>{
  const response=await route.fetch(),payload=await response.json();
  payload.user.permissions=['community'];payload.user.consoleAccess=true;
  await route.fulfill({response,json:payload});
 });
 await page.goto('/console/overview');
 const entry=page.locator('a[href="/console/events"]').first();await expect(entry).toBeAttached();
 await page.goto('/console/events');await expect(page).toHaveURL(/\/console\/events/);
 await expect(page.getByRole('heading',{name:'活动管理',exact:true})).toBeVisible();
});
