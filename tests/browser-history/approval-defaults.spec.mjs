import {test,expect} from '@playwright/test';
test('default reviewers support keyboard multiselect, conflicts and discard protection',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 let payload;
 await page.route('**/workflow/approval-routing',route=>{
  if(route.request().method()==='PUT'){payload=route.request().postDataJSON();return route.fulfill({status:409,json:{message:'合成版本冲突'}});}
  return route.fulfill({json:{ok:true,mode:'organization',version:7,canConfigure:true,categories:[{category:'生命中心',reviewerIds:['chair']}],reviewers:[{id:'chair',name:'合成主席',studentId:'999990001'},{id:'guide',name:'合成指导',studentId:'999990002'}]}});
 });
 await page.goto('/console/events');if((await page.viewportSize()).width<=800)await page.locator('.activity-page-tools > summary').click();await page.getByRole('button',{name:'默认审核人配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'默认审核人配置'});
 await expect(dialog.locator('.people-picker__token')).toContainText('合成主席');
 await dialog.locator('summary').click();await dialog.getByRole('searchbox').fill('999990002');await dialog.getByRole('searchbox').press('Enter');
 await dialog.getByRole('button',{name:'保存默认审核人'}).click();
 await expect.poll(()=>payload).toEqual({version:7,mappings:{生命中心:['chair','guide']}});
 await expect(dialog.locator('.people-picker__token')).toHaveCount(2);
 await page.screenshot({path:info.outputPath('default-reviewers-conflict.png'),fullPage:true});
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('heading',{name:'放弃未保存的修改？'})).toBeVisible();
});
test('configuration entry is hidden when backend denies membership capability',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/workflow/approval-routing',route=>route.fulfill({json:{ok:true,canConfigure:false,categories:[],reviewers:[]}}));
 await page.goto('/console/events');await expect(page.locator('.activity-region')).toHaveAttribute('data-ready','true');
 await expect(page.getByRole('button',{name:'默认审核人配置',exact:true})).toHaveCount(0);
});

test('new application selects category defaults without replacing manual reviewer edits',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/workflow/approval-routing',route=>route.fulfill({json:{ok:true,mode:'organization',canConfigure:false,categories:[{category:'生命中心',reviewerIds:['chair']},{category:'博爱中心',reviewerIds:['guide']}],reviewers:[{id:'chair',name:'合成主席',studentId:'999990001'},{id:'guide',name:'合成指导',studentId:'999990002'}]}}));
 await page.goto('/console/events');if((await page.viewportSize()).width<=800)await page.locator('.activity-page-tools > summary').click();await page.getByRole('button',{name:'新建活动',exact:true}).click();
 const form=page.locator('.activity-create-form'),picker=form.locator('.people-picker').filter({has:page.getByLabel('搜索审核人')});
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:'生命中心',exact:true}).click();
 await expect(picker.locator('.people-picker__token')).toContainText('合成主席');
 await picker.locator('summary').click();await picker.getByRole('searchbox').fill('合成指导');await picker.getByRole('searchbox').press('Enter');
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:'博爱中心',exact:true}).click();
 await expect(picker.locator('.people-picker__token')).toHaveCount(2);
});
