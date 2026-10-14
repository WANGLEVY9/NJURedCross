import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.request.post('/api/auth/logout');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
});

test('personal registration uses themed paper, readable facts and keyboard disclosures',async({page},testInfo)=>{
 const me=await (await page.request.get('/api/portal/workflow/me')).json();
 const record={...me.registrations[0],eventName:'献血车志愿服务（合成测试）',date:'2026-10-13',slot:'上午 10~14点',location:'新街口印象汇',position:'献血车志愿服务岗',status:'待筛选',result:'待确认',entryStatus:'网站待核对',eventStatus:'报名中',leaveStatus:'',attendanceSubmitted:false};
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{...me,registrations:[record]}}));
 let leaveBody;
 await page.route('**/api/portal/workflow/registrations/*/leave',route=>{leaveBody=route.request().postDataJSON();return route.fulfill({json:{ok:true}});});
 await page.goto('/workflow-events?view=records');
 const card=page.locator('.blood-registration');
 await expect(card.locator('.activity-facts')).toContainText(record.location);
 await expect(card.locator('.activity-facts')).toContainText(record.date);
 await expect(card.locator('.registration-progress li[aria-current="step"]')).toContainText('报名确认');
 await expect(card.locator('details[open]')).toHaveCount(0);
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const colours=await card.evaluate(el=>({actual:getComputedStyle(el).backgroundColor,expected:getComputedStyle(el).getPropertyValue('--canvas-raised').trim()}));
  expect(colours.actual).not.toBe('rgb(239, 247, 255)');
  expect(colours.expected).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.evaluate(()=>document.documentElement.dataset.theme='dawn');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:testInfo.outputPath('registration-collapsed.png'),fullPage:true,clip:await card.boundingBox()});
 const details=card.locator('summary').filter({hasText:'活动详情'});
 await details.focus();
 await details.press('Enter');
 await expect(card).toContainText(record.code);
 const offsets=await card.locator('.participation-action[open] .dl__row').evaluateAll(rows=>rows.map(row=>Math.abs(row.children[0].getBoundingClientRect().top-row.children[1].getBoundingClientRect().top)));
 expect(Math.max(...offsets)).toBeLessThanOrEqual(1);
 const leave=card.locator('summary').filter({hasText:'申请请假'});
 await leave.click();
 await expect(card.locator('details[open]')).toHaveCount(2);
 const input=card.getByRole('textbox',{name:'请假原因'});
 await input.fill('合成测试：课程安排冲突');
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:testInfo.outputPath('registration-expanded.png'),fullPage:true,clip:await card.boundingBox()});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await card.getByRole('button',{name:'申请请假',exact:true}).click();
 await expect.poll(()=>leaveBody).toEqual({reason:'合成测试：课程安排冲突'});
});

test('confirmed registration preserves photo submission and shows pending verification',async({page})=>{
 const me=await (await page.request.get('/api/portal/workflow/me')).json();
 const record={...me.registrations[0],status:'已确认',result:'报名成功',entryStatus:'网站待核对',eventStatus:'报名中',leaveStatus:'',attendanceSubmitted:false};
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{...me,registrations:[record]}}));
 let uploaded=false;
 await page.route('**/api/portal/workflow/registrations/*/attendance',route=>{uploaded=true;record.attendanceSubmitted=true;return route.fulfill({json:{ok:true}});});
 await page.goto('/workflow-events?view=records');
 const card=page.locator('.blood-registration');
 await card.locator('summary').filter({hasText:'现场签到'}).click();
 await card.getByLabel('现场签到照片').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('synthetic test image')});
 await card.getByRole('button',{name:'提交照片签到'}).click();
 await expect.poll(()=>uploaded).toBe(true);
 await expect(card.locator('.blood-registration__heading')).toContainText('签到待核验');
 await expect(card.locator('.registration-progress li[aria-current="step"]')).toContainText('签到核验');
 await expect(card.getByRole('button',{name:'提交照片签到'})).toHaveCount(0);
});
