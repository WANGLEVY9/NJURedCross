import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.request.post('/api/auth/logout'); });

// The server is an in-memory fixture. No production tokens, SMTP or database writes.
for (const path of ['/', '/events', '/materials', '/outreach', '/community', '/about', '/login', '/console/login']) {
  test(`page boots and fits viewport: ${path}`, async ({ page }) => {
    const errors = [];
    const brokenAssets = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (/\/(app|styles|assets)\//.test(response.url()) && response.status() >= 400) brokenAssets.push(response.url());
    });
    await page.goto(path);
    await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(brokenAssets).toEqual([]);
  });
}

test('anonymous member and administrator routes redirect to the correct sign-in', async ({ page }) => {
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/console/workflow');
  await expect(page).toHaveURL(/\/console\/login\?next=/);
});

test('blood calendar renders synthetic slots and supports week navigation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.getByRole('heading', { name: '献血车报名日历' })).toBeVisible();
  await expect(page.getByRole('button', { name: /2026-10-12 新街口中央/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /下周/ }).click();
  await expect(page.getByText(/2026\/10\/19/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

async function adminSignIn(page, username='synthetic-reviewer') {
  await page.request.post('/api/auth/login',{data:{username}});
}

test('seven management sections, centre tabs and legacy routes work', async ({page},testInfo) => {
  await adminSignIn(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/console/admin');
  await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
  if(testInfo.project.name.startsWith('mobile'))await page.getByRole('button',{name:'全部模块',exact:true}).click();
  const nav=page.locator('#console-navigation');
  for(const name of ['总览','管理员中心','活动管理','宣传管理','内建管理','物资管理','红会语录墙'])await expect(nav.getByRole('link',{name,exact:true})).toBeVisible();
  if(testInfo.project.name.startsWith('mobile'))await nav.getByRole('button',{name:'关闭导航',exact:true}).click();
  await page.getByRole('tab',{name:'工作区偏好',exact:true}).click();
  await expect(page.getByRole('heading',{name:'信息密度与导航'})).toBeVisible();
  await page.goto('/console/settings');
  await expect(page).toHaveURL(/\/console\/admin\?view=status/);
  await expect(page.getByRole('tab',{name:'系统状态',exact:true})).toHaveAttribute('aria-selected','true');
  expect(errors).toEqual([]);
});

test('limited administrator keeps personal centre but cannot enter quote management',async({page})=>{
  await adminSignIn(page,'synthetic-events-only');
  await page.goto('/console/admin');
  await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'系统状态',exact:true})).toHaveCount(0);
  await page.goto('/console/quotes');
  await expect(page).toHaveURL(/\/console\/overview\?forbidden=community/);
  const denied=await page.request.get('/api/community/quotes');expect(denied.status()).toBe(403);
});

test('quote wall supports drafting, publishing and offline retention',async({page},testInfo)=>{
  const content=`合成浏览器测试语录 ${testInfo.project.name}`;
  await adminSignIn(page);
  await page.goto('/console/quotes');
  await expect(page.getByRole('heading',{name:'红会语录墙',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新增语录',exact:true}).click();
  await page.getByLabel(/^语录内容/).fill(content);
  await page.getByLabel(/^署名/).fill('合成审核人');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  const item=page.locator('.quote-wall__item').filter({hasText:content});
  await expect(item).toBeVisible();
  await item.getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'发布',exact:true}).click();
  await page.getByRole('tab',{name:'已发布',exact:true}).click();
  await expect(item).toBeVisible();
  await item.getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'下架',exact:true}).click();
  await page.getByRole('tab',{name:'已下架',exact:true}).click();
  await expect(item).toBeVisible();
});

test('blood detail separates identity, keeps compact records and offers vacancy reminders',async({page},testInfo)=>{
 await adminSignIn(page);
 await page.route('**/api/portal/workflow/wishlist',route=>route.fulfill({json:{ok:true,wishlist:[]}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const own=page.locator('.blood-calendar__slot[data-own="true"]').first();
 await own.click();
 await expect(page.locator('.blood-detail-personal')).toContainText('合成测试同学');
 await expect(page.locator('.blood-detail-personal')).toContainText('999990001@smail.nju.edu.cn');
 const record=page.locator('.blood-registration').first();
 await expect(record.locator('.blood-registration__heading')).toContainText('成功');
 await expect(record.locator('details[open]')).toHaveCount(0);
 await record.getByText('活动详情',{exact:true}).click();
 await expect(record).toContainText('报名编号');
 await expect(page.locator('.blood-slot-capacity').first()).toContainText(/\d+\s*\/\s*\d+/);
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await record.getByText('活动详情',{exact:true}).click();
 await page.locator('.workflow-event-detail').screenshot({path:testInfo.outputPath('blood-detail.png')});
 const available=page.locator('.blood-calendar__slot[data-state="available"]:visible').first();
 await available.click();
 const signup=page.getByRole('button',{name:'确认报名此班次',exact:true});
 await expect(signup).toBeVisible();
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(own).toHaveCSS('background-color','rgb(230, 242, 255)');
 }
 await page.locator('.workflow-event-detail').screenshot({path:testInfo.outputPath('blood-signup.png')});
 expect((await signup.boundingBox()).height).toBeGreaterThanOrEqual(48);
 await expect(page.getByRole('heading',{name:'我的心愿清单',exact:true})).toBeVisible();
});

test('full blood slots stay neutral and wishlist cancellation updates the detail',async({page})=>{
 await adminSignIn(page);
 const response=await page.request.get('/api/public/workflow/events');const data=await response.json();
 const slot=data.events.find(e=>e.blood);slot.remaining=0;
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...data,events:[slot]}}));
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,participant:{realName:'合成同学',email:'fixture@example.invalid',campus:'鼓楼'},registrations:[]}}));
 let subscribed=false;
 await page.route('**/api/portal/workflow/wishlist',route=>route.fulfill({json:{ok:true,wishlist:subscribed?[{eventId:slot.id}]:[]}}));
 await page.route('**/api/portal/workflow/events/*/wishlist',route=>{subscribed=route.request().method()==='POST';return route.fulfill({json:{ok:true}});});
 await page.goto(`/workflow-events?type=blood&slot=${encodeURIComponent(slot.id)}`);
 const full=page.locator('.blood-calendar__slot[data-state="full"]');
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(full).toHaveCSS('background-color','rgb(242, 243, 245)');
  await expect(full).toHaveCSS('color','rgb(96, 102, 112)');
 }
 await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'加入心愿清单',exact:true}).click();
 await expect(page.locator('.blood-wish-row')).toHaveCount(1);
 await page.getByRole('button',{name:'取消提醒',exact:true}).click();
 await expect(page.locator('.blood-wish-row')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'加入心愿清单',exact:true})).toBeVisible();
});

