import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { once } from 'node:events';
import { createObserver } from '../lib/observability.js';
import { clientTelemetry } from '../lib/client-telemetry.js';
import { telemetryRoute } from '../public/app/shared/telemetry-route.js';
import { reportTiming } from '../public/app/core/telemetry.js';

function response(){const r=new EventEmitter();r.statusCode=200;r.headers={};r.setHeader=(k,v)=>r.headers[k]=v;return r;}
test('route vocabulary removes identifiers, query strings, filenames and arbitrary text',()=>{
 assert.equal(telemetryRoute('/api/volunteer/workflow/events/SECRET/leave-approve?token=SECRET'),'/api/volunteer/workflow/events/:id/leave-approve');
 assert.equal(telemetryRoute('/uploads/private-email.png'), '/:asset');
 assert.equal(telemetryRoute('https://secret.test/path'), '/:other');
 assert.equal(telemetryRoute('/'+'x'.repeat(2000)), '/:other');
});
test('concurrent requests correlate dependencies and finish once without logging secrets',async()=>{
 const logs=[];const o=createObserver({sink:r=>logs.push(r)});
 const run=async id=>{const res=response();await o.http({url:'/api/rows/'+id+'?token=SECRET',method:'GET',headers:{cookie:'SECRET','x-client-trace-id':'SECRET'}},res,async()=>{
  await o.dependency('seatable','read',async()=>({status:200,body:'SECRET'}));
 });res.writableFinished=true;res.emit('finish');res.emit('close');return res.headers['X-Request-ID'];};
 const ids=await Promise.all([run('one'),run('two')]);assert.notEqual(...ids);
 for(const id of ids){assert.equal(logs.filter(r=>r.requestId===id).length,2);assert.equal(logs.find(r=>r.requestId===id&&r.type==='http').dependencies,1);}
 assert.equal(o.runtime().active,0);assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('aborted response and upstream HTTP/network failures are distinguishable',async()=>{
 const logs=[];const o=createObserver({sink:r=>logs.push(r)});const res=response();
 await o.http({url:'/api/events',method:'POST',headers:{}},res,async()=>{
  await o.dependency('seatable','write',async()=>({httpError:{response:{status:502,data:'SECRET'}}}));
  const error=Object.assign(new Error('SECRET'),{code:'ECONNRESET'});
  await assert.rejects(o.dependency('smtp','send',async()=>{throw error;}),e=>e===error);
 });res.emit('close');assert.equal(logs.at(-1).aborted,true);assert.equal(logs[0].ok,false);assert.equal(logs[0].status,502);assert.equal(logs[1].error,'ECONNRESET');assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('logging is bounded, disabled mode transparent and sink failure never breaks work',async()=>{
 const logs=[];let time=0;const o=createObserver({sink:r=>logs.push(r),wall:()=>time,limit:1});
 await o.dependency('external','request',async()=>1);await o.dependency('external','request',async()=>2);assert.equal(logs.length,1);assert.equal(o.runtime().dropped,1);
 time=60001;await o.dependency('external','request',async()=>3);assert.equal(logs.length,2);
 assert.equal(await createObserver({sink:()=>{throw Error();}}).dependency('external','request',async()=>7),7);
 const off=createObserver({enabled:false,sink:()=>assert.fail()});assert.equal(await off.http({},null,()=>off.dependency('external','request',async()=>8)),8);off.startRuntime()();
});
test('runtime monitor records bounded resource metrics and can stop',async()=>{
 const logs=[];const o=createObserver({sink:r=>logs.push(r)});const stop=o.startRuntime(10);await new Promise(r=>setTimeout(r,35));stop();assert.ok(logs.some(r=>r.type==='runtime'&&r.rssBytes>0));
});
test('client report allowlist ignores forged secrets, validates shape and distinguishes untrusted telemetry',()=>{
 const logs=[];const o=createObserver({sink:r=>logs.push(r)});
 assert.equal(o.client({outcome:'timeout',durationMs:12000,method:'GET',route:'/api/events/SECRET?token=SECRET',requestId:'SECRET',email:'SECRET',body:'SECRET'}),true);
 for(const body of [null,[],{}, {outcome:'timeout',durationMs:Infinity},{outcome:'timeout',durationMs:120001}])assert.equal(o.client(body),false);
 assert.equal(logs[0].source,'untrusted_client');assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('browser reporter uses sanitized payload, suppresses recursion and caps rate',()=>{
 const sent=[];const send=(path,opts)=>{sent.push({path,body:JSON.parse(opts.body)});return Promise.resolve();};let time=60000;
 const opts={send,now:()=>time,random:()=>1};
 reportTiming({route:'/api/events/SECRET?secret=SECRET',durationMs:2,outcome:'success'},opts);assert.equal(sent.length,0);
 for(let i=0;i<25;i++)reportTiming({route:'/api/events/SECRET?secret=SECRET',durationMs:2000,outcome:'timeout',body:'SECRET'},opts);
 assert.equal(sent.length,20);assert.ok(!JSON.stringify(sent).includes('SECRET'));
 time+=60000;reportTiming({route:'/api/telemetry/client',outcome:'timeout',durationMs:2},opts);assert.equal(sent.length,20);
 reportTiming({route:'/api/events',durationMs:2000,outcome:'timeout'},{...opts,send:()=>{throw Error();}});
});
test('real HTTP telemetry boundary checks origin, size, method, shape and rate without touching business services',async t=>{
 const logs=[];const observer=createObserver({sink:r=>logs.push(r)});let limited=false;
 const server=http.createServer((req,res)=>observer.http(req,res,async()=>{
  const json=(_r,s,b)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  try{await clientTelemetry(req,res,{json,report:observer.client,limit:()=>{if(limited)throw Object.assign(Error(),{statusCode:429});}});}catch(e){if(!res.destroyed)json(res,e.statusCode||500,{ok:false});}
 }));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(body,headers={})=>fetch(base+'/api/telemetry/client',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const valid={outcome:'timeout',durationMs:12000,route:'/api/events',method:'GET'};
 assert.equal((await post(valid)).status,204);assert.equal(logs.filter(r=>r.type==='browser').length,1);
 assert.equal((await post(valid,{origin:'https://attacker.invalid'})).status,403);
 assert.equal((await fetch(base+'/api/telemetry/client')).status,405);
 assert.equal((await post({})).status,400);
 await post({payload:'x'.repeat(3000)}).then(r=>assert.equal(r.status,413),()=>{}); // Node may close an over-limit stream.
 limited=true;assert.equal((await post(valid)).status,429);
 assert.equal(logs.filter(r=>r.type==='browser').length,1);
});
