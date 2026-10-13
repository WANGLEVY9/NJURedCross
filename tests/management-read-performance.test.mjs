import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRows } from '../lib/events/workflow.js';
import { withDisplayReads,clearDisplayReads } from '../lib/http/display-reads.js';

test('reads recover once from a reset or truncated body but writes never auto-retry',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const api=await import('../public/app/core/api.js');let calls=0;
 globalThis.fetch=async()=>{if(++calls===1)throw new TypeError('reset');return Response.json({ok:true});};
 assert.equal((await api.request('/api/synthetic-network-reset')).ok,true);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return calls===1?{ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>{throw new TypeError('truncated');}}:Response.json({ok:true});};
 assert.equal((await api.request('/api/synthetic-truncated')).ok,true);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('reset');};
 await assert.rejects(api.request('/api/synthetic-write',{method:'POST',body:{}}));assert.equal(calls,1);
 calls=0;await assert.rejects(api.request('/api/synthetic-permanent-reset'));assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return Response.json({ok:false},{status:403});};
 await assert.rejects(api.request('/api/synthetic-forbidden'));assert.equal(calls,1);
});

test('workflow uses complete 1000-row pages and coalesces display reads, not mutation evidence',async()=>{
 clearDisplayReads();const rows=Array.from({length:1001},(_,i)=>({_id:String(i)}));const calls=[];
 const base={listRows:async(_t,_v,_o,_d,start,limit)=>{calls.push([start,limit]);return rows.slice(start,start+limit);}};
 const read=()=>withDisplayReads(()=>workflowRows(base,'events'));
 const [a,b]=await Promise.all([read(),read()]);assert.equal(a.length,1001);assert.equal(b.length,1001);
 assert.deepEqual(calls,[[0,1000],[1000,1000]]);
 await read();assert.equal(calls.length,2);
 await workflowRows(base,'events');assert.equal(calls.length,4);
});

test('private tab cache is session-bound, invalidates on writes, and explicit refresh bypasses it',async t=>{
 let calls=0;let who='one';const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async path=>new Response(JSON.stringify(path==='/api/auth/session'?{authenticated:true,csrfToken:who,user:{username:who,consoleAccess:true,permissions:['events']}}:{ok:true,version:++calls}),{headers:{'content-type':'application/json'}});
 const api=await import('../public/app/core/api.js');await api.refreshSession();
 assert.equal((await api.request('/api/volunteer/workflow')).version,1);
 assert.equal((await api.request('/api/volunteer/workflow')).version,1);
 assert.equal((await api.request('/api/volunteer/workflow',{fresh:true})).version,2);
 await api.request('/api/example',{method:'POST',body:{}});
 assert.equal((await api.request('/api/volunteer/workflow')).version,4);
 who='two';await api.refreshSession();assert.equal((await api.request('/api/volunteer/workflow')).version,5);
});
