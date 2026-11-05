import {test,expect} from '@playwright/test';

test('pending draft has a working dedicated recovery action for an authorized manager',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let pending=true,calls=0;
 const draft={id:'synthetic-stuck-draft',ownerId:'other-submitter',version:2,stage:'草稿',submissionStatus:'pending',activityId:'WS-synthetic-stuck-draft',access:{canView:true,canEdit:false,canReconcile:true},content:{name:'合成待核对活动',region:'nanjing',category:'生命中心',bookingMode:'unified',notice:'合成通知'}};
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:pending?[draft]:[],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/synthetic-stuck-draft/reconcile',route=>{calls++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({});pending=false;return route.fulfill({json:{ok:true,result:{stage:'待审批',activityId:draft.activityId}}});});
 await page.goto('/console/events?draft=synthetic-stuck-draft');await expect(page.getByLabel('活动名称',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(page.getByText('该草稿上次提交的结果尚待核对，编辑和删除暂时锁定。请点击“核对提交结果”；核对成功后将打开对应正式活动。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'核对提交结果',exact:true}).click();await expect.poll(()=>calls).toBe(1);await expect(page.getByRole('button',{name:'核对提交结果',exact:true})).toHaveCount(0);
});
