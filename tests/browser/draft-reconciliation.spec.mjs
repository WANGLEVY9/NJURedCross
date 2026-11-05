import {test,expect} from '@playwright/test';

test('pending draft has a working dedicated recovery action for an authorized manager',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let pending=true,calls=0;
 const draft={id:'synthetic-stuck-draft',ownerId:'other-submitter',version:2,stage:'草稿',submissionStatus:'pending',activityId:'WS-synthetic-stuck-draft',access:{canView:true,canEdit:false,canReconcile:true},content:{name:'合成待核对活动',region:'nanjing',category:'生命中心',bookingMode:'unified',notice:'合成通知'}};
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:pending?[draft]:[],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/synthetic-stuck-draft/reconcile',route=>{calls++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({});pending=false;return route.fulfill({json:{ok:true,result:{stage:'待审批',activityId:draft.activityId}}});});
 await page.goto('/console/events?draft=synthetic-stuck-draft');await expect(page.getByLabel('活动名称',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(page.getByText('该草稿上次提交的结果尚待核对，编辑和删除暂时锁定。请点击“核对提交结果”；核对成功后将打开对应正式活动。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'核对提交结果',exact:true}).click();await expect.poll(()=>calls).toBe(1);await expect(page.getByRole('button',{name:'核对提交结果',exact:true})).toHaveCount(0);
});


for(const initiallyUnavailable of [false,true])test(`restore a missing submission preserves the form and unlocks original draft (${initiallyUnavailable?'read failure then retry':'success'})`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let pending=true,calls=0;
 const draft={id:'synthetic-restore-draft',ownerId:'other-submitter',version:2,stage:'草稿',submissionStatus:'pending',activityId:'WS-synthetic-restore-draft',access:{canView:true,canEdit:false,canReconcile:true,canRestore:true},content:{name:'合成原活动恢复',region:'nanjing',category:'生命中心',bookingMode:'unified',notice:'原通知保留'}};
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:[pending?draft:{...draft,version:3,submissionStatus:undefined,access:{canView:true,canEdit:true}}],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/synthetic-restore-draft/restore',route=>{calls++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({expectedVersion:2});if(initiallyUnavailable&&calls===1)return route.fulfill({status:503,json:{ok:false,message:'合成只读核对失败'}});pending=false;return route.fulfill({json:{ok:true,result:{id:draft.id,version:3,stage:'草稿',restored:true}}});});
 await page.goto('/console/events?draft='+draft.id);await expect(page.getByLabel('活动名称',{exact:true})).toBeDisabled();
 const restore=page.getByRole('button',{name:'恢复为可编辑草稿',exact:true});await restore.click();const dialog=page.getByRole('dialog',{name:'恢复为可编辑草稿？',exact:true});await expect(dialog).toBeVisible();expect(calls).toBe(0);await dialog.getByRole('button',{name:'确认恢复',exact:true}).click();
 if(initiallyUnavailable){await expect(dialog).toHaveCount(0);await expect(page.getByText('合成只读核对失败',{exact:true})).toBeVisible();await expect(page.getByLabel('活动名称',{exact:true})).toBeDisabled();await restore.click();await page.getByRole('dialog',{name:'恢复为可编辑草稿？',exact:true}).getByRole('button',{name:'确认恢复',exact:true}).click();}
 await expect(page.getByLabel('活动名称',{exact:true})).toBeEnabled();await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue(draft.content.name);await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeEnabled();await expect(restore).toHaveCount(0);expect(calls).toBe(initiallyUnavailable?2:1);
 await page.locator('.activity-v2-more>summary').click();await expect(page.getByRole('button',{name:'删除活动',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('restored-original-draft.png')});
});
