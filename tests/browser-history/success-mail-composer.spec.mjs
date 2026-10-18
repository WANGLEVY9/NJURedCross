import {test,expect} from '@playwright/test';
import {renderSuccessMail} from '../../public/app/shared/result-mail.js';
import {execFileSync} from 'node:child_process';
const headers={'x-csrf-token':'synthetic-ui'};
async function openComposer(page) {
  await page.request.post('/api/auth/login',{data:{username:'synthetic-organizer'}});
  const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成急救培训志愿服务',center:'博爱中心',date:'2030-01-12',slot:'09:00-12:00',capacity:2,serviceHours:3,location:'合成校区培训教室',work:'合成服务',submit:false}});
  expect(response.ok()).toBe(true);
  const id=(await response.json()).result._id;
  await page.request.post(`/api/volunteer/workflow/events/${id}/submit`,{headers,data:{}});
  await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
  expect((await page.request.post(`/api/volunteer/workflow/events/${id}/approve`,{headers,data:{}})).ok()).toBe(true);
  expect((await page.request.post(`/api/volunteer/workflow/events/${id}/publish`,{headers,data:{}})).ok()).toBe(true);
  await page.goto(`/console/events?event=${id}&tab=roster`);
  await page.getByRole('button',{name:'编辑成功邮件（可选）',exact:true}).click();
  return id;
}
test('composer desktop layout evidence',async({page},info)=>{
  test.skip(info.project.name!=='desktop-chromium');
  if(process.env.MAIL_COMPOSER_BASELINE) {
    const original=execFileSync('git',['show','ce80b2b:public/app/console/pages/activity-management.js'],{encoding:'utf8'});
    await page.route('**/app/console/pages/activity-management.js',route=>route.fulfill({contentType:'text/javascript',body:original}));
  }
  await openComposer(page);
  for(const [width,height] of [[1440,900],[1920,1080],[1280,800]]) {
    await page.setViewportSize({width,height});
    await page.screenshot({path:`.workflow-evidence/success-mail/${process.env.MAIL_COMPOSER_BASELINE?'before':'after'}-${width}.png`,animations:'disabled'});
    await expect(page.getByRole('dialog')).toBeVisible();
  }
});

const customMode=page=>page.getByRole('radio',{name:/使用自定义邮件/});
const defaultMode=page=>page.getByRole('radio',{name:/使用平台默认邮件/});
const subject=page=>page.getByLabel('成功邮件主题',{exact:true});
const body=page=>page.getByLabel('成功邮件正文',{exact:true});
const save=page=>page.getByRole('button',{name:'保存邮件草稿',exact:true});
const close=page=>page.locator('.drawer__foot').getByRole('button',{name:'关闭',exact:true});
async function shot(page,name,width=1440) {
  await page.screenshot({path:`.workflow-evidence/success-mail/${name}-${width}.png`,animations:'disabled'});
}
test('default preview, draft mode retention, variable insertion and undo redo',async({page})=>{
  await openComposer(page);
  await expect(subject(page)).toBeHidden();await expect(body(page)).toBeHidden();
  const expected=renderSuccessMail(null,{'活动名称':'合成急救培训志愿服务'});
  await expect(page.locator('.success-mail-reader__subject')).toHaveText(expected.subject);
  await expect(page.locator('.success-mail-reader__text')).toHaveText(expected.text);
  await expect(save(page)).toBeDisabled();
  await customMode(page).check();await body(page).fill('集合：待替换，准时到达。');
  await body(page).evaluate(node=>{node.focus();node.setSelectionRange(3,6);node.dispatchEvent(new Event('select'));});
  await page.getByRole('button',{name:'插入变量{地点}',exact:true}).click();
  await expect(body(page)).toHaveValue('集合：{地点}，准时到达。');await expect(body(page)).toBeFocused();
  await body(page).press(process.platform==='darwin'?'Meta+z':'Control+z');
  await expect(body(page)).toHaveValue('集合：待替换，准时到达。');
  await body(page).press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z');await expect(body(page)).toHaveValue('集合：{地点}，准时到达。');
  await body(page).press('End');await body(page).pressSequentially('extra');
  await body(page).press(process.platform==='darwin'?'Meta+z':'Control+z');await expect(body(page)).toHaveValue('集合：{地点}，准时到达。');
  await body(page).press(process.platform==='darwin'?'Meta+z':'Control+z');await expect(body(page)).toHaveValue('集合：待替换，准时到达。');
  // Model one IME composition explicitly; pressSequentially(non-ASCII) is
  // insertText transport, not a real keyboard composition in every engine.
  await body(page).evaluate(node=>{
    const start=node.value.length;node.setSelectionRange(start,start);node.dispatchEvent(new Event('select'));
    node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    for(const data of ['补','补充']){
      node.setRangeText(data,start,node.value.length,'end');
      node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data,isComposing:true}));
    }
    node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'补充'}));
  });
  await expect(body(page)).toHaveValue('集合：待替换，准时到达。补充');
  await body(page).press(process.platform==='darwin'?'Meta+z':'Control+z');await expect(body(page)).toHaveValue('集合：待替换，准时到达。');
  await defaultMode(page).check();await expect(body(page)).toBeHidden();
  await expect(page.locator('.success-mail-state')).toContainText('自定义草稿未保存');await close(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(2);await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);
  await customMode(page).check();await expect(body(page)).toHaveValue('集合：待替换，准时到达。');
  await subject(page).fill('欢迎');await subject(page).press('End');
  await page.getByRole('button',{name:'插入变量{姓名}',exact:true}).click();await expect(subject(page)).toHaveValue('欢迎{姓名}');
  await page.getByRole('button',{name:'恢复建议模板',exact:true}).click();
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(body(page)).toHaveValue('集合：待替换，准时到达。');
});

