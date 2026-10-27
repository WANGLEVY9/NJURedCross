import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createDeployBridge} from '../scripts/deploy-bridge.mjs';

async function until(predicate){
 const end=Date.now()+3000;
 while(!predicate()){if(Date.now()>end)throw Error('Synthetic bridge did not reach expected state');await delay(10);}
}

async function fixture(t,handler,options={}){
 const backend=http.createServer(handler);backend.listen(0,'127.0.0.1');await once(backend,'listening');
 const bridge=createDeployBridge({backendPort:backend.address().port,...options});bridge.server.listen(0,'127.0.0.1');await once(bridge.server,'listening');
 t.after(async()=>{bridge.resume();await bridge.close();await new Promise(resolve=>backend.close(resolve));});
 return {...bridge,url:'http://127.0.0.1:'+bridge.server.address().port};
}
test('queued writes are forwarded once with the original body, cookie, CSRF and proxy identity',async t=>{
 const writes=[],b=await fixture(t,async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;writes.push({body,headers:req.headers});res.end('saved');});
 await b.pause();const request=fetch(b.url+'/business',{method:'POST',headers:{cookie:'synthetic-session','x-csrf-token':'synthetic-csrf','x-forwarded-for':'192.0.2.8'},body:'exact-original-body'});
 await until(()=>b.status().queued===1);assert.deepEqual(b.status(),{paused:true,active:0,queued:1});assert.equal(writes.length,0);
 b.resume();assert.equal(await(await request).text(),'saved');assert.equal(writes.length,1);assert.equal(writes[0].body,'exact-original-body');assert.equal(writes[0].headers.cookie,'synthetic-session');assert.equal(writes[0].headers['x-csrf-token'],'synthetic-csrf');assert.equal(writes[0].headers['x-forwarded-for'],'192.0.2.8');
});
test('pause waits for the active write and keeps serving until the upstream is idle',async t=>{
 let release,arrived;const ready=new Promise(resolve=>{arrived=resolve;}),done=new Promise(resolve=>{release=resolve;});
 const b=await fixture(t,async(req,res)=>{if(req.method==='POST'){arrived();await done;}res.end('done');});
 const active=fetch(b.url,{method:'POST',body:'in-flight'});await ready;const paused=b.pause(1000);
 assert.equal(b.status().paused,false);assert.equal((await fetch(b.url)).status,200);
 release();assert.equal(await(await active).text(),'done');await paused;assert.equal(b.status().paused,true);
});
test('an aborted queued write is removed and never sent after resume',async t=>{
 let calls=0;const b=await fixture(t,(_req,res)=>{calls++;res.end();});await b.pause();
 const controller=new AbortController(),request=fetch(b.url,{method:'POST',body:'cancelled',signal:controller.signal}).catch(error=>error);
 await until(()=>b.status().queued===1);controller.abort();await request;await until(()=>b.status().queued===0);
 assert.equal(b.status().queued,0);b.resume();await delay(25);assert.equal(calls,0);
});
test('a busy upstream rejects the deployment pause without blocking normal requests',async t=>{
 let release,arrived;const ready=new Promise(resolve=>{arrived=resolve;}),done=new Promise(resolve=>{release=resolve;});
 const b=await fixture(t,async(req,res)=>{if(req.method==='POST'){arrived();await done;}res.end('ok');});
 const request=fetch(b.url,{method:'POST',body:'busy'});await ready;await assert.rejects(b.pause(20),/busy/);assert.equal(b.status().paused,false);
 assert.equal((await fetch(b.url)).status,200);release();await(await request).text();
});
test('an upstream connection failure is reported without replaying a business write',async t=>{
 let calls=0;const b=await fixture(t,(_req,res)=>{calls++;res.socket.destroy();});
 assert.equal((await fetch(b.url,{method:'POST',body:'only-once'})).status,502);await delay(25);assert.equal(calls,1);
});
