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
 await expect(page.locator('.blood-calendar__slot[data-state="full"]')).toHaveCSS('background-color','rgb(64, 70, 80)');
 await expect(page.locator('.blood-calendar__slot[data-state="confirmed"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('.blood-calendar').screenshot({path:info.outputPath('calendar-states.png'),animations:'disabled'});
 await page.evaluate(()=>document.documentElement.dataset.theme='sail');
 await expect(page.locator('.blood-calendar__slot[data-state="full"]')).toHaveCSS('background-color','rgb(64, 70, 80)');
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
 for(const width of [1280,1440,1920]){
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
 await page.request.post('/api/auth/logout');
 await page.setViewportSize({width:390,height:844});
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.locator('.blood-calendar__slot:visible').first().click();
 await page.getByRole('button',{name:'周二 10/13',exact:true}).click();
 await page.getByRole('button',{name:'返回日历',exact:true}).click();
 await expect(page.getByRole('button',{name:'周二 10/13',exact:true})).toBeFocused();
});
