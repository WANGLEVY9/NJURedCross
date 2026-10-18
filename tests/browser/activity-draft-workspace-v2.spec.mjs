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
 await expect(page.locator('select[name=bookingMode] option')).toHaveText(['待选择','单岗位','多岗位']);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.saved)).toBe(1);
 const content=await page.evaluate(()=>window.workspaceTest.content);expect(content.date).toBe('');expect(content.serviceHours).toBe('');
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();const information=page.getByRole('dialog',{name:'活动信息',exact:true});await expect(information).toContainText('待选择');await expect(information).toContainText('未填写');await expect(information).not.toContainText('整体活动统一报名');await information.getByRole('button',{name:'返回',exact:true}).click();
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
 await page.getByRole('combobox',{name:'岗位数量',exact:true}).click();await page.getByRole('option',{name:'多岗位',exact:true}).click();
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'添加岗位',exact:true}).click();
 const heading=page.locator('.activity-v2-heading'),toolbar=page.locator('.activity-draft-toolbar'),filters=page.locator('.activity-v2-filters'),form=page.locator('.activity-draft-workspace__form'),list=page.locator('.activity-v2-list');
 const before={heading:(await heading.boundingBox()).y,toolbar:(await toolbar.boundingBox()).y,filters:(await filters.boundingBox()).y};
 await form.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect.poll(()=>form.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 await list.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 expect((await heading.boundingBox()).y).toBe(before.heading);expect((await toolbar.boundingBox()).y).toBe(before.toolbar);expect((await filters.boundingBox()).y).toBe(before.filters);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await form.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:info.outputPath('activity-workspace-fixed-panes.png'),animations:'disabled'});
});

test('responsible picker persists the chosen center director and opens their exact linked personal archive',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const created=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content:{name:'合成负责人关联',region:'nanjing',category:'生命中心'}}});expect(created.ok()).toBe(true);const id=(await created.json()).result.id;
 await page.goto(`/console/events?workspace=v2&draft=${id}`);
 const picker=page.getByRole('combobox',{name:'活动负责人',exact:true});await expect(picker).toBeEnabled();await picker.click();
 await expect(page.getByRole('option',{name:'合成主席团',exact:true})).toHaveCount(0);
 await page.getByRole('option',{name:'合成生命主任（synthetic-life-director-two）',exact:true}).click();
 await page.getByRole('button',{name:'查看个人资料档案',exact:true}).click();
 const archive=page.getByRole('dialog',{name:'负责人个人资料档案',exact:true});await expect(archive).toContainText('合成院系2');await expect(archive).not.toContainText('合成院系1');
 await page.keyboard.press('Escape');await expect(archive).toHaveCount(0);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('region',{name:'活动操作工作区'}).getByRole('status')).toHaveText('已保存');
 await page.reload();await expect(page.getByRole('button',{name:'查看个人资料档案',exact:true})).toBeEnabled();
 const saved=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${id}`)).json()).result;expect(saved.content.responsibleId).toBe('synthetic-life-director-two');
 await page.getByRole('combobox',{name:'活动地区',exact:true}).click();await page.getByRole('option',{name:'苏州地区',exact:true}).click();
 await expect(page.locator('select[name=responsibleId]')).toHaveValue('');await expect(page.getByRole('button',{name:'查看个人资料档案',exact:true})).toBeDisabled();await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue('合成负责人关联');
});

test('copy creates a new draft card with every position and updates its generated notice without changing the source',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const positions=[{id:'source-position-a',name:'引导岗',date:'2030-01-02',start:'09:15',end:'11:45',campus:'仙林',location:'合成地点甲',capacity:'4',serviceHours:'2.5',trainingHours:'0.5',travelHours:'0',work:'引导工作'},{id:'source-position-b',name:'登记岗',date:'2030-01-03',start:'14:05',end:'16:20',campus:'鼓楼',location:'合成地点乙',capacity:'3',serviceHours:'2',trainingHours:'0',travelHours:'1',work:'登记工作'}];
 const response=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content:{name:'合成复制岗位活动',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'原手工通知',positions}}});expect(response.ok()).toBe(true);const source=(await response.json()).result;
 await page.goto(`/console/events?workspace=v2&draft=${source.id}`);await page.locator('summary').filter({hasText:'更多操作'}).click();await page.getByRole('button',{name:'复制为新活动',exact:true}).click();
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue('合成复制岗位活动（副本）');await expect(page.locator('.activity-v2-list').getByRole('button',{name:/合成复制岗位活动（副本） 草稿/})).toBeVisible();
 await expect(pane.getByLabel('岗位名称',{exact:true})).toHaveCount(2);await expect(pane.getByLabel('岗位名称',{exact:true}).nth(1)).toHaveValue('登记岗');await expect(pane.getByLabel('开始时间',{exact:true}).first()).toHaveValue('09:15');
 await pane.getByLabel('活动名称',{exact:true}).fill('修改后的副本');await pane.getByLabel('岗位名称',{exact:true}).first().fill('副本接待岗');await pane.getByLabel('开始时间',{exact:true}).first().fill('10:05');
 await expect(pane.getByLabel('通知正文',{exact:true})).toHaveValue(/修改后的副本[\s\S]*副本接待岗[\s\S]*10:05—11:45/);
 await pane.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(pane.getByRole('status')).toHaveText('已保存');
 const copyId=new URL(page.url()).searchParams.get('draft');expect(copyId).not.toBe(source.id);
 const copied=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${copyId}`)).json()).result;
 expect(copied.content.positions.map(p=>p.id)).not.toContain('source-position-a');expect(copied.content.positions[1].travelHours).toBe('1');
 expect((await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${source.id}`)).json()).result).toEqual(source);
});

test('legacy formal activity copies its saved position draft into the new sidebar draft card',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});const headers={'x-csrf-token':'synthetic-ui'};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成旧活动复制-'+info.project.name,center:'生命中心',region:'南京活动',bookingMode:'grouped',window:{start:'2030-01-01T08:00',end:'2030-01-03T18:00'},capacity:4,serviceHours:2,trainingHours:0,travelHours:0,location:'合成旧场馆',work:'合成服务',submit:false}});expect(created.ok()).toBe(true);const source=(await created.json()).result;
 const beforeConfig=(await (await page.request.get('/api/volunteer/workflow')).json()).events.find(row=>row._id===source._id);
 const configured=await page.request.post(`/api/volunteer/workflow/events/${source._id}/configure-positions`,{headers,data:{token:beforeConfig.positionToken,deadline:'2029-12-31T18:00',positions:[{name:'原岗位一',start:'2030-01-01T09:15',end:'2030-01-01T11:45',campus:'仙林',location:'合成地点',capacity:4,work:'旧活动岗位内容',serviceHours:2.5,trainingHours:0.5,travelHours:1}]}});expect(configured.ok()).toBe(true);
 const before=(await (await page.request.get('/api/volunteer/workflow')).json()).events.find(row=>row._id===source._id);
 await page.goto(`/console/events?workspace=v2&draft=${source._id}`);await page.locator('summary').filter({hasText:'更多操作'}).click();await page.getByRole('button',{name:'复制为新活动',exact:true}).click();
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByLabel('岗位名称',{exact:true})).toHaveValue('原岗位一');await expect(pane.getByLabel('开始时间',{exact:true})).toHaveValue('09:15');await expect(pane.getByLabel('通知正文',{exact:true})).toHaveValue(/旧活动岗位内容/);
 const id=new URL(page.url()).searchParams.get('draft');expect(id).not.toBe(source._id);const copied=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${id}`)).json()).result;expect(copied.stage).toBe('草稿');expect(copied.content.positions[0].trainingHours).toBe('0.5');
 await expect(page.locator('.activity-v2-list').getByRole('button',{name:new RegExp(`合成旧活动复制-${info.project.name}（副本） 草稿`)})).toBeVisible();
 expect((await (await page.request.get('/api/volunteer/workflow')).json()).events.find(row=>row._id===source._id)).toEqual(before);
});

