import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const themes=['dawn','sail','garden','iris','amber'];
const routes=[['home','/'],['events','/events'],['calendar','/workflow-events?type=blood&week=2026-10-12'],['community','/community']];
test('art profiles retain contrast, bounded decoration and real route layouts',async({page},info)=>{
 test.skip(info.project.name!=='desktop-chromium');test.setTimeout(120000);
 await page.request.post('/api/auth/logout');await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
 const report=[];
 for(const theme of themes)for(const width of [1440,1920])for(const [name,url]of routes){
  await page.setViewportSize({width,height:width===1440?900:1080});await page.goto(url);
  await page.evaluate(async theme=>{const{selectTheme}=await import('/app/core/themes.js');selectTheme('portal',theme);await document.fonts.ready;},theme);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const colors=await page.evaluate(()=>{
   const s=getComputedStyle(document.documentElement);
   const rgb=value=>{const n=document.createElement('i');n.style.color=value;document.body.append(n);const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(n).color;ctx.fillRect(0,0,1,1);n.remove();return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
   const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const ratio=(a,b)=>{const x=lum(rgb(s.getPropertyValue(a))),y=lum(rgb(s.getPropertyValue(b)));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
   return {text:ratio('--text-secondary','--canvas-base'),hero:ratio('--hero-ink','--hero-base'),button:ratio('--text-on-accent','--accent'),surface:ratio('--text-primary','--canvas-raised')};
  });
  for(const value of Object.values(colors))expect(value).toBeGreaterThanOrEqual(4.5);
  report.push({name,width,theme,...colors});
  if(process.env.ART_CAPTURE){await mkdir(process.env.ART_CAPTURE,{recursive:true});await page.screenshot({path:`${process.env.ART_CAPTURE}/${name}-${theme}-${width}.png`,fullPage:true});}
 }
 if(process.env.ART_CAPTURE)await writeFile(`${process.env.ART_CAPTURE}/contrast.json`,JSON.stringify(report,null,2));
 await page.emulateMedia({forcedColors:'active'});await page.goto('/');
 expect(await page.locator('.portal').evaluate(e=>getComputedStyle(e).backgroundImage)).toBe('none');
});
test('appearance previews keep selected calendar context and independent preferences',async({page})=>{
 await page.goto('/workflow-events?type=blood&week=2026-10-12');
 await page.getByRole('radio',{name:'仙林学则路',exact:true}).click();
 await page.getByRole('button',{name:'外观主题',exact:true}).click();
 for(const theme of themes){
  await page.locator(`.theme-choice input[value="${theme}"]`).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
 }
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await expect(page.getByRole('radio',{name:'仙林学则路',exact:true})).toHaveAttribute('aria-checked','true');
 await page.evaluate(async()=>{const {selectTheme}=await import('/app/core/themes.js');selectTheme('console','blueprint');});
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','amber');
});
test('font failures keep first paint stable and content readable',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{window.artCLS=0;new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.artCLS+=entry.value;}).observe({type:'layout-shift',buffered:true});});
 await page.route('**/*.woff2',r=>r.abort());await page.goto('/');
 await expect(page.locator('.hero__lede h1')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 await expect(page.getByRole('link',{name:'浏览开放活动',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await page.evaluate(()=>window.artCLS)).toBeLessThan(.1);
});