test('inline validation, close protection, and focus restoration',async({page})=>{
  await openComposer(page);await customMode(page).check();
  await body(page).fill('内容{不支持}');await expect(page.locator('.field__error').filter({hasText:'不支持的邮件变量'})).toBeVisible();await expect(save(page)).toBeDisabled();
  await body(page).fill('正文');await subject(page).fill('字'.repeat(121));await expect(subject(page)).toHaveAttribute('aria-invalid','true');
  await subject(page).fill('标题');await body(page).fill('字'.repeat(5001));await expect(body(page)).toHaveAttribute('aria-invalid','true');
  await body(page).fill('正文');
  await subject(page).evaluate(node=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=> '主题\n换行'}});node.dispatchEvent(event);});
  await expect(page.getByText('主题只能使用单行文本，请去掉换行后粘贴。',{exact:true})).toBeVisible();
  await subject(page).fill('新的标题');await expect(save(page)).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(2);
  await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(body(page)).toHaveValue('正文');
  await close(page).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'编辑成功邮件（可选）',exact:true})).toBeFocused();
});

test('save acknowledgement survives refresh failure and prevents duplicate writes',async({page})=>{
  const id=await openComposer(page);await customMode(page).check();await subject(page).fill('已保存的合成模板');
  const mutations=[];page.on('request',request=>{if(['POST','PATCH','DELETE'].includes(request.method())&&request.url().includes('/workflow/'))mutations.push(new URL(request.url()).pathname);});
  let writes=0,release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(`**/events/${id}/success-mail`,async route=>{writes++;await gate;await route.continue();});
  await page.route(`**/events/${id}/detail`,route=>route.fulfill({status:503,json:{message:'合成刷新失败'}}));
  await save(page).click();await expect(page.locator('.success-mail-state')).toContainText('正在保存');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(close(page)).toBeDisabled();
  release();await expect(page.locator('.success-mail-state')).toContainText('邮件草稿已保存');
  await expect(page.locator('.success-mail-feedback')).toContainText('邮件已保存，但名单刷新失败');await expect(save(page)).toBeHidden();expect(writes).toBe(1);
  await expect(page.locator('.success-mail-drawer')).not.toContainText('保存未完成');
  const data=await(await page.request.get('/api/volunteer/workflow')).json();
  expect(JSON.parse(data.events.find(e=>e._id===id)['报名页配置']).rosterReview.successMail.subject).toBe('已保存的合成模板');
  await page.unroute(`**/events/${id}/detail`);await page.getByRole('button',{name:'重新加载名单',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'编辑成功邮件（可选）',exact:true}).click();await expect(subject(page)).toHaveValue('已保存的合成模板');await expect(save(page)).toBeDisabled();
  await defaultMode(page).check();await save(page).click();await expect(page.locator('.success-mail-state')).toContainText('已保存');
  const after=await(await page.request.get('/api/volunteer/workflow')).json();expect(JSON.parse(after.events.find(e=>e._id===id)['报名页配置']).rosterReview.successMail).toBeNull();
  expect(mutations.every(path=>path.endsWith('/success-mail'))).toBe(true);
});

