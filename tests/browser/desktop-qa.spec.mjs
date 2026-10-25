import {test,expect} from '@playwright/test';
import axe from 'axe-core';
import {mkdir,writeFile} from 'node:fs/promises';
const routes=[['home','/'],['events','/events'],['calendar','/workflow-events?type=blood&week=2026-10-12'],['outreach','/outreach'],['community','/community'],['materials','/materials'],['about','/about'],['status','/status'],['login','/login'],['register','/register'],['reset','/reset-password'],['verify','/verify-email'],['submit','/submit'],['morning','/morning'],['morning-plaza','/morning/plaza'],['morning-comments','/morning/comments'],['member','/me'],['password','/change-password'],['ordinary','/events/qa-event'],['morning-detail','/morning/plaza/qa-card']];
const themes=['dawn','sail','garden','iris','amber'];
for(const [name,url]of routes)test(`P11 ${name}: desktop themes, landmarks and accessibility`,async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');test.setTimeout(180000);
 await page.request.post('/api/auth/logout');
 if(['member','password','morning','morning-plaza','morning-comments','morning-detail'].includes(name))await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 const account={role:'student',accountId:'synthetic-qa',realName:'合成测试同学',studentId:'999990001',email:'qa@example.invalid',emailVerified:true,campus:'仙林',department:'合成院系',grade:'2026',missing:[]};
 await page.route('**/api/auth/account',r=>r.fulfill({json:{account,profileMapping:{state:'已同步'}}}));
 await page.route('**/api/portal/me',r=>r.fulfill({json:{account,registrations:[],submissions:[],enrollments:[]}}));
 await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:false,ready:false}}}));
 await page.route('**/api/morning/tags',r=>r.fulfill({json:{tags:['摄影','阅读']}}));
 await page.route('**/api/morning/card',r=>r.fulfill({json:{profile:account,card:null}}));
 const card={id:'qa-card',nickname:'合成同行',campus:'仙林',interestTags:['阅读'],note:'仅供界面验收',notePreview:'仅供界面验收',commentCount:0,status:'已发布'};
 await page.route('**/api/morning/cards**',r=>r.fulfill({json:r.request().url().includes('qa-card')?{card,comments:[],canComment:true}:{cards:[card],stats:{page:1,totalPages:1,total:1}}}));
 await page.route('**/api/public/events/qa-event',r=>r.fulfill({json:{event:{eventId:'qa-event',name:'合成测试：校园急救与志愿服务工作坊',type:'急救培训',status:'报名中',description:'仅用于隔离环境的界面回归，不是真实活动。',location:'合成教学楼',startAt:'2026-10-12T10:00:00+08:00',endAt:'2026-10-12T14:00:00+08:00',capacity:20,confirmed:3,remaining:17,open:true,sessions:[{sessionId:'qa-session',startAt:'2026-10-12T10:00:00+08:00',endAt:'2026-10-12T14:00:00+08:00',capacity:20,remaining:17,full:false}]}}}));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(url);await expect(page.locator('#main')).toBeVisible();await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
 const results=[];
 for(const theme of themes){
  await page.evaluate(async t=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal',t);await document.fonts.ready;},theme);
  for(const width of[1280,1440,1920]){
   await page.setViewportSize({width,height:width===1920?1080:900});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   let violations=[];
   if(width===1440){await page.evaluate(axe.source);violations=await page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});}
   results.push({name,url:page.url(),theme,width,overflow,violations});
   if(process.env.P11_CAPTURE){await mkdir(process.env.P11_CAPTURE,{recursive:true});await page.screenshot({path:`${process.env.P11_CAPTURE}/${name}-${theme}-${width}.png`,fullPage:true,animations:'disabled'});}
  }
 }
 await writeFile(info.outputPath('audit.json'),JSON.stringify(results,null,2));
 if(process.env.P11_CAPTURE)await writeFile(`${process.env.P11_CAPTURE}/${name}.json`,JSON.stringify(results,null,2));
 expect(results.filter(r=>r.overflow||r.violations.length)).toEqual([]);
});
