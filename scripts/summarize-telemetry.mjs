import { createInterface } from 'node:readline';
import { telemetryRoute } from '../public/app/shared/telemetry-route.js';
// Accept journalctl -o cat or -o json; never echo unrecognized log messages.
const groups=new Map();let runtime=null,accepted=0;
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
 try{
  let r=JSON.parse(line);if(typeof r.MESSAGE==='string')r=JSON.parse(r.MESSAGE);
  if(r.schema!==1||!['http','dependency','browser','runtime'].includes(r.type))continue;
  if(r.type==='runtime'){runtime={rssBytes:r.rssBytes,heapBytes:r.heapBytes,active:r.active,dropped:r.dropped,eventLoopP95Ms:r.eventLoopP95Ms,cpuPercent:r.cpuPercent};continue;}
  if(!Number.isFinite(r.durationMs)||r.durationMs<0||accepted>=100000)continue;
  accepted++;
  const service=['seatable','smtp','njubox','oss','external','content','queue','background','password'].includes(r.service)?r.service:'';
  const key=[r.type,service,telemetryRoute(r.route)].join(' ');
  const g=groups.get(key)||{count:0,errors:0,aborted:0,ms:[]};
  g.count++;if(r.status>=400||r.error||(r.type==='browser'&&r.outcome!=='success'))g.errors++;
  if(r.aborted)g.aborted++;g.ms.push(r.durationMs);groups.set(key,g);
 }catch{/* Ignore non-telemetry application messages. */}
}
console.log(JSON.stringify({accepted,capped:accepted>=100000,runtime,groups:[...groups].map(([key,g])=>{g.ms.sort((a,b)=>a-b);const percentile=p=>g.ms[Math.max(0,Math.ceil(g.ms.length*p)-1)];return {key,count:g.count,errors:g.errors,aborted:g.aborted,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:g.ms.at(-1)};})},null,2));
