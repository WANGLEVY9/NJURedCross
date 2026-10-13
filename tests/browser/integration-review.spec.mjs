// Combined-branch synthetic fixtures. Never call a real database, mailbox or cloud drive.
import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/api/auth/')||path.startsWith('/api/volunteer/workflow'))return route.continue();
  const payload={ok:true,stats:{total:0,pending:0,approved:0,returned:0,open:0,reviewing:0,claimed:0,contentCount:0,reviewPending:0,reviewApproved:0,publicationPending:0},sources:['synthetic-review'],campaigns:[],submissions:[],queue:[],reviewed:[],pending:[],items:[],tasks:[],claims:[],skills:[],photos:[],folders:[],picks:[],attachments:[],tables:[],checklist:[],centers:['生命中心'],activities:[{name:'合成活动',center:'生命中心'}],config:{centers:['生命中心']},articleCategories:['红会新闻','活动总结'],boards:{posts:{title:'公众号推文',total:1,groups:[{name:'红会新闻',items:[{id:'synthetic-post',title:'合成展示内容',summary:'仅验证界面',link:'https://example.invalid/'}]}]},designs:{groups:[]}}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
});

for(const path of ['/submit','/photos','/tasks','/showcase','/outreach','/console/outreach']){
 test(`combined candidate: ${path} boots with shared tokens and fits viewport`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(path);
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting','true');
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).not.toBe('');
  if(path==='/console/outreach')for(const name of ['公众投稿','影像审核','技能审核','任务审核','宣传展示']){
   await page.getByRole('tab',{name,exact:true}).click();
   await page.waitForTimeout(100);
   expect(errors).toEqual([]);
  }
  if(path==='/submit'||path==='/tasks'||path==='/console/outreach')await page.screenshot({path:info.outputPath('review.png'),fullPage:true});
 });
}

test('shared text drawer validates, cancels without submitting and restores focus', async ({page}) => {
 await page.goto('/tasks');
 await expect(page.getByRole('heading',{name:'任务申领',exact:true})).toBeVisible();
 await page.evaluate(async () => {
  const {requestText} = await import('/app/ui/overlay.js');
  const trigger = document.createElement('button'); trigger.textContent = '合成说明入口';
  trigger.onclick = () => { window.syntheticDialogResult = 'pending'; requestText({title:'合成说明',label:'说明内容',required:true}).then(value => {window.syntheticDialogResult=value;}); };
  document.querySelector('h1').after(trigger);
 });
 const trigger=page.getByRole('button',{name:'合成说明入口'});
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'合成说明'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'提交',exact:true}).click();
 await expect(dialog.getByText('请填写说明', {exact:true})).toBeVisible();
 await expect(page.getByLabel('说明内容')).toBeFocused();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.syntheticDialogResult)).toBe(null);
 await expect(trigger).toBeFocused();
 await trigger.click();
 await page.getByLabel('说明内容').fill('  合成测试说明  ');
 await dialog.getByRole('button',{name:'提交',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.syntheticDialogResult)).toBe('合成测试说明');
 await expect(trigger).toBeFocused();
});

test('task claim uses shared drawer and sends exactly one confirmed synthetic request', async ({page}) => {
 const submitted=[];
 await page.route('**/api/public/tasks', route => route.fulfill({json:{ok:true,tasks:[{id:'task-synthetic',title:'合成摄影任务',status:'待认领',stars:1}],stats:{open:1,reviewing:0,claimed:0}}}));
 await page.route('**/api/public/tasks/task-synthetic/claim', route => {
  submitted.push(route.request().postDataJSON());
  return route.fulfill({json:{ok:true,message:'合成申领已接收'}});
 });
 await page.goto('/tasks');
 const trigger=page.getByRole('button',{name:'我来申领',exact:true});
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'申领任务「合成摄影任务」'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(submitted).toEqual([]);
 await trigger.click();
 await dialog.getByLabel('申领备注').fill('合成任务备注');
 await dialog.getByRole('button',{name:'提交',exact:true}).click();
 await expect.poll(()=>submitted.length).toBe(1);
 expect(submitted[0]).toEqual({note:'合成任务备注'});
 await expect(dialog).not.toBeVisible();
});