async function mountPublicationChoice(page){
 await page.goto('/console/events');await page.evaluate(async()=>{
  const {activityPublicationChoice}=await import('/app/console/pages/activity-publication-choice.js');
  window.publicationChoiceTest={published:0,scheduled:[],approved:true};
  window.openPublicationChoice=()=>activityPublicationChoice({publish:async()=>{window.publicationChoiceTest.published++;},schedule:async value=>{window.publicationChoiceTest.scheduled.push(value);},now:()=>Date.parse('2029-01-01T00:00:00+08:00')});window.openPublicationChoice();
 });
}
test('approval publication dialog has no preset schedule and cancelling retains approval without publishing',async({page})=>{
 await mountPublicationChoice(page);const dialog=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});
 await expect(dialog.getByRole('combobox',{name:'发布方式',exact:true})).toContainText('请选择发布方式');
 await dialog.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'定时发布',exact:true}).click();
 await expect(dialog.getByLabel('定时发布时间（北京时间）',{exact:true})).toHaveValue('');await dialog.getByRole('button',{name:'确认发布',exact:true}).click();
 expect(await page.evaluate(()=>window.publicationChoiceTest.scheduled)).toEqual([]);
 await dialog.getByRole('button',{name:'稍后发布',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>window.publicationChoiceTest)).toEqual({published:0,scheduled:[],approved:true});
 await page.evaluate(()=>window.openPublicationChoice());await page.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'立即发布',exact:true}).click();await page.getByRole('button',{name:'确认发布',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.publicationChoiceTest.published)).toBe(1);
});
test('scheduled publication requires a manually selected future Shanghai time',async({page})=>{
 await mountPublicationChoice(page);const dialog=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});
 await dialog.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'定时发布',exact:true}).click();
 const time=dialog.getByLabel('定时发布时间（北京时间）',{exact:true});await time.fill('2028-12-31T23:59');await dialog.getByRole('button',{name:'确认发布',exact:true}).click();expect(await page.evaluate(()=>window.publicationChoiceTest.scheduled)).toEqual([]);
 await time.fill('2030-01-01T09:15');await dialog.getByRole('button',{name:'确认发布',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.publicationChoiceTest.scheduled)).toEqual(['2030-01-01T09:15:00+08:00']);
});


