import {test,expect} from '@playwright/test';
test('approved activity calendar has ordered navigation, shared colours and month/week views',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/calendar');
 await expect(page.getByRole('heading',{name:'活动日历',exact:true})).toBeVisible();
 await expect(page.getByText('已同步 ·',{exact:false})).toBeVisible();

 await expect(page.locator('.activity-calendar-grid')).toBeVisible();
 await expect(page.locator('.activity-calendar-day')).toHaveCount(42);
 const data=await(await page.request.get('/api/volunteer/workflow/calendar')).json();expect(data.ok).toBe(true);expect(data.events.length).toBeGreaterThan(0);
 await page.getByRole('button',{name:'周',exact:true}).click();await expect(page.locator('.activity-calendar-day')).toHaveCount(7);
 await page.getByRole('button',{name:'今天',exact:true}).click();await expect(page.locator('.is-today')).toHaveCount(1);
 await page.getByRole('button',{name:'月',exact:true}).click();
 expect(await page.locator('.activity-calendar-card').count()).toBeGreaterThan(0);
 await page.locator('.is-today').scrollIntoViewIfNeeded();
 const more=page.getByRole('button',{name:/另有 .* 项活动/}).first();if(await more.count()){await more.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);}
 await page.screenshot({path:test.info().outputPath('activity-calendar.png'),fullPage:true});

});


test('multi-day activities span columns and continue into the next week',async({page})=>{
 test.skip(process.env.PREVIEW_SPECIAL_ACTIVITIES!=='1','Requires synthetic multi-day examples');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/calendar');
 const bars=page.locator('.activity-calendar-span').filter({hasText:'校园公益文化周（合成）'});
 await expect(bars).toHaveCount(2);
 await expect(bars.first()).toHaveClass(/calendar-start-4/);await expect(bars.first()).toHaveClass(/calendar-length-4/);
 await expect(bars.last()).toHaveClass(/calendar-length-1/);
 expect(await bars.first().evaluate(el=>getComputedStyle(el).gridColumnEnd)).toBe('span 4');
 await bars.first().scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('multi-day-calendar.png'),fullPage:true});
});
