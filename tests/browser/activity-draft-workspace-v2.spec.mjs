import {test,expect} from '@playwright/test';

test('formal removal protects pending approval, reconciles early end and never restores the submitted draft card',async({page},info)=>{
 const f=await createPendingWorkspace(page,'移除-'+info.project.name),base=`/api/volunteer/workflow/events/${f.event._id}`;
 await page.goto(f.url);const pane=page.getByRole('region',{name:'活动操作工作区'});await pane.getByText('更多操作',{exact:true}).click();await expect(pane.getByRole('button',{name:'删除活动',exact:true})).toBeDisabled();
 const restricted=(await (await page.request.get(`${base}/workspace-removal`)).json()).result;expect(restricted.canRemove).toBe(false);
 expect((await page.request.post(`${base}/workspace-removal`,{headers:f.headers,data:{token:restricted.token,requestId:crypto.randomUUID(),reason:''}})).status()).toBe(403);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});const content=(await (await page.request.get(`${base}/workspace-content`)).json()).result;
 expect((await page.request.post(`${base}/approve`,{headers:f.headers,data:{token:content.token}})).ok()).toBe(true);expect((await page.request.post(`${base}/publish`,{headers:f.headers,data:{}})).ok()).toBe(true);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto(f.url);await pane.getByText('更多操作',{exact:true}).click();const end=pane.getByRole('button',{name:'结束活动',exact:true});await expect(end).toBeEnabled();await end.click();
 const dialog=page.getByRole('dialog',{name:'结束活动？',exact:true});await dialog.getByLabel('原因（选填）',{exact:true}).fill('合成提前结束');let lost=true;
 await page.route(`**${base}/workspace-removal`,async route=>{if(route.request().method()!=='POST'||!lost)return route.continue();lost=false;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'合成响应丢失'})});});
 await dialog.getByRole('button',{name:'结束活动',exact:true}).click();await expect(dialog.getByRole('button',{name:'核对操作结果',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'核对操作结果',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.reload();await expect(page.locator('.activity-v2-card').filter({hasText:f.content.name})).toHaveCount(0);
 const catalog=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;expect(catalog.find(row=>row._id===f.event._id)['状态']).toBe('已归档');
 expect((await page.request.post(`${base}/restore`,{headers:f.headers,data:{}})).ok()).toBe(false);
});

test('draft removal reconciles a lost response and keeps the card removed after reload',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const name=`合成删除草稿-${info.project.name}`,root='/api/volunteer/workflow/workspace-drafts',created=await page.request.post(root,{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:`remove-${info.project.name}-${Date.now()}`,content:{name}}}),draft=(await created.json()).result;
 await page.goto(`/console/events?workspace=v2&draft=${draft.id}`);const pane=page.getByRole('region',{name:'活动操作工作区'});
 await pane.getByText('更多操作',{exact:true}).click();await pane.getByRole('button',{name:'删除活动',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'删除活动草稿？',exact:true});await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('.activity-v2-card').filter({hasText:name})).toHaveCount(1);
 await pane.getByRole('button',{name:'删除活动',exact:true}).click();let lost=true;
 await page.route(`**${root}/${draft.id}/remove`,async route=>{if(!lost)return route.continue();lost=false;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'合成响应丢失'})});});
 await dialog.getByRole('button',{name:'删除活动',exact:true}).click();await expect(dialog.getByRole('button',{name:'核对删除结果',exact:true})).toBeEnabled();await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'核对删除结果',exact:true}).click();await expect(dialog).toHaveCount(0);await page.reload();await expect(page.locator('.activity-v2-card').filter({hasText:name})).toHaveCount(0);
 expect((await page.request.get(`${root}/${draft.id}`)).status()).toBe(410);
});

test('final hours page protects regional review, previews the full template, syncs edits and archives a downloadable file',async({page},info)=>{
 const headers={'x-csrf-token':'synthetic-ui'};await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const catalog=await (await page.request.get('/api/volunteer/workflow/catalog')).json(),event=catalog.events.find(row=>row['活动名称']===`时长审核 · 分工表（合成）-${info.project.name}`);expect(event).toBeTruthy();
 const base=`/api/volunteer/workflow/events/${event._id}`,url=`/console/events?workspace=v2&event=${event._id}`;
 await page.goto(url);const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByRole('button',{name:'导出',exact:true})).toHaveCount(0);await expect(pane.getByRole('button',{name:'修改明细',exact:true})).toHaveCount(0);
 const before=(await (await page.request.get(`${base}/final-hours`)).json()).result;
 await pane.getByRole('button',{name:'预览并导出',exact:true}).click();const ownerPreview=page.getByRole('dialog',{name:'完整分工时长表',exact:true});await expect(ownerPreview.getByRole('button',{name:'导出',exact:true})).toBeDisabled();await ownerPreview.getByRole('button',{name:'关闭',exact:true}).click();
 expect(before.rows.filter(row=>row.decision==='pass')[0].dates).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-life-director-two'}});await page.goto(url);await expect(pane.getByRole('button',{name:'活动信息查看',exact:true})).toBeEnabled();await expect(pane.getByRole('button',{name:'导出',exact:true})).toHaveCount(0);await expect(pane.getByRole('cell',{name:'合成时长同学',exact:true})).toHaveCount(0);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-suzhou-chair'}});expect((await page.request.post(`${base}/final-hours-export`,{headers,data:{token:before.token}})).status()).toBe(403);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(url);
 if(info.project.name==='desktop-chromium'){
  await expect(pane.getByRole('button',{name:'修改明细',exact:true}).first()).toBeVisible();
  expect(await pane.locator('.activity-final-hours-table').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('final-hours-compact.png'),timeout:5000});
 }
 await pane.getByRole('button',{name:'预览并导出',exact:true}).click();const preview=page.getByRole('dialog',{name:'完整分工时长表',exact:true});await expect(preview.getByRole('columnheader')).toHaveCount(11);await expect(preview).toContainText('实际培训时长/小时');await expect(preview).toContainText('未通过记录 1 人');await preview.getByRole('button',{name:'关闭',exact:true}).click();
 await pane.getByRole('row').filter({hasText:'合成时长同学'}).getByRole('button',{name:'修改明细',exact:true}).click();const edit=page.getByRole('dialog',{name:'修改时长明细',exact:true});await edit.getByRole('spinbutton',{name:'服务时长',exact:true}).fill('3');await edit.getByRole('textbox',{name:'具体工作地点',exact:true}).fill('合成仙林更新场地');await edit.getByRole('button',{name:'保存明细',exact:true}).click();await expect(edit).toHaveCount(0);
 const running=(await (await page.request.get(`${base}/running-review`)).json()).result;expect(running.entries.find(row=>row.decision==='pass').serviceHours).toBe(3);
 await pane.getByRole('button',{name:'预览并导出',exact:true}).click();await expect(preview).toContainText('合成仙林更新场地');if(info.project.name==='desktop-chromium'){await preview.evaluate(node=>Promise.all(node.parentElement.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));await page.screenshot({path:info.outputPath('final-hours-preview.png'),timeout:5000});}await preview.getByRole('button',{name:'关闭',exact:true}).click();
 await pane.getByRole('button',{name:'预览并导出',exact:true}).click();await preview.getByRole('button',{name:'导出',exact:true}).click();const downloaded=page.waitForEvent('download');await page.getByRole('dialog',{name:'导出最终表并结束活动？',exact:true}).getByRole('button',{name:'导出并结束',exact:true}).click();const file=await downloaded;expect(file.suggestedFilename()).toContain('分工时长表.xlsx');
 await expect(pane.locator('[aria-current=step]')).toHaveText('已结束');await expect(pane.getByRole('link',{name:'下载时长表',exact:true})).toBeVisible();await expect(pane).toContainText('最终表附件及录入提醒已发送');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto(url);await expect(pane.getByRole('link',{name:'下载时长表',exact:true})).toBeVisible();expect((await page.request.get(`${base}/final-hours-download`)).ok()).toBe(true);await expect(pane.getByRole('button',{name:'修改明细',exact:true})).toHaveCount(0);
 const redownload=page.waitForEvent('download');await pane.getByRole('link',{name:'下载时长表',exact:true}).click();expect((await redownload).suggestedFilename()).toBe(file.suggestedFilename());
});

