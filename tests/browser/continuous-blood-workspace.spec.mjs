import {test,expect} from '@playwright/test';

test('generated monthly schedule keeps registration, partial input and review accessible together',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>JSON.parse(row['报名页配置']||'{}').source?.kind==='generated_blood');
 expect(event).toBeTruthy();
 await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.getByRole('button',{name:'报名审核与通知',exact:true})).toBeVisible();
 await pane.getByRole('button',{name:'排班来源与模板',exact:true}).click();
 const template=page.getByRole('dialog',{name:'排班来源与模板',exact:true});
 await expect(template).toContainText('无需用“新建活动”或“来源活动纳入”重复导入');
 await expect(template).toContainText('新街口中央');
 await template.getByRole('contentinfo').getByRole('button',{name:'关闭',exact:true}).click();
 await pane.getByRole('button',{name:'签到与分批录入',exact:true}).click();
 await expect(pane.getByRole('region',{name:'签到核验与时长录入'})).toBeVisible();
 await expect(pane).toContainText('可分批录入、分批审核和导出');
 await pane.getByRole('button',{name:'时长审核与导出',exact:true}).click();
 await expect(pane.locator('.service-workspace')).toBeVisible();
 await expect(pane.getByRole('button',{name:'时长审核与导出',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.reload();
 await expect(pane.getByRole('button',{name:'时长审核与导出',exact:true})).toHaveAttribute('aria-pressed','true');
 await pane.getByRole('button',{name:'报名审核与通知',exact:true}).click();
 await expect(pane.locator('.activity-legacy-roster')).toBeVisible();
 await expect(pane.getByRole('button',{name:'管理负责人',exact:true})).toHaveCount(0);
});

test('ordinary activities retain stage controls without parallel scheduling tools',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const events=(await (await page.request.get('/api/volunteer/workflow/catalog')).json()).events;
 const event=events.find(row=>!JSON.parse(row['报名页配置']||'{}').source?.kind&&!JSON.parse(row['报名页配置']||'{}').workspaceSubmission);
 expect(event).toBeTruthy();await page.goto(`/console/events?event=${event._id}`);
 const pane=page.getByRole('region',{name:'活动操作工作区'});
 await expect(pane.locator('.activity-legacy-workspace')).toBeVisible();
 await expect(pane.getByRole('button',{name:'报名审核与通知',exact:true})).toHaveCount(0);
 await expect(pane.getByRole('button',{name:'排班来源与模板',exact:true})).toHaveCount(0);
});
