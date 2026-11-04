import {test,expect} from '@playwright/test';
test('role list expands by person and region switching preserves existing grants',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let submitted;
 const assignments=[{accountId:'synthetic-director',roles:['R01','R05'],finalCategories:['综事中心'],initialCategories:['排班专项']}];
 await page.route('**/workspace-drafts/role-settings',route=>{if(route.request().method()==='PUT'){submitted=route.request().postDataJSON();return route.fulfill({json:{ok:true,result:{version:2}}});}return route.fulfill({json:{ok:true,result:{version:1,assignments,accounts:[{id:'synthetic-director',name:'合成主任'}]}}});});
 await page.goto('/console/admin');await page.getByRole('button',{name:'活动权限与负责人配置',exact:true}).click();const dialog=page.getByRole('dialog',{name:'活动权限与负责人配置',exact:true});const row=dialog.locator('details.activity-role-entry');await expect(row).toHaveCount(1);expect(await row.evaluate(n=>n.open)).toBe(false);await row.locator('summary').click();const initialRegion=row.getByRole('combobox',{name:'配置地区',exact:true});await expect(initialRegion).toContainText('待选择');await initialRegion.click();await page.getByRole('option',{name:'南京主任团／主席团',exact:true}).click();await expect(row.getByRole('checkbox',{name:'R01 · 南京综事活动发起与负责',exact:true})).toBeChecked();await expect(row.getByRole('checkbox',{name:'R01 · 南京综事活动发起与负责',exact:true})).toHaveAccessibleDescription(/本人被指定为负责人/);await expect(row.getByRole('checkbox',{name:'R05 · 南京终审',exact:true})).toHaveAccessibleDescription(/时长终审/);
 const region=row.getByRole('combobox',{name:'配置地区',exact:true});await region.click();await page.getByRole('option',{name:'苏州主任团／主席团',exact:true}).click();await expect(row.getByRole('checkbox',{name:'R04 · 苏州活动发起与负责',exact:true})).toBeVisible();await expect(row).toContainText('不会删除');
 await page.screenshot({path:info.outputPath('role-list.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await dialog.getByRole('button',{name:'保存活动权限',exact:true}).click();await expect(dialog).toHaveCount(0);expect(submitted.assignments).toEqual(assignments);
});


test('role account choices exclude assigned people, release removed choices and preserve existing grants',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});let submitted;
 const original={accountId:'configured-a',roles:['R01','R05'],finalCategories:['综事中心'],initialCategories:['排班专项']};
 const accounts=[{id:'configured-a',name:'合成甲'},{id:'available-b',name:'合成乙'},{id:'available-c',name:'合成丙'}];
 await page.route('**/workspace-drafts/role-settings',route=>route.request().method()==='PUT'?(submitted=route.request().postDataJSON(),route.fulfill({json:{ok:true,result:{version:2}}})):route.fulfill({json:{ok:true,result:{version:1,assignments:[original],accounts}}}));
 await page.goto('/console/admin');await page.getByRole('button',{name:'活动权限与负责人配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动权限与负责人配置',exact:true}),rows=dialog.locator('.activity-role-entry'),add=dialog.getByRole('button',{name:'添加账号',exact:true});
 await add.click();await expect(rows).toHaveCount(2);await add.click();await expect(rows).toHaveCount(2);
 await rows.last().getByRole('combobox',{name:'平台账号',exact:true}).click();await expect(page.getByRole('option',{name:'合成甲（configured-a）',exact:true})).toHaveCount(0);
 await page.getByRole('option',{name:'合成乙（available-b）',exact:true}).click();
 await rows.last().getByRole('combobox',{name:'配置地区',exact:true}).click();await page.getByRole('option',{name:'苏州主任团／主席团',exact:true}).click();await rows.last().getByRole('checkbox',{name:'R04 · 苏州活动发起与负责',exact:true}).check();
 await add.click();await rows.last().getByRole('combobox',{name:'平台账号',exact:true}).click();await expect(page.getByRole('option',{name:'合成乙（available-b）',exact:true})).toHaveCount(0);await rows.last().getByRole('combobox',{name:'平台账号',exact:true}).click();
 const second=rows.nth(1);await second.locator('summary').click();await second.getByRole('button',{name:'移除此项角色配置',exact:true}).click();await expect(rows).toHaveCount(2);
 await rows.last().getByRole('combobox',{name:'平台账号',exact:true}).click();await expect(page.getByRole('option',{name:'合成乙（available-b）',exact:true})).toBeVisible();await page.getByRole('option',{name:'合成乙（available-b）',exact:true}).click();
 await rows.last().getByRole('combobox',{name:'配置地区',exact:true}).click();await page.getByRole('option',{name:'苏州主任团／主席团',exact:true}).click();await rows.last().getByRole('checkbox',{name:'R04 · 苏州活动发起与负责',exact:true}).check();
 await add.click();await rows.last().getByRole('combobox',{name:'平台账号',exact:true}).click();await page.getByRole('option',{name:'合成丙（available-c）',exact:true}).click();await expect(add).toBeDisabled();
 await rows.last().getByRole('combobox',{name:'配置地区',exact:true}).click();await page.getByRole('option',{name:'苏州主任团／主席团',exact:true}).click();await rows.last().getByRole('checkbox',{name:'R04 · 苏州活动发起与负责',exact:true}).check();
 await rows.first().locator('summary').click();await rows.first().getByRole('combobox',{name:'平台账号',exact:true}).click();await expect(page.getByRole('option',{name:'合成甲（configured-a）',exact:true})).toBeVisible();await expect(page.getByRole('option',{name:'合成乙（available-b）',exact:true})).toHaveCount(0);await rows.first().getByRole('combobox',{name:'平台账号',exact:true}).click();
 await dialog.getByRole('button',{name:'保存活动权限',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(submitted.assignments).toEqual([original,...['available-b','available-c'].map(accountId=>({accountId,roles:['R04'],finalCategories:[],initialCategories:[]}))]);
});