test('running preview retains uncertain submission and reconciles without a second write',async({page})=>{
 await page.goto('/console/events');await page.evaluate(async()=>{
  const {runningReviewEditor}=await import('/app/console/pages/activity-running-editor.js');
  const row={name:'合成甲',studentId:'20300001',position:'接待岗',date:'2030-01-01',slot:'09:00—11:00',item:{id:'one',serviceHours:2,trainingHours:0,travelHours:0,decision:'fail',reason:'未到场',evidenceChecked:false}};
  window.runningEditorState={writes:0,status:'draft'};
  runningReviewEditor({rows:[row],token:'test-token',preview:async body=>({...body,previewToken:'preview-proof',rows:[{...row,...row.item}]}),submit:async()=>{window.runningEditorState.writes++;window.runningEditorState.status='submitted';throw Error('合成响应丢失');},onSaved:async()=>({status:window.runningEditorState.status,token:'latest'})});
 });
 const dialog=page.getByRole('dialog',{name:'上传与预览时长表',exact:true});await dialog.getByRole('button',{name:'预览时长表',exact:true}).click();await expect(dialog.getByRole('spinbutton')).toHaveCount(0);await dialog.getByRole('button',{name:'提交',exact:true}).click();await expect(dialog.getByRole('button',{name:'提交',exact:true})).toBeDisabled();await expect(dialog).toContainText('未到场');await dialog.getByRole('button',{name:'核对提交结果',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.runningEditorState.writes)).toBe(1);
});

