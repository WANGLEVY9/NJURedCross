import {test,expect} from '@playwright/test';
import {projectWorkflowEvents} from '../../lib/events/public-workflow.js';
import {publicWorkflowEvents} from '../../lib/events/public-workflow-events.js';
import {workflowApprovalHash} from '../../lib/events/workflow.js';
import {bloodPublicWeek} from '../../public/app/shared/blood-publication.js';

test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});

test('public status filters open running and completed workflow details with registration closed',async({page})=>{
 const rows=['报名中','进行中','已结束'].map((status,index)=>{
  const row={_id:`status-${index}`,活动ID:`status-${index}`,活动名称:`合成${status}活动`,活动类别:'生命中心',状态:status,申请版本:'1',批准版本:'1',容量:'5',报名日期:'2026-10-25',报名时段:'09:00–12:00',地点:'合成服务点',工作内容:'合成活动介绍',报名页配置:'{}'};
  row.批准摘要=workflowApprovalHash(row);return row;
 });
 const events=projectWorkflowEvents(rows,[]);
 await page.route('**/api/public/events**',route=>{
  const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4]||'');
  return route.fulfill({json:id?{ok:true,event:events.find(event=>event.eventId===id),related:[]}:{ok:true,events,facets:{categories:['生命中心'],campuses:[]}}});
 });
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{ok:true,events:publicWorkflowEvents({events:rows,registrations:[]})}}));
 for(const status of ['进行中','已结束']){
  await page.goto('/events');
  await expect(page.locator('.event-row')).toHaveCount(4);
  await expect(page.locator('.event-row').first()).toHaveAttribute('data-programme','blood');
  await expect(page.getByRole('link',{name:'查看活动',exact:true})).toHaveCount(2);
  await expect(page.getByRole('link',{name:'查看并报名',exact:true})).toHaveCount(2);
  await page.getByRole('radio',{name:status,exact:true}).click();
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.locator('.event-row')).toContainText(`合成${status}活动`);
  await page.getByRole('link',{name:'查看活动',exact:true}).click();
  await expect(page.locator('.closed-activity-detail')).toContainText(`合成${status}活动`);
  await expect(page.locator('.closed-activity-detail')).toContainText('合成活动介绍');
  await expect(page.locator('.closed-activity-detail')).toContainText('合成服务点');
  await expect(page.locator('.closed-activity-detail')).not.toContainText(/报名|候补|签到|心愿|个人资料/);
  await expect(page.locator('.closed-activity-detail input,.closed-activity-detail button,.workflow-page,.event-booking-panel')).toHaveCount(0);
  await page.goto(`/workflow-events?event=status-${status==='进行中'?1:2}`);
  await expect(page.locator('.closed-activity-detail')).toContainText(`合成${status}活动`);
  await expect(page.locator('.workflow-page')).toHaveCount(0);
 }
 await page.goto('/events');
 await page.getByRole('radio',{name:'报名中',exact:true}).click();
 await expect(page.locator('.event-row')).toHaveCount(2);
 await page.locator('.event-row').filter({hasText:'合成报名中活动'}).getByRole('link',{name:'查看并报名',exact:true}).click();
 await expect(page.locator('.workflow-event-detail')).toContainText('合成报名中活动');
 await expect(page.getByRole('link',{name:'登录后报名',exact:true})).toBeVisible();
});

test('closed legacy activities display static sessions without booking information',async({page})=>{
 await page.route('**/api/public/events/legacy-ended',route=>route.fulfill({json:{ok:true,event:{eventId:'legacy-ended',name:'合成历史活动',status:'已结束',type:'生命中心',description:'合成历史介绍',startAt:'2026-10-25T09:00:00+08:00',endAt:'2026-10-25T12:00:00+08:00',location:'合成服务点',sessions:[{sessionId:'first',startAt:'2026-10-25T09:00:00+08:00',endAt:'2026-10-25T10:00:00+08:00',location:'合成场次地点',remaining:5}]}}}));
 await page.goto('/events/legacy-ended');
 await expect(page.locator('.closed-activity-detail')).toContainText('合成历史介绍');
 await expect(page.locator('.closed-activity-detail')).toContainText('合成场次地点');
 await expect(page.locator('.closed-activity-detail')).not.toContainText(/报名|候补|签到|心愿/);
 await expect(page.locator('.event-booking-panel,.closed-activity-detail button')).toHaveCount(0);
});

