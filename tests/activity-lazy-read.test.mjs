import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';
import {runningSourceDigest} from '../lib/events/running-review.js';
import {scopedRows} from '../lib/events/scoped-read.js';
import {withDisplayReads,clearDisplayReads} from '../lib/http/display-reads.js';
import {createApprovalRouting} from '../lib/events/approval-routing.js';

test('catalog shares one projected event read across requests and keeps reviewer evidence',async()=>{
 const event={_id:'pending',活动ID:'pending',状态:'待审核',负责人账号ID:'owner',报名页配置:'{}'};
 const account={accountId:'reviewer',role:'super_admin'};
 const routing=createApprovalRouting({store:{},getAccounts:async()=>{throw Error('Unexpected directory read');}});
 let eventReads=0;
 const base={listRows:async table=>{if(table===WF.events){eventReads+=1;return [event];}throw Error('Unexpected full table read');},query:async()=>[]};
 const w=createWorkflow(base);
 // 目录是展示投影：同一窗口内的多次请求复用同一次读取，而不是按 authority 快照重投影。
 const catalog=await withDisplayReads(()=>w.catalog([event]));
 const again=await withDisplayReads(()=>w.catalog([event]));
 assert.equal(eventReads,1);
 assert.deepEqual(again.events.map(row=>row._id),['pending']);
 const detail=await w.detail('pending',[event]);
 for(const data of [catalog,detail])assert.equal(routing.describeForAuthority(data.events,{actor:'reviewer',account})[0].approvalAccess.canReview,true);
 assert.equal(routing.describeForAuthority([event],{actor:'reviewer',account:{...account,status:'停用'}})[0].approvalAccess.canReview,false);
 assert.equal(routing.describeForAuthority([event],{actor:'other',account})[0].approvalAccess.canReview,false);
 clearDisplayReads();
});

test('lightweight catalog retains only the approval context needed for assigned reviewers',async()=>{
 const event={_id:'review',活动ID:'review',组织类别:'博爱中心',负责人账号ID:'owner',状态:'待审核',报名页配置:JSON.stringify({center:'博爱中心',lastEditor:'owner',approval:{category:'博爱中心',reviewerId:'chair'},successMail:{body:'private content'}})};
 const w=createWorkflow({listRows:async table=>table===WF.events?[event]:[]});
 const catalog=await w.catalog();
 const routing=createApprovalRouting({store:{},getAccounts:async()=>[{accountId:'chair',role:'platform_admin',permissions:['events']}]});
 assert.equal((await routing.describe(catalog.events,'chair'))[0].approvalAccess.canReview,true);
 assert.equal((await routing.describe(catalog.events,'owner'))[0].approvalAccess.canReview,false);
 assert.equal(JSON.stringify(catalog).includes('private content'),false);
});

test('catalog reads no registrations or ledger; detail queries only explicit project ids',async()=>{
 const reads=[],queries=[];
 const events=['one','two'].map(id=>({_id:id,活动ID:id,活动名称:'同名不同项目',状态:'报名中',报名页配置:JSON.stringify({rosterReview:{private:'hidden'}})}));
 const base={listRows:async table=>{reads.push(table);if(table===WF.events)return events;throw Error('Unexpected full table read');},query:async sql=>{queries.push(sql);return [];}};
 const w=createWorkflow(base);
 const catalog=await withDisplayReads(()=>w.catalog());
 assert.equal(catalog.events.length,2);assert.equal(catalog.lazyDetails,true);
 assert.deepEqual(reads,[WF.events]);assert.equal(JSON.stringify(catalog).includes('hidden'),false);
 await withDisplayReads(()=>w.detail('one'));
 assert.equal(queries.length,2);assert.ok(queries.every(sql=>sql.includes("IN ('one')")));
 assert.deepEqual(reads,[WF.events]);
 clearDisplayReads();
});
test('scoped SQL is paginated, quoted and shared only for display reads',async()=>{
 const sqls=[];const base={query:async sql=>{sqls.push(sql);return sql.includes('OFFSET 0')?Array.from({length:1000},(_,i)=>({_id:String(i)})):[];}};
 await withDisplayReads(()=>Promise.all([scopedRows(base,'synthetic',["a'b"]),scopedRows(base,'synthetic',["a'b"])]));
 assert.equal(sqls.length,2);assert.match(sqls[0],/a''b/);assert.match(sqls[1],/OFFSET 1000/);
 await scopedRows(base,'synthetic',["a'b"]);assert.equal(sqls.length,4);
});
test('scoped SQL failures never become an empty successful snapshot',async()=>{
 await assert.rejects(scopedRows({query:async()=>({})},'synthetic',['one']));
});

