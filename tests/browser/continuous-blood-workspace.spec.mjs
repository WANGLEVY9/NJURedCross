import {test,expect} from '@playwright/test';

test('generated monthly schedule keeps registration, partial input and review accessible together',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood');
 expect(event).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.getByRole('button',{name:'报名审核与通知',exact:true})).toBeVisible();
 await pane.getByRole('button',{name:'排班来源与模板',exact:true}).click();
 const template=page.getByRole('dialog',{name:'排班来源与模板',exact:true});
 await expect(template).toContainText('无需用“新建活动”或“来源活动纳入”重复导入');
 await expect(template).toContainText('新街口中央');
 await template.getByRole('contentinfo').getByRole('button',{name:'关闭',exact:true}).click();
 await pane.getByRole('button',{name:'签到与分批录入',exact:true}).click();
 await expect(pane.getByRole('region',{name:'签到核验与时长录入'})).toBeVisible();

 await expect(pane.locator('.service-position-legend')).toHaveCount(0);
 await expect(pane.getByRole('button',{name:'去审核时长 →',exact:true})).toBeVisible();
 await expect(pane.locator('.service-desktop-records')).toBeVisible();
 await expect(pane.locator('.service-mobile-records')).toBeHidden();
 const mobile=await page.evaluate(()=>matchMedia('(max-width:960px)').matches);
 const attendanceScroll=mobile?pane:pane.locator('.activity-legacy-content');
 if(mobile)expect(await pane.locator('.activity-legacy-content').evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
 await attendanceScroll.hover();await page.mouse.wheel(0,600);
 await expect.poll(()=>attendanceScroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
 await page.screenshot({path:test.info().outputPath('schedule-attendance-scrolled.png'),fullPage:true});
 await attendanceScroll.evaluate(el=>el.scrollTop=0);
 await pane.getByRole('button',{name:'时长审核与导出',exact:true}).click();
 await expect(pane.locator('.service-workspace')).toBeVisible();
 const table=pane.locator('.service-table-scroll');
 await expect(table).toBeVisible();
 expect(await table.evaluate(el=>({max:getComputedStyle(el).maxHeight,clipped:el.scrollHeight>el.clientHeight+2}))).toEqual({max:'none',clipped:false});
 const scroller=attendanceScroll;
 expect(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight+50)).toBeTruthy();
 await scroller.hover();await page.mouse.wheel(0,650);
 await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
 await page.screenshot({path:test.info().outputPath('schedule-review-scrolled.png'),fullPage:true});
 await scroller.evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:test.info().outputPath('schedule-review.png'),fullPage:true});
 await expect(pane.getByRole('button',{name:'时长审核与导出',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();
 await expect(pane.getByRole('button',{name:'时长审核与导出',exact:true})).toHaveAttribute('aria-pressed','true');
 await pane.getByRole('button',{name:'报名审核与通知',exact:true}).click();
 await expect(pane.locator('.activity-legacy-roster')).toBeVisible();
 await expect(pane.locator('.activity-legacy-roster__table thead')).toBeVisible();
 await expect(pane.locator('.activity-legacy-roster__filters .field')).toHaveCount(3);
 await scroller.hover();await page.mouse.wheel(0,700);
 await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(50);
 await page.screenshot({path:test.info().outputPath('schedule-registration-scrolled.png'),fullPage:true});
 await scroller.evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:test.info().outputPath('schedule-registration.png'),fullPage:true});
 await expect(pane.getByRole('button',{name:'管理负责人',exact:true})).toHaveCount(0);
});

test('ordinary activities retain stage controls without parallel scheduling tools',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>!JSON.parse(row['报名页配置']||'{}').source?.kind&&!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);
 expect(event).toBeTruthy();await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.locator('.activity-legacy-workspace')).toBeVisible();
 await expect(pane.getByRole('button',{name:'报名审核与通知',exact:true})).toHaveCount(0);
 await expect(pane.getByRole('button',{name:'排班来源与模板',exact:true})).toHaveCount(0);
});


test('management page main areas allow wheel scrolling across sections',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 for(const path of ['overview','admin','outreach','community','materials','messages','agent']){
  await page.goto(`/console/${path}`);
  const main=page.locator('.wsmain');await expect(main).toBeVisible();
  await expect(main.locator('h1').first()).toBeVisible();
  await main.evaluate(el=>{const marker=document.createElement('div');marker.style.height='1800px';marker.textContent='滚动容器测试末尾';el.append(marker);});
  await main.hover();await page.mouse.wheel(0,650);
  await expect.poll(()=>main.evaluate(el=>el.scrollTop),{message:`${path} main scrolling`}).toBeGreaterThan(50);
 }
});

