import {test,expect} from '@playwright/test';
const event={_id:'field-event',活动ID:'field-event',活动名称:'合成现场服务',状态:'报名中',报名日期:'2030-10-14',报名时段:'09:00-12:00',地点:'合成服务点',活动类别:'生命类',服务时长:3,培训时长:0,交通时长:1,工作内容:'现场引导',容量:200,报名页配置:'{}'};
const registrations=n=>Array.from({length:n},(_,i)=>({_id:`r${i}`,活动ID:event.活动ID,姓名:`志愿者${i}`,学号:`203000${i}`,院系:'合成院系',报名日期:event.报名日期,报名时段:event.报名时段,报名状态:'已确认',创建时间:'2030-10-01',岗位:'现场服务'}));
async function setup(page,n=20){
 const rows=registrations(n);let reads=0,details=0,posts=[];
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/volunteer/workflow/catalog',r=>{reads++;return r.fulfill({json:{events:[event],lazyDetails:true}});});
 await page.route('**/api/volunteer/workflow/events/field-event/detail',r=>{details++;return r.fulfill({json:{events:[event],registrations:rows,ledger:[]}});});
 await page.route('**/api/volunteer/workflow/events/field-event/members',r=>r.fulfill({json:{people:[]}}));
 await page.route('**/api/volunteer/workflow/registrations/*/attendance-detail',r=>r.fulfill({json:{studentId:'203000',hasPhoto:false,legacy:[],warnings:[]}}));
 await page.route('**/api/volunteer/workflow/events/field-event/attendance-batch',r=>{const items=r.request().postDataJSON().items;posts.push(items);return r.fulfill({json:{succeeded:items.length,failed:0,results:items.map(x=>({id:x.id,ok:true}))}});});
 await page.goto('/console/events?event=field-event&tab=checkins');
 await expect(page.getByRole('heading',{name:'④ 签到与时长录入'})).toBeVisible();
 return {rows,reads:()=>reads,details:()=>details,posts};
}
test('field inspector combines evidence and hours, saves once and refreshes only current event',async({page},info)=>{
 let evidence=0;page.on('request',r=>{if(r.url().includes('/attendance-detail'))evidence++;});
 const state=await setup(page);
 await expect(page.locator('.service-table tbody tr')).toHaveCount(20);expect(evidence).toBe(0);
 const row=page.locator('[data-registration-id="r0"]');await row.getByRole('button',{name:'核验并录入',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'志愿者0 · 签到详情'});
 await expect(drawer.getByText('未找到可唯一关联的旧表签到记录；这不代表同学一定未到场。')).toBeVisible();expect(evidence).toBe(1);
 await expect(drawer.getByRole('button',{name:'确认签到并录入时长'})).toBeDisabled();
 await drawer.getByRole('spinbutton',{name:'服务时长 必填',exact:true}).fill('2.5');
 await drawer.locator('label.check').filter({hasText:'已核对签到依据与实际到场情况'}).click();
 await page.screenshot({path:info.outputPath('field-inspector.png'),fullPage:true});
 await drawer.getByRole('button',{name:'确认签到并录入时长'}).click();
 await expect(drawer).toBeHidden();await expect.poll(()=>state.details()).toBe(2);expect(state.reads()).toBe(1);expect(state.posts).toHaveLength(1);expect(state.posts[0][0].hours.serviceHours).toBe('2.5');
});
test('failed inspector submission preserves input and allows deliberate retry',async({page})=>{
 await setup(page,1);let calls=0;
 await page.route('**/api/volunteer/workflow/events/field-event/attendance-batch',r=>{calls++;return r.fulfill({json:{succeeded:0,failed:1,results:[{id:'r0',ok:false,message:'合成核对冲突'}]}});});
 await page.getByRole('button',{name:'核验并录入',exact:true}).click();
 const drawer=page.getByRole('dialog');await drawer.getByRole('spinbutton',{name:'服务时长 必填',exact:true}).fill('2');await drawer.locator('label.check').filter({hasText:'已核对签到依据与实际到场情况'}).click();
 await drawer.getByRole('button',{name:'确认签到并录入时长'}).click();await expect(drawer.getByText('合成核对冲突')).toBeVisible();await expect(drawer.getByRole('spinbutton',{name:'服务时长 必填',exact:true})).toHaveValue('2');expect(calls).toBe(1);
});
for(const count of [0,1,20,200])test(`field list ${count} records keeps phone layout within viewport`,async({page},info)=>{
 await setup(page,count);await expect(page.locator('.service-table tbody tr')).toHaveCount(count);
 if(count){await page.getByRole('searchbox',{name:'记录搜索'}).fill('志愿者0');await expect(page.locator('.service-table tbody tr')).toHaveCount(1);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`field-${count}.png`),fullPage:true});
});
test('review preserves failed selections and retries only failed ledger IDs',async({page})=>{
 await setup(page,2);
 const entries=[0,1].map(i=>({_id:`l${i}`,姓名:`志愿者${i}`,学号:`203000${i}`,活动ID:event.活动ID,报名行ID:`r${i}`,状态:'待批准',核对摘要:'a'.repeat(64),服务时长:3,培训时长:0,交通时长:1}));
 let posts=[];
 await page.route('**/api/volunteer/workflow/events/field-event/hours-review',r=>r.fulfill({json:{entries,registrations:registrations(2),events:[event],rows:entries.map(e=>({...e,志愿者具体工作内容:'现场服务'})),groups:entries.map(e=>({ids:[e._id]})),columns:['姓名','服务时长']}}));
 await page.route('**/api/volunteer/workflow/events/field-event/hours-approve',r=>{posts.push(r.request().postDataJSON().items);return r.fulfill({json:{succeeded:1,failed:1,results:[{id:'l0',ok:true},{id:'l1',ok:false,message:'另一人已更新'}]}});});
 await page.getByRole('tab',{name:'时长审核与导出',exact:true}).click();await page.getByRole('button',{name:'全选当前可审核名单'}).click();await page.getByRole('button',{name:'审核通过',exact:true}).click();
 await expect(page.getByRole('button',{name:'重试未通过记录'})).toBeEnabled();await expect(page.locator('.service-failures')).toContainText('志愿者1');
 await page.getByRole('button',{name:'重试未通过记录'}).click();await expect.poll(()=>posts.length).toBe(2);expect(posts[1].map(i=>i.id)).toEqual(['l1']);
});
test('dirty service fields survive cancelled tab navigation',async({page},info)=>{
 if(info.project.name.includes('mobile')){
  await setup(page,1);await page.getByRole('button',{name:'核验并录入',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'志愿者0 · 签到详情'});
  await drawer.getByRole('spinbutton',{name:'服务时长 必填',exact:true}).fill('2');
  await drawer.getByRole('button',{name:'关闭',exact:true}).first().click();
  const warning=page.getByRole('dialog',{name:'放弃未提交的服务信息？'});
  await expect(warning).toBeVisible();await warning.getByRole('button',{name:'取消',exact:true}).click();
  await expect(drawer.getByRole('spinbutton',{name:'服务时长 必填',exact:true})).toHaveValue('2');return;
 }
 await setup(page,1);await page.getByRole('spinbutton',{name:'志愿者0 服务时长',exact:true}).fill('2');
 await page.getByRole('tab',{name:'时长审核与导出',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'放弃未提交的服务信息？'});await expect(modal).toBeVisible();await modal.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('spinbutton',{name:'志愿者0 服务时长',exact:true})).toHaveValue('2');
});
test('photo failure remains explicit and can retry without writing attendance',async({page})=>{
 const s=await setup(page,1);await page.route('**/attendance-detail',r=>r.fulfill({json:{studentId:'203000',hasPhoto:true,legacy:[],warnings:[]}}));
 await page.route('**/registrations/r0/photo*',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.getByRole('button',{name:'核验并录入',exact:true}).click();
 await expect(page.getByText('照片暂时无法加载，不能据此判断是否到场。')).toBeVisible();await page.getByRole('button',{name:'重新加载照片'}).click();expect(s.posts).toHaveLength(0);
});
test('field workspace themes and desktop widths retain long identity and readable table',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Explicit viewport matrix');
 const state=await setup(page,20);state.rows[0].姓名='合成超长姓名用于布局核验';state.rows[0].院系='合成跨学科院系名称'.repeat(8);
 await page.reload();await expect(page.locator('.service-table tbody tr')).toHaveCount(20);
 for(const theme of ['porcelain','blueprint','botanic','atelier','archive'])for(const width of [390,1440,1920]){
  await page.setViewportSize({width,height:1000});await page.evaluate(async t=>{const {selectTheme}=await import('/app/core/themes.js');selectTheme('console',t);await document.fonts.ready;},theme);
  await page.locator('.service-workspace').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`field-${theme}-${width}.png`),animations:'disabled'});
 }
});
