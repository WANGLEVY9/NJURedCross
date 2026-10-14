import { test, expect } from '@playwright/test';

test.beforeEach(async({page})=>{await page.request.post('/api/auth/logout');});

for(const [input,domain,expected] of [
 ['231250082','smail.nju.edu.cn','231250082@smail.nju.edu.cn'],
 ['231250082','nju.edu.cn','231250082@nju.edu.cn'],
 ['231250082@smail.nju.edu.cn','nju.edu.cn','231250082@smail.nju.edu.cn'],
 ['synthetic-reviewer','smail.nju.edu.cn','synthetic-reviewer'],
])test(`admin login preserves identity: ${input} / ${domain}`,async({page})=>{
 await page.goto('/console/login?next=%2Fconsole%2Fevents');
 await page.getByLabel('管理员账号').fill(input);
 await page.getByRole('combobox',{name:'校园邮箱后缀',exact:true}).click();
 await page.getByRole('option',{name:domain==='nju.edu.cn'?'@nju.edu.cn':'@smail.nju.edu.cn（学生邮箱）',exact:true}).click();
 await page.getByLabel('密码',{exact:false}).fill('synthetic-password');
 const request=page.waitForRequest(r=>r.url().endsWith('/api/auth/login')&&r.method()==='POST');
 await page.getByRole('button',{name:'登录运营端',exact:true}).click();
 expect((await request).postDataJSON()).toEqual({username:expected,password:'synthetic-password'});
 await expect(page).toHaveURL(/\/console\/events/);
 await expect(page.getByRole('heading',{name:'活动管理',exact:true})).toBeVisible();
});

test('student identity completion does not grant console access',async({page})=>{
 await page.route('**/api/auth/login',route=>route.fulfill({json:{ok:true,authenticated:true,user:{consoleAccess:false}}}));
 await page.goto('/console/login');
 await page.getByLabel('管理员账号').fill('231250082');
 await page.getByLabel('密码',{exact:false}).fill('synthetic-password');
 await page.getByRole('button',{name:'登录运营端',exact:true}).click();
 await expect(page.getByText('该账号属于活动平台',{exact:true})).toBeVisible();
 await expect(page).not.toHaveURL(/\/console\/overview/);
});
