import {test,expect} from '@playwright/test';

test('activity feedback console filters, shows full text and exports the selected scope',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'preview-admin'}});
 const session=await (await page.request.get('/api/auth/session')).json();
 const event={id:'one',department:'南京 · 博爱中心',project:'project-one',projectName:'合成项目',title:'合成活动',date:'2030-01-01'};
 let reviewed=false;
 const exports=[];
 await page.route('**/api/auth/session',route=>route.fulfill({json:session}));
 await page.route(/\/api\/console\/activity-feedback(?:\?|$)/,async route=>{
  const req=route.request(),params=new URL(req.url()).searchParams;
  if(req.method()==='POST'){
   expect(req.headers()['x-csrf-token']).toBe(session.csrfToken);
   expect(req.postDataJSON()).toEqual({id:'feedback-one'});reviewed=true;
   return route.fulfill({json:{ok:true}});
  }
  if(params.get('export')==='csv'){
   exports.push({method:req.method(),department:params.get('department')});
   return route.fulfill({contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="feedback.csv"'},body:req.method()==='HEAD'?'':'合成反馈全文'});
  }
  return route.fulfill({json:{items:[{id:'feedback-one',event,name:'合成同学',reviewed,rating:5,template:'rating',answers:['合成反馈全文']}],events:[event],page:1,hasNext:false}});
 });
 await page.goto('/console/activity-feedback');
 await expect(page.getByRole('heading',{name:'活动反馈',exact:true})).toBeVisible();
 await page.locator('select[name="department"]').evaluate((select,value)=>{
  select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
 },event.department);
 await page.getByRole('button',{name:'查看全文'}).click();
 await expect(page.getByText('合成反馈全文',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'标为已读'}).click();
 await expect(page.getByText('待阅',{exact:true})).toHaveCount(0);
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'导出 CSV'}).click();
 const file=await download;
 expect(new URL(file.url()).searchParams.get('department')).toBe(event.department);
 expect(new URL(file.url()).searchParams.get('export')).toBe('csv');
 expect(exports).toContainEqual({method:'HEAD',department:event.department});
});
