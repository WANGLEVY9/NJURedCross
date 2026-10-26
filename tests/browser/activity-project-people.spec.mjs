import {test,expect} from '@playwright/test';

test('project people defaults use one scoped load and saved reviewer choices survive refresh',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});await page.goto('/console/events');
 await page.evaluate(async()=>{
  const {activityDraftWorkspace}=await import('/app/console/pages/activity-draft-workspace.js');
  const {normalizeWorkspaceDraft,workspaceDraftErrors}=await import('/app/shared/activity-workspace.js');
  const state=window.projectPeopleTest={loads:[],saved:null,version:1};
  const content=normalizeWorkspaceDraft({qqGroup:'123456789',name:'合成项目人员',region:'nanjing',category:'生命中心',bookingMode:'unified',date:'2030-01-01',endDate:'2030-01-01',start:'09:15',end:'11:45',deadline:'2029-12-31T18:00',location:'合成地点',capacity:'3',serviceHours:'2.5',trainingHours:'0',travelHours:'0',work:'合成服务',notice:'合成通知'});
  const load=async scope=>{state.loads.push(scope);return {self:{id:'owner',name:'合成立项人'},collaborators:[{id:'owner',name:'合成立项人'},{id:'co',name:'合成协作人'}],reviewers:[{id:scope.category==='生命中心'?'chair':'other-chair',name:scope.category==='生命中心'?'合成生命主席':'合成博爱主席'},{id:'jin',name:'金中宸'},{id:'yuan',name:'袁金雨'}],defaultReviewerIds:[scope.category==='生命中心'?'chair':'other-chair','jin','yuan'],unavailableDefaults:[]};};
  window.mountProjectPeople=()=>{
   window.projectPeopleEditor?.dispose();
   const editor=activityDraftWorkspace({initial:{id:'synthetic-people',ownerId:'owner',version:state.version,content:state.saved||content},editable:true,loadProjectPeopleOptions:load,
    save:async({content})=>{state.saved=structuredClone(content);return {id:'synthetic-people',version:++state.version,content:state.saved};},
    preview:async()=>({content:structuredClone(state.saved),digest:'synthetic-people-proof',errors:workspaceDraftErrors(state.saved)})});
   document.getElementById('root').replaceChildren(editor.node);window.projectPeopleEditor=editor;
  };window.mountProjectPeople();
 });
 const owner=page.getByLabel('立项负责人（本人）',{exact:true}),reviewers=page.getByRole('group',{name:'审批人（可多选）',exact:true});
 await expect(page.getByRole('group',{name:'协作负责人（可选择）',exact:true}).getByRole('checkbox',{name:'合成立项人',exact:true})).toHaveCount(0);
 await expect(owner).toHaveValue('合成立项人');await expect(owner).toHaveAttribute('readonly','');
 await expect(reviewers.getByRole('checkbox',{checked:true})).toHaveCount(3);
 expect(await page.evaluate(()=>window.projectPeopleEditor.hasUnsaved())).toBe(false);
 await reviewers.getByRole('checkbox',{name:'金中宸',exact:true}).uncheck();
 await page.getByRole('group',{name:'协作负责人（可选择）',exact:true}).getByRole('checkbox',{name:'合成协作人',exact:true}).check();
 expect(await page.evaluate(()=>window.projectPeopleEditor.hasUnsaved())).toBe(true);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.projectPeopleTest.saved?.reviewerIds)).toEqual(['chair','yuan']);
 expect(await page.evaluate(()=>window.projectPeopleTest.saved.responsibleIds)).toEqual(['owner','co']);
 expect(await page.evaluate(()=>window.projectPeopleTest.loads)).toEqual([{region:'nanjing',category:'生命中心'}]);
 await page.screenshot({path:info.outputPath('project-people-form.png'),fullPage:true});
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'完整活动预览',exact:true});
 await expect(preview).toContainText('合成立项人');await expect(preview).toContainText('合成协作人');await expect(preview).toContainText('合成生命主席、袁金雨');
 await preview.getByRole('button',{name:'返回',exact:true}).click();
 await page.evaluate(()=>window.mountProjectPeople());
 await expect(reviewers.getByRole('checkbox',{name:'金中宸',exact:true})).not.toBeChecked();
 await page.getByRole('combobox',{name:'活动类别',exact:true}).click();await page.getByRole('option',{name:'博爱中心',exact:true}).click();
 await expect(reviewers.getByRole('checkbox',{name:'合成博爱主席',exact:true})).toBeChecked();
 await expect(reviewers.getByRole('checkbox',{name:'金中宸',exact:true})).toBeChecked();
 await expect(page.getByRole('group',{name:'协作负责人（可选择）',exact:true}).getByRole('checkbox',{checked:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.projectPeopleTest.loads.length)).toBe(3);
});

