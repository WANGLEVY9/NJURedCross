import {test,expect} from '@playwright/test';

test('blood board separates available, pending and waiting colors and retains legacy auto-confirm adjustment',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');
 await expect(page.locator('.activity-v2')).toBeVisible();
 await page.evaluate(async()=>{
  const {bloodRegistrationBoard}=await import('/app/console/pages/blood-registration-board.js');
  const {bloodPhaseBoard}=await import('/app/console/pages/blood-phase-board.js');
  const {serviceStatus}=await import('/app/console/pages/activity-service-state.js');
  const event=(id,date,location='新街口中央')=>({_id:id,活动ID:id,报名日期:date,地点:location,报名时段:'上午 11~15点',状态:'报名中',报名页配置:'{}'});
  const events=[event('available','2026-11-02'),event('pending','2026-11-03'),event('legacy','2026-11-02','浦口弘阳广场')];
  const rows=[{_id:'pending-row',活动ID:'pending',报名状态:'待筛选',姓名:'合成待审',学号:'999990001'},{_id:'legacy-row',活动ID:'legacy',报名状态:'已确认',处理说明:'弘阳广场自动确认',姓名:'历史确认',学号:'999990002'}];
  const board=bloodRegistrationBoard({events,registrations:rows,state:{selected:new Set()},canManage:true,onReject:()=>{window.__legacyRejected=true;}});
  const waiting=bloodPhaseBoard({events:[events[0]],rows:[{id:'wait',activityId:'available',name:'合成签到',studentId:'999990003',registration:{报名状态:'已确认'}}],selected:new Set(),enabled:()=>false,label:r=>serviceStatus(null,false,r.registration,true),phase:'签到审核'});
  document.getElementById('main').replaceChildren(board,waiting);
 });
 const available=page.locator('.blood-schedule-status--available').first(),pending=page.locator('.blood-schedule-status--review').first(),waiting=page.locator('.blood-schedule-status--waiting').first();
 await expect(available).toHaveText('可报名');await expect(waiting).toHaveText('待签到');
 const color=locator=>locator.evaluate(el=>getComputedStyle(el.closest('.blood-schedule-card')).backgroundColor);
 expect(await color(available)).toBe('rgb(221, 242, 228)');expect(await color(pending)).toBe('rgb(250, 237, 202)');expect(await color(waiting)).toBe('rgb(236, 227, 247)');
 await page.getByRole('region',{name:'献血车排班看板',exact:true}).screenshot({path:info.outputPath('blood-status-palette.png')});
 await page.getByRole('button',{name:'2026-11-02 弘阳广场 上午 报名成功',exact:true}).click();
 await page.getByRole('button',{name:'报名失败',exact:true}).click();expect(await page.evaluate(()=>window.__legacyRejected)).toBe(true);
});