test('monthly source registration can be closed and reopened without losing existing bookings',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood'&&row['状态']==='报名中');
 expect(event).toBeTruthy();
 const initial=(await (await page.request.get(`/api/volunteer/workflow/events/${event._id}/detail`)).json()).registrations;
 await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await pane.getByRole('button',{name:'全月结束报名',exact:true}).click();
 const confirm=page.getByRole('dialog');await expect(confirm).toContainText('后续新增场次继承该选择');
 await confirm.getByRole('button',{name:'结束报名',exact:true}).click();
 await expect(pane.getByRole('button',{name:'全月开放报名',exact:true})).toBeVisible();
 await expect(pane.locator('.source-registration-card').first()).toContainText('报名已结束');
 const closed=(await (await page.request.get('/api/public/workflow/events')).json()).events;
 expect(closed.filter(row=>row.blood&&row.date.startsWith(event['报名日期'].slice(0,7)))).toHaveLength(0);
 await page.reload();
 await expect(pane.getByRole('button',{name:'全月开放报名',exact:true})).toBeVisible();
 const after=(await (await page.request.get(`/api/volunteer/workflow/events/${event._id}/detail`)).json()).registrations;
 expect(after).toEqual(initial);
 await pane.getByRole('button',{name:'全月开放报名',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'开放报名',exact:true}).click();
 await expect(pane.locator('.source-registration-card').first().getByRole('button',{name:'结束报名',exact:true})).toBeVisible();
 const reopened=(await (await page.request.get('/api/public/workflow/events')).json()).events;
 expect(reopened.some(row=>row.id===event._id)).toBeTruthy();
 await page.screenshot({path:test.info().outputPath('source-registration-control.png'),fullPage:true});
});

test('a filtered selection applies one registration decision to the listed shifts only',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const source=events.filter(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood'&&row['状态']==='报名中');
 const event=source[0],sibling=source.find(row=>row['报名日期']!==event['报名日期']);
 expect(sibling).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}&scheduleTask=sessions`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await page.getByLabel('场次日期',{exact:true}).fill(event['报名日期']);
 await page.getByLabel('场次日期',{exact:true}).dispatchEvent('change');
 await expect(pane.locator('.source-registration-card').first()).toBeVisible();
 await pane.getByRole('button',{name:'批量结束报名',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'结束报名',exact:true}).click();
 await expect(pane.locator('.source-registration-card').first()).toContainText('报名已结束');
 const closed=(await (await page.request.get('/api/public/workflow/events')).json()).events;
 expect(closed.some(row=>row.id===event._id)).toBe(false);
 expect(closed.some(row=>row.id===sibling._id)).toBe(true);
 await pane.getByRole('button',{name:'批量开放报名',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'开放报名',exact:true}).click();
 await expect(pane.locator('.source-registration-card').first()).toContainText('报名开放');
 const reopened=(await (await page.request.get('/api/public/workflow/events')).json()).events;
 expect(reopened.some(row=>row.id===event._id)).toBe(true);
 await page.screenshot({path:test.info().outputPath('source-selection-control.png'),fullPage:true});
});

test('source registration API enforces CSRF and current regional authority',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood');
 const path=`/api/volunteer/workflow/events/${event._id}/source-registration`,data={enabled:false,revision:0};
 expect((await page.request.post(path,{data})).status()).toBe(403);
 expect((await page.request.post(path,{headers:{'x-csrf-token':'synthetic-ui'},data:{...data,actor:'forged'}})).status()).toBe(400);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 expect((await page.request.post(path,{headers:{'x-csrf-token':'synthetic-ui'},data})).status()).toBe(403);
 const unchanged=(await (await page.request.get('/api/public/workflow/events')).json()).events;
 expect(unchanged.some(row=>row.id===event._id)).toBeTruthy();
});


test('a source shift can be closed and reopened repeatedly while another remains open',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const source=events.filter(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood'&&row['状态']==='报名中');
 const [event,sibling]=source;expect(sibling).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}&scheduleTask=sessions`);
 const card=page.locator(`[data-session="${event._id}"]`);
 for(let i=0;i<2;i++){
  await card.getByRole('button',{name:'结束报名',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'结束报名',exact:true}).click();
  await expect(card.getByRole('button',{name:'开放报名',exact:true})).toBeVisible();
  const closed=(await (await page.request.get('/api/public/workflow/events')).json()).events;
  expect(closed.some(row=>row.id===event._id)).toBe(false);expect(closed.some(row=>row.id===sibling._id)).toBe(true);
  await page.reload();await expect(card.getByRole('button',{name:'开放报名',exact:true})).toBeVisible();
  await card.getByRole('button',{name:'开放报名',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'开放报名',exact:true}).click();
  await expect(card.getByRole('button',{name:'结束报名',exact:true})).toBeVisible();
 }
 await page.getByLabel('场次日期',{exact:true}).fill(event['报名日期']);await page.getByLabel('场次日期',{exact:true}).dispatchEvent('change');
 await page.getByLabel('搜索点位或时段',{exact:true}).fill(event['地点']);
 await expect(card).toBeVisible();
 expect(await page.locator('.source-registration-list').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await card.scrollIntoViewIfNeeded();
 await page.screenshot({path:test.info().outputPath('source-session-controls.png'),fullPage:true,animations:'disabled'});
});
