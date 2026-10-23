import {test,expect} from '@playwright/test';
const regions=[['nanjing','南京地区'],['suzhou','苏州地区']];
for(const [name,actor,allowed]of [['南京主任','synthetic-organizer',['nanjing']],['苏州主任','synthetic-suzhou-director',['suzhou']],['主席团现有跨区权限','synthetic-super',['nanjing','suzhou']]]){
 test(`${name}: creation dialog and draft retain disabled foreign regions`,async({page},info)=>{
  await page.request.post('/api/auth/login',{data:{username:actor}});
  await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,canCreate:true,rosterAvailable:true,canSubmit:true,creationScopes:allowed.map(region=>({region,category:'生命中心'}))}}}));
  await page.goto('/console/events');const create=page.getByRole('button',{name:'新建活动',exact:true});await expect(create).toBeEnabled();await create.click();const dialog=page.getByRole('dialog',{name:'新建活动',exact:true});await dialog.getByRole('textbox',{name:'活动名称 必填',exact:true}).fill('地区权限合成测试-'+info.project.name+'-'+actor);
  await dialog.getByRole('combobox',{name:'活动地区',exact:true}).click();
  for(const [region,label]of regions){const option=dialog.getByRole('option',{name:label,exact:true});await expect(option).toBeVisible();await expect(option).toHaveAttribute('aria-disabled',String(!allowed.includes(region)));if(!allowed.includes(region)){await expect(option).toHaveCSS('opacity','0.45');await option.dispatchEvent('click');await expect(dialog.locator('select[name="活动地区"],select').filter({has:page.locator('option[value="nanjing"]')})).toHaveValue('');}}
  await page.screenshot({path:info.outputPath('region-options.png'),animations:'disabled'});
  const own=allowed[0],label=regions.find(([region])=>region===own)[1];await dialog.getByRole('option',{name:label,exact:true}).click();await dialog.getByRole('combobox',{name:'活动类别',exact:true}).click();await dialog.getByRole('option',{name:'生命中心',exact:true}).click();await dialog.getByRole('button',{name:'开始填写',exact:true}).click();
  const draft=page.locator('.activity-draft-workspace');await expect(draft).toBeVisible();await draft.getByRole('combobox',{name:'活动地区',exact:true}).click();for(const [region,label]of regions){const option=draft.getByRole('option',{name:label,exact:true});await expect(option).toBeVisible();await expect(option).toHaveAttribute('aria-disabled',String(!allowed.includes(region)));}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}