test('real running page saves first review, imports all participants and requires complete preview before submission',async({page},info)=>{
 const f=await createPendingWorkspace(page,'进行中-'+info.project.name),base=`/api/volunteer/workflow/events/${f.event._id}`;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const content=(await (await page.request.get(`${base}/workspace-content`)).json()).result;
 expect((await page.request.post(`${base}/approve`,{headers:f.headers,data:{token:content.token}})).ok()).toBe(true);
 expect((await page.request.post(`${base}/publish`,{headers:f.headers,data:{}})).ok()).toBe(true);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 expect((await page.request.post(`/api/portal/workflow/events/${f.event._id}/register`,{headers:f.headers,data:{consent:true}})).ok()).toBe(true);
 let detail=await (await page.request.get(`${base}/detail`)).json();const participant=detail.registrations[0],current=detail.events.find(row=>row._id===f.event._id);expect(participant).toBeTruthy();
 expect((await page.request.post(`${base}/batch-decide`,{headers:f.headers,data:{ids:[participant._id],decision:'confirm',reason:'',immediate:true,token:current.rosterToken}})).ok()).toBe(true);
 expect((await page.request.post(`${base}/close`,{headers:f.headers,data:{scope:'project'}})).ok()).toBe(true);
 await page.goto(f.url);const pane=page.getByRole('region',{name:'活动操作工作区'});await pane.getByRole('combobox',{name:`${participant['姓名']} 负责人初审`,exact:true}).selectOption('fail');
 const edit=page.getByRole('dialog',{name:'负责人初审',exact:true});
 await edit.getByLabel(`${participant['姓名']} 签到链接（选填）`,{exact:true}).fill('https://example.test/attendance');
 await edit.getByRole('spinbutton',{name:`${participant['姓名']} 服务时长`,exact:true}).fill('2');await edit.getByRole('spinbutton',{name:`${participant['姓名']} 培训时长`,exact:true}).fill('0');await edit.getByRole('spinbutton',{name:`${participant['姓名']} 交通时长`,exact:true}).fill('0');
 await edit.getByLabel(`${participant['姓名']} 初审结果`,{exact:true}).selectOption('fail');await edit.getByLabel(`${participant['姓名']} 初审原因`,{exact:true}).fill('未完成到场签到');await edit.getByRole('button',{name:'保存初审',exact:true}).click();await expect(edit).toHaveCount(0);await expect(pane.getByRole('combobox',{name:`${participant['姓名']} 负责人初审`,exact:true})).toHaveValue('fail');await expect(pane.getByRole('cell').filter({hasText:'未完成到场签到'})).toBeVisible();
 if(info.project.name==='desktop-chromium')await page.screenshot({path:info.outputPath('running-workspace.png'),timeout:5000});
 await pane.getByRole('button',{name:'上传时长表',exact:true}).click();const upload=page.getByRole('dialog',{name:'上传与预览时长表',exact:true});
 const csv=`姓名,学号,服务时长,培训时长,交通时长\n${participant['姓名']},${participant['学号']},3,0,0\n`;
 await upload.locator('input[type=file]').setInputFiles({name:'合成时长.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await expect(upload.getByRole('spinbutton',{name:`${participant['姓名']} 服务时长`,exact:true})).toHaveValue('3');
 await expect(upload.getByLabel(`${participant['姓名']} 初审结果`,{exact:true})).toHaveValue('');await expect(upload.getByRole('button',{name:'提交',exact:true})).toHaveCount(0);
 await upload.getByLabel(`${participant['姓名']} 初审结果`,{exact:true}).selectOption('fail');await upload.getByLabel(`${participant['姓名']} 初审原因`,{exact:true}).fill('上传后重新核对，未到场');
 await upload.getByRole('button',{name:'预览时长表',exact:true}).click();await expect(upload.getByRole('spinbutton')).toHaveCount(0);await expect(upload).toContainText('上传后重新核对，未到场');
 if(info.project.name==='desktop-chromium')await page.screenshot({path:info.outputPath('running-preview.png'),timeout:5000});
 await upload.getByRole('button',{name:'提交',exact:true}).click();await expect(upload).toHaveCount(0);
 await expect(pane.locator('[aria-current=step]')).toHaveText('时长审核');
 const saved=(await (await page.request.get(`${base}/running-review`)).json()).result;expect(saved.status).toBe('submitted');expect(saved.entries[0].serviceHours).toBe(3);expect(saved.entries[0].decision).toBe('fail');
 detail=await (await page.request.get(`${base}/detail`)).json();expect(detail.ledger).toHaveLength(0);
});

test('running page switches exclusive positions and opens scoped attendance without implying final approval',async({page})=>{
 await page.goto('/console/events');
 await page.evaluate(async()=>{
  const {activityRunningWorkspace}=await import('/app/console/pages/activity-running-workspace.js');
  const job=(id,name)=>({_id:id,活动ID:id,岗位:name,状态:'进行中',报名页配置:'{}'});
  const data={events:[job('a','接待岗位'),job('b','培训岗位')],registrations:[{_id:'one',活动ID:'a',姓名:'合成甲',学号:'20300001',报名状态:'已确认'},{_id:'two',活动ID:'b',姓名:'合成乙',学号:'20300002',报名状态:'已签到',签到行ID:'synthetic-checkin'}],ledger:[{报名行ID:'one',活动ID:'a',服务时长:2,培训时长:0,交通时长:0,状态:'已批准'}]};
  const editor=activityRunningWorkspace({event:data.events[0],data,reload:async()=>data,loadAttendance:async id=>{window.attendanceRead=id;return {name:'合成乙',studentId:'20300002',submittedAt:'2030-01-01',verified:null,legacy:[],warnings:[]};}});
  document.getElementById('root').replaceChildren(editor.node);
 });
 await expect(page.getByRole('cell',{name:'合成甲',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'合成乙',exact:true})).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'合成甲 负责人初审',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'活动信息修改',exact:true})).toBeDisabled();
 await page.getByRole('tab',{name:'培训岗位'}).click();await expect(page.getByRole('cell',{name:'合成乙',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'合成甲',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'查看签到',exact:true}).click();await expect(page.getByRole('dialog',{name:'签到记录',exact:true})).toContainText('未核验');expect(await page.evaluate(()=>window.attendanceRead)).toBe('two');
});

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
 await expect(page.getByRole('button',{name:'提交审批',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();const drawer=page.getByRole('dialog',{name:'完整活动预览'});await expect(drawer).toContainText('合成地点');await expect(drawer.locator('.activity-preview__metrics')).toContainText('服务时长 / 小时');await expect(drawer.locator('input,textarea,select')).toHaveCount(0);
 await drawer.getByRole('button',{name:'返回',exact:true}).click();expect(await page.evaluate(()=>window.workspaceTest.previewed)).toBe(null);
 await page.getByLabel('活动名称',{exact:true}).fill('合成修改');await expect.poll(()=>page.evaluate(()=>window.workspaceEditor.hasUnsaved())).toBe(true);
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();await expect(drawer).toHaveCount(0);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.saved)).toBe(1);
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();await expect(drawer).toContainText('合成修改');await drawer.getByRole('button',{name:'提交审核',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.submitted)).toBe(1);expect(await page.evaluate(()=>window.workspaceTest.previewed)).toBe('version-2');
});
test('incomplete draft has no booking default and saves without fabricated required facts',async({page})=>{
 await mount(page,{complete:false});await expect(page.locator('select[name=bookingMode]')).toHaveValue('');await expect(page.getByLabel('活动开始日期',{exact:true})).toHaveCount(0);
 await expect(page.locator('select[name=bookingMode] option')).toHaveText(['待选择','单岗位','多岗位']);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.workspaceTest.saved)).toBe(1);
 const content=await page.evaluate(()=>window.workspaceTest.content);expect(content.date).toBe('');expect(content.serviceHours).toBe('');
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();const information=page.getByRole('dialog',{name:'活动信息',exact:true});await expect(information).toContainText('待选择');await expect(information).toContainText('未填写');await expect(information).not.toContainText('整体活动统一报名');await information.getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'提交审核',exact:true})).toBeDisabled();
});
test('read-only actor cannot edit, save, preview-confirm or submit the draft',async({page})=>{
 await mount(page,{editable:false});await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'提交审核',exact:true})).toHaveCount(0);
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
 await expect.poll(async()=>Math.round((await page.locator('.activity-v2-directory').boundingBox()).width)).toBeLessThanOrEqual(250);
});
test('new activity requires regional classification and restores its saved draft after reload',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events?workspace=v2');
 await page.getByRole('button',{name:'新建活动',exact:true}).click();const modal=page.getByRole('dialog',{name:'新建活动'});
 await expect(modal.getByRole('button',{name:'开始填写',exact:true})).toBeDisabled();
 const name='合成接口草稿-'+info.project.name;await modal.getByRole('textbox',{name:'活动名称 必填',exact:true}).fill(name);await modal.getByRole('combobox',{name:'活动地区',exact:true}).click();await page.getByRole('option',{name:'南京地区',exact:true}).click();await modal.getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:'生命中心',exact:true}).click();await modal.getByRole('button',{name:'开始填写',exact:true}).click();await expect(modal).toHaveCount(0);
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue(name);await pane.getByLabel('活动名称',{exact:true}).fill(name+'修改');await pane.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(pane.getByRole('status')).toHaveText('已保存');
 await page.reload();await expect(page.getByRole('region',{name:'活动操作工作区'}).getByLabel('活动名称',{exact:true})).toHaveValue(name+'修改');
 const card=page.locator('.activity-v2-card[aria-pressed=true]');await expect(card).toHaveAttribute('data-region','nanjing');await expect(card).toHaveAttribute('data-category','生命中心');await expect(card.locator('small')).toHaveCount(0);
 if(info.project.name.includes('mobile')){
  await page.getByRole('button',{name:'返回活动列表',exact:true}).click();await expect(page.locator('.activity-v2-directory')).toBeVisible();await page.locator('.activity-v2-card').filter({hasText:name+'修改'}).click();await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue(name+'修改');
 }else{
  await page.getByRole('button',{name:'收起活动列表',exact:true}).click();await expect(page.locator('.activity-v2-directory')).toBeHidden();await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue(name+'修改');await page.getByRole('button',{name:'展开活动列表',exact:true}).click();await expect(page.locator('.activity-v2-directory')).toBeVisible();
 }
 const response=await page.request.get('/api/volunteer/workflow/workspace-drafts');const saved=(await response.json()).drafts.find(d=>d.content.name===name+'修改');expect(saved.content.region).toBe('nanjing');expect(saved.content.category).toBe('生命中心');expect(saved.content.date).toBe('');expect(saved.content.bookingMode).toBe('');expect(saved.version).toBe(2);
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

