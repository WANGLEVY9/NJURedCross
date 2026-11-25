import {test,expect} from '@playwright/test';

for(const status of ['review','exported'])test(`final hours ${status} keeps names and long student identifiers on one line`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async status=>{
  const {activityFinalHoursWorkspace}=await import('/app/console/pages/activity-final-hours-workspace.js');
  const rows=['合成甲','迪娜·也尔那尔'].map((name,index)=>({id:String(index),name,studentId:'052202640034',department:'行知书院',location:'合成校区多功能厅',dates:'2026-10-31 15:00—17:00',trainingHours:1,travelHours:1,serviceHours:2,work:'参与合成场景体验',remark:'',decision:'pass',...(index===0?{memberIds:['a','b']}: {})}));
  const initial={status,rows,canEdit:status==='review',token:'synthetic-token'};
  const ui=activityFinalHoursWorkspace({initial,downloadUrl:'/synthetic.xlsx',load:async()=>initial,save:async()=>{},loadInformation:async()=>({})});document.getElementById('main').replaceChildren(ui.node);
 },status);
 async function check(scope){
  const row=scope.locator('tbody tr').first();
  for(const index of [1,3]){
   const cell=row.locator('td').nth(index);await expect(cell).toHaveCSS('white-space','nowrap');
   const content=cell.locator(index===1&&status==='review'?'.activity-hours-person__name':'span').first();
   if(await content.count())expect((await content.boundingBox()).height).toBeLessThan(24);
  }
  expect((await row.locator('td').nth(1).boundingBox()).width).toBeLessThan(180);
  const geometry=await row.evaluate(node=>{
   const boxes=[...node.querySelectorAll('td')].map(cell=>{const rect=cell.getBoundingClientRect();return{left:rect.left,right:rect.right,width:rect.width};});
   return {boxes, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth};
  });
  for(let i=1;i<geometry.boxes.length;i++)expect(geometry.boxes[i].left).toBeGreaterThanOrEqual(geometry.boxes[i-1].right-1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth+1);
  const indexHeader=scope.getByRole('columnheader').first();
  expect(await indexHeader.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(44);
 }
 const table=page.locator('.activity-final-hours-table');await check(table);
 await table.screenshot({path:info.outputPath(`identity-width-${status}.png`)});
 if(status==='review'){
  await expect(table.getByText('2 场',{exact:true})).toBeVisible();
  const statusCell=table.locator('tbody .activity-final-hours-col-review').first();
  const statusBox=await statusCell.locator('.status').boundingBox(),actionBox=await statusCell.getByRole('button',{name:'修改明细'}).boundingBox();
  expect(actionBox.y).toBeGreaterThanOrEqual(statusBox.y+statusBox.height-1);
  expect(actionBox.x).toBeGreaterThanOrEqual(statusBox.x);
  await page.getByRole('button',{name:'预览并导出',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'完整分工时长表'});
  await check(preview);
  await expect(preview.getByRole('columnheader',{name:'序号',exact:true})).toHaveCount(1);
  await expect(preview.getByRole('columnheader',{name:'实际培训时长/小时',exact:true})).toHaveCount(1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
