import test from 'node:test';
import assert from 'node:assert/strict';
import {MESSAGE_TABLE,MESSAGE_COLUMNS,messagePayload,messageRoutes} from '../lib/community/messages.js';
import {scopeForConsolePath} from '../lib/permissions.js';
const fixture=()=>{
  const rows=[];const audits=[];
  const base={getMetadata:async()=>({tables:[{name:MESSAGE_TABLE,columns:MESSAGE_COLUMNS.map(name=>({name,type:'text'}))}]}),listRows:async()=>rows,appendRow:async(_t,row)=>{rows.push({...row,_id:'m1'});return {_id:'m1'};},updateRow:async(_t,id,patch)=>Object.assign(rows.find(r=>r._id===id),patch)};
  const context={base,session:{username:'synthetic-admin'},json:(_res,status,body)=>({status,body}),readJson:async req=>req.body,audit:async(...args)=>audits.push(args)};
  return {rows,audits,context};
};
test('message inputs and states are validated before writes',()=>{
 for(const body of [{},{content:'hello',author:''},{content:'a'.repeat(1001),author:'a'},{content:'a',author:'b',status:'任意状态'}])assert.throws(()=>messagePayload(body),error=>error.statusCode===400);
 assert.equal(messagePayload({content:' hello ',author:' name '})['内容'],'hello');
});
test('message drafting, publishing and offline retention preserve actor audit',async()=>{
 const {rows,audits,context}=fixture();const url=new URL('http://synthetic/api/community/messages');
 const result=await messageRoutes({method:'POST',body:{content:'hello',author:'synthetic'}},{},url,context);
 assert.equal(result.status,201);assert.equal(rows[0]['状态'],'草稿');
 for(const status of ['已发布','已下架'])await messageRoutes({method:'PATCH',body:{content:'hello',author:'synthetic',status}},{},new URL(url+'/m1'),context);
 assert.equal(rows.length,1);assert.equal(rows[0]['状态'],'已下架');assert.equal(rows[0]['更新人'],'synthetic-admin');assert.equal(audits.length,3);
 await assert.rejects(messageRoutes({method:'PATCH',body:{}},{},new URL(url+'/missing'),context),e=>e.statusCode===404);
 assert.equal(audits.length,3);
});
test('missing schema is explicit and blocks persistence',async()=>{
 const f=fixture();f.context.base.getMetadata=async()=>({tables:[]});const url=new URL('http://synthetic/api/community/messages');
 const read=await messageRoutes({method:'GET'},{},url,f.context);assert.equal(read.body.ready,false);
 await assert.rejects(messageRoutes({method:'POST',body:{content:'a',author:'b'}},{},url,f.context),e=>e.statusCode===503);
 assert.equal(f.rows.length,0);
});
test('message APIs retain community permission scope',()=>{
 assert.equal(scopeForConsolePath('/api/community/messages'),'community');
 assert.equal(scopeForConsolePath('/api/community/messages/m1'),'community');
});
