import {test,expect} from '@playwright/test';

test('console pages load in browsers without AbortSignal.any',async({page})=>{
 await page.addInitScript(()=>{delete AbortSignal.any;});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/materials');
 await expect(page.getByText('这个页面无法加载')).toHaveCount(0);
 await expect(page.getByText('AbortSignal.any is not a function')).toHaveCount(0);
 await expect(page.locator('.wsmain')).toBeVisible();
 await expect(page.getByRole('heading',{name:'物资管理'})).toBeVisible();
 expect(await page.evaluate(()=>typeof AbortSignal.any)).toBe('undefined');
});
