import {test} from 'node:test';
import {rosterRow} from '../public/app/shared/roster-review.js';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {participantDirectory} from '../lib/events/participant-directory.js';
import {matchesActivity,filterRoster,noticeTemplate,syncNoticeSchedule,serviceDuration,selectedPendingIds,selectedResultIds} from '../public/app/shared/activity-management.js';
const draft={name:'10.12 合成活动',date:'2026-10-12',slot:'09:00-12:00',position:'',capacity:2,registrationLimit:3,serviceHours:3,location:'南京合成场地',work:'志愿者引导',content:'面向公众的活动内容',center:'生命类'};
const person=i=>({accountId:`person-${i}`,studentId:`99999000${i}`,email:`99999000${i}@smail.nju.edu.cn`,realName:`合成${i}`,emailVerified:true});
test('schedule announcements update without replacing custom notice content or duplicating the start line',()=>{
 const text='自定义活动标题\n【活动内容】：自定义工作安排\n集合说明保留\n【报名方式】：自定义报名链接';
 const first=syncNoticeSchedule(text,'2026-10-15T09:30+08:00');
 assert.equal(first,text.replace('【报名方式】','【报名开始】：10月15日 09:30 开始报名（北京时间）\n【报名方式】'));
 const changed=syncNoticeSchedule(first,'2026-10-14T00:00+08:00');
 assert.match(changed,/【报名开始】：10月14日 00:00 开始报名（北京时间）/);
 assert.ok(!changed.includes('10月15日'));assert.equal(changed.match(/【报名开始】/g).length,1);
 assert.equal(syncNoticeSchedule(changed,''),text);
});
test('scheduled templates and legacy custom notices use the chosen Beijing time and preserve line endings',()=>{
 const template=noticeTemplate({...draft,publishAt:'2026-10-06T10:00+08:00'});
 assert.match(template,/【报名开始】：10月6日 10:00 开始报名（北京时间）/);
 const legacy='自定义正文\r\n【报名开始】：2026-10-06 10:00（北京时间）\r\n保留结尾说明';
 const updated=syncNoticeSchedule(legacy,'2026-10-07T08:30');
 assert.equal(updated,'自定义正文\r\n【报名开始】：10月7日 08:30 开始报名（北京时间）\r\n保留结尾说明');
 assert.equal(syncNoticeSchedule(updated,''),'自定义正文\r\n保留结尾说明');
});
test('pending roster stays ahead of processed rows and mixed selection only decides pending people',()=>{
 const rows=[{_id:'success',报名状态:'已确认',创建时间:'2026-10-01'}, {_id:'pending-old',报名状态:'待筛选',创建时间:'2026-10-02'}, {_id:'pending-new',报名状态:'待筛选',创建时间:'2026-10-03'}, {_id:'leave',报名状态:'待筛选',请假状态:'待审批',创建时间:'2026-10-04'}, {_id:'checked',报名状态:'已签到',创建时间:'2026-10-05'}];
 assert.deepEqual(filterRoster(rows).map(r=>r._id),['pending-old','pending-new','leave','success','checked']);
 assert.deepEqual(filterRoster(rows,{order:'desc'}).map(r=>r._id),['leave','pending-new','pending-old','checked','success']);
 assert.deepEqual(selectedPendingIds(rows,new Set(rows.map(r=>r._id))),['pending-old','pending-new']);
 assert.deepEqual(selectedPendingIds(rows,new Set(['success','checked','leave'])),[]);
 assert.deepEqual(selectedResultIds(rows,new Set(rows.map(r=>r._id))),['success','checked']);
 assert.deepEqual(selectedResultIds(rows,new Set(['pending-old','pending-new','leave'])),[]);
});
function fixture(){let seq=0,clock=Date.parse('2026-10-05T08:00:00+08:00');const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));const base={listRows:async(t,_v,_o,_c,start=0,n=500)=>structuredClone(rows[t].slice(start,start+n)),appendRow:async(t,r)=>{const row={...r,_id:`r${++seq}`};rows[t].push(row);return {_id:row._id};},updateRow:async(t,id,p)=>Object.assign(rows[t].find(r=>r._id===id),p)};return {rows,base,w:createWorkflow(base,{now:()=>clock}),setClock:v=>{clock=Date.parse(v);}};}
test('roster success view includes checked-in participants and combines independent filters with sorting',()=>{
 const rows=[
  {_id:'confirmed',姓名:'林同学',学号:'1001',报名状态:'已确认',创建时间:'2026-10-01',participant:{campus:'仙林',certificateStatus:'yes'}},
  {_id:'checked',姓名:'林同学',学号:'1002',报名状态:'已签到',创建时间:'2026-10-02',participant:{campus:'仙林',certificateStatus:'yes'}},
  {_id:'pending',姓名:'林同学',学号:'1003',报名状态:'待筛选',创建时间:'2026-10-03',participant:{campus:'仙林',certificateStatus:'yes'}},
  {_id:'failed',姓名:'林同学',学号:'1004',报名状态:'未入选',创建时间:'2026-10-04',participant:{campus:'苏州'}}];
 assert.deepEqual(filterRoster(rows,{status:'success',campus:'仙林',certificate:'yes',search:'林',order:'desc'}).map(r=>r._id),['checked','confirmed']);
 assert.deepEqual(filterRoster(rows,{status:'success',search:'1001'}).map(r=>r._id),['confirmed']);
 assert.equal(filterRoster(rows,{status:'success',campus:'苏州'}).length,0);
 assert.deepEqual(filterRoster(rows,{status:'待筛选'}).map(r=>r._id),['pending']);
 assert.deepEqual(filterRoster(rows,{status:'未入选'}).map(r=>r._id),['failed']);
});
test('multiple campuses match either campus and combine with the other roster filters',()=>{
 const rows=[
  {_id:'xianlin',姓名:'林同学',学号:'1001',报名状态:'待筛选',创建时间:'2026-10-01',participant:{campus:'仙林校区',certificateStatus:'yes',coreMemberStatus:'yes'}},
  {_id:'gulou',姓名:'林同学',学号:'1002',报名状态:'待筛选',创建时间:'2026-10-02',participant:{campus:'鼓楼校区',certificateStatus:'no',coreMemberStatus:'yes'}},
  {_id:'suzhou',姓名:'林同学',学号:'1003',报名状态:'待筛选',创建时间:'2026-10-03',participant:{campus:'苏州校区',certificateStatus:'yes',coreMemberStatus:'yes'}},
  {_id:'confirmed',姓名:'林同学',学号:'1004',报名状态:'已确认',创建时间:'2026-10-04',participant:{campus:'鼓楼校区',certificateStatus:'yes',coreMemberStatus:'yes'}},
  {_id:'unknown',姓名:'林同学',学号:'1005',报名状态:'待筛选',创建时间:'2026-10-05',participant:{}}];
 assert.deepEqual(filterRoster(rows,{campus:['仙林校区','鼓楼校区'],order:'desc'}).map(r=>r._id),['gulou','xianlin','confirmed']);
 assert.deepEqual(filterRoster(rows,{campus:['仙林校区','鼓楼校区'],status:'待筛选',certificate:'yes',core:'yes',search:'林'}).map(r=>r._id),['xianlin']);
 assert.deepEqual(filterRoster(rows,{campus:['鼓楼校区']}).map(r=>r._id),['gulou','confirmed']);
 assert.deepEqual(filterRoster(rows,{campus:[]}).map(r=>r._id),filterRoster(rows).map(r=>r._id));
 assert.equal(filterRoster(rows,{campus:['不存在的校区']}).length,0);
});
async function published(f,body={}){const e=await f.w.create({...draft,...body},'owner');await f.w.approve(e._id,'reviewer');await f.w.publish(e._id);return e;}

