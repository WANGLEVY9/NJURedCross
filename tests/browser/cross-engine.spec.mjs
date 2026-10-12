import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});
for(const url of ['/','/events','/community','/outreach','/materials'])test(`critical route loads all modules: ${url}`,async({page})=>{
  const errors=[],assets=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(/\/(app|styles|assets)\//.test(r.url())&&r.status()>=400)assets.push(r.url());});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.goto(url);
    await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  expect(errors).toEqual([]);expect(assets).toEqual([]);
});
test('filters preserve keyboard focus, URL and result reset',async({page})=>{
  await page.goto('/events');
  const choices=page.getByRole('radiogroup',{name:'活动分类'});
  await choices.getByRole('radio',{name:'全部',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(choices.getByRole('radio',{name:'南京地区',exact:true})).toBeFocused();
  await expect(page).toHaveURL(/category=nanjing/);
  await page.getByRole('searchbox',{name:'搜索活动'}).fill('cross-engine-no-match');
  await expect(page.getByRole('heading',{name:'没有符合条件的活动'})).toBeVisible();
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'搜索活动'})).toBeFocused();
  await expect(page).not.toHaveURL(/q=|category=/);
});
test('private routes and restricted roles enforce navigation and API denial',async({page})=>{
  await page.goto('/me');await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/console/workflow');await expect(page).toHaveURL(/\/console\/login\?next=/);
  await page.request.post('/api/auth/login',{data:{username:'synthetic-events-only'}});
  await page.goto('/console/messages');await expect(page).toHaveURL(/\/console\/overview\?forbidden=community/);
  expect((await page.request.get('/api/community/messages')).status()).toBe(403);
});
test('manual showcase and reduced motion retain focus and selected topic',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  const selected=page.getByRole('button',{name:'显示内建广场',exact:true});
  await selected.focus();await page.keyboard.press('Enter');
  await expect(selected).toHaveAttribute('aria-pressed','true');await expect(selected).toBeFocused();
  await expect(page.locator('.showcase__play')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('.showcase__dot[aria-pressed=true]').count()).toBe(1);
});
