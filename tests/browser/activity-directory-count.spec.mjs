import {test,expect} from '@playwright/test';

for(const count of [1,2,16])test(`directory shows ${count} configured positions without counting the parent`,async({page},info)=>{
 const groupId=`synthetic-count-${count}`,parentId=`${groupId}-parent`;
 const row=(id,config)=>({_id:id,活动ID:id,活动名称:`岗位计数演示（合成）`,状态:'报名中',组织类别:'生命中心',活动地区:'南京地区',报名日期:'2030-10-29',报名时段:'09:00-11:00',readOnly:true,报名页配置:JSON.stringify(config)});
 const children=Array.from({length:count},(_,i)=>row(`${groupId}-position-${i}`,{ordinary:{groupId},parentActivityId:parentId}));
 const parent=row(parentId,{positionPlan:{groupId,positions:children.map((child,i)=>({name:`岗位 ${i+1}`})),eventIds:children.map(child=>child['活动ID'])}});
 // A removed historical position remains in the catalogue and must not inflate the current plan.
 const removed={...row(`${groupId}-removed`,{ordinary:{groupId},parentActivityId:parentId}),状态:'已结束'};
 const legacy=Array.from({length:2},(_,i)=>({...row(`legacy-${count}-${i}`,{ordinary:{groupId:`legacy-${count}`}}),活动名称:'历史多场次活动（合成）'}));
 const events=[parent,...children,...(count===16?[removed]:[]),...legacy];
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts:[],capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,canCreate:true,canSubmit:true,rosterAvailable:true}}}));
 await page.route('**/api/volunteer/workflow/events/*/information',route=>route.fulfill({json:{ok:true,events:[parent,...children]}}));
 await page.goto('/console/events');
 const cards=page.locator('.activity-v2-card'),card=page.locator(`.activity-v2-card[data-record="${parentId}"]`);
 await expect(cards).toHaveCount(2);
 await expect(card).toHaveAttribute('data-sessions',String(count));
 if(count>1)await expect(card.locator('small')).toHaveText(`${count} 个场次`);
 else await expect(card.locator('small')).toHaveCount(0);
 await expect(cards.filter({hasText:'历史多场次活动（合成）'}).locator('small')).toHaveText('2 个场次');
 await page.screenshot({path:info.outputPath(`positions-${count}.png`),animations:'disabled'});
 // Counting must not remove child identities used to resolve links to a project.
 await page.goto(`/console/events?event=${children.at(-1)._id}`);
 await expect(page.locator('.activity-v2-heading h2')).toHaveText('岗位计数演示（合成）');
 await expect(page).toHaveURL(new RegExp(`event=${parentId}`));
});
