import {test,expect} from '@playwright/test';
async function open(page){
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.goto('/console/events');await page.getByRole('button',{name:'新建活动',exact:true}).click();
 return page.locator('.activity-create-form');
}
async function fill(page,form){
 for(const [label,value] of [['活动名称','合成表单工作区'],['活动开始时间','2030-01-12T08:30'],['活动结束时间','2030-01-12T12:00'],['服务时长（小时）','3.5'],['活动地点','合成教学楼'],['活动内容','合成活动说明'],['工作内容','合成签到引导']])await form.getByLabel(label).fill(value);
}
test('workspace preserves input across sections and guards dismissal',async({page},info)=>{
 const form=await open(page);await form.getByLabel('活动名称').fill('合成未保存内容');
 await page.getByRole('button',{name:'3. 工作与时长',exact:true}).click();await expect(form.getByLabel('活动名称')).toHaveValue('合成未保存内容');
 await page.getByRole('button',{name:'退出编辑',exact:true}).click();await expect(page.getByRole('heading',{name:'放弃未保存的修改？'})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('heading',{name:'放弃未保存的修改？'})).toHaveCount(0);await expect(form).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('activity-form-workspace.png'),fullPage:true});
 await page.getByRole('button',{name:'退出编辑',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(form).toBeHidden();
});
test('approval failure keeps saved draft and retries only submit',async({page})=>{
 const form=await open(page);await fill(page,form);let creates=0,submits=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/workflow/events'))creates++;});
 await page.route('**/workflow/events/*/submit',r=>{submits++;return r.fulfill({status:409,json:{message:'合成审批冲突'}});});
 await page.getByRole('button',{name:'提交审批',exact:true}).last().click();
 await expect(page.locator('.form-workspace-status')).toContainText('草稿已保存 · 审批提交未完成');
 await page.getByRole('button',{name:'提交审批',exact:true}).last().click();await expect.poll(()=>submits).toBe(2);expect(creates).toBe(1);
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(form).toBeHidden();expect(creates).toBe(1);
});
test('ambiguous write prevents duplicate submission and keeps inputs',async({page})=>{
 const form=await open(page);await fill(page,form);
 await page.route('**/workflow/events',r=>r.request().method()==='POST'?r.abort('connectionreset'):r.continue());
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect(page.locator('.form-workspace-status')).toContainText('暂时无法确认');
 await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();await expect(form.getByLabel('活动名称')).toHaveValue('合成表单工作区');
});
test('organization reviewer picker retains multiple choices and submits stable IDs',async({page})=>{
 await page.route('**/workflow/approval-routing',r=>r.fulfill({json:{ok:true,mode:'organization',policy:'any',categories:[],reviewers:[{id:'chair-one',name:'合成主席甲',studentId:'999990011'},{id:'chair-two',name:'合成指导乙',studentId:'999990012'}]}}));
 const form=await open(page);await fill(page,form);
 const picker=form.locator('.people-picker').filter({has:page.getByLabel('搜索审核人')});
 await picker.locator('summary').click();
 await picker.getByLabel('搜索审核人').fill('合成主席');
 await picker.getByLabel('搜索审核人').press('Enter');
 await picker.getByLabel('搜索审核人').fill('999990012');
 await picker.getByLabel('搜索审核人').press('Enter');
 await expect(picker.locator('.people-picker__token')).toHaveCount(2);
 let payload;
 await page.route('**/workflow/events',r=>{
  if(r.request().method()!=='POST')return r.continue();
  payload=r.request().postDataJSON();return r.fulfill({status:409,json:{message:'合成校验失败，不写入'}});
 });
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect.poll(()=>payload?.reviewerIds).toEqual(['chair-one','chair-two']);
 await expect(picker.locator('.people-picker__token')).toHaveCount(2);
 await expect(form.getByLabel('活动名称')).toHaveValue('合成表单工作区');
});
test('slow owner directory does not block form and preserves typed fields',async({page})=>{
 let release;const gate=new Promise(r=>{release=r;});
 await page.route('**/workflow/directory?owners=true',async r=>{await gate;await r.continue();});
 try{const form=await open(page);await form.getByLabel('活动名称').fill('合成目录延迟');await expect(form).toContainText('正在加载负责人目录');release();await form.locator('.people-picker summary').click();await expect(form.getByLabel('搜索负责人')).toBeVisible();await expect(form.getByLabel('活动名称')).toHaveValue('合成目录延迟');}finally{release();}
});
test('edit and copy use distinct workspaces without changing the source',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers:{'x-csrf-token':'synthetic-ui'},data:{name:'合成编辑原稿',date:'2030-01-12',slot:'09:00-12:00',capacity:2,registrationLimit:3,serviceHours:3,location:'合成地点',work:'合成服务',submit:false}});
 const id=(await response.json()).result._id;await page.goto(`/console/events?event=${id}&mode=all&scope=session`);
 await page.getByRole('button',{name:'编辑配置',exact:true}).click();await expect(page.getByRole('heading',{name:'编辑活动',exact:true})).toBeVisible();await page.getByRole('button',{name:'退出编辑',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'复制为新活动',exact:true}).click();await expect(page.getByRole('heading',{name:'复制为新活动',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'复制为新活动'}).getByLabel('活动名称')).toHaveValue('合成编辑原稿');
});
test('source adoption retains saved identity after approval rejection',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const sources=(await (await page.request.get('/api/volunteer/workflow/sources')).json()).sources;
 const source=sources[0];await page.goto(`/console/events?mode=sources&event=${encodeURIComponent(source.key)}`);
 await page.getByRole('button',{name:'完善配置并纳入流程',exact:true}).click();
 const form=page.locator('.activity-create-form');await fill(page,form);let adoptions=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/workflow/adopt'))adoptions++;});
 await page.route('**/workflow/events/*/submit',r=>r.fulfill({status:409,json:{message:'合成审批冲突'}}));
 await page.getByRole('button',{name:'提交审批',exact:true}).last().click();await expect(page.locator('.form-workspace-status')).toContainText('草稿已保存');
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(form).toBeHidden();expect(adoptions).toBe(1);
});
