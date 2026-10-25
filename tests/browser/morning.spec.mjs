import { test, expect } from '@playwright/test';
const profile={realName:'合成同学',studentId:'999990099',gender:'女',campus:'仙林',department:'模拟学院',grade:'2023级',email:'fixture@example.invalid',missing:[]};
const card={id:'fixture-card',nickname:'合成同行',gender:'女',campus:'仙林',department:'模拟学院',grade:'2023级',interestTags:['摄影'],note:'一起记录校园',notePreview:'一起记录校园',commentCount:0,status:'已发布'};
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});});
test('morning signup uses shared components and submits a reviewed card',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let submitted;
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{ok:true,tags:['摄影','跑步']}}));
 await page.route('**/api/morning/card',r=>{
  if(r.request().method()==='POST')submitted=r.request().postDataJSON();
  return r.fulfill({json:r.request().method()==='POST'?{ok:true,card:{...card,status:'待审核'}}:{ok:true,profile,card:null}});
 });
 await page.goto('/morning');
 await expect(page.getByRole('heading',{name:'早安晚安，从认识彼此开始'})).toBeVisible();
 await page.getByLabel('昵称',{exact:false}).fill('合成同行');
 await expect(page.getByLabel('留言',{exact:false})).toHaveAttribute('maxlength','100');
 await expect(page.getByText('女',{exact:true})).toBeVisible();
 await page.getByText('公开展示学院：模拟学院',{exact:true}).click();
 await page.getByText('公开展示年级：2023级',{exact:true}).click();
 await page.getByRole('button',{name:'摄影',exact:true}).click();
 await page.getByText('我自愿报名，并接受管理员审核',{exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-signup.png'),fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:/提交.*审核|提交报名/}).click();
 await expect(page.locator('#main').getByText('报名已提交',{exact:true})).toBeVisible();
 expect(submitted.nickname).toBe('合成同行');
 expect(submitted.showDepartment).toBe(true);
 expect(submitted.showGrade).toBe(true);
 expect('gender' in submitted).toBe(false);
 expect(errors).toEqual([]);
});
test('morning plaza opens a shared detail drawer with private identity omitted',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let inviteBody;
 let favorite=false;
 await page.route('**/api/morning/favorites/fixture-card',route=>{
  if(route.request().method()==='POST')favorite=true;
  if(route.request().method()==='DELETE')favorite=false;
  return route.fulfill({json:{ok:true,favoriteIds:favorite?['fixture-card']:[]}});
 });
 await page.route('**/api/morning/cards**',r=>{
 const path=new URL(r.request().url()).pathname;
 if(path.endsWith('/invitations')){
  inviteBody=r.request().postDataJSON();
  return r.fulfill({json:{ok:true,invitation:{id:'MNG-INV-1',mailStatus:'已发送'},message:'邀约邮件已发送。'}});
 }
 const viewer={canBrowse:true,canInvite:true,cardStatus:'已发布'};
 return r.fulfill({json:path.endsWith('/fixture-card')?{ok:true,card,viewer,favorite}:{ok:true,cards:[card],viewer,stats:{page:1,totalPages:1,total:1,hasPrevious:false,hasNext:false}}});
 });
 await page.goto('/morning/plaza');
 await expect(page.getByRole('link',{name:'我的名片',exact:true})).toHaveAttribute('href','/morning');
 await page.getByRole('link',{name:'查看 合成同行 的名片详情'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog').locator('.morning-card-detail__title p')).toHaveCount(0);
 await expect(page.getByRole('dialog')).toContainText('女');
 await expect(page.getByRole('dialog')).toContainText('一起记录校园');
 await expect(page.getByRole('dialog')).toContainText('模拟学院');
 await expect(page.getByRole('dialog')).toContainText('2023级');
 await expect(page.getByRole('dialog')).not.toContainText(profile.studentId);
 await expect(page.getByRole('dialog')).not.toContainText('评论');
 await page.getByRole('button',{name:'加入收藏夹',exact:true}).click();
 await expect(page.getByRole('button',{name:'已收藏',exact:true})).toBeVisible();
 expect(favorite).toBe(true);
 const inviteButton=page.getByRole('button',{name:'发起好友邀约'});
 await inviteButton.scrollIntoViewIfNeeded();
 await inviteButton.click();
 const inviteDialog=page.getByRole('dialog',{name:'向合成同行发起好友邀约'});
 await expect(inviteDialog).toBeVisible();
 await page.getByLabel('邀约附言',{exact:false}).fill('想和你一起逛展。');
 await page.getByRole('button',{name:'发送好友邀约'}).click();
 await expect(page.getByText('好友邀约已记录',{exact:true})).toBeVisible();
 expect(inviteBody).toEqual({message:'想和你一起逛展。'});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-detail.png'),fullPage:true,animations:'disabled'});
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('registered users can browse without a card and invitation redirects to signup',async({page})=>{
 const pendingCard={...card,id:'pending-card',status:'待审核'};
 await page.route('**/api/morning/cards**',r=>{
  const path=new URL(r.request().url()).pathname;
  const viewer={canBrowse:true,canInvite:false,cardStatus:'待审核'};
  return r.fulfill({json:path.endsWith('/fixture-card')
   ?{ok:true,card,viewer}
   :{ok:true,cards:[card],viewer,stats:{page:1,totalPages:1,total:1,hasPrevious:false,hasNext:false}}});
 });
 await page.route('**/api/morning/card',r=>r.fulfill({json:{ok:true,profile,card:pendingCard}}));
 await page.goto('/morning/plaza');
 await expect(page.getByRole('link',{name:'查看 合成同行 的名片详情'})).toBeVisible();
 await page.getByRole('link',{name:'查看 合成同行 的名片详情'}).click();
 const detailDialog=page.getByRole('dialog',{name:'名片详情'});
 await expect(detailDialog).toBeVisible();
 await detailDialog.getByRole('button',{name:'发起好友邀约'}).click();
 await expect(page).toHaveURL(/\/morning\?intent=invite$/);
 await expect(page.getByText('先准备自己的同行名片',{exact:true})).toBeVisible();
 await expect(page.getByText('你的报名正在等待管理员审核。审核通过后会进入广场。',{exact:true})).toBeVisible();
});
test('invitation feedback opens the confirmation modal and records success',async({page})=>{
 let confirmed=false;
 await page.route('**/api/morning/invitations/feedback/test-token',r=>{
  if(r.request().method()==='POST')confirmed=true;
  return r.fulfill({json:{ok:true,invitation:{id:'MNG-INV-1',cardId:'fixture-card',inviterNickname:'合成同行',recipientNickname:'合成收件人',message:'想认识你',status:confirmed?'已反馈':'已发送',expiresAt:'2030-01-03T00:00:00.000Z',feedbackAt:confirmed?'2030-01-01T00:00:00.000Z':null},message:confirmed?'已记录成功结识，并完成平台报备。':undefined}});
 });
 await page.goto('/morning/invite-feedback?token=test-token');
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog')).toContainText('合成收件人');
 await expect(page.getByRole('dialog')).toContainText('合成同行');
 await page.getByRole('button',{name:'确认报备'}).click();
 await expect(page.getByText('已记录成功结识',{exact:true})).toBeVisible();
 expect(confirmed).toBe(true);
});
test('legacy invitation profile query opens the same detail without forwarding the token',async({page})=>{
 let forwardedInvite='';
 await page.route('**/api/morning/cards**',r=>{
  const url=new URL(r.request().url());
  if(url.pathname.endsWith('/fixture-card')){
   forwardedInvite=url.searchParams.get('invite')||'';
   return r.fulfill({json:{ok:true,card,viewer:{canBrowse:true,canInvite:true,cardStatus:'已发布'}}});
  }
  return r.fulfill({json:{ok:true,cards:[card],viewer:{canBrowse:true,canInvite:true,cardStatus:'已发布'},stats:{page:1,totalPages:1,total:1,hasPrevious:false,hasNext:false}}});
 });
 await page.goto('/morning/plaza?card=fixture-card&invite=invite-token');
 const dialog=page.getByRole('dialog',{name:'名片详情'});
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('合成同行');
 await expect(dialog).toContainText('一起记录校园');
 await expect(page.getByRole('button',{name:'同意邀约',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'拒绝邀约',exact:true})).toHaveCount(0);
 expect(forwardedInvite).toBe('');
});
test('morning plaza renders six cards as two equal-height rows of three',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');
 const cards=Array.from({length:6},(_,index)=>({
  ...card,
  id:`fixture-card-${index}`,
  nickname:`同行${index+1}`,
  department:index%2===0?'模拟学院':'',
  grade:index%3===0?'2023级':'',
  interestTags:index%2===0?['摄影','跑步','读书']:['摄影'],
  notePreview:'这是一条长度不同的公开留言，用来确认卡片高度不会随公开资料变化。'.repeat(index%3===0?2:1),
 }));
 await page.route('**/api/morning/cards**',r=>r.fulfill({json:{ok:true,cards,stats:{page:1,totalPages:1,total:6,hasPrevious:false,hasNext:false}}}));
 await page.goto('/morning/plaza');
 const nodes=page.locator('.morning-plaza-card');
 await expect(nodes).toHaveCount(6);
 await expect(page.getByRole('searchbox',{name:'按兴趣标签搜索同行名片'})).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'同行名片分页'})).toHaveCount(0);
 await expect(page.getByText('今日展示 6 张同行名片。',{exact:true})).toBeVisible();
 await expect(page.locator('.morning-plaza-summary')).toContainText('这里每天只展示六张名片，次日重新抽取。珍惜与你同行的伙伴哦～');
 await expect(page.getByText('广场排序',{exact:true})).toHaveCount(0);
 await expect(page.getByText('这里每天只展示六张名片，次日重新抽取。珍惜与你同行的伙伴哦～',{exact:true})).toHaveCount(1);
 await expect(page.getByRole('searchbox',{name:'按兴趣标签搜索同行名片'})).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'同行名片分页'})).toHaveCount(0);
 await expect(page.getByText('今日展示 6 张同行名片。',{exact:true})).toBeVisible();
 await expect(nodes.first().locator('.morning-plaza-card__title p')).toHaveCount(0);
 await expect(nodes.first().locator('.morning-plaza-card__tags')).toContainText('女');
 await expect(nodes.first().locator('.morning-plaza-card__tags')).toContainText('模拟学院');
 await expect(nodes.first().locator('.morning-plaza-card__tags')).toContainText('2023级');
 await expect(nodes.first().locator('.morning-plaza-card__profile')).toContainText('摄影');
 const boxes=await nodes.evaluateAll(elements=>elements.map(element=>{
  const rect=element.getBoundingClientRect();
  return {top:Math.round(rect.top),left:Math.round(rect.left),height:Math.round(rect.height)};
 }));
 expect(new Set(boxes.map(box=>box.height)).size).toBe(1);
 expect(new Set(boxes.slice(0,3).map(box=>box.top)).size).toBe(1);
 expect(new Set(boxes.slice(3).map(box=>box.top)).size).toBe(1);
 expect(new Set(boxes.map(box=>box.left)).size).toBe(3);
 expect(boxes[0].top).toBeLessThan(boxes[3].top);
});
test('published members can withdraw using the shared management drawer',async({page})=>{
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{ok:true,tags:['摄影']}}));
 await page.route('**/api/morning/card',r=>r.fulfill({json:{ok:true,profile,card}}));
 await page.route('**/api/morning/cards/*/comments',r=>r.fulfill({json:{ok:true,comments:[]}}));
 await page.route('**/api/morning/card/withdraw',r=>r.fulfill({json:{ok:true,card:{...card,status:'已退出'}}}));
 await page.goto('/morning');await page.getByRole('button',{name:'编辑资料'}).click();
 await page.getByRole('button',{name:'退出计划',exact:true}).click();
 await page.getByRole('button',{name:'确认退出',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('已退出计划',{exact:true})).toBeVisible();
});
test('published card edits enter revision review without removing the live card',async({page})=>{
 let submitted;
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{ok:true,tags:['摄影']}}));
 await page.route('**/api/morning/card',r=>{
  if(r.request().method()==='POST'){
   submitted=r.request().postDataJSON();
   return r.fulfill({status:202,json:{ok:true,pendingReview:true,card,revision:{...card,nickname:submitted.nickname,status:'待审核'},message:'名片更新已提交管理员审核，通过后会更新广场展示。'}});
  }
  return r.fulfill({json:{ok:true,profile,card,revision:null}});
 });
 await page.goto('/morning');
 await page.getByRole('button',{name:'编辑资料'}).click();
 await page.getByLabel('昵称',{exact:false}).fill('更新后的同行');
 await page.getByText('我自愿报名，并接受管理员审核',{exact:true}).click();
 await page.getByRole('button',{name:'提交更新审核'}).click();
 await expect(page.getByText('名片更新已提交审核',{exact:true})).toBeVisible();
 await expect(page.getByText('审核期间广场继续展示原名片；审核通过后自动更新，无需退出计划。',{exact:true})).toBeVisible();
 expect(submitted.nickname).toBe('更新后的同行');
});
test('member centre exposes the editor inside the warmth tab',async({page})=>{
 await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{ok:true,birthday:{enabled:true,ready:true},morning:{enabled:true,ready:true}}}));
 await page.route('**/api/portal/me',r=>r.fulfill({json:{ok:true,enrollments:[],registrations:[],submissions:[]}}));
 await page.route('**/api/portal/workflow/me',r=>r.fulfill({json:{ok:true,registrations:[],ledger:[],profiles:[]}}));
 await page.route('**/api/public/warmth/blessings/**',r=>r.fulfill({json:{ok:true,blessings:[],stats:{limit:3}}}));
 await page.route('**/api/morning/card',r=>r.fulfill({json:{ok:true,profile,card,revision:null}}));
 await page.goto('/me');
 await page.getByRole('tab',{name:'温暖连接',exact:true}).click();
 await expect(page.getByRole('button',{name:'编辑同行名片',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'编辑同行名片',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'报名同行名片'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'报名同行名片'}).getByRole('button',{name:'提交更新审核'})).toBeVisible();
});
test('administrators review profile revisions in the card queue without a separate module',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/community/morning/cards*',r=>r.fulfill({json:{ok:true,cards:[],stats:{pending:0,published:0,returned:0,rejected:0,exited:0}}}));
 await page.route('**/api/community/morning/revisions*',r=>r.fulfill({json:{ok:true,revisions:[{id:'REV-ONE',cardId:'CARD-ONE',nickname:'整合名片',realName:'合成成员',version:1,status:'待审核',campus:'仙林',interestTags:['阅读'],submittedAt:'2026-10-24'}],stats:{pending:1}}}));
 await page.route('**/api/community/morning/invitations',r=>r.fulfill({json:{ok:true,invitations:[],stats:{}}}));
 await page.route('**/api/community/morning/members',r=>r.fulfill({json:{ok:true,members:[],stats:{}}}));
 await page.route('**/api/community/morning/blacklist*',r=>r.fulfill({json:{ok:true,entries:[],stats:{}}}));
 await page.goto('/console/community/morning');
 await expect(page.getByRole('radio',{name:'名片审核',exact:true})).toBeVisible();
 await expect(page.getByText('整合名片',{exact:true})).toBeVisible();
 await expect(page.getByRole('radio',{name:'资料更新',exact:true})).toHaveCount(0);
 await page.getByRole('radio',{name:'好友邀约',exact:true}).click();
 await page.getByRole('radio',{name:'成员管理',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('morning-admin.png'),fullPage:true,animations:'disabled'});
 expect(errors).toEqual([]);
});

