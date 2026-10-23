import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {scopedRows} from '../lib/events/scoped-read.js';
import {withDisplayReads,clearDisplayReads} from '../lib/http/display-reads.js';
import {createApprovalRouting} from '../lib/events/approval-routing.js';

test('current request authority supplies event and reviewer evidence without rereading either directory',async()=>{
 const event={_id:'pending',活动ID:'pending',状态:'待审核',负责人账号ID:'owner',报名页配置:'{}'};
 const account={accountId:'reviewer',role:'super_admin'};
 const routing=createApprovalRouting({store:{},getAccounts:async()=>{throw Error('Unexpected directory read');}});
 const base={listRows:async()=>{throw Error('Unexpected full table read');},query:async()=>[]};
 const w=createWorkflow(base);
 const catalog=await w.catalog([event]);
 const detail=await w.detail('pending',[event]);
 for(const data of [catalog,detail])assert.equal(routing.describeForAuthority(data.events,{actor:'reviewer',account})[0].approvalAccess.canReview,true);
 assert.equal(routing.describeForAuthority([event],{actor:'reviewer',account:{...account,status:'停用'}})[0].approvalAccess.canReview,false);
 assert.equal(routing.describeForAuthority([event],{actor:'other',account})[0].approvalAccess.canReview,false);
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
