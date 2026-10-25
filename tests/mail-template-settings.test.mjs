import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openMailSettings,applyMailTemplate,defaultMailSettings,eventMailVariables,publicParticipationGuide} from '../lib/mail/templates.js';
import {mailSettingsRoutes} from '../lib/mail/settings-api.js';
import {participationReminderMessages} from '../lib/events/participation-reminders.js';
import {createDecisionMail} from '../lib/events/decision-mail.js';
import {openDecisionMailStore} from '../lib/events/decision-mail-store.js';

const event={_id:'event-one',活动ID:'activity-one',活动名称:'合成献血车服务',组织类别:'献血车专项',状态:'报名中',报名日期:'2030-10-23',报名时段:'11:00-15:00',地点:'新街口中央',报名页配置:JSON.stringify({blood:{start:'2030-10-23T11:00:00+08:00',end:'2030-10-23T15:00:00+08:00'}})};
const registration={_id:'row-one',报名ID:'registration-one',活动ID:'activity-one',账号ID:'member-one',姓名:'合成同学',学号:'999990001',邮箱:'999990001@smail.nju.edu.cn',报名日期:'2030-10-23',报名时段:'11:00-15:00',岗位:'现场引导',报名状态:'已确认',是否报名成功:'true'};
const origin='https://fixture.invalid',due=Date.parse('2030-10-22T18:00:00+08:00');

test('templates persist with version guards, protect verification codes and render safe plain-text data once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mail-template-'));
 try{
  const path=join(dir,'settings.json'),store=await openMailSettings(path),data=store.read();
  const message=applyMailTemplate({subject:'成功',text:'旧正文',templateId:'registration-success',templateVariables:eventMailVariables(event,registration,origin)});
  assert.match(message.text,/亲爱的志愿者 合成同学/);assert.match(message.text,/我的报名/);assert.doesNotMatch(message.text,/v1h4/);assert.doesNotMatch(message.text,/\{姓名\}/);
  assert.equal(applyMailTemplate(message).text,message.text);
  data.templates['registration-success'].text='姓名：{姓名}，{活动名称}。反馈：{反馈表链接}';
  await store.save(data);await assert.rejects(store.save(data),{statusCode:409});
  assert.match(applyMailTemplate({...message,templateRendered:false}).text,/姓名：合成同学/);
  for(const templateId of ['registration-success','registration-result']){
   const sent=applyMailTemplate({templateId,text:'报名结果',templateVariables:eventMailVariables(event,registration,origin)});
   assert.match(sent.text,/服务岗位：现场引导/);assert.match(sent.text,/服务时间：2030-10-23 11:00-15:00/);assert.match(sent.text,/服务地点：新街口中央/);
   assert.equal(applyMailTemplate(sent).text,sent.text);
  }
  assert.equal(message.text.split('服务岗位：现场引导').length-1,1);
  const reopened=await openMailSettings(path);assert.equal(reopened.read().version,1);
  const invalid=reopened.read();invalid.templates['security-code'].text='欢迎';await assert.rejects(reopened.save(invalid),/原正文/);
  invalid.templates['security-code'].text='{不存在的变量}';await assert.rejects(reopened.save(invalid),/未知/);
  const header=reopened.read();header.templates.other.subject='主题\r\nBcc:bad@example.test';await assert.rejects(reopened.save(header),/主题/);
  const code=applyMailTemplate({subject:'注册验证码',text:'验证码 123456',kind:'verification'});assert.match(code.text,/123456/);
  assert.match(publicParticipationGuide().location,/浦口弘阳广场/);
 }finally{await openMailSettings(join(dir,'reset.json'));await rm(dir,{recursive:true,force:true});}
});

