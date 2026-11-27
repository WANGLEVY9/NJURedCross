import {test,expect} from '@playwright/test';

// 广场上的值班卡是整组聚合的一张卡：名额升级后，组里仍挂着升级前冻结的旧周次
// （容量 1，已截止但组已发布所以还在列表里）。卡片必须按**最新一班**说「每班 2 人」，
// 不能沿用写死的 1 人，也不能把整组求和后的 62 当成每班人数。
const duty={
 eventId:'workflow:duty-group',name:'省红会组宣部值班',status:'报名中',statusLabel:'剩余 51 个名额',
 center:'排班专项',region:'南京地区',campus:'',location:'省红会组宣部',
 recurringDuty:true,longTerm:true,registrationOpen:true,
 capacity:62,remaining:51,confirmed:11,pending:0,full:false,
 startAt:'2026-11-16T09:00:00+08:00',endAt:'2026-12-11T17:00:00+08:00',
 sessions:[
  {sessionId:'old-1',startAt:'2026-11-16T09:00:00+08:00',endAt:'2026-11-16T12:00:00+08:00',location:'省红会组宣部',capacity:1,remaining:1,full:false},
  {sessionId:'old-2',startAt:'2026-11-16T14:00:00+08:00',endAt:'2026-11-16T17:00:00+08:00',location:'省红会组宣部',capacity:1,remaining:1,full:false},
  {sessionId:'new-1',startAt:'2026-12-11T14:00:00+08:00',endAt:'2026-12-11T17:00:00+08:00',location:'省红会组宣部',capacity:2,remaining:2,full:false},
 ],
};

test('duty card states the newest session capacity, not the frozen one',async({page})=>{
 await page.route('**/api/public/events**',route=>route.fulfill({json:{events:[duty],facets:{campuses:[],categories:['排班专项']}}}));
 await page.goto('/events');
 const card=page.locator('.event-row').filter({hasText:'省红会组宣部值班'});
 await expect(card).toHaveCount(1);
 await expect(card.getByText('每日两班 · 每班2人')).toBeVisible();
 await expect(card.getByText('每班1人')).toHaveCount(0);
});
