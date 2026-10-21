import {test,expect} from '@playwright/test';
test('every console administrator retains the activity navigation and can open its page',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/auth/session',async route=>{
  const response=await route.fetch(),payload=await response.json();
  payload.user.permissions=['community'];payload.user.consoleAccess=true;
  await route.fulfill({response,json:payload});
 });
 await page.goto('/console/overview');
 const entry=page.locator('a[href="/console/events"]').first();await expect(entry).toBeAttached();
 await page.goto('/console/events');await expect(page).toHaveURL(/\/console\/events/);
 await expect(page.getByRole('heading',{name:'活动管理',exact:true})).toBeVisible();
});

test('read-only administrator sees activity cards and information with disabled operations',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const event={_id:'readonly-event',活动ID:'readonly-code',活动名称:'合成只读活动',活动地区:'南京地区',组织类别:'生命中心',状态:'报名中',报名日期:'2030-10-12',报名时段:'09:00-12:00',地点:'合成地点',岗位:'合成岗位',容量:10,服务时长:3,工作内容:'合成工作内容',通知草稿:'合成报名通知',readOnly:true,报名页配置:JSON.stringify({region:'南京活动',center:'生命中心'})};
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,canManageActivities:false,events:[event]}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,canCreate:false,creationScopes:[],rosterAvailable:true}}}));
 await page.route('**/api/volunteer/workflow/events/readonly-event/information',route=>route.fulfill({json:{ok:true,events:[event]}}));
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').filter({hasText:'合成只读活动'})).toBeVisible();await page.locator('.activity-v2-card').filter({hasText:'合成只读活动'}).click();
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByText('合成工作内容',{exact:true})).toBeVisible();
 await expect(pane.getByRole('button',{name:'活动信息修改',exact:true})).toBeDisabled();await expect(pane.getByRole('button',{name:'更多操作',exact:true})).toBeDisabled();
 await expect(pane.getByText('当前账号无此活动的操作权限，仅可查看活动信息。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新建活动',exact:true})).toBeDisabled();
});

test('center creation remains enabled independently of existing activity management',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,canManageActivities:false,events:[]}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,rosterAvailable:true,canSubmit:true,canCreate:true,creationScopes:[{region:'nanjing',category:'生命中心'}]}}}));
 await page.goto('/console/events');const create=page.getByRole('button',{name:'新建活动',exact:true});await expect(create).toBeEnabled();await create.click();
 const dialog=page.getByRole('dialog',{name:'新建活动',exact:true});await dialog.getByRole('textbox',{name:'活动名称 必填',exact:true}).fill('合成中心新活动-'+info.project.name);await dialog.getByRole('combobox',{name:'活动地区',exact:true}).click();await page.getByRole('option',{name:'南京地区',exact:true}).click();
 await dialog.getByRole('combobox',{name:'活动类别',exact:true}).click();await expect(page.getByRole('option',{name:'博爱中心',exact:true})).toHaveCount(0);await page.getByRole('option',{name:'生命中心',exact:true}).click();
 await dialog.getByRole('button',{name:'开始填写',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.activity-v2-card').filter({hasText:'合成中心新活动-'+info.project.name})).toBeVisible();
});
