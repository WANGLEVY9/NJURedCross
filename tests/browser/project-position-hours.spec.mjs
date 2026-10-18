import {test,expect} from '@playwright/test';

test('optional position hours omit blanks, copy and restore overrides, and preserve wizard callbacks',async({page})=>{
 await page.goto('/login');
 const payloads=[];
 await page.route('**/events/synthetic-position-hours/configure-positions',async route=>{
  payloads.push(route.request().postDataJSON());
  await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,result:{draft:true}})});
 });
 const open=async positions=>page.evaluate(async positions=>{
  const {configureProjectPositions}=await import('/app/console/pages/activity-positions.js');
  window.positionHoursCallbacks=[];
  configureProjectPositions({_id:'synthetic-position-hours',活动名称:'合成岗位独立时长',容量:20,状态:'待审核',positionToken:'synthetic-token',报名页配置:JSON.stringify({service:2,training:1,travel:0.5,bookingMode:'grouped',window:{start:'2030-10-29T08:00:00+08:00',end:'2030-10-30T18:00:00+08:00'},positionDraft:{deadline:'2030-10-28T00:00:00+08:00',positions}})},()=>{window.positionHoursCallbacks.push('saved');},{onContinue:()=>{window.positionHoursCallbacks.push('continue');},onBack:()=>{window.positionHoursCallbacks.push('back');}});
 },positions);
 const seed={name:'引导',capacity:10,location:'合成地点',campus:'鼓楼',start:'2030-10-29T08:30:00+08:00',end:'2030-10-29T10:30:00+08:00'};
 await open([seed]);
 const drawer=page.getByRole('dialog',{name:'配置报名岗位'});
 await expect(drawer.getByLabel('服务时长（小时）',{exact:true})).toHaveValue('');
 await drawer.getByRole('button',{name:'保存并继续通知'}).click();
 await expect(drawer).toHaveCount(0);
 expect(payloads[0].positions[0]).not.toHaveProperty('serviceHours');
 expect(payloads[0].positions[0]).not.toHaveProperty('trainingHours');
 expect(payloads[0].positions[0]).not.toHaveProperty('travelHours');
 expect(await page.evaluate(()=>window.positionHoursCallbacks)).toEqual(['saved','continue']);
 await open([seed]);
 await drawer.getByLabel('服务时长（小时）',{exact:true}).fill('0');
 await drawer.getByRole('button',{name:'保存并继续通知'}).click();
 await expect(drawer.getByRole('alert')).toContainText('须大于 0');expect(payloads).toHaveLength(1);
 await drawer.getByLabel('服务时长（小时）',{exact:true}).fill('3.25');
 await drawer.getByLabel('培训时长（小时）',{exact:true}).fill('0');
 await drawer.getByLabel('交通时长（小时）',{exact:true}).fill('-1');
 await drawer.getByRole('button',{name:'保存并继续通知'}).click();
 expect(await drawer.getByLabel('交通时长（小时）',{exact:true}).evaluate(node=>node.validity.rangeUnderflow)).toBe(true);expect(payloads).toHaveLength(1);
 await drawer.getByLabel('交通时长（小时）',{exact:true}).fill('0.75');
 await drawer.getByRole('button',{name:'复制岗位',exact:true}).click();
 await expect(drawer.getByLabel('服务时长（小时）',{exact:true}).nth(1)).toHaveValue('3.25');
 await expect(drawer.getByLabel('培训时长（小时）',{exact:true}).nth(1)).toHaveValue('0');
 await drawer.getByLabel('岗位名称').nth(1).fill('登记');
 await drawer.getByLabel('服务时长（小时）',{exact:true}).nth(1).fill('');
 expect(await drawer.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
 await drawer.getByRole('button',{name:'保存并继续通知'}).click();await expect(drawer).toHaveCount(0);
 expect(payloads[1].positions[0]).toMatchObject({serviceHours:'3.25',trainingHours:'0',travelHours:'0.75'});
 expect(payloads[1].positions[1]).not.toHaveProperty('serviceHours');
 await open(payloads[1].positions);
 await expect(drawer.getByLabel('交通时长（小时）',{exact:true}).first()).toHaveValue('0.75');
 await expect(drawer.getByLabel('服务时长（小时）',{exact:true}).nth(1)).toHaveValue('');
 await drawer.getByRole('button',{name:'上一步',exact:true}).click();await expect(drawer).toHaveCount(0);
 expect(await page.evaluate(()=>window.positionHoursCallbacks)).toEqual(['back']);
});