test('late people responses cannot restore choices from a previous center',async({page})=>{
 await page.goto('/console/events');await page.evaluate(async()=>{
  const {activityProjectPeople}=await import('/app/console/pages/activity-project-people.js');
  const content={region:'nanjing',category:'生命中心',responsibleId:'owner'},pending={};window.peopleRace={content,pending};
  const component=activityProjectPeople({ownerId:'owner',getContent:()=>content,editable:true,onChange:()=>{},load:({category})=>new Promise(resolve=>{pending[category]=()=>resolve({self:{id:'owner',name:'合成立项人'},collaborators:[],reviewers:[{id:category,name:category+'主席'}],defaultReviewerIds:[category],unavailableDefaults:[]});})});
  document.getElementById('root').replaceChildren(component.node);void component.refresh();content.category='博爱中心';void component.refresh({reset:true});pending['博爱中心']();
 });
 const reviewers=page.getByRole('group',{name:'审批人（可多选）',exact:true});
 await expect(reviewers.getByRole('checkbox',{name:'博爱中心主席',exact:true})).toBeChecked();
 await page.evaluate(()=>window.peopleRace.pending['生命中心']());
 await expect(reviewers.getByRole('checkbox',{name:'生命中心主席',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.peopleRace.content.reviewerIds)).toEqual(['博爱中心']);
});

test('collaborator editing another creator draft can retain remove and reselect self',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-life-director-two'}});
 await page.goto('/console/events');
 const response=await page.request.get('/api/volunteer/workflow/workspace-drafts/project-people-options?'+new URLSearchParams({region:'nanjing',category:'生命中心'}));expect(response.ok()).toBe(true);
 const {options}=await response.json();expect(options.collaborators.some(row=>row.id===options.self.id)).toBe(true);
 await page.evaluate(async options=>{
  const {activityProjectPeople}=await import('/app/console/pages/activity-project-people.js');
  const content={region:'nanjing',category:'生命中心',projectOwnerId:'synthetic-organizer',responsibleId:'synthetic-organizer',responsibleIds:['synthetic-organizer',options.self.id],reviewerIds:options.defaultReviewerIds};
  const ui=activityProjectPeople({ownerId:'synthetic-organizer',getContent:()=>content,editable:true,load:async()=>options,onChange:()=>{}});
  document.getElementById('root').replaceChildren(ui.node);window.collaboratorEditor={ui,content};await ui.refresh();
 },options);
 const choices=page.getByRole('group',{name:'协作负责人（可选择）',exact:true});
 await expect(choices.locator('input[value="synthetic-organizer"]')).toHaveCount(0);
 const self=choices.locator('input[value="synthetic-life-director-two"]');await expect(self).toBeChecked();await expect(choices).not.toContainText('已不在有效名单');
 await self.uncheck();await page.evaluate(()=>window.collaboratorEditor.ui.sync());await expect(self).toBeVisible();await self.check();
 expect(await page.evaluate(()=>window.collaboratorEditor.content.responsibleIds)).toEqual(['synthetic-organizer','synthetic-life-director-two']);
});
