import {test,expect} from '@playwright/test';

test('read-only draft remains scrollable with disabled fields and visible recovery action',async({page},info)=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');await expect(page.locator('.activity-v2-card').first()).toBeVisible();await page.waitForLoadState('networkidle');
 await page.evaluate(async()=>{
  const {h}=await import('/app/core/dom.js');
  const {activityDraftWorkspace}=await import('/app/console/pages/activity-draft-workspace.js');
  const ui=activityDraftWorkspace({initial:{id:'synthetic-readonly',version:1,content:{name:'合成只读草稿',region:'nanjing',category:'一加助残专项',bookingMode:'unified',description:'合成只读说明',notice:'合成通知\n'.repeat(100)}},editable:false,actionsNode:h('details',{class:'activity-v2-more'},h('summary',{text:'更多操作'}),h('button',{disabled:true,text:'删除活动'})),preview:async()=>({content:{},errors:[]})});
  const recovery=h('button',{class:'btn',text:'核对提交结果',on:{click:()=>{recovery.dataset.checked='true';}}});ui.node.querySelector('.activity-draft-toolbar').append(recovery);
  document.getElementById('main').replaceChildren(h('div',{class:'view wspad activity-v2',data:{mobileView:'detail'}},h('div',{class:'activity-v2-workspace'},h('section',{class:'activity-v2-detail'},ui.node))));
 });
 const form=page.locator('.activity-draft-workspace__form');
 await expect(page.getByLabel('活动名称',{exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
 const recovery=page.getByRole('button',{name:'核对提交结果',exact:true});await expect(recovery).toBeInViewport();await recovery.click();await expect(recovery).toHaveAttribute('data-checked','true');
 const target=page.viewportSize().width<=800?page.locator('.activity-v2-detail'):form;
 if(info.project.name.includes('mobile')){
  const box=await form.boundingBox(),cdp=await page.context().newCDPSession(page),x=180,y=Math.min(650,box.y+150);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*20}]});await page.waitForTimeout(18);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else{await form.hover({position:{x:100,y:100}});await page.mouse.wheel(0,500);}
 await expect.poll(()=>target.evaluate(n=>n.scrollTop)).toBeGreaterThan(50);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('readonly-scroll.png')});
});