test('member warmth panel lists saved morning cards with direct detail and remove actions',async({page})=>{
 let favorite=true;
 await page.route('**/api/public/warmth/capabilities',route=>route.fulfill({json:{birthday:{enabled:true,ready:true}}}));
 await page.route('**/api/auth/account',route=>route.fulfill({json:{account:{role:'member',realName:'合成成员',studentId:'999990009',email:'member@example.invalid',emailVerified:true,campus:'仙林',department:'模拟学院',grade:'2026'},profileMapping:{state:'已同步',options:{}}}}));
 await page.route('**/api/portal/me',route=>route.fulfill({json:{ok:true,account:{},registrations:[],submissions:[],enrollments:[]}}));
 await page.route('**/api/public/warmth/blessings/mine',route=>route.fulfill({json:{ok:true,blessings:[]}}));
 await page.route('**/api/public/warmth/blessings/delivered',route=>route.fulfill({json:{ok:true,blessings:[]}}));
 await page.route('**/api/morning/favorites**',route=>{
  if(route.request().method()==='DELETE')favorite=false;
  return route.fulfill({json:{ok:true,favorites:favorite?[{id:'saved-card',nickname:'心愿同行',campus:'仙林',gender:'女',interestTags:['阅读']}]:[]}});
 });
 await page.goto('/me');
 await page.getByRole('tab',{name:'温暖连接',exact:true}).click();
 const panel=page.locator('#morning-favorites');
 await expect(panel.getByRole('heading',{name:'我的名片心愿单',exact:true})).toBeVisible();
 await expect(panel.getByRole('link',{name:'查看',exact:true})).toHaveAttribute('href','/morning/plaza/saved-card');
 await expect(panel.getByRole('button',{name:'移出收藏',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'移出收藏',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'心愿单还是空的',exact:true})).toBeVisible();
});
