import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('community editorial desktop viewports', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium');
  await page.request.post('/api/auth/login', {data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities', route => route.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width,height] of [[1280,800],[1440,900],[1920,1080],[2048,980]]) {
    await page.setViewportSize({width,height});
    await page.goto('/community');
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if(process.env.COMMUNITY_CAPTURE) {
      await mkdir(process.env.COMMUNITY_CAPTURE,{recursive:true});
      await page.screenshot({path:`${process.env.COMMUNITY_CAPTURE}/${width}.png`,fullPage:true});
    }
  }
});

async function communityFixture(page, { memberError = false, lettersError = false, morningStatus = '待审核' } = {}) {
  await page.request.post('/api/auth/login', {data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities', r => r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.route('**/api/portal/me?view=warmth', r => r.fulfill(memberError ? {status:503,json:{message:'synthetic unavailable'}} : {json:{enrollments:[{program:'birthday',status:'已确认'}]}}));
  await page.route('**/api/morning/card', r => r.fulfill({json:{profile:{missing:[]},card:{status:morningStatus}}}));
  await page.route('**/api/public/warmth/blessings/mine', r => r.fulfill(lettersError ? {status:503,json:{message:'synthetic unavailable'}} : {json:{blessings:[],stats:{limit:3}}}));
  await page.route('**/api/public/warmth/blessings/delivered', r => r.fulfill({json:{blessings:[]}}));
}

test('birthday calendar selection submits lunar dates and switches day bounds', async ({ page }) => {
  await communityFixture(page);
  await page.route('**/api/portal/me?view=warmth', r => r.fulfill({ json: { enrollments: [] } }));
  const requests = [];
  await page.route('**/api/public/warmth/interest', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { interest: { id: 'WARM-LUNAR', status: '已确认' } } });
  });
  await page.goto('/community');
  await page.getByRole('button', { name: '加入生日祝福', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const select = async (name, option) => {
    await dialog.getByRole('combobox', { name, exact: true }).click();
    const search = page.locator('.select-menu__popup:popover-open input[type=search]');
    if (await search.count()) await search.fill(option);
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await select('生日历法', '阴历（农历）');
  await select('生日（月）', '2 月');
  await select('生日（日）', '30 日');
  await select('生日历法', '阳历（公历）');
  await expect(dialog.getByRole('combobox', { name: '生日（日）', exact: true })).toContainText('29 日');
  await select('生日历法', '阴历（农历）');
  await select('生日（日）', '30 日');
  await select('校区', '鼓楼');
  const consent = page.getByRole('checkbox', { name: '我自愿加入，并了解可以随时退出' });
  await dialog.locator('label.check').filter({ has: consent }).locator('.check__box').click();
  await dialog.getByRole('button', { name: '确认加入', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ birthdayCalendar: 'lunar', birthdayMonthDay: '02-30', campus: '鼓楼' });
  await expect(dialog.getByText('阴历 02-30', { exact: true })).toBeVisible();
});

test('birthday calendar edit restores lunar preference and saves changes', async ({ page }) => {
  await communityFixture(page);
  const requests = [];
  await page.route('**/api/portal/me', r => r.fulfill({ json: { registrations: [], submissions: [], enrollments: [
    { id: 'WARM-LUNAR', program: 'birthday', status: '已确认', birthdayCalendar: 'lunar', birthdayMonthDay: '02-30', campus: '鼓楼' },
  ] } }));
  await page.route('**/api/public/warmth/interests/WARM-LUNAR/update', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/me?focus=member-warmth-enrollments');
  await expect(page.getByText(/生日 阴历 02-30/)).toBeVisible();
  await page.locator('#member-warmth-enrollments').getByRole('button', { name: '修改', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '生日历法', exact: true })).toContainText('阴历（农历）');
  await expect(dialog.getByRole('combobox', { name: '生日（日）', exact: true })).toContainText('30 日');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ birthdayCalendar: 'lunar', birthdayMonthDay: '02-30' });
});

