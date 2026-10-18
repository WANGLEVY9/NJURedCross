import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowRows,managementReadMs } from '../lib/events/workflow.js';
import { withDisplayReads,clearDisplayReads } from '../lib/http/display-reads.js';

test('management read window is configurable and zero disables reuse', async t => {
  const original = process.env.PLATFORM_MANAGEMENT_READ_MS;
  t.after(() => { if (original === undefined) delete process.env.PLATFORM_MANAGEMENT_READ_MS; else process.env.PLATFORM_MANAGEMENT_READ_MS = original; clearDisplayReads(); });
  let loads = 0;
  const base = { listRows: async () => { loads++; return []; } };
  process.env.PLATFORM_MANAGEMENT_READ_MS = '30000';
  clearDisplayReads();
  await withDisplayReads(async () => { await workflowRows(base, 'events'); await workflowRows(base, 'events'); });
  assert.equal(loads, 1);
  process.env.PLATFORM_MANAGEMENT_READ_MS = '0';
  clearDisplayReads();
  await withDisplayReads(async () => { await workflowRows(base, 'events'); await workflowRows(base, 'events'); });
  assert.equal(loads, 3);
  delete process.env.PLATFORM_MANAGEMENT_READ_MS;
  assert.equal(managementReadMs(), 30_000);
});

test('a progressing JSON transfer is not interrupted by the first-attempt timer',async t=>{
 const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
 t.after(()=>{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;});
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===6000?200:ms===12000?1500:ms,...args);
 const api=await import('../public/app/core/api.js');let calls=0;
 globalThis.fetch=async()=>{calls++;let i=0;const chunks=['{"ok":','true,','"value":','"合成"','}'];return new Response(new ReadableStream({async pull(controller){await new Promise(resolve=>originalTimeout(resolve,70));if(i<chunks.length)controller.enqueue(new TextEncoder().encode(chunks[i++]));else controller.close();}}),{headers:{'content-type':'application/json'}});};
 assert.deepEqual(await api.request('/api/synthetic-progressing-body'),{ok:true,value:'合成'});
 assert.equal(calls,1);
});

test('progress never extends the overall read deadline',async t=>{
 const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
 t.after(()=>{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;});
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===6000?200:ms===12000?350:ms,...args);
 const api=await import('../public/app/core/api.js');let calls=0;
 globalThis.fetch=async(_path,{signal})=>{calls++;return new Response(new ReadableStream({
  start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});},
  async pull(controller){await new Promise(resolve=>originalTimeout(resolve,50));if(!signal.aborted)controller.enqueue(new TextEncoder().encode(' '));},
 }),{headers:{'content-type':'application/json'}});};
 await assert.rejects(api.request('/api/synthetic-progress-deadline'),{code:'read_timeout'});
 assert.equal(calls,1);
});

test('a stalled GET body is aborted and recovered once inside the unchanged total deadline',async t=>{
 const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout;
 t.after(()=>{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout;});
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===6000?20:ms===12000?100:ms,...args);
 const api=await import('../public/app/core/api.js');let calls=0;
 globalThis.fetch=async(_path,{signal})=>{
  calls++;
  if(calls===2)return Response.json({ok:true});
  return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};
 };
 assert.equal((await api.request('/api/synthetic-stalled-body')).ok,true);
 assert.equal(calls,2);
 calls=0;
 globalThis.fetch=async(_path,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 await assert.rejects(api.request('/api/synthetic-total-deadline'),{code:'read_timeout'});
 assert.equal(calls,2);
 calls=0;const controller=new AbortController();
 const pending=api.request('/api/synthetic-user-abort',{signal:controller.signal});controller.abort();
 await assert.rejects(pending);assert.equal(calls,1);
});

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
 // 活动详情与审批路由同样在窗口内复用，返回管理模块不再重复回源。
 assert.equal((await api.request('/api/volunteer/workflow/events/x/detail')).version,5);
 assert.equal((await api.request('/api/volunteer/workflow/events/x/detail')).version,5);
 assert.equal((await api.request('/api/volunteer/workflow/approval-routing')).version,6);
 assert.equal((await api.request('/api/volunteer/workflow/approval-routing')).version,6);
 assert.equal((await api.request('/api/volunteer/workflow/approval-routing',{fresh:true})).version,7);
 who='two';await api.refreshSession();assert.equal((await api.request('/api/volunteer/workflow')).version,8);
});

test('notification overview reuses the tab cache, refreshes explicitly and clears on writes',async t=>{
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 let requestCount=0;
 globalThis.fetch=async path=>{
  if(path==='/api/auth/session')return Response.json({authenticated:true,csrfToken:'synthetic',user:{username:'synthetic-notifications',consoleAccess:true,permissions:['events']}});
  requestCount+=1;
  return Response.json({ok:true,version:requestCount});
 };
 const api=await import('../public/app/core/api.js');
 await api.refreshSession();
 assert.equal((await api.request('/api/notifications/overview')).version,1);
 assert.equal((await api.request('/api/notifications/overview')).version,1);
 assert.equal(requestCount,1);
 assert.equal((await api.request('/api/notifications/overview',{fresh:true})).version,2);
 assert.equal(requestCount,2);
 await api.request('/api/synthetic-write',{method:'POST',body:{}});
 assert.equal((await api.request('/api/notifications/overview')).version,4);
});
