import {test,expect} from '@playwright/test';
test('approved grouped activity configures positions then publishes one public project',async({page},info)=>{
 const headers={'x-csrf-token':'synthetic-ui'};
 await page.request.post('/api/auth/login',{data:{username:'synthetic-super'}});
 const response=await page.request.post('/api/volunteer/workflow/events',{headers,data:{name:`合成岗位项目${info.project.name}`,center:'生命中心',bookingMode:'grouped',window:{start:'2030-10-29T08:00:00',end:'2030-10-30T18:00:00'},capacity:20,serviceHours:2,trainingHours:0,travelHours:0,location:'合成场馆',work:'合成服务'}});
 expect(response.ok()).toBe(true);const parent=(await response.json()).result;
 await page.goto(`/console/events?event=${parent._id}&mode=all`);
 await expect(page.getByRole('button',{name:'配置报名岗位',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'审批通过',exact:true}).click();
 await page.getByRole('button',{name:'配置报名岗位',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'配置报名岗位'});
 for(const [label,value]of [['统一报名截止（北京时间）','2030-10-28T00:00'],['岗位名称','现场引导'],['服务地点','合成逸夫馆'],['岗位开始时间','2030-10-29T08:30:01'],['岗位结束时间','2030-10-29T10:30:01'],['可报名人数','20']])await drawer.getByLabel(label).fill(value);
 await page.screenshot({path:info.outputPath('approved-position-editor.png'),fullPage:true,animations:'disabled'});
 await drawer.getByRole('button',{name:'保存岗位安排'}).click();await expect(drawer).toHaveCount(0);
 await page.getByRole('button',{name:'统一发布岗位',exact:true}).click();
 await expect.poll(async()=>{const data=await(await page.request.get('/api/volunteer/workflow')).json();return data.events.find(e=>e._id===parent._id)['状态'];}).toBe('报名中');
 const publicData=await(await page.request.get('/api/public/workflow/events')).json();
 // Read-only anonymous workflow catalogue excludes the unbookable parent.
 expect(publicData.ok).toBe(true);
 expect(publicData.events.some(e=>e.id===parent._id)).toBe(false);
 expect(publicData.events.filter(e=>e.name===`合成岗位项目${info.project.name}`)).toHaveLength(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