for (const editing of [false, true]) {
  test(`birthday blessing ${editing ? 'edit' : 'create'} counts input and enforces the 200-character limit`, async ({ page }) => {
    await communityFixture(page);
    const requests = [];
    await page.route(editing ? '**/api/public/warmth/blessings/CARE-1/resubmit' : '**/api/public/warmth/blessings', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: editing ? 200 : 201, json: { blessing: { id: 'CARE-1', status: '待审核', delivery: '随机匹配' }, message: '合成投稿成功' } });
    });
    await page.goto('/community');
    if (editing) {
      await page.evaluate(async () => {
        const { openBlessingDrawer } = await import('/app/portal/blessing-drawer.js');
        openBlessingDrawer({ blessing: { id: 'CARE-1', nickname: '合成昵称', content: '祝'.repeat(201), status: '待审核' } });
      });
    } else {
      await page.getByRole('button', { name: '写生日祝福', exact: true }).click();
    }
    const content = page.getByRole('textbox', { name: /^祝福内容/ });
    await expect(content).toHaveAttribute('maxlength', '200');
    const counter = page.getByText(/^不超过 200 字 · 已输入 /);
    await expect(counter).toHaveText(`不超过 200 字 · 已输入 ${editing ? 201 : 0} / 200 字`);
    await content.fill('生日快乐！');
    await expect(counter).toHaveText('不超过 200 字 · 已输入 5 / 200 字');
    await content.press('Backspace');
    await expect(counter).toHaveText('不超过 200 字 · 已输入 4 / 200 字');
    await content.fill('');
    await expect(counter).toHaveText('不超过 200 字 · 已输入 0 / 200 字');
    await page.getByRole('textbox', { name: /^你的昵称/ }).fill('合成昵称');
    await content.evaluate(node => { node.value = '祝'.repeat(201); node.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = page.getByRole('button', { name: editing ? '保存修改' : '提交祝福', exact: true });
    await submit.click();
    await expect(page.getByText('祝福内容不能超过 200 字', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(0);
    await content.fill('祝'.repeat(200));
    await expect(counter).toHaveText('不超过 200 字 · 已输入 200 / 200 字');
    await expect(page.getByText('祝福内容不能超过 200 字', { exact: true })).toHaveCount(0);
    const consent = page.getByRole('checkbox', { name: '我确认这段祝福由我本人撰写' });
    await page.locator('label.check').filter({ has: consent }).locator('.check__box').click();
    await submit.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].content).toBe('祝'.repeat(200));
  });
}
for (const editing of [false, true]) {
  test(`friend birthday letter ${editing ? 'edit restores target' : 'create requires target'} and submits private details`, async ({ page }) => {
    await communityFixture(page);
    const requests = [];
    await page.route(editing ? '**/api/public/warmth/blessings/CARE-FRIEND/resubmit' : '**/api/public/warmth/blessings', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { blessing: { id: 'CARE-FRIEND', status: '待审核', delivery: '写给挚友' }, message: '合成投稿成功' } });
    });
    await page.goto('/community');
    if (editing) await page.evaluate(async () => {
      const { openBlessingDrawer } = await import('/app/portal/blessing-drawer.js');
      openBlessingDrawer({ blessing: { id: 'CARE-FRIEND', nickname: '朋友', content: '生日快乐', delivery: '写给挚友', status: '需修改', friendEmail: 'friend@example.test', friendBirthday: '12-31' } });
    });
    else {
      await page.getByRole('button', { name: '写生日祝福', exact: true }).click();
      await page.getByRole('textbox', { name: /^你的昵称/ }).fill('朋友');
      await page.getByRole('textbox', { name: /^祝福内容/ }).fill('生日快乐');
      await page.getByRole('radio', { name: '写给挚友', exact: true }).click();
    }
    const email = page.getByRole('textbox', { name: /^挚友邮箱/ });
    const submit = page.getByRole('button', { name: editing ? '保存修改' : '提交祝福', exact: true });
    await expect(email).toBeVisible();
    if (!editing) {
      await submit.click();
      await expect(page.getByText('请填写有效的挚友邮箱', { exact: true })).toBeVisible();
      expect(requests).toHaveLength(0);
      await email.fill('friend@example.test');
      await page.getByRole('combobox', { name: '挚友生日（月）', exact: true }).click();
      await page.getByRole('option', { name: '12 月', exact: true }).click();
      await page.getByRole('combobox', { name: '挚友生日（日）', exact: true }).click();
      await page.getByRole('option', { name: '31 日', exact: true }).click();
    } else await expect(email).toHaveValue('friend@example.test');
    const consent = page.getByRole('checkbox', { name: '我确认这段祝福由我本人撰写' });
    await page.locator('label.check').filter({ has: consent }).locator('.check__box').click();
    await submit.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ delivery: 'friend', friendEmail: 'friend@example.test', friendBirthday: '12-31', content: '生日快乐' });
  });
}

