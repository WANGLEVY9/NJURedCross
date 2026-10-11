import {test,expect} from '@playwright/test';
for(const [url,scene]of[['/','home'],['/events','directory'],['/outreach','editorial'],['/community','letter'],['/me','workspace'],['/workflow-events?type=blood','calendar']])test(`page art ${scene} stays local and inert`,async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
 await page.route('**/api/portal/me',r=>r.fulfill({json:{registrations:[],submissions:[],enrollments:[]}}));
 await page.goto(url);
 const art=page.locator(scene==='home'?'.home-paper':'.page-art');await expect(art).toHaveCount(1);
 await expect(art).toHaveAttribute('aria-hidden','true');await expect(art).toHaveCSS('pointer-events','none');
 await expect(page.locator(`[data-art-scene="${scene}"]`)).toHaveCount(1);
 for(const theme of['dawn','sail','garden','iris','amber']){
  await page.evaluate(async t=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal',t);},theme);
  for(const [width,height]of[[1280,800],[1440,900],[1920,1080],[2048,988]]){
   await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  if(!['home','workspace','calendar'].includes(scene))await expect(art.locator('svg:visible')).toHaveCount(1);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await expect(art).toHaveCSS('animation-name','none');
 await page.emulateMedia({forcedColors:'active'});await expect(art).toBeHidden();
});