test('project detail retains roster evidence and excludes unrelated same-name events',async()=>{
 const event=(id,group)=>({_id:id,活动ID:id,活动名称:'Same name',状态:'报名中',报名页配置:JSON.stringify({ordinary:{groupId:group}})});
 const events=[event('a','group'),event('b','group'),event('c','other')];
 const registrations=[{_id:'r',活动ID:'a',报名ID:'reg',报名状态:'已确认'}];
 const tables={[WF.events]:events,[WF.registrations]:registrations,[WF.ledger]:[],网站普通活动项目表:['group','other'].map(id=>({活动组ID:id,活动名称:'Same name'}))};
 const base={listRows:async table=>tables[table]||[],query:async sql=>sql.includes(WF.registrations)?registrations:[]};
 const workflow=createWorkflow(base),overview=await workflow.overview(),detail=await workflow.detail('b');
 assert.deepEqual(detail.events.map(e=>e._id),['a','b']);
 assert.deepEqual(detail.registrations,overview.registrations);
 for(const event of detail.events)assert.equal(event.rosterToken,overview.events.find(e=>e._id===event._id).rosterToken);
});

test('early-end evidence reads only project registration, check-in and ledger rows, never profiles',async()=>{
 const reads=[],queries=[],event={_id:'one',活动ID:'one',状态:'进行中',报名页配置:'{}'};
 const w=createWorkflow({listRows:async table=>{reads.push(table);if(table===WF.events)return [event];throw Error('unexpected table read '+table);},query:async sql=>{queries.push(sql);return [];}},{approvalRouting:{assertRemovalManager:async()=>{},assertRemovalReviewer:async()=>{}}});
 const state=await w.workspaceRemoval('one','super');assert.equal(state.canRemove,true);assert.deepEqual(reads,[WF.events]);assert.equal(queries.length,3);assert.ok(queries.every(sql=>sql.includes("IN ('one')")));assert.ok(queries.some(sql=>sql.includes(WF.checkins)));
});

test('ordinary information and detail query only the selected group, with no blood source or private table scans',async()=>{
 const events=['group','other'].flatMap(group=>['one','two'].map(n=>({_id:group+n,活动ID:group+n,报名页配置:JSON.stringify({ordinary:{groupId:group},workspaceDescription:'合成说明',approval:{reviewerId:'private-reviewer'}})})));
 const sqls=[];const w=createWorkflow({listRows:()=>assert.fail('no global source read'),query:async sql=>{
  sqls.push(sql);
  return sql.includes('网站普通活动项目表')?[{活动组ID:'group',活动名称:'合成'}]:[];
 }},{bloodSourceTable:'unrelated-source'});
 const information=await w.information('groupone',events);
 assert.deepEqual(information.events.map(e=>e._id),['groupone','grouptwo']);
 assert.equal(JSON.parse(information.events[0].报名页配置).description,'合成说明');
 assert.equal(JSON.stringify(information).includes('private-reviewer'),false);
 assert.equal(sqls.length,1);assert.match(sqls[0],/WHERE `活动组ID` IN \('group'\)/);
 await w.detail('groupone',events);
 assert.equal(sqls.length,4);assert.ok(sqls.slice(2).every(sql=>sql.includes("IN ('groupone','grouptwo')")));
});

