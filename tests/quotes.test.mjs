import test from 'node:test';
import assert from 'node:assert/strict';
import {QUOTE_TABLE,QUOTE_COLUMNS,quotePayload,quoteRoutes} from '../lib/community/quotes.js';
import {scopeForConsolePath} from '../lib/permissions.js';
const fixture=()=>{
  const rows=[];const audits=[];
  const base={getMetadata:async()=>({tables:[{name:QUOTE_TABLE,columns:QUOTE_COLUMNS.map(name=>({name,type:'text'}))}]}),listRows:async()=>rows,appendRow:async(_t,row)=>{rows.push({...row,_id:'q1'});return {_id:'q1'};},updateRow:async(_t,id,patch)=>Object.assign(rows.find(r=>r._id===id),patch)};
  const context={base,session:{username:'synthetic-admin'},json:(_res,status,body)=>({status,body}),readJson:async req=>req.body,audit:async(...args)=>audits.push(args)};
  return {rows,audits,context};
};
test('quote inputs and states are validated before writes',()=>{
 for(const body of [{},{content:'hello',author:''},{content:'a'.repeat(1001),author:'a'},{content:'a',author:'b',status:'任意状态'}])assert.throws(()=>quotePayload(body),error=>error.statusCode===400);
 assert.equal(quotePayload({content:' hello ',author:' name '})['内容'],'hello');
});
test('quote drafting, publishing and offline retention preserve actor audit',async()=>{
 const {rows,audits,context}=fixture();const url=new URL('http://synthetic/api/community/quotes');
 const result=await quoteRoutes({method:'POST',body:{content:'hello',author:'synthetic'}},{},url,context);
 assert.equal(result.status,201);assert.equal(rows[0]['状态'],'草稿');
 for(const status of ['已发布','已下架'])await quoteRoutes({method:'PATCH',body:{content:'hello',author:'synthetic',status}},{},new URL(url+'/q1'),context);
 assert.equal(rows.length,1);assert.equal(rows[0]['状态'],'已下架');assert.equal(rows[0]['更新人'],'synthetic-admin');assert.equal(audits.length,3);
 await assert.rejects(quoteRoutes({method:'PATCH',body:{}},{},new URL(url+'/missing'),context),e=>e.statusCode===404);
 assert.equal(audits.length,3);
});
test('missing schema is explicit and blocks persistence',async()=>{
 const f=fixture();f.context.base.getMetadata=async()=>({tables:[]});const url=new URL('http://synthetic/api/community/quotes');
 const read=await quoteRoutes({method:'GET'},{},url,f.context);assert.equal(read.body.ready,false);
 await assert.rejects(quoteRoutes({method:'POST',body:{content:'a',author:'b'}},{},url,f.context),e=>e.statusCode===503);
 assert.equal(f.rows.length,0);
});
test('quote APIs retain community permission scope',()=>{
 assert.equal(scopeForConsolePath('/api/community/quotes'),'community');
 assert.equal(scopeForConsolePath('/api/community/quotes/q1'),'community');
});
