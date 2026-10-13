import {test,expect} from '@playwright/test';
const payload={ok:true,events:[{_id:'perf-event',活动ID:'perf-event',活动名称:'合成性能验收',状态:'报名中',报名日期:'2030-10-29',报名时段:'08:30-10:30',地点:'合成地点',容量:30,报名页配置:'{}'}],registrations:[],ledger:[],sources:[],sourceWarnings:[]};
test.beforeEach(async({page})=>{await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});});

test('a failed metadata check is distinguishable and can recover independently of the page',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop sidebar connection control');
 let healthy=false;
 await page.route('**/api/health?summary=true',route=>route.fulfill({status:healthy?200:503,json:healthy?{ok:true}:{ok:false,message:'合成数据源故障'}}));
 await page.route('**/api/volunteer/workflow',route=>route.fulfill({json:payload}));
 await page.goto('/console/events');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect(page.getByText('数据连接检查失败',{exact:true})).toBeVisible();
 healthy=true;await page.getByRole('button',{name:'重试数据连接',exact:true}).click();
 await expect(page.getByText('已连接',{exact:true})).toBeVisible();
});

test('one connection reset recovers without leaving the activity skeleton stuck',async({page})=>{
 let reads=0;
 await page.route('**/api/volunteer/workflow',route=>++reads===1?route.abort('connectionreset'):route.fulfill({json:payload}));
 await page.goto('/console/events');
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(reads).toBe(2);
 await expect(page.getByText('活动数据加载失败',{exact:true})).toHaveCount(0);
});

test('failed reads report sanitized client timings without changing retry semantics',async({page})=>{
 const reports=[];let reads=0;
 await page.route('**/api/telemetry/client',route=>{reports.push(route.request().postDataJSON());return route.fulfill({status:204});});
 await page.route('**/api/volunteer/workflow',route=>++reads===1?route.abort('connectionreset'):route.fulfill({json:payload}));
 await page.goto('/console/events');await expect(page.locator('.activity-list-item')).toHaveCount(1);
 await expect.poll(()=>reports.filter(r=>r.route==='/api/volunteer/workflow'&&r.outcome==='network').length).toBe(1);
 expect(reads).toBe(2);
 const r=reports.find(r=>r.outcome==='network');expect(r.clientTrace).toMatch(/^[a-f0-9-]{36}$/);
 expect(Object.keys(r).sort()).toEqual(['clientTrace','durationMs','method','outcome','requestId','route','status'].sort());
});

test('repeat navigation reuses a session snapshot and directory is loaded only on demand',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop navigation timing');
 let reads=0,directoryReads=0;
 await page.route('**/api/volunteer/workflow',async route=>{reads++;await route.fulfill({json:payload});});
 page.on('request',r=>{if(r.url().endsWith('/api/volunteer/workflow/directory'))directoryReads++;});
 await page.goto('/console/events');await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(directoryReads).toBe(0);
 await page.locator('#console-navigation').getByRole('link',{name:'管理员中心',exact:true}).click();
 await expect(page.getByRole('heading',{name:'管理员中心',exact:true})).toBeVisible();
 const start=Date.now();
 await page.locator('#console-navigation').getByRole('link',{name:'活动管理',exact:true}).click();
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
 expect(Date.now()-start).toBeLessThan(1000);expect(reads).toBe(1);
 await page.getByRole('button',{name:'刷新',exact:true}).click();await expect.poll(()=>reads).toBe(2);
});

test('a stalled read exits the skeleton and retry can recover',async({page})=>{
 await page.clock.install();let reads=0;
 await page.route('**/api/volunteer/workflow',()=>{reads++;});
 await page.goto('/console/events');await expect.poll(()=>reads).toBe(1);
 await page.clock.fastForward(12_100);
 await expect(page.getByText('数据加载超时，请重试。',{exact:true})).toBeVisible();
 await expect(page.locator('.activity-region')).not.toHaveAttribute('aria-busy','true');
 await page.unroute('**/api/volunteer/workflow');
 await page.route('**/api/volunteer/workflow',route=>route.fulfill({json:payload}));
 await page.getByRole('button',{name:'重新加载',exact:true}).click();
 await expect(page.locator('.activity-list-item')).toHaveCount(1);
});
