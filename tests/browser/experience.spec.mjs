import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => { await page.request.post('/api/auth/logout'); });

test('homepage service navigation works with populated data and reduced motion', async ({page}, info) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/public/events**', route => route.fulfill({json:{ok:true,events:[{eventId:'ui-fixture',name:'合成急救培训',type:'急救培训',status:'报名中',capacity:20,confirmed:3,campus:'仙林',location:'合成教室',description:'界面回归使用的合成活动'}]}}));
  await page.route('**/api/public/overview', route => route.fulfill({json:{ok:true,stats:{openSeats:17,totalRegistrations:3,inventoryCategories:5}}}));
  await page.goto('/');
  const services=page.locator('.hero-art');
  await expect(services.getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'合成急救培训'})).toBeVisible();
  await expect(page.locator('.hero__figures')).toHaveAttribute('aria-busy','false');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('home.png'),fullPage:true,animations:'disabled'});
  await services.getByRole('link',{name:/发现温暖连接/}).click();
  await expect(page).toHaveURL(/\/community$/);
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

test('mobile account menu skips disabled entries, fits the viewport and restores focus', async ({page}) => {
  await page.setViewportSize({width:320,height:320});
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  await page.goto('/console/admin');
  const trigger=page.getByRole('button',{name:'账号菜单',exact:true});
  await trigger.click();
  const menu=page.getByRole('menu');
  await expect(menu.getByRole('menuitem',{name:'管理员中心',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem',{name:/快捷键一览/})).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem',{name:'管理员中心',exact:true})).toBeFocused();
  await expect.poll(()=>menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=7&&r.right<=innerWidth-7&&r.top>=7&&r.bottom<=innerHeight-7;})).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded','false');
});

test('Escape dismisses only the workspace menu inside mobile navigation', async ({page}) => {
  await page.setViewportSize({width:320,height:480});
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  await page.goto('/console/admin');
  await page.getByRole('button',{name:'全部模块',exact:true}).click();
  const nav=page.locator('#console-navigation');
  const workspace=nav.getByRole('button',{name:/当前工作区/});
  await workspace.click();
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(nav).toHaveAttribute('aria-modal','true');
  await expect(workspace).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toHaveJSProperty('inert',true);
  await expect(page.getByRole('button',{name:'展开导航',exact:true})).toBeFocused();
});

test('long action menus remain scrollable in a short viewport', async ({page}) => {
  await page.setViewportSize({width:320,height:240});
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(async()=>{
    const {showMenu}=await import('/app/ui/overlay.js');
    showMenu({x:310,y:230},[{label:'A'.repeat(120),heading:true},...Array.from({length:12},(_,i)=>({label:`操作 ${i+1}`}))]);
  });
  const menu=page.getByRole('menu');
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem',{name:'操作 12',exact:true})).toBeFocused();
  await expect.poll(()=>menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth-7&&r.bottom<=innerHeight-7&&e.scrollHeight>e.clientHeight;})).toBe(true);
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
});

test('mobile search has a touch close control and isolates background navigation', async ({page}) => {
  await page.setViewportSize({width:320,height:320});
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  await page.goto('/console/admin');
  const trigger=page.getByRole('button',{name:'搜索页面、对象与操作'});
  await trigger.click();
  await expect(page.getByRole('combobox',{name:'命令面板搜索'})).toBeFocused();
  await expect(page.locator('#root')).toHaveJSProperty('inert',true);
  await page.getByRole('combobox',{name:'命令面板搜索'}).fill('活动管理');
  await expect(page.getByRole('option',{name:/活动管理/})).toBeVisible();
  await page.getByRole('button',{name:'关闭命令面板',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'命令面板'})).toHaveCount(0);
  await expect(page.locator('#root')).toHaveJSProperty('inert',false);
  await expect(trigger).toBeFocused();
});

test('deferred dialog focus does not steal a field already selected by the user', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
  await expect(page.locator('h1')).toBeVisible();
  await page.evaluate(async()=>{
    const {openDrawer}=await import('/app/ui/overlay.js');
    const first=document.createElement('input');first.setAttribute('aria-label','第一项');
    const second=document.createElement('input');second.setAttribute('aria-label','第二项');
    openDrawer({title:'焦点回归',body:[first,second]});
    second.focus();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  await expect(page.getByRole('textbox',{name:'第二项'})).toBeFocused();
  await page.keyboard.type('保持输入');
  await expect(page.getByRole('textbox',{name:'第二项'})).toHaveValue('保持输入');
  await expect(page.getByRole('textbox',{name:'第一项'})).toHaveValue('');
});
