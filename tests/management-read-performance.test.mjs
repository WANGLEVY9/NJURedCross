import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRows } from '../lib/events/workflow.js';
import { withDisplayReads,clearDisplayReads } from '../lib/http/display-reads.js';

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
