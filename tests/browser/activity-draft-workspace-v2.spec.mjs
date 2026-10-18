import {test,expect} from '@playwright/test';

async function mount(page,{editable=true,complete=true}={}){
 await page.goto('/console/events');
 await page.evaluate(async({editable,complete})=>{
  const {activityDraftWorkspace}=await import('/app/console/pages/activity-draft-workspace.js');
  const {normalizeWorkspaceDraft,workspaceDraftErrors}=await import('/app/shared/activity-workspace.js');
  const content=normalizeWorkspaceDraft(complete?{name:'合成活动',region:'nanjing',category:'生命中心',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-03',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'20',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成服务',notice:'合成通知'}:{name:'只有名称'});
  const state={content,version:1,saved:0,submitted:0,previewed:null};window.workspaceTest=state;
  const editor=activityDraftWorkspace({initial:{id:'draft-test',version:1,content},editable,
   save:async({content})=>{state.content=structuredClone(content);state.version++;state.saved++;return {id:'draft-test',version:state.version,content:state.content};},
   preview:async()=>({content:structuredClone(state.content),digest:'version-'+state.version,errors:workspaceDraftErrors(state.content)}),
   confirmPreview:async(_id,{digest})=>{state.previewed=digest;},submit:async()=>{state.submitted++;}});
  document.getElementById('root').replaceChildren(editor.node);window.workspaceEditor=editor;
 },{editable,complete});
}
test('real inline draft component saves, previews all information and invalidates preview after edits',async({page})=>{
 await mount(page);
 const send=page.getByRole('button',{name:'提交审批',exact:true});await expect(send).toBeDisabled();
 await page.getByRole('button',{name:'预览',exact:true}).click();const drawer=page.getByRole('dialog',{name:'完整活动预览'});await expect(drawer).toContainText('合成地点');await expect(drawer).toContainText('3 / 0 / 0');
 await drawer.getByRole('button',{name:'确认已预览',exact:true}).click();await expect(drawer).toHaveCount(0);await expect(send).toBeEnabled();
 await page.getByLabel('活动名称',{exact:true}).fill('合成修改');await expect(send).toBeDisabled();await expect.poll(()=>page.evaluate(()=>window.workspaceEditor.hasUnsaved())).toBe(true);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.saved)).toBe(1);await expect(send).toBeDisabled();
 await page.getByRole('button',{name:'预览',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认已预览',exact:true}).click();await expect(send).toBeEnabled();await send.click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.submitted)).toBe(1);
});
test('incomplete draft has no booking default and saves without fabricated required facts',async({page})=>{
 await mount(page,{complete:false});await expect(page.locator('select[name=bookingMode]')).toHaveValue('');await expect(page.getByLabel('活动开始日期',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.saved)).toBe(1);
 const content=await page.evaluate(()=>window.workspaceTest.content);expect(content.date).toBe('');expect(content.serviceHours).toBe('');
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();const information=page.getByRole('dialog',{name:'活动信息',exact:true});await expect(information).toContainText('未选择报名方式');await expect(information).toContainText('未填写');await expect(information).not.toContainText('整体活动统一报名');await information.getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('button',{name:'预览',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'确认已预览',exact:true})).toBeDisabled();
});
test('read-only actor cannot edit, save, preview-confirm or submit the draft',async({page})=>{
 await mount(page,{editable:false});await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'提交审批',exact:true})).toBeDisabled();
 expect(await page.locator('.activity-draft-workspace__form').evaluate(n=>n.inert)).toBe(true);
 await expect(page.getByRole('button',{name:'活动信息修改',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动信息',exact:true});await expect(dialog).toContainText('合成通知');await expect(dialog.getByRole('button',{name:'确认已预览',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.workspaceTest.previewed)).toBe(null);
});
test('shared console rail stays compact across overview, administrator and activity pages',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Mobile uses its existing navigation drawer.');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 for(const path of ['/console/overview','/console/admin','/console/events']){
  await page.goto(path);await expect(page.locator('.console')).toBeVisible();await expect.poll(async()=>Math.round((await page.locator('.nav').boundingBox()).width)).toBeLessThanOrEqual(200);
 }
 await expect.poll(async()=>Math.round((await page.locator('.activity-master').boundingBox()).width)).toBeLessThanOrEqual(250);
});
test('opt-in real workspace creates a name-only draft through API and restores server-saved content after reload',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events?workspace=v2');
 await page.getByRole('button',{name:'新建活动',exact:true}).click();const modal=page.getByRole('dialog',{name:'新建活动'});
 const name='合成接口草稿-'+info.project.name;await modal.getByRole('textbox',{name:'活动名称 必填',exact:true}).fill(name);await modal.getByRole('button',{name:'开始填写',exact:true}).click();await expect(modal).toHaveCount(0);
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue(name);await pane.getByLabel('活动名称',{exact:true}).fill(name+'修改');await pane.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(pane.getByRole('status')).toHaveText('已保存');
 await page.reload();await expect(page.getByRole('region',{name:'活动操作工作区'}).getByLabel('活动名称',{exact:true})).toHaveValue(name+'修改');
 await page.getByRole('button',{name:'收起活动列表',exact:true}).click();await expect(page.locator('.activity-v2-directory')).toBeHidden();await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue(name+'修改');await page.getByRole('button',{name:'展开活动列表',exact:true}).click();await expect(page.locator('.activity-v2-directory')).toBeVisible();
 const response=await page.request.get('/api/volunteer/workflow/workspace-drafts');const saved=(await response.json()).drafts.find(d=>d.content.name===name+'修改');expect(saved.content.date).toBe('');expect(saved.content.bookingMode).toBe('');expect(saved.version).toBe(2);
});

test('desktop workspace keeps filters and actions fixed while list and editor scroll independently',async({page},info)=>{
 test.skip(info.project.name.includes('mobile'),'Desktop split panes have independent scrolling.');
 await page.setViewportSize({width:1440,height:900});await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const session=await (await page.request.get('/api/auth/session')).json();
 const headers={'x-csrf-token':session.csrfToken};
 let selected;
 for(let i=0;i<14;i++){
  const response=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers,data:{requestId:crypto.randomUUID(),content:{name:`合成独立滚动草稿${i}`}}});expect(response.ok()).toBe(true);selected=(await response.json()).result.id;
 }
 await page.goto(`/console/events?workspace=v2&draft=${selected}`);
 await page.getByRole('combobox',{name:'报名方式',exact:true}).click();await page.getByRole('option',{name:'按岗位分别报名',exact:true}).click();
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'添加岗位',exact:true}).click();
 const heading=page.locator('.activity-v2-heading'),toolbar=page.locator('.activity-draft-toolbar'),filters=page.locator('.activity-v2-filters'),form=page.locator('.activity-draft-workspace__form'),list=page.locator('.activity-v2-list');
 const before={heading:(await heading.boundingBox()).y,toolbar:(await toolbar.boundingBox()).y,filters:(await filters.boundingBox()).y};
 await form.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect.poll(()=>form.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 await list.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 expect((await heading.boundingBox()).y).toBe(before.heading);expect((await toolbar.boundingBox()).y).toBe(before.toolbar);expect((await filters.boundingBox()).y).toBe(before.filters);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await form.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:info.outputPath('activity-workspace-fixed-panes.png'),animations:'disabled'});
});
