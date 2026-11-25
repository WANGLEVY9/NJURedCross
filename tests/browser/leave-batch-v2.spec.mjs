import {test,expect} from '@playwright/test';

test('leave range selection and select-all submit thirty decisions with empty explanation',async({page})=>{
 const requests=[];
 await page.route('**/api/volunteer/workflow/registrations/batch',async route=>{
  const body=route.request().postDataJSON();requests.push(body);
  await route.fulfill({json:{ok:true,results:body.ids.map(id=>({id,ok:true}))}});
 });
 // Keep the preview origin for module imports, but suppress the login page's
 // asynchronous first-visit reminder so its scrim cannot intercept clicks.
 await page.addInitScript(()=>{sessionStorage.setItem('njurc:registration-reminder:v1','shown');});
 await page.goto('/login');
 await expect.poll(()=>page.evaluate(()=>Boolean(document.getElementById('main')))).toBe(true);
 await page.evaluate(()=>{document.getElementById('overlay-root')?.replaceChildren();});
 await page.evaluate(async()=>{
  const {batchLeaveButton}=await import('/app/console/pages/activity-leave-review.js');
  const rows=Array.from({length:30},(_,i)=>({_id:`leave-${i}`,活动ID:'synthetic',姓名:`合成${i}`,学号:`999${i}`,请假状态:'待审批',报名状态:'已确认',请假原因:'合成原因'}));
  document.getElementById('main').replaceChildren(batchLeaveButton({getRows:()=>rows,refresh:async()=>{}}));
 });
 await page.getByRole('button',{name:'批量请假审批',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('起始序号').fill('2');await dialog.getByLabel('结束序号').fill('5');
 await dialog.getByRole('button',{name:'选择区间',exact:true}).click();
 await expect(dialog.getByText('已选择 4 条',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'全选',exact:true}).click();
 await expect(dialog.getByText('已选择 30 条',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'审核通过',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(requests).toHaveLength(1);expect(requests[0].ids).toHaveLength(30);expect(requests[0].reason).toBe('');
});