for (const occupied of [0, 3]) {
  test(`friend letters do not occupy normal slots and writing stays available with ${occupied} normal letters`, async ({ page }) => {
    await communityFixture(page);
    const blessings = [
      ...Array.from({ length: occupied }, (_, i) => ({ id: `normal-${i}`, content: '普通祝福', status: '待审核', deliveryKey: 'random', delivery: '随机匹配' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `friend-${i}`, content: '给朋友的祝福', status: '已通过', deliveryKey: 'friend', delivery: '写给挚友' })),
    ];
    await page.route('**/api/public/warmth/blessings/mine', route => route.fulfill({ json: { blessings, stats: { limit: 3, used: occupied } } }));
    await page.goto('/community');
    await expect(page.getByText(`随机匹配与祝福仓库已占用 ${occupied} / 3 条投稿名额。「写给挚友」不占额度。`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '写生日祝福', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (occupied === 3) {
      await expect(page.getByRole('radio', { name: '写给挚友', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('textbox', { name: /^挚友邮箱/ })).toBeVisible();
    } else {
      await expect(page.getByRole('radio', { name: '随机匹配', exact: true })).toHaveAttribute('aria-checked', 'true');
    }
  });
}

test('community member sees eligible actions and private panels', async ({page}) => {
  await communityFixture(page);
  const errors=[]; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/community');
  await expect(page.getByRole('button',{name:'写生日祝福',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'加入生日祝福',exact:true})).toHaveCount(0);
  const plazaEntry=page.locator('.community-program--morning').getByRole('link',{name:'进入同行广场',exact:true});
  const cardEntry=page.locator('.community-program--morning').getByRole('button',{name:'查看我的名片',exact:true});
  await expect(plazaEntry).toBeVisible();
  await expect(plazaEntry).toHaveAttribute('href','/morning/plaza');
  await expect(plazaEntry).toHaveClass(/btn--secondary/);
  await expect(cardEntry).toHaveClass(/btn--secondary/);
  const [plazaBox,cardBox]=await Promise.all([plazaEntry.boundingBox(),cardEntry.boundingBox()]);
  expect(Math.abs(plazaBox.y-cardBox.y)).toBeLessThan(1);
  expect(Math.abs(plazaBox.height-cardBox.height)).toBeLessThan(1);
  await expect(page.getByText('待审核',{exact:true})).toBeVisible();
  await expect(page.locator('#community-warmth-delivered')).toBeVisible();
  await page.getByText('了解祝福投递规则',{exact:true}).click();
  await expect(page.getByText(/生日当天会按已审核的投稿数量匹配祝福/)).toBeVisible();
  await page.getByRole('button',{name:'写生日祝福',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
test('published morning member sees distinct plaza and card management actions', async ({page}) => {
  await communityFixture(page, { morningStatus: '已发布' });
  await page.goto('/community');
  const morningCard=page.locator('.community-program--morning');
  await expect(morningCard.getByRole('link',{name:'进入同行广场',exact:true})).toBeVisible();
  const manage=morningCard.getByRole('button',{name:'管理我的名片',exact:true});
  await expect(manage).toBeVisible();
  await expect(morningCard.getByRole('button',{name:'遇见同行的同学',exact:true})).toHaveCount(0);
  await expect(morningCard.locator('.community-program__actions .btn')).toHaveCount(2);
  await manage.click();
  await expect(page).toHaveURL(/\/morning$/);
});
test('community failed state is not shown as nonmembership',async({page})=>{
  await communityFixture(page,{memberError:true});
  await page.goto('/community');
  await expect(page.getByText('参与状态暂未读取')).toBeVisible();
  await expect(page.getByText('尚未加入',{exact:true})).toHaveCount(0);
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
});
test('community missing letters do not look like an empty inbox',async({page})=>{
  await communityFixture(page,{lettersError:true});
  await page.goto('/community');
  await expect(page.getByText('祝福记录暂未完整读取，请重试后查看。')).toBeVisible();
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'写生日祝福',exact:true})).toHaveCount(0);
});
test('community guests see the development page and a login return destination',async({page})=>{
  await page.request.post('/api/auth/logout');
  await page.goto('/community');
  await expect(page.getByRole('heading', {name:'内建广场',exact:true})).toBeVisible();
  await expect(page.locator('#community-warmth-delivered')).toHaveCount(0);
  await expect(page.getByText('请先登录后，再申请查看权限')).toBeVisible();
  await page.getByRole('link',{name:'登录后申请查看权限',exact:true}).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fcommunity/);
});
test('community themes, reduced motion and return navigation remain scoped',async({page})=>{
  await page.request.post('/api/auth/login', {data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/community');
  await expect(page.locator('#ambient')).toBeHidden();
  for(const theme of ['dawn','sail','garden','iris','amber']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    const expected=await page.evaluate(()=>{const e=document.createElement('i');e.style.color='var(--canvas-raised)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;});
    await expect(page.locator('.community-program--morning')).toHaveCSS('color',expected);
    await expect(page.locator('.community-art').first()).toHaveCSS('transition-duration','0s');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  }
  await page.goto('/events');
  await expect(page.locator('#ambient')).toBeHidden();
});

test('birthday submission pool approves directly from its action',async({page})=>{
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  let reviewRequest;
  await page.route('**/api/community/submissions/CARE-UI-REVIEW/review',async route=>{
    reviewRequest=route.request().postDataJSON();
    await route.fulfill({json:{ok:true,message:'投稿审核通过'}});
  });
  await page.route('**/api/community/submissions',r=>r.fulfill({json:{
    ok:true,
    stats:{total:1,pending:1,returned:0,approved:0,rejected:0},
    submissions:[{
      id:'CARE-UI-REVIEW',
      program:'birthday',
      content:'愿你的新一岁一切顺利。',
      tone:'温暖',
      nickname:'本科同行一',
      delivery:'随机匹配',
      deliveryState:'可投递',
      actor:'本****一',
      status:'待审核',
      submittedAt:'2026-10-24T12:00:00.000Z',
    }],
  }}));
  await page.goto('/console/community/birthday?tab=submissions');
  const table=page.getByRole('region',{name:'数据列表，可左右滑动查看全部列'});
  await expect(table.getByRole('columnheader',{name:'项目',exact:true})).toHaveCount(0);
  await expect(table.getByRole('columnheader',{name:'语气',exact:true})).toHaveCount(0);
  await expect(table.getByRole('columnheader',{name:'投递条件',exact:true})).toHaveCount(0);
  await expect(table.getByRole('columnheader',{name:'审核',exact:true})).toBeVisible();
  await table.getByRole('button',{name:'通过投稿 CARE-UI-REVIEW',exact:true}).click();
  await expect.poll(()=>reviewRequest).toEqual({decision:'approve',note:''});
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('birthday submissions share batch selection and cancel-all controls',async({page})=>{
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  await page.route('**/api/public/warmth/capabilities',r=>r.fulfill({json:{birthday:{enabled:true,ready:true}}}));
  await page.route('**/api/community/submissions',r=>r.fulfill({json:{
    ok:true,stats:{total:1,pending:1,returned:0,approved:0,rejected:0},submissions:[{
      id:'CARE-BATCH-ONE',program:'birthday',content:'愿你新的一岁平安顺遂。',nickname:'合成投稿人',delivery:'随机匹配',actor:'合****人',status:'待审核',submittedAt:'2026-10-24T12:00:00.000Z',
    }],
  }}));
  let review;
  await page.route('**/api/community/submissions/CARE-BATCH-ONE/review',async route=>{
    review=route.request().postDataJSON();
    await route.fulfill({json:{ok:true,message:'投稿审核通过'}});
  });
  await page.goto('/console/community/birthday?tab=submissions');
  await page.getByRole('button',{name:'全选待审核',exact:true}).waitFor();
  const spacing=await page.evaluate(()=>{
    const batch=document.querySelector('.community-review-toolbar');
    const listToolbar=batch?.parentElement?.querySelector('.datatable .toolbar');
    return {batch: Boolean(batch), listToolbar: Boolean(listToolbar), top: batch ? getComputedStyle(batch).marginTop : null, bottom: listToolbar ? getComputedStyle(listToolbar).paddingTop : null};
  });
  expect(spacing.batch).toBe(true);
  expect(spacing.listToolbar).toBe(true);
  expect(parseFloat(spacing.top)).toBe(parseFloat(spacing.bottom));
  const row=page.locator('.datatable tbody tr').first();
  const selectionCell=row.locator('td').first();
  expect(await selectionCell.evaluate(cell=>getComputedStyle(cell).borderRightStyle)).toBe('dashed');
  const selectionBounds=await selectionCell.boundingBox();
  await selectionCell.click({position:{x:2,y:selectionBounds.height/2}});
  await expect(page.getByRole('checkbox',{name:'选择投稿 合成投稿人'})).toBeChecked();
  await selectionCell.click({position:{x:2,y:selectionBounds.height/2}});
  const idCell=row.locator('td').nth(1);
  const idBounds=await idCell.boundingBox();
  await idCell.click({position:{x:idBounds.width*0.25,y:idBounds.height/2}});
  await expect(page.getByRole('checkbox',{name:'选择投稿 合成投稿人'})).toBeChecked();
  await idCell.click({position:{x:idBounds.width*0.75,y:idBounds.height/2}});
  const detail=page.getByRole('dialog');
  await expect(detail.getByRole('heading',{name:'投稿 CARE-BATCH-ONE',exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByText('已选择 1 条',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'取消已选',exact:true}).click();
  await expect(page.getByText('已选择 0 条',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'全选待审核',exact:true}).click();
  await page.getByRole('button',{name:'通过所选（1）',exact:true}).click();
  await page.getByRole('button',{name:'全部通过',exact:true}).click();
  await expect.poll(()=>review).toEqual({decision:'approve',note:''});
});
