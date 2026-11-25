import {test,expect} from '@playwright/test';

test('role settings explain a configured account with a missing events scope',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.route('**/workspace-drafts/role-settings',route=>route.fulfill({json:{ok:true,result:{version:3,assignments:[{accountId:'synthetic-director',roles:['R01'],initialCategories:[],finalCategories:[]}],accounts:[{id:'synthetic-director',name:'合成主任',hasEventsScope:false},{id:'synthetic-super',name:'合成总管理员',hasEventsScope:true}],scopes:['materials','events','outreach','community','data','settings','accounts'],legacyRows:0}}}));
 await page.goto('/console/admin');
 await page.getByRole('button',{name:'活动权限与负责人配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动权限与负责人配置',exact:true});
 await expect(dialog.getByText('缺少「活动管理」模块权限')).toBeVisible();
 await expect(dialog.locator('details.activity-role-entry')).toContainText('合成主任');
 await expect(dialog.locator('details.activity-role-entry')).toContainText('缺少活动模块权限');
 await expect(dialog.getByText('请选择平台账号')).toHaveCount(0);
});
