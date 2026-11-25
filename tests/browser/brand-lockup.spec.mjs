import {test,expect} from '@playwright/test';

async function brandGeometry(page,selector){
 const node=page.locator(selector).first();
 await expect(node).toBeVisible();
 return node.evaluate(el=>{
  const cn=el.querySelector('.brand-lockup__cn'),en=el.querySelector('.brand-lockup__en');
  const cnStyle=getComputedStyle(cn),enStyle=getComputedStyle(en);
  return {cn:cn.textContent,en:en.textContent,enFont:enStyle.fontFamily,enSize:Number.parseFloat(enStyle.fontSize),cnSize:Number.parseFloat(cnStyle.fontSize),overflow:el.scrollWidth>el.clientWidth+1};
 });
}

test('portal, console and sign-in pages share one brand lockup',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/');await expect(page.locator('#boot-screen')).toHaveCount(0);
 const portal=await brandGeometry(page,'.phead .brand-lockup');
 expect(portal).toMatchObject({cn:'南京大学红十字会',en:'NJU Red Cross',overflow:false});
 expect(portal.enFont).toMatch(/Helvetica|Arial/);
 expect(portal.enSize).toBeGreaterThanOrEqual(9);
 expect(portal.enSize).toBeLessThan(portal.cnSize);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/overview');await expect(page.locator('#boot-screen')).toHaveCount(0);
 const consoleBrand=await brandGeometry(page,'.nav__brand .brand-lockup');
 expect(consoleBrand).toMatchObject({cn:'南京大学红十字会',en:'NJU Red Cross',overflow:false});
 expect(consoleBrand.enFont).toMatch(/Helvetica|Arial/);
 expect(consoleBrand.enSize).toBeLessThan(consoleBrand.cnSize);
});

test('phone brand stays legible and does not overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');await expect(page.locator('#boot-screen')).toHaveCount(0);
 const mobile=await brandGeometry(page,'.phead .brand-lockup');
 expect(mobile).toMatchObject({cn:'南京大学红十字会',en:'NJU Red Cross',overflow:false});
 expect(mobile.enSize).toBeGreaterThanOrEqual(8);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
