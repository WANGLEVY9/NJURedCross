import { telemetryRoute } from '../shared/telemetry-route.js';
let windowAt=0,count=0;
export function reportTiming(record,{send=globalThis.fetch,now=Date.now,random=Math.random}={}) {
 try{
  if(typeof window==='undefined'&&send===globalThis.fetch)return;
  if(record.route==='/api/telemetry/client'||!send)return;
  if(record.outcome==='success'&&record.durationMs<1000&&random()>.05)return;
  const time=now();if(time-windowAt>=60000){windowAt=time;count=0;}if(count>=20)return;count++;
  // Never forward caller bodies, error messages, URLs, account details or arbitrary fields.
  const body={route:telemetryRoute(record.route),method:record.method,status:record.status,durationMs:Math.round(record.durationMs),outcome:record.outcome,requestId:record.requestId,clientTrace:record.clientTrace};
  void send('/api/telemetry/client',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true}).catch(()=>{});
 }catch{/* Telemetry must never alter business results. */}
}
