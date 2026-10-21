import {test,expect} from '@playwright/test';

test('super-admin role editor binds stable accounts and sends exact centre scopes',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 let submitted;
 await page.route('**/workspace-drafts/role-settings',async route=>{
  if(route.request().method()==='PUT'){submitted=route.request().postDataJSON();return route.fulfill({json:{ok:true,result:{version:8}}});}
  return route.fulfill({json:{ok:true,result:{version:7,assignments:[],accounts:[{id:'synthetic-chair',name:'合成分管主席'}]}}});
 });
 await page.goto('/console/events');
 const tools=page.locator('.activity-page-tools');if(!await tools.evaluate(node=>node.open))await tools.locator('summary').click();
 await page.getByRole('button',{name:'活动权限与负责人配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动权限与负责人配置',exact:true});
 await dialog.getByRole('button',{name:'添加账号',exact:true}).click();
 const trigger=dialog.getByRole('combobox',{name:'平台账号',exact:true});await trigger.click();await page.getByRole('option',{name:'合成分管主席（synthetic-chair）',exact:true}).click();
 await dialog.getByRole('checkbox',{name:'R05 · 南京终审',exact:true}).check();
 await dialog.getByRole('checkbox',{name:'生命中心',exact:true}).check();
 await dialog.getByRole('button',{name:'保存活动权限',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(submitted).toEqual({version:7,assignments:[{accountId:'synthetic-chair',roles:['R05'],finalCategories:['生命中心'],initialCategories:[]}]});
});

test('non-global administrator has neither role editor button nor role-setting API access',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto('/console/events');
 await expect(page.getByRole('button',{name:'活动权限与负责人配置',exact:true})).toHaveCount(0);
 const response=await page.request.get('/api/volunteer/workflow/workspace-drafts/role-settings');expect(response.status()).toBe(403);
});

test('off-campus positions retain hours internally and show numbered saved preview without live editing',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const content={name:'合成校外岗位预览',region:'nanjing',category:'生命中心',responsibleId:'synthetic-life-director-two',responsibleIds:['synthetic-life-director-two','synthetic-organizer'],bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-01',deadline:'2029-12-31T18:00',positions:[{id:'offsite-a',name:'社区引导',date:'2030-01-01',start:'09:15',end:'11:45',campus:'',location:'校外社区服务站',capacity:'4',serviceHours:'2.5',trainingHours:'1',travelHours:'0.5',work:'合成社区服务'}]};
 const root='/api/volunteer/workflow/workspace-drafts',response=await page.request.post(root,{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content}});
 expect(response.ok()).toBe(true);const draft=(await response.json()).result;
 await page.goto(`/console/events?draft=${draft.id}`);const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.getByLabel('校区',{exact:true})).toHaveCount(0);await expect(pane.locator('.activity-position-label')).toHaveText('岗位一');
 await expect(pane.getByRole('group',{name:'活动负责人（可多选）',exact:true}).getByRole('checkbox',{checked:true})).toHaveCount(2);
 await pane.getByLabel('地点',{exact:true}).fill('校外社区服务站东门');
 const notice=pane.getByLabel('通知正文',{exact:true});await expect(notice).toHaveValue(/09:15-11:45/);await expect(notice).not.toHaveValue(/志愿时长|培训1小时|交通0.5小时/);
 await pane.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(pane.getByRole('status')).toHaveText('已保存');
 await pane.getByRole('button',{name:'预览并提交',exact:true}).click();const preview=page.getByRole('dialog',{name:'完整活动预览',exact:true});
 await expect(preview.locator('.activity-preview-position h3')).toHaveText('岗位一 · 社区引导');await expect(preview).toContainText('校外社区服务站东门');await expect(preview.locator('.activity-preview__metrics')).toContainText('2.5');await expect(preview.locator('input,select,textarea')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('saved-activity-paper.png'),fullPage:true});
 await preview.getByRole('button',{name:'提交审核',exact:true}).click();await expect(preview).toHaveCount(0);await expect(pane.locator('[aria-current=step]')).toHaveText('待审批');
});
