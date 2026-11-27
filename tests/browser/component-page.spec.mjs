import {test,expect} from '@playwright/test';
import {openComponentPage} from './component-page.mjs';

for(const authenticated of [false,true])test(`component host preserves ${authenticated?'signed-in':'anonymous'} session and leaves real login routing intact`,async({page})=>{
 if(authenticated)await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 else await page.request.post('/api/auth/logout');
 const before=await(await page.request.get('/api/auth/session')).json();
 await openComponentPage(page);
 await page.evaluate(async()=>{
  const {field}=await import('/app/ui/primitives.js');
  const {enhanceDateTimeField}=await import('/app/ui/date-time-picker.js');
  document.getElementById('main').append(enhanceDateTimeField(field({label:'合成组件时间',type:'datetime-local',value:'2030-12-02T09:00'})));
 });
 await page.getByRole('button',{name:'选择日期与时间',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'选择日期与时间',exact:true})).toBeVisible();
 expect(new URL(page.url()).pathname).toBe('/login');
 const after=await(await page.request.get('/api/auth/session')).json();
 expect(after.user?.username).toBe(before.user?.username);
 await page.unroute('**/app/main.js*');
 await page.goto('/login');
 if(authenticated)await expect(page.locator('.operations-overview')).toBeVisible();
 else await expect(page.getByRole('dialog',{name:'首次登录请注册',exact:true})).toBeVisible();
});
