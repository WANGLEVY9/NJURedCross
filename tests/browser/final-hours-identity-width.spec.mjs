import {test,expect} from '@playwright/test';

for(const status of ['review','exported'])test(`final hours ${status} keeps names and long student identifiers on one line`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async status=>{
  const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  const rows=['合成甲','合成乙丙'].map((name,index)=>({id:String(index),name,studentId:'052202640034',department:'合成学院',location:'合成校区多功能厅',dates:'2026-10-31 15:00—17:00',trainingHours:1,travelHours:1,serviceHours:2,work:'参与合成场景体验',remark:'',decision:'pass',...(index===0?{memberIds:['a','b']}: {})}));
  const initial={status,rows,canEdit:status==='review',token:'synthetic-token'};
  const ui=activityFinalHoursWorkspace({initial,downloadUrl:'/synthetic.xlsx',load:async()=>initial,save:async()=>{},loadInformation:async()=>({})});document.getElementById('main').replaceChildren(ui.node);
 },status);
 async function check(scope){
  const row=scope.locator('tbody tr').first();
  for(const index of [1,3]){
   const cell=row.locator('td').nth(index);await expect(cell).toHaveCSS('white-space','nowrap');
   const text=cell.locator('span').last();
   if(index===1&&status==='review'&&await text.count())expect((await text.boundingBox()).height).toBeLessThan(24);
  }
  expect((await row.locator('td').nth(1).boundingBox()).width).toBeLessThan(180);
 }
 const table=page.locator('.activity-final-hours-table');await check(table);
 await table.screenshot({path:info.outputPath(`identity-width-${status}.png`)});
 if(status==='review'){
  await expect(table.getByText('2 场',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'预览并导出',exact:true}).click();
  await check(page.getByRole('dialog',{name:'完整分工时长表'}));
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