test('blood booking entrance stays first and shows the week after next without restricting sessions',async({page})=>{
 const now=Date.now();
 const week=bloodPublicWeek('报名中',now);
 const dates=[-28,-21,-14,-7,0,7].flatMap(offset=>[week.start,week.end].map(day=>{const shifted=new Date(`${day}T00:00:00Z`);shifted.setUTCDate(shifted.getUTCDate()+offset);return shifted.toISOString().slice(0,10);}));
 const rows=dates.map((date,index)=>{
  const row={_id:`blood-${index}`,活动ID:`blood-${index}`,活动名称:`合成献血车${index}`,活动类别:'献血车志愿服务',状态:Date.parse(`${date}T17:00:00+08:00`)<now?'已结束':'报名中',申请版本:'1',批准版本:'1',容量:'5',报名日期:date,报名时段:'09:00–17:00',地点:'合成点位',工作内容:'合成献血车服务介绍',报名页配置:JSON.stringify({blood:{start:`${date}T09:00:00+08:00`,end:`${date}T17:00:00+08:00`}})};
  row.批准摘要=workflowApprovalHash(row);return row;
 });
 const events=projectWorkflowEvents(rows,[],now);
 await page.route('**/api/public/events**',route=>{
  const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4]||'');
  return route.fulfill({json:id?{ok:true,event:events.find(event=>event.eventId===id)}:{ok:true,events,facets:{categories:[],campuses:[]}}});
 });
 await page.goto('/events');
 await expect(page.locator('.event-row')).toHaveCount(1);
 await expect(page.locator('.event-row')).toContainText('献血车志愿服务');
 await expect(page.locator('.event-row [data-fact="date"]')).toContainText(`${week.start} — ${week.end}`);
 await expect(page.getByRole('link',{name:'查看活动',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'查看并报名',exact:true})).toBeVisible();
 await page.getByRole('radio',{name:'报名中',exact:true}).click();
 await expect(page.locator('.event-row')).toHaveCount(1);
 for(const status of ['进行中','已结束']){
  await page.getByRole('radio',{name:status,exact:true}).click();
  await expect(page.locator('.event-row')).toHaveCount(0);
 }
});

test('blood entrance remains first without catalogue sessions and still opens the booking calendar',async({page})=>{
 const week=bloodPublicWeek('报名中');
 const earlier=new Date(`${week.start}T00:00:00Z`);earlier.setUTCDate(earlier.getUTCDate()-7);
 const date=earlier.toISOString().slice(0,10);
 await page.route('**/api/public/events',route=>route.fulfill({json:{ok:true,events:[{eventId:'ordinary',name:'合成其他活动',type:'生命中心',status:'报名中',startAt:'2026-01-01',remaining:5}],facets:{categories:[],campuses:[]}}}));
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{ok:true,events:[{id:'synthetic-blood',name:'合成献血车班次',status:'报名中',date,slot:'09:00–12:00',location:'合成点位',capacity:5,remaining:5,registrationOpen:true,blood:{start:`${date}T09:00:00+08:00`,end:`${date}T12:00:00+08:00`}}]}}));
 await page.goto('/events');
 await expect(page.locator('.event-row')).toHaveCount(2);
 const entry=page.locator('.event-row').first();
 await expect(entry).toHaveAttribute('data-programme','blood');
 await expect(entry).toContainText('报名中');
 await expect(entry).toContainText(`${week.start} — ${week.end}`);
 await expect(entry).toContainText('班次安排待更新');
 await entry.getByRole('link',{name:'查看并报名',exact:true}).click();
 await expect(page.locator('.blood-calendar__slot')).toHaveCount(1);
 await page.locator('.blood-calendar__slot').click();
 await expect(page.getByRole('link',{name:'登录后报名',exact:true})).toBeVisible();
});
