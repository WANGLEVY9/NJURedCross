import {test,expect} from '@playwright/test';

const date='2026-10-31';
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});

test('public booking and every position display full date ranges to minutes',async({page})=>{
 const slots=[`${date} 08:30:00 — ${date} 11:30:00`,`${date} 23:30:25 — 2026-11-01 01:30:59`];
 const expected=[`${date} 08:30 — ${date} 11:30`,`${date} 23:30 — 2026-11-01 01:30`];
 const entries=slots.map((slot,index)=>({id:`minute-${index}`,name:'合成多岗位活动',date,slot,position:`合成岗位${index}`,location:'合成点位',capacity:5,remaining:5,registrationOpen:true,status:'报名中',ordinary:{groupId:'minutes',start:`${date}T08:30:00+08:00`,end:`${date}T11:30:00+08:00`,campus:'仙林'},registrationEnd:`${date}T07:30:45+08:00`}));
 const event={eventId:'workflow:minute-0',workflowId:'minute-0',name:'合成多岗位活动',status:'报名中',type:'生命中心',startAt:`${date}T08:30:00+08:00`,endAt:`${date}T11:30:00+08:00`,remaining:10,sessions:[]};
 await page.route('**/api/public/events**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/public/events'?{ok:true,events:[event],facets:{categories:[],campuses:[]}}:{ok:true,event}}));
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{ok:true,events:entries}}));
 await page.goto('/events');
 await page.locator('.event-row').filter({hasText:'合成多岗位活动'}).getByRole('link',{name:'查看并报名',exact:true}).click();
 await expect(page.locator('.ordinary-sessions__cutoff strong')).toHaveText(`${date} 07:30`);
 for(let index=0;index<entries.length;index++){
  const choice=page.locator(`.ordinary-sessions__slot[data-event-id="minute-${index}"]`);
  await expect(choice.locator('.ordinary-sessions__time strong')).toHaveText(expected[index]);
  await expect(choice).toHaveAttribute('aria-label',new RegExp(expected[index].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await choice.click();
  await expect(page.locator('.workflow-slot-summary h3')).toHaveText(expected[index]);
  await expect(page.locator('.workflow-event-detail')).not.toContainText(/\d{2}:\d{2}:\d{2}/);
 }
});

test('published notice and the selected activity share minute precision',async({page})=>{
 const slot=`${date} 08:30:00 — ${date} 11:30:00`;
 await page.route('**/api/public/events/**',route=>route.fulfill({json:{ok:true,event:{status:'报名中'}}}));
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{ok:true,events:[{id:'notice-minutes',name:'合成普通活动',date,slot,location:'合成点位',capacity:5,remaining:5,registrationOpen:true,notice:`【活动时间】：${slot}\n【活动内容】：合成服务`}]}}));
 await page.goto('/workflow-events?event=notice-minutes');
 await expect(page.locator('.workflow-slot-summary h3')).toHaveText(`${date} 08:30 — ${date} 11:30`);
 await expect(page.locator('.workflow-published-notice__body')).toContainText(`${date} 08:30 — ${date} 11:30`);
 await expect(page.locator('.workflow-event-detail')).not.toContainText(/\d{2}:\d{2}:\d{2}/);
});
