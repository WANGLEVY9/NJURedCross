import {test,expect} from '@playwright/test';
import QRCode from 'qrcode';
import {mkdir} from 'node:fs/promises';
const event={eventId:'editorial-fixture',name:'合成校园急救工作坊',description:'合成测试说明。了解现场安排，选择合适场次并核对报名信息。',type:'急救培训',status:'报名中',campus:'仙林',location:'合成教学楼',startAt:'2026-10-12T10:00:00+08:00',endAt:'2026-10-12T14:00:00+08:00',registrationEnd:'2026-10-11T23:00:00+08:00',remaining:4,capacity:8,confirmed:4,full:false,waitlisted:0,sessions:[]};
const sessions=[{...event,sessionId:'open',remaining:4},{...event,sessionId:'full',remaining:0,full:true}];
async function capture(page,name,info){if(process.env.PHASE3_CAPTURE&&info.project.name==='desktop-chromium'){await mkdir(process.env.PHASE3_CAPTURE,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({animations:'disabled',path:`${process.env.PHASE3_CAPTURE}/${name}.png`,fullPage:true});}}
for(const count of[0,1,3,10])test(`discovery composition with ${count} activities`,async({page},info)=>{
 await page.route('**/api/public/events',r=>r.fulfill({json:{events:Array.from({length:count},(_,i)=>({...event,eventId:`fixture-${i}`,name:`合成活动 ${i+1}`})),facets:{campuses:['仙林']}}}));
 await page.goto('/events');await expect(page.locator('.discovery-results')).toHaveAttribute('data-layout',count===0?'empty':count===1?'featured':count<5?'curated':'list');
 for(const width of[1440,1920]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await capture(page,`discovery-${count}-${width}`,info);}
 if(count===1)await expect(page.getByRole('heading',{name:'从发现，到参与'})).toBeVisible();
});
for(const outcome of['confirmed','waitlist','error','network','closed','single'])test(`ordinary activity ${outcome} preserves session and receipt`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/auth/account',r=>r.fulfill({json:{account:{realName:'合成同学',email:'fixture@smail.nju.edu.cn',emailVerified:true,campus:'仙林'}}}));
 const model={...event,sessions:outcome==='single'?[sessions[0]]:sessions,status:outcome==='closed'?'已结束':'报名中'};
 await page.route('**/api/public/events/editorial-fixture',r=>r.fulfill({json:{event:model,related:[]}}));
 let calls=0;
 await page.route('**/api/public/events/editorial-fixture/registrations',async r=>{
  calls++;const data=r.request().postDataJSON();expect(data.consent).toBe(true);expect(data.sessionId).toBe(outcome==='waitlist'?'full':'open');
  if(outcome==='network')return r.abort();
  if(outcome==='error')return r.fulfill({status:503,json:{message:'合成网络错误，请重试'}});
  return r.fulfill({json:{registration:{status:outcome==='waitlist'?'候补':'已确认',waitlist:1,code:'SYNTHETIC-ONLY',eventName:event.name,sessionStartAt:event.startAt,location:event.location,qrDataUrl:await QRCode.toDataURL('SYNTHETIC-ONLY')}}});
 });
 await page.goto('/events/editorial-fixture');await expect(page.getByRole('heading',{name:event.name,exact:true})).toBeVisible();
 await capture(page,`ordinary-${outcome}`,info);
 if(outcome==='closed'){await expect(page.getByRole('button',{name:'报名已关闭',exact:true})).toBeDisabled();return;}
 if(outcome==='waitlist'){await page.locator('input[name="event-session"][value="full"]').check();await expect(page.locator('.booking-number')).toHaveText('0');}
 await page.getByRole('button',{name:outcome==='waitlist'?'加入候补队列':'立即报名',exact:true}).click();
 const drawer=page.getByRole('dialog');await expect(drawer).toBeVisible();
 if(outcome!=='single')await expect(drawer.locator(`input[value="${outcome==='waitlist'?'full':'open'}"]`)).toBeChecked();
 await expect(drawer.getByRole('textbox',{name:/^姓名/})).toHaveValue('合成同学');
 await drawer.getByRole('button',{name:outcome==='waitlist'?'提交并加入候补':'提交报名',exact:true}).click();expect(calls).toBe(0);
 await drawer.getByText('我确认自愿报名，并同意平台为本次活动使用上述信息',{exact:true}).click();await drawer.getByRole('button',{name:outcome==='waitlist'?'提交并加入候补':'提交报名',exact:true}).click();
 if(outcome==='error'||outcome==='network'){await expect(drawer.getByRole('button',{name:'提交报名',exact:true})).toBeEnabled();await expect(drawer.getByRole('checkbox')).toBeChecked();}
 else {await expect(drawer).toContainText('SYNTHETIC-ONLY');await expect(drawer).toContainText(outcome==='waitlist'?'已进入候补':'报名已确认');await expect(drawer.getByRole('button',{name:'下载凭证图片'})).toBeVisible();expect(await drawer.locator('.drawer__body, .sheet__body').evaluate(n=>n.scrollTop)).toBe(0);const download=page.waitForEvent('download');await drawer.getByRole('button',{name:'下载凭证图片'}).click();expect((await download).suggestedFilename()).toBe('SYNTHETIC-ONLY.png');}
 expect(calls).toBe(1);await capture(page,`ordinary-${outcome}-result`,info);
});
test('calendar states share legend colors and do not animate the board',async({page},info)=>{
 await page.request.post('/api/auth/logout');
 await page.goto('/workflow-events?type=blood&week=2026-10-12');await page.locator('.blood-calendar').waitFor();
 for(const theme of['dawn','sail','garden','iris','amber']){
  await page.evaluate(async t=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal',t);},theme);
  for(const width of[1440,1920]){await page.setViewportSize({width,height:1000});await capture(page,`calendar-${theme}-${width}`,info);}
  await page.getByRole('radio',{name:'仅看有名额',exact:true}).click();expect(await page.locator('.blood-calendar__grid').evaluate(n=>n.getAnimations().length)).toBe(0);
  await page.getByRole('radio',{name:'全部班次',exact:true}).click();
 }
});
test('blood submission cannot duplicate and preserves acknowledgment on refresh',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const source=await(await page.request.get('/api/public/workflow/events')).json();const seed=source.events.find(e=>e.blood);
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{events:[{...seed,id:'chain-booking',remaining:1,capacity:1}]}}));
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{registrations:[],participant:{realName:'合成同学',studentId:'TEST',campus:'仙林',email:'fixture@example.invalid'},profile:null}}));
 let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/portal/workflow/events/chain-booking/register',async r=>{calls++;await gate;await r.fulfill({status:503,json:{message:'合成暂时不可用'}});});
 await page.goto('/workflow-events?type=blood&slot=chain-booking');
 const check=page.locator('.blood-signup-controls input');await page.locator('.blood-signup-controls .check').click();await page.getByRole('button',{name:'刷新班次',exact:true}).click();await expect(check).toBeChecked();
 const submit=page.getByRole('button',{name:'确认报名此班次',exact:true});await submit.click();await expect(submit).toBeDisabled();expect(calls).toBe(1);release();
 await expect(page.locator('.workflow-submit-feedback')).toContainText('报名未完成');await expect(check).toBeChecked();await expect(submit).toBeEnabled();
 await capture(page,'blood-error-retained',info);
});
