import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => { await page.request.post('/api/auth/logout'); });

test('homepage service navigation works with populated data and reduced motion', async ({page}, info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/public/events**', route => route.fulfill({json:{ok:true,events:[{eventId:'ui-fixture',name:'合成急救培训',type:'急救培训',status:'报名中',capacity:20,confirmed:3,campus:'仙林',location:'合成教室',description:'界面回归使用的合成活动'}]}}));
  await page.route('**/api/public/overview', route => route.fulfill({json:{ok:true,stats:{openSeats:17,totalRegistrations:3,inventoryCategories:5}}}));
  await page.goto('/');
  const services=page.getByRole('navigation',{name:'常用服务'});
  await expect(services.getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('heading',{name:'合成急救培训'})).toBeVisible();
  await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy','false');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('home.png'),fullPage:true,animations:'disabled'});
  await services.getByRole('link',{name:/准备活动所需物资/}).click();
  await expect(page).toHaveURL(/\/materials$/);
  await expect(page.locator('#main')).toBeFocused();
});

test('nested dialogs isolate the background and restore keyboard focus once', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(async()=>{
    const {openModal}=await import('/app/ui/overlay.js');
    const trigger=document.createElement('button');trigger.textContent='测试弹层';trigger.id='fixture-trigger';document.querySelector('#main').append(trigger);trigger.focus();
    const nested=document.createElement('button');nested.textContent='打开二级确认';
    nested.onclick=()=>{const twice=document.createElement('button');twice.textContent='完成确认';const child=openModal({title:'二级确认',body:twice});twice.onclick=()=>{child.close();child.close();};};
    openModal({title:'一级详情',body:nested});
  });
  await expect(page.locator('#root')).toHaveJSProperty('inert',true);
  await page.getByRole('button',{name:'打开二级确认'}).click();
  await expect(page.locator('.scrim').first()).toHaveJSProperty('inert',true);
  await expect(page.getByRole('dialog',{name:'二级确认'})).toBeVisible();
  const close=page.getByRole('dialog',{name:'二级确认'}).getByRole('button',{name:'关闭',exact:true});
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'完成确认'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.getByRole('button',{name:'完成确认'}).click();
  await expect(page.getByRole('button',{name:'打开二级确认'})).toBeFocused();
  await expect(page.locator('#root')).toHaveJSProperty('inert',true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#root')).toHaveJSProperty('inert',false);
  await expect(page.locator('#fixture-trigger')).toBeFocused();
});

test('shared table announces filtering results and sorts from the keyboard', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(async()=>{
    const {dataTable}=await import('/app/ui/table.js');
    const table=dataTable({columns:[{key:'name',label:'姓名'}],rows:[{id:'b',name:'Beta'},{id:'a',name:'Alpha'}]});
    document.querySelector('#main').replaceChildren(table.node || table);
  });
  await expect(page.locator('.toolbar__count')).toHaveText('2 条记录');
  const header=page.getByRole('columnheader',{name:'姓名'});await header.focus();await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort','ascending');
  await expect(page.locator('tbody tr').first()).toContainText('Alpha');
  await page.getByRole('searchbox').fill('Beta');
  await expect(page.locator('.toolbar__count')).toHaveText('1 条记录');
  await expect(page.getByRole('searchbox')).toBeFocused();
});