test('activity navigation displays a public snapshot while revalidation is still pending',async({page})=>{
 const event={eventId:'fixture-public',name:'合成公开活动',type:'公益活动',status:'报名中',remaining:3,capacity:3,confirmed:0,waitlisted:0,startAt:'2026-10-12T11:00:00+08:00',location:'合成点位',campus:'南京',sessions:[]};
 let calls=0,release;
 const barrier=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/public/events',async route=>{
  calls++;if(calls>1)await barrier;
  return route.fulfill({json:{ok:true,events:[{...event,name:calls>1?'已更新的合成活动':event.name}],facets:{campuses:['南京']}}});
 });
 await page.goto('/events');await expect(page.getByRole('heading',{name:'合成公开活动',exact:true})).toBeVisible();
 expect(calls).toBe(1);
 await page.evaluate(async()=>{const {navigate}=await import('/app/core/router.js');await navigate('/outreach');await navigate('/events');});
 await expect(page.getByRole('heading',{name:'合成公开活动',exact:true})).toBeVisible();
 await expect.poll(()=>calls).toBe(2);release();
 await expect(page.getByRole('heading',{name:'已更新的合成活动',exact:true})).toBeVisible();
});

test('blood calendar does not wait for the personal account summary',async({page})=>{
 await adminSignIn(page);let release;
 const barrier=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/portal/workflow/me',async route=>{await barrier;return route.fulfill({json:{ok:true,participant:{realName:'合成同学',email:'fixture@example.invalid',campus:'鼓楼'},registrations:[]}});});
 await page.route('**/api/portal/workflow/wishlist',route=>route.fulfill({json:{ok:true,wishlist:[]}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const slot=page.locator('.blood-calendar__slot:visible').first();await expect(slot).toBeVisible();await slot.click();
 await expect(page.getByText('正在读取我的报名信息…',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toHaveCount(0);
 release();await expect(page.locator('.blood-detail-personal')).toContainText('合成同学');
 await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toBeVisible();
});

test('blood site and availability sliders combine, retain state and include unscheduled sites', async ({page}, testInfo) => {
 const response=await page.request.get('/api/public/workflow/events');
 const data=await response.json();
 const monday=data.events.filter(e=>e.blood&&e.date==='2026-10-12');
 const central=monday.filter(e=>e.location==='新街口中央');
 expect(central.length).toBeGreaterThan(1);
 central[0].remaining=0;
 let events=monday.filter(e=>e.location!=='浦口弘阳广场');
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...data,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const sites=page.getByRole('radiogroup',{name:'点位筛选'});
 const availability=page.getByRole('radiogroup',{name:'名额筛选'});
 await expect(sites.getByRole('radio')).toHaveCount(5);
 await sites.getByRole('radio',{name:'新街口中央',exact:true}).click();
 await availability.getByRole('radio',{name:'仅看有名额',exact:true}).click();
 await expect(page.locator('.blood-calendar__slot[data-state="full"]')).toHaveCount(0);
 const visibleSlots=page.locator('.blood-calendar__slot:visible');
 await expect(visibleSlots).toHaveCount(1);
 await expect(visibleSlots).toContainText('新街口中央');
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(sites.getByRole('radio',{name:'新街口中央',exact:true})).toHaveAttribute('aria-checked','true');
 await expect(availability.getByRole('radio',{name:'仅看有名额',exact:true})).toHaveAttribute('aria-checked','true');
 await sites.getByRole('radio',{name:'浦口弘阳广场',exact:true}).click();
 await expect(page.locator('.blood-calendar__empty-hint')).toContainText('浦口弘阳广场本周暂无排班');
 await expect(page.locator('.blood-calendar__slot')).toHaveCount(0);
 // Source updates make this site's real shifts appear without changing the filter.
 events=monday;
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(page.locator('.blood-calendar__empty-hint')).toBeHidden();
 await expect(visibleSlots).toHaveCount(2);
 for(const slot of await visibleSlots.all())await expect(slot).toContainText('浦口弘阳广场');
 await sites.getByRole('radio',{name:'浦口弘阳广场',exact:true}).focus();
 await page.keyboard.press('Home');
 await expect(sites.getByRole('radio',{name:'全部点位',exact:true})).toBeFocused();
 await expect(sites.getByRole('radio',{name:'全部点位',exact:true})).toHaveAttribute('aria-checked','true');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.locator('.blood-calendar__header').screenshot({path:testInfo.outputPath('blood-filter-sliders.png')});
});

test('blood signup binds campus to profile and requires notice acknowledgment',async({page},testInfo)=>{
 await adminSignIn(page);
 const data=await (await page.request.get('/api/public/workflow/events')).json();
 const slot=data.events.find(e=>e.blood&&e.remaining>0);
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,participant:{realName:'合成同学',email:'fixture@example.invalid',campus:'仙林',studentId:'999990002',department:'合成院系',grade:'2023级'},registrations:[]}}));
 await page.goto(`/workflow-events?type=blood&slot=${encodeURIComponent(slot.id)}`);
 const detail=page.locator('.workflow-event-detail');
 await expect(detail).toContainText('仙林');
 await expect(detail).toContainText('999990002');
 await expect(detail).toContainText('合成院系');
 await expect(detail).toContainText('2023级');
 await expect(detail).not.toContainText('在会员中心维护个人资料');
 await expect(detail.getByRole('combobox')).toHaveCount(0);
 await expect(detail).not.toContainText('按所选点位与时段参与献血车志愿服务。');
 const submit=detail.getByRole('button',{name:'确认报名此班次'});
 await expect(submit).toBeDisabled();
 const consent=detail.getByRole('checkbox',{name:'我已阅读参与须知，确认报名此班次',exact:false});
 await detail.getByText('我已阅读参与须知，确认报名此班次',{exact:true}).click();await expect(consent).toBeChecked();await expect(submit).toBeEnabled();
 await detail.getByText('我已阅读参与须知，确认报名此班次',{exact:true}).click();await expect(submit).toBeDisabled();
 await detail.getByText('我已阅读参与须知，确认报名此班次',{exact:true}).click();
 if(testInfo.project.name==='desktop-chromium'){
  const left=await detail.locator('.blood-detail-information').boundingBox(),right=await detail.locator('.blood-detail-personal').boundingBox();
  expect(Math.abs(left.y+left.height-right.y-right.height)).toBeLessThanOrEqual(2);
 }
 expect((await detail.locator('.participation-notice p').first().boundingBox()).width).toBeGreaterThan(150);
 await detail.screenshot({path:testInfo.outputPath('blood-notice.png')});
 let sent;
 await page.route('**/api/portal/workflow/events/*/register',route=>{sent=route.request().postDataJSON();return route.fulfill({json:{ok:true}});});
 await submit.click();
 await expect.poll(()=>sent).toEqual({consent:true});
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,participant:{realName:'合成同学',email:'fixture@example.invalid',campus:''},registrations:[]}}));
 await page.reload();
 await expect(detail).toContainText('请先在会员中心完善个人资料中的校区');
 await expect(detail.getByRole('button',{name:'确认报名此班次'})).toHaveCount(0);
 await expect(detail.getByRole('link',{name:'完善个人资料'})).toHaveAttribute('href','/me');
});