test('edit eligibility reads only current project check-in and ledger evidence and fails closed',async()=>{
 const events=['one','other'].map(id=>({_id:id,活动ID:id,状态:'报名中',报名日期:'2099-01-01',报名时段:'10:00-11:00',报名页配置:JSON.stringify({workspaceSubmission:{origin:true},window:{start:'2099-01-01T10:00:00+08:00'}})}));
 const sqls=[];let evidence=false,deny=false,checked=0;
 const w=createWorkflow({listRows:()=>assert.fail('no full workflow read'),query:async sql=>{sqls.push(sql);if(deny)throw Error('unavailable');return evidence&&sql.includes(WF.checkins)?[{活动ID:'one'}]:[];}},{approvalRouting:{assertPublisher:async(_event,actor)=>{checked++;if(actor!=='chair')throw Error('forbidden');}}});
 assert.equal(await w.canEditWorkspace('one','chair',events),true);
 assert.equal(checked,1);assert.equal(sqls.length,2);assert.ok(sqls.every(sql=>sql.includes("IN ('one')")));
 assert.ok(sqls.some(sql=>sql.includes(WF.checkins)));assert.ok(sqls.some(sql=>sql.includes(WF.ledger)));
 evidence=true;assert.equal(await w.canEditWorkspace('one','chair',events),false);assert.equal(checked,1);
 evidence=false;assert.equal(await w.canEditWorkspace('one','outsider',events),false);
 deny=true;assert.equal(await w.canEditWorkspace('one','chair',events),false);
});

test('running review, final hours and submission status reuse authority and query only project evidence',async()=>{
 const config={workspaceSubmission:{origin:true},approval:{mode:'workspace-regional'}};
 const event={_id:'one',活动ID:'one',状态:'进行中',申请版本:'1',批准版本:'1',报名页配置:JSON.stringify(config)};
 event['批准摘要']=workflowApprovalHash(event);
 config.runningReview={status:'submitted',entries:[],previewToken:'synthetic',sourceDigest:runningSourceDigest([event],[],[],[])};
 event['报名页配置']=JSON.stringify(config);
 const sqls=[],w=createWorkflow({listRows:()=>assert.fail('no full workflow table read'),query:async sql=>{sqls.push(sql);return [];}},{approvalRouting:{assertHoursRecorder:async()=>{},assertRegistrar:async()=>{},assertHoursReviewer:async()=>{}}});
 const events=[event,{_id:'other',活动ID:'other',报名页配置:'{}'}];
 assert.equal((await w.runningReview('one','chair',events)).status,'submitted');
 assert.equal((await w.finalHours('one','chair',events)).status,'review');
 assert.equal((await w.hoursSubmissionStatus('one',events)).event._id,'one');
 assert.equal(sqls.length,9);assert.ok(sqls.every(sql=>sql.includes("IN ('one')")));
 assert.deepEqual([...new Set(sqls.map(sql=>sql.match(/FROM `([^`]+)`/)[1]))].sort(),[WF.registrations,WF.checkins,WF.ledger].sort());
});

test('attendance detail locates the registration and its check-ins without scanning on an invalid student id',async()=>{
 const sqls=[],event={_id:'one',活动ID:'one',报名页配置:'{}'};
 const w=createWorkflow({listRows:()=>assert.fail('no full table read'),getMetadata:async()=>({tables:[{name:'活动报名总表'},{name:'活动签到'}]}),query:async sql=>{
  sqls.push(sql);return sql.includes(WF.registrations)?[{_id:'reg',活动ID:'one',学号:'invalid',报名状态:'已确认'}]:[];
 }});
 const details=await w.attendanceDetail('reg',[event]);
 assert.equal(sqls.length,2);assert.match(sqls[0],/WHERE `_id` IN \('reg'\)/);assert.match(sqls[1],/WHERE `报名行ID` IN \('reg'\)/);
 assert.ok(details.warnings.some(w=>w.includes('学号无效')));
});
