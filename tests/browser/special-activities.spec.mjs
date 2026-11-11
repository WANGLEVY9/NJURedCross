import {test,expect} from '@playwright/test';
import sharp from 'sharp';

test.skip(process.env.PREVIEW_SPECIAL_ACTIVITIES!=='1','Run against the opt-in synthetic special activities fixture.');

test('completed-service registration uploads proof and preserves time and position in the admin table and export',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const manifest=await (await page.request.get('/preview/special-manifest')).json();
 await page.goto('/events/workflow:'+manifest.provinceId);
 await expect(page.getByRole('heading',{name:'省血液献血车 · 服务登记',exact:true})).toBeVisible();
 await page.getByLabel('服务日期').fill(test.info().project.name==='mobile-chromium'?'2026-11-08':'2026-11-10');
 await page.getByLabel('服务开始时间').fill('09:30');
 await page.getByLabel('服务结束时间').fill('13:30');
 await page.getByRole('combobox',{name:'服务岗位',exact:true}).click();
 await page.getByRole('option',{name:'大行宫献血车',exact:true}).click();
 const buffer=await sharp({create:{width:320,height:240,channels:3,background:'#fafafa'}}).png().toBuffer();
 await page.getByLabel('签到凭证',{exact:true}).setInputFiles({name:'synthetic-proof.png',mimeType:'image/png',buffer});
 await page.getByText('本人确认填写信息真实，并同意用于志愿服务登记与核验。',{exact:true}).click();
 const submitted=page.waitForResponse(r=>r.url().includes('/registry-certificate?')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'提交登记',exact:true}).click();
 const response=await submitted,payload=await response.json();expect(payload.ok).toBe(true);
 const proof=await page.request.get('/api/portal/workflow/registrations/'+encodeURIComponent(payload.result.code)+'/registry-certificate');expect(proof.ok()).toBe(true);expect(proof.headers()['content-type']).toMatch(/^image\//);
 await expect(page.getByRole('cell',{name:'09:30–13:30',exact:true}).first()).toBeVisible();
 await expect(page.getByRole('cell',{name:'大行宫献血车',exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath('registry-form.png'),fullPage:true});
 await page.goto('/console/events?event='+manifest.provinceId);
 await expect(page.getByRole('button',{name:'登记记录',exact:true})).toBeVisible();
 await expect(page.locator('.registry-summary')).toContainText('登记记录');
 await expect(page.getByRole('searchbox',{name:'搜索登记记录'})).toBeVisible();
 await expect(page.getByRole('cell',{name:'09:30–13:30',exact:true}).first()).toBeVisible();
 await page.getByRole('searchbox',{name:'搜索登记记录'}).fill('大行宫');
 await expect(page.locator('.registry-table tbody tr')).toHaveCount(test.info().project.name==='mobile-chromium'?2:1);
 await page.getByRole('button',{name:'批量操作',exact:true}).click();
 await expect(page.getByRole('button',{name:'核验通过所选',exact:true})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('registry-admin.png'),fullPage:true});
 const exported=await page.request.get('/api/volunteer/workflow/events/'+manifest.provinceId+'/registry-export.xlsx');
 expect(exported.ok()).toBe(true);
 const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(await exported.body());
 const values=book.worksheets[0].getSheetValues();expect(JSON.stringify(values)).toContain('09:30–13:30');expect(JSON.stringify(values)).toContain('大行宫献血车');
});

test('component donation has proof upload and recurring duty is controlled in the administrator centre',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const manifest=await (await page.request.get('/preview/special-manifest')).json();
 await page.goto('/events/workflow:'+manifest.componentId);
 await expect(page.getByLabel('献血证截图或照片',{exact:true})).toBeVisible();
 await expect(page.getByText('本页不办理献血预约。',{exact:false})).toBeVisible();
 expect(await page.locator('.registry-introduction a').count()).toBe(0);
 await page.goto('/console/admin');
 await expect(page.locator('.admin-card--special .admin-action')).toHaveCount(3);
 await page.locator('.admin-card--special').screenshot({path:test.info().outputPath('special-tools.png')});
 await page.getByRole('button',{name:'省红会组宣部值班',exact:true}).click();
 await expect(page.getByRole('button',{name:'暂停新报名',exact:true})).toBeVisible();
 await expect(page.getByText('周一至周五，09:00–12:00、14:00–17:00',{exact:false})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('recurring-duty.png'),fullPage:true});
 await page.getByRole('button',{name:'暂停新报名',exact:true}).click();
 await page.goto('/console/admin');
 await page.getByRole('button',{name:'省红会组宣部值班',exact:true}).click();
 await expect(page.getByRole('button',{name:'启用常态排班',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'启用常态排班',exact:true}).click();
 const catalog=await (await page.request.get('/api/volunteer/workflow/catalog')).json();
 const duty=catalog.events.find(e=>e['活动名称']==='省红会组宣部值班');expect(duty).toBeTruthy();
 await page.goto('/console/events?event='+duty._id+'&rosterView=board');
 await expect(page.locator('.special-schedule-grid')).toBeVisible();
 await expect(page.locator('.special-schedule-grid')).toContainText('组宣部');
 for(const weekday of ['周一','周二','周三','周四','周五'])await expect(page.locator('.special-schedule-grid')).toContainText(weekday);
 await page.screenshot({path:test.info().outputPath('recurring-duty-board.png'),fullPage:true});
});


