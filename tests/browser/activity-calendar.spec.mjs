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


test('all cards share two-line name/status formatting and equal height with compact top alignment',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event=(id,name,date,end=date)=>({_id:id,活动ID:id,活动名称:name,组织类别:'主席团专项',活动地区:'南京地区',状态:'报名中',报名日期:date,报名页配置:JSON.stringify({window:{start:date+'T08:30:00+08:00',end:end+'T10:30:00+08:00'}})});
 await page.route('**/api/volunteer/workflow/calendar',route=>route.fulfill({json:{ok:true,events:[event('a','11.18 献血周志愿服务活动','2026-11-18'),event('b','11.19 献血周志愿服务活动','2026-11-19'),event('c','11.20 单日活动','2026-11-20'),event('d','11.21 周六活动','2026-11-21')]}}));
 await page.goto('/console/calendar');
 const bar=page.locator('.activity-calendar-span').filter({hasText:'献血周志愿服务活动'}),single=page.locator('.activity-calendar-card').filter({hasText:'11.20 单日活动'});
 await expect(bar).toHaveCount(1);await expect(bar.locator('strong')).toHaveText('献血周志愿服务活动');await expect(bar.locator('.activity-calendar-card__meta')).toHaveText('报名中');await expect(bar).toHaveClass(/calendar-length-2/);
 await expect(page.locator('.activity-calendar-card__time')).toHaveCount(0);await expect(single.locator('.activity-calendar-card__meta')).toHaveText('报名中');
 await expect.poll(async()=>Math.abs((await bar.boundingBox()).y-(await single.boundingBox()).y)).toBeLessThan(3);
 await expect(single).toBeVisible();expect((await single.boundingBox()).height).toBe(52);expect((await bar.boundingBox()).height).toBe(52);await expect(single.locator('strong')).toHaveText('11.20 单日活动');
 await bar.scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('compact-calendar.png'),fullPage:true});
 await bar.click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').locator('a')).toHaveCount(2);
});
