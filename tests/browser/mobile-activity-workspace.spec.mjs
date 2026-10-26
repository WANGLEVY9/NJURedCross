import { test, expect } from '@playwright/test';

const drafts=Array.from({length:35},(_,i)=>({id:`mobile-draft-${i}`,version:1,stage:'草稿',access:{canEdit:true},content:{name:`手机布局活动 ${String(i).padStart(2,'0')}`,region:'nanjing',category:'生命中心',positions:[]}}));
async function setup(page){
 await page.setViewportSize({width:390,height:844});
 await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events:[]}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts',route=>route.fulfill({json:{ok:true,drafts,capabilities:{canSubmit:true}}}));
 await page.route('**/api/volunteer/workflow/workspace-drafts/capabilities',route=>route.fulfill({json:{ok:true,capabilities:{enabled:true,canCreate:true,canSubmit:true,rosterAvailable:true}}}));
}

test('phone opens only the list, enters one activity and returns with filters and scroll intact',async({page},info)=>{
 await setup(page);await page.goto('/console/events');
 const directory=page.locator('.activity-v2-directory'),pane=page.locator('.activity-v2-detail'),list=page.locator('.activity-v2-list');
 await expect(directory).toBeVisible();await expect(pane).toBeHidden();await expect(page).not.toHaveURL(/draft=|event=/);
 await expect(list.locator('button')).toHaveCount(35);
 await expect(page.getByLabel('活动名称',{exact:true})).toHaveCount(0);
 await page.getByLabel('搜索活动',{exact:true}).fill('手机布局');
 await page.getByRole('combobox',{name:'地区',exact:true}).click();await page.getByRole('option',{name:'南京地区',exact:true}).click();
 const target=list.locator('button').nth(18);await target.scrollIntoViewIfNeeded();
 const before=await list.evaluate(node=>node.scrollTop);expect(before).toBeGreaterThan(0);
 await page.screenshot({path:info.outputPath('mobile-list.png')});
 await target.click();await expect(pane).toBeVisible();await expect(directory).toBeHidden();
 await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue(drafts[18].content.name);
 await expect(page.getByRole('button',{name:'返回活动列表',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('mobile-detail.png')});
 await page.getByRole('button',{name:'返回活动列表',exact:true}).click();await expect(directory).toBeVisible();
 await expect(page.getByLabel('搜索活动',{exact:true})).toHaveValue('手机布局');
 await expect(page.getByRole('combobox',{name:'地区',exact:true})).toContainText('南京地区');
 await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeCloseTo(before,0);
 await expect(list.locator('button').nth(18)).toBeFocused();
 await list.locator('button').nth(18).click();await expect(pane).toBeVisible();
 await page.getByLabel('活动名称',{exact:true}).fill('未保存的手机修改');
 await page.evaluate(()=>history.back());await expect(page.getByRole('dialog',{name:'放弃未保存的修改？'})).toBeVisible();
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue('未保存的手机修改');
 await page.getByRole('button',{name:'返回活动列表',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(directory).toBeVisible();
});

test('mobile deep links, short screens and desktop resizing retain one usable workspace',async({page})=>{
 await setup(page);await page.goto('/console/events?draft=mobile-draft-1');
 const pane=page.locator('.activity-v2-detail'),directory=page.locator('.activity-v2-directory');
 await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue(drafts[1].content.name);
 for(const [width,height] of [[320,568],[412,720],[768,900],[960,700]]){
  await page.setViewportSize({width,height});await expect(pane).toBeVisible();await expect(directory).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await pane.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
  const toolbar=page.locator('.activity-draft-toolbar');expect(await toolbar.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});await expect(directory).toBeVisible();await expect(pane).toBeVisible();await expect(page.getByRole('button',{name:'返回活动列表',exact:true})).toBeHidden();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'返回活动列表',exact:true}).click();await expect(directory).toBeVisible();await expect(pane).toBeHidden();
 await page.reload();await expect(directory).toBeVisible();await expect(pane).toBeHidden();
});

test('initial directory failure keeps refresh reachable and retries the requested deep link',async({page})=>{
 await setup(page);
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({status:503,json:{ok:false,message:'合成目录暂不可用'}}));
 await page.goto('/console/events?draft=mobile-draft-1');
 await expect(page.getByText('活动列表暂时无法加载',{exact:true})).toBeVisible();
 await expect(page.getByText('正在加载活动列表…',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'刷新',exact:true})).toBeVisible();
 await page.route('**/api/volunteer/workflow/catalog',route=>route.fulfill({json:{ok:true,events:[]}}));
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await expect(page.getByLabel('活动名称',{exact:true})).toHaveValue(drafts[1].content.name);
 await expect(page.locator('.activity-v2-directory')).toBeHidden();
});