test('responsible picker persists the chosen center director without a separate profile row',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const created=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content:{name:'合成负责人关联',region:'nanjing',category:'生命中心'}}});expect(created.ok()).toBe(true);const id=(await created.json()).result.id;
 await page.goto(`/console/events?workspace=v2&draft=${id}`);
 const picker=page.getByRole('group',{name:'活动负责人（可多选）',exact:true});
 await expect(picker.getByRole('checkbox',{name:'合成生命主任（synthetic-life-director-two）',exact:true})).toBeEnabled();
 await expect(picker.getByRole('checkbox',{name:'合成主席团',exact:true})).toHaveCount(0);
 await picker.getByRole('checkbox',{name:'合成生命主任（synthetic-life-director-two）',exact:true}).check();
 await picker.getByRole('checkbox',{name:'合成生命主任（synthetic-organizer）',exact:true}).check();
 await expect(page.getByRole('button',{name:'查看个人资料档案',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('region',{name:'活动操作工作区'}).getByRole('status')).toHaveText('已保存');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.reload();await expect(page.getByRole('button',{name:'查看个人资料档案',exact:true})).toHaveCount(0);
 const saved=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${id}`)).json()).result;expect(saved.content.responsibleId).toBe('synthetic-life-director-two');expect(saved.content.responsibleIds).toEqual(['synthetic-life-director-two','synthetic-organizer']);
 await page.getByRole('combobox',{name:'活动地区',exact:true}).click();await page.getByRole('option',{name:'苏州地区',exact:true}).click();
 await expect(picker.getByRole('checkbox',{checked:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看个人资料档案',exact:true})).toHaveCount(0);await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue('合成负责人关联');
});

test('copy creates a new draft card with every position and updates its generated notice without changing the source',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const positions=[{id:'source-position-a',name:'引导岗',date:'2030-01-02',start:'09:15',end:'11:45',campus:'仙林',location:'合成地点甲',capacity:'4',serviceHours:'2.5',trainingHours:'0.5',travelHours:'0',work:'引导工作'},{id:'source-position-b',name:'登记岗',date:'2030-01-03',start:'14:05',end:'16:20',campus:'鼓楼',location:'合成地点乙',capacity:'3',serviceHours:'2',trainingHours:'0',travelHours:'1',work:'登记工作'}];
 const response=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content:{name:'合成复制岗位活动',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'原手工通知',positions}}});expect(response.ok()).toBe(true);const source=(await response.json()).result;
 await page.goto(`/console/events?workspace=v2&draft=${source.id}`);await page.locator('summary').filter({hasText:'更多操作'}).click();await page.getByRole('button',{name:'复制为新活动',exact:true}).click();
 const pane=page.getByRole('region',{name:'活动操作工作区'});await expect(pane.getByLabel('活动名称',{exact:true})).toHaveValue('合成复制岗位活动（副本）');await expect(page.locator('.activity-v2-card').filter({hasText:'合成复制岗位活动（副本）'})).toHaveCount(1);
 await expect(pane.getByLabel('岗位名称',{exact:true})).toHaveCount(2);await expect(pane.getByLabel('岗位名称',{exact:true}).nth(1)).toHaveValue('登记岗');await expect(pane.getByLabel('开始时间',{exact:true}).first()).toHaveValue('09:15');
 await pane.getByLabel('活动名称',{exact:true}).fill('修改后的副本');await pane.getByLabel('岗位名称',{exact:true}).first().fill('副本接待岗');await pane.getByLabel('开始时间',{exact:true}).first().fill('10:05');
 await expect(pane.getByLabel('通知正文',{exact:true})).toHaveValue(/修改后的副本[\s\S]*副本接待岗[\s\S]*10:05-11:45/);
 await pane.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(pane.getByRole('status')).toHaveText('已保存');
 const copyId=new URL(page.url()).searchParams.get('draft');expect(copyId).not.toBe(source.id);
 const copied=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${copyId}`)).json()).result;
 expect(copied.content.positions.map(p=>p.id)).not.toContain('source-position-a');expect(copied.content.positions[1].travelHours).toBe('1');
 expect((await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${source.id}`)).json()).result).toEqual(source);
});

test('activity entry always opens the unified workspace and includes historical projects',async({page},info)=>{
 const f=await createPendingWorkspace(page,'新入口-'+info.project.name);
 const legacy=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.find(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);expect(legacy).toBeTruthy();
 for(const path of ['/console/events','/console/workflow']){
  await page.goto(`${path}?event=${f.event._id}`);const pane=page.getByRole('region',{name:'活动操作工作区'});
  await expect(pane.getByRole('button',{name:'活动信息查看',exact:true})).toBeVisible();await expect(pane.locator('.activity-approval-content')).toContainText('审核');
  await expect(page.locator('.activity-v2')).toBeVisible();
  await expect(page.locator('.activity-v2-card').filter({hasText:legacy['活动名称']})).toHaveCount(1);
  await expect(page.getByRole('link',{name:'进入现有活动工作区',exact:true})).toHaveCount(0);
 }
 await page.goto(`/console/events?legacy=1&event=${f.event._id}`);
 await expect(page.locator('.activity-v2')).toBeVisible();
 await expect(page.locator('.activity-center')).toHaveCount(0);
});

test('draft service outage does not block the unified activity workspace',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route(/\/api\/volunteer\/workflow\/workspace-drafts\/?$/,route=>route.fulfill({status:503,json:{ok:false,code:'workspace_not_enabled',message:'活动草稿工作区尚未开放'}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({status:503,json:{ok:false,code:'workspace_not_enabled',message:'活动草稿工作区尚未开放'}}));
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2')).toBeVisible();
 await expect(page.locator('.activity-center')).toHaveCount(0);
 await expect(page.locator('.activity-v2-message')).toContainText('历史活动仍可在当前工作区管理');
 await expect(page.getByRole('button',{name:'新建活动',exact:true})).toBeDisabled();
 await expect(page.locator('.activity-v2-card')).not.toHaveCount(0);
 await page.goto('/console/events?workspace=v2');
 await expect(page.locator('.activity-v2')).toBeVisible();
 await expect(page.locator('.activity-center')).toHaveCount(0);
});

test('missing regional roster still permits private drafts while disabling submission',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route(/\/api\/volunteer\/workflow\/workspace-drafts\/?$/,route=>route.fulfill({json:{ok:true,drafts:[],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,rosterAvailable:false,canSubmit:true}}}));
 await page.goto('/console/events');
 await expect(page.locator('.activity-v2')).toBeVisible();
 await expect(page.locator('.activity-v2-message')).toContainText('可以新建并保存草稿，暂不能提交审批');
 await expect(page.getByRole('button',{name:'新建活动',exact:true})).toBeEnabled();
 await expect(page.locator('.activity-v2-card')).not.toHaveCount(0);
});

test('historical registration and project sessions stay inside the unified workspace',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const legacy=events.find(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission&&row['状态']==='报名中'&&!JSON.parse(row['报名页配置']||'{}').ordinary);
 expect(legacy).toBeTruthy();
 await page.goto(`/console/events?legacy=1&event=${legacy._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(page.locator('.activity-v2')).toBeVisible();
 await expect(page.locator('.activity-center')).toHaveCount(0);
 await expect(page.locator('.activity-v2-heading')).toContainText(legacy['活动名称']);
 await expect(pane.getByRole('button',{name:'活动信息查看',exact:true})).toBeVisible();
 await expect(pane.locator('.activity-roster')).toBeVisible();
});

test('historical drafts, approvals, running and ended projects keep their stage controls inline',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 let events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.filter(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);
 let running=events.find(row=>row['状态']==='进行中');
 const headers={'x-csrf-token':'synthetic-ui'};
 async function createPublishedLegacy(name){
  await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
  const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name,center:'博爱中心',category:'志愿服务',region:'南京活动',date:'2030-01-01',slot:'09:00-12:00',startTime:'09:00',endTime:'12:00',capacity:3,serviceHours:3,trainingHours:1,travelHours:1,location:'合成活动室',work:'合成阶段验证'}});
  const event=(await created.json()).result;
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/approve`,{headers,data:{}})).ok()).toBe(true);
  await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/publish`,{headers,data:{}})).ok()).toBe(true);
  return event;
 }
 if(!running){
  const event=await createPublishedLegacy('历史进行中阶段适配');
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/close`,{headers,data:{scope:'event'}})).ok()).toBe(true);
  events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.filter(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);
  running=events.find(row=>row['状态']==='进行中');
 }
 let ended=events.find(row=>row['状态']==='已结束');
 if(!ended){
  const event=await createPublishedLegacy('历史已结束阶段适配');
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/close`,{headers,data:{scope:'event'}})).ok()).toBe(true);
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/submit-hours`,{headers,data:{revision:0}})).ok()).toBe(true);
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  expect((await page.request.post(`/api/volunteer/workflow/events/${event._id}/finish`,{headers,data:{}})).ok()).toBe(true);
  await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
  events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.filter(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);
  ended=events.find(row=>row['状态']==='已结束');
 }
 const cases=[
  ['草稿',events.find(row=>row['状态']==='草稿'),'.notification-panel'],
  ['待审核',events.find(row=>row['状态']==='待审核'),'.activity-legacy-workspace'],
  ['进行中',running,'.service-workspace'],
  ['已结束',ended,'.service-workspace'],
 ];
 for(const [label,event,selector]of cases){
  expect(event,`missing legacy ${label} fixture`).toBeTruthy();
  await page.goto(`/console/events?event=${event._id}`);
  const pane=page.getByRole('region',{name:'活动操作工作区'});
  await expect(page.locator('.activity-v2')).toBeVisible();
  await expect(page.locator('.activity-center')).toHaveCount(0);
  await expect(pane.locator('.activity-legacy-workspace')).toBeVisible();
  await expect(pane.locator(selector)).toBeVisible();
 }
});

test('historical registration decisions remain operable in the unified workspace',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const headers={'x-csrf-token':'synthetic-ui'};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'历史报名操作适配',date:'2030-01-12',slot:'09:00-12:00',capacity:2,registrationLimit:3,serviceHours:3,location:'合成地点',work:'合成服务',category:'生命类'}});
 expect(created.ok()).toBe(true);const id=(await created.json()).result._id;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-life-chair'}});
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
 expect((await page.request.post(`/api/portal/workflow/events/${id}/register`,{headers,data:{consent:true}})).ok()).toBe(true);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto(`/console/events?event=${id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(page.locator('.activity-center')).toHaveCount(0);
 await expect(pane.locator('.activity-roster')).toBeVisible();
 await pane.locator('.activity-roster-selection .check').click();
 await pane.getByRole('button',{name:'批准录取并通知',exact:true}).click();
 await page.getByRole('button',{name:'批准并发送成功邮件',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'报名处理结果',exact:true})).toBeVisible();
 const own=await (await page.request.get('/api/portal/workflow/me')).json();
 expect(own.registrations.find(row=>row.eventId===id).status).toBe('已确认');
});

