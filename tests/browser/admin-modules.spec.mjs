import { test, expect } from '@playwright/test';
test.beforeEach(async ({page}) => { await page.emulateMedia({reducedMotion:'reduce'}); });
const campaigns = n => Array.from({length:n},(_,i)=>({id:`submission:${i}`,title:`合成投稿${i}`,type:'活动总结',source:'合成投稿表',author:`合成作者${i}`,summary:'合成正文，仅用于隔离测试',submittedAt:'2030-10-14',status:'已收集',authorization:'已授权',chain:{passed:0,done:false,status:'待审核'}}));
async function login(page){await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});}
async function outreach(page,n=30){await login(page);await page.route('**/api/outreach/overview',r=>r.fulfill({json:{campaigns:campaigns(n),sources:['合成数据'],stats:{contentCount:n,reviewPending:n,reviewApproved:0,publicationPending:0}}}));await page.goto('/console/outreach');await expect(page.locator('h1')).toBeVisible();}
test('outreach baseline and module screenshot',async({page},info)=>{await outreach(page);await expect(page.getByText('合成投稿0',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('outreach.png'),fullPage:true});});
test('outreach list pagination, empty stages and inspector preserve pipeline',async({page})=>{
 await outreach(page,200);await expect(page.locator('.datatable tbody tr')).toHaveCount(25);
 await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.getByText('合成投稿25',{exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'搜索标题、投稿人或栏目'}).fill('合成投稿199');await expect(page.locator('.datatable tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:'查看内容',exact:true}).click();await expect(page.getByRole('button',{name:'创建排期',exact:true})).toBeDisabled();
 await page.keyboard.press('Escape');await page.getByRole('radio',{name:'阶段看板',exact:true}).click();await expect(page.locator('.board__col')).toHaveCount(1);
 await page.getByRole('radio',{name:'待修改 0',exact:true}).click();await expect(page.getByText('这一阶段没有内容',{exact:true})).toBeVisible();
});
test('outreach formal review separates preview and decision without writing on open',async({page})=>{
 await outreach(page,1);let writes=0;
 await page.route('**/api/outreach/reviews/*/chain',r=>r.fulfill({json:{chain:{passed:0,total:2,current:{level:1,name:'初审'},steps:[{level:1,name:'初审'}],canReturn:true}}}));
 await page.route('**/api/outreach/checklist',r=>r.fulfill({json:{checklist:[{id:'one',category:'内容',item:'事实准确',standard:'确认活动事实'}]}}));
 await page.route('**/api/outreach/assignees*',r=>r.fulfill({json:{liaison:{name:'合成初审'},reviewer:{name:'合成终审'}}}));
 await page.route('**/api/outreach/reviews/*/step',r=>{writes++;return r.fulfill({status:503,json:{message:'合成网络错误'}});});
 await page.getByRole('button',{name:'查看内容',exact:true}).click();await page.getByRole('button',{name:'开始审核',exact:true}).click();
 await expect(page.getByRole('heading',{name:'作品与来源',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'审核与处理',exact:true})).toBeVisible();expect(writes).toBe(0);
 await page.getByRole('button',{name:'提交审核结果',exact:true}).click();expect(writes).toBe(0);
 await expect(page.getByRole('button',{name:'生成意见 Word'})).toBeVisible();
 await page.getByRole('button',{name:'全部确认',exact:true}).click();
 await page.getByRole('textbox',{name:'审核意见',exact:true}).fill('合成保留意见');
 await page.getByRole('button',{name:'提交审核结果',exact:true}).click();
 await expect.poll(()=>writes).toBe(1);await expect(page.getByRole('textbox',{name:'审核意见',exact:true})).toHaveValue('合成保留意见');
});
async function birthday(page,n=1){await login(page);let reads=0;await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));await page.route('**/api/community/interests',r=>{reads++;return r.fulfill({json:{interests:Array.from({length:n},(_,i)=>({id:`m${i}`,studentId:`2030${i}`,realName:`合成成员${i}`,program:'birthday',displayStatus:'正常',status:'已确认',campus:'仙林',submittedAt:'2030-10-14'})),stats:{total:n,active:n,confirmed:n}}});});await page.route('**/api/community/warmth-blacklist',r=>r.fulfill({json:{entries:[]}}));await page.goto('/console/community');await expect(page.getByText('合成成员0',{exact:true})).toBeVisible();return()=>reads;}
test('birthday module screenshot',async({page},info)=>{await birthday(page);await page.screenshot({path:info.outputPath('birthday.png'),fullPage:true});});
test('birthday local state filters reuse fetched rows and do not write',async({page})=>{
 const reads=await birthday(page,30);await expect(page.locator('.datatable tbody tr')).toHaveCount(25);
 await page.getByRole('radio',{name:'已退出（0）',exact:true}).click();await expect(page.getByText('没有已退出成员',{exact:true})).toBeVisible();
 await page.getByRole('radio',{name:'正常成员（30）',exact:true}).click();await expect(page.locator('.datatable tbody tr')).toHaveCount(25);expect(reads()).toBe(1);
 await page.getByRole('button',{name:'拉黑',exact:true}).first().click();await expect(page.getByRole('dialog')).toContainText('禁止其重新加入或投稿');
 await page.getByRole('button',{name:'拉黑并踢出',exact:true}).click();await expect(page.getByText('请填写拉黑原因',{exact:true})).toBeVisible();
});
async function materials(page,n=1){await login(page);const inventory=Array.from({length:n},(_,i)=>({code:`NJU-RC-TEST${i}`,name:`合成物资${i}`,center:'仙林',cabinet:'1',level:'1',initial:20,quantity:20,difference:0,threshold:2,thresholdStatus:'normal',unit:'件'}));const application={id:'a1',code:'A-1',purpose:'合成活动',applicant:'合成申请人',items:'合成物资0',quantity:1,status:'待审批',approval:'待审核',returnStatus:'',plannedReturnDate:'2030-10-20'};await page.route('**/api/materials/overview',r=>r.fulfill({json:{inventory,applications:[application],pending:[application],overdue:[],abnormalReturns:[],lowStock:[],recentFlows:[],stats:{categoryCount:n,totalCurrentQuantity:20*n,totalInitialQuantity:20*n,totalDifference:0,pendingCount:1,borrowedCount:0,overdueCount:0,lowStockCount:0,flowCount:0},policy:{thresholdRule:'合成阈值规则',source:'合成数据'}}}));await page.goto('/console/materials');await expect(page.getByText('合成活动',{exact:true})).toBeVisible();}
test('materials module screenshot',async({page},info)=>{await materials(page,30);await page.screenshot({path:info.outputPath('materials.png'),fullPage:true});});
test('overview module screenshot',async({page},info)=>{await login(page);await page.route('**/api/events/overview',r=>r.fulfill({json:{series:null}}));await page.route('**/api/materials/overview',r=>r.fulfill({json:{stats:{categoryCount:0,totalCurrentQuantity:0,lowStockCount:0,overdueCount:0},series:null}}));await page.route('**/api/audit*',r=>r.fulfill({json:{entries:[]}}));await page.goto('/console/overview');await expect(page.getByRole('heading',{name:'没有待处理的任务',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('overview.png'),fullPage:true});});
test('materials keeps approval confirmation and separates inventory operations',async({page})=>{
 await materials(page,30);let writes=0;
 await page.route('**/api/materials/applications/a1/approve',r=>{writes++;return r.fulfill({status:503,json:{message:'合成服务暂不可用'}});});
 await page.getByRole('button',{name:'查看',exact:true}).click();await page.getByRole('button',{name:'审批通过',exact:true}).click();expect(writes).toBe(0);
 const modal=page.getByRole('dialog',{name:'确认审批通过？'});await expect(modal).toBeVisible();await modal.getByRole('button',{name:'取消',exact:true}).click();expect(writes).toBe(0);
 await page.keyboard.press('Escape');await page.getByRole('tab',{name:'库存台账',exact:true}).click();await expect(page.locator('.datatable tbody tr')).toHaveCount(25);
 await page.getByRole('searchbox',{name:'搜索物资名称、编码或位置'}).fill('合成物资29');await expect(page.locator('.datatable tbody tr')).toHaveCount(1);
});
async function morning(page,n=1,{revisions=[]}={}){await login(page);const cards=Array.from({length:n},(_,i)=>({id:`card${i}`,nickname:`合成同行${i}`,status:'待审核',campus:'仙林',interestTags:['摄影'],note:'合成内容',submittedAt:'2030-10-14'}));await page.route('**/api/community/morning/cards*',r=>r.fulfill({json:{cards,stats:{pending:n}}}));await page.route('**/api/community/morning/cards/card0',r=>r.fulfill({json:{card:cards[0]}}));await page.route('**/api/community/morning/revisions*',r=>r.fulfill({json:{revisions,stats:{pending:revisions.length}}}));await page.goto('/console/community/morning');await expect(page.getByText('合成同行0',{exact:true})).toBeVisible();}
test('morning cards support partial and select-all batch approval',async({page})=>{
 await morning(page,3);const approved=[];
 await page.route('**/api/community/morning/cards/*/review',async route=>{
  approved.push({id:new URL(route.request().url()).pathname.split('/').at(-2),body:route.request().postDataJSON()});
  await route.fulfill({json:{ok:true,message:'名片已通过'}});
 });
 await page.getByRole('checkbox',{name:'选择审核记录 合成同行0'}).check();
 await expect(page.getByText('已选择 1 条',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'全选待审核',exact:true}).click();
 await expect(page.getByRole('button',{name:'取消全选',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消全选',exact:true}).click();
 await expect(page.getByText('已选择 0 条',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'全选待审核',exact:true}).click();
 await page.getByRole('button',{name:'通过所选（3）',exact:true}).click();
 await page.getByRole('button',{name:'全部通过',exact:true}).click();
 await expect.poll(()=>approved).toHaveLength(3);
 expect(approved.every(item=>item.body.decision==='approve'&&item.body.note==='')).toBe(true);
});
test('morning revisions batch approval preserves each revision version',async({page})=>{
 const approved=[];
 const revisions=Array.from({length:2},(_,i)=>({id:`revision${i}`,cardId:`card${i}`,nickname:`更新昵称${i}`,realName:`合成成员${i}`,version:i+2,status:'待审核',campus:'仙林'}));
 await morning(page,1,{revisions});
 await page.route('**/api/community/morning/revisions/*/review',async route=>{
  approved.push(route.request().postDataJSON());
  await route.fulfill({json:{ok:true,message:'资料更新已通过'}});
 });
 await expect(page.getByText('更新昵称0',{exact:true})).toBeVisible();
 await page.getByRole('checkbox',{name:'选择审核记录 更新昵称0'}).check();
 await page.getByRole('button',{name:'通过所选（1）',exact:true}).click();
 await page.getByRole('button',{name:'全部通过',exact:true}).click();
 await expect.poll(()=>approved).toHaveLength(1);
 expect(approved[0].expectedVersion).toBe(2);
 expect(approved.every(item=>item.decision==='approve')).toBe(true);
});
test('morning review opens via keyboard and does not implicitly publish',async({page},info)=>{
 await morning(page,30);let writes=0;await page.route('**/api/community/morning/cards/*/review',r=>{writes++;return r.fulfill({status:503,json:{message:'合成写入失败'}});});
 const row=page.locator('.datatable tbody tr').first();await row.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toContainText('公开昵称');expect(writes).toBe(0);
 await page.screenshot({path:info.outputPath('morning-inspector.png'),fullPage:true});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('failed refresh preserves list but permission denial clears it',async({page})=>{
 await outreach(page,1);await expect(page.getByText('合成投稿0',{exact:true})).toBeVisible();await page.route('**/api/outreach/overview',r=>r.fulfill({status:503,json:{message:'合成读取失败'}}));
 await page.locator('#main').getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByText('宣传内容无法加载',{exact:true})).toBeVisible();await expect(page.getByText('合成投稿0',{exact:true})).toBeVisible();
 await page.route('**/api/outreach/overview',r=>r.fulfill({status:403,json:{message:'合成权限拒绝'}}));await page.locator('#main').getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByText('合成投稿0',{exact:true})).toHaveCount(0);
});
test('events-only account cannot open other operational modules',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-events-only'}});
 for(const path of ['/console/materials','/console/outreach','/console/community']){await page.goto(path);await expect(page).toHaveURL(/\/console\/overview/);await expect(page.locator('.operations-materials,.operations-outreach,.operations-community')).toHaveCount(0);}
});
for(const count of [0,1,20,200])test(`outreach ${count} records has accurate visible count`,async({page})=>{
 await outreach(page,count);
 if(count){await expect(page.locator('.datatable tbody tr')).toHaveCount(Math.min(count,25));await expect(page.locator('.metrics .metric__value').first()).toHaveText(String(count));}
 else await expect(page.getByText('还没有可审核的内容资产',{exact:true})).toBeVisible();
});
test('P06 module themes widths and keyboard focus',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium','Matrix runs once on Chromium; separate mobile and cross-engine flows cover interactions');test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [name,setup] of [['outreach',outreach],['birthday',birthday],['materials',materials],['morning',morning]]){
  await setup(page,1);
  for(const theme of ['porcelain','blueprint','botanic','atelier','archive']){
   await page.evaluate(async t=>{const {selectTheme}=await import('/app/core/themes.js');selectTheme('console',t);await document.fonts.ready;},theme);
   for(const width of [390,768,1280,1440,1920,2048]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}/${theme}/${width}`).toBe(true);
    await expect(page.locator('.operations-module .metric').first()).toHaveCSS('border-radius','0px');
    if(width<=768) expect(await page.locator('.datatable--records').evaluateAll(nodes=>nodes.every(n=>n.querySelector('table').getBoundingClientRect().width<=n.getBoundingClientRect().width+1)),`${name} mobile records fit`).toBe(true);
    if([390,1440].includes(width))await page.screenshot({path:info.outputPath(`${name}-${theme}-${width}.png`),fullPage:true});
   }
  }
 }
 await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement!==document.body)).toBe(true);expect(errors).toEqual([]);
});
