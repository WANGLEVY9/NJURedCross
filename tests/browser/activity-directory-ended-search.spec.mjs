import {test,expect} from '@playwright/test';

const base=(id,name,status)=>({_id:id,活动ID:id,活动名称:name,状态:status,组织类别:'生命中心',活动地区:'南京地区',报名日期:'2026-11-22',报名时段:'14:00-16:00',报名页配置:'{}'});

test('all stages search includes ended activities while history remains ended-only',async({page})=>{
 const events=[
  base('ended-challenge','11.22 校园防艾闯关赛','已结束'),
  base('pending-transport','11.22 校园防艾闯关赛物资搬运','待审核'),
 ];
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:[],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,canCreate:true,canSubmit:true,rosterAvailable:true}}}));
 await page.goto('/console/events');
 await page.getByRole('radiogroup',{name:'活动阶段筛选'}).getByRole('radio',{name:'全部',exact:true}).click();
 await page.getByLabel('搜索活动',{exact:true}).fill('校园防艾闯关赛');
 await expect(page.locator('.activity-v2-card')).toHaveCount(2);
 await expect(page.locator('.activity-v2-card').filter({hasText:'11.22 校园防艾闯关赛物资搬运'})).toBeVisible();
 await expect(page.locator('.activity-v2-card').filter({hasText:'已结束'})).toBeVisible();
 await page.goto('/console/events?history=1');
 await expect(page.getByRole('radiogroup',{name:'活动阶段筛选'}).getByRole('radio',{name:'已结束',exact:true})).toHaveAttribute('aria-checked','true');
 await page.getByLabel('搜索活动',{exact:true}).fill('校园防艾闯关赛');
 await expect(page.locator('.activity-v2-card')).toHaveCount(1);
 await expect(page.locator('.activity-v2-card').filter({hasText:'11.22 校园防艾闯关赛物资搬运'})).toHaveCount(0);
});
