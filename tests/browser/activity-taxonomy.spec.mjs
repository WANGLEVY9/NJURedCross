import {test,expect} from '@playwright/test';

test('six organization cards retain the same facts and navigation at desktop and mobile sizes',async({page},info)=>{
 const categories=['主席团专项','博爱中心','生命中心','综事中心','一加助残专项','献血车专项'];
 const events=categories.map((center,i)=>({eventId:`synthetic-category-${i}`,name:`${center}合成活动`,center,status:'报名中',startAt:'2030-10-29',endAt:'2030-10-30',remaining:10,capacity:10,location:'合成服务地点',region:'南京活动'}));
 await page.route('**/api/public/events**',route=>route.fulfill({json:{events,facets:{campuses:[]}}}));
 for(const width of info.project.name==='desktop-chromium'?[1440,1920]:[390]){
  await page.setViewportSize({width,height:width===1920?1080:900});
  await page.goto('/events');
  await expect(page.locator('.event-row')).toHaveCount(6);
  const artwork=await page.request.get('/assets/activity-icons/centres.png');
  expect(artwork.ok()).toBe(true);
  expect(artwork.headers()['content-type']).toContain('image/png');
  for(const [i,category] of categories.entries()){
   const card=page.locator(`.event-row[data-category="${category}"]`);
   await expect(card.locator('.activity-emblem')).toHaveCount(1);
   const iconFile={'主席团专项':'presidium.svg','生命中心':'life.svg'}[category]||'centres.png';
   await expect(card.locator('.activity-emblem')).toHaveCSS('mask-image',new RegExp(`activity-icons/${iconFile.replace('.', '\\.')}`));
   await expect(card.locator('.event-row__date b')).toHaveText('29');
   await expect(card.locator('.event-row__date > span:not(.activity-emblem)')).toHaveText('10月');
   expect(await card.locator('[data-fact]').evaluateAll(nodes=>nodes.map(n=>n.dataset.fact))).toEqual(['date','location','sessions']);
   await expect(card.getByRole('link')).toHaveAttribute('href',`/events/synthetic-category-${i}`);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`six-categories-${width}.png`),fullPage:true,animations:'disabled'});
 }
});

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
  for(const name of ['主席团专项','博爱中心','生命中心','综事中心','一加助残专项','献血车专项'])
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
