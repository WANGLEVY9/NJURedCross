import {test,expect} from '@playwright/test';
// 注册页只在未登录时渲染；预览服务的合成会话是全局共享的，先显式登出再进入。
test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});
for(const matched of [false,true])test(`staff confirmation ${matched?'appears once and follows registration':'stays hidden with an empty list'}`,async({page})=>{
 await page.route('**/api/auth/registration-config',route=>route.fulfill({json:{ok:true,enabled:true,minimumPasswordLength:8,emailDomains:['smail.nju.edu.cn'],staffEmailDomains:matched?['smail.nju.edu.cn']:[]}}));
 const bodies=[];await page.route('**/api/auth/register',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({status:400,json:{ok:false,message:'合成重试场景'}});});
 await page.goto('/register');
 await page.getByLabel('学号',{exact:false}).fill('999990001');await page.getByLabel('真实姓名',{exact:false}).fill('合成同学');
 await page.getByLabel('设置密码',{exact:false}).fill('Synthetic1!');await page.getByLabel('再次输入密码',{exact:false}).fill('Synthetic1!');
 await page.getByRole('button',{name:'注册并获取验证码',exact:true}).click();
 if(matched){const dialog=page.getByRole('dialog',{name:'是否为教职工',exact:true});await expect(dialog).toBeVisible();expect(bodies).toHaveLength(0);await dialog.getByRole('button',{name:'是，我是教职工',exact:true}).click();}
 await expect.poll(()=>bodies.length).toBe(1);
 expect(bodies[0].staffDeclared).toBe(matched?'是':'未确认');
 await expect(page.getByRole('button',{name:'注册并获取验证码',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'注册并获取验证码',exact:true}).click();
 await expect.poll(()=>bodies.length).toBe(2);
 await expect(page.getByRole('dialog',{name:'是否为教职工',exact:true})).toHaveCount(0);
});
