import {test,expect} from '@playwright/test';
async function openActivityTasks(page) {
 const menu=page.locator('.activity-task-menu');
 await expect(menu).toBeVisible();
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
}


test('owner editor preserves selections after conflict and sends stable IDs',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'合成负责人配置',date:'2030-01-12',slot:'09:00-12:00',capacity:2,serviceHours:3,location:'合成地点',work:'合成服务',submit:false}});
 const id=(await response.json()).result._id;
 await page.route('**/workflow/directory?owners=true',route=>route.fulfill({json:{ok:true,administrators:[{id:'owner-synthetic',name:'合成负责人',studentId:'999990021'}],participants:[]}}));
 let payload;
 await page.route(`**/workflow/events/${id}/owners`,route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{ok:true,primary:'synthetic-organizer',coOwners:[],token:'synthetic-version'}});
  payload=route.request().postDataJSON();return route.fulfill({status:409,json:{ok:false,message:'合成版本冲突'}});
 });
 await page.goto(`/console/events?legacy=1&event=${id}&mode=all&scope=session`);
 await openActivityTasks(page);await page.getByRole('button',{name:'管理负责人',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动负责人'});
 await dialog.locator('summary').click();await dialog.getByRole('searchbox',{name:'搜索负责人'}).fill('999990021');
 await dialog.getByRole('searchbox',{name:'搜索负责人'}).press('Enter');
 await dialog.getByRole('button',{name:'保存负责人',exact:true}).click();
 await expect.poll(()=>payload).toEqual({primary:'synthetic-organizer',coOwners:['owner-synthetic'],token:'synthetic-version'});
 await expect(dialog.locator('.people-picker__token')).toContainText('合成负责人');
 await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('activity-owners-conflict.png'),fullPage:true});
});
