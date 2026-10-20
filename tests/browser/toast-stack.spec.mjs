import {test,expect} from '@playwright/test';

test('rapid animated notifications evict active items without blocking the browser',async({page})=>{
 await page.goto('/login');
 await page.evaluate(async()=>{
  document.documentElement.dataset.motion='full';
  const {toast}=await import('/app/core/toast.js');
  for(let index=0;index<12;index++)toast({title:`合成连续通知${index}`,duration:null});
 });
 await expect(page.locator('#toast-root .toast:not([data-closing="true"])')).toHaveCount(4);
 await expect(page.locator('#toast-root .toast')).toHaveCount(4);
 await expect(page.locator('#toast-root')).toContainText('合成连续通知11');
 await page.getByRole('button',{name:'关闭通知',exact:true}).first().click();
 await expect(page.locator('#toast-root .toast:not([data-closing="true"])')).toHaveCount(3);
});

test('deduplicating a full toast stack does not evict additional active notifications',async({page})=>{
 await page.goto('/login');
 await page.evaluate(async()=>{
  const {toast}=await import('/app/core/toast.js');
  for(let index=0;index<4;index++)toast({title:`合成堆栈${index}`,duration:null});
  toast({title:'合成堆栈1',description:'合成更新说明',duration:null});
 });
 await expect(page.locator('#toast-root .toast:not([data-closing="true"])')).toHaveCount(4);
 await expect(page.locator('#toast-root .toast')).toHaveCount(4);
 await expect(page.locator('#toast-root')).toContainText('合成堆栈0');
 await expect(page.locator('#toast-root')).toContainText('合成更新说明');
});
