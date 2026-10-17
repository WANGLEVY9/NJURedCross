async function openActivityTasks(page) {
 const menu=page.locator('.activity-task-menu');
 await expect(menu).toBeVisible();
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
}
import {test,expect} from '@playwright/test';

const headers={'x-csrf-token':'synthetic-ui'};
test('creation flows through positions and notice before one approval submission',async({page},info)=>{
 test.setTimeout(60_000);
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 await page.goto('/console/events');
 if((await page.viewportSize()).width<=800)await page.locator('.activity-page-tools > summary').click();
 await page.getByRole('button',{name:'新建活动',exact:true}).click();
 const form=page.locator('.activity-create-form'),name=`合成一轮审批${info.project.name}`;
 for(const [label,value]of [['活动名称',name],['活动开始时间','2030-10-29T09:00'],['活动结束时间','2030-10-29T12:00'],['活动地点','合成岗位地点'],['活动内容','合成公众介绍'],['工作内容','合成默认工作'],['服务时长（小时）','3']])await form.getByLabel(label).fill(value);
 await form.getByRole('combobox',{name:'活动类别',exact:true}).click();
 await page.getByRole('option',{name:'生命中心',exact:true}).click();
 await form.getByRole('combobox',{name:'报名方式',exact:true}).click();
 await page.getByRole('option',{name:'按岗位细分报名',exact:true}).click();
 await page.getByRole('button',{name:'保存并编辑通知',exact:true}).click();
 const positions=page.getByRole('dialog',{name:'配置报名岗位',exact:true});
 await expect(positions).toBeVisible();
 for(const [label,value]of [['统一报名截止（北京时间）','2030-10-28T18:00'],['岗位名称','合成引导岗'],['可报名人数','2'],['服务地点','合成岗位地点'],['岗位开始时间','2030-10-29T09:00'],['岗位结束时间','2030-10-29T12:00'],['岗位工作内容','合成岗位具体任务']])await positions.getByLabel(label).fill(value);
 await positions.getByRole('button',{name:'保存岗位安排',exact:true}).click();
 await expect(positions).toHaveCount(0);
 const notice=page.getByLabel('报名通知正文',{exact:true});
 await notice.fill('合成定稿通知：先配置岗位，完成通知后一次提交。');
 await page.getByLabel('定时发布时间（北京时间）',{exact:true}).fill('2030-10-28T10:20:17');
 let submits=0;
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/submit'))submits++;});
 await page.getByRole('button',{name:'保存通知并提交审批',exact:true}).click();
 await expect.poll(async()=>{
  const data=await(await page.request.get('/api/volunteer/workflow')).json(),row=data.events.find(event=>event['活动名称']===name);
  return row?{status:row['状态'],text:row['通知草稿'],publishAt:JSON.parse(row['报名页配置']).publishAt}:null;
 }).toEqual({status:'待审核',text:'合成定稿通知：先配置岗位，完成通知后一次提交。',publishAt:'2030-10-28T10:20:17+08:00'});
 expect(submits).toBe(1);
 await openActivityTasks(page);await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await page.getByRole('tab',{name:'活动信息',exact:true}).click();
 await expect(page.getByRole('region',{name:'发布工作区',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeEnabled();
 expect((await(await page.request.get('/api/public/workflow/events')).json()).events.some(event=>event.name===name)).toBe(false);
 await page.getByRole('button',{name:'立即发布',exact:true}).click();
 await expect.poll(async()=>(await(await page.request.get('/api/public/workflow/events')).json()).events.filter(event=>event.name===name).length).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('missing grouped positions cannot publish immediately or schedule through API',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:'合成缺岗位发布门禁',center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T09:00:00+08:00',end:'2030-10-29T12:00:00+08:00'},capacity:2,serviceHours:3,location:'合成地点',work:'合成工作'}});
 const row=(await response.json()).result;
 expect((await page.request.post(`/api/volunteer/workflow/events/${row._id}/approve`,{headers,data:{}})).ok()).toBe(true);
 for(const [action,data]of [['publish',{}],['schedule',{publishAt:'2030-10-28T10:20:17+08:00'}]])expect((await page.request.post(`/api/volunteer/workflow/events/${row._id}/${action}`,{headers,data})).status()).toBe(409);
 await page.goto(`/console/events?event=${row._id}&mode=all&tab=overview`);
 await expect(page.getByRole('region',{name:'发布工作区'})).toContainText('请先配置有效的报名岗位');
 await expect(page.getByRole('button',{name:'立即发布',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'定时发布',exact:true})).toBeDisabled();
});
