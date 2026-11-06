import {test,expect} from '@playwright/test';

async function swipe(page,from,to){
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});
 for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});await page.waitForTimeout(18);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}

for(const kind of ['initial','final'])test(`${kind} long review supports touch scrolling and reaches the last participant`,async({page},info)=>{
 test.skip(!info.project.name.includes('mobile'),'Physical touch regression');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async kind=>{
  const {h}=await import('/app/core/dom.js');
  const rows=Array.from({length:80},(_,i)=>({id:`reg-${i}`,name:`合成同学${i}`,studentId:`00000${String(i).padStart(3,'0')}`,department:'合成学院',location:'合成场地',dates:'2030-01-01 上午',work:'合成服务',serviceHours:3,trainingHours:1,travelHours:0,decision:'pass',reason:''}));
  let ui;
  if(kind==='initial'){
   const event={_id:'job',活动ID:'job-code',活动名称:'合成活动',岗位:'合成岗位',状态:'进行中',服务时长:3,培训时长:1,交通时长:0,报名页配置:'{}'};
   ui=(await import('/app/console/pages/activity-running-workspace.js')).activityRunningWorkspace({event,data:{events:[event],registrations:rows.map(row=>({_id:row.id,活动ID:'job-code',姓名:row.name,学号:row.studentId,报名状态:'已确认'})),ledger:[],checkins:[]},reviewState:{token:'v1',canRecord:true,status:'draft',entries:[]},actionsNode:h('span'),loadInformation:async()=>({})});
  }else ui=(await import('/app/console/pages/activity-final-hours-workspace.js')).activityFinalHoursWorkspace({initial:{token:'v1',canEdit:true,status:'review',rows,positions:[]},actionsNode:h('span'),loadInformation:async()=>({})});
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2',data:{mobileView:'detail'}},h('div',{class:'activity-v2-workspace'},h('section',{class:'activity-v2-detail'},h('header',{class:'activity-v2-heading'},h('h2',{text:'合成手机审核'})),ui.node))));
 },kind);
 const pane=page.locator('.activity-v2-detail');
 await swipe(page,{x:180,y:640},{x:180,y:260});
 await expect.poll(()=>pane.evaluate(n=>n.scrollTop)).toBeGreaterThan(100);
 const table=pane.locator('.activity-registration-content>.activity-registration-table');
 await swipe(page,{x:340,y:500},{x:80,y:500});
 await expect.poll(()=>table.evaluate(n=>n.scrollLeft)).toBeGreaterThan(50);
 await table.evaluate(n=>n.scrollLeft=0);
 await pane.evaluate(n=>{n.scrollTop=n.scrollHeight;});
 await expect(page.getByText('合成同学79',{exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`${kind}-touch-bottom.png`)});
 if(kind==='initial'){
  await page.evaluate(async()=>{
   const {runningReviewEditor}=await import('/app/console/pages/activity-running-editor.js');
   runningReviewEditor({token:'v1',rows:Array.from({length:50},(_,i)=>({name:`合成同学${i}`,studentId:`000000${i}`,item:{id:`reg-${i}`,serviceHours:3,trainingHours:1,travelHours:0,decision:'pass',reason:''}})),save:async()=>{},onSaved:async()=>{}});
  });
 }else{
  await pane.evaluate(n=>n.scrollTop=0);await pane.getByRole('button',{name:'预览并导出',exact:true}).click();
 }
 const modal=page.getByRole('dialog'),body=modal.locator('.modal__body');await expect(modal).toBeVisible();
 const box=await body.boundingBox();const y=Math.min(650,box.y+box.height-25);
 await swipe(page,{x:180,y},{x:180,y:Math.max(box.y+20,y-220)});
 await expect.poll(()=>body.evaluate(n=>n.scrollTop)).toBeGreaterThan(50);
 await body.evaluate(n=>n.scrollTop=n.scrollHeight);
 await expect(modal.getByText(kind==='initial'?'合成同学49':'合成同学79',{exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath(`${kind}-modal-touch-bottom.png`)});
});

test('mobile approval table passes vertical touch to the page',async({page},info)=>{
 test.skip(!info.project.name.includes('mobile'),'Physical touch regression');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async()=>{
  const {h}=await import('/app/core/dom.js');
  const table=h('div',{class:'activity-draft-table'},h('table',{},h('tbody',{},...Array.from({length:40},(_,i)=>h('tr',{},h('td',{text:`合成审核岗位${i}`}))))));
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2',data:{mobileView:'detail'}},h('div',{class:'activity-v2-workspace'},h('section',{class:'activity-v2-detail'},h('header',{class:'activity-v2-heading'},h('h2',{text:'合成待审批活动'})),h('div',{class:'activity-approval-workspace'},h('div',{class:'activity-approval-content'},table,h('p',{text:'审核页面末尾'})))))));
 });
 await swipe(page,{x:180,y:600},{x:180,y:220});
 await expect.poll(()=>page.locator('.activity-v2-detail').evaluate(n=>n.scrollTop)).toBeGreaterThan(100);
 await page.evaluate(async()=>{
  const {openModal}=await import('/app/ui/overlay.js'),{h}=await import('/app/core/dom.js');
  openModal({title:'合成岗位审核预览',body:h('div',{class:'activity-draft-table'},h('table',{},h('tbody',{},...Array.from({length:40},(_,i)=>h('tr',{},h('td',{text:`合成岗位${i}`})))))),footer:[]});
 });
 const body=page.getByRole('dialog').locator('.modal__body');await expect(body).toBeVisible();
 const box=await body.boundingBox(),y=Math.min(650,box.y+box.height-20);
 await swipe(page,{x:180,y},{x:180,y:Math.max(box.y+20,y-250)});
 await expect.poll(()=>body.evaluate(n=>n.scrollTop+n.querySelector('.activity-draft-table').scrollTop)).toBeGreaterThan(100);
 await body.evaluate(n=>{n.scrollTop=n.scrollHeight;const table=n.querySelector('.activity-draft-table');table.scrollTop=table.scrollHeight;});
 await expect(page.getByRole('dialog').getByText('合成岗位39',{exact:true})).toBeInViewport();
});

test('mobile blood hours list releases vertical touch at its boundary',async({page},info)=>{
 test.skip(!info.project.name.includes('mobile'),'Physical touch regression');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood');
 await page.goto(`/console/events?event=${event._id}&scheduleTask=hours`);
 const pane=page.locator('.activity-v2-detail');
 await pane.getByRole('button',{name:'终审与导出',exact:true}).click();
 const table=pane.locator('.service-table-scroll');await expect(table).toBeVisible();
 await table.evaluate(n=>{const tbody=n.querySelector('tbody');const row=tbody.querySelector('tr');for(let i=0;i<40;i++)tbody.append(row.cloneNode(true));const end=document.createElement('p');end.textContent='合成列表后续内容';end.style.height='900px';n.parentElement.append(end);});
 await table.scrollIntoViewIfNeeded();await table.evaluate(n=>n.scrollTop=n.scrollHeight);
 const before=await pane.evaluate(n=>n.scrollTop),box=await table.boundingBox();
 const y=Math.min(650,box.y+box.height-20);await swipe(page,{x:180,y},{x:180,y:y-180});
 await expect.poll(()=>pane.evaluate(n=>n.scrollTop)).toBeGreaterThan(before+30);
});
