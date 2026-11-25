import {test,expect} from '@playwright/test';
test('initial review defaults to pass, retains decisions after hour edits and supports all-pass',async({page})=>{
 await page.goto('/login');
 await page.evaluate(async()=>{
  const {runningReviewEditor}=await import('/app/console/pages/activity-running-editor.js');
  runningReviewEditor({rows:[{name:'合成甲',studentId:'9991',item:{id:'one',serviceHours:2,trainingHours:0,travelHours:0,decision:''}},{name:'合成乙',studentId:'9992',item:{id:'two',serviceHours:3,trainingHours:0,travelHours:0,decision:'fail',reason:'合成原因'}}],token:'synthetic',single:true,save:async body=>{window.savedReview=body;},onSaved:async()=>{}});
 });
 const dialog=page.getByRole('dialog',{name:'负责人初审',exact:true});
 await expect(dialog.getByLabel('合成甲 初审结果')).toHaveValue('pass');
 await expect(dialog.getByLabel('合成乙 初审结果')).toHaveValue('fail');
 await dialog.getByLabel('合成乙 服务时长').fill('4');
 await expect(dialog.getByLabel('合成乙 初审结果')).toHaveValue('fail');
 await dialog.getByRole('button',{name:'一键全部通过',exact:true}).click();
 await expect(dialog.getByLabel('合成乙 初审结果')).toHaveValue('pass');
 await dialog.getByLabel('合成甲 服务时长').fill('2.5');
 await expect(dialog.getByLabel('合成甲 初审结果')).toHaveValue('pass');
 await dialog.getByRole('button',{name:'保存初审',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>window.savedReview.items.map(i=>i.decision))).toEqual(['pass','pass']);
});
