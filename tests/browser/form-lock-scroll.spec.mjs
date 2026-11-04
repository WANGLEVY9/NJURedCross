import {test,expect} from '@playwright/test';

test('shared form lock preserves scroll, disables late controls and restores permission restrictions',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async()=>{
  const {h}=await import('/app/core/dom.js');const {setFormControlsLocked}=await import('/app/ui/form-lock.js');
  const content=h('div',{class:'activity-draft-workspace__form'},h('input',{'aria-label':'原本可编辑',value:'保留内容'}),h('input',{'aria-label':'原本无权限',disabled:true}),...Array.from({length:60},(_,i)=>h('p',{text:`合成只读说明 ${i}`})));
  const root=h('div',{class:'activity-draft-workspace'},content);document.getElementById('main').replaceChildren(root);
  setFormControlsLocked(content,true);content.append(h('button',{text:'异步新增控件'}));
  window.unlockSyntheticForm=()=>setFormControlsLocked(content,false);
 });
 const form=page.locator('.activity-draft-workspace__form');
 await expect(page.getByLabel('原本可编辑')).toBeDisabled();await expect(page.getByRole('button',{name:'异步新增控件'})).toBeDisabled();
 await form.hover({position:{x:100,y:100}});await page.mouse.wheel(0,450);await expect.poll(()=>form.evaluate(n=>n.scrollTop)).toBeGreaterThan(50);
 await page.evaluate(()=>window.unlockSyntheticForm());await expect(page.getByLabel('原本可编辑')).toBeEnabled();await expect(page.getByLabel('原本可编辑')).toHaveValue('保留内容');await expect(page.getByLabel('原本无权限')).toBeDisabled();await expect(page.getByRole('button',{name:'异步新增控件'})).toBeEnabled();
});
