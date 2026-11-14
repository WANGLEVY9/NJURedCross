import { telemetryRoute } from '../shared/telemetry-route.js';
let windowAt=0,count=0;
export function reportTiming(record,{send=globalThis.fetch,now=Date.now,random=Math.random}={}) {
 try{
  if(typeof window==='undefined'&&send===globalThis.fetch)return;
  if(record.route==='/api/telemetry/client'||!send)return;
  if(record.outcome==='success'&&record.durationMs<1000&&random()>.05)return;
  const time=now();if(time-windowAt>=60000){windowAt=time;count=0;}if(count>=20)return;count++;
  // Never forward caller bodies, error messages, URLs, account details or arbitrary fields.
  const body={phase:record.phase,headersMs:record.headersMs,transferMs:record.transferMs,connectMs:record.connectMs,dnsMs:record.dnsMs,route:telemetryRoute(record.route),method:record.method,status:record.status,durationMs:Math.round(record.durationMs),outcome:record.outcome,requestId:record.requestId,clientTrace:record.clientTrace};
  void send('/api/telemetry/client',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});
 }catch{/* Telemetry must never alter business results. */}
}

export async function timeBrowserPhase(route, phase, task) {
 const start=performance.now();
 let outcome='success';
 try{return await task();}
 catch(error){outcome='network';throw error;}
 finally{reportTiming({route,phase,durationMs:performance.now()-start,outcome});}
}

/** Resource Timing exposes completed same-origin fetches, including native scripts and styles. */
export function observePageResources() {
 if(typeof PerformanceObserver!=='function')return;
 try{
  const observer=new PerformanceObserver(list=>{
   for(const entry of list.getEntries()){
    if(entry.duration<1000||!['script','link','css','img','font'].includes(entry.initiatorType))continue;
    if(new URL(entry.name).origin!==location.origin)continue;
    reportTiming({
     route:'/:asset',phase:'resource',durationMs:entry.duration,outcome:'success',
     dnsMs:entry.domainLookupEnd-entry.domainLookupStart,
     connectMs:entry.connectEnd-entry.connectStart,
     headersMs:entry.responseStart>0?entry.responseStart-entry.startTime:undefined,
     transferMs:entry.responseStart>0?entry.responseEnd-entry.responseStart:undefined,
    });
   }
  });
  observer.observe({type:'resource',buffered:true});
 }catch{/* Resource Timing is optional in some browsers. */}
}
