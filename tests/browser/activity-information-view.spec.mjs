import {test,expect} from '@playwright/test';

test('read-only activity information shows names and compact sections',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const headers={'x-csrf-token':'synthetic-ui'};
 const created=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成只读信息抽屉',date:'2026-10-04',slot:'上午',position:'现场服务岗',capacity:3,serviceHours:2,location:'合成测试地点',work:'协助现场引导与签到核验',submit:false}});
 expect(created.ok()).toBe(true);
 const event=(await created.json()).result;
 await page.goto(`/console/events?legacy=1&event=${event._id}`);
 await page.getByRole('button',{name:'活动信息查看',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'活动信息查看',exact:true});
 await expect(dialog.locator('.activity-info-summary')).toBeVisible();
 await expect(dialog.locator('.activity-info-fact')).toHaveCount(7);
 const facts=Object.fromEntries(await dialog.locator('.activity-info-fact').evaluateAll(nodes=>nodes.map(node=>[
  node.querySelector('dt')?.textContent||'',node.querySelector('dd')?.textContent||'',
 ])));
 expect(facts['负责人']).toMatch(/^[\u4e00-\u9fa5·]+$/);
 expect(facts['审批人']).toBe('尚未通过审批');
 expect(facts['审批版本']).toBe('—');
 await expect(dialog.locator('.activity-info-section__title')).toHaveText(['场次安排','报名通知']);
 const text=await dialog.innerText();
 expect(text).not.toContain('synthetic-organizer');
 expect(text).not.toContain('synthetic-reviewer');
 expect(text).not.toContain('ACC-');
 expect(await dialog.locator('.activity-info-fact dt').allTextContents()).not.toContain('活动名称');
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});
