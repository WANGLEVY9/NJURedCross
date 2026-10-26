import {test, expect} from '@playwright/test';

async function fixture(page) {
  const source = await (await page.request.get('/api/public/workflow/events')).json();
  const seed = source.events.find(event => event.blood);
  const events = Array.from({length:7}, (_, i) => ({...seed, id:`return-${i}`, date:`2026-10-${12+i}`, remaining:1, capacity:2}));
  await page.route('**/api/public/workflow/events', route => route.fulfill({json:{...source, events}}));
  await page.route('**/api/portal/workflow/me', route => route.fulfill({json:{participant:{realName:'合成同学', campus:'仙林'}, profile:null, ledger:[], registrations:[
    {code:'RETURN-OLD', eventId:'closed-event', eventName:'已结束的合成活动', date:'2026-09-01', status:'已签到', result:'报名成功', entryStatus:'未录入', eventStatus:'已结束'},
  ]}}));
}

test('today label never shifts the first row, and selected dates remain distinct', async ({page}, info) => {
  await page.request.post('/api/auth/logout');
  await page.clock.setFixedTime(new Date('2026-10-12T04:00:00Z'));
  await fixture(page);
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.locator('.blood-calendar')).toBeVisible();
  for (const width of [390, 900, 1440, 2048]) {
    await page.setViewportSize({width, height:1000});
    const geometry = await page.locator('.blood-calendar__day').evaluateAll(days => days.map(day => {
      const date = day.querySelector('.blood-calendar__date').getBoundingClientRect();
      const slots = day.querySelector('.blood-calendar__slots').getBoundingClientRect();
      return {height:date.height, top:date.top, slots:slots.top};
    }));
    expect(Math.max(...geometry.map(x=>x.height))-Math.min(...geometry.map(x=>x.height))).toBeLessThan(1);
    if(width>700) expect(Math.max(...geometry.map(x=>x.slots))-Math.min(...geometry.map(x=>x.slots))).toBeLessThan(1);
    await page.getByRole('button', {name:'周六 10/17', exact:true}).click();
    await expect(page.locator('.blood-calendar__date[aria-pressed="true"]')).toHaveCount(1);
    const saturday = page.getByRole('button', {name:'周六 10/17', exact:true});
    expect(await saturday.evaluate(node=>getComputedStyle(node).boxShadow)).not.toBe('none');
    await expect(saturday).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  }
  await page.locator('.blood-calendar').screenshot({path:info.outputPath('aligned-calendar.png')});
});

test('signed-out booking returns through login to the same slot and calendar', async ({page}) => {
  await page.request.post('/api/auth/logout');
  await fixture(page);
  await page.goto('/workflow-events?type=blood&week=2026-10-12&slot=return-0');
  const login = page.getByRole('link', {name:'登录后报名', exact:true});
  const next = new URL(await login.getAttribute('href'), 'http://localhost').searchParams.get('next');
  expect(next).toContain('type=blood'); expect(next).toContain('slot=return-0'); expect(next).toContain('week=2026-10-12');
  await login.click();
  await page.getByPlaceholder('请输入本人学号').fill('999990001');
  await page.locator('input[name="password"]').fill('synthetic-only');
  await page.getByRole('button', {name:'登录活动平台', exact:true}).click();
  await expect(page.locator('.blood-calendar')).toBeVisible();
  await expect(page.locator('[data-event-id="return-0"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.blood-signup-controls')).toBeVisible();
  await page.getByRole('button', {name:'返回日历', exact:true}).click();
  await expect(page.locator('[data-event-id="return-0"]')).toBeFocused();
});

test('legacy blood event links still display a calendar', async ({page}) => {
  await fixture(page);
  await page.goto('/workflow-events?event=return-0');
  await expect(page.locator('.blood-calendar')).toBeVisible();
  await expect(page.locator('[data-event-id="return-0"]')).toHaveAttribute('aria-pressed','true');
});

test('member hours distinguish unposted records and link to historical registration', async ({page}, info) => {
  await page.request.post('/api/auth/login', {data:{username:'synthetic-reviewer'}});
  await fixture(page);
  await page.goto('/workflow-events?type=blood&week=2026-10-12');
  await expect(page.locator('.blood-calendar')).toBeVisible();
  await page.evaluate(async()=>{
    const {memberHours} = await import('/app/portal/member-workspace.js');
    document.querySelector('main').replaceChildren(memberHours({profile:null, ledger:[{status:'待批准',serviceHours:4}], registrations:[{code:'RETURN-OLD', eventName:'已结束的合成活动', status:'已签到', result:'报名成功', date:'2026-09-01'}]}));
  });
  await expect(page.locator('.member-hours__metrics strong')).toHaveText(['—','—','—']);
  await expect(page.locator('.member-hours')).toContainText('1 条时长记录正在核对或等待入账');
  await expect(page.getByRole('link',{name:'查看活动与报名状态'})).toHaveAttribute('href','/workflow-events?view=records');
  await page.locator('.member-hours').screenshot({path:info.outputPath('member-hours.png')});
  await page.getByRole('link', {name:'查看报名进度', exact:true}).click();
  await expect(page.locator('#workflow-records')).toContainText('已结束的合成活动');
  expect(await page.locator('#workflow-records').evaluate(node=>node.getBoundingClientRect().top)).toBeLessThan(600);
});
