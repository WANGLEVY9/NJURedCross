import {test,expect} from '@playwright/test';

test('Chinese font roles load as real web fonts; English prefers Times New Roman',async({page},info)=>{
 await page.goto('/design/typography.html');
 await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('h1').first()).toHaveCSS('font-family',/Times New Roman.*NJU Heading/);
 await expect(page.locator('#information-sample')).toHaveCSS('font-family',/Times New Roman.*NJU Information/);
 await expect(page.locator('#annotation-sample')).toHaveCSS('font-family',/Times New Roman.*NJU Annotation/);
 const loaded=await page.evaluate(()=>Array.from(document.fonts).filter(f=>f.status==='loaded').map(f=>f.family));
 for(const family of ['NJU Heading','NJU Information','NJU Annotation'])expect(loaded.map(x=>x.replaceAll('"',''))).toContain(family);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('typography-roles.png'),fullPage:true});
});

test('unavailable images and fonts do not erase category symbols or block navigation',async({page})=>{
 await page.route(url => url.pathname.endsWith('.woff2'),route=>route.abort());
 await page.route('**/assets/activity-icons/**',route=>route.abort());
 await page.goto('/events');
 await expect(page.locator('svg.activity-emblem').first()).toBeVisible();
 expect(await page.locator('svg.activity-emblem').first().evaluate(el=>el.getBBox().width)).toBeGreaterThan(40);
 await expect(page.locator('.event-row__action').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