test('only a fresh active verified super-admin can read/save settings and writes require CSRF',async()=>{
 let status,payload,saves=0,role='platform_admin',csrf=true;
 const ctx={json:(_res,s,p)=>{status=s;payload=p;},requireConsoleAccess:()=>({username:'actor'}),getAccounts:async()=>[{username:'actor',role,status:'启用',emailVerified:true}],requireCsrf:()=>csrf,readJson:async()=>defaultMailSettings(),audit:async()=>{},store:{read:defaultMailSettings,save:async data=>{saves++;return data;}}};
 await mailSettingsRoutes({method:'GET'},null,new URL('/api/console/mail-settings',origin),ctx);assert.equal(status,403);
 role='super_admin';await mailSettingsRoutes({method:'GET'},null,new URL('/api/console/mail-settings',origin),ctx);assert.equal(status,200);assert.ok(payload.settings.templates);
 csrf=false;await mailSettingsRoutes({method:'PUT'},null,new URL('/api/console/mail-settings',origin),ctx);assert.equal(saves,0);
 csrf=true;await mailSettingsRoutes({method:'PUT'},null,new URL('/api/console/mail-settings',origin),ctx);assert.equal(saves,1);
 await mailSettingsRoutes({method:'GET'},null,new URL('/api/public/participation-guide',origin),ctx);assert.ok(payload.guide.checkin);assert.equal(payload.settings,undefined);
});

test('reminders use previous calendar day 18:00 Beijing time, skip cancelled/stopped/started and distinguish reschedules',()=>{
 const get=(e=event,r=registration,now=due)=>participationReminderMessages([e],[r],origin,now);
 assert.equal(get(event,registration,due-1).length,0);assert.equal(get().length,1);
 assert.equal(get(event,registration,Date.parse('2030-10-23T11:00:00+08:00')).length,0);
 for(const r of [{...registration,报名状态:'待筛选'},{...registration,报名状态:'已请假'},{...registration,请假状态:'待审批'},{...registration,邮箱:'someone@example.test'}])assert.equal(get(event,r).length,0);
 assert.equal(get({...event,状态:'停点'}).length,0);
 const later={...event,报名页配置:JSON.stringify({blood:{start:'2030-10-24T11:00:00+08:00'}})};
 assert.equal(get(later).length,0);assert.notEqual(get()[0].idempotencyKey,get(later,registration,due+86400000)[0].idempotencyKey);
 assert.equal(get()[0].templateVariables['姓名'],'合成同学');
 const child={...event,报名页配置:JSON.stringify({bookingMode:'grouped',parentActivityId:'parent',ordinary:{start:'2030-10-23T11:00:00+08:00'}})};assert.equal(get(child).length,1);
 const midnight={...event,报名页配置:JSON.stringify({ordinary:{start:'2031-01-01T00:30:00+08:00'}})};assert.equal(get(midnight,registration,Date.parse('2030-12-31T18:00:00+08:00')).length,1);
});

test('encrypted reminder queue freezes rendered text and skips leave/started records without duplicate sends',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'participation-mail-')),path=join(dir,'queue.sqlite'),secret='synthetic-test-secret-'.repeat(3);let store,worker,time=due,count=0;
 let data={events:[event],registrations:[registration]};
 try{
  store=await openDecisionMailStore(path,{secret});
  const scheduled=[],sent=[];
  worker=createDecisionMail({read:async()=>data,store,origin,now:()=>time,schedule:f=>scheduled.push(f),send:async m=>{count++;sent.push(m);return {ok:true,transport:'smtp'};}});
  const item={kind:'participation',id:registration._id,requestAt:'2030-10-23T11:00:00+08:00'};
  worker.enqueue([item]);await worker.drain();assert.equal(count,1);assert.match(sent[0].text,/明天开展/);assert.equal(sent[0].templateRendered,true);
  worker.enqueue([item]);await worker.drain();assert.equal(count,1);
  const second={...registration,_id:'row-two',报名ID:'registration-two',请假状态:'待审批'};data={events:[event],registrations:[second]};
  const secondItem={...item,id:second._id};worker.enqueue([secondItem]);await worker.drain();assert.equal(count,1);
  data.registrations[0]={...second,请假状态:'已批准',报名状态:'已请假'};time+=40000;await worker.drain();assert.equal(count,1);
  const third={...registration,_id:'row-three',报名ID:'registration-three'};data={events:[event],registrations:[third]};worker.enqueue([{...item,id:third._id}]);time=Date.parse(item.requestAt);await worker.drain();assert.equal(count,1);
  worker.close();store.close();store=await openDecisionMailStore(path,{secret});assert.equal(store.info().sent,1);
 }finally{worker?.close();store?.close();await rm(dir,{recursive:true,force:true});}
});
