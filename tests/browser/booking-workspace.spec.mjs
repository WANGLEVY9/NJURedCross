import {test,expect} from '@playwright/test';
import axe from 'axe-core';
import {bloodWeekPlan} from '../../scripts/preview-blood-week-plan.mjs';

async function fixture(page,{records=true,wishes=true}={}) {
 const plan=bloodWeekPlan();
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const events=plan.sessions.map((s,i)=>({id:`workspace-${i}`,name:'校园公益服务（合成活动）',date:s.date,slot:s.slot,position:'现场引导与信息服务岗',location:s.location,capacity:30,remaining:i===2?0:30,work:plan.work,ordinary:{groupId:'workspace-fixture',start:s.startAt,end:s.endAt,campus:s.campus,hoursPending:true},registrationEnd:plan.registrationEnd,registrationOpen:i!==3}));
 const makeRecord=(i,extra={})=>({code:`SYNTHETIC-${i}`,eventId:events[i].id,eventName:events[i].name,date:events[i].date,slot:events[i].slot,location:events[i].location,position:events[i].position,ordinary:events[i].ordinary,eventStatus:'报名中',entryStatus:'时长规则待确定',status:'已确认',result:'报名成功',...extra});
 const state={records:records?[makeRecord(4),makeRecord(5,{status:'待筛选',result:'名单确认中'})]:[],wishes:wishes?[{eventId:events[2].id}]:[],failRead:false};
 await page.route('**/api/public/workflow/events*',r=>r.fulfill({json:{ok:true,events}}));
 await page.route('**/api/portal/workflow/me',r=>state.failRead?r.fulfill({status:503,json:{message:'合成刷新失败'}}):r.fulfill({json:{ok:true,participant:{realName:'合成志愿者',studentId:'TEST-001',email:'fixture@example.invalid',campus:'鼓楼',department:'合成学院',grade:'26本'},registrations:state.records}}));
 await page.route('**/api/portal/workflow/wishlist',r=>r.fulfill({json:{ok:true,wishlist:state.wishes}}));
 await page.goto('/workflow-events?event=workspace-0');
 await expect(page.locator('.booking-identity')).toContainText('合成志愿者');
 return {events,state,makeRecord};
}

test('date navigation updates the detail without moving focus; own and selected are independent',async({page})=>{
 await fixture(page);
 const date=page.getByRole('radio',{name:'10月29日',exact:true});
 await date.focus();await date.press('ArrowRight');
 await expect(page.getByRole('radio',{name:'10月30日',exact:true})).toBeFocused();
 await expect(page.locator('.workflow-slot-summary')).toContainText('2026-10-30');
 await expect(page).toHaveURL(/event=workspace-8/);
 await page.getByRole('radio',{name:'10月29日',exact:true}).click();
 await page.locator('[data-event-id="workspace-4"]').click();
 await expect(page.locator('[data-event-id="workspace-4"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-event-id="workspace-4"]')).toContainText('已报名');
 await expect(page.locator('.registration-callout')).toContainText('报名成功');
 await expect(page.locator('[data-event-id="workspace-2"]')).toContainText('已满');
 await expect(page.locator('[data-event-id="workspace-3"]')).toContainText('报名已关闭');
});

for(const status of ['已确认','待确认'])test(`one consent request uses server result ${status}`,async({page})=>{
 const {state,makeRecord}=await fixture(page,{records:false});let calls=0;
 await page.route('**/api/portal/workflow/events/*/register',async r=>{
  calls++;expect(r.request().postDataJSON()).toEqual({consent:true});
  await new Promise(resolve=>setTimeout(resolve,180));
  state.records=[makeRecord(0,{status:status==='已确认'?'已确认':'待筛选',result:status==='已确认'?'报名成功':status})];
  await r.fulfill({json:{ok:true,result:{status}}});
 });
 const submit=page.getByRole('button',{name:'确认报名此班次',exact:true});
 await expect(submit).toBeDisabled();await page.locator('.blood-signup-controls .check').click();
 await submit.evaluate(node=>{node.click();node.click();});
  await expect(page.locator('.registration-callout')).toContainText(status==='已确认'?'报名成功':status);
  await expect(page.locator('.workflow-submit-feedback')).toContainText(status==='已确认'?'报名成功':'报名已提交');
  await expect(page.locator('.workflow-submit-feedback')).not.toContainText(status==='已确认'?'等待审核':'报名成功');
 expect(calls).toBe(1);
});

test('uncertain requests stay locked across refresh; acknowledged success survives failed read',async({page})=>{
 const {state}=await fixture(page,{records:false});let calls=0;
 await page.route('**/api/portal/workflow/events/*/register',r=>{calls++;return r.abort();});
 await page.locator('.blood-signup-controls .check').click();
 await page.getByRole('button',{name:'确认报名此班次',exact:true}).click();
 await expect(page.locator('.workflow-submit-feedback')).toHaveAttribute('data-state','uncertain');
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(page.locator('.workflow-submit-feedback')).toHaveAttribute('data-state','uncertain');
 await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toBeDisabled();expect(calls).toBe(1);
 await page.reload();await expect(page.locator('.booking-identity')).toBeVisible();
 await page.route('**/api/portal/workflow/events/*/register',r=>{state.failRead=true;return r.fulfill({json:{ok:true,result:{status:'报名成功'}}});});
 await page.locator('.blood-signup-controls .check').click();
 await page.getByRole('button',{name:'确认报名此班次',exact:true}).click();
 await expect(page.locator('.workflow-submit-feedback')).toContainText('报名已提交，进度暂未刷新');
 await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toBeDisabled();
});

