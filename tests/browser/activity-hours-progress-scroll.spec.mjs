import {test,expect} from '@playwright/test';

test('expanded posting progress stays compact and preserves final-table vertical scrolling',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 await page.evaluate(async()=>{
  const {h}=await import('/app/core/dom.js');
  const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  const rows=Array.from({length:40},(_,i)=>({id:`row-${i}`,name:`合成同学${i}`,studentId:`0000${String(i).padStart(4,'0')}`,department:'合成学院',location:'合成场地',dates:'2030-01-01 上午',work:'合成服务',decision:'pass',serviceHours:3,trainingHours:1,travelHours:0}));
  const progress=Array.from({length:45},(_,i)=>({...rows[i%rows.length],code:i%7?'synced':'summary_failed',label:i%7?'已入账 · 待同步个人主页':'汇总表同步待重试',summarySynced:i%7>0,profileSynced:false,hours:{totalHours:4},reason:i%7?'':'原汇总表已有同名活动'}));
  const initial={status:'exported',rows,canEdit:false,mailStatus:'sent',hoursProgress:progress};
  const ui=activityFinalHoursWorkspace({initial,downloadUrl:'/synthetic-unused.xlsx',actionsNode:h('span'),loadInformation:async()=>({})});
  const detail=h('section',{class:'activity-v2-detail'},ui.node);
  detail.style.height='100vh';
  document.getElementById('main').replaceChildren(detail);
  document.getElementById('main').style.height='100vh';
 });
 const progress=page.locator('.activity-hours-progress');
 await expect(progress).toContainText('时长入账进度');
 await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow',/\d+/);
 const toggle=progress.getByText('查看人员入账进度',{exact:true});
 const collapsed=await progress.boundingBox();
 await toggle.click();
 const body=progress.locator('.activity-hours-progress__body');
 await expect(body).toBeVisible();
 expect(await body.evaluate(node=>({scroll:node.scrollHeight,client:node.clientHeight}))).toMatchObject({scroll:expect.any(Number),client:expect.any(Number)});
 expect(await body.evaluate(node=>node.scrollHeight>node.clientHeight+20)).toBe(true);
 expect((await progress.boundingBox()).height).toBeLessThan(collapsed.height+420);
 await expect(progress.locator('.activity-hours-progress__row')).toHaveCount(45);
 await expect(progress.locator('[data-tone=warning]')).toHaveCount(7);
 await body.evaluate(node=>{node.scrollTop=node.scrollHeight;});
 await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(20);
 await expect(progress.getByText('合成同学44',{exact:true})).toHaveCount(0);
 await expect(progress.getByText('合成同学2',{exact:true}).last()).toBeVisible();
 const scroller=page.locator('.activity-registration-content');
 const mobile=info.project.name.includes('mobile');
 expect(await scroller.evaluate(node=>({overflow:getComputedStyle(node).overflowY,minHeight:getComputedStyle(node).minHeight}))).toMatchObject({overflow:mobile?'visible':'auto',minHeight:'0px'});
 expect(await scroller.evaluate(node=>node.scrollHeight>=node.clientHeight)).toBe(true);
 expect(await scroller.locator('.activity-final-hours-table').evaluate(node=>node.getBoundingClientRect().height>0)).toBe(true);
 const table=page.locator('.activity-final-hours-table');
 const tableScroll=await table.evaluate(node=>({y:getComputedStyle(node).overflowY,x:getComputedStyle(node).overflowX,scroll:node.scrollHeight,client:node.clientHeight}));
 expect(tableScroll).toMatchObject({y:'auto',x:'auto'});
 expect(tableScroll.scroll).toBeGreaterThan(tableScroll.client+30);
 await table.hover({position:{x:Math.min(300,Math.floor((await table.boundingBox()).width/2)),y:Math.min(240,Math.floor((await table.boundingBox()).height/2))}});
 await page.mouse.wheel(0,450);
 await expect.poll(()=>table.evaluate(node=>node.scrollTop)).toBeGreaterThan(50);
 await expect(table.locator('thead th').first()).toBeInViewport();
 await table.evaluate(node=>{node.scrollTop=node.scrollHeight;});
 // 判「行落在表格自己的可视区内」，而不是 toBeInViewport：`#main` 是 100vh，
 // 表格底边与视口底边重合（本地实测余量 0px），CI 的字体度量差 1px 就会把
 // 「滚到底」判成「不在视口」。表格内部能滚到最后一行才是这条用例的契约；
 // 页面级要不要露出表尾由 activity-mobile-scroll.spec.mjs 覆盖。
 const reach=await table.evaluate(node=>{
  const rows=node.querySelectorAll('tbody tr');
  const last=rows[rows.length-1].getBoundingClientRect();
  const box=node.getBoundingClientRect();
  return {atBottom:Math.abs(node.scrollTop+node.clientHeight-node.scrollHeight)<=1,inside:last.bottom<=box.bottom+1&&last.top>=box.top-1};
 });
 expect(reach).toEqual({atBottom:true,inside:true});
 await expect(table.locator('thead th').first()).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('hours-progress-and-table-scroll.png'),animations:'disabled'});
});
