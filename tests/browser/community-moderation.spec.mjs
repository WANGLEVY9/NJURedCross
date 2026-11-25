import {test,expect} from '@playwright/test';

test('the review entry switches between submissions and reports, including unpublished content',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'preview-admin'}});
 await page.route('**/api/public/warmth/capabilities',route=>route.fulfill({json:{birthday:{enabled:true,ready:true}}}));
 await page.route('**/api/community/moderation?source=submission*',route=>route.fulfill({json:{
  submissions:[{id:'CARE-pending',status:'待审核',content:'合成未发布投稿',nickname:'合成昵称',blockedByReport:true}],stats:{total:1,pending:1},
 }}));
 await page.route('**/api/community/moderation?source=report',route=>route.fulfill({json:{
  reports:[{id:'RPT-1',submissionId:'CARE-pending',status:'待处理',content:'合成未发布投稿',reason:'合成举报理由',blessingStatus:'待审核'}],
  stats:{total:1,pending:1,handled:0,dismissed:0},
 }}));
 await page.goto('/console/community/birthday?tab=submissions');
 await page.waitForLoadState('networkidle');
 const sources=page.getByRole('radiogroup',{name:'审核来源'});
 await expect(sources.getByRole('radio',{name:'投稿审核'})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('button',{name:'通过投稿 CARE-pending'})).toHaveCount(0);
 await page.getByText('合成未发布投稿',{exact:true}).click();
 await expect(page.getByRole('button',{name:'举报此投稿'})).toBeVisible();
 await expect(page.getByText('此投稿有待处理或已受理的举报，处理举报后才能通过审核。',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await sources.getByRole('radio',{name:'举报处理'}).click();
 await page.getByRole('button',{name:'处理',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('合成举报理由',{exact:true})).toBeVisible();
 await page.reload();
 await expect(sources.getByRole('radio',{name:'举报处理'})).toHaveAttribute('aria-checked','true');
});
