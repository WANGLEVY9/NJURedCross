import {test,expect} from '@playwright/test';

const root='/api/volunteer/workflow/workspace-drafts',headers={'x-csrf-token':'synthetic-ui'};
for(const mode of ['grouped','unified'])test(`${mode} drafts save preview and publish demand plus per-position flexibility`,async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 const base={qqGroup:'123456789',name:'合成弹性名额-'+mode+'-'+info.project.name,region:'nanjing',category:'生命中心',responsibleId:'synthetic-organizer',bookingMode:mode,date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'需求人数保持不变的合成报名通知',start:'09:00',end:'12:00',location:'合成活动室',capacity:'20',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成服务'};
 if(mode==='grouped')base.positions=[{id:'synthetic-position-a',name:'宣传岗',date:'2030-01-01',start:'09:00',end:'12:00',location:'合成活动室',capacity:'20',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成宣传'},{id:'synthetic-position-b',name:'签到岗',date:'2030-01-02',start:'13:00',end:'16:00',location:'合成活动室',capacity:'10',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'合成签到'}];
 const response=await page.request.post(root,{headers,data:{requestId:crypto.randomUUID(),content:base}});expect(response.ok()).toBe(true);const created=(await response.json()).result;
 await page.goto(`/console/events?draft=${created.id}`);
 const pickers=page.getByRole('combobox',{name:'弹性名额',exact:true});await expect(pickers).toHaveCount(mode==='grouped'?2:1);
 await expect(pickers.first()).toContainText('关闭');await pickers.first().click();await page.getByRole('option',{name:'5人',exact:true}).click();
 if(mode==='grouped'){
  await pickers.nth(1).click();await page.getByRole('option',{name:'10人',exact:true}).click();
  await page.getByRole('button',{name:'复制',exact:true}).first().click();await expect(pickers).toHaveCount(3);await expect(pickers.last()).toContainText('5人');
  await page.getByRole('button',{name:'删除',exact:true}).last().click();await expect(pickers).toHaveCount(2);
 }
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('region',{name:'活动操作工作区'}).getByRole('status')).toHaveText('已保存');
 await page.reload();await expect(pickers.first()).toContainText('5人');if(mode==='grouped')await expect(pickers.nth(1)).toContainText('10人');
 const saved=(await (await page.request.get(`${root}/${created.id}`)).json()).result;
 expect(saved.content.projectOwnerId).toBe('synthetic-organizer');expect(saved.content.responsibleIds).toEqual(['synthetic-organizer']);expect(saved.content.reviewerIds).toEqual(['synthetic-super']);
 expect(mode==='grouped'?saved.content.positions.map(p=>p.flexibleCapacity):[saved.content.flexibleCapacity]).toEqual(mode==='grouped'?['5','10']:['5']);
 if(mode==='grouped')await page.locator('.activity-draft-table').scrollIntoViewIfNeeded();else await pickers.first().scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('flexible-'+mode+'-draft.png'),animations:'disabled'});
 await page.getByRole('button',{name:'预览并提交',exact:true}).click();const preview=page.getByRole('dialog',{name:'完整活动预览',exact:true});
 await expect(preview).toContainText('立项负责人');await expect(preview).toContainText('审批人');await expect(preview).toContainText('弹性名额 / 人');await expect(preview).toContainText('报名上限 / 人');await expect(preview.locator('.activity-preview__metrics').first()).toContainText('25');
 await preview.getByRole('button',{name:'提交审核',exact:true}).click();await expect(preview).toHaveCount(0);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const catalog=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events,parent=catalog.find(e=>e['活动名称']===base.name),url=`/api/volunteer/workflow/events/${parent._id}`;
 const information=(await (await page.request.get(url+'/workspace-content')).json()).result;
 expect(information.content.projectOwnerId).toBe('synthetic-organizer');expect(information.content.reviewerIds).toEqual(['synthetic-super']);
 expect((await page.request.post(url+'/approve',{headers,data:{token:information.token}})).ok()).toBe(true);expect((await page.request.post(url+'/publish',{headers,data:{}})).ok()).toBe(true);
 const published=(await (await page.request.get('/api/public/workflow/events')).json()).events.filter(e=>e.name===base.name);
 expect(published).toHaveLength(mode==='grouped'?2:1);expect(published[0].capacity).toBe(20);expect(published[0].flexibleRegistration).toBe(true);expect(published[0].full).toBe(false);expect(published[0].registrationLimit).toBeUndefined();
});

test('public sessions still accept applications after demand is met and stop at the real limit',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});let full=false,submissions=0;
 const entry={id:'synthetic-flexible-slot',name:'合成弹性报名',date:'2030-01-01',slot:'09:00–12:00',position:'宣传岗',location:'合成活动室',capacity:20,remaining:0,quotaMode:'review',flexibleRegistration:true,ordinary:{groupId:'synthetic-flexible-group',start:'2030-01-01T09:00:00+08:00',end:'2030-01-01T12:00:00+08:00'},registrationEnd:'2029-12-31T18:00:00+08:00',registrationOpen:true};
 await page.route('**/api/public/workflow/events',route=>route.fulfill({json:{ok:true,events:[{...entry,full}]}}));
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{ok:true,participant:{realName:'合成志愿者',studentId:'999990001',email:'999990001@smail.nju.edu.cn',campus:'仙林'},registrations:[]}}));
 await page.route('**/api/portal/workflow/wishlist',route=>route.fulfill({json:{ok:true,wishlist:[]}}));
 await page.route('**/api/portal/workflow/events/synthetic-flexible-slot/register',route=>{submissions++;return route.fulfill({json:{ok:true,result:{status:'待筛选'}}});});
 await page.goto('/workflow-events?event=synthetic-flexible-slot');
 const board=page.locator('.ordinary-sessions');await expect(board.locator('.ordinary-sessions__slot')).toHaveAttribute('data-state','available');await expect(board).toContainText('需求 20 人');await expect(board).toContainText('有可报名班次');
 await expect(page.locator('.workflow-slot-summary')).toContainText('需求 20 人');
 await page.locator('.blood-signup-controls .check').click();const signup=page.getByRole('button',{name:'确认报名此班次',exact:true});await expect(signup).toBeEnabled();
 await page.screenshot({path:info.outputPath('flexible-public-demand.png'),animations:'disabled',fullPage:true});
 await signup.click();await expect.poll(()=>submissions).toBe(1);
 full=true;await page.reload();await expect(board.locator('.ordinary-sessions__slot')).toHaveAttribute('data-state','full');await expect(board).toContainText('需求 20 人');await expect(page.getByText('报名人数已达上限，请关注后续活动。',{exact:true})).toBeVisible();await expect(signup).toHaveCount(0);
});
