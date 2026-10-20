import {test,expect} from '@playwright/test';

for(const path of ['/','/events','/about'])test(`public first paint on ${path} does not wait for session`,async({page})=>{
 let release,reads=0;
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/auth/session',async route=>{reads++;await gate;await route.fulfill({json:{ok:true,authenticated:false}});});
 try{
  await page.goto(path,{waitUntil:'domcontentloaded'});
  await expect(page.locator('#main h1').first()).toBeVisible({timeout:2000});
  await expect(page.locator('[data-booting="true"]')).toHaveCount(0);
  expect(reads).toBe(1);
 }finally{release();}
});

test('protected entry waits for session and reuses anonymous result on login redirect',async({page})=>{
 let release,reads=0;const privateReads=[];
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/auth/session',async route=>{reads++;await gate;await route.fulfill({json:{ok:true,authenticated:false}});});
 page.on('request',request=>{if(request.url().includes('/api/volunteer/'))privateReads.push(request.url());});
 try{
  await page.goto('/console/events',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#root[data-booting="true"]')).toBeVisible();
  await expect(page.locator('.activity-center')).toHaveCount(0);
  expect(privateReads).toEqual([]);
  release();
  await expect(page).toHaveURL(/\/console\/login\?next=/);
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  expect(reads).toBe(1);
 }finally{release();}
});

test('missing page module shows recoverable error instead of an empty outlet',async({page})=>{
 await page.route('**/app/portal/pages/about.js',route=>route.abort('failed'));
 await page.goto('/about',{waitUntil:'domcontentloaded'});
 await expect(page.getByText('页面资源加载失败',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'重新加载',exact:true})).toBeVisible();
});
