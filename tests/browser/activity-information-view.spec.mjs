import {test,expect} from '@playwright/test';

test('read-only activity information shows names and compact sections',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const catalog=await (await page.request.get('/api/volunteer/workflow/catalog')).json();
 const event=catalog.events.find(row=>row['状态']==='已归档'||row['状态']==='已结束')||catalog.events[0];
 await page.goto(`/console/events?event=${event._id}`);
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动信息查看',exact:true});
 await expect(dialog.locator('.activity-info-summary')).toBeVisible();
 await expect(dialog.locator('.activity-info-fact')).toHaveCount(7);
 const facts=Object.fromEntries(await dialog.locator('.activity-info-fact').evaluateAll(nodes=>nodes.map(node=>[
  node.querySelector('dt')?.textContent||'',node.querySelector('dd')?.textContent||'',
 ])));
 expect(facts['负责人']).toBe('模拟负责人');
 expect(facts['审批人']).toBe('模拟博爱主席');
 await expect(dialog.locator('.activity-info-section__title')).toHaveText(['场次安排','报名通知']);
 const text=await dialog.innerText();
 expect(text).not.toContain('synthetic-organizer');
 expect(text).not.toContain('synthetic-reviewer');
 expect(text).not.toContain('ACC-');
 expect(await dialog.locator('.activity-info-fact dt').allTextContents()).not.toContain('活动名称');
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});
