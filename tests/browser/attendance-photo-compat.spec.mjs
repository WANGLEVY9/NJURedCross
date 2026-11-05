import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {validateAttendancePhoto} from '../../lib/events/photo-validation.js';

for(const fallback of [false,true])test(`phone-size JPEG is resized before submission (${fallback?'Safari image fallback':'bitmap'})`,async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});if(fallback)await page.addInitScript(()=>{window.createImageBitmap=undefined;});
 const me=await(await page.request.get('/api/portal/workflow/me')).json(),record={...me.registrations[0],status:'已确认',result:'报名成功',entryStatus:'网站待核对',eventStatus:'报名中',leaveStatus:'',attendanceSubmitted:false,hours:{code:'initial_review',label:'待负责人确认',tone:'info'}};let uploaded=null;
 await page.route('**/api/portal/workflow/me',route=>route.fulfill({json:{...me,registrations:[record]}}));
 await page.route('**/api/portal/workflow/registrations/*/attendance',async route=>{const bytes=route.request().postDataBuffer();uploaded=await validateAttendancePhoto(bytes);expect(bytes.length).toBeLessThanOrEqual(4*1024*1024);expect(route.request().headers()['content-type']).toBe('image/jpeg');record.attendanceSubmitted=true;await route.fulfill({json:{ok:true}});});
 const original=await sharp({create:{width:4032,height:3024,channels:3,background:'#ffffff'}}).jpeg().toBuffer();await expect(validateAttendancePhoto(original)).rejects.toMatchObject({code:'invalid_attendance_photo'});
 await page.goto('/workflow-events?view=records');const card=page.locator('.blood-registration');await card.locator('summary').filter({hasText:'现场签到'}).click();await card.getByLabel('现场签到照片').setInputFiles({name:'synthetic-phone.jpeg',mimeType:'image/jpeg',buffer:original});await card.getByRole('button',{name:'提交照片签到'}).click();await expect.poll(()=>uploaded?.width).toBe(2400);expect(uploaded.height).toBe(1800);await expect(card.locator('.blood-registration__heading')).toContainText('签到待核验');
});

test('invalid selected image is not sent and exposes a usable recovery message',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});await page.goto('/workflow-events?view=records');
 const result=await page.evaluate(async()=>{const {prepareAttendancePhoto}=await import('/app/portal/attendance-photo.js');try{await prepareAttendancePhoto(new File(['not a photo'],'bad.jpeg',{type:'image/jpeg'}));return '';}catch(error){return error.message;}});expect(result).toContain('截图后重新选择上传');
});


test('static PNG and WebP retain original bytes and missing MIME is inferred from image bytes',async({page})=>{
 await page.request.post('/api/auth/login',{data:{username:'synthetic-reviewer'}});await page.goto('/workflow-events?view=records');
 for(const format of ['png','webp']){const bytes=await sharp({create:{width:32,height:24,channels:3,background:'#fff'}}).toFormat(format).toBuffer();const result=await page.evaluate(async({bytes,format})=>{const {prepareAttendancePhoto}=await import('/app/portal/attendance-photo.js');const original=new File([new Uint8Array(bytes)],'photo.'+format,{type:''}),processed=await prepareAttendancePhoto(original);return {bytes:[...new Uint8Array(await processed.arrayBuffer())],type:processed.type};},{bytes:[...bytes],format});expect(result.type).toBe('image/'+format);expect(result.bytes).toEqual([...bytes]);}
});
