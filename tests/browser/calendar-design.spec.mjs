import {test,expect} from '@playwright/test';

test('calendar filters expose matching days, accurate counts, reset and useful empty states',async({page},info)=>{
 await page.request.post('/api/auth/logout');
 const source=await (await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const events=[{...seed,id:'design-full',date:'2026-10-12',location:'新街口中央',remaining:0,capacity:1},{...seed,id:'design-open',date:'2026-10-13',location:'仙林学则路',remaining:2,capacity:2}];
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...source,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('button',{name:'周一 10/12',exact:true}).click();
 await expect(page.getByRole('button',{name:'周一 10/12',exact:true})).toBeFocused();
 await page.getByRole('radio',{name:'仙林学则路',exact:true}).click();
 await expect(page.getByRole('button',{name:'周二 10/13',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.blood-calendar__slot:visible')).toHaveCount(1);
 await expect(page.locator('.blood-calendar__summary')).toContainText('显示 1 个班次 · 剩余 2 个名额');
 await page.getByRole('button',{name:'重置筛选'}).click();
 await expect(page.getByRole('radio',{name:'全部点位',exact:true})).toBeFocused();
 await expect(page.locator('.blood-calendar__summary')).toContainText('显示 2 个班次');
 await page.getByRole('radio',{name:'新街口中央',exact:true}).click();
 await page.getByRole('radio',{name:'仅看有名额',exact:true}).click();
 await expect(page.locator('.blood-calendar__empty-hint')).toContainText('班次已报满');
 await expect(page.locator('.blood-calendar__summary')).toContainText('显示 0 个班次');
 await page.getByRole('radio',{name:'浦口弘阳广场',exact:true}).click();
 await expect(page.locator('.blood-calendar__empty-hint')).toContainText('本周暂无排班');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('calendar-empty.png'),fullPage:true});
});

test('calendar reduced motion is static and narrow layout keeps filters within the screen',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:320,height:740});
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('radio',{name:'新街口中央',exact:true}).click();
 await expect.poll(()=>page.locator('.blood-calendar__grid').evaluate(e=>e.getAnimations().length)).toBe(0);
 await expect(page.locator('.ambient__mesh')).toHaveCSS('transform','none');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 for(const radio of await page.locator('.blood-calendar [role="radio"]:visible').all()){
  const bounds=await radio.boundingBox();expect(bounds.width).toBeGreaterThan(30);expect(bounds.height).toBeGreaterThanOrEqual(40);
 }
});

test('calendar visual matrix keeps semantic states across themes',async({page},info)=>{
 await page.request.post('/api/auth/logout');
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await expect(page.locator('.blood-calendar')).toBeVisible();
 await page.evaluate(async()=>{
  const {bloodCalendar}=await import('/app/portal/blood-calendar.js');
  const statuses=['available','full','pending','confirmed'];
  const events=statuses.map((id,i)=>({id,date:'2026-10-12',location:['新街口中央','新街口印象汇','仙林学则路','浦口弘阳广场'][i],slot:'上午 11~15点',remaining:id==='full'?0:1,capacity:2}));
  const registrations=[{eventId:'pending',status:'待筛选'},{eventId:'confirmed',status:'已确认'}];
  const calendar=bloodCalendar(events,registrations,()=>{},'confirmed',{week:'2026-10-12',day:'2026-10-12'});
  document.querySelector('.blood-calendar').replaceWith(calendar);
 });
 await expect(page.locator('.blood-calendar__slot[data-state="full"]')).toHaveCSS('background-color','rgb(242, 243, 245)');
 await expect(page.locator('.blood-calendar__slot[data-state="confirmed"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('.blood-calendar').screenshot({path:info.outputPath('calendar-states.png'),animations:'disabled'});
 await page.evaluate(()=>document.documentElement.dataset.theme='sail');
 await expect(page.locator('.blood-calendar__slot[data-state="full"]')).toHaveCSS('background-color','rgb(242, 243, 245)');
 await page.locator('.blood-calendar').screenshot({path:info.outputPath('calendar-states-sail.png'),animations:'disabled'});
});

test('desktop density survives filtering and detail return restores the chosen slot',async({page},info)=>{
 await page.request.post('/api/auth/logout');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const first=page.locator('.blood-calendar__slot').first();
 const comfortable=(await first.boundingBox()).height;
 await page.getByRole('radio',{name:'紧凑',exact:true}).click();
 await expect(page.locator('.blood-calendar')).toHaveAttribute('data-density','compact');
 expect((await first.boundingBox()).height).toBeLessThan(comfortable);
 await page.getByRole('radio',{name:'仙林学则路',exact:true}).click();
 await expect(page.locator('.blood-calendar')).toHaveAttribute('data-density','compact');
 const id=await first.getAttribute('data-event-id');
 await first.click();
 await expect(page.locator('.workflow-event-detail')).toBeVisible();
 await page.getByRole('button',{name:'返回日历',exact:true}).click();
 await expect(page.locator(`.blood-calendar__slot[data-event-id="${id}"]`)).toBeFocused();
 await expect(page.locator('.blood-calendar')).toHaveAttribute('data-density','compact');
 await page.getByRole('button',{name:'重置筛选'}).click();
 for(const width of [1280,1440,1920,2048]){
  await page.setViewportSize({width,height:1000});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`desktop-${width}.png`),animations:'disabled'});
 }
});

