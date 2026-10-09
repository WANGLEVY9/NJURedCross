import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createPublicReadCache } from '../public/app/core/public-read-cache.js';
import { createStaticHandler } from '../lib/http/static.js';
import { json } from '../lib/http/response.js';
import { acceptsGzip } from '../lib/http/compression.js';
import { createWorkflow,WF } from '../lib/events/workflow.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('public browser snapshots coalesce reads, are isolated copies and have a hard lifetime',async()=>{
 let time=0,calls=0;const cache=createPublicReadCache({now:()=>time,ttlMs:10,maxAgeMs:30});
 const load=()=>{calls++;return {events:[{name:'fixture'}]};};
 const [a,b]=await Promise.all([cache.get('events',load),cache.get('events',load)]);
 a.events[0].name='modified';assert.equal(b.events[0].name,'fixture');assert.equal(calls,1);
 time=12;assert.equal(cache.peek('events').events[0].name,'fixture');
 await cache.get('events',load,{fresh:true});assert.equal(calls,2);
 time=42;assert.equal(cache.peek('events'),null);
});
test('a write clears browser snapshots and late older GETs cannot refill them',async()=>{
 const cache=createPublicReadCache();let finish;
 const old=cache.get('events',()=>new Promise(resolve=>{finish=resolve;}));await tick();
 cache.clear();await cache.get('events',()=>({name:'new'}));finish({name:'old'});await old;
 assert.equal(cache.peek('events').name,'new');
});
test('gzip negotiation respects explicit refusal',()=>{
 for(const header of ['gzip;q=0','br, gzip;q=0, *;q=1','identity',''])assert.equal(acceptsGzip({headers:{'accept-encoding':header}}),false);
 assert.equal(acceptsGzip({headers:{'accept-encoding':'br, gzip;q=0.5'}}),true);
});
async function wireRequest(origin,path,headers={}){
 return new Promise((resolve,reject)=>http.get(origin+path,{headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));
}
test('public text compression preserves contents, revalidation and newly deployed resources',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'nju-public-compression-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const original='/* 中文资源 */\n'.repeat(400);await writeFile(join(directory,'site.css'),original);await writeFile(join(directory,'index.html'),original);
 const handler=createStaticHandler(directory);const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'http://fixture')));
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const zipped=await wireRequest(origin,'/site.css',{'Accept-Encoding':'gzip'});
 assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(gunzipSync(zipped.body).toString(),original);assert.ok(zipped.body.length<Buffer.byteLength(original)/5);
 assert.equal((await wireRequest(origin,'/site.css',{'If-None-Match':zipped.headers.etag,'Accept-Encoding':'gzip'})).status,304);
 assert.equal((await wireRequest(origin,'/site.css',{'Accept-Encoding':'gzip;q=0'})).body.toString(),original);
 await writeFile(join(directory,'site.css'),original+'changed');
 const changed=await wireRequest(origin,'/site.css',{'Accept-Encoding':'gzip'});assert.equal(gunzipSync(changed.body).toString(),original+'changed');assert.notEqual(changed.headers.etag,zipped.headers.etag);
 const shell=await wireRequest(origin,'/events',{'Accept-Encoding':'gzip'});assert.equal(shell.headers['cache-control'],'no-store');assert.equal(gunzipSync(shell.body).toString(),original);
});
test('API compression applies to anonymous catalogue, never private identity or inbox',async t=>{
 const payload={ok:true,events:Array.from({length:100},()=>({name:'合成公开活动'}))};
 const server=http.createServer((_req,res)=>json(res,200,payload));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const publicResult=await wireRequest(origin,'/api/public/events',{'Accept-Encoding':'gzip'});assert.equal(publicResult.headers['content-encoding'],'gzip');assert.deepEqual(JSON.parse(gunzipSync(publicResult.body)),payload);
 for(const path of ['/api/auth/account','/api/public/warmth/blessings/mine']){const privateResult=await wireRequest(origin,path,{'Accept-Encoding':'gzip'});assert.equal(privateResult.headers['content-encoding'],undefined);}
});
test('member summary avoids checkin and aggregate tables; mutation reads still include all evidence',async()=>{
 const tables=[];const base={listRows:async table=>{tables.push(table);return[];}};const workflow=createWorkflow(base);
 await workflow.memberRead();assert.deepEqual(tables.sort(),[WF.events,WF.registrations,WF.ledger,WF.profiles].sort());
 tables.length=0;await workflow.read();assert.deepEqual(tables.sort(),Object.values(WF).sort());
});
