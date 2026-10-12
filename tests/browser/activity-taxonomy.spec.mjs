import {test,expect} from '@playwright/test';

test('region, legacy category and status combine independently and survive reload',async({page},info)=>{
  const base={status:'报名中',startAt:'2026-10-29',endAt:'2026-10-30',remaining:30,capacity:30,location:'合成场地',campus:'仙林'};
  const events=[
    {...base,eventId:'nanjing-life',name:'南京生命活动',center:'生命类',region:'南京活动'},
    {...base,eventId:'suzhou-life',name:'苏州生命活动',center:'生命类',region:'苏州活动'},
    {...base,eventId:'nanjing-love',name:'南京博爱活动',type:'博爱中心'},
    {...base,eventId:'unclassified',name:'未分类活动',type:'志愿服务'},
  ];
  await page.route('**/api/public/events**',route=>route.fulfill({json:{events,facets:{campuses:['仙林']}}}));
  await page.goto('/events?region=nanjing&kind=生命中心&status=报名中');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'南京生命活动',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'活动类别',exact:true}).click();
  for(const name of ['苏州分部','主席团','一加助残','博爱中心','生命中心','综事中心','未分类'])
    await expect(page.getByRole('option',{name,exact:true})).toBeVisible();
  await page.getByRole('option',{name:'博爱中心',exact:true}).click();
  await expect(page.getByRole('heading',{name:'南京博爱活动',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'南京博爱活动',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'清除类别：博爱中心',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'活动类别',exact:true})).toBeFocused();
  await expect(page.locator('.event-row')).toHaveCount(3);
  await page.getByRole('radiogroup',{name:'按地区筛选'}).getByRole('radio',{name:'苏州地区',exact:true}).click();
  await expect(page.getByRole('heading',{name:'苏州生命活动',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重置全部',exact:true}).click();
  await expect(page.locator('.event-row')).toHaveCount(4);
  await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('activity-taxonomy.png'),fullPage:true,animations:'disabled'});
});
