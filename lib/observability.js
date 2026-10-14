import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { telemetryRoute } from '../public/app/shared/telemetry-route.js';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)?value:null;
const methods=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const services=new Set(['seatable','smtp','njubox','oss','external','content','queue','background','password']);
const operations=new Set(['request','read','write','auth','send','headers','refresh','reconcile','deliver','overdue','wait']);
const errorCodes=new Set(['external_request_timeout','external_request_cancelled','external_request_failed','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','AbortError','TimeoutError']);
const finite=(n,max=3_600_000)=>Number.isFinite(n)&&n>=0?Math.min(max,Math.round(n*100)/100):null;
const statusOf=result=>Number(result?.httpError?.response?.status||result?.response?.status||result?.status)||null;

export function createObserver({enabled=true,sink=record=>process.stdout.write(JSON.stringify(record)+'\n'),now=()=>performance.now(),wall=()=>Date.now(),limit=10000}={}) {
 const context=new AsyncLocalStorage();let active=0,count=0,dropped=0,windowAt=wall();
 function emit(type,fields){
  if(!enabled)return;
  if(wall()-windowAt>=60000){count=0;windowAt=wall();}
  if(count++>=limit){dropped++;return;}
  try{sink({schema:1,type,time:new Date(wall()).toISOString(),...fields});return true;}catch{dropped++;return false;}
 }
 function http(req,res,operation){
  if(!enabled)return operation();
  const requestId=randomUUID(),clientTrace=uuid(req.headers?.['x-client-trace-id']);
  const route=telemetryRoute(req.url),start=now();
  const trace={requestId,clientTrace,route,dependencies:0,dependencyMs:0};
  res.setHeader('X-Request-ID',requestId);active++;
  let done=false;
  const finish=()=>{if(done)return;done=true;active--;res.removeListener('finish',finish);res.removeListener('close',finish);
   emit('http',{requestId,clientTrace,route,method:methods.has(req.method)?req.method:'OTHER',status:res.statusCode,aborted:!res.writableFinished,durationMs:finite(now()-start),dependencies:trace.dependencies,dependencyMs:finite(trace.dependencyMs),active});};
  res.once('finish',finish);res.once('close',finish);
  return context.run(trace,operation);
 }
 async function dependency(service,operation,task){
  if(!enabled)return task();
  const trace=context.getStore(),start=now();let status=null,error=null;
  try{const result=await task();status=statusOf(result);return result;}
  catch(e){status=statusOf(e)||Number(e?.statusCode)||null;error=errorCodes.has(e?.code)?e.code:errorCodes.has(e?.name)?e.name:'dependency_failed';throw e;}
  finally{const durationMs=finite(now()-start);if(trace){trace.dependencies++;trace.dependencyMs+=durationMs;}
   emit('dependency',{requestId:trace?.requestId||null,route:trace?.route||null,service:services.has(service)?service:'external',operation:operations.has(operation)?operation:'request',durationMs,status,error,ok:!error&&(!status||status<400)});}
 }
 function client(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  if(!['success','network','timeout','http','incomplete','aborted'].includes(body.outcome)||!Number.isFinite(body.durationMs)||body.durationMs<0||body.durationMs>120000)return false;
  emit('browser',{requestId:uuid(body.requestId),clientTrace:uuid(body.clientTrace),route:telemetryRoute(body.route),method:methods.has(body.method)?body.method:'OTHER',durationMs:finite(body.durationMs),status:Number.isInteger(body.status)&&body.status>=0&&body.status<=599?body.status:null,outcome:body.outcome,source:'untrusted_client'});
  return true;
 }
 function runtime(){return {active,dropped,rssBytes:process.memoryUsage().rss,heapBytes:process.memoryUsage().heapUsed};}
 function startRuntime(intervalMs=30000){
  if(!enabled)return ()=>{};
  const lag=monitorEventLoopDelay({resolution:20});lag.enable();let cpu=process.cpuUsage(),at=now();
  const timer=setInterval(()=>{const delta=process.cpuUsage(cpu),end=now();cpu=process.cpuUsage();if(emit('runtime',{...runtime(),cpuPercent:finite((delta.user+delta.system)/Math.max(1,(end-at)*10),10000),eventLoopP95Ms:finite(lag.percentile(95)/1e6),eventLoopMaxMs:finite(lag.max/1e6)}))dropped=0;at=end;lag.reset();},intervalMs);timer.unref();
  return ()=>{clearInterval(timer);lag.disable();};
 }
 return {http,dependency,client,startRuntime,runtime};
}
export const observer=createObserver({enabled:process.env.PLATFORM_TELEMETRY==='true'||(process.env.NODE_ENV==='production'&&process.env.PLATFORM_TELEMETRY!=='false')});
// Fetch-only wrappers measure through response headers; enclosing request spans include body consumption.
export const observedFetch=(service,fetchImpl,...args)=>observer.dependency(service,'headers',()=>fetchImpl(...args));
