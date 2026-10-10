import {test,expect} from '@playwright/test';

for(const outcome of ['success','full','validation','network'])test(`booking consent and ${outcome} feedback`,async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const source=await(await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const event={...seed,id:'booking-fixture',date:'2026-10-12',remaining:1,capacity:1};
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{...source,events:[event]}}));
 let records=[];
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{registrations:records,participant:{realName:'合成志愿者',studentId:'TEST',email:'fixture@example.invalid',campus:'仙林'},profile:null}}));
 await page.route('**/api/portal/workflow/events/booking-fixture/register',async r=>{
  expect(r.request().postDataJSON()).toEqual({consent:true});
  if(outcome==='network')return r.abort();
  if(outcome==='success'){records=[{eventId:event.id,eventName:'合成班次',status:'待筛选',result:'待确认',code:'FIXTURE',eventStatus:'报名中'}];return r.fulfill({json:{ok:true}});}
  return r.fulfill({status:outcome==='full'?409:400,json:{message:outcome==='full'?'班次名额已满':'请完善个人资料'}});
 });
 await page.goto('/workflow-events?type=blood&week=2026-10-12&slot=booking-fixture');
 const submit=page.getByRole('button',{name:'确认报名此班次',exact:true});
 await expect(submit).toBeDisabled();
 await page.locator('.blood-signup-controls .check').click();
 await expect(submit).toBeEnabled();await submit.click();
 const feedback=page.locator('.workflow-submit-feedback');
 await expect(feedback).toContainText(outcome==='success'?'报名已提交':outcome==='network'?'暂时无法确认提交结果':'报名未完成');
 if(outcome==='success'){await expect(page.locator('.registration-progress')).toContainText('提交审核');await expect(submit).toHaveCount(0);}
 await page.getByRole('button',{name:'返回日历',exact:true}).click();
 await expect(page.locator('[data-event-id="booking-fixture"]')).toBeFocused();
});

test('seven shifts a day remain readable at desktop widths',async({page},info)=>{
 await page.request.post('/api/auth/logout');
 const source=await(await page.request.get('/api/public/workflow/events')).json();
 const seed=source.events.find(e=>e.blood);
 const events=Array.from({length:49},(_,i)=>({...seed,id:`dense-${i}`,date:`2026-10-${12+Math.floor(i/7)}`,location:['新街口中央','新街口印象汇','仙林学则路','浦口弘阳广场'][i%4],remaining:i%3?1:0,capacity:2}));
 await page.route('**/api/public/workflow/events',r=>r.fulfill({json:{...source,events}}));
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 for(const width of [1280,1440,1920,2048]){
  await page.setViewportSize({width,height:1100});
  await expect(page.locator('.blood-calendar__slot:visible')).toHaveCount(49);
  expect(await page.locator('.blood-calendar__slot').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1))).toBe(true);
  await page.locator('.blood-calendar').screenshot({path:info.outputPath(`dense-${width}.png`)});
 }
});
