import {test,expect} from '@playwright/test';

async function mount(page,mail=false){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 await page.evaluate(async mail=>{
  const {h}=await import('/app/core/dom.js'),{activityRegistrationWorkspace}=await import('/app/console/pages/activity-registration-workspace.js');
  const event={_id:'tools-event',活动ID:'tools-id',活动名称:'合成报名名单',状态:'报名中',报名页配置:'{}',approvalAccess:{canManageRegistration:true}};
  const registrations=[
   {_id:'a',姓名:'合成甲',学号:'1003',校区:'鼓楼',账号ID:'account-a',报名状态:'待筛选'},
   {_id:'b',姓名:'合成乙',学号:'1001',校区:'仙林',部门:'生命中心',报名状态:'待筛选'},
   {_id:'c',姓名:'合成丙',学号:'1002',校区:'鼓楼',部门:'办公室',报名状态:'已确认'},
   {_id:'d',姓名:'合成丁',学号:'1004',校区:'鼓楼',部门:'办公室',报名状态:'已取消'},
   {_id:'other',活动ID:'other-id',姓名:'其他岗位',学号:'0001',校区:'仙林',报名状态:'待筛选'},
  ].map(row=>({活动ID:'tools-id',...row}));
  const data={events:[event,{...event,_id:'other',活动ID:'other-id',岗位:'其他岗'}],registrations,participants:[{accountId:'account-a',organizationDepartment:'办公室'}]};
  window.registrationWrites=[];
  const ui=activityRegistrationWorkspace({event,data,reload:async()=>data,decide:async(...args)=>window.registrationWrites.push(args),close:async()=>{},loadMailStatuses:mail?async()=>[{id:'c',status:'failed',reason:'合成邮箱暂不可达'}]:undefined});
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2'},ui.node));
 },mail);
}
async function choose(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
const names=page=>page.locator('.activity-registration-table tbody [data-roster-column="姓名"]').allTextContents();

test('registration filters combine within one position, reset and clear hidden batch selections',async({page},info)=>{
 await mount(page);
 expect(await names(page)).toEqual(['合成甲','合成乙','合成丙','合成丁']);
 await choose(page,'排序','学号升序');expect(await names(page)).toEqual(['合成乙','合成丙','合成甲','合成丁']);
 await choose(page,'排序','学号降序');expect(await names(page)).toEqual(['合成丁','合成甲','合成丙','合成乙']);
 await choose(page,'校区','鼓楼');await choose(page,'部门','办公室');
 await page.getByRole('searchbox',{name:'搜索报名'}).fill('1003');
 expect(await names(page)).toEqual(['合成甲']);
 await choose(page,'报名状态','报名成功');await expect(page.getByText('暂无符合条件的报名',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'重置',exact:true}).click();expect(await names(page)).toEqual(['合成甲','合成乙','合成丙','合成丁']);
 await expect(page.getByRole('combobox',{name:'排序',exact:true})).toContainText('默认顺序');
 await page.getByRole('button',{name:'批量操作',exact:true}).click();await page.getByRole('checkbox',{name:'选择合成甲',exact:true}).check();
 await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toBeEnabled();
 await page.getByRole('searchbox',{name:'搜索报名'}).fill('合成乙');
 await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toBeDisabled();
 await page.getByRole('searchbox',{name:'搜索报名'}).fill('');await page.getByRole('button',{name:'退出批量操作',exact:true}).click();
 await page.screenshot({path:info.outputPath('registration-management.png'),fullPage:true,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await page.evaluate(()=>window.registrationWrites)).toEqual([]);
});

test('cancelled confirmation preserves compact roster buttons and keyboard focus',async({page},info)=>{
 await mount(page);
 const row=page.getByRole('row').filter({hasText:'合成甲'}),button=row.getByRole('button',{name:'报名成功',exact:true});
 const before=await row.boundingBox();
 await button.focus();await button.press('Enter');
 const dialog=page.getByRole('dialog',{name:'确认 1 人报名成功？',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();
 const after=await row.boundingBox();expect(after.height).toBe(before.height);
 const box=await button.boundingBox();expect(box.height).toBe(info.project.name.startsWith('mobile')?44:28);
 const cancelled=page.getByRole('row').filter({hasText:'合成丁'});await expect(cancelled.getByRole('button')).toHaveCount(0);
 if(!info.project.name.startsWith('mobile'))expect((await cancelled.boundingBox()).height).toBe(after.height);
 await choose(page,'报名状态','已取消');expect(await names(page)).toEqual(['合成丁']);
 expect(await page.evaluate(()=>window.registrationWrites)).toEqual([]);
});


test('latest-main mail details and notification preview survive the roster integration',async({page})=>{
 await mount(page,true);const row=page.getByRole('row').filter({hasText:'合成丙'});
 await expect(row).toContainText('发送失败');await row.getByRole('button',{name:'查看详情',exact:true}).click();
 const detail=page.getByRole('dialog',{name:'邮件发送详情',exact:true});await expect(detail).toContainText('合成邮箱暂不可达');await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
 let previews=0,sends=0;
 await page.route('**/api/volunteer/workflow/events/tools-event/notify-results',route=>{const body=route.request().postDataJSON();if(body.preview){previews++;expect(body.ids).toEqual(['c']);return route.fulfill({json:{ok:true,items:[{id:'c',name:'合成丙',email:'synthetic@example.test',information:'合成通知预览'}]}});}sends++;return route.fulfill({json:{ok:true,results:[]}});});
 await page.getByRole('searchbox',{name:'搜索报名'}).fill('1002');await page.getByRole('button',{name:'再次通知',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'再次通知 · 收件核验',exact:true});await expect(preview).toContainText('合成通知预览');await expect(preview.getByRole('button',{name:'确认再次通知',exact:true})).toBeEnabled();expect(previews).toBe(1);expect(sends).toBe(0);await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);expect(sends).toBe(0);
});