test('large historical projects keep filters and rosters without repeating a full-screen legend',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const blood=events.find(row=>!JSON.parse(row['报名页配置']||'{}').workspaceSubmission&&JSON.parse(row['报名页配置']||'{}').blood);
 expect(blood).toBeTruthy();
 await page.goto(`/console/events?event=${blood._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await pane.getByRole('button',{name:'报名审核与通知',exact:true}).click();
 await expect(pane.locator('.activity-legacy-roster')).toBeVisible();
 await expect(pane.locator('.activity-legacy-roster__filters')).toBeVisible();
 await expect(pane.locator('.activity-legacy-roster__legend')).toHaveCount(0);
});

test('historical approval transitions to the ready-to-publish workspace',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const name=`历史审批操作适配-${info.project.name}`;
 const created=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name,center:'博爱中心',category:'志愿服务',region:'南京活动',date:'2030-03-01',slot:'09:00-12:00',startTime:'09:00',endTime:'12:00',capacity:3,serviceHours:3,trainingHours:1,travelHours:1,location:'合成活动室',work:'合成审批验证'}});
 expect(created.ok()).toBe(true);const event=(await created.json()).result;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await pane.getByRole('button',{name:'审批通过',exact:true}).click();
 await expect(pane.locator('.activity-publication')).toBeVisible();
 await expect(page.locator('.activity-v2-card').filter({hasText:name})).toContainText('待发布');
});

test('historical draft information remains editable inside the unified workspace',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const created=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'历史草稿编辑适配',center:'生命中心',category:'生命类',region:'南京活动',date:'2030-02-01',slot:'09:00-12:00',startTime:'09:00',endTime:'12:00',capacity:3,serviceHours:3,trainingHours:1,travelHours:1,location:'合成活动室',work:'合成草稿编辑',submit:false}});
 expect(created.ok()).toBe(true);const event=(await created.json()).result;
 await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.getByRole('button',{name:'活动信息修改',exact:true})).toBeVisible();
 await pane.getByRole('button',{name:'活动信息修改',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动信息修改',exact:true});
 await dialog.getByRole('textbox',{name:'活动名称 必填',exact:true}).fill('历史草稿已升级');
 await dialog.getByRole('button',{name:'保存并重新审批',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.locator('.activity-v2-heading')).toContainText('历史草稿已升级');
 const saved=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.find(row=>row._id===event._id);
 expect(saved['活动名称']).toBe('历史草稿已升级');
 expect(saved['状态']).toBe('草稿');
});

test('source-table activities can be brought into the unified directory without opening the old page',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const sources=(await (await page.request.get('/api/volunteer/workflow/sources')).json()).sources;
 const catalog=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const adopted=new Set(catalog.map(event=>JSON.parse(event['报名页配置']||'{}').source?.key).filter(Boolean));
 const source=sources.find(item=>!adopted.has(item.key));
 expect(source).toBeTruthy();
 await page.goto('/console/events');
 if((await page.viewportSize()).width<=800)await page.getByText('管理工具',{exact:true}).click();
 await page.getByRole('button',{name:'来源活动纳入',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'来源活动纳入',exact:true});
 await expect(drawer).toBeVisible();
 await expect(drawer).toContainText(source.name);
 await drawer.getByRole('button',{name:'纳入活动',exact:true}).first().click();
 const form=page.getByRole('dialog',{name:'纳入来源活动',exact:true});
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();
 await page.getByRole('option',{name:'生命中心',exact:true}).click();
 await form.getByLabel('活动日期').fill('2030-04-01');
 await form.getByLabel('活动时段').fill('09:00-12:00');
 await form.getByLabel('报名人数').fill('2');
 await form.getByLabel('服务时长').fill('2');
 await form.getByLabel('活动地点').fill('合成来源活动室');
 await form.getByLabel('工作内容').fill('合成来源活动服务');
 await form.getByRole('button',{name:'生成活动草稿',exact:true}).click();
 await expect(form).toHaveCount(0);
 await expect(page.locator('.activity-v2-heading')).toContainText(source.name);
 const saved=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.key===source.key);
 expect(saved['状态']).toBe('草稿');
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


async function mountRegistration(page,{editable=true,multiple=false,failBefore=false,failAfter=false,withSource=false,failRefresh=false}={}){
 await page.goto('/console/events');await page.waitForLoadState('networkidle');await page.evaluate(async({editable,multiple,failBefore,failAfter,withSource,failRefresh})=>{
  const {activityRegistrationWorkspace}=await import('/app/console/pages/activity-registration-workspace.js');
  const event={_id:'reg-event',活动ID:'reg-activity',活动名称:'合成报名活动',状态:'报名中',容量:2,岗位:'宣传岗',报名日期:'2030-01-01',报名时段:'09:15-11:45',报名页配置:JSON.stringify({approval:{mode:'workspace-regional'}}),approvalAccess:{canManageRegistration:editable},rosterToken:'fresh-token'};
  const data={events:[event],registrations:[{_id:'a',活动ID:'reg-activity',姓名:'合成甲',学号:'990001',校区:'仙林',报名状态:'待筛选',邮箱:'private@example.invalid'},{_id:'b',活动ID:'reg-activity',姓名:'合成乙',学号:'990002',校区:'鼓楼',报名状态:'待筛选'}]};
  if(multiple){data.events.push({...event,_id:'reg-second',活动ID:'second-activity',岗位:'签到岗'});data.registrations.push({_id:'c',活动ID:'second-activity',姓名:'合成丙',学号:'990003',校区:'苏州',报名状态:'待筛选'});}
  if(withSource){event['报名页配置']=JSON.stringify({approval:{mode:'workspace-regional'},sourceActivityIds:['legacy-source']});data.registrations[0]['活动ID']='legacy-source';}
  window.registrationFixture=data;window.registrationTest={decisions:[],closed:0,attempts:0,failBefore,failAfter,readFailures:failRefresh?1:0};
  const component=activityRegistrationWorkspace({event,data,decide:async(e,ids,kind,reason)=>{window.registrationTest.attempts++;if(window.registrationTest.failBefore){window.registrationTest.failBefore=false;throw Object.assign(new Error('合成验证失败'),{status:503});}window.registrationTest.decisions.push({ids,kind,reason,token:e.rosterToken});for(const row of data.registrations.filter(row=>ids.includes(row._id))){row['报名状态']=kind==='confirm'?'已确认':'未入选';row['处理说明']=reason;}if(window.registrationTest.failAfter){window.registrationTest.failAfter=false;throw Error('合成响应丢失');}},loadMailStatuses:async()=>data.registrations.filter(row=>['已确认','未入选'].includes(row['报名状态'])).map(row=>({id:row._id,status:'sent'})),close:async()=>{window.registrationTest.closed++;event['状态']='进行中';},reload:async()=>{if(window.registrationTest.readFailures>0){window.registrationTest.readFailures--;throw Error('合成读取失败');}return structuredClone(data);}});
  document.getElementById('root').replaceChildren(component.node);
 },{editable,multiple,failBefore,failAfter,withSource,failRefresh});
}

test('registration workspace protects private fields and sends editable failure reasons before allowing cutoff',async({page},info)=>{
 await mountRegistration(page);await expect(page.getByRole('table')).not.toContainText('private@example.invalid');
 await expect(page.getByRole('tablist',{name:'活动岗位',exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('button',{name:'刷新名单',exact:true})).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText('报名已满');
 await page.screenshot({path:info.outputPath('registration-workspace.png'),animations:'disabled'});
 await page.getByRole('button',{name:'报名截止',exact:true}).click();const blocked=page.getByRole('dialog',{name:'暂不能截止报名'});await expect(blocked).toBeVisible();expect(await page.evaluate(()=>window.registrationTest.closed)).toBe(0);
 await page.keyboard.press('Escape');
 const first=page.getByRole('row').filter({hasText:'合成甲'});await first.getByRole('button',{name:'报名失败',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'报名失败',exact:true});await expect(dialog.getByRole('textbox',{name:/^失败原因/})).toHaveValue('很遗憾的通知您，您报名的活动已满');await dialog.getByRole('textbox',{name:/^失败原因/}).fill('合成时间冲突');await dialog.getByRole('button',{name:'确认失败并通知'}).click();
 await expect(first).toContainText('报名失败');await expect(page.locator('.activity-registration-workspace').getByRole('status')).not.toContainText('报名已满');
 expect((await page.evaluate(()=>window.registrationTest.decisions))[0]).toEqual({ids:['a'],kind:'reject',reason:'合成时间冲突',token:'fresh-token'});
 await page.getByRole('button',{name:'批量操作',exact:true}).click();await page.getByRole('checkbox',{name:'选择本页报名',exact:true}).check();await page.getByRole('button',{name:'批量报名成功',exact:true}).click();await page.getByRole('button',{name:'确认成功并通知',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:'合成乙'})).toContainText('报名成功');
 await page.getByRole('button',{name:'报名截止',exact:true}).click();await page.getByRole('button',{name:'确认截止',exact:true}).click();expect(await page.evaluate(()=>window.registrationTest.closed)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('registration workspace leaves result and cutoff actions disabled for read-only viewers',async({page})=>{
 await mountRegistration(page,{editable:false});await expect(page.getByRole('button',{name:'报名截止',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'批量操作',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'批量报名失败',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'报名成功',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>window.registrationTest.decisions)).toEqual([]);
});


test('registration page mounts within the real console shell and activity directory',async({page},info)=>{
 await mountRegistration(page);const data=await page.evaluate(()=>window.registrationFixture);
 for(const event of data.events){const config=JSON.parse(event['报名页配置']);config.workspaceSubmission={origin:true};event['报名页配置']=JSON.stringify(config);}
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:[]}}));
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events:data.events}}));
 await page.route('**/api/volunteer/workflow/events/reg-event/detail',route=>route.fulfill({json:{ok:true,...data}}));
 await page.goto('/console/events?workspace=v2&draft=reg-event');
 await expect(page.locator('.activity-v2-heading')).toContainText('合成报名活动');
 await expect(page.locator('.activity-v2-directory')).toBeVisible({visible:!info.project.name.includes('mobile')});await expect(page.locator('.activity-v2-detail').getByRole('table')).toBeVisible();
 await expect(page.getByRole('button',{name:'报名截止',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('registration-page-in-console.png'),animations:'disabled'});
});


test('multiple positions use exclusive named tabs and clear selection when switching',async({page},info)=>{
 await mountRegistration(page,{multiple:true});const tabs=page.getByRole('tablist',{name:'活动岗位'});
 await expect(page.getByRole('combobox',{name:'岗位',exact:true})).toHaveCount(0);
 await expect(tabs.getByRole('tab',{name:'宣传岗',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('table')).toContainText('合成甲');await expect(page.getByRole('table')).not.toContainText('合成丙');
 await page.getByRole('button',{name:'批量操作',exact:true}).click();await page.getByRole('checkbox',{name:'选择合成甲',exact:true}).check();await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toBeEnabled();
 await tabs.getByRole('tab',{name:'签到岗',exact:true}).click();await expect(page.getByRole('table')).toContainText('合成丙');await expect(page.getByRole('table')).not.toContainText('合成甲');await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toBeDisabled();
 await expect(page.locator('.activity-registration-workspace').getByRole('status')).toContainText('报名 1 人');
 await page.getByRole('button',{name:'报名截止',exact:true}).click();await expect(page.getByRole('dialog',{name:'暂不能截止报名'})).toBeVisible();await page.keyboard.press('Escape');
 await tabs.getByRole('tab',{name:'签到岗',exact:true}).focus();await page.keyboard.press('ArrowLeft');await expect(tabs.getByRole('tab',{name:'宣传岗',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('checkbox',{name:'选择合成甲',exact:true})).not.toBeChecked();
 await page.screenshot({path:info.outputPath('registration-position-tabs.png'),animations:'disabled'});
 await page.getByRole('button',{name:'退出批量操作',exact:true}).click();await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('button',{name:'批量报名成功',exact:true})).toHaveCount(0);
});


test('saved grouped draft submits once after latest preview and retains all jobs and the chosen director',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const content={name:'合成草稿审批闭环-'+info.project.name,region:'nanjing',category:'生命中心',responsibleId:'synthetic-life-director-two',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'合成完整岗位通知',positions:[{id:'job-one',name:'宣传岗',date:'2030-01-01',start:'09:15',end:'11:45',campus:'仙林',location:'合成甲地',capacity:'3',serviceHours:'2.5',trainingHours:'0.5',travelHours:'1',work:'宣传服务'},{id:'job-two',name:'签到岗',date:'2030-01-03',start:'14:10',end:'16:40',campus:'鼓楼',location:'合成乙地',capacity:'4',serviceHours:'2',trainingHours:'1',travelHours:'0',work:'签到服务'}]};
 const created=await page.request.post('/api/volunteer/workflow/workspace-drafts',{headers:{'x-csrf-token':'synthetic-ui'},data:{requestId:crypto.randomUUID(),content}});expect(created.ok()).toBe(true);const draft=(await created.json()).result;
 await page.request.post('/api/auth/login',{data:{username:'synthetic-life-director-two'}});
 await page.goto(`/console/events?workspace=v2&draft=${draft.id}`);await expect(page.getByRole('button',{name:'提交审批',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();const preview=page.getByRole('dialog',{name:'完整活动预览',exact:true});await expect(preview).toContainText('签到岗');await preview.getByRole('button',{name:'提交审核',exact:true}).click();
 await expect(page.locator('.activity-v2-heading')).toContainText(content.name);await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('待审批');
 const saved=(await (await page.request.get(`/api/volunteer/workflow/workspace-drafts/${draft.id}`)).json()).result;expect(saved.submissionStatus).toBe('complete');
 const formal=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.filter(e=>e['活动ID']===saved.activityId);expect(formal).toHaveLength(1);
 const detail=await (await page.request.get(`/api/volunteer/workflow/events/${formal[0]._id}/detail`)).json();const event=detail.events.find(e=>e._id===formal[0]._id),config=JSON.parse(event['报名页配置']);expect(event['负责人账号ID']).toBe('synthetic-life-director-two');expect(config.positionDraft.positions).toHaveLength(2);expect(config.positionDraft.positions[1].start).toBe('2030-01-03T14:10:00+08:00');expect(config.approval.region).toBe('nanjing');
 await page.reload();await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('待审批');await expect(page.locator('.activity-v2-list').getByRole('button',{name:new RegExp(content.name),includeHidden:true})).toHaveCount(1);
});


async function createPendingWorkspace(page,suffix){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});const root='/api/volunteer/workflow/workspace-drafts',headers={'x-csrf-token':'synthetic-ui'};
 const content={name:'合成待审批-'+suffix,region:'nanjing',category:'生命中心',responsibleId:'synthetic-organizer',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-03',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成场地',capacity:'4',serviceHours:'2.5',trainingHours:'0.5',travelHours:'1',work:'合成服务',notice:'合成待审批通知'};
 const draft=(await (await page.request.post(root,{headers,data:{requestId:crypto.randomUUID(),content}})).json()).result;
 const preview=(await (await page.request.post(`${root}/${draft.id}/preview`,{headers,data:{expectedVersion:1}})).json()).result;
 expect((await page.request.post(`${root}/${draft.id}/confirm-preview`,{headers,data:{expectedVersion:1,digest:preview.digest}})).ok()).toBe(true);
 expect((await page.request.post(`${root}/${draft.id}/submit`,{headers,data:{expectedVersion:1,digest:preview.digest}})).ok()).toBe(true);
 const saved=(await (await page.request.get(`${root}/${draft.id}`)).json()).result;
 const event=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.find(e=>e['活动ID']===saved.activityId);return {event,content,headers,url:`/console/events?workspace=v2&event=${event._id}`};
}

test('pending page is read-only for owner while regional chair edits then approves and chooses publication',async({page},info)=>{
 const f=await createPendingWorkspace(page,'审批-'+info.project.name);await page.goto(f.url);
 await expect(page.getByRole('button',{name:'活动信息修改',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'审批通过',exact:true})).toHaveCount(0);await expect(page.locator('.activity-approval-content')).toContainText(f.content.notice);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(f.url);
 await page.getByRole('button',{name:'活动信息修改',exact:true}).click();const editor=page.getByRole('dialog',{name:'修改待审批活动',exact:true});await expect(editor).toBeVisible();await editor.getByLabel('活动名称',{exact:true}).fill(f.content.name+'已修改');await editor.getByRole('button',{name:'保存修改',exact:true}).click();await expect(editor.getByRole('status')).toHaveText('已保存');await editor.getByRole('button',{name:'完成',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.activity-v2-heading')).toContainText('已修改');
 await page.screenshot({path:info.outputPath('pending-approval-page.png'),animations:'disabled'});
 await page.getByRole('button',{name:'审批通过',exact:true}).click();const publication=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});await expect(publication).toBeVisible();await publication.getByRole('button',{name:'稍后发布',exact:true}).click();await expect(page.locator('.activity-approval-content')).toContainText('审批已通过，等待发布');await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('待审批');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto(f.url);await expect(page.getByRole('button',{name:'发布',exact:true})).toHaveCount(0);expect((await page.request.post(`/api/volunteer/workflow/events/${f.event._id}/publish`,{headers:f.headers,data:{}})).status()).toBe(403);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(f.url);await page.getByRole('button',{name:'发布',exact:true}).click();await page.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'立即发布',exact:true}).click();await page.getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('报名中');
});

test('return requires a reason and owner re-previews to resubmit the same activity',async({page},info)=>{
 const f=await createPendingWorkspace(page,'退回-'+info.project.name);await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(f.url);await page.getByRole('button',{name:'审批退回',exact:true}).click();const back=page.getByRole('dialog',{name:'退回活动',exact:true});await back.getByRole('button',{name:'确认退回',exact:true}).click();await expect(back).toBeVisible();await back.getByRole('textbox',{name:/^退回原因/}).fill('请补全工作内容');await back.getByRole('button',{name:'确认退回',exact:true}).click();await expect(back).toHaveCount(0);await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('草稿');await expect(page.locator('.activity-approval-content')).toContainText('请补全工作内容');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto(f.url);await page.getByRole('button',{name:'活动信息修改',exact:true}).click();const editor=page.getByRole('dialog',{name:'修改退回活动',exact:true});await expect(editor.getByLabel('报名截止时间（北京时间）',{exact:true})).toHaveValue('2029-12-31T18:00');await editor.getByLabel('工作内容',{exact:true}).fill('已补全现场引导工作');await editor.getByRole('button',{name:'保存修改',exact:true}).click();await expect(editor.getByRole('status')).toHaveText('已保存');await expect(editor.getByRole('button',{name:'提交审批',exact:true})).toHaveCount(0);await editor.getByRole('button',{name:'预览并提交',exact:true}).click();await page.getByRole('dialog',{name:'完整活动预览',exact:true}).getByRole('button',{name:'提交审核',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('待审批');
 const after=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.filter(e=>e['活动ID']===f.event['活动ID']);expect(after).toHaveLength(1);expect(after[0]._id).toBe(f.event._id);
});


test('scheduled activity stays in pending page and regional chair can cancel its schedule',async({page},info)=>{
 const f=await createPendingWorkspace(page,'定时-'+info.project.name);await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(f.url);await page.getByRole('button',{name:'审批通过',exact:true}).click();const publication=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});await publication.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'定时发布',exact:true}).click();await publication.getByLabel('定时发布时间（北京时间）',{exact:true}).fill('2029-12-01T09:15');await publication.getByRole('button',{name:'确认发布',exact:true}).click();await expect(publication).toHaveCount(0);await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('待审批');await expect(page.locator('.activity-approval-content')).toContainText('2029-12-01 09:15');await page.reload();await expect(page.getByRole('button',{name:'取消定时发布',exact:true})).toBeVisible();await page.getByRole('button',{name:'取消定时发布',exact:true}).click();await expect(page.locator('.activity-approval-content')).toContainText('审批已通过，等待发布');await expect(page.getByRole('button',{name:'发布',exact:true})).toBeVisible();
});


test('failed rejection retains typed reason and retry only commits remaining pending rows',async({page})=>{
 await mountRegistration(page,{failBefore:true});await page.getByRole('row').filter({hasText:'合成甲'}).getByRole('button',{name:'报名失败',exact:true}).click();const dialog=page.getByRole('dialog',{name:'报名失败',exact:true});const reason=dialog.getByRole('textbox',{name:/^失败原因/});await reason.fill('保留这条自定义原因');await dialog.getByRole('button',{name:'确认失败并通知'}).click();await expect(dialog).toBeVisible();await expect(reason).toHaveValue('保留这条自定义原因');expect(await page.evaluate(()=>window.registrationTest.decisions.length)).toBe(0);await dialog.getByRole('button',{name:'确认失败并通知'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.registrationTest.attempts)).toBe(2);await expect(page.getByRole('row').filter({hasText:'合成甲'})).toContainText('已发送');
});

test('lost rejection response reconciles result without repeating the decision',async({page})=>{
 await mountRegistration(page,{failAfter:true});await page.getByRole('row').filter({hasText:'合成甲'}).getByRole('button',{name:'报名失败',exact:true}).click();const dialog=page.getByRole('dialog',{name:'报名失败',exact:true});await dialog.getByRole('button',{name:'确认失败并通知'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.registrationTest.attempts)).toBe(1);await expect(page.getByRole('row').filter({hasText:'合成甲'})).toContainText('报名失败');
});

test('linked source bookings remain visible in their position and are not submitted to the wrong event',async({page})=>{
 await mountRegistration(page,{withSource:true});await expect(page.getByRole('row').filter({hasText:'合成甲'})).toBeVisible();await page.getByRole('button',{name:'批量操作',exact:true}).click();await expect(page.getByRole('checkbox',{name:'选择合成甲',exact:true})).toBeDisabled();await expect(page.locator('.activity-registration-workspace').getByRole('status')).toContainText('报名 2 人');
});

test('regional chair can edit registration information while retaining phase and booking structure',async({page},info)=>{
 const f=await createPendingWorkspace(page,'报名信息修改-'+info.project.name);await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(f.url);await page.getByRole('button',{name:'审批通过',exact:true}).click();const publication=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});await publication.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'立即发布',exact:true}).click();await publication.getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('报名中');
 await page.getByRole('button',{name:'活动信息修改',exact:true}).click();const editor=page.getByRole('dialog',{name:'修改活动信息',exact:true});await editor.getByRole('textbox',{name:'活动说明',exact:true}).fill('主席团修改活动介绍');await editor.getByRole('textbox',{name:/^通知正文/}).fill('主席团修改后的通知');await editor.getByRole('button',{name:'保存修改',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.activity-v2-heading').locator('[aria-current=step]')).toHaveText('报名中');await page.getByRole('button',{name:'活动信息查看',exact:true}).click();await expect(page.getByRole('dialog',{name:'活动信息',exact:true})).toContainText('主席团修改后的通知');await page.keyboard.press('Escape');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto(f.url);await expect(page.getByRole('button',{name:'活动信息修改',exact:true})).toBeDisabled();
});


test('uncertain rejection keeps its reason and reconciles inside the modal without another write',async({page})=>{
 await mountRegistration(page,{failAfter:true,failRefresh:true});await page.getByRole('row').filter({hasText:'合成甲'}).getByRole('button',{name:'报名失败',exact:true}).click();const dialog=page.getByRole('dialog',{name:'报名失败',exact:true}),reason=dialog.getByRole('textbox',{name:/^失败原因/});await reason.fill('保留待核对原因');await dialog.getByRole('button',{name:'确认失败并通知'}).click();await expect(reason).toHaveValue('保留待核对原因');await expect(dialog.getByRole('button',{name:'确认失败并通知'})).toBeDisabled();await dialog.getByRole('button',{name:'核对名单',exact:true}).click();await expect(dialog.getByRole('button',{name:'确认失败并通知'})).toBeEnabled();await dialog.getByRole('button',{name:'确认失败并通知'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.registrationTest.attempts)).toBe(1);
});

test('real grouped registration shows one project card and exclusive position-name tabs',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});const root='/api/volunteer/workflow/workspace-drafts',headers={'x-csrf-token':'synthetic-ui'};
 const content={name:'合成多岗位报名页-'+info.project.name,region:'nanjing',category:'生命中心',responsibleId:'synthetic-organizer',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'合成多岗位报名通知',positions:[{id:'real-job-one',name:'宣传岗',date:'2030-01-01',start:'09:15',end:'11:45',campus:'仙林',location:'合成甲地',capacity:'3',serviceHours:'2.5',trainingHours:'0',travelHours:'0',work:'宣传服务'},{id:'real-job-two',name:'签到岗',date:'2030-01-03',start:'14:10',end:'16:40',campus:'鼓楼',location:'合成乙地',capacity:'4',serviceHours:'2.5',trainingHours:'0',travelHours:'0',work:'签到服务'}]};
 const draft=(await (await page.request.post(root,{headers,data:{requestId:crypto.randomUUID(),content}})).json()).result;const preview=(await (await page.request.post(`${root}/${draft.id}/preview`,{headers,data:{expectedVersion:1}})).json()).result;await page.request.post(`${root}/${draft.id}/confirm-preview`,{headers,data:{expectedVersion:1,digest:preview.digest}});expect((await page.request.post(`${root}/${draft.id}/submit`,{headers,data:{expectedVersion:1,digest:preview.digest}})).ok()).toBe(true);
 const saved=(await (await page.request.get(`${root}/${draft.id}`)).json()).result;const event=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events.find(e=>e['活动ID']===saved.activityId);const url=`/console/events?workspace=v2&event=${event._id}`;await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto(url);await page.getByRole('button',{name:'审批通过',exact:true}).click();const dialog=page.getByRole('dialog',{name:'审批通过 · 发布活动',exact:true});await dialog.getByRole('combobox',{name:'发布方式',exact:true}).click();await page.getByRole('option',{name:'立即发布',exact:true}).click();await dialog.getByRole('button',{name:'确认发布',exact:true}).click();
 const tabs=page.getByRole('tablist',{name:'活动岗位',exact:true});await expect(tabs.getByRole('tab')).toHaveCount(2);await expect(tabs.getByRole('tab',{name:'宣传岗',exact:true})).toHaveAttribute('aria-selected','true');await tabs.getByRole('tab',{name:'签到岗',exact:true}).click();await expect(tabs.getByRole('tab',{name:'签到岗',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.activity-v2-list').getByRole('button',{name:new RegExp(content.name),includeHidden:true})).toHaveCount(1);
 await page.screenshot({path:info.outputPath('registration-grouped-page.png'),animations:'disabled'});
});


test('discarding live information edits clears the page leave guard',async({page})=>{
 await page.goto('/console/events');await page.evaluate(async()=>{const {activityLiveInformation}=await import('/app/console/pages/activity-live-information.js');window.liveEditor=await activityLiveInformation({load:async()=>({id:'synthetic',version:1,token:'synthetic-token',content:{name:'合成信息',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-01',description:'原说明',notice:'手写通知',positions:[]}}),save:async()=>{},onSaved:async()=>{}});});
 const editor=page.getByRole('dialog',{name:'修改活动信息',exact:true});await editor.getByRole('textbox',{name:'活动说明',exact:true}).fill('不保存的修改');expect(await page.evaluate(()=>window.liveEditor.hasUnsaved())).toBe(true);await editor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog',{name:'放弃未保存的修改？',exact:true}).getByRole('button',{name:'放弃修改',exact:true}).click();await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>window.liveEditor.hasUnsaved())).toBe(false);
});


test('notice grows for long text and narrow wrapping, then shrinks without an internal vertical scroller',async({page})=>{
 await mount(page);const notice=page.getByRole('textbox',{name:'通知正文',exact:true});
 const text=Array.from({length:22},(_,i)=>`第${i+1}项：完整展示活动内容、工作地点和时间，修改时不会裁掉通知正文。`).join('\n');
 await notice.fill(text);
 await expect.poll(()=>notice.evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);
 const wide=await notice.evaluate(n=>n.clientHeight);await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>notice.evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);
 await notice.fill('短通知');await expect.poll(()=>notice.evaluate(n=>n.clientHeight)).toBeLessThan(wide);
 expect(await notice.evaluate(n=>getComputedStyle(n).overflowY)).toBe('hidden');
 await page.evaluate(()=>window.workspaceEditor.dispose());
});