test('revoke admission keeps the registration, requires reason, and permits later re-confirmation',async()=>{
 const f=fixture(),e=await published(f),r=await f.w.register(e._id,person(1));await f.w.confirm(r._id);
 const original=structuredClone(f.rows[WF.registrations][0]);
 await assert.rejects(f.w.revokeConfirmation(r._id,''),{statusCode:400});assert.deepEqual(f.rows[WF.registrations][0],original);
 await f.w.revokeConfirmation(r._id,'需要重新核对时间');const row=f.rows[WF.registrations][0];
 assert.equal(row.报名状态,'待筛选');assert.equal(row.是否报名成功,'false');assert.equal(row.报名ID,original.报名ID);assert.equal(row.创建时间,original.创建时间);assert.match(row.处理说明,/需要重新核对时间/);assert.equal(f.rows[WF.registrations].length,1);
 await assert.rejects(f.w.revokeConfirmation(r._id,'重复撤销'),{statusCode:409});
 await f.w.batchDecide(e._id,[r._id],'confirm');assert.equal(row.报名状态,'已确认');assert.equal(row.处理说明,'');
 await f.w.revokeConfirmation(r._id,'再次核对');await f.w.confirm(r._id);assert.equal(row.报名状态,'已确认');assert.equal(row.处理说明,'');
});
test('revoke admission refuses checked-in, photo, leave, ledger and closed-event records without writes',async()=>{
 for(const block of ['checked','photo','leave','checkinRow','ledger','closed']){
  const f=fixture(),e=await published(f),r=await f.w.register(e._id,person(1));await f.w.confirm(r._id);const row=f.rows[WF.registrations][0];
  if(block==='checked')row.报名状态='已签到';if(block==='photo')row.签到照片ID='existing-photo';if(block==='leave')row.请假状态='待审批';if(block==='checkinRow')f.rows[WF.checkins].push({_id:'check',报名行ID:r._id});if(block==='ledger')f.rows[WF.ledger].push({_id:'hours',报名行ID:r._id});if(block==='closed')f.rows[WF.events][0].状态='已结束';
  const before=structuredClone(f.rows);await assert.rejects(f.w.revokeConfirmation(r._id,'撤销'),{statusCode:409});assert.deepEqual(f.rows,before);
 }
});
test('revoke admission endpoint retains permission, CSRF and audit guards',async()=>{
 const f=fixture(),e=await published(f),r=await f.w.register(e._id,person(1));await f.w.confirm(r._id);let allowed=false,csrf=true;const audit=[];
 const ctx={getWorkflow:async()=>f.w,requireConsoleAccess:()=>allowed?{role:'platform_admin'}:null,requireCsrf:()=>csrf,readJson:async req=>req.body,actor:()=> 'reviewer',audit:async(...args)=>audit.push(args[2]),json:(_res,status,body)=>({status,body})};
 const call=()=>workflowRoutes({method:'POST',body:{reason:'重新确认名单',token:f.rows[WF.events][0].rosterToken},headers:{}},null,new URL(`http://localhost/api/volunteer/workflow/registrations/${r._id}/revoke-confirmation`),ctx);
 await call();assert.equal(f.rows[WF.registrations][0].报名状态,'已确认');allowed=true;csrf=false;await call();assert.equal(f.rows[WF.registrations][0].报名状态,'已确认');csrf=true;f.rows[WF.events][0].rosterToken=(await f.w.overview()).events[0].rosterToken;
 assert.equal((await call()).status,200);assert.equal(rosterRow(f.rows[WF.events][0],f.rows[WF.registrations][0]).报名状态,'待筛选');assert.deepEqual(audit,['workflow.registrations.revoke-confirmation']);
});
test('structured notice inherits approved location/content and half-hour service duration',async()=>{const f=fixture();const e=await f.w.create({...draft,startTime:'08:30',endTime:'12:00'},'owner');assert.equal(e.服务时长,'3.5');assert.equal(e.培训时长,'1');assert.equal(e.交通时长,'1');assert.equal(e.岗位,'');assert.match(e.通知草稿,/^南大红会 /);assert.match(e.通知草稿,/【活动内容】：面向公众的活动内容/);assert.match(e.通知草稿,/南京合成场地/);assert.equal(serviceDuration('12:00','08:00'),null);await assert.rejects(f.w.create({...draft,registrationLimit:1},'owner'),{statusCode:400});await assert.rejects(f.w.create({...draft,startTime:'08:15',endTime:'12:00'},'owner'),{statusCode:400});});
test('scheduled publication survives workflow restart and blocks early direct registration',async()=>{const f=fixture(),e=await published(f,{publishAt:'2026-10-06T10:00+08:00'});await assert.rejects(f.w.register(e._id,person(1)),{statusCode:409});assert.equal(projectWorkflowEvents(f.rows[WF.events],[],Date.parse('2026-10-06T09:59:59+08:00')).length,0);const restarted=createWorkflow(f.base,{now:()=>Date.parse('2026-10-06T10:00:00+08:00')});assert.equal(projectWorkflowEvents(f.rows[WF.events],[],Date.parse('2026-10-06T10:00:00+08:00')).length,1);await restarted.register(e._id,person(1));await assert.rejects(f.w.create({...draft,publishAt:'2026-10-13T10:00+08:00'},'owner'),{statusCode:400});});
test('concurrent registrations obey upper limit while public recommended quota stays separate',async()=>{const f=fixture(),e=await published(f);const result=await Promise.allSettled([1,2,3,4].map(i=>f.w.register(e._id,person(i))));assert.equal(result.filter(r=>r.status==='fulfilled').length,3);const [publicEvent]=projectWorkflowEvents(f.rows[WF.events],f.rows[WF.registrations]);assert.equal(publicEvent.capacity,2);assert.equal(publicEvent.full,true);await f.w.batchDecide(e._id,f.rows[WF.registrations].map(r=>r._id),'confirm');assert.equal(f.rows[WF.registrations].filter(r=>r.报名状态==='已确认').length,3);});
test('batch validates all rows before writes, rejects duplicates/cross-event/stale records',async()=>{const f=fixture(),e=await published(f),other=await published(f,{name:'另一个活动'});const a=await f.w.register(e._id,person(1)),b=await f.w.register(e._id,person(2)),c=await f.w.register(other._id,person(3));for(const ids of [[a._id,a._id],[a._id,c._id]])await assert.rejects(f.w.batchDecide(e._id,ids,'confirm'));assert.ok(f.rows[WF.registrations].every(r=>r.报名状态==='待筛选'));await assert.rejects(f.w.batchDecide(e._id,[a._id,b._id],'reject',''));await f.w.batchDecide(e._id,[a._id,b._id],'reject','名额已满');assert.equal(f.rows[WF.registrations][0].处理说明,'名额已满');await assert.rejects(f.w.batchDecide(e._id,[a._id],'confirm'));});
test('filtering trims multiword activity searches and does not treat unknown certificates as absent',()=>{assert.equal(matchesActivity({name:'公益 课堂',center:'博爱类',date:'2026-10-12',status:'报名中'},{mode:'open',search:'  公益   2026 ',category:'博爱类'}),true);assert.equal(matchesActivity({name:'公益',status:'草稿'},{mode:'open'}),false);const rows=[{_id:'a',创建时间:'2026-10-05T02:00:00Z',participant:{}},{_id:'b',创建时间:'2026-10-05T01:00:00Z',participant:{certificateStatus:'no'}}];assert.deepEqual(filterRoster(rows).map(r=>r._id),['b','a']);assert.deepEqual(filterRoster(rows,{certificate:'no'}).map(r=>r._id),['b']);assert.deepEqual(filterRoster(rows,{certificate:'unknown'}).map(r=>r._id),['a']);assert.ok(noticeTemplate({...draft,name:'南大红会 测试'}).startsWith('南大红会 测试\n'));});
test('new API routes retain auth/CSRF and expose profiles without credentials; mail is explicit',async()=>{const f=fixture(),e=await published(f),r=await f.w.register(e._id,person(1));let mail=0,allowed=true,csrf=true;const ctx={getWorkflow:async()=>f.w,requireConsoleAccess:()=>allowed?{role:'platform_admin'}:null,requireCsrf:()=>csrf,readJson:async req=>req.body,actor:()=> 'reviewer',audit:async()=>{},json:(_res,status,body)=>({status,body}),getDirectory:async()=>[{...person(1),passwordHash:'SECRET',role:'member',campus:'仙林'}],sendResultMail:async()=>{mail++;return {ok:true};}};const call=(action,body,method='POST')=>workflowRoutes({method,body,headers:{}},null,new URL('http://localhost/api/volunteer/workflow/'+action),ctx);
 const dir=await call('directory',{},'GET');assert.ok(!JSON.stringify(dir).includes('SECRET'));assert.equal(dir.body.participants[0].campus,'仙林');assert.equal(dir.body.administrators.length,0);
 allowed=false;assert.equal(await call(`events/${e._id}/batch-decide`,{ids:[r._id],decision:'confirm'}),undefined);allowed=true;csrf=false;assert.equal(await call(`events/${e._id}/batch-decide`,{ids:[r._id],decision:'confirm'}),undefined);csrf=true;
 await call(`events/${e._id}/batch-decide`,{ids:[r._id],decision:'confirm',token:(await f.w.overview()).events[0].rosterToken});assert.equal(mail,0);assert.equal(f.rows[WF.registrations][0].报名状态,'待筛选');await assert.rejects(call(`events/${e._id}/notify-results`,{}),/最终确认/);await call(`events/${e._id}/finalize-roster`,{token:(await f.w.overview()).events[0].rosterToken});assert.equal(mail,1);
});
test('participant enrichment is read only, exact identity matched and does not infer core membership',async()=>{
 const a=person(1),source={学号:a.studentId,姓名:a.realName,急救证:'有',部门:'主席团'};let queries=0;
 const base={getMetadata:async()=>({tables:[{name:'个人主页（编辑版）',columns:['学号','姓名','急救证','部门'].map(name=>({name}))}]}),query:async sql=>{queries++;assert.ok(!sql.includes('部门'));return [source];},appendRow:()=>assert.fail('must never write'),updateRow:()=>assert.fail('must never write')};
 const [p]=await participantDirectory([a,person(2)],[{账号ID:a.accountId}],base);assert.equal(queries,1);assert.equal(p.certificateStatus,'yes');assert.equal(p.coreMemberStatus,'unknown');assert.equal(a.certificateStatus,undefined);
 source.姓名='同号不同名';assert.equal((await participantDirectory([a],[{账号ID:a.accountId}],base))[0].certificateStatus,undefined);
});
test('batch partial storage failure reports progress and retry handles only remaining rows',async()=>{
 const f=fixture(),e=await published(f),a=await f.w.register(e._id,person(1)),b=await f.w.register(e._id,person(2));const update=f.base.updateRow;let fail=true;
 f.base.updateRow=async(t,id,p)=>{if(id===b._id&&fail){fail=false;throw Error('synthetic storage interruption');}return update(t,id,p);};
 await assert.rejects(f.w.batchDecide(e._id,[a._id,b._id],'confirm'),/已处理 1 \/ 2/);await f.w.batchDecide(e._id,[b._id],'confirm');assert.equal(f.rows[WF.registrations].filter(r=>r.报名状态==='已确认').length,2);
});
test('editing preserves first responsible person and records independent-review restriction for editor',async()=>{
 const f=fixture(),e=await f.w.create(draft,'creator');await f.w.edit(e._id,{...draft,name:'编辑后的活动'},'editor');assert.equal(f.rows[WF.events][0].负责人账号ID,'creator');await f.w.submit(e._id);await assert.rejects(f.w.approve(e._id,'editor'),{statusCode:403});await f.w.approve(e._id,'reviewer');
});
test('freeform notice and schedule save together, retain custom text through later config edits',async()=>{
 const f=fixture(),e=await f.w.create(draft,'creator');await f.w.approve(e._id,'reviewer');
 const text='南大红会 自定义报名标题\n【活动地点】：自定义集合地点\n自定义福利与要求\n报名链接：https://example.test/signup';
 await f.w.editNotice(e._id,text,'editor',{publishAt:'2026-10-06T10:00+08:00'});
 const saved=f.rows[WF.events][0];assert.equal(saved.通知草稿,text);assert.equal(saved.状态,'草稿');assert.equal(saved.批准摘要,'');assert.equal(saved.地点,draft.location);assert.equal(JSON.parse(saved.报名页配置).publishAt,'2026-10-06T10:00+08:00');
 const before=structuredClone(saved);await assert.rejects(f.w.editNotice(e._id,'不应保存','editor',{publishAt:'2026-10-13T10:00+08:00'}),{statusCode:400});assert.deepEqual(saved,before);
 await f.w.edit(e._id,{...draft,location:'修改后的实际地点'},'editor');assert.equal(saved.通知草稿,text);assert.equal(saved.地点,'修改后的实际地点');
 await f.w.editNotice(e._id,text+'\n第二次编辑','editor',{publishAt:''});assert.equal(JSON.parse(saved.报名页配置).publishAt,undefined);assert.equal(saved.通知草稿,text+'\n第二次编辑');
});