test('failed save and roster conflict preserve text without unsafe retries',async({page})=>{
  const id=await openComposer(page);await customMode(page).check();await body(page).fill('保留合成草稿');
  await page.route(`**/events/${id}/success-mail`,route=>route.fulfill({status:503,json:{message:'合成保存失败'}}));
  await save(page).click();await expect(page.locator('.success-mail-feedback')).toContainText('保存未完成');await expect(body(page)).toHaveValue('保留合成草稿');
  await page.unroute(`**/events/${id}/success-mail`);
  await page.route(`**/events/${id}/success-mail`,route=>route.fulfill({status:409,json:{message:'名单已变化'}}));
  await save(page).click();await expect(page.locator('.success-mail-feedback')).toContainText('不能覆盖');await expect(body(page)).toHaveValue('保留合成草稿');await expect(save(page)).toBeDisabled();await expect(body(page)).toHaveAttribute('readonly','');
});

test('composer state and viewport evidence',async({page},info)=>{
  test.skip(info.project.name!=='desktop-chromium');
  for(const [width,height] of [[1440,900],[1920,1080],[1280,800]]) {
    await page.setViewportSize({width,height});const id=await openComposer(page);
    await shot(page,'default',width);await customMode(page).check();await shot(page,'custom',width);
    await body(page).fill('{姓名}同学：\n欢迎参与{活动名称}。\n集合时间：{日期} {时段}\n集合地点：{地点}\n活动群号：仅供合成验收\n请提前十分钟到场。');
    await shot(page,'dirty',width);
    await body(page).fill('{未知变量}');await shot(page,'invalid',width);await body(page).fill('合成通知正文\n请提前十分钟到场。');
    await page.route(`**/events/${id}/success-mail`,route=>route.fulfill({status:503,json:{message:'合成保存失败'}}));await save(page).click();await expect(page.locator('.success-mail-drawer')).toHaveAttribute('data-state','error');await shot(page,'error',width);
    await page.unroute(`**/events/${id}/success-mail`);
    let release;const gate=new Promise(resolve=>{release=resolve;});await page.route(`**/events/${id}/success-mail`,async route=>{await gate;await route.continue();});
    await save(page).click();await expect(save(page)).toHaveAttribute('aria-busy','true');await shot(page,'saving',width);release();
    await expect(close(page)).toBeEnabled();await expect(page.locator('.success-mail-drawer')).toHaveAttribute('data-state','saved');await shot(page,'saved',width);
    await close(page).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button',{name:'编辑成功邮件（可选）',exact:true}).click();await expect(subject(page)).toBeVisible();await expect(save(page)).toBeDisabled();await shot(page,'custom-clean',width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await close(page).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    // A frozen synthetic DTO exercises the actual component, not a production write.
    await page.evaluate(async id=>{
      const {successMailEditor}=await import('/app/console/pages/success-mail-composer.js');
      const data=await(await fetch('/api/volunteer/workflow')).json();const event=data.events.find(e=>e._id===id);
      const config=JSON.parse(event['报名页配置']);config.rosterReview.confirmedAt='2030-01-01T00:00:00Z';config.rosterReview.phase='draft';event['报名页配置']=JSON.stringify(config);
      successMailEditor(event,async()=>true);
    },id);
    await expect(page.locator('.success-mail-drawer')).toHaveAttribute('data-state','frozen');await expect(subject(page)).toBeHidden();await expect(save(page)).toBeHidden();await expect(page.getByRole('radio')).toHaveCount(0);await shot(page,'frozen',width);
    await close(page).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('console themes, reduced motion and long text stay within the mail workspace',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openComposer(page);await customMode(page).check();
  await body(page).fill('合成阅读样例\nhttps://example.invalid/'+ 'long-segment'.repeat(45)+'\n{姓名} {活动名称} {日期} {时段} {地点}');
  for(const theme of ['porcelain','blueprint','botanic','atelier','archive']) {
    await page.evaluate(async theme=>{const {selectTheme}=await import('/app/core/themes.js');selectTheme('console',theme);},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    expect(await page.locator('.success-mail-reader').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(info.project.name==='desktop-chromium')await page.screenshot({path:`.workflow-evidence/success-mail/theme-${theme}.png`,animations:'disabled'});
  }
});
