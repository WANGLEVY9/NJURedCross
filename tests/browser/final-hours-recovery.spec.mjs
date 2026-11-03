import {test,expect} from '@playwright/test';

test('super can reopen initial review from the final page even when source validation blocks the sheet',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const event={_id:'synthetic-recover',活动ID:'synthetic-recover-code',活动名称:'合成来源核对活动',负责人账号ID:'synthetic-super',状态:'进行中',报名日期:'2030-01-01',岗位:'合成服务岗',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},bookingMode:'unified',runningReview:{status:'submitted'}})};
 let reopened=false,writes=0;
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events:[event],canManageActivities:true}}));
 await page.route('**/events/synthetic-recover/final-hours',route=>route.fulfill({status:409,json:{ok:false,message:'参与或签到依据已改变，请核对初审来源后再审核'}}));
 await page.route('**/events/synthetic-recover/workspace-removal',route=>route.fulfill({json:{ok:true,result:{canRemove:false,reason:'合成只读结束状态'}}}));
 await page.route('**/events/synthetic-recover/running-reopen',async route=>{
  writes++;expect(route.request().method()).toBe('PATCH');expect(route.request().postDataJSON()).toEqual({reason:'核对实际参加名单变化'});reopened=true;event['报名页配置']=JSON.stringify({...JSON.parse(event['报名页配置']),runningReview:{status:'draft'}});await route.fulfill({json:{ok:true,result:{reopened:true}}});
 });
 await page.route('**/events/synthetic-recover/detail',route=>route.fulfill({json:{ok:true,events:[event],registrations:[],checkins:[],ledger:[]}}));
 await page.route('**/events/synthetic-recover/running-review',route=>route.fulfill({json:{ok:true,result:{canRecord:reopened,status:'draft',entries:[],token:'synthetic-review-token'}}}));
 await page.goto('/console/events?event=synthetic-recover');
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane).toContainText('参与或签到依据已改变');
 await pane.getByText('更多操作',{exact:true}).click();await pane.getByRole('button',{name:'重新打开初审',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'重新打开时长初审',exact:true});await dialog.getByRole('button',{name:'确认退回',exact:true}).click();expect(writes).toBe(0);
 await dialog.getByLabel(/^退回原因/).fill('核对实际参加名单变化');await page.screenshot({path:info.outputPath('source-recovery.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'确认退回',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(pane.getByRole('button',{name:'上传及预览时长表',exact:true})).toBeEnabled();expect(writes).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
