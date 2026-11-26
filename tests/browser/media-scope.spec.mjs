import {test,expect} from '@playwright/test';

test('photo library changes scope and filters without showing owner-only actions on shared photos',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'preview-admin'}});
 const photo={id:'PHO-shared',filename:'合成素材.png',mimeType:'image/png',center:'博爱中心',activity:'合成活动',keepStatus:'待定',owned:false};
 const requests=[];
 await page.route('**/api/public/media/activities*',route=>route.fulfill({json:{activities:[],centers:['博爱中心']}}));
 await page.route('**/api/public/media/picks',route=>route.fulfill({json:{picks:[]}}));
 await page.route(/\/api\/public\/media(?:\?|$)/,route=>{
  const params=new URL(route.request().url()).searchParams;
  requests.push(Object.fromEntries(params));
  const photos=params.get('scope')==='center'?[photo]:[];
  return route.fulfill({json:{photos,scopes:['mine','center'],types:photos.length?['image/png']:[],config:{centers:['博爱中心']},
   folders:photos.length?[{key:'test',center:photo.center,activity:photo.activity,folderName:photo.activity,count:1,photos}]:[]}});
 });
 await page.goto('/photos');
 const select=async(name,value)=>{
  await page.locator(`select[name="media-list-${name}"]`).evaluate((node,selected)=>{node.value=selected;node.dispatchEvent(new Event('change',{bubbles:true}));},value);
 };
 await select('scope','center');
 await expect(page.getByRole('button',{name:/打开文件夹 合成活动/})).toBeVisible();
 await select('type','image/png');
 await expect.poll(()=>requests.at(-1)).toEqual({scope:'center',type:'image/png'});
 await page.getByRole('button',{name:/打开文件夹 合成活动/}).click();
 await expect(page.getByRole('button',{name:'下载',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'申请删除',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'批量自动更名',exact:true})).toHaveCount(0);
});