async function mountRegistration(page,{editable=true}={}){
 await page.goto('/console/events');await page.evaluate(async({editable})=>{
  const {activityRegistrationWorkspace}=await import('/app/console/pages/activity-registration-workspace.js');
  const event={_id:'reg-event',活动ID:'reg-activity',活动名称:'合成报名活动',状态:'报名中',容量:2,岗位:'宣传岗',报名日期:'2030-01-01',报名时段:'09:15-11:45',报名页配置:JSON.stringify({approval:{mode:'workspace-regional'}}),approvalAccess:{canManageRegistration:editable},rosterToken:'fresh-token'};
  const data={events:[event],registrations:[{_id:'a',活动ID:'reg-activity',姓名:'合成甲',学号:'990001',校区:'仙林',报名状态:'待筛选',邮箱:'private@example.invalid'},{_id:'b',活动ID:'reg-activity',姓名:'合成乙',学号:'990002',校区:'鼓楼',报名状态:'待筛选'}]};
  window.registrationFixture=data;window.registrationTest={decisions:[],closed:0};
  const component=activityRegistrationWorkspace({event,data,decide:async(e,ids,kind,reason)=>{window.registrationTest.decisions.push({ids,kind,reason,token:e.rosterToken});for(const row of data.registrations.filter(row=>ids.includes(row._id)))row['报名状态']=kind==='confirm'?'已确认':'未入选';},close:async()=>{window.registrationTest.closed++;event['状态']='进行中';},reload:async()=>structuredClone(data)});
  document.getElementById('root').replaceChildren(component.node);
 },{editable});
}

test('registration workspace protects private fields and sends editable failure reasons before allowing cutoff',async({page},info)=>{
 await mountRegistration(page);await expect(page.getByRole('table')).not.toContainText('private@example.invalid');
 await expect(page.getByRole('status')).toContainText('报名已满');
 await page.screenshot({path:info.outputPath('registration-workspace.png'),animations:'disabled'});
 await page.getByRole('button',{name:'报名截止',exact:true}).click();const blocked=page.getByRole('dialog',{name:'暂不能截止报名'});await expect(blocked).toBeVisible();expect(await page.evaluate(()=>window.registrationTest.closed)).toBe(0);
 await page.keyboard.press('Escape');
 const first=page.getByRole('row').filter({hasText:'合成甲'});await first.getByRole('button',{name:'报名失败',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'报名失败',exact:true});await expect(dialog.getByRole('textbox',{name:/^失败原因/})).toHaveValue('很遗憾的通知您，您报名的活动已满');await dialog.getByRole('textbox',{name:/^失败原因/}).fill('合成时间冲突');await dialog.getByRole('button',{name:'确认失败并通知'}).click();
 await expect(first).toContainText('报名失败');await expect(page.locator('.activity-registration-workspace').getByRole('status')).not.toContainText('报名已满');
 expect((await page.evaluate(()=>window.registrationTest.decisions))[0]).toEqual({ids:['a'],kind:'reject',reason:'合成时间冲突',token:'fresh-token'});
 await page.getByRole('button',{name:'选择当前筛选结果'}).click();await page.getByRole('button',{name:'批量报名成功',exact:true}).click();await page.getByRole('button',{name:'确认成功并通知',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:'合成乙'})).toContainText('报名成功');
 await page.getByRole('button',{name:'报名截止',exact:true}).click();await page.getByRole('button',{name:'确认截止',exact:true}).click();expect(await page.evaluate(()=>window.registrationTest.closed)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('registration workspace leaves result and cutoff actions disabled for read-only viewers',async({page})=>{
 await mountRegistration(page,{editable:false});await expect(page.getByRole('button',{name:'报名截止',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'批量报名失败',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'报名成功',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.registrationTest.decisions)).toEqual([]);
});


test('registration page mounts within the real console shell and activity directory',async({page},info)=>{
 await mountRegistration(page);const data=await page.evaluate(()=>window.registrationFixture);
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:[]}}));
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events:data.events}}));
 await page.route('**/api/volunteer/workflow/events/reg-event/detail',route=>route.fulfill({json:{ok:true,...data}}));
 await page.goto('/console/events?workspace=v2&draft=reg-event');
 await expect(page.locator('.activity-v2-heading')).toContainText('合成报名活动');
 await expect(page.locator('.activity-v2-directory')).toBeVisible();await expect(page.locator('.activity-v2-detail').getByRole('table')).toBeVisible();
 await expect(page.getByRole('button',{name:'报名截止',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('registration-page-in-console.png'),animations:'disabled'});
});