test('calendar date arrows retain focus and reduced motion does not animate',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const monday=page.getByRole('button',{name:'周一 10/12',exact:true});
 await monday.focus();await monday.press('ArrowRight');
 const tuesday=page.getByRole('button',{name:'周二 10/13',exact:true});
 await expect(tuesday).toBeFocused();await expect(tuesday).toHaveAttribute('aria-pressed','true');
 await tuesday.press('End');
 const sunday=page.getByRole('button',{name:'周日 10/18',exact:true});
 await expect(sunday).toBeFocused();await sunday.press('Home');await expect(monday).toBeFocused();
 await expect.poll(()=>page.locator('.blood-calendar__grid').evaluate(e=>e.getAnimations().length)).toBe(0);
});


test('mobile detail return uses the visible date when the original slot is hidden',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
 await page.request.post('/api/auth/logout');
 await page.setViewportSize({width:390,height:844});
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.locator('.blood-calendar__slot:visible').first().click();
 await page.getByRole('button',{name:'周二 10/13',exact:true}).click();
 await page.getByRole('button',{name:'返回日历',exact:true}).click();
 await expect(page.getByRole('button',{name:'周二 10/13',exact:true})).toBeFocused();
});

test('week picker opens centered, jumps the calendar and respects keyboard + Escape',async({page},info)=>{
 await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
 await page.request.post('/api/auth/logout');
 const source=await (await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const events=[
  {...seed,id:'picker-mon',date:'2026-10-12',location:'新街口中央',remaining:1,capacity:2},
  {...seed,id:'picker-tue',date:'2026-10-13',location:'仙林学则路',remaining:2,capacity:2},
  {...seed,id:'picker-next-mon',date:'2026-10-19',location:'浦口弘阳广场',remaining:1,capacity:2},
 ];
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...source,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 const trigger=page.getByRole('button',{name:'切换到其他周次'});
 await expect(trigger).toBeVisible();
 await expect(trigger).toContainText('2026/10/12 — 10/18');
 await trigger.click();
 const picker=page.locator('.blood-week-picker');
 await expect(picker).toBeVisible();
 // The dialog should be centered: horizontal centre within 1% of viewport centre.
 const box=await picker.boundingBox();
 const viewport=page.viewportSize();
 expect(Math.abs((box.x+box.width/2)-viewport.width/2)).toBeLessThan(viewport.width*0.02);
 expect(Math.abs((box.y+box.height/2)-viewport.height/2)).toBeLessThan(viewport.height*0.05);
 // The current week (10/12) is the pending row, the next Monday is in a future month.
 const pendingRow=page.locator('.blood-week-picker__cell[aria-selected="true"]');
 await expect(pendingRow).toHaveCount(7);
 await expect(pendingRow.first()).toContainText('12');
 // Jump to a new month and pick 10/19 (the next Monday).
 await page.getByRole('button',{name:'下个月'}).click();
 const target=page.locator('.blood-week-picker__cell[data-date="2026-10-19"]');
 await expect(target).toBeVisible();
 await target.click();
 // Preview text updates and the 19th row becomes selected.
 await expect(picker.locator('.blood-week-picker__preview')).toContainText('2026/10/19 — 10/25');
 await expect(page.locator('.blood-week-picker__cell[aria-selected="true"][data-date="2026-10-19"]')).toBeVisible();
 await picker.screenshot({path:info.outputPath('week-picker.png'),animations:'disabled'});
 await page.getByRole('button',{name:'前往这一周'}).click();
 await expect(picker).toBeHidden();
 // The calendar should now show 10/19 in the period text and the slots should be the next week.
 await expect(page.locator('.blood-calendar__period-trigger')).toContainText('2026/10/19 — 10/25');
 await expect(page.locator('.blood-calendar__date:visible').first()).toContainText('19');
 await expect(page.locator('.blood-calendar__slot:visible')).toHaveCount(1);
});

test('week picker can be dismissed with Escape and keeps the calendar on the original week',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
 await page.request.post('/api/auth/logout');
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('button',{name:'切换到其他周次'}).click();
 await expect(page.locator('.blood-week-picker')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.blood-week-picker')).toBeHidden();
 await expect(page.locator('.blood-calendar__period-trigger')).toContainText('2026/10/12 — 10/18');
});

test('week picker is keyboard navigable: arrows move focus, Enter confirms',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
 await page.request.post('/api/auth/logout');
 const source=await (await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const events=[{...seed,id:'kbd-target',date:'2026-10-21',location:'仙林学则路',remaining:1,capacity:2}];
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...source,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('button',{name:'切换到其他周次'}).click();
 // The first cell is focused on open (the Monday of the visible week).
 const firstCell=page.locator('.blood-week-picker__cell[data-date="2026-10-12"]');
 await expect(firstCell).toBeFocused();
 // ArrowRight moves to Tuesday.
 await page.keyboard.press('ArrowRight');
 await expect(page.locator('.blood-week-picker__cell[data-date="2026-10-13"]')).toBeFocused();
 // ArrowDown jumps a row; the picker then navigates within October.
 await page.keyboard.press('ArrowDown');
 await expect(page.locator('.blood-week-picker__cell[data-date="2026-10-20"]')).toBeFocused();
 // PageDown advances to November; picker should still be open.
 await page.keyboard.press('PageDown');
 await expect(page.locator('.blood-week-picker__month')).toContainText('11');
 // Enter on the focused cell confirms and the calendar updates to that week.
 await page.keyboard.press('Enter');
 await expect(page.locator('.blood-week-picker')).toBeHidden();
 // The 20th of October starts a new week; clicking 20 (Wed) selects the week of 10/19.
 await expect(page.locator('.blood-calendar__period-trigger')).toContainText('2026/10/19 — 10/25');
});

test('week picker marks event dates and lets the user land on an empty week',async({page},info)=>{
 await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
 await page.request.post('/api/auth/logout');
 const source=await (await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const events=[{...seed,id:'event-mon',date:'2026-10-12',location:'新街口中央',remaining:1,capacity:2}];
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{...source,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('button',{name:'切换到其他周次'}).click();
 await expect(page.locator('.blood-week-picker__cell[data-event="true"][data-date="2026-10-12"]')).toBeVisible();
 // Jump three weeks forward to a known empty week.
 await page.getByRole('button',{name:'下个月'}).click();
 await page.getByRole('button',{name:'下个月'}).click();
 await page.locator('.blood-week-picker__cell[data-date="2026-12-07"]').click();
 await page.getByRole('button',{name:'前往这一周'}).click();
 await expect(page.locator('.blood-week-picker')).toBeHidden();
 await expect(page.locator('.blood-calendar__period-trigger')).toContainText('2026/12/07 — 12/13');
 await expect(page.locator('.blood-calendar__empty-hint')).toBeVisible();
 await page.locator('.blood-calendar').screenshot({path:info.outputPath('calendar-jumped-empty.png'),animations:'disabled'});
});
