import {test,expect} from '@playwright/test';

test('activity directory defaults to unfinished activities and keeps ended activities available',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const catalog=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const ended=catalog.find(event=>event['状态']==='已结束'&&!(JSON.parse(event['报名页配置']||'{}').special?.dates));
 await page.goto('/console/events');
 await expect(page.locator('#boot-screen')).toHaveCount(0);
 const stages=page.getByRole('radiogroup',{name:'活动阶段筛选'});
 await expect(stages.getByRole('radio',{name:'未结束',exact:true})).toHaveAttribute('aria-checked','true');
 const labels=await stages.locator('button').allTextContents();
 expect(labels).toEqual(['未结束','进行中','草稿','待审批','报名中','时长审核','已结束','全部']);
 for(const label of labels)expect(label).toBe(label.trim());
 await expect(stages.getByRole('radio',{name:'进行中',exact:true})).toBeVisible();
 await expect(stages.getByRole('radio',{name:'已结束',exact:true})).toBeVisible();
 await expect(stages.getByRole('radio',{name:'全部',exact:true})).toBeVisible();
 if(ended){
  await expect(page.locator(`.activity-v2-card[data-record="${ended._id}"]`)).toHaveCount(0);
 }
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
 const footer=page.locator('.activity-v2-card').first().locator('.activity-v2-card__footer');
 const geometry=await footer.evaluate(node=>{
  const facts=node.querySelector('.activity-v2-card__facts').getBoundingClientRect();
  const entry=node.querySelector('.activity-v2-card__entry').getBoundingClientRect();
  return {gap:entry.left-facts.right,overflow:node.scrollWidth>node.clientWidth+1};
 });
 expect(geometry.gap).toBeGreaterThanOrEqual(0);
 expect(geometry.overflow).toBe(false);
 await page.screenshot({path:info.outputPath('unfinished-default.png'),animations:'disabled'});
 if(ended){
  await stages.getByRole('radio',{name:'已结束',exact:true}).click();
  await expect(page.locator(`.activity-v2-card[data-record="${ended._id}"]`)).toBeVisible();
 }
 await stages.getByRole('radio',{name:'全部',exact:true}).click();
 await expect(page.locator('.activity-v2-card').first()).toBeVisible();
});