test('recurring duty appears once in the square and uses the blood-style five-day weekly calendar',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const catalogue=await (await page.request.get('/api/public/events')).json();
 const duties=catalogue.events.filter(e=>e.recurringDuty);expect(duties).toHaveLength(1);
 expect(duties[0].longTerm).toBe(true);
 await page.goto('/events/'+duties[0].eventId);
 const calendar=page.getByRole('region',{name:'组宣部值班周日历'});
 // A labelled section has region semantics and shares the same booking component as blood shifts.
 await expect(calendar).toBeVisible();
 await expect(calendar.locator('[aria-label="岗位筛选"]')).toHaveCount(0);
 await expect(calendar.getByText('服务岗位',{exact:true})).toHaveCount(0);
 await expect(calendar.locator('.blood-calendar__date')).toHaveCount(5);
 await expect(calendar.locator('.blood-calendar__slot')).toHaveCount(10);
 await expect(calendar.locator('[data-state="closed"]')).not.toHaveCount(0);
 const next=calendar.getByRole('button',{name:'下周',exact:true});await next.click();
 await expect(calendar.locator('.blood-calendar__slot')).toHaveCount(10);
 await expect(calendar.locator('[data-state="closed"]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const upcoming=calendar.locator('.blood-calendar__slot').filter({hasText:'09:00'}).first();await upcoming.click();
 await expect(page.locator('.booking-appointment__copy')).toContainText('2026-11-16');
 await expect(page.getByRole('heading',{name:'我的心愿清单',exact:true})).toBeVisible();
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:test.info().outputPath('duty-public-calendar.png'),fullPage:true});
});


test('all scheduling types use public weekly calendars and keep only useful position filters',async({page})=>{
 test.setTimeout(90_000);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const manifest=await (await page.request.get('/preview/special-manifest')).json();
 expect(new Set(manifest.scheduleExamples.map(e=>e.type)).size).toBe(3);
 for(const example of manifest.scheduleExamples){
  await page.goto('/events/workflow:'+example.id);
  const calendar=page.getByRole('region',{name:'排班活动周日历'});
  await expect(calendar).toBeVisible();
  await expect(page.locator('.ordinary-sessions')).toHaveCount(0);
  await expect(calendar.locator('.blood-calendar__date')).toHaveCount(7);
  if(example.positions===1)await expect(calendar.locator('[aria-label="岗位筛选"]')).toHaveCount(0);
  else{
   await expect(calendar.locator('[aria-label="岗位筛选"]')).toBeVisible();
   await calendar.getByRole('radio',{name:'仙林校医院',exact:true}).click();
   for(const location of await calendar.locator('.blood-slot-location').allTextContents())expect(location).toBe('仙林校医院');
  }
  await calendar.locator('.blood-calendar__slot[data-state="available"]').first().click();
  await page.getByText('我已阅读参与须知',{exact:true}).click();
  await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:test.info().outputPath('public-'+example.type+'-'+example.positions+'.png'),fullPage:true});
 }
});

test('every scheduling type defaults to calendar boards for signup, attendance and final hours',async({page})=>{
 test.setTimeout(90_000);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const manifest=await (await page.request.get('/preview/special-manifest')).json();
 for(const example of [...manifest.scheduleExamples,...manifest.scheduleReadOnlyExamples]){
  await page.goto('/console/events?event='+example.id+(example.status==='已结束'?'&history=1':''));
  await expect(page.locator('.special-schedule-grid')).toBeVisible();
  await expect(page.locator('.special-schedule-grid .blood-card-grid__heading')).toHaveCount(7);
  await page.getByRole('button',{name:'签到与初审',exact:true}).click();
  await expect(page.getByRole('region',{name:'签到审核排班看板'}).locator('.special-schedule-grid')).toBeVisible();
  await page.getByRole('button',{name:'终审与导出',exact:true}).click();
  await expect(page.getByRole('region',{name:'时长审核排班看板'}).locator('.special-schedule-grid')).toBeVisible();
  await expect(page.getByRole('button',{name:'切换为列表',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('admin-hours-'+example.type+'-'+example.positions+'.png'),fullPage:true});
 }
});


test('running and finished schedule details retain a read-only weekly calendar',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const manifest=await (await page.request.get('/preview/special-manifest')).json();
 for(const example of manifest.scheduleReadOnlyExamples){
  await page.goto('/events/workflow:'+example.id);
  const calendar=page.getByRole('region',{name:'排班活动周日历'});
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('.blood-calendar__date')).toHaveCount(7);
  await expect(calendar.locator('.blood-calendar__slot')).toHaveCount(2);
  await expect(calendar.locator('.blood-calendar__slot[data-state="available"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toHaveCount(0);
 }
});
