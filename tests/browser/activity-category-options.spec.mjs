import {test,expect} from '@playwright/test';

const categories=['主席团专项','博爱中心','生命中心','综事中心','一加助残专项','献血车专项'];
test('category filters, new activity and approval defaults share the fixed taxonomy',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');
 await page.getByRole('combobox',{name:'活动类别',exact:true}).click();
 await expect(page.getByRole('option')).toHaveText(['全部类别',...categories]);
 await page.getByRole('option',{name:'全部类别',exact:true}).click();
 await page.getByRole('button',{name:'新建活动',exact:true}).click();
 await page.locator('.activity-create-form').getByRole('combobox',{name:'活动类别',exact:true}).click();
 // Blood vehicle shifts are created by NJUTable automation, not this manual form.
 await expect(page.getByRole('option')).toHaveText(['请选择活动类别',...categories.filter(c=>c!=='献血车专项')]);
 await page.screenshot({path:info.outputPath('fixed-activity-categories.png'),fullPage:true,animations:'disabled'});
 const response=await page.request.get('/api/volunteer/workflow/approval-routing');
 expect((await response.json()).categories.map(c=>c.category)).toEqual(categories);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
