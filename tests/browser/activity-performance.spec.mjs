import {test,expect} from '@playwright/test';
const payload={ok:true,events:[{_id:'perf-event',活动ID:'perf-event',活动名称:'合成性能验收',状态:'报名中',报名日期:'2030-10-29',报名时段:'08:30-10:30',地点:'合成地点',容量:30,报名页配置:'{}'}],registrations:[],ledger:[],sources:[],sourceWarnings:[]};
test.beforeEach(async({page})=>{await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});});

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
