import {test,expect} from '@playwright/test';
const payload={ok:true,events:[{_id:'perf-event',活动ID:'perf-event',活动名称:'合成性能验收',状态:'报名中',报名日期:'2030-10-29',报名时段:'08:30-10:30',地点:'合成地点',容量:30,报名页配置:'{}'}],registrations:[],ledger:[],sources:[],sourceWarnings:[]};
test.beforeEach(async({page})=>{await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});});

test('catalog renders before detail and a late selection cannot overwrite the active project',async({page})=>{
 const events=['first','second'].map(id=>({...payload.events[0],_id:id,活动ID:id,活动名称:id}));
 let release;const held=new Promise(resolve=>{release=resolve;});let sources=0;
 await page.route('**/api/volunteer/workflow/catalog',r=>r.fulfill({json:{ok:true,lazyDetails:true,events}}));
 await page.route('**/api/volunteer/workflow/sources',r=>{sources++;return r.fulfill({json:{sources:[]}});});
 await page.route('**/api/volunteer/workflow/events/*/detail',async r=>{
  const event=events.find(e=>r.request().url().includes(`/events/${e._id}/`));
  if(event._id==='first')await held;
  await r.fulfill({json:{events:[event],registrations:[],ledger:[]}});
 });
 try{
  await page.goto('/console/events?legacy=1');await expect(page.locator('.activity-list-item')).toHaveCount(2);
  if((await page.viewportSize()).width<=800)await page.locator('[data-object-id="first"]').click();
  await expect(page.getByText('正在加载此活动详情…',{exact:true})).toBeVisible();expect(sources).toBe(0);
  if((await page.viewportSize()).width<=800)await page.getByRole('button',{name:'返回活动清单'}).click();
  await page.locator('[data-object-id="second"]').click();await expect(page.locator('.activity-detail h2').first()).toHaveText('second');
  const response=page.waitForResponse(r=>r.url().endsWith('/events/first/detail'));release();await response;
  await expect(page.locator('.activity-detail h2').first()).toHaveText('second');
  if((await page.viewportSize()).width<=800)await page.getByRole('button',{name:'返回活动清单'}).click();
  await page.getByRole('tab',{name:'待配置',exact:true}).click();await expect.poll(()=>sources).toBe(1);
 }finally{release();}
});

test('a failed metadata check is distinguishable and can recover independently of the page',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop sidebar connection control');
 let healthy=false;
 await page.route('**/api/health?summary=true',route=>route.fulfill({status:healthy?200:503,json:healthy?{ok:true}:{ok:false,message:'合成数据源故障'}}));
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:payload}));
 await page.goto('/console/events?legacy=1');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect(page.getByText('数据连接检查失败',{exact:true})).toBeVisible();
 healthy=true;await page.getByRole('button',{name:'重试数据连接',exact:true}).click();
 await expect(page.getByText('已连接',{exact:true})).toBeVisible();
});

test('one connection reset recovers without leaving the activity skeleton stuck',async({page})=>{
 let reads=0;
 await page.route('**/api/volunteer/workflow/catalog',route=>++reads===1?route.abort('connectionreset'):route.fulfill({json:payload}));
 await page.goto('/console/events?legacy=1');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(reads).toBe(2);
 await expect(page.getByText('活动数据加载失败',{exact:true})).toHaveCount(0);
});

test('a stalled first read recovers automatically before the overall deadline',async({page})=>{
 await page.clock.install();let reads=0;
 await page.route('**/api/volunteer/workflow/catalog',route=>{if(++reads===1)return;return route.fulfill({json:payload});});
 await page.goto('/console/events?legacy=1');await expect.poll(()=>reads).toBe(1);
 await page.clock.fastForward(6_100);
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(reads).toBe(2);
 await expect(page.getByText('数据加载超时，请重试。',{exact:true})).toHaveCount(0);
});

test('failed reads report sanitized client timings without changing retry semantics',async({page})=>{
 const reports=[];let reads=0;
 await page.route('**/api/telemetry/client',route=>{reports.push(route.request().postDataJSON());return route.fulfill({status:204});});
 await page.route('**/api/volunteer/workflow/catalog',route=>++reads===1?route.abort('connectionreset'):route.fulfill({json:payload}));
 await page.goto('/console/events?legacy=1');await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect.poll(()=>reports.filter(r=>r.route==='/api/volunteer/workflow/catalog'&&r.outcome==='network').length).toBe(1);
 expect(reads).toBe(2);
 const r=reports.find(r=>r.outcome==='network');expect(r.clientTrace).toMatch(/^[a-f0-9-]{36}$/);
 expect(Object.keys(r).sort()).toEqual(['clientTrace','durationMs','method','outcome','requestId','route','status'].sort());
});

test('repeat navigation reuses a session snapshot and directory is loaded only on demand',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop navigation timing');
 let reads=0,directoryReads=0;
 await page.route('**/api/volunteer/workflow/catalog',async route=>{reads++;await route.fulfill({json:payload});});
 page.on('request',r=>{if(r.url().endsWith('/api/volunteer/workflow/directory'))directoryReads++;});
 await page.goto('/console/events?legacy=1');await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(directoryReads).toBe(0);
 await page.locator('#console-navigation').getByRole('link',{name:'管理员中心',exact:true}).click();
 await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
 const start=Date.now();
 await page.evaluate(async()=>{const {navigate}=await import('/app/core/router.js');await navigate('/console/events?legacy=1');});
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(Date.now()-start).toBeLessThan(1000);expect(reads).toBe(1);
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>reads).toBe(2);
});

test('a stalled read exits the skeleton and retry can recover',async({page})=>{
 await page.clock.install();let reads=0;
 await page.route('**/api/volunteer/workflow/catalog',()=>{reads++;});
 await page.goto('/console/events?legacy=1');await expect.poll(()=>reads).toBe(1);
 await page.clock.fastForward(12_100);
 await expect(page.getByText('数据加载超时，请重试。',{exact:true})).toBeVisible();
 await expect(page.locator('.activity-region')).not.toHaveAttribute('aria-busy','true');
 await page.unroute('**/api/volunteer/workflow/catalog');
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:payload}));
 await page.getByRole('button',{name:'重新加载',exact:true}).click();
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
});
