import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {scopedRows} from '../lib/events/scoped-read.js';
import {withDisplayReads,clearDisplayReads} from '../lib/http/display-reads.js';

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
