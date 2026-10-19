import {test,expect} from './legacy-activity-fixture.mjs';

const windowRange={start:'2030-01-12T09:00:00+08:00',end:'2030-01-12T12:00:00+08:00'};
const position={name:'引导',location:'合成地点',campus:'鼓楼',capacity:4,start:windowRange.start,end:windowRange.end,work:'合成岗位任务'};
test('parent overview normalizes legacy display without rewriting saved notice',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'合成旧岗位展示',bookingMode:'grouped',window:windowRange,capacity:480,serviceHours:3,location:'合成地点',work:'合成服务',submit:false}});
 expect(response.ok()).toBe(true);const event=(await response.json()).result;
 const savedNotice=event['通知草稿'];let positionValue=null,slot='2030-01-12 09:00:00 — 2030-01-12 12:00:00';
 const writes=[];page.on('request',r=>{if(r.url().includes('/api/volunteer/workflow')&&r.method()!=='GET')writes.push(r.method());});
 await page.route('**/api/volunteer/workflow/**',async route=>{
  const result=await route.fetch();const data=await result.json();
  if(data.events)data.events=data.events.map(row=>row._id===event._id?{...row,岗位:positionValue,报名时段:slot}:row);
  await route.fulfill({response:result,json:data});
 });
 for(const value of [null,'null','']){
  positionValue=value;
  await page.goto(`/console/events?legacy=1&event=${event._id}&mode=all&tab=overview&scope=session`);
  await expect(page.locator('.panel--activity-config')).toContainText('按岗位配置 · 480 人');
  await expect(page.locator('.activity-detail-head > p.t-caption')).toHaveText(`${slot} · 合成地点`);
  await expect(page.locator('.activity-notice')).toHaveText(savedNotice);
 }
 slot='09:00–12:00';
 await page.reload();
 await expect(page.locator('.activity-detail-head > p.t-caption')).toHaveText('2030-01-12 · 09:00–12:00 · 合成地点');
 expect(writes).toEqual([]);
 const data=await(await page.request.get('/api/volunteer/workflow')).json();
 expect(data.events.find(row=>row._id===event._id)['通知草稿']).toBe(savedNotice);
});
async function mount(page,{status='可发布',config={bookingMode:'unified',window:windowRange},editable=false}={}){
 await page.goto('/login');
 await page.evaluate(async ({status,config,editable})=>{
  const {publicationPanel}=await import('/app/console/pages/activity-management.js');
  const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/styles/activity-publication.css';document.head.append(stylesheet);
  const picker=document.createElement('link');picker.rel='stylesheet';picker.href='/styles/date-time-picker.css';document.head.append(picker);
  window.publicationWrites=[];
  document.body.replaceChildren(publicationPanel({_id:'synthetic-publication','状态':status,'通知草稿':'合成已审核正文'},{config,editable,mutate:async(path,body,method,ack)=>{window.publicationWrites.push({path,body,method});ack?.();}}));
 },{status,config,editable});
}
test('grouped publication requires saved valid positions',async({page})=>{
 await mount(page,{config:{bookingMode:'grouped',window:windowRange}});
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('待配置岗位');
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeDisabled();
 await expect(page.getByText('可发布',{exact:true})).toHaveCount(0);
});
test('legacy grouped parent still marked open can republish a completed plan',async({page})=>{
 const config={bookingMode:'grouped',window:windowRange,positionPlan:{complete:true,deadline:'2030-01-12T08:00:00+08:00',positions:[position]}};
 await mount(page,{status:'报名中',config});
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeDisabled();
 await expect(page.getByLabel('定时发布时间（北京时间）',{exact:true})).toBeDisabled();
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('报名已开放，不能再改为定时发布');
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.publicationWrites)).toEqual([{path:'/events/synthetic-publication/publish',body:{},method:'POST'}]);
 await mount(page,{status:'报名中',config:{...config,positionPlan:{...config.positionPlan,complete:false}}});
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeDisabled();
 await mount(page,{status:'可发布',config});
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeEnabled();
 await expect(page.getByLabel('定时发布时间（北京时间）',{exact:true})).toBeEnabled();
});
test('second precision schedule is independent of notice and includes Shanghai offset',async({page},info)=>{
 await mount(page,{config:{bookingMode:'grouped',window:windowRange,positionDraft:{deadline:'2030-01-12T08:00:00+08:00',positions:[position]}}});
 await page.getByLabel('定时发布时间（北京时间）',{exact:true}).fill('2030-01-11T10:20:17');
 await page.getByRole('button',{name:'选择日期与时间',exact:true}).click();
 await page.getByRole('spinbutton',{name:'秒',exact:true}).fill('23');
 await page.getByRole('button',{name:'应用',exact:true}).click();
 await page.getByRole('button',{name:'定时发布',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.publicationWrites)).toEqual([{path:'/events/synthetic-publication/schedule',body:{publishAt:'2030-01-11T10:20:23+08:00'},method:'POST'}]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('publication-workspace.png'),fullPage:true});
});
test('pending schedule allows cancellation and immediate publication',async({page})=>{
 await mount(page,{status:'报名中',config:{bookingMode:'unified',window:windowRange,publishAt:'2030-01-11T10:20:17+08:00'}});
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('定时发布 · 报名尚未开始');
 await expect(page.getByRole('button',{name:'更新定时发布',exact:true})).toBeEnabled();
 await expect(page.getByLabel('定时发布时间（北京时间）',{exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'取消定时发布',exact:true}).click();
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.publicationWrites)).toEqual([{path:'/events/synthetic-publication/schedule',body:{publishAt:null},method:'POST'},{path:'/events/synthetic-publication/publish',body:{},method:'POST'}]);
});
test('unsaved notice blocks publication and notice save carries no schedule',async({page})=>{
 await mount(page,{editable:true});
 await page.getByLabel('报名通知正文',{exact:true}).fill('合成修改后的通知');
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'保存通知',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.publicationWrites)).toEqual([{path:'/events/synthetic-publication/notice',body:{text:'合成修改后的通知'},method:'PATCH'}]);
});
test('position work and capacity increase remain editable and save together',async({page})=>{
 await page.goto('/login');
 await page.route('**/api/volunteer/workflow/events/synthetic-position/configure-positions',r=>r.fulfill({json:{ok:true,result:{previousCapacity:2,capacity:4,capacityAdjusted:true,previousRegistrationLimit:2,registrationLimit:4,registrationLimitAdjusted:true,draft:true}}}));
 await page.evaluate(async ({windowRange,position})=>{
  const {configureProjectPositions}=await import('/app/console/pages/activity-positions.js');
  configureProjectPositions({_id:'synthetic-position','状态':'草稿','容量':2,'活动名称':'合成岗位','报名页配置':JSON.stringify({window:windowRange,positionDraft:{deadline:'2030-01-12T08:00:00+08:00',positions:[position]}})},()=>{});
 },{windowRange,position});
 await expect(page.locator('.position-editor__overview')).toContainText('保存后活动容量将从 2 提升至 4 人');
 await page.getByLabel('岗位工作内容',{exact:true}).fill('合成岗位详细内容');
 await expect(page.getByLabel('岗位工作内容',{exact:true})).toHaveAttribute('maxlength','500');
 const sent=page.waitForRequest(r=>r.url().endsWith('/configure-positions'));
 await page.getByRole('button',{name:'保存岗位安排',exact:true}).click();
 expect((await sent).postDataJSON().positions[0]).toMatchObject({capacity:'4',work:'合成岗位详细内容'});
 await expect(page.getByRole('dialog',{name:'配置报名岗位'})).toHaveCount(0);
 await expect(page.getByText('岗位安排已保存，等待活动审批；活动容量已从 2 提升至 4 人；报名上限已从 2 提升至 4 人',{exact:true})).toBeVisible();
});

test('approved synthetic activity schedules, cancels and publishes through the real fixture API',async({page})=>{
 const headers={'x-csrf-token':'synthetic-ui'};
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成定时发布闭环',center:'生命中心',bookingMode:'unified',window:windowRange,capacity:4,serviceHours:3,location:'合成地点',work:'合成工作'}});
 expect(response.ok()).toBe(true);const id=(await response.json()).result._id;
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 await page.goto(`/console/events?legacy=1&event=${id}&mode=all&tab=publish`);
 await page.getByLabel('定时发布时间（北京时间）',{exact:true}).fill('2030-01-11T10:20:17');
 await page.getByRole('button',{name:'定时发布',exact:true}).click();
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('报名尚未开始');
 await page.reload();
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('2030-01-11 10:20:17');
 await page.getByRole('button',{name:'取消定时发布',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消定时发布',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeEnabled();
 await page.getByLabel('定时发布时间（北京时间）',{exact:true}).fill('2030-01-11T10:20:18');
 await page.getByRole('button',{name:'定时发布',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消定时发布',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();const event=data.events.find(e=>e._id===id);return {status:event['状态'],publishAt:JSON.parse(event['报名页配置']).publishAt||null};}).toEqual({status:'报名中',publishAt:null});
});
