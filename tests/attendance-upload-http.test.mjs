import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createRequestMiddleware} from '../lib/http/request-middleware.js';
import {createRequestConcurrencyGate} from '../lib/http/request-limits.js';
import {requestBudgetMsFor,withHttpRequestBudget} from '../lib/http/request-budget.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {json} from '../lib/http/response.js';

test('raw attendance images pass the real HTTP, session, CSRF, image validation and private storage chain',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'attendance-http-'));
 const previous={dir:process.env.WORKFLOW_EVIDENCE_DIR,provider:process.env.WORKFLOW_EVIDENCE_PROVIDER,max:process.env.WORKFLOW_EVIDENCE_MAX_BYTES};
 process.env.WORKFLOW_EVIDENCE_DIR=directory;process.env.WORKFLOW_EVIDENCE_PROVIDER='local';process.env.WORKFLOW_EVIDENCE_MAX_BYTES=String(8*1024*1024);
 t.after(async()=>{
  for(const [key,value] of Object.entries({WORKFLOW_EVIDENCE_DIR:previous.dir,WORKFLOW_EVIDENCE_PROVIDER:previous.provider,WORKFLOW_EVIDENCE_MAX_BYTES:previous.max})){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  await rm(directory,{recursive:true,force:true});
 });
 let submissions=0;
 const row={报名ID:'WR-synthetic',活动ID:'synthetic-event',账号ID:'synthetic-member',报名状态:'已确认'};
 const workflow={read:async()=>({events:[],registrations:[row]}),ownRegistration:async()=>row,submitAttendance:async(code,account,photoId)=>{
  assert.equal(code,row['报名ID']);assert.equal(account.accountId,row['账号ID']);submissions++;return {photoId};
 }};
 const ctx={json,getWorkflow:async()=>workflow,getAccount:async()=>({accountId:'synthetic-member',studentId:'999990001'}),
  requirePortalSession:(req,res)=>{if(req.headers['x-synthetic-session']==='member')return {username:'synthetic-member'};json(res,401,{ok:false});return null;},
  requireCsrf:(req,res)=>{if(req.headers['x-csrf-token']==='synthetic-token')return true;json(res,403,{ok:false});return false;}};
 const middleware=createRequestMiddleware({api:(req,res,url)=>workflowRoutes(req,res,url,ctx),staticFile:()=>false,pdfAssets:()=>false,
  backgroundGate:{mark(){}},requestGate:createRequestConcurrencyGate(),createWriteJournal:()=>new Set(),withWriteJournal:(_journal,fn)=>fn(),
  withHttpRequestBudget,withDisplayReads:fn=>fn(),isDisplayRequest:()=>false,invalidateWrittenSnapshots(){},requestBudgetMsFor,
  assertApiRequestPath(){},clientTelemetry(){},enforcePublicLimit(){},handleGame(){}});
 const server=http.createServer((req,res)=>void middleware(req,res));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{const done=once(server,'close');server.close();server.closeAllConnections();await done;});
 const url=`http://127.0.0.1:${server.address().port}/api/portal/workflow/registrations/${row['报名ID']}/attendance`;
 const photo=await sharp(randomBytes(1024*768*3),{raw:{width:1024,height:768,channels:3}}).jpeg({quality:85}).toBuffer();
 assert.ok(photo.length>300*1024);assert.ok(photo.length<4*1024*1024);
 const headers={'Content-Type':'image/jpeg','x-synthetic-session':'member','x-csrf-token':'synthetic-token'};
 for(const chunked of [false,true]){
  const body=chunked?new ReadableStream({start(controller){for(let n=0;n<photo.length;n+=16384)controller.enqueue(photo.subarray(n,n+16384));controller.close();}}):photo;
  const response=await fetch(url,{method:'POST',headers,body,...(chunked?{duplex:'half'}:{})});
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));
  assert.deepEqual(await readFile(join(directory,payload.result.photoId)),photo);
 }
 assert.equal(submissions,2);
 for(const badHeaders of [{'Content-Type':'image/jpeg'},{...headers,'x-csrf-token':'wrong'}]){
  const response=await fetch(url,{method:'POST',headers:badHeaders,body:photo});
  assert.equal(response.status,badHeaders['x-synthetic-session']?403:401);await response.arrayBuffer();
 }
 const invalid=await fetch(url,{method:'POST',headers,body:Buffer.alloc(300*1024)});
 assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'invalid_attendance_photo');
 const oversized=await fetch(url,{method:'POST',headers,body:Buffer.alloc(8*1024*1024+1)});
 assert.equal(oversized.status,413);assert.equal((await oversized.json()).code,'attendance_photo_too_large');
 assert.equal(submissions,2);
 const ordinary=await fetch(url.replace('/attendance','/leave'),{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({reason:'x'.repeat(70000)})});
 assert.equal(ordinary.status,413);await ordinary.arrayBuffer();
});
