import {test,expect} from '@playwright/test';

const title='首次登录请注册';
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});

test('registration reminder fits the viewport and preserves the activity return path',async({page},info)=>{
 const next='/events?event=synthetic-reminder';
 await page.goto(`/login?next=${encodeURIComponent(next)}`);
 const dialog=page.getByRole('dialog',{name:title,exact:true});
 await expect(dialog).toBeVisible();await expect(dialog).toContainText('校园邮箱注册账号');
 await expect(dialog.getByRole('checkbox',{name:'不再提示',exact:true})).not.toBeChecked();
 const box=await dialog.boundingBox(),viewport=page.viewportSize();
 expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
 expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
 await page.screenshot({path:info.outputPath('registration-reminder.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'去注册',exact:true}).click();
 await expect(page).toHaveURL(/\/register\?/);expect(new URL(page.url()).searchParams.get('next')).toBe(next);
 await expect(dialog).toHaveCount(0);await expect(page.locator('#root')).not.toHaveAttribute('inert');
});

test('dismissal allows login and suppresses repeat prompts in the same tab',async({page})=>{
 await page.goto('/login');
 await page.getByRole('dialog',{name:title,exact:true}).getByRole('button',{name:'继续登录',exact:true}).click();
 await page.getByPlaceholder('请输入本人学号').fill('999990001');
 await page.reload();await expect(page.getByRole('heading',{name:'登录后管理你的参与记录',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:title,exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('njurc:registration-reminder:v1'))).toBeNull();
});

test('do not remind preference survives a fresh browser tab',async({page,context})=>{
 await page.goto('/login');const dialog=page.getByRole('dialog',{name:title,exact:true});
 await dialog.getByRole('checkbox',{name:'不再提示',exact:true}).check();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const fresh=await context.newPage();await fresh.goto('/login');
 await expect(fresh.getByRole('heading',{name:'登录后管理你的参与记录',exact:true})).toBeVisible();
 await expect(fresh.getByRole('dialog',{name:title,exact:true})).toHaveCount(0);await fresh.close();
});

test('blocked browser storage still allows dismissal and registration navigation',async({page})=>{
 await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('blocked');};Storage.prototype.setItem=()=>{throw new Error('blocked');};});
 await page.goto('/login');const dialog=page.getByRole('dialog',{name:title,exact:true});
 await dialog.getByRole('checkbox',{name:'不再提示',exact:true}).check();
 await dialog.getByRole('button',{name:'去注册',exact:true}).click();
 await expect(page).toHaveURL(/\/register\?/);await expect(dialog).toHaveCount(0);
});