test('manual refresh preserves disclosures, cancellation draft and selected photo; validates before writes',async({page})=>{
 const {state}=await fixture(page);const card=page.locator('[data-registration-code="SYNTHETIC-4"]');let leaveCalls=0,photoCalls=0;
 await page.route('**/api/portal/workflow/registrations/*/leave',r=>{leaveCalls++;expect(r.request().postDataJSON()).toEqual({reason:'合成课程安排冲突'});state.records[0].leaveStatus='待审批';return r.fulfill({json:{ok:true}});});
 await page.route('**/api/portal/workflow/registrations/*/attendance',r=>{photoCalls++;state.records[0].attendanceSubmitted=true;return r.fulfill({json:{ok:true}});});
 await card.locator('summary').filter({hasText:'申请请假'}).click();
 await card.getByRole('button',{name:'申请请假',exact:true}).click();expect(leaveCalls).toBe(0);
 await card.getByRole('textbox').fill('合成课程安排冲突');
 await card.locator('summary').filter({hasText:'现场签到'}).click();
 const input=card.getByLabel('现场签到照片');
 await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('synthetic-image')});
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(card.getByRole('textbox')).toHaveValue('合成课程安排冲突');
 await expect(card.locator('details[open]')).toHaveCount(2);
 await expect.poll(()=>input.evaluate(n=>n.files[0]?.name)).toBe('synthetic.png');
 await input.setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('not-image')});
 await card.getByRole('button',{name:'提交照片签到'}).click();expect(photoCalls).toBe(0);
 await input.setInputFiles({name:'oversize.png',mimeType:'image/png',buffer:Buffer.alloc(4*1024*1024+1)});
 await card.getByRole('button',{name:'提交照片签到'}).click();expect(photoCalls).toBe(0);
 await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('synthetic-image')});
 await card.getByRole('button',{name:'提交照片签到'}).click();
 await expect(card.locator('.blood-registration__heading')).toContainText('签到待核验');expect(photoCalls).toBe(1);
 await expect(card.getByRole('textbox')).toHaveValue('合成课程安排冲突');
 await card.getByRole('button',{name:'申请请假',exact:true}).click();
 await expect(card.locator('.blood-registration__heading')).toContainText('待审批');
 await expect(card.getByRole('textbox')).toHaveCount(0);expect(leaveCalls).toBe(1);
});

test('workspace visual matrix: desktop widths, five themes, zoom, long content, and wish states',async({page},info)=>{
 test.setTimeout(60000);
 const {events,state}=await fixture(page);
 for(const [width,height] of [[1280,800],[1440,900],[1600,900],[1920,1080]]){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`workspace-${width}.png`),fullPage:true,animations:'disabled'});
 }
 await page.setViewportSize({width:1440,height:900});
 for(const theme of ['dawn','sail','garden','iris','amber']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.locator('.workflow-event-detail').screenshot({path:info.outputPath(`confirmation-${theme}.png`),animations:'disabled'});
  await expect(page.locator('[data-event-id="workspace-4"] .badge')).toHaveClass(/badge--info/);
  await page.evaluate(axe.source);
  const issues=await page.evaluate(async()=>{const result=await window.axe.run('.workflow-page',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});
  expect(issues,`${theme} booking accessibility`).toEqual([]);
 }
 await page.locator('.blood-signup-controls .check').click();
 await page.locator('.blood-detail-personal').screenshot({path:info.outputPath('consent-checked.png')});
 await page.locator('#workflow-records').screenshot({path:info.outputPath('records.png')});
 await page.locator('[data-registration-code="SYNTHETIC-4"] summary').filter({hasText:'现场签到'}).click();
 await page.locator('#workflow-records').screenshot({path:info.outputPath('records-expanded.png')});
 await page.locator('.booking-wishes').screenshot({path:info.outputPath('wishes-full.png')});
 state.wishes=[];events[0].name='合成长活动标题：校园公益志愿服务与跨校区协作体验';events[0].location='合成长地点：仙林校区大学生活动中心多功能报告厅及服务咨询接待区域';
 await page.getByRole('button',{name:'刷新班次',exact:true}).click();
 await expect(page.locator('.booking-wishes__empty')).toBeVisible();
 await page.locator('.booking-wishes').screenshot({path:info.outputPath('wishes-empty.png')});
 for(const zoom of [1.25,1.5]){
  // Browser zoom reduces the CSS viewport and triggers media queries. CSS zoom
  // on <html> does not, so emulate the effective viewport rather than restyling it.
  await page.setViewportSize({width:Math.round(1440/zoom),height:Math.round(900/zoom)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByRole('button',{name:'确认报名此班次',exact:true})).toBeEnabled();
  await page.screenshot({path:info.outputPath(`zoom-${zoom}.png`),fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('mobile-long.png'),fullPage:true});
 await page.getByRole('button',{name:'返回班次选择',exact:true}).click();
 await expect(page.getByRole('radio',{name:'10月29日',exact:true})).toBeFocused();
});
